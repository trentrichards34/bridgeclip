"""Edit my recording runner: transcribe (fallback), plan, render or re-make one reel from a raw recording.

Main writes one JSON request to stdin. Progress and the result are JSON lines on stdout (see bridge_runner.emit).
Keys come from the environment, like the clip pipeline: OPENROUTER_API_KEY.
"""
import asyncio
import json
import math
import os
import re
import signal
import sys

from bridge_runner import reserve_stdout_for_protocol, emit

MAX_REQUEST = 4 * 1024 * 1024
MODES = ("transcribe", "plan", "render", "recompose")


def _abs_path(value):
    return isinstance(value, str) and 0 < len(value) <= 4096 and "\0" not in value and os.path.isabs(value)


def _text(value, limit, name, allow_empty=True):
    if value is None:
        value = ""
    if not isinstance(value, str) or len(value) > limit or "\0" in value or (not allow_empty and not value.strip()):
        raise ValueError(f"Invalid {name}")
    return value


def _span(raw, n):
    from clip_engine.services.edit_recording import Span
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {"start", "end"} or any(type(raw.get(k)) is not int for k in ("start", "end")) \
            or not 0 <= raw["start"] <= raw["end"] < n:
        raise ValueError("Invalid span")
    return Span(raw["start"], raw["end"])


def _look(raw):
    from clip_engine.config import CaptionPreset
    from clip_engine.services.brand_mark import validate_brand_mark
    from clip_engine.services.edit_recording import Look
    from clip_engine.services.rendering_service import validate_headline_look
    headline = " ".join(_text(raw.get("headline"), 300, "headline").split())
    captions = raw.get("include_captions", True)
    presets = {value for key, value in vars(CaptionPreset).items() if not key.startswith("_") and isinstance(value, str)}
    preset = raw.get("caption_preset") or "pop"
    if not isinstance(captions, bool) or preset not in presets:
        raise ValueError("Invalid captions")
    mark = validate_brand_mark(raw.get("brand_mark")) if raw.get("mode") == "render" else None
    extras = None
    if raw.get("mode") == "render":
        from clip_engine.services.look_extras import look_extras
        extras = look_extras(raw.get("look_extras"), raw.get("look_extras_color"), raw.get("cta_keyword") or "")
    return Look(headline, validate_headline_look(raw.get("headline_look")), captions, preset, mark, extras)


