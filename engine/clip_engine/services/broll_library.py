"""
B-roll from the member's own library, and AI-made shots for the gaps.

The app (src/main/broll-library.ts) keeps the library: originals in place, a 720p proxy of each, and what a vision
model saw in every shot. For a run it writes a compact catalog (`broll_catalog_path`):

    {"version": 1, "shots": [{"id": "l0123456789ab:s0", "path": "/abs/file.mp4", "kind": "video",
                              "inS": 0.0, "outS": 6.2, "description": "...", "tags": [...], "shotType": "hands",
                              "me": false, "ai": false}, ...]}

1. Plan (`match_library_to_transcript`): one call to the B-roll model with the transcript and the catalog. It picks a
   shot (and where in it to start) for the moments that match what is said, or, when AI is on, writes a prompt for
   a new shot where nothing fits. Every pick is checked here (`normalize_library_plan`): known shots only, the
   timing rules kept, no shot used twice unless the library is tiny, at most `max_ai` AI shots.
2. Make: library shots are conformed (cover crop to the frame, trimmed, no sound); AI shots are made on OpenRouter
   (POST /videos, or an image with a slow push-in) with the member's key, and saved for the library
   (`broll_ai_dir`: ai-<hex>.mp4 plus ai-<hex>.json written last; the app adds them, tagged "ai").

The renderer overlays the results exactly like stock footage (rendering_service._overlay_broll).

The B-roll video maker builds on `match_library_to_transcript` (a whole timeline) and `make_shots`.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from clip_engine.config import Settings, get_settings
from clip_engine.services.broll_service import BrollShot, transcript_lines
from clip_engine.services.media_process import run_media
from clip_engine.services.openrouter import OpenRouterError, chat_completion, json_schema_format, message_text
from clip_engine.services.transcription_service import TranscriptSegment

logger = logging.getLogger(__name__)

CATALOG_VERSION = 1
MAX_CATALOG_BYTES = 20 * 1024 * 1024
MAX_CATALOG_SHOTS = 600
# The planner sees at most this many shots: the best keyword matches, plus shots of the member.
SHORTLIST = 160
SHORTLIST_ME = 30
VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
SHOT_ID = re.compile(r"^l[0-9a-f]{12}:s[0-9]{1,3}$")
SHOT_TYPES = ("wide", "medium", "close", "top-down", "screen", "product", "hands", "talking", "text", "other")

# Timing (the same beats as stock b-roll).
MIN_SHOT_MS = 1500
MAX_SHOT_MS = 5000
MAX_SHOTS = 40
MAX_AI_SHOTS = 6
# A library small enough that a shot may be used twice in one clip.
TINY_LIBRARY = 4

SOURCES = ("library", "stock", "ai", "library_ai")
AI_KINDS = ("video", "image")
AI_PROMPT_RULES = (
    "Vertical 9:16 cinematic b-roll shot, natural light, smooth slow camera move. No text, no captions, no logos, "
    "no brand names, no watermarks. No real or famous people; any person is anonymous and seen from behind or at a distance."
)
MAX_AI_VIDEO_BYTES = 300 * 1024 * 1024
AI_POLL_SECONDS = 5.0
AI_TIMEOUT_SECONDS = 15 * 60


class BrollLibraryError(Exception):
    """A problem with the catalog or the AI settings; the message is safe to show."""


@dataclass
class CatalogShot:
    id: str
    path: str
    kind: str
    in_s: float
    out_s: float
    description: str
    tags: list[str]
    shot_type: str
    me: bool
    ai: bool
    # Words are written on it (a headline, a screen).
    text: bool = False

    @property
    def seconds(self) -> float:
        return max(0.0, self.out_s - self.in_s)

    def line(self) -> str:
        length = "still" if self.kind == "image" else f"{self.seconds:.1f}s"
        flags = (" | me" if self.me else "") + (" | ai" if self.ai else "")
        return f"{self.id} | {length} | {self.shot_type}{flags} | {self.description} [{', '.join(self.tags)}]"


@dataclass
class AiSettings:
    kind: str = "video"
    model: str = "x-ai/grok-imagine-video-1.5-lite"
    max_shots: int = 2
    seconds: int = 5
    per_second_usd: Optional[float] = None
    image_usd: float = 0.08

    def estimate_usd(self) -> float:
        if self.kind == "image":
            return self.image_usd
        return (self.per_second_usd or 0.0) * self.seconds


@dataclass
class PlannedShot:
    """One b-roll moment on the timeline (ms), from the library (`shot_id`, starting `source_s` into the file) or AI."""

    start_ms: int
    end_ms: int
    shot_id: Optional[str] = None
    source_s: float = 0.0
    ai_prompt: Optional[str] = None
    words: str = ""
    path: Optional[str] = None


@dataclass
class MadeShots:
    shots: list[BrollShot] = field(default_factory=list)
    cost_usd: float = 0.0
    library_used: int = 0
    ai_made: int = 0
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Catalog and settings (from the app)
# ---------------------------------------------------------------------------

def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", value)).strip()[:limit]


def parse_catalog(raw: Any) -> list[CatalogShot]:
    """The catalog JSON, checked: a bad shot is dropped; a bad file raises BrollLibraryError."""
    if not isinstance(raw, dict) or raw.get("version") != CATALOG_VERSION or not isinstance(raw.get("shots"), list):
        raise BrollLibraryError("The B-roll library catalog is unreadable.")
    shots: list[CatalogShot] = []
    seen: set[str] = set()
    for item in raw["shots"][:MAX_CATALOG_SHOTS]:
        if not isinstance(item, dict):
            continue
        shot_id, path, kind = item.get("id"), item.get("path"), item.get("kind")
        if not isinstance(shot_id, str) or not SHOT_ID.match(shot_id) or shot_id in seen:
            continue
        if not isinstance(path, str) or "\0" in path or not os.path.isabs(path) or len(path) > 4096:
            continue
        ext = os.path.splitext(path)[1].lower()
        if kind not in ("video", "image") or ext not in (VIDEO_EXTENSIONS if kind == "video" else IMAGE_EXTENSIONS):
            continue
        in_s, out_s = item.get("inS"), item.get("outS")
        if type(in_s) not in (int, float) or type(out_s) not in (int, float) or not (math.isfinite(in_s) and math.isfinite(out_s)):
            continue
        if kind == "video" and not (0 <= in_s < out_s <= 24 * 3600):
            continue
        description = _text(item.get("description"), 300)
        if not description:
            continue
        tags = [t for t in (_text(tag, 30).lower() for tag in (item.get("tags") or [])[:12] if isinstance(tag, str)) if t] if isinstance(item.get("tags"), list) else []
        shot_type = item.get("shotType") if item.get("shotType") in SHOT_TYPES else "other"
        seen.add(shot_id)
        shots.append(CatalogShot(shot_id, path, kind, float(in_s) if kind == "video" else 0.0, float(out_s) if kind == "video" else 0.0,
                                 description, tags, shot_type, item.get("me") is True, item.get("ai") is True, item.get("text") is True))
    return shots


def load_catalog(path: str) -> list[CatalogShot]:
    """Read the catalog the app wrote for this run (shots whose file is gone are left out)."""
    if not isinstance(path, str) or "\0" in path or not os.path.isabs(path) or os.path.basename(path) != "broll-catalog.json":
        raise BrollLibraryError("The B-roll library catalog is missing.")
    try:
        if os.path.islink(path) or not os.path.isfile(path) or os.path.getsize(path) > MAX_CATALOG_BYTES:
            raise BrollLibraryError("The B-roll library catalog is unreadable.")
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        raise BrollLibraryError("The B-roll library catalog is unreadable.") from None
    return [shot for shot in parse_catalog(raw) if os.path.isfile(shot.path)]


def parse_ai_settings(raw: Any) -> AiSettings:
    """The app's AI b-roll settings, checked (raises BrollLibraryError)."""
    if not isinstance(raw, dict):
        raise BrollLibraryError("Invalid AI b-roll settings")
    kind, model, max_shots, seconds = raw.get("kind"), raw.get("model"), raw.get("max_shots"), raw.get("seconds")
    if kind not in AI_KINDS:
        raise BrollLibraryError("Invalid AI b-roll kind")
    if not isinstance(model, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._:-]*", model, re.I) or len(model) > 120:
        raise BrollLibraryError("Invalid AI b-roll model")
    if type(max_shots) is not int or not 0 <= max_shots <= MAX_AI_SHOTS:
        raise BrollLibraryError("Invalid AI b-roll shot limit")
    if type(seconds) not in (int, float) or not 2 <= seconds <= 10:
        raise BrollLibraryError("Invalid AI b-roll length")
    per_second = raw.get("per_second_usd")
    image_usd = raw.get("image_usd", 0.08)
    if per_second is not None and (type(per_second) not in (int, float) or not 0 <= per_second <= 10):
        raise BrollLibraryError("Invalid AI b-roll price")
    if type(image_usd) not in (int, float) or not 0 <= image_usd <= 10:
        raise BrollLibraryError("Invalid AI b-roll price")
    return AiSettings(kind, model, max_shots, int(round(seconds)), float(per_second) if per_second is not None else None, float(image_usd))


