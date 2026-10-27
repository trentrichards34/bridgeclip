"""
Voice clock: the narration's words with their times, straight from the TTS provider.

ElevenLabs' "text to speech with timestamps" endpoint returns the audio (base64) and, for every character it spoke,
a start and an end time. This module turns that character alignment into the word list everything downstream cues
to: [{word, start, end}] in seconds.

  - Words are split on whitespace.
  - Chinese / Japanese characters are each their own word (those scripts put no spaces between words). Hangul is left
    alone: Korean separates words with spaces.
  - A token that is only punctuation ("—", "...", a CJK full stop) joins the previous word, so a caption never shows a
    lone mark. Leading punctuation with no word before it joins the next word instead.
  - Curly quotes and apostrophes become straight ones, so captions and cue matching see one spelling.

It also builds the request (body, query, path) for that endpoint with the house voice settings. Nothing here touches
the network except `synthesize`, which takes the HTTP client as an argument so tests can hand it a fake one.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

API_BASE = "https://api.elevenlabs.io"
# The newest model first; accounts without it fall back to multilingual v2.
DEFAULT_MODEL = "eleven_v3"
FALLBACK_MODEL = "eleven_multilingual_v2"
# MP3, 44.1 kHz, 192 kbps.
OUTPUT_FORMAT = "mp3_44100_192"
VOICE_SETTINGS = {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True}
MAX_TEXT_CHARS = 5000
MAX_AUDIO_BYTES = 40 * 1024 * 1024

_QUOTES = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
})


class VoiceClockError(ValueError):
    """The provider's alignment (or reply) could not be turned into words."""


def normalize_quotes(text: str) -> str:
    return text.translate(_QUOTES)


def is_cjk(ch: str) -> bool:
    """A Chinese character or Japanese kana: scripts written without spaces between words."""
    cp = ord(ch)
    return (0x4E00 <= cp <= 0x9FFF        # CJK unified ideographs
            or 0x3400 <= cp <= 0x4DBF     # extension A
            or 0x20000 <= cp <= 0x2FA1F   # extensions B-F, compatibility supplement
            or 0xF900 <= cp <= 0xFAFF     # compatibility ideographs
            or 0x3040 <= cp <= 0x30FF     # hiragana, katakana
            or 0x31F0 <= cp <= 0x31FF     # katakana phonetic extensions
            or 0xFF66 <= cp <= 0xFF9D)    # half-width katakana


def _is_punct_only(text: str) -> bool:
    return bool(text) and all(unicodedata.category(c)[0] in "PS" for c in text)


def _alignment(response: dict) -> dict:
    """The character alignment from a provider reply (or the alignment itself). Prefers what was actually spoken."""
    if not isinstance(response, dict):
        raise VoiceClockError("The voice reply was not an object.")
    for key in ("alignment", "normalized_alignment"):
        if isinstance(response.get(key), dict) and response[key].get("characters"):
            return response[key]
    if "characters" in response:
        return response
    raise VoiceClockError("The voice reply had no character timings.")


def words_from_alignment(response: dict) -> list[dict]:
    """[{word, start, end}] (seconds, rounded to ms) from an ElevenLabs with-timestamps reply or its alignment."""
    align = _alignment(response)
    chars = align.get("characters") or []
    starts = align.get("character_start_times_seconds") or []
    ends = align.get("character_end_times_seconds") or []
    if not (len(chars) == len(starts) == len(ends)):
        raise VoiceClockError("The voice reply's character timings do not line up.")

    # Tokens: (text, start, end), split on whitespace with CJK characters on their own.
    tokens: list[list] = []
    current: Optional[list] = None
    for raw, s, e in zip(chars, starts, ends, strict=True):
        try:
            s, e = float(s), float(e)
        except (TypeError, ValueError):
            raise VoiceClockError("The voice reply had a timing that is not a number.") from None
        ch = normalize_quotes(str(raw))
        if not ch or ch.isspace():
            current = None
            continue
        if is_cjk(ch):
            tokens.append([ch, s, e])
            current = None
            continue
        if current is None:
            current = [ch, s, e]
            tokens.append(current)
        else:
            current[0] += ch
            current[2] = max(current[2], e)

    words: list[dict] = []
    pending_lead = ""
    lead_start: Optional[float] = None
    for text, s, e in tokens:
        if _is_punct_only(text):
            if words:
                words[-1]["word"] += text
                words[-1]["end"] = max(words[-1]["end"], e)
            else:
                pending_lead += text
                lead_start = s if lead_start is None else lead_start
            continue
        if pending_lead:
            text, s = pending_lead + text, min(s, lead_start)
            pending_lead, lead_start = "", None
        words.append({"word": text, "start": s, "end": max(s, e)})
    for w in words:
        w["start"], w["end"] = round(w["start"], 3), round(w["end"], 3)
    return words


