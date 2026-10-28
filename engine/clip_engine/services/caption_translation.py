"""
Caption language: burn a clip's captions (and write its SRT) in another
language. The speech stays as recorded; only the caption words change.

One OpenRouter call per clip (the planner model) translates the clip's
transcript line by line. Each translated line keeps its line's timing: its
words are spread over the time the original line's words were spoken,
proportionally to their length, after pacing cuts are applied (so a line
never loses words to a removed pause or filler).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from clip_engine.services.openrouter import OpenRouterError, chat_completion, json_schema_format, message_text
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

logger = logging.getLogger(__name__)

# Mirrors CAPTION_LANGUAGES in src/shared/caption-language.ts.
CAPTION_LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "pt": "Portuguese",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "hi": "Hindi",
    "ar": "Arabic",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese (Simplified)",
}
# Written without spaces between words: captions are split into short runs of characters.
UNSPACED_LANGUAGES = {"ja", "zh"}
MAX_LINES_PER_CALL = 400
MAX_LINE_CHARS = 2000
CJK_CHUNK_CHARS = 3
_PUNCTUATION = set("、。，．！？：；「」『』（）〜…・,.!?;:()\"'”“’‘ 　")

TRANSLATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["lines"],
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "text"],
                "properties": {"id": {"type": "integer"}, "text": {"type": "string"}},
            },
        },
    },
}


def language_name(code: Optional[str]) -> Optional[str]:
    """The planner-facing name of a caption language code, or None (original)."""
    return CAPTION_LANGUAGES.get(code) if isinstance(code, str) else None


def segment_key(segment: TranscriptSegment) -> str:
    """Stable identity of a transcript line, surviving copies and filtering."""
    return f"{segment.start_time_ms}:{segment.end_time_ms}:{len(segment.text or '')}"


def caption_tokens(text: str, language: Optional[str]) -> list[str]:
    """The caption words of a translated line.

    Spaced languages split on whitespace. Japanese and Chinese split into
    short runs of characters, keeping punctuation with the run before it.
    """
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return []
    if language not in UNSPACED_LANGUAGES:
        return text.split(" ")
    tokens: list[str] = []
    current = ""
    for char in text.replace(" ", ""):
        if char in _PUNCTUATION and current:
            current += char
            tokens.append(current)
            current = ""
            continue
        current += char
        if len(current) >= CJK_CHUNK_CHARS:
            tokens.append(current)
            current = ""
    if current:
        if tokens and all(c in _PUNCTUATION for c in current):
            tokens[-1] += current
        else:
            tokens.append(current)
    return tokens


def retime_words(tokens: list[str], start_ms: int, end_ms: int) -> list[TranscriptWord]:
    """Spread words over [start_ms, end_ms] in proportion to their length.

    Words are contiguous, in order, at least 1 ms long, and the last one ends
    exactly at end_ms.
    """
    tokens = [token for token in tokens if token]
    if not tokens:
        return []
    start_ms = int(start_ms)
    end_ms = max(int(end_ms), start_ms + len(tokens))
    weights = [max(1, len(token)) for token in tokens]
    total = sum(weights)
    span = end_ms - start_ms
    words: list[TranscriptWord] = []
    used = 0
    cursor = start_ms
    for index, (token, weight) in enumerate(zip(tokens, weights)):
        used += weight
        remaining = len(tokens) - index - 1
        boundary = end_ms if remaining == 0 else start_ms + round(span * used / total)
        # Leave at least 1 ms for each remaining word, and give this one 1 ms.
        boundary = min(max(boundary, cursor + 1), end_ms - remaining)
        words.append(TranscriptWord(word=token, start_time_ms=cursor, end_time_ms=boundary))
        cursor = boundary
    return words


def translated_segment(original: TranscriptSegment, text: str, start_ms: int, end_ms: int,
                       language: Optional[str]) -> Optional[TranscriptSegment]:
    """A caption line in the target language over [start_ms, end_ms]."""
    words = retime_words(caption_tokens(text, language), start_ms, end_ms)
    if not words:
        return None
    joiner = "" if language in UNSPACED_LANGUAGES else " "
    return TranscriptSegment(
        start_time_ms=words[0].start_time_ms, end_time_ms=words[-1].end_time_ms,
        text=joiner.join(word.word for word in words), speaker_label=original.speaker_label, words=words,
    )


def apply_translations(original: list[TranscriptSegment], remap, translations: dict[str, str],
                       language: Optional[str]) -> list[TranscriptSegment]:
    """Caption lines for the edited timeline.

    `remap(segments)` moves original lines onto the output timeline (dropping
    cut words). A translated line takes the span of what is left of its
    original line; a line without a translation keeps its original words.
    """
    result: list[TranscriptSegment] = []
    for segment in original:
        mapped = remap([segment])
        if not mapped:
            continue
        text = translations.get(segment_key(segment))
        if not text:
            result.extend(mapped)
            continue
        line = translated_segment(segment, text, mapped[0].start_time_ms, mapped[-1].end_time_ms, language)
        if line:
            result.append(line)
    return result


@dataclass
class TranslationUsage:
    requests: int = 0
    failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    cost_incomplete: bool = False

    def as_api_costs(self, model: str) -> dict[str, Any]:
        return {
            "provider": "openrouter", "model": model,
            "prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens,
            "estimated_cost_usd": round(self.cost_usd, 6), "attempts": self.requests,
            "cost_incomplete": self.cost_incomplete,
        }


SYSTEM_PROMPT = """You translate short-form video captions.
Translate each numbered line into {language}. Keep the speaker's meaning, tone and energy; write the way a native speaker would caption the clip.
Keep names, brands and numbers as they are. Do not merge, split, reorder, add or drop lines: return exactly one translation for every id.
If a line is already in {language}, return it unchanged. Return JSON only."""


class CaptionTranslator:
    """Translates the caption lines of each clip with the planner model (one call per clip)."""

    def __init__(self, settings, client: Optional[httpx.AsyncClient] = None):
        self.settings = settings
        self.model = settings.planner_model
        self.usage = TranslationUsage()
        self._client = client
        self._owns_client = client is None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.settings.openrouter_base_url,
                timeout=httpx.Timeout(180.0, connect=30.0),
                headers={
                    "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                    "HTTP-Referer": "https://github.com/trentrichards34/creatorclips-releases",
                    "X-Title": "CreatorClips caption translation",
                },
            )
        return self._client

    async def translate(self, segments: list[TranscriptSegment], language: str) -> dict[str, str]:
        """Translations keyed by segment_key; empty when the call fails (captions stay original)."""
        name = language_name(language)
        lines = [segment for segment in segments if (segment.text or "").strip()][:MAX_LINES_PER_CALL]
        if not name or not lines or not self.settings.openrouter_api_key:
            return {}
        numbered = [{"id": index, "text": segment.text.strip()[:MAX_LINE_CHARS]} for index, segment in enumerate(lines)]
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT.format(language=name)},
                {"role": "user", "content": json.dumps({"lines": numbered}, ensure_ascii=False)},
            ],
            "max_tokens": min(16000, 400 + sum(len(item["text"]) for item in numbered) * 4),
            "temperature": 0.2,
            "response_format": json_schema_format("caption_translation", TRANSLATION_SCHEMA),
            "provider": {"require_parameters": True},
        }
        self.usage.requests += 1
        try:
            body, usage = await chat_completion(self._get_client(), payload)
            self.usage.prompt_tokens += int(usage.get("prompt_tokens") or 0)
            self.usage.completion_tokens += int(usage.get("completion_tokens") or 0)
            if usage.get("cost") is None:
                self.usage.cost_incomplete = True
            else:
                self.usage.cost_usd += float(usage["cost"])
            content, _ = message_text(body)
            data = json.loads(content or "{}")
        except (OpenRouterError, ValueError, TypeError) as exc:
            self.usage.failures += 1
            logger.warning(f"Caption translation unavailable; keeping original captions: {type(exc).__name__}")
            return {}
        items = data.get("lines") if isinstance(data, dict) else None
        if not isinstance(items, list):
            self.usage.failures += 1
            return {}
        translations: dict[str, str] = {}
        for item in items:
            if not isinstance(item, dict) or type(item.get("id")) is not int or not isinstance(item.get("text"), str):
                continue
            index, text = item["id"], item["text"].strip()[:MAX_LINE_CHARS]
            if 0 <= index < len(lines) and text:
                translations[segment_key(lines[index])] = text
        return translations

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None