def validate_broll_config(config: dict, require_enabled: bool = True, require_catalog: bool = True) -> None:
    """The b-roll fields of a bridge request (raises ValueError with a plain message)."""
    source = config.get("broll_source")
    if source is None:
        for key in ("broll_catalog_path", "broll_ai", "broll_ai_dir"):
            if key in config:
                raise ValueError("B-roll settings need a source")
        return
    if source not in SOURCES:
        raise ValueError("Invalid B-roll source")
    if require_enabled and not config.get("broll_enabled"):
        raise ValueError("A B-roll source needs B-roll on")
    if source in ("library", "library_ai"):
        if require_catalog or config.get("broll_catalog_path") is not None:
            try:
                load_catalog(config.get("broll_catalog_path"))
            except BrollLibraryError as error:
                raise ValueError(str(error)) from None
    elif "broll_catalog_path" in config:
        raise ValueError("Only library b-roll uses a catalog")
    if source in ("ai", "library_ai"):
        try:
            parse_ai_settings(config.get("broll_ai"))
        except BrollLibraryError as error:
            raise ValueError(str(error)) from None
        folder = config.get("broll_ai_dir")
        if not isinstance(folder, str) or "\0" in folder or not os.path.isabs(folder) or not os.path.isdir(folder) or os.path.islink(folder):
            raise ValueError("Invalid AI b-roll folder")
    elif "broll_ai" in config or "broll_ai_dir" in config:
        raise ValueError("Only AI b-roll uses AI settings")


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

