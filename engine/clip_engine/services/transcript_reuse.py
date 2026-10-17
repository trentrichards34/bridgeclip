"""
"More clips from this video": reuse a finished run's saved transcript so the
new run pays for no transcription.

The saved transcript is used only when it belongs to the same video: the
same source (the app passes the earlier run's link or file) and, when the
earlier run recorded them, the same duration and the same file fingerprint
(local files and kept copies are compared byte for byte at the start and
end; a link that is downloaded again can differ in bytes, so links are
matched by duration).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Optional

from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord

logger = logging.getLogger(__name__)

MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024
FINGERPRINT_CHUNK = 1024 * 1024
# Re-downloads of the same video can differ by a frame or two.
DURATION_TOLERANCE_SECONDS = 1.5


def source_fingerprint(path: str) -> Optional[str]:
    """A quick file fingerprint: size plus the first and last megabyte (None if unreadable)."""
    try:
        size = os.path.getsize(path)
        digest = hashlib.sha256(str(size).encode())
        with open(path, "rb") as f:
            digest.update(f.read(FINGERPRINT_CHUNK))
            if size > FINGERPRINT_CHUNK:
                f.seek(max(FINGERPRINT_CHUNK, size - FINGERPRINT_CHUNK))
                digest.update(f.read(FINGERPRINT_CHUNK))
        return digest.hexdigest()
    except (OSError, TypeError, ValueError):
        return None


def _int(value: Any) -> Optional[int]:
    return int(value) if type(value) in (int, float) and value >= 0 else None


def _segment(raw: Any) -> Optional[TranscriptSegment]:
    if not isinstance(raw, dict) or not isinstance(raw.get("text"), str):
        return None
    start, end = _int(raw.get("start_time_ms")), _int(raw.get("end_time_ms"))
    if start is None or end is None or end < start:
        return None
    words = []
    for item in raw.get("words") or []:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str):
            continue
        ws, we = _int(item.get("start_time_ms")), _int(item.get("end_time_ms"))
        if ws is not None and we is not None and we >= ws:
            words.append(TranscriptWord(word=item["word"], start_time_ms=ws, end_time_ms=we))
    speaker = raw.get("speaker_label")
    events = [e for e in raw.get("audio_events") or [] if isinstance(e, str)][:20]
    return TranscriptSegment(start_time_ms=start, end_time_ms=end, text=raw["text"],
                             speaker_label=speaker if isinstance(speaker, str) else None, words=words, audio_events=events)


def load_saved_transcript(path: str) -> Optional[dict]:
    """The saved transcript.json as {result, status, fingerprint, duration}, or None if unusable."""
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_TRANSCRIPT_BYTES:
            return None
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError, UnicodeError, RecursionError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("segments"), list):
        return None
    status = data.get("status", "available")
    if status not in ("available", "no_speech"):
        return None
    segments = [segment for segment in map(_segment, data["segments"]) if segment]
    if len(segments) != len(data["segments"]):
        return None
    language = data.get("language")
    result = TranscriptionResult(
        segments=segments,
        full_text=data["full_text"] if isinstance(data.get("full_text"), str) else " ".join(s.text for s in segments),
        language=language if isinstance(language, str) else None,
        provider="reused", model="saved transcript",
    )
    duration = data.get("source_duration_seconds")
    fingerprint = data.get("source_fingerprint")
    return {
        "result": result, "status": "available" if segments else "no_speech",
        "fingerprint": fingerprint if isinstance(fingerprint, str) else None,
        "duration": float(duration) if type(duration) in (int, float) and duration > 0 else None,
        "range": data.get("transcribed_range") if isinstance(data.get("transcribed_range"), list) else None,
    }


def reusable_transcript(saved: Optional[dict], video_path: str, duration_seconds: float,
                        expected_duration_seconds: Optional[float] = None,
                        fingerprint: Optional[str] = None, compare_bytes: bool = True) -> Optional[dict]:
    """`saved` when it belongs to this video, otherwise None (transcribe as usual).

    `compare_bytes` is False for a link downloaded again (same link, maybe other bytes).
    """
    if not saved:
        return None
    known_duration = saved.get("duration") or expected_duration_seconds
    if known_duration and abs(float(known_duration) - float(duration_seconds)) > DURATION_TOLERANCE_SECONDS:
        logger.info("Saved transcript not reused: the video's length differs")
        return None
    if compare_bytes and saved.get("fingerprint"):
        current = fingerprint or source_fingerprint(video_path)
        if current != saved["fingerprint"]:
            logger.info("Saved transcript not reused: the video file differs")
            return None
    return saved