def word_table(words: list[dict]) -> str:
    """The human-readable "index start end word" table read when choosing cue words."""
    return "\n".join(f"{i:>4} {w['start']:7.3f} {w['end']:7.3f} {w['word']}" for i, w in enumerate(words))


@dataclass
class VoiceRequest:
    """One POST to the with-timestamps endpoint, minus the API key."""
    voice_id: str
    body: dict
    params: dict = field(default_factory=lambda: {"output_format": OUTPUT_FORMAT})

    @property
    def path(self) -> str:
        return f"/v1/text-to-speech/{self.voice_id}/with-timestamps"

    @property
    def url(self) -> str:
        return API_BASE + self.path


def build_request(text: str, voice_id: str, model_id: str = DEFAULT_MODEL,
                  language_code: Optional[str] = None) -> VoiceRequest:
    """The request for `text` in `voice_id`; a language code is sent only for non-English reels."""
    text = normalize_quotes((text or "").strip())
    if not text:
        raise VoiceClockError("There is no script to voice.")
    if len(text) > MAX_TEXT_CHARS:
        raise VoiceClockError(f"The script is longer than {MAX_TEXT_CHARS} characters.")
    voice_id = (voice_id or "").strip()
    if not voice_id or not voice_id.replace("-", "").replace("_", "").isalnum():
        raise VoiceClockError("Pick a voice first.")
    body: dict[str, Any] = {"text": text, "model_id": model_id, "voice_settings": dict(VOICE_SETTINGS)}
    lang = (language_code or "").strip().lower()
    if lang and lang.split("-")[0] != "en":
        body["language_code"] = lang.split("-")[0]
    return VoiceRequest(voice_id=voice_id, body=body)


def auth_headers(api_key: str) -> dict:
    return {"xi-api-key": api_key, "accept": "application/json"}


def _write_bytes(path: str, data: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(data)


def _model_unavailable(status: int, body: str) -> bool:
    """The account cannot use this model (so the fallback is worth one more call)."""
    text = body.lower()
    return status in (400, 401, 403, 404, 422) and "model" in text


async def synthesize(client: Any, api_key: str, text: str, voice_id: str, audio_out: str,
                     language_code: Optional[str] = None) -> dict:
    """Voice `text` once: writes the MP3 to `audio_out`, returns {words, alignment, model}.

    `client` is an httpx.AsyncClient (or anything with the same `post`). The raw alignment is returned so timing-only
    changes can be re-cut later with no new TTS call.
    """
    if not api_key:
        raise VoiceClockError("Add an ElevenLabs API key first.")
    last_error = "The voice could not be generated."
    for model in (DEFAULT_MODEL, FALLBACK_MODEL):
        req = build_request(text, voice_id, model, language_code)
        response = await client.post(req.url, params=req.params, json=req.body, headers=auth_headers(api_key))
        if response.status_code != 200:
            reason = (response.text or "")[:400]
            logger.warning(f"Voice request rejected ({response.status_code}, {model}): {reason}")
            if model == DEFAULT_MODEL and _model_unavailable(response.status_code, reason):
                continue
            last_error = f"ElevenLabs refused the voice request ({response.status_code})."
            break
        try:
            reply = response.json()
            audio = base64.b64decode(reply.get("audio_base64") or "", validate=True)
        except (ValueError, AttributeError):
            raise VoiceClockError("ElevenLabs returned an unreadable reply.") from None
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise VoiceClockError("ElevenLabs returned no usable audio.")
        words = words_from_alignment(reply)
        await asyncio.to_thread(_write_bytes, audio_out, audio)
        return {"words": words, "alignment": _alignment(reply), "model": model}
    raise VoiceClockError(last_error)
