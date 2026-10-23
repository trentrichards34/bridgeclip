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
MODES = ("transcribe", "plan", "render", "recompose", "clips", "sync", "screen_preview")


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
    extras = raw.get("look_extras") or []
    if not isinstance(extras, list) or len(extras) > 20 or any(not isinstance(x, str) or not re.fullmatch(r"[a-z_]{1,40}", x) for x in extras):
        raise ValueError("Invalid look extras")
    look = Look(headline, validate_headline_look(raw.get("headline_look")), captions, preset, mark, tuple(dict.fromkeys(extras)))
    if raw.get("mode") == "render" and look.look_extras:
        # Their color (the brand's) and the keyword the comment box types; re-making reads them from the bundle.
        from clip_engine.services.look_extras import look_extras, parse_color
        look.look_extras_color = parse_color(raw.get("look_extras_color"))
        look.look_extras_keyword = look_extras(["comment_box"], None, raw.get("cta_keyword") or "").keyword
    return look


RECIPES = ("clean", "fast", "story", "tutorial")


def _pacing(raw):
    if raw is None:
        return {}
    if not isinstance(raw, dict) or set(raw) != {"max_gap", "short_pause", "punch_on_cuts"} or not isinstance(raw["punch_on_cuts"], bool):
        raise ValueError("Invalid pacing")
    gap, pause = raw["max_gap"], raw["short_pause"]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (gap, pause)) \
            or not 0.2 <= gap <= 1.5 or not 0.05 <= pause <= min(0.5, gap):
        raise ValueError("Invalid pacing")
    return {"max_gap": float(gap), "short_pause": float(pause), "punch_on_cuts": raw["punch_on_cuts"]}


def _image_path(value):
    if not _abs_path(value) or os.path.splitext(value)[1].lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        raise ValueError("Invalid image")
    return value


def _reference(value):
    from clip_engine.services.purpose_context import validate_reference_path
    try:
        return validate_reference_path(value)
    except ValueError:
        raise ValueError("Invalid reference image") from None