WORD = re.compile(r"[a-z0-9']{3,}")
STOP = {"the", "and", "you", "your", "that", "this", "with", "for", "are", "was", "but", "not", "have", "just", "what", "when",
        "they", "them", "then", "there", "their", "from", "about", "like", "really", "going", "gonna", "it's", "i'm", "don't",
        "can", "get", "got", "all", "one", "out", "into", "would", "could", "should", "because", "some", "know", "think"}


def _words(text: str) -> set[str]:
    return {w.rstrip("'s") for w in WORD.findall(text.lower()) if w not in STOP}


def _overlap(shot: CatalogShot, words: set[str]) -> float:
    shot_words = _words(f"{shot.description} {' '.join(shot.tags)} {shot.shot_type}")
    return len(shot_words & words) / (1 + 0.15 * len(shot_words))


def shortlist(catalog: list[CatalogShot], text: str, limit: int = SHORTLIST) -> list[CatalogShot]:
    """The shots most likely to match: best keyword overlap first, a few of the member always in."""
    if len(catalog) <= limit:
        return list(catalog)
    words = _words(text)
    ranked = sorted(catalog, key=lambda shot: -_overlap(shot, words))
    picked = ranked[: limit - SHORTLIST_ME]
    ids = {shot.id for shot in picked}
    picked += [shot for shot in ranked if shot.me and shot.id not in ids][:SHORTLIST_ME]
    ids = {shot.id for shot in picked}
    picked += [shot for shot in ranked if shot.id not in ids][: limit - len(picked)]
    return picked


LIBRARY_PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["shots"],
    "properties": {
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["start", "end", "shot_id", "source_start", "ai_prompt"],
                "properties": {
                    "start": {"type": "number", "description": "Seconds from the clip start."},
                    "end": {"type": "number", "description": "Seconds from the clip start."},
                    "shot_id": {"type": "string", "description": "A shot id from the library list, or empty."},
                    "source_start": {"type": "number", "description": "Seconds into that shot to start from (0 for its start)."},
                    "ai_prompt": {"type": "string", "description": "Only when no library shot fits and AI shots are allowed: what the new shot shows. Otherwise empty."},
                },
            },
        },
    },
}


def library_system_prompt(allow_ai: bool, max_ai: int) -> str:
    ai = (f"""- When nothing in the library fits a moment that clearly needs a visual, you may ask for a new AI shot instead: leave shot_id empty and write ai_prompt, one concrete visual sentence (objects, place, action, light). No text, logos, brand names or real people. At most {max_ai} AI shots.
""" if allow_ai and max_ai > 0 else "- Never write ai_prompt; leave it empty.\n")
    return f"""You are a short-form video editor placing b-roll from the creator's own footage library over what they say.

You get the clip transcript with timestamps (seconds from the clip start) and a list of library shots: id | length | shot type | flags | what is in it [tags]. "me" means the creator is in it; "ai" means it was made with AI.

Pick b-roll only where a shot really matches what is being said at that moment, literally or as a clear visual for it. It is fine to leave moments without b-roll: the creator stays on screen there.
- Each b-roll moment is 1.5 to 5 seconds, starts and ends on a phrase, and never overlaps another.
- Only cover from the given start time to the end.
- Use each shot id at most once.
- Prefer shots where the creator appears ("me") for personal moments (their story, their routine, "I", "my").
- source_start: where in the shot to begin, so the best part shows; the shot must be long enough for the moment.
{ai}Return JSON only."""


def normalize_library_plan(raw: Any, catalog: dict[str, CatalogShot], start_ms: int, end_ms: int, cover_from_ms: int,
                           allow_ai: bool = False, max_ai: int = 0, allow_reuse: Optional[bool] = None) -> list[PlannedShot]:
    """Check the planner's picks: known shots only, inside [cover_from, end), 1.5-5 s, no overlaps,
    long enough in the source, no shot twice (unless the library is tiny), at most max_ai AI shots."""
    reuse = len(catalog) < TINY_LIBRARY if allow_reuse is None else allow_reuse
    picks: list[PlannedShot] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            s = start_ms + int(float(item["start"]) * 1000)
            e = start_ms + int(float(item["end"]) * 1000)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        s, e = max(s, cover_from_ms), min(e, end_ms)
        if e - s < MIN_SHOT_MS:
            continue
        e = min(e, s + MAX_SHOT_MS)
        shot_id = item.get("shot_id") if isinstance(item.get("shot_id"), str) else ""
        prompt = _text(item.get("ai_prompt"), 300)
        try:
            source = float(item.get("source_start") or 0.0)
        except (TypeError, ValueError, OverflowError):
            source = 0.0
        if shot_id in catalog:
            picks.append(PlannedShot(s, e, shot_id=shot_id, source_s=source if math.isfinite(source) else 0.0))
        elif allow_ai and prompt and len(prompt) >= 8:
            picks.append(PlannedShot(s, e, ai_prompt=prompt))
    picks.sort(key=lambda shot: shot.start_ms)

    result: list[PlannedShot] = []
    used: set[str] = set()
    ai_count = 0
    cursor = cover_from_ms
    for shot in picks:
        if shot.start_ms < cursor:
            shot.start_ms = cursor
        if shot.end_ms - shot.start_ms < MIN_SHOT_MS:
            continue
        if shot.shot_id:
            entry = catalog[shot.shot_id]
            if shot.shot_id in used and not reuse:
                continue
            if entry.kind == "video":
                length = shot.end_ms - shot.start_ms
                available_ms = int(entry.seconds * 1000)
                if available_ms < MIN_SHOT_MS:
                    continue
                if length > available_ms:
                    shot.end_ms = shot.start_ms + available_ms
                    length = available_ms
                # source_s is seconds into the shot: kept inside it, leaving room for the whole moment.
                room = max(0.0, entry.seconds - length / 1000)
                shot.source_s = round(entry.in_s + min(max(0.0, shot.source_s), room), 3)
            else:
                shot.source_s = 0.0
            used.add(shot.shot_id)
        else:
            if ai_count >= max_ai:
                continue
            ai_count += 1
        result.append(shot)
        cursor = shot.end_ms
        if len(result) >= MAX_SHOTS:
            break
    return result


