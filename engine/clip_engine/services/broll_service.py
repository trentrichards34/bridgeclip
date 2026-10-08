"""
B-roll mode: cover the speaker with stock footage that matches what they say.

1. Plan: a fast model splits the clip into short beats and writes a stock
   footage search for each one (`plan_shots`).
2. Fetch: each search runs against Pexels (free, commercial-use stock video,
   the user's own API key) and the best-fitting file is downloaded once into
   a per-output cache (`PexelsClient`).
3. The renderer overlays each shot full-frame over the speaker's video on the
   output timeline; the speaker's audio, captions and title stay as they are.

The speaker can stay on screen for the opening hook so the first words land
on a face. A shot whose search finds nothing is dropped, which simply shows
the speaker for that beat.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx

from clip_engine.config import Settings, get_settings
from clip_engine.services.openrouter import OpenRouterError, chat_completion, json_schema_format, message_text
from clip_engine.services.transcription_service import TranscriptSegment

logger = logging.getLogger(__name__)

# Beat lengths: long enough to read, short enough to keep the eye moving.
MIN_SHOT_MS = 1500
TARGET_SHOT_MS = 3000
MAX_SHOT_MS = 5000
# The speaker stays on screen this long when the hook is kept.
DEFAULT_HOOK_HOLD_MS = 3000
# Never fetch more than this many shots for one clip.
MAX_SHOTS_PER_CLIP = 40

PEXELS_SEARCH_URL = "https://api.pexels.com/videos/search"
# Footage is only ever downloaded from Pexels' own hosts.
PEXELS_MEDIA_HOSTS = ("pexels.com",)
MAX_BROLL_BYTES = 150 * 1024 * 1024
SAFE_QUERY = re.compile(r"[^A-Za-z0-9 '&-]+")


@dataclass
class BrollShot:
    """One beat of B-roll in source time, and the footage chosen for it."""

    start_ms: int
    end_ms: int
    query: str
    path: Optional[str] = None


BROLL_PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["shots"],
    "properties": {
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["start", "end", "query"],
                "properties": {
                    "start": {"type": "number", "description": "Seconds from the clip start."},
                    "end": {"type": "number", "description": "Seconds from the clip start."},
                    "query": {"type": "string", "description": "2-4 word stock video search."},
                },
            },
        },
    },
}

SYSTEM_PROMPT = """You are a short-form video editor choosing B-roll stock footage.

You get a clip transcript with timestamps in seconds from the clip start. Cover the clip from the given start to its end with back-to-back B-roll shots, each 2 to 4 seconds long, cut where the speaker moves to a new idea or phrase.

For each shot write a stock-footage search query that a stock video site can match:
- 2 to 4 words, concrete and visual: objects, places, actions ("laptop spreadsheet", "cash counting", "city traffic night").
- Show what is being said, literally or by a clear visual metaphor.
- No names of people, brands or logos; no on-screen text; no abstract words like "success" alone.
- Vary the shots; do not repeat a query.

