"""
Hook preview: open a clip with its strongest line, then play it from the start.

A fast model reads the clip and picks one 1.5-4 s line later in the clip
(usually the payoff: the number, the result, the reveal) that makes a viewer
want to see how the speaker gets there. The renderer plays that line first,
then the whole clip. Nothing is picked when no line clearly qualifies.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from clip_engine.config import Settings, get_settings
from clip_engine.services.broll_service import _clip_words, transcript_lines
from clip_engine.services.openrouter import OpenRouterError, chat_completion, json_schema_format, message_text
from clip_engine.services.transcription_service import TranscriptSegment

logger = logging.getLogger(__name__)

MIN_TEASER_MS = 1500
MAX_TEASER_MS = 4000
# The teaser must come from later in the clip than its opening hook.
MIN_TEASER_START_MS = 3000
# Short clips gain nothing from a preview.
MIN_CLIP_MS = 12_000
# Snap tolerance when matching the model's times to word boundaries.
SNAP_MS = 250

TEASER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["use_teaser", "start", "end", "reason"],
    "properties": {
        "use_teaser": {"type": "boolean"},
        "start": {"type": "number", "description": "Seconds from the clip start."},
        "end": {"type": "number", "description": "Seconds from the clip start."},
        "reason": {"type": "string"},
    },
}

SYSTEM_PROMPT = """You are a short-form video editor adding a "hook preview": the clip opens with its single most compelling line, then plays from the beginning.

Pick ONE line from the transcript that:
- is 1.5 to 4 seconds long and is a complete phrase on its own,
- comes at least 3 seconds after the clip start (the clip already opens on its hook),
- is the payoff or the most gripping moment: a specific number or result, a reveal, a surprising admission, the punchline,
- makes a viewer want to watch the clip to see how the speaker gets there, without giving away the whole point.

If no line clearly qualifies, set use_teaser to false. Times are seconds from the clip start. Return JSON only."""


def snap_to_words(
    transcript: list[TranscriptSegment], clip_start_ms: int, clip_end_ms: int, start_ms: int, end_ms: int,
) -> Optional[tuple[int, int]]:
    """Move a rough span onto whole words; None if it doesn't make a usable teaser."""
    words = [(s, e) for s, e, _ in _clip_words(transcript, clip_start_ms, clip_end_ms)]
    inside = [(s, e) for s, e in words if s >= start_ms - SNAP_MS and e <= end_ms + SNAP_MS]
    if not inside:
        return None
    start, end = inside[0][0], inside[-1][1]
    while end - start > MAX_TEASER_MS and len(inside) > 1:
        inside.pop()
        end = inside[-1][1]
    if end - start < MIN_TEASER_MS or start - clip_start_ms < MIN_TEASER_START_MS:
        return None
    # A little air either side so the line doesn't clip a syllable.
    return max(clip_start_ms, start - 80), min(clip_end_ms, end + 120)


async def pick_teaser(
    transcript: list[TranscriptSegment],
    clip_start_ms: int,
    clip_end_ms: int,
    settings: Optional[Settings] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> Optional[tuple[int, int]]:
    """The teaser span in source ms, or None."""
    settings = settings or get_settings()
    if clip_end_ms - clip_start_ms < MIN_CLIP_MS or not settings.openrouter_api_key:
        return None
    lines = transcript_lines(transcript, clip_start_ms, clip_end_ms)
    if not lines:
        return None
    payload: dict[str, Any] = {
        "model": settings.broll_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Clip length: {(clip_end_ms - clip_start_ms) / 1000:.1f} s.\n\nTranscript:\n{lines}"},
        ],
        "max_tokens": 600,
        "temperature": 0.2,
        "response_format": json_schema_format("hook_preview", TEASER_SCHEMA),
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
            "X-Title": "CreatorClips hook preview",
        },
    )
    try:
        body, _ = await chat_completion(client, payload)
        content, _ = message_text(body)
        data = json.loads(content or "{}")
    except (OpenRouterError, ValueError, TypeError) as exc:
        logger.warning(f"Hook preview skipped: {exc}")
        return None
    finally:
        if owns_client:
            await client.aclose()
    if not isinstance(data, dict) or data.get("use_teaser") is not True:
        return None
    try:
        start = clip_start_ms + int(float(data["start"]) * 1000)
        end = clip_start_ms + int(float(data["end"]) * 1000)
    except (KeyError, TypeError, ValueError, OverflowError):
        return None
    return snap_to_words(transcript, clip_start_ms, clip_end_ms, start, end)