def match_locally(segments: list[TranscriptSegment], catalog: list[CatalogShot], start_ms: int, end_ms: int,
                  cover_from_ms: int, allow_reuse: Optional[bool] = None) -> list[PlannedShot]:
    """Without the planner: each phrase gets the shot whose words overlap it most (when any do)."""
    by_id = {shot.id: shot for shot in catalog}
    raw: list[dict] = []
    used: set[str] = set()
    for line in transcript_lines(segments, start_ms, end_ms).splitlines():
        match = re.match(r"\[([0-9.]+)-([0-9.]+)\] (.*)", line)
        if not match:
            continue
        a, b, text = float(match.group(1)), float(match.group(2)), match.group(3)
        words = _words(text)
        best = max((shot for shot in catalog if shot.id not in used), key=lambda shot: _overlap(shot, words), default=None)
        if best is None or _overlap(best, words) <= 0:
            continue
        used.add(best.id)
        raw.append({"start": a, "end": min(b, a + MAX_SHOT_MS / 1000), "shot_id": best.id, "source_start": 0.0, "ai_prompt": ""})
    return normalize_library_plan(raw, by_id, start_ms, end_ms, cover_from_ms, allow_reuse=allow_reuse)


def match_beats(catalog: list[CatalogShot], texts: list[str], allow_reuse: Optional[bool] = None) -> list[Optional[CatalogShot]]:
    """For a list of beats (a voice-over line and its visual idea each), the library shot whose words overlap most,
    or None. A shot is used once unless the library is tiny."""
    reuse = len(catalog) < TINY_LIBRARY if allow_reuse is None else allow_reuse
    used: set[str] = set()
    picks: list[Optional[CatalogShot]] = []
    for text in texts:
        words = _words(text)
        options = [shot for shot in catalog if reuse or shot.id not in used]
        best = max(options, key=lambda shot: _overlap(shot, words), default=None)
        if best is None or _overlap(best, words) <= 0 or (best.kind == "video" and best.seconds * 1000 < MIN_SHOT_MS):
            picks.append(None)
            continue
        used.add(best.id)
        picks.append(best)
    return picks


def _client(settings: Settings, title: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.openrouter_base_url, timeout=httpx.Timeout(120.0, connect=30.0),
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}", "HTTP-Referer": "https://github.com/trentrichards34/bridgeclip", "X-Title": title},
    )


async def match_library_to_transcript(
    transcript: list[TranscriptSegment],
    catalog: list[CatalogShot],
    start_ms: int,
    end_ms: int,
    cover_from_ms: Optional[int] = None,
    allow_ai: bool = False,
    max_ai: int = 0,
    settings: Optional[Settings] = None,
    client: Optional[httpx.AsyncClient] = None,
    allow_reuse: Optional[bool] = None,
) -> tuple[list[PlannedShot], float]:
    """Pick library shots (and AI prompts for gaps, when allowed) for what is said in [start, end) of a timeline.

    Works on any timeline: one clip (Create) or a whole voiceover (the B-roll video maker). Returns the checked plan
    and what the planning call cost. Falls back to keyword matching when the planner can't answer.
    """
    settings = settings or get_settings()
    cover_from = start_ms if cover_from_ms is None else max(start_ms, min(end_ms, cover_from_ms))
    if end_ms - cover_from < MIN_SHOT_MS or (not catalog and not (allow_ai and max_ai > 0)):
        return [], 0.0
    lines = transcript_lines(transcript, start_ms, end_ms)
    if not lines:
        return [], 0.0
    if not settings.openrouter_api_key:
        return match_locally(transcript, catalog, start_ms, end_ms, cover_from, allow_reuse), 0.0
    options = shortlist(catalog, lines)
    library = "\n".join(shot.line() for shot in options) or "(empty)"
    payload: dict[str, Any] = {
        "model": settings.broll_model,
        "messages": [
            {"role": "system", "content": library_system_prompt(allow_ai, max_ai)},
            {"role": "user", "content": (
                f"Clip length: {(end_ms - start_ms) / 1000:.1f} s. Cover from {(cover_from - start_ms) / 1000:.1f} s to the end.\n\n"
                f"Library shots:\n{library}\n\nTranscript:\n{lines}"
            )},
        ],
        "max_tokens": 3000,
        "temperature": 0.3,
        "response_format": json_schema_format("broll_library_plan", LIBRARY_PLAN_SCHEMA),
        "plugins": [{"id": "response-healing"}],
        "provider": {"require_parameters": True},
        "usage": {"include": True},
    }
    fallbacks = settings.get_broll_fallback_models()
    if fallbacks:
        payload["models"] = fallbacks
    owns = client is None
    client = client or _client(settings, "CreatorClips B-roll")
    try:
        body, _ = await chat_completion(client, payload)
        content, _ = message_text(body)
        data = json.loads(content or "{}")
        cost = (body.get("usage") or {}).get("cost")
        cost = float(cost) if isinstance(cost, (int, float)) and math.isfinite(cost) and cost > 0 else 0.0
    except (OpenRouterError, ValueError, TypeError) as exc:
        logger.warning(f"Library b-roll planning failed; matching by keywords instead: {exc}")
        return match_locally(transcript, catalog, start_ms, end_ms, cover_from, allow_reuse), 0.0
    finally:
        if owns:
            await client.aclose()
    by_id = {shot.id: shot for shot in options}
    plan = normalize_library_plan(data.get("shots") if isinstance(data, dict) else [], by_id, start_ms, end_ms, cover_from,
                                  allow_ai, max_ai, allow_reuse if allow_reuse is not None else len(catalog) < TINY_LIBRARY)
    for shot in plan:
        shot.path = by_id[shot.shot_id].path if shot.shot_id else None
    return plan, cost


