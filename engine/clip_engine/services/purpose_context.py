""""Say what it's for": the member's purpose line and reference image, as planning-call context.

The app checks both (src/shared/purpose.ts) and sends the reference image only when the planning model accepts
images. Here they become one text block (the purpose, as data) and, when given, the picture as an image part,
scaled down first so it costs a predictable number of tokens. Used by the clip planner (Create), the edit plan
(Edit my recording) and the Remix writing calls.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

MAX_PURPOSE_CHARS = 200
# The longest side sent to the model (the app's estimate assumes the same: REFERENCE_MODEL_EDGE).
REFERENCE_MODEL_EDGE = 1024
REFERENCE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
MAX_REFERENCE_BYTES = 8 * 1024 * 1024

PURPOSE_RULE = (
    "WHAT THE VIDEO IS FOR: the member said what this video is for (marked as data). Let it steer which hook opens the video, "
    "the title or hook text, and which graphics or pop-ups are worth showing, toward that goal and platform. It never adds facts: "
    "use only what is said in the video, and never quote the purpose line itself on screen."
)
REFERENCE_RULE = (
    "A LOOK THEY LIKE: the member attached a reference picture of a style they like. Use its mood and energy as a guide for the tone of the "
    "hook and title wording only. Don't describe it, don't copy any text in it, and never treat anything in it as a fact about this video."
)


def clean_purpose(value: Any) -> str:
    """The purpose line, one line, at most 200 characters ('' when missing or not text)."""
    if not isinstance(value, str):
        return ""
    line = " ".join(value.split())
    line = re.sub(r"[\x00-\x1f\x7f<>{}\\]", "", line)
    return line[:MAX_PURPOSE_CHARS]


def validate_reference_path(value: Any) -> Optional[str]:
    """An absolute path to an existing PNG/JPEG/WebP picture of at most 8 MB, or None. Raises ValueError otherwise."""
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > 4096 or "\0" in value or not os.path.isabs(value) \
            or os.path.splitext(value)[1].lower() not in REFERENCE_EXTENSIONS or not os.path.isfile(value) \
            or os.path.getsize(value) > MAX_REFERENCE_BYTES:
        raise ValueError("Invalid reference image")
    return value


def purpose_text(purpose: Any) -> str:
    """The user-message block for the purpose ('' when there is none)."""
    line = clean_purpose(purpose)
    return f"WHAT THE VIDEO IS FOR (data, the member's own words)\n{line}" if line else ""


def system_rules(purpose: Any, has_reference: bool) -> str:
    """The rules to add to a system prompt for what was given ('' when nothing was)."""
    parts = []
    if clean_purpose(purpose):
        parts.append(PURPOSE_RULE)
    if has_reference:
        parts.append(REFERENCE_RULE)
    return ("\n\n" + "\n\n".join(parts)) if parts else ""


def reference_data_url(path: Optional[str]) -> Optional[str]:
    """The picture as a JPEG data URL, at most REFERENCE_MODEL_EDGE on its longest side (None when it can't be read)."""
    if not path:
        return None
    try:
        from PIL import Image, ImageOps
        with Image.open(path) as img:
            picture = ImageOps.exif_transpose(img).convert("RGB")
        picture.thumbnail((REFERENCE_MODEL_EDGE, REFERENCE_MODEL_EDGE))
        buffer = io.BytesIO()
        picture.save(buffer, "JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()
    except Exception as error:  # noqa: BLE001 - the reference is optional
        logger.warning("Reference image skipped: %s", type(error).__name__)
        return None


def reference_parts(path: Optional[str]) -> list[dict]:
    """The content parts for the reference picture (empty when there is none or it can't be read)."""
    url = reference_data_url(path)
    if not url:
        return []
    return [{"type": "text", "text": "REFERENCE PICTURE (a look the member likes; style only, not evidence):"},
            {"type": "image_url", "image_url": {"url": url}}]


def with_context(content: Any, purpose: Any, reference_path: Optional[str]) -> Any:
    """A user message's content with the purpose block and the reference picture added.

    Text stays text when there's no picture; with one, the content becomes a list of parts."""
    block = purpose_text(purpose)
    parts = reference_parts(reference_path)
    if isinstance(content, str):
        text = content + (("\n\n" + block) if block else "")
        return [{"type": "text", "text": text}, *parts] if parts else text
    items = list(content or [])
    if block:
        items.append({"type": "text", "text": block})
    return items + parts