Return JSON only."""


def _clip_words(transcript: list[TranscriptSegment], start_ms: int, end_ms: int) -> list[tuple[int, int, str]]:
    words: list[tuple[int, int, str]] = []
    for segment in transcript:
        if segment.end_time_ms <= start_ms or segment.start_time_ms >= end_ms:
            continue
        if segment.words:
            words.extend((w.start_time_ms, w.end_time_ms, w.word) for w in segment.words
                         if w.end_time_ms > start_ms and w.start_time_ms < end_ms)
        else:
            words.append((segment.start_time_ms, segment.end_time_ms, segment.text))
    return words


def transcript_lines(transcript: list[TranscriptSegment], start_ms: int, end_ms: int) -> str:
    """Timestamped lines (seconds from clip start) of roughly one phrase each."""
    lines, current, line_start = [], [], None
    for w_start, w_end, text in _clip_words(transcript, start_ms, end_ms):
        if line_start is None:
            line_start = w_start
        current.append(text.strip())
        if w_end - line_start >= 2500 or text.rstrip().endswith((".", "?", "!")):
            lines.append(f"[{(line_start - start_ms) / 1000:.1f}-{(w_end - start_ms) / 1000:.1f}] {' '.join(current)}")
            current, line_start = [], None
    if current and line_start is not None:
        lines.append(f"[{(line_start - start_ms) / 1000:.1f}-{(end_ms - start_ms) / 1000:.1f}] {' '.join(current)}")
    return "\n".join(lines)


def clean_query(query: Any) -> Optional[str]:
    if not isinstance(query, str):
        return None
    words = SAFE_QUERY.sub(" ", query).split()
    return " ".join(words[:5]).lower() or None


def normalize_shots(raw: list[dict], start_ms: int, end_ms: int, cover_from_ms: int) -> list[BrollShot]:
    """Clamp, order and tile the model's shots so they cover [cover_from, end) back to back.

    Gaps go to the previous shot, overlong shots are split with the same
    query, and slivers merge into their neighbour.
    """
    shots: list[BrollShot] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        query = clean_query(item.get("query"))
        try:
            s = start_ms + int(float(item["start"]) * 1000)
            e = start_ms + int(float(item["end"]) * 1000)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        s, e = max(s, cover_from_ms), min(e, end_ms)
        if query and e - s > 0:
            shots.append(BrollShot(s, e, query))
    shots.sort(key=lambda shot: shot.start_ms)

    tiled: list[BrollShot] = []
    cursor = cover_from_ms
    for shot in shots:
        if shot.end_ms <= cursor:
            continue
        if tiled and shot.start_ms > cursor:
            tiled[-1].end_ms = shot.start_ms  # close the gap
        shot.start_ms = cursor if not tiled else tiled[-1].end_ms
        if shot.end_ms - shot.start_ms < MIN_SHOT_MS and tiled:
            tiled[-1].end_ms = shot.end_ms
        else:
            tiled.append(shot)
        cursor = tiled[-1].end_ms
    if tiled:
        tiled[-1].end_ms = end_ms
        if tiled[0].start_ms > cover_from_ms:
            tiled[0].start_ms = cover_from_ms

    result: list[BrollShot] = []
    for shot in tiled:
        length = shot.end_ms - shot.start_ms
        pieces = max(1, -(-length // MAX_SHOT_MS))
        step = length // pieces
        for k in range(pieces):
            s = shot.start_ms + k * step
            e = shot.end_ms if k == pieces - 1 else s + step
            result.append(BrollShot(s, e, shot.query))
    if result and result[-1].end_ms - result[-1].start_ms < MIN_SHOT_MS and len(result) > 1:
        result[-2].end_ms = result.pop().end_ms
    return result[:MAX_SHOTS_PER_CLIP]


async def plan_shots(
    transcript: list[TranscriptSegment],
    start_ms: int,
    end_ms: int,
    hook_hold_ms: int = DEFAULT_HOOK_HOLD_MS,
    settings: Optional[Settings] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> list[BrollShot]:
    """Ask the B-roll model for a search per beat. Returns [] when it can't."""
    settings = settings or get_settings()
    cover_from = min(end_ms, start_ms + max(0, hook_hold_ms))
    if end_ms - cover_from < MIN_SHOT_MS or not settings.openrouter_api_key:
        return []
    lines = transcript_lines(transcript, start_ms, end_ms)
    if not lines:
        return []
    payload: dict[str, Any] = {
        "model": settings.broll_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                f"Clip length: {(end_ms - start_ms) / 1000:.1f} s. "
                f"Cover from {(cover_from - start_ms) / 1000:.1f} s to the end.\n\nTranscript:\n{lines}"
            )},
        ],
        "max_tokens": 2000,
        "temperature": 0.4,
        "response_format": json_schema_format("broll_plan", BROLL_PLAN_SCHEMA),
        "plugins": [{"id": "response-healing"}],
        "provider": {"require_parameters": True},
    }
    fallbacks = settings.get_broll_fallback_models()
    if fallbacks:
        payload["models"] = fallbacks
    owns_client = client is None
    client = client or httpx.AsyncClient(
        base_url=settings.openrouter_base_url,
        timeout=httpx.Timeout(120.0, connect=30.0),
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "HTTP-Referer": "https://github.com/trentrichards34/bridgeclip",
            "X-Title": "CreatorClips B-roll",
        },
    )
    try:
        body, _ = await chat_completion(client, payload)
        content, _ = message_text(body)
        data = json.loads(content or "{}")
    except (OpenRouterError, ValueError, TypeError) as exc:
        logger.warning(f"B-roll planning failed; the clip keeps the speaker: {exc}")
        return []
    finally:
        if owns_client:
            await client.aclose()
    return normalize_shots(data.get("shots") if isinstance(data, dict) else [], start_ms, end_ms, cover_from)