# ---------------------------------------------------------------------------
# Making the shots: conform library footage, make AI shots
# ---------------------------------------------------------------------------

_ENCODER: Optional[list[str]] = None


def encoder_args() -> list[str]:
    """An H.264 encoder this FFmpeg has (the app's LGPL build has OpenH264 or VideoToolbox, not x264)."""
    global _ENCODER
    if _ENCODER is None:
        try:
            encoders = run_media(["ffmpeg", "-hide_banner", "-encoders"], timeout=20, check=True).stdout.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - the encode itself reports a missing FFmpeg
            encoders = ""
        if re.search(r"\blibx264\b", encoders):
            _ENCODER = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        elif re.search(r"\blibopenh264\b", encoders):
            _ENCODER = ["-c:v", "libopenh264", "-b:v", "8M"]
        elif sys.platform == "darwin" and re.search(r"\bh264_videotoolbox\b", encoders):
            _ENCODER = ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "8M"]
        else:
            _ENCODER = ["-c:v", "mpeg4", "-q:v", "3"]
    return _ENCODER


def _ffmpeg(args: list[str], timeout: float = 600) -> None:
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout=timeout)
    if result.returncode != 0:
        raise BrollLibraryError("A b-roll shot could not be prepared.")


VIDEO_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts"]
IMAGE_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-f", "image2"]


def push_in_filter(width: int, height: int, frames: int) -> str:
    """A slow push-in on a still, covering the frame."""
    return (f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},scale={width * 2}:{height * 2},"
            f"zoompan=z='min(1+0.0015*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={width}x{height}:fps=30,format=yuv420p")


def conform_shot(source: str, kind: str, source_s: float, seconds: float, out_path: str, width: int, height: int) -> str:
    """One shot ready to overlay: cover-cropped to width x height, `seconds` long from `source_s`, 30 fps, no sound."""
    seconds = max(0.5, min(seconds, 30.0))
    if kind == "image":
        frames = max(1, round(seconds * 30))
        _ffmpeg([*IMAGE_GUARD, "-i", source, "-filter_complex", push_in_filter(width, height, frames), "-frames:v", str(frames), "-an",
                 *encoder_args(), "-pix_fmt", "yuv420p", out_path])
    else:
        _ffmpeg([*VIDEO_GUARD, "-ss", f"{max(0.0, source_s):.3f}", "-i", source, "-t", f"{seconds:.3f}", "-map", "0:v:0", "-an", "-sn",
                 "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,crop={width}:{height},fps=30,setsar=1,format=yuv420p",
                 *encoder_args(), out_path])
    if not os.path.isfile(out_path) or os.path.getsize(out_path) == 0:
        raise BrollLibraryError("A b-roll shot could not be prepared.")
    return out_path


def ai_prompt(prompt: str) -> str:
    subject = _text(prompt, 400).replace('"', "")
    return f"{subject}. {AI_PROMPT_RULES}"