def _direction(raw):
    """The plan's automatic direction (motion graphics): whether Stage layouts are on, and the brand's comment keyword."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or not set(raw) <= {"stage", "cta_keyword"} or not isinstance(raw.get("stage", False), bool):
        raise ValueError("Invalid direction")
    return {"stage": raw.get("stage", False), "cta_keyword": _text(raw.get("cta_keyword"), 24, "keyword")}


def _editor(raw, n):
    """The reel as a clip editor project: the review's graphics (word-anchored), pinned images (in the run's graphics
    images), whether the automatic graphics and Stage layouts are on, the brand color and comment keyword."""
    from clip_engine.services.edit_direction import EDITOR_TEMPLATES, MAX_GRAPHICS
    if not isinstance(raw, dict) or not set(raw) <= {"graphics", "pins", "motion", "stage", "brand_color", "cta_keyword"} \
            or not isinstance(raw.get("motion", True), bool) or not isinstance(raw.get("stage", False), bool):
        raise ValueError("Invalid editor")
    color = raw.get("brand_color")
    if color is not None and (not isinstance(color, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", color)):
        raise ValueError("Invalid editor")
    graphics = raw.get("graphics") or []
    if not isinstance(graphics, list) or len(graphics) > MAX_GRAPHICS:
        raise ValueError("Invalid graphics")
    clean = []
    for g in graphics:
        fields = g.get("fields") if isinstance(g, dict) else None
        if not isinstance(g, dict) or not {"id", "template", "word", "duration_ms", "placement", "fields"} <= set(g) \
                <= {"id", "template", "word", "duration_ms", "placement", "fields", "origin", "size", "depth"} \
                or not isinstance(g["id"], str) or not re.fullmatch(r"[a-z0-9-]{4,40}", g["id"]) or g["template"] not in EDITOR_TEMPLATES \
                or type(g["word"]) is not int or not 0 <= g["word"] < n or type(g["duration_ms"]) is not int \
                or not 800 <= g["duration_ms"] <= 180000 or g["placement"] not in ("top", "middle", "bottom") \
                or g.get("origin", "member") not in ("auto", "member", "chat") or g.get("size", "card") not in ("compact", "card", "stage") \
                or g.get("depth", "front") not in ("front", "behind") or not isinstance(fields, dict) or len(fields) > 24 \
                or any(not isinstance(k, str) or not re.fullmatch(r"[a-z_]{1,20}", k) or not isinstance(v, str) or len(v) > 800 or "\0" in v
                       for k, v in fields.items()):
            raise ValueError("Invalid graphics")
        clean.append({**g, "fields": dict(fields)})
    pins = raw.get("pins") or []
    if not isinstance(pins, list) or len(pins) > 12 or any(
            not isinstance(p, dict) or set(p) != {"word", "image"} or type(p["word"]) is not int or not 0 <= p["word"] < n
            or not isinstance(p["image"], str) or not re.fullmatch(r"[a-f0-9]{16}\.(png|jpg|webp)", p["image"]) for p in pins):
        raise ValueError("Invalid pins")
    return {"graphics": clean, "pins": [dict(p) for p in pins], "motion": raw.get("motion", True), "stage": raw.get("stage", False),
            "brand_color": color, "cta_keyword": _text(raw.get("cta_keyword"), 24, "keyword")}


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
    if mode == "clips":
        from clip_engine.services.combine_clips import MAX_CLIPS
        sources = raw.get("sources")
        if not set(raw) <= {"mode", "output_dir", "sources"} or not isinstance(sources, list) or not 1 <= len(sources) <= MAX_CLIPS \
                or not all(_abs_path(s) for s in sources):
            raise ValueError("Invalid request")
        return {"mode": mode, "output_dir": raw["output_dir"], "sources": list(sources)}
    if mode == "sync":
        # Camera + screen: line the screen recording up with the camera (local, no AI).
        if not set(raw) <= {"mode", "output_dir", "camera", "screen"} or not _abs_path(raw.get("camera")) or not _abs_path(raw.get("screen")):
            raise ValueError("Invalid request")
        return {"mode": mode, "output_dir": raw["output_dir"], "camera": raw["camera"], "screen": raw["screen"]}
    if mode == "screen_preview":
        from clip_engine.services.screen_pair import MAX_OFFSET_MS
        out = raw.get("output_path")
        if not set(raw) <= {"mode", "output_dir", "camera", "screen", "offset_ms", "at_ms", "output_path"} or not _abs_path(raw.get("camera")) \
                or not _abs_path(raw.get("screen")) or type(raw.get("offset_ms")) is not int or not -MAX_OFFSET_MS <= raw["offset_ms"] <= MAX_OFFSET_MS \
                or type(raw.get("at_ms")) is not int or not 0 <= raw["at_ms"] <= 4 * 3600_000:
            raise ValueError("Invalid request")
        if not _abs_path(out) or not out.lower().endswith(".mp4") or os.path.dirname(os.path.realpath(out)) != os.path.realpath(raw["output_dir"]):
            raise ValueError("Invalid output")
        return {"mode": mode, "output_dir": raw["output_dir"], "camera": raw["camera"], "screen": raw["screen"], "offset_ms": raw["offset_ms"],
                "at_ms": raw["at_ms"], "output_path": out}
    if mode == "recompose":
        out = raw.get("output_path")
        if not set(raw) <= {"mode", "output_dir", "output_path", "headline", "headline_look", "include_captions", "caption_preset", "look_extras"}:
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
        combine = _plan_combine(raw.get("combine"), count)
        return {"mode": mode, "output_dir": raw["output_dir"], "words": words, "names": names, **({"combine": combine} if combine else {}),
                "brand_identity": _text(raw.get("brand_identity"), 60000, "brand"), "brand_name": _text(raw.get("brand_name"), 120, "brand"),
                "hook_hint": _text(raw.get("hook_hint"), 600, "hook hint"), "purpose": _text(raw.get("purpose"), 200, "purpose"),
                "reference_image": _reference(raw.get("reference_image")),
                **({"direction": _direction(raw.get("direction"))} if raw.get("direction") is not None else {})}
    sources = raw.get("sources")
    if not isinstance(sources, list) or not all(_abs_path(s) for s in sources):
        raise ValueError("Invalid sources")
    keep = raw.get("keep")
    if not isinstance(keep, list) or len(keep) != len(words) or any(not isinstance(k, bool) for k in keep):
        raise ValueError("Invalid keep list")
    popups = raw.get("popups") or []
    if not isinstance(popups, list) or len(popups) > 20:
        raise ValueError("Invalid pop-ups")
    from clip_engine.services.edit_recording import CARD_MAX_S, CARD_MIN_S, MAX_PINS, clean_card
    clean_popups = []
    for item in popups:
        if isinstance(item, dict) and item.get("kind") == "card":
            seconds = item.get("seconds", 3)
            card = clean_card(item.get("card"))
            if not set(item) <= {"word", "kind", "card", "seconds"} or type(item.get("word")) is not int or not 0 <= item["word"] < len(words) \
                    or card is None or isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not CARD_MIN_S <= seconds <= CARD_MAX_S:
                raise ValueError("Invalid card")
            clean_popups.append({"word": item["word"], "kind": "card", "card": card, "seconds": float(seconds)})
            continue
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
    images = raw.get("images") or []
    if not isinstance(images, list) or len(images) > 8:
        raise ValueError("Invalid images")
    images = [_image_path(path) for path in images]
    pins = raw.get("pins") or []
    if not isinstance(pins, list) or len(pins) > MAX_PINS or any(
            not isinstance(p, dict) or set(p) != {"image", "word"} or p.get("image") not in images or type(p.get("word")) is not int
            or not 0 <= p["word"] < len(words) for p in pins):
        raise ValueError("Invalid pins")
    if raw.get("recipe", "clean") not in RECIPES or not isinstance(raw.get("cutout_intro", False), bool) or not isinstance(raw.get("raw_intro", False), bool):
        raise ValueError("Invalid edit style")
    def _min_top_ok(g: dict) -> bool:
        # Behind the speaker: the highest the engine may move the words (share of the frame).
        return "min_top" not in g or (type(g["min_top"]) in (int, float) and 0 <= g["min_top"] <= 0.6)

    # Motion graphics main drew (in the run's .graphics/reel/), each starting as its word is said.
    graphics = raw.get("graphics") or []
    if not isinstance(graphics, list) or len(graphics) > 8 or any(
            not isinstance(g, dict) or not {"file", "word", "duration_ms"} <= set(g) <= {"file", "word", "duration_ms", "depth", "min_top"}
            or g.get("depth", "behind") != "behind" or not _min_top_ok(g) or not isinstance(g.get("file"), str)
            or not re.fullmatch(r"[a-f0-9]{64}\.mov", g["file"]) or type(g.get("word")) is not int or not 0 <= g["word"] < len(words)
            or type(g.get("duration_ms")) is not int or not 400 <= g["duration_ms"] <= 8000 for g in graphics):
        raise ValueError("Invalid graphics")
    # Voice cleanup and background music (audio_finish.parse_audio): checked here, applied while the sound is mixed.
    from clip_engine.services.audio_finish import parse_audio
    audio = parse_audio(raw.get("audio"))
    # B-roll from the member's library, stock or AI (broll_library): the source, catalog and AI settings main wrote.
    from clip_engine.services.broll_library import validate_broll_config
    broll = {k: raw[k] for k in ("broll_source", "broll_catalog_path", "broll_ai", "broll_ai_dir") if raw.get(k) is not None}
    validate_broll_config(broll, require_enabled=False)
    return {"mode": mode, "output_dir": raw["output_dir"], "sources": list(sources), "words": words, "keep": keep,
            "hook": _span(raw.get("hook"), len(words)), "cta": _span(raw.get("cta"), len(words)), "popups": clean_popups,
            "sounds": [dict(s) for s in sounds], "look": _look(raw), "title": " ".join(_text(raw.get("title"), 200, "title").split()),
            "cost_usd": float(cost), "pacing": _pacing(raw.get("pacing")), "recipe": raw.get("recipe", "clean"), "images": images,
            "pins": [dict(p) for p in pins], "cutout_intro": raw.get("cutout_intro", False), "raw_intro": raw.get("raw_intro", False),
            "graphics": [dict(g) for g in graphics], "audio": audio, **broll, **({"combine": _render_combine(raw.get("combine"), len(sources))}
                                                                     if raw.get("combine") is not None else {}),
            **({"screen": _screen(raw.get("screen"), len(sources))} if raw.get("screen") is not None else {}),
            **({"editor": _editor(raw.get("editor"), len(words))} if raw.get("editor") is not None else {})}


def _screen(raw, count):
    """Camera + screen, for the render: the screen recording, how it lines up, the reel's style and its choices."""
    from clip_engine.services.screen_pair import FITS, MAX_OFFSET_MS, SPLIT_RANGE, STYLES
    if count != 1 or not isinstance(raw, dict) or set(raw) != {"path", "offset_ms", "style", "split", "fit", "zoom", "auto"}:
        raise ValueError("Invalid screen recording")
    split = raw["split"]
    if not _abs_path(raw["path"]) or type(raw["offset_ms"]) is not int or not -MAX_OFFSET_MS <= raw["offset_ms"] <= MAX_OFFSET_MS \
            or raw["style"] not in STYLES or raw["fit"] not in FITS or isinstance(split, bool) or not isinstance(split, (int, float)) \
            or not math.isfinite(split) or not SPLIT_RANGE[0] <= split <= SPLIT_RANGE[1] \
            or not isinstance(raw["zoom"], bool) or not isinstance(raw["auto"], bool):
        raise ValueError("Invalid screen recording")
    return {"path": raw["path"], "offset_ms": raw["offset_ms"], "style": raw["style"], "split": float(split), "fit": raw["fit"],
            "zoom": raw["zoom"], "auto": raw["auto"]}