def parse_request(raw):
    from clip_engine.services.edit_recording import MAX_SOURCES, MAX_WORDS, SOUNDS, parse_words
    if not isinstance(raw, dict) or raw.get("mode") not in MODES:
        raise ValueError("Invalid request")
    if not _abs_path(raw.get("output_dir")):
        raise ValueError("Invalid output")
    mode = raw["mode"]
    if mode == "transcribe":
        if not set(raw) <= {"mode", "output_dir", "source", "src", "keyterms"} or not _abs_path(raw.get("source")):
            raise ValueError("Invalid request")
        src = raw.get("src")
        keyterms = raw.get("keyterms") or []
        if type(src) is not int or not 0 <= src < MAX_SOURCES or not isinstance(keyterms, list) or len(keyterms) > 200 \
                or any(not isinstance(k, str) or len(k) > 100 for k in keyterms):
            raise ValueError("Invalid request")
        return {"mode": mode, "output_dir": raw["output_dir"], "source": raw["source"], "src": src, "keyterms": keyterms}
    if mode == "recompose":
        out = raw.get("output_path")
        if not set(raw) <= {"mode", "output_dir", "output_path", "headline", "headline_look", "include_captions", "caption_preset"}:
            raise ValueError("Invalid request")
        # The new file goes straight into the run's folder.
        if not _abs_path(out) or not out.lower().endswith(".mp4") or os.path.dirname(os.path.realpath(out)) != os.path.realpath(raw["output_dir"]):
            raise ValueError("Invalid output")
        look = _look(raw)
        return {"mode": mode, "output_dir": raw["output_dir"], "output_path": out, "headline": look.headline,
                "headline_look": look.headline_look, "include_captions": look.include_captions, "caption_preset": look.caption_preset}
    count = raw.get("sources_count") if mode == "plan" else len(raw.get("sources") or [])
    if type(count) is not int or not 1 <= count <= MAX_SOURCES:
        raise ValueError("Invalid sources")
    words = parse_words(raw.get("words"), count)
    if mode == "plan":
        names = raw.get("names") or []
        if not isinstance(names, list) or len(names) > MAX_SOURCES or any(not isinstance(n, str) or len(n) > 200 for n in names):
            raise ValueError("Invalid names")
        return {"mode": mode, "output_dir": raw["output_dir"], "words": words, "names": names,
                "brand_identity": _text(raw.get("brand_identity"), 60000, "brand"), "brand_name": _text(raw.get("brand_name"), 120, "brand"),
                "hook_hint": _text(raw.get("hook_hint"), 600, "hook hint")}
    sources = raw.get("sources")
    if not isinstance(sources, list) or not all(_abs_path(s) for s in sources):
        raise ValueError("Invalid sources")
    keep = raw.get("keep")
    if not isinstance(keep, list) or len(keep) != len(words) or any(not isinstance(k, bool) for k in keep):
        raise ValueError("Invalid keep list")
    popups = raw.get("popups") or []
    if not isinstance(popups, list) or len(popups) > 20:
        raise ValueError("Invalid pop-ups")
    clean_popups = []
    for item in popups:
        if not isinstance(item, dict) or not set(item) <= {"word", "text", "kind"} or type(item.get("word")) is not int \
                or not 0 <= item["word"] < len(words) or item.get("kind", "keyword") not in ("number", "keyword"):
            raise ValueError("Invalid pop-ups")
        text = " ".join(_text(item.get("text"), 40, "pop-up", allow_empty=False).split())
        if re.search(r"[\x00-\x1f\x7f]", text):
            raise ValueError("Invalid pop-ups")
        clean_popups.append({"word": item["word"], "text": text, "kind": item.get("kind", "keyword")})
    sounds = raw.get("sounds") or []
    if not isinstance(sounds, list) or len(sounds) > 20 or any(
            not isinstance(s, dict) or set(s) != {"at", "sound"} or s.get("sound") not in SOUNDS
            or not (s.get("at") == "title" or (type(s.get("at")) is int and 0 <= s["at"] < len(words))) for s in sounds):
        raise ValueError("Invalid sounds")
    cost = raw.get("cost_usd") or 0
    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or not 0 <= cost < 1e6:
        raise ValueError("Invalid cost")
    if len(words) > MAX_WORDS:
        raise ValueError("Invalid words")
    return {"mode": mode, "output_dir": raw["output_dir"], "sources": list(sources), "words": words, "keep": keep,
            "hook": _span(raw.get("hook"), len(words)), "cta": _span(raw.get("cta"), len(words)), "popups": clean_popups,
            "sounds": [dict(s) for s in sounds], "look": _look(raw), "title": " ".join(_text(raw.get("title"), 200, "title").split()),
            "cost_usd": float(cost)}


def main():
    reserve_stdout_for_protocol()
    spent = {"usd": 0.0}
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError("Request too large")
        config = parse_request(json.loads(raw))
        os.environ["LOCAL_MODE"] = "true"
        from network_guard import install
        install()
        from clip_engine.services import edit_recording

        def progress(detail, percent):
            emit({"type": "progress", "detail": str(detail)[:160], "percent": max(0, min(100, float(percent)))})

        async def work():
            task = asyncio.current_task()
            if os.name != "nt":
                asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
            mode = config["mode"]
            if mode == "transcribe":
                return await edit_recording.transcribe_source(config, progress)
            if mode == "plan":
                return await edit_recording.plan_edit(config, progress)
            if mode == "recompose":
                return await edit_recording.recompose_edit(config, progress)
            return await edit_recording.render_edit(config, progress)

        result = asyncio.run(work())
        emit({"ok": True, **result})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        from clip_engine.services.edit_recording import EditError
        from bridge_runner import describe_failure
        if isinstance(error, EditError):
            message = str(error)
            cost = getattr(error, "cost_usd", 0)
            if isinstance(cost, (int, float)) and cost > 0:
                spent["usd"] += float(cost)
        elif isinstance(error, asyncio.CancelledError):
            message = "Cancelled"
        else:
            described = describe_failure(error)
            if described["message"] == "The clipping pipeline failed.":
                from clip_engine.logging_safety import safe_log_text
                first = safe_log_text((str(error).strip().splitlines() or [type(error).__name__])[0]).strip()[:220]
                message = f"Your video could not be made: {first or type(error).__name__}"
            else:
                message = f"{described['message']} {described['hint']}"
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f"Edit failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}", file=sys.stderr)
        except Exception:
            pass
        line = {"ok": False, "error": message or "failed"}
        if spent["usd"] > 0:
            line["cost_usd"] = round(spent["usd"], 6)
        emit(line)
        return 1


if __name__ == "__main__":
    sys.exit(main())