class AiShotMaker:
    """AI b-roll on OpenRouter with the member's key: POST /videos (polled, then downloaded) or POST /images + a push-in."""

    def __init__(self, settings: Settings, ai: AiSettings, client: Optional[httpx.AsyncClient] = None, poll_seconds: float = AI_POLL_SECONDS):
        self.ai = ai
        self.base = settings.openrouter_base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=30.0), follow_redirects=False,
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}", "HTTP-Referer": "https://github.com/trentrichards34/bridgeclip",
                     "X-Title": "CreatorClips B-roll"},
        )
        self._owns = client is None
        self.poll_seconds = poll_seconds
        self.cost_usd = 0.0

    async def aclose(self) -> None:
        if self._owns:
            await self._client.aclose()

    def video_request(self, prompt: str) -> dict:
        return {"model": self.ai.model, "prompt": ai_prompt(prompt), "aspect_ratio": "9:16", "resolution": "720p",
                "duration": self.ai.seconds, "generate_audio": False}

    def image_request(self, prompt: str) -> dict:
        return {"model": self.ai.model, "prompt": ai_prompt(prompt), "aspect_ratio": "9:16"}

    @staticmethod
    def _cost(body: dict) -> Optional[float]:
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        cost = usage.get("cost")
        return float(cost) if isinstance(cost, (int, float)) and math.isfinite(cost) and cost >= 0 else None

    async def make(self, prompt: str, out_path: str) -> str:
        """Make one shot (an MP4 with no sound) at out_path. Raises BrollLibraryError."""
        if self.ai.kind == "image":
            return await self._image(prompt, out_path)
        return await self._video(prompt, out_path)

    async def _video(self, prompt: str, out_path: str) -> str:
        try:
            response = await self._client.post(f"{self.base}/videos", json=self.video_request(prompt))
        except (httpx.TimeoutException, httpx.TransportError):
            raise BrollLibraryError("OpenRouter could not be reached for an AI b-roll shot.") from None
        if response.status_code not in (200, 201, 202):
            raise self._error(response.status_code)
        job = self._json(response)
        job_id = job.get("id")
        if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{1,128}", job_id):
            raise BrollLibraryError("OpenRouter returned an invalid video job.")
        deadline = time.monotonic() + AI_TIMEOUT_SECONDS
        status = job
        while str(status.get("status", "pending")).lower() in ("pending", "queued", "in_progress", "processing", "running", "starting"):
            if time.monotonic() > deadline:
                raise BrollLibraryError("An AI b-roll shot took too long on OpenRouter.")
            await asyncio.sleep(self.poll_seconds)
            try:
                poll = await self._client.get(f"{self.base}/videos/{job_id}")
            except (httpx.TimeoutException, httpx.TransportError):
                continue
            if poll.status_code != 200:
                if poll.status_code in (401, 402, 403):
                    raise self._error(poll.status_code)
                continue
            try:
                status = self._json(poll)
            except BrollLibraryError:
                continue
        if str(status.get("status", "")).lower() != "completed":
            raise BrollLibraryError("An AI b-roll shot could not be made on OpenRouter.")
        cost = self._cost(status)
        # Paid once the job completed, even if the download fails.
        self.cost_usd += cost if cost is not None else self.ai.estimate_usd()
        await self._download(f"{self.base}/videos/{job_id}/content", out_path)
        return out_path

    async def _download(self, url: str, out_path: str) -> None:
        async with self._client.stream("GET", url, params={"index": 0}) as content:
            if content.status_code in (301, 302, 303, 307, 308):
                location = content.headers.get("location", "")
                if not location.startswith("https://"):
                    raise BrollLibraryError("An AI b-roll shot could not be downloaded.")
                from clip_engine.network_policy import public_source_url
                if not await asyncio.to_thread(public_source_url, location):
                    raise BrollLibraryError("An AI b-roll shot could not be downloaded.")
                async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0), follow_redirects=False) as plain:
                    async with plain.stream("GET", location) as hop:
                        if hop.status_code != 200:
                            raise BrollLibraryError("An AI b-roll shot could not be downloaded.")
                        await self._save(hop, out_path)
                return
            if content.status_code != 200:
                raise BrollLibraryError("An AI b-roll shot could not be downloaded.")
            await self._save(content, out_path)

    @staticmethod
    async def _save(response: httpx.Response, out_path: str) -> None:
        size = 0
        partial = f"{out_path}.part"
        try:
            with open(partial, "wb") as handle:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_AI_VIDEO_BYTES:
                        raise BrollLibraryError("An AI b-roll shot was unexpectedly large.")
                    handle.write(chunk)
            if size == 0:
                raise BrollLibraryError("OpenRouter returned an empty AI b-roll shot.")
            os.replace(partial, out_path)
        finally:
            if os.path.exists(partial):
                os.remove(partial)

    async def _image(self, prompt: str, out_path: str) -> str:
        try:
            response = await self._client.post(f"{self.base}/images", json=self.image_request(prompt))
        except (httpx.TimeoutException, httpx.TransportError):
            raise BrollLibraryError("OpenRouter could not be reached for an AI b-roll picture.") from None
        if response.status_code != 200:
            raise self._error(response.status_code)
        body = self._json(response)
        cost = self._cost(body)
        self.cost_usd += cost if cost is not None else self.ai.image_usd
        first = (body.get("data") or [{}])[0] if isinstance(body.get("data"), list) else {}
        data = first.get("b64_json") if isinstance(first, dict) else None
        if not isinstance(data, str) or not data:
            raise BrollLibraryError("OpenRouter returned no picture for an AI b-roll shot.")
        try:
            raw = base64.b64decode(data, validate=False)
        except ValueError:
            raise BrollLibraryError("OpenRouter returned an unreadable picture.") from None
        if not raw or len(raw) > 30 * 1024 * 1024:
            raise BrollLibraryError("OpenRouter returned an unreadable picture.")
        still = f"{out_path}.png"
        try:
            with open(still, "wb") as handle:
                handle.write(raw)
            await asyncio.to_thread(conform_shot, still, "image", 0.0, float(self.ai.seconds), out_path, 1080, 1920)
        finally:
            if os.path.exists(still):
                os.remove(still)
        return out_path

    @staticmethod
    def _json(response: httpx.Response) -> dict:
        try:
            body = response.json()
        except ValueError:
            raise BrollLibraryError("OpenRouter returned an unreadable reply.") from None
        if not isinstance(body, dict):
            raise BrollLibraryError("OpenRouter returned an unexpected reply.")
        return body

    @staticmethod
    def _error(status: int) -> BrollLibraryError:
        if status in (401, 403):
            return BrollLibraryError("OpenRouter rejected the API key. Check it in Settings.")
        if status == 402:
            return BrollLibraryError("OpenRouter reports insufficient credits. Add credits at openrouter.ai/credits.")
        return BrollLibraryError(f"OpenRouter could not make an AI b-roll shot ({status}).")