def pick_file(video: dict, portrait: bool) -> Optional[dict]:
    """The mp4 rendition closest to (but not much below) 1080 on the short side."""
    best, best_score = None, None
    for item in video.get("video_files") or []:
        if not isinstance(item, dict) or item.get("file_type") != "video/mp4":
            continue
        width, height, link = item.get("width"), item.get("height"), item.get("link")
        if not (isinstance(width, int) and isinstance(height, int) and isinstance(link, str)):
            continue
        if not is_pexels_media(link):
            continue
        short = min(width, height)
        if (height >= width) != portrait and width != height:
            continue
        score = abs(short - 1080) + (400 if short < 720 else 0)
        if best_score is None or score < best_score:
            best, best_score = item, score
    return best


def is_pexels_media(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == h or host.endswith("." + h) for h in PEXELS_MEDIA_HOSTS)


class PexelsClient:
    """Searches Pexels videos and downloads chosen files into `cache_dir`."""

    def __init__(self, api_key: str, cache_dir: str, client: Optional[httpx.AsyncClient] = None):
        self.api_key = api_key
        self.cache_dir = cache_dir
        self._client = client
        self._owns_client = client is None
        self._searches: dict[tuple[str, bool], list[dict]] = {}

    async def __aenter__(self) -> "PexelsClient":
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0), follow_redirects=False)
        return self

    async def __aexit__(self, *_exc) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def search(self, query: str, portrait: bool) -> list[dict]:
        key = (query, portrait)
        if key not in self._searches:
            response = await self._client.get(
                PEXELS_SEARCH_URL,
                params={"query": query, "orientation": "portrait" if portrait else "landscape", "per_page": 8, "size": "medium"},
                headers={"Authorization": self.api_key},
            )
            if response.status_code in (401, 403):
                raise PermissionError("Pexels rejected the API key. Check it in Settings.")
            if response.status_code != 200:
                logger.warning(f"Pexels search failed ({response.status_code}) for a B-roll beat")
                self._searches[key] = []
            else:
                videos = (response.json() or {}).get("videos") or []
                self._searches[key] = [v for v in videos if isinstance(v, dict)]
        return self._searches[key]

    async def download(self, link: str, name: str) -> str:
        if not is_pexels_media(link):
            raise ValueError("B-roll can only come from Pexels")
        os.makedirs(self.cache_dir, exist_ok=True)
        path = os.path.join(self.cache_dir, name)
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
        partial = path + ".part"
        size = 0
        async with self._client.stream("GET", link) as response:
            if response.status_code != 200:
                raise ValueError(f"B-roll download failed ({response.status_code})")
            with open(partial, "wb") as handle:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BROLL_BYTES:
                        raise ValueError("B-roll file is too large")
                    handle.write(chunk)
        os.replace(partial, path)
        return path

    async def fill(self, shots: list[BrollShot], portrait: bool) -> list[BrollShot]:
        """Attach footage to each shot; shots without a match are dropped."""
        used: set[int] = set()
        filled: list[BrollShot] = []
        for shot in shots:
            try:
                videos = await self.search(shot.query, portrait)
            except PermissionError:
                raise
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning(f"B-roll search failed; showing the speaker for that beat: {exc}")
                continue
            choice = next((v for v in videos if v.get("id") not in used and pick_file(v, portrait)), None)
            choice = choice or next((v for v in videos if pick_file(v, portrait)), None)
            if not choice:
                continue
            item = pick_file(choice, portrait)
            digest = hashlib.sha256(item["link"].encode()).hexdigest()[:16]
            try:
                shot.path = await self.download(item["link"], f"pexels-{digest}.mp4")
            except (httpx.HTTPError, ValueError, OSError) as exc:
                logger.warning(f"B-roll download failed; showing the speaker for that beat: {exc}")
                continue
            used.add(choice.get("id"))
            filled.append(shot)
        return filled


async def prepare_broll(
    transcript: list[TranscriptSegment],
    start_ms: int,
    end_ms: int,
    cache_dir: str,
    portrait: bool,
    keep_hook: bool = True,
    settings: Optional[Settings] = None,
) -> list[BrollShot]:
    """Plan and fetch B-roll for one clip. [] means render the clip as usual."""
    settings = settings or get_settings()
    if not settings.pexels_api_key:
        return []
    shots = await plan_shots(transcript, start_ms, end_ms, DEFAULT_HOOK_HOLD_MS if keep_hook else 0, settings)
    if not shots:
        return []
    async with PexelsClient(settings.pexels_api_key, cache_dir) as pexels:
        return await pexels.fill(shots, portrait)
