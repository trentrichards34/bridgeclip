"""B-roll video runner: build a b-roll video's source and editor project, or swap one of its shots.

Main writes one JSON request to stdin (see engine/clip_engine/services/broll_video.py). Progress and the result are
JSON lines on stdout. The OpenRouter key comes from the environment, like the clip pipeline.
"""
import asyncio
import json
import os
import re
import sys

from bridge_runner import emit, reserve_stdout_for_protocol

MAX_REQUEST = 4 * 1024 * 1024
MEDIA_ID = re.compile(r"^[a-f0-9]{32}$")
SHOT_REF = re.compile(r"^l[0-9a-f]{12}(?::s[0-9]{1,3})?$")
CTA_ID = re.compile(r"^[a-f0-9]{16}$")
KEYWORD = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,19}$")
PRESET = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _abs(value):
    return isinstance(value, str) and 0 < len(value) <= 4096 and "\0" not in value and os.path.isabs(value)


def _run_folder(value):
    if not _abs(value) or os.path.islink(value) or not os.path.isdir(value) \
            or not re.fullmatch(r"broll-video-[0-9a-f-]{36}", os.path.basename(value)):
        raise ValueError("Invalid run folder")
    return value


def parse_build(raw):
    from clip_engine.services.audio_finish import parse_audio
    from clip_engine.services.broll_library import parse_ai_settings
    from clip_engine.services.broll_video import MAX_TOTAL_MS, MAX_WORDS
    from clip_engine.services.manual_editor import parse_hook
    allowed = {"mode", "output_dir", "voice", "words", "total_ms", "catalog_path", "shot_ids", "allow_ai", "broll_ai", "broll_ai_dir",
               "aspect", "fade", "title", "captions", "caption_preset", "hook", "graphics", "cta_keyword", "cta_id", "audio", "media_id", "voice_ai"}
    if set(raw) - allowed:
        raise ValueError("Invalid request")
    _run_folder(raw.get("output_dir"))
    if not _abs(raw.get("voice")) or not _abs(raw.get("catalog_path")):
        raise ValueError("Invalid request")
    total = raw.get("total_ms")
    if type(total) is not int or not 1000 <= total <= MAX_TOTAL_MS:
        raise ValueError("Invalid length")
    words = raw.get("words")
    if not isinstance(words, list) or not 1 <= len(words) <= MAX_WORDS:
        raise ValueError("Invalid words")
    ids = raw.get("shot_ids")
    if ids is not None and (not isinstance(ids, list) or not 1 <= len(ids) <= 2000 or any(not isinstance(i, str) or not SHOT_REF.match(i) for i in ids)):
        raise ValueError("Invalid shots")
    if raw.get("aspect", "9:16") not in ("9:16", "16:9"):
        raise ValueError("Invalid aspect")
    for key in ("allow_ai", "fade", "captions", "graphics", "voice_ai"):
        if key in raw and type(raw[key]) is not bool:
            raise ValueError(f"Invalid {key}")
    if raw.get("allow_ai"):
        parse_ai_settings(raw.get("broll_ai"))
        folder = raw.get("broll_ai_dir")
        if not _abs(folder) or not os.path.isdir(folder) or os.path.islink(folder):
            raise ValueError("Invalid AI b-roll folder")
    elif "broll_ai" in raw or "broll_ai_dir" in raw:
        raise ValueError("Only AI b-roll uses AI settings")
    title = raw.get("title") or ""
    if not isinstance(title, str) or len(title) > 200 or any(ord(c) < 32 for c in title):
        raise ValueError("Invalid title")
    preset = raw.get("caption_preset") or "pop"
    if not isinstance(preset, str) or not PRESET.match(preset):
        raise ValueError("Invalid caption preset")
    hook = parse_hook(raw.get("hook"))
    keyword = raw.get("cta_keyword") or ""
    if not isinstance(keyword, str) or (keyword and not KEYWORD.match(keyword)):
        raise ValueError("Invalid keyword")
    cta = raw.get("cta_id")
    if cta is not None and (not isinstance(cta, str) or not CTA_ID.match(cta)):
        raise ValueError("Invalid call to action")
    parse_audio(raw.get("audio"))
    if not isinstance(raw.get("media_id"), str) or not MEDIA_ID.match(raw["media_id"]):
        raise ValueError("Invalid media id")
    return {**raw, "hook": hook, "caption_preset": preset, "title": " ".join(title.split()), "cta_keyword": keyword}


def parse_swap(raw):
    if set(raw) - {"mode", "output_dir", "slot", "shot_id", "catalog_path", "media_id", "revision"}:
        raise ValueError("Invalid request")
    _run_folder(raw.get("output_dir"))
    if type(raw.get("slot")) is not int or not 0 <= raw["slot"] < 1000 or type(raw.get("revision")) is not int:
        raise ValueError("Invalid request")
    shot = raw.get("shot_id")
    if shot is not None and (not isinstance(shot, str) or not re.fullmatch(r"l[0-9a-f]{12}:s[0-9]{1,3}", shot)):
        raise ValueError("Invalid shot")
    if not _abs(raw.get("catalog_path")) or not isinstance(raw.get("media_id"), str) or not MEDIA_ID.match(raw["media_id"]):
        raise ValueError("Invalid request")
    return raw


def main():
    reserve_stdout_for_protocol()
    spent = {"usd": 0.0}
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw_text = sys.stdin.read(MAX_REQUEST + 1)
        if len(raw_text) > MAX_REQUEST:
            raise ValueError("Request too large")
        raw = json.loads(raw_text)
        if not isinstance(raw, dict) or raw.get("mode") not in ("build", "swap"):
            raise ValueError("Invalid request")
        config = parse_build(raw) if raw["mode"] == "build" else parse_swap(raw)
        os.environ["LOCAL_MODE"] = "true"
        from network_guard import install
        install()
        from clip_engine.services import broll_video

        def progress(detail, percent):
            emit({"type": "progress", "detail": str(detail)[:160], "percent": max(0, min(100, round(float(percent), 1)))})

        result = asyncio.run(broll_video.build(config, progress) if config["mode"] == "build" else broll_video.swap_shot(config, progress))
        emit({"ok": True, **result})
        return 0
    except BaseException as error:  # noqa: BLE001 - reported to main as a failed build
        from clip_engine.services.broll_video import BrollVideoError
        message = str(error) if isinstance(error, BrollVideoError) else "failed"
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f"B-roll video failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}", file=sys.stderr)
        except Exception:
            pass
        cost = getattr(error, "cost_usd", 0)
        emit({"ok": False, "error": message[:400], **({"cost_usd": float(cost) + spent["usd"]} if isinstance(cost, (int, float)) and cost > 0 else {})})
        return 1


if __name__ == "__main__":
    sys.exit(main())