def save_for_library(video: str, prompt: str, model: str, folder: str) -> Optional[str]:
    """Copy an AI shot into the library's incoming folder (the video, then its details last). None if it can't."""
    try:
        name = f"ai-{secrets.token_hex(8)}"
        target = os.path.join(folder, f"{name}.mp4")
        partial = os.path.join(folder, f".{name}.mp4.part")
        shutil.copyfile(video, partial)
        os.replace(partial, target)
        details = os.path.join(folder, f".{name}.json.part")
        with open(details, "w", encoding="utf-8") as handle:
            json.dump({"prompt": _text(prompt, 600), "model": _text(model, 120)}, handle)
        os.replace(details, os.path.join(folder, f"{name}.json"))
        return target
    except OSError as error:
        logger.warning(f"An AI b-roll shot could not be saved to the library: {error}")
        return None


async def make_shots(plan: list[PlannedShot], catalog: dict[str, CatalogShot], work_dir: str, width: int, height: int,
                     ai: Optional[AiSettings] = None, ai_dir: Optional[str] = None, settings: Optional[Settings] = None,
                     maker: Optional[AiShotMaker] = None) -> MadeShots:
    """Turn a plan into files to overlay. A shot that fails is left out (the speaker shows there)."""
    os.makedirs(work_dir, exist_ok=True)
    made = MadeShots()
    owns = maker is None and ai is not None and any(shot.ai_prompt for shot in plan)
    if owns:
        maker = AiShotMaker(settings or get_settings(), ai)  # type: ignore[arg-type]
    ai_on = maker is not None
    try:
        for k, shot in enumerate(plan):
            seconds = (shot.end_ms - shot.start_ms) / 1000 + 0.2
            out = os.path.join(work_dir, f"library-{k:02d}-{secrets.token_hex(3)}.mp4")
            try:
                if shot.shot_id and shot.shot_id in catalog:
                    entry = catalog[shot.shot_id]
                    await asyncio.to_thread(conform_shot, entry.path, entry.kind, shot.source_s, seconds, out, width, height)
                    made.library_used += 1
                elif shot.ai_prompt and maker is not None and ai_on:
                    raw = os.path.join(work_dir, f"ai-{k:02d}-{secrets.token_hex(3)}.mp4")
                    await maker.make(shot.ai_prompt, raw)
                    if ai_dir:
                        await asyncio.to_thread(save_for_library, raw, shot.ai_prompt, maker.ai.model, ai_dir)
                    await asyncio.to_thread(conform_shot, raw, "video", 0.0, seconds, out, width, height)
                    made.ai_made += 1
                else:
                    continue
            except BrollLibraryError as error:
                logger.warning(f"A b-roll shot was left out: {error}")
                if "API key" in str(error) or "credits" in str(error):
                    made.warnings.append(str(error))
                    ai_on = False  # no more AI shots this clip (what was already made is still counted below)
                continue
            except (OSError, httpx.HTTPError, subprocess.SubprocessError) as error:
                # A dropped download or a full disk loses this shot only: the run's costs so far are still returned.
                logger.warning(f"A b-roll shot was left out: {error}")
                continue
            made.shots.append(BrollShot(shot.start_ms, shot.end_ms, shot.shot_id or "ai", out))
    finally:
        if maker is not None:
            made.cost_usd += maker.cost_usd
        if owns and maker is not None:
            await maker.aclose()
    return made


async def prepare_library_broll(
    transcript: list[TranscriptSegment],
    start_ms: int,
    end_ms: int,
    work_dir: str,
    portrait: bool,
    source: str,
    catalog: list[CatalogShot],
    ai: Optional[AiSettings] = None,
    ai_dir: Optional[str] = None,
    keep_hook: bool = True,
    hook_hold_ms: int = 3000,
    settings: Optional[Settings] = None,
) -> MadeShots:
    """B-roll for one clip from the library (and AI for gaps, or AI only). Costs come back in MadeShots.cost_usd."""
    settings = settings or get_settings()
    use_library = source in ("library", "library_ai")
    allow_ai = source in ("ai", "library_ai") and ai is not None and ai.max_shots > 0
    shots = catalog if use_library else []
    cover_from = start_ms + (hook_hold_ms if keep_hook else 0)
    plan, cost = await match_library_to_transcript(transcript, shots, start_ms, end_ms, cover_from, allow_ai, ai.max_shots if ai and allow_ai else 0, settings)
    width, height = (1080, 1920) if portrait else (1920, 1080)
    made = await make_shots(plan, {shot.id: shot for shot in shots}, work_dir, width, height, ai if allow_ai else None, ai_dir, settings)
    made.cost_usd += cost
    return made


# ---------------------------------------------------------------------------
# A finished timeline (Edit my recording, the B-roll video maker): plan, make and lay the shots over it
# ---------------------------------------------------------------------------

# The speaker stays on screen for the hook, and for the last moments (the call to action).
HOOK_HOLD_MS = 3000
TAIL_HOLD_MS = 1500


def timeline_segments(timed: list) -> list[TranscriptSegment]:
    """Words on the reel's clock ([text, start_ms, end_ms, ...]) as one transcript segment."""
    from clip_engine.services.transcription_service import TranscriptWord
    words = [TranscriptWord(str(t[0]), int(t[1]), int(t[2])) for t in timed
             if isinstance(t, (list, tuple)) and len(t) >= 3 and type(t[1]) in (int, float) and type(t[2]) in (int, float) and t[2] >= t[1]]
    if not words:
        return []
    return [TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, " ".join(w.word for w in words), words=words)]