def _plan_combine(raw, count):
    """Combine clips, for the plan: each clip's shot and length (in source order)."""
    if raw is None:
        return None
    clips = raw.get("clips") if isinstance(raw, dict) and set(raw) == {"clips"} else None
    if not isinstance(clips, list) or len(clips) != count or any(
            not isinstance(c, dict) or set(c) != {"shot", "seconds"} or c.get("shot") not in ("face", "screen")
            or isinstance(c.get("seconds"), bool) or not isinstance(c.get("seconds"), (int, float)) or not 0 <= c["seconds"] <= 3600 for c in clips):
        raise ValueError("Invalid clips")
    return {"clips": [{"shot": c["shot"], "seconds": float(c["seconds"])} for c in clips]}


def _render_combine(raw, count):
    """Combine clips, for the render: the clips in the order they play (left-out clips aren't listed) and transitions."""
    if not isinstance(raw, dict) or set(raw) != {"order", "transitions"} or not isinstance(raw["transitions"], bool):
        raise ValueError("Invalid clips")
    order = raw["order"]
    if not isinstance(order, list) or not 1 <= len(order) <= count or any(type(v) is not int or not 0 <= v < count for v in order) \
            or len(set(order)) != len(order):
        raise ValueError("Invalid clip order")
    return {"order": list(order), "transitions": raw["transitions"]}


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
            if mode in ("sync", "screen_preview"):
                from clip_engine.services import screen_pair
                try:
                    if mode == "sync":
                        return await asyncio.to_thread(screen_pair.sync_pair, config["camera"], config["screen"],
                                                       os.path.join(config["output_dir"], ".sync-work"))
                    path = await asyncio.to_thread(screen_pair.preview_pair, config["camera"], config["screen"], config["offset_ms"],
                                                   config["at_ms"], config["output_path"])
                    return {"path": path}
                except screen_pair.PairError as error:
                    raise edit_recording.EditError(str(error)) from None
                finally:
                    import shutil
                    shutil.rmtree(os.path.join(config["output_dir"], ".sync-work"), ignore_errors=True)
            if mode == "clips":
                from clip_engine.services import combine_clips
                try:
                    return await combine_clips.prepare_clips(config, progress)
                except combine_clips.CombineError as error:
                    raise edit_recording.EditError(str(error)) from None
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
            message = "Canceled"
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