def overlay_shots(base: str, shots: list[BrollShot], out: str) -> str:
    """Lay each shot over `base` (full frame) during its window; the sound stays as it is."""
    inputs: list[str] = []
    parts: list[str] = []
    current = "[0:v]"
    for k, shot in enumerate(shots):
        a, b = shot.start_ms / 1000, shot.end_ms / 1000
        inputs += [*VIDEO_GUARD, "-i", shot.path]
        parts.append(f"[{k + 1}:v]setpts=PTS-STARTPTS+{a:.3f}/TB[s{k}]")
        parts.append(f"{current}[s{k}]overlay=0:0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[v{k}]")
        current = f"[v{k}]"
    _ffmpeg([*VIDEO_GUARD, "-i", base, *inputs, "-filter_complex", ";".join(parts) + f";{current}format=yuv420p[out]",
             "-map", "[out]", "-map", "0:a?", "-c:a", "copy", *encoder_args(), "-movflags", "+faststart", out], timeout=1800)
    return out


async def overlay_reel_broll(base: str, timed: list, total_s: float, config: dict, work: str, warnings: list[str],
                             settings: Optional[Settings] = None, width: int = 1080, height: int = 1920,
                             placed: Optional[list] = None) -> float:
    """B-roll over a finished reel (in place): never in the first 3 s or the last 1.5 s. Returns what it cost.
    A failure leaves the reel as it was, with a note. `placed` gets each shot's (start_ms, end_ms) once it is in
    (its sound effect cues)."""
    settings = settings or get_settings()
    source = config.get("broll_source")
    if source == "stock":
        return await _stock_over_reel(base, timed, total_s, work, warnings, settings, width, height, placed)
    if source not in ("library", "ai", "library_ai"):
        return 0.0
    try:
        catalog = load_catalog(config["broll_catalog_path"]) if source != "ai" and config.get("broll_catalog_path") else []
    except BrollLibraryError as error:
        warnings.append(f"{error} The reel was made without b-roll.")
        return 0.0
    ai = parse_ai_settings(config["broll_ai"]) if source != "library" and config.get("broll_ai") else None
    allow_ai = ai is not None and ai.max_shots > 0
    total_ms = int(total_s * 1000)
    end_ms = max(0, total_ms - TAIL_HOLD_MS)
    plan, cost = await match_library_to_transcript(timeline_segments(timed), catalog, 0, end_ms, HOOK_HOLD_MS, allow_ai,
                                                   ai.max_shots if allow_ai and ai else 0, settings)
    if not plan:
        warnings.append("No b-roll matched what you said, so the reel shows you throughout.")
        return cost
    made = await make_shots(plan, {shot.id: shot for shot in catalog}, os.path.join(work, "broll"), width, height,
                            ai if allow_ai else None, config.get("broll_ai_dir"), settings)
    warnings.extend(made.warnings)
    cost += made.cost_usd
    if not made.shots:
        return cost
    out = f"{base}.broll.mp4"
    try:
        await asyncio.to_thread(overlay_shots, base, made.shots, out)
        os.replace(out, base)
        if placed is not None:
            placed.extend((shot.start_ms, shot.end_ms) for shot in made.shots)
    except (BrollLibraryError, OSError) as error:
        logger.warning(f"B-roll could not be laid over the reel: {error}")
        warnings.append("The b-roll could not be added, so the reel shows you throughout.")
        if os.path.exists(out):
            os.remove(out)
    return cost


async def _stock_over_reel(base: str, timed: list, total_s: float, work: str, warnings: list[str], settings: Settings,
                           width: int, height: int, placed: Optional[list] = None) -> float:
    """Stock footage (Pexels, the member's key) over a finished reel, as Create's B-roll does."""
    from clip_engine.services.broll_service import PexelsClient, PexelsKeyRejected, plan_shots
    key = getattr(settings, "pexels_api_key", None)
    if not key:
        warnings.append("Stock b-roll needs a free Pexels key (Settings → API keys), so the reel shows you throughout.")
        return 0.0
    end_ms = max(0, int(total_s * 1000) - TAIL_HOLD_MS)
    beats = await plan_shots(timeline_segments(timed), 0, end_ms, HOOK_HOLD_MS, settings)
    if not beats:
        return 0.0
    folder = os.path.join(work, "broll")
    try:
        async with PexelsClient(key, folder) as pexels:
            filled = await pexels.fill(beats, portrait=height >= width)
    except PexelsKeyRejected as error:
        warnings.append(str(error))
        return 0.0
    shots: list[BrollShot] = []
    for k, beat in enumerate(filled):
        out = os.path.join(folder, f"stock-{k:02d}.mp4")
        try:
            await asyncio.to_thread(conform_shot, beat.path, "video", 0.0, (beat.end_ms - beat.start_ms) / 1000 + 0.2, out, width, height)
        except BrollLibraryError:
            continue
        shots.append(BrollShot(beat.start_ms, beat.end_ms, beat.query, out))
    if shots:
        out = f"{base}.broll.mp4"
        try:
            await asyncio.to_thread(overlay_shots, base, shots, out)
            os.replace(out, base)
            if placed is not None:
                placed.extend((shot.start_ms, shot.end_ms) for shot in shots)
        except (BrollLibraryError, OSError):
            warnings.append("The b-roll could not be added, so the reel shows you throughout.")
            if os.path.exists(out):
                os.remove(out)
    return 0.0
