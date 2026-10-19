"""Remix runner: commentary videos from someone else's viral moments.

Main writes one JSON request to stdin. Progress and the result are JSON lines
on stdout (see bridge_runner.emit). Keys come from the environment, like the
clip pipeline: OPENROUTER_API_KEY (required) and PEXELS_API_KEY (optional).
"""
import asyncio
import json
import re
import os
import signal
import sys

from bridge_runner import reserve_stdout_for_protocol, emit

# Render requests carry the brand text and every approved take.
MAX_REQUEST = 4 * 1024 * 1024
STRING_LIMITS = {"output_dir": 4096, "angle": 32, "host": 16, "voice": 32, "avatar_photo": 4096, "order": 16,
                 "brand_identity": 60000, "brand_name": 120, "creator": 120, "caption_preset": 64, "mode": 8,
                 "cta_keyword": 32, "cta_offer": 200,
                 "voice_model": 64, "voice_reference": 4096, "voice_transcript": 4000, "format": 16,
                 "camera_layout": 16, "camera_backdrop": 16, "camera_backdrop_color": 16,
                 "pause_layout": 8, "pause_captions": 8, "presenter": 8}
MAX_RECORDING_DRAFTS = 200
MAX_RECORDED_BEATS = 4
MAX_OFFSET_SECONDS = 3600


def _abs_path(value):
    return isinstance(value, str) and 0 < len(value) <= 4096 and "\0" not in value and os.path.isabs(value)


def parse_recordings(raw, fmt):
    """Recordings keyed by draft id ("0", "1", ...): {"reaction": {"path", "offset_s"}} for Silent react,
    {"intro", "beats", "close"} for a voiced take. Paths are absolute; anything else is rejected."""
    import math
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > MAX_RECORDING_DRAFTS:
        raise ValueError("Invalid recordings")
    out = {}
    for key, item in raw.items():
        if not isinstance(key, str) or not re.fullmatch(r"\d{1,4}", key) or not isinstance(item, dict):
            raise ValueError("Invalid recordings")
        if fmt == "pause_react":
            # One continuous take and the timeline of when the original plays and holds (checked again by the engine).
            from clip_engine.services.pause_react import PauseReactError, parse_timeline
            reaction = item.get("reaction")
            if set(item) != {"reaction", "timeline"} or not isinstance(reaction, dict) or not set(reaction) <= {"path", "offset_s"} \
                    or not _abs_path(reaction.get("path")) or reaction.get("offset_s") not in (None, 0, 0.0):
                raise ValueError("Invalid recordings")
            try:
                parse_timeline(item["timeline"])
            except PauseReactError:
                raise ValueError("Invalid recordings") from None
            out[key] = {"reaction": {"path": reaction["path"], "offset_s": 0.0}, "timeline": item["timeline"]}
        elif fmt == "react_thoughts":
            # Part 1 (watching their clip; offset unknown for a phone video) and part 2 (their thoughts, from its start).
            reaction, thoughts = item.get("reaction"), item.get("thoughts")
            if set(item) != {"reaction", "thoughts"} or not isinstance(reaction, dict) or not set(reaction) <= {"path", "offset_s"} \
                    or not _abs_path(reaction.get("path")) or not isinstance(thoughts, dict) or not set(thoughts) <= {"path", "offset_s"} \
                    or not _abs_path(thoughts.get("path")) or thoughts.get("offset_s") not in (None, 0, 0.0):
                raise ValueError("Invalid recordings")
            offset = reaction.get("offset_s")
            if offset is not None and (isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset)
                                       or not 0 <= offset <= MAX_OFFSET_SECONDS):
                raise ValueError("Invalid recordings")
            out[key] = {"reaction": {"path": reaction["path"], "offset_s": None if offset is None else float(offset)},
                        "thoughts": {"path": thoughts["path"], "offset_s": 0.0}}
        elif fmt in ("silent", "image", "moment_take", "clip_then_me"):
            reaction = item.get("reaction")
            if set(item) != {"reaction"} or not isinstance(reaction, dict) or not set(reaction) <= {"path", "offset_s"} \
                    or not _abs_path(reaction.get("path")):
                raise ValueError("Invalid recordings")
            offset = reaction.get("offset_s")
            if offset is not None and (isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset)
                                       or not 0 <= offset <= MAX_OFFSET_SECONDS):
                raise ValueError("Invalid recordings")
            out[key] = {"reaction": {"path": reaction["path"], "offset_s": None if offset is None else float(offset)}}
        else:
            beats = item.get("beats")
            if set(item) != {"intro", "beats", "close"} or not _abs_path(item.get("intro")) or not _abs_path(item.get("close")) \
                    or not isinstance(beats, list) or len(beats) > MAX_RECORDED_BEATS or not all(_abs_path(b) for b in beats):
                raise ValueError("Invalid recordings")
            out[key] = {"intro": item["intro"], "beats": list(beats), "close": item["close"]}
    return out


def parse_recompose(raw):
    """Mode "recompose": make a finished remix again from its edit bundle with new hook text, captions or split."""
    import math
    from clip_engine.config import CaptionPreset
    from clip_engine.services.remix_service import FINAL_NAME, SPLIT_MAX, SPLIT_MIN, STEM, RecomposeRequest
    from clip_engine.services.rendering_service import validate_headline_look
    root, out, clip = raw.get("output_dir"), raw.get("output_path"), raw.get("clip")
    if not _abs_path(root) or not _abs_path(out) or not out.lower().endswith(".mp4"):
        raise ValueError("Invalid output")
    # The new file goes straight into the run's folder (never into .edit, .work or anywhere else).
    if os.path.dirname(os.path.realpath(out)) != os.path.realpath(root):
        raise ValueError("Invalid output")
    if not isinstance(clip, str) or not STEM.match(clip):
        raise ValueError("Invalid clip")
    headline = raw.get("headline")
    if not isinstance(headline, str) or not headline.strip() or len(headline) > 300 or "\0" in headline:
        raise ValueError("Invalid headline")
    captions = raw.get("include_captions", True)
    presets = {value for key, value in vars(CaptionPreset).items() if not key.startswith("_") and isinstance(value, str)}
    preset = raw.get("caption_preset") or "pop"
    if not isinstance(captions, bool) or preset not in presets:
        raise ValueError("Invalid captions")
    split = raw.get("split")
    if split is not None and (isinstance(split, bool) or not isinstance(split, (int, float)) or not math.isfinite(split)
                              or not SPLIT_MIN <= split <= SPLIT_MAX):
        raise ValueError("Invalid split")
    final_name = raw.get("final_name")
    if final_name is not None and (not isinstance(final_name, str) or not FINAL_NAME.match(final_name)):
        raise ValueError("Invalid final name")
    return RecomposeRequest(output_dir=root, clip=clip, output_path=out, headline=" ".join(headline.split()),
                            headline_look=validate_headline_look(raw.get("headline_look")), include_captions=captions,
                            caption_preset=preset, split=None if split is None else float(split), final_name=final_name)


def parse_pauses(raw):
    """Mode "pauses": work out when the original played and paused in a phone recording (local, no AI)."""
    import math
    if not set(raw) <= {"mode", "recording", "source", "trim_start", "trim_end"}:
        raise ValueError("Invalid request")
    if not _abs_path(raw.get("recording")) or not _abs_path(raw.get("source")):
        raise ValueError("Invalid files")
    numbers = [raw.get("trim_start"), raw.get("trim_end")]
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not 0 <= n <= 4 * 3600 for n in numbers) \
            or numbers[1] - numbers[0] < 0.5:
        raise ValueError("Invalid trim")
    return {"recording": raw["recording"], "source": raw["source"], "trim_start": float(numbers[0]), "trim_end": float(numbers[1])}


def parse_moment(raw):
    """Mode "moment": find another moment in one range of a Moment + my take review (one planning call)."""
    from clip_engine.services.remix_service import RemixConfig
    if not set(raw) <= {"mode", "output_dir", "draft_id"}:
        raise ValueError("Invalid request")
    if not _abs_path(raw.get("output_dir")):
        raise ValueError("Invalid output")
    draft_id = raw.get("draft_id")
    if type(draft_id) is not int or not 0 <= draft_id < 3:
        raise ValueError("Invalid moment")
    return {"config": RemixConfig(output_dir=raw["output_dir"], host="camera", format="moment_take"), "draft_id": draft_id}


def parse_moment_options(raw, fmt, mode):
    """Moment + my take: the ranges (planning), the box option and which takes to write."""
    from clip_engine.services.moment_take import parse_ranges
    if fmt != "moment_take":
        if raw.get("moment_ranges") is not None or raw.get("moment_pip") not in (None, False) or raw.get("write_ids") is not None:
            raise ValueError("Invalid format")
        return [], False, []
    ranges = parse_ranges(raw.get("moment_ranges")) if mode == "plan" else []
    pip = raw.get("moment_pip", False)
    if not isinstance(pip, bool):
        raise ValueError("Invalid format")
    ids = raw.get("write_ids") or []
    if not isinstance(ids, list) or len(ids) > 3 or any(type(i) is not int or not 0 <= i < 3 for i in ids):
        raise ValueError("Invalid format")
    return [list(r) for r in ranges], pip, list(ids)


CLIP_FORMATS = ("clip_then_me", "react_thoughts")


def parse_clip_options(raw, fmt, mode):
    """Their clip, then me / React, then my thoughts: the part of their video used, and (React, then my thoughts) the
    member's own b-roll, stock on or off and the b-roll plan as they left it."""
    import math
    from clip_engine.services import react_thoughts as rt
    keys = ("clip_trim", "broll_items", "broll_stock", "broll_plan")
    if fmt not in CLIP_FORMATS:
        if any(raw.get(k) not in (None, False) for k in keys):
            raise ValueError("Invalid format")
        return None, [], False, None
    trim = raw.get("clip_trim")
    if trim is not None:
        if not isinstance(trim, list) or len(trim) != 2 or any(type(v) is not int or not 0 <= v <= 4 * 3600 * 1000 for v in trim) \
                or not rt.CLIP_MIN_S * 1000 <= trim[1] - trim[0] <= rt.CLIP_MAX_S * 1000 + 50:
            raise ValueError("Invalid trim")
        trim = list(trim)
    if fmt == "clip_then_me":
        if any(raw.get(k) not in (None, False, []) for k in keys[1:]):
            raise ValueError("Invalid format")
        return trim, [], False, None
    stock = raw.get("broll_stock", False)
    if not isinstance(stock, bool):
        raise ValueError("Invalid b-roll")
    items = rt.parse_items(raw.get("broll_items"))
    plan = rt.parse_plan(raw.get("broll_plan"))
    ids = {i["id"] for i in items}
    if plan is not None and any(s["item"] is not None and s["item"] not in ids for s in plan):
        raise ValueError("Invalid b-roll plan")
    if plan is not None and any(not math.isfinite(s["start"]) or s["start"] < 0 or s["end"] > rt.TAKE_MAX_S + 5 for s in plan):
        raise ValueError("Invalid b-roll plan")
    return trim, items, stock, plan


def parse_config(raw):
    from clip_engine.services.remix_service import (ANGLES, CAMERA_BACKDROPS, CAMERA_LAYOUTS, DEFAULT_VOICE, IMAGE_EXTENSIONS, HOSTS, MAX_REMIXES, MAX_SOURCES, ORDERS, PAUSE_CAPTIONS,
                                                    PAUSE_LAYOUTS, REACTION_KINDS, TTS_MODEL,
                                                    TTS_MODELS, VOICES, RemixConfig, normalize_keyword)
    if not isinstance(raw, dict):
        raise ValueError("Invalid request")
    if raw.get("mode") == "recompose":
        return parse_recompose(raw)
    if raw.get("mode") == "pauses":
        return parse_pauses(raw)
    if raw.get("mode") == "moment":
        return parse_moment(raw)
    for key, limit in STRING_LIMITS.items():
        value = raw.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > limit or "\0" in value):
            raise ValueError(f"Invalid {key}")
    if raw.get("mode", "plan") not in ("plan", "render", "write", "broll"):
        raise ValueError("Invalid mode")
    sources = raw.get("sources") or []
    if raw.get("mode", "plan") == "plan" and (not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES or any(
            not isinstance(s, str) or not s or len(s) > 8192 or "\0" in s for s in sources)):
        raise ValueError("Invalid sources")
    if raw.get("order", "moment_first") not in ORDERS:
        raise ValueError("Invalid order")
    if not isinstance(raw.get("output_dir"), str) or not os.path.isabs(raw["output_dir"]):
        raise ValueError("Invalid output")
    photo = raw.get("avatar_photo")
    if photo is not None and not os.path.isabs(photo):
        raise ValueError("Invalid avatar photo")
    angle = raw.get("angle") or ("reaction" if raw.get("format") in ("image", "pause_react", "moment_take", *CLIP_FORMATS) else None)
    if angle not in ANGLES or raw.get("host") not in HOSTS:
        raise ValueError("Invalid style")
    count = raw.get("count", 3)
    if type(count) is not int or not 1 <= count <= MAX_REMIXES:
        raise ValueError("Invalid count")
    voice_model = raw.get("voice_model") or TTS_MODEL
    voice = raw.get("voice") or DEFAULT_VOICE
    reference = raw.get("voice_reference")
    if voice_model not in TTS_MODELS or voice not in VOICES or (reference is not None and not os.path.isabs(reference)):
        raise ValueError("Invalid voice")
    fmt = raw.get("format") or "commentary"
    reactions = raw.get("reactions") or {}
    # An article or post: written from the member's recording ("write"), then rendered; never planned.
    mode = raw.get("mode", "plan")
    if (fmt == "image" and mode == "plan") or (mode == "write" and fmt not in ("image", "pause_react", "moment_take", *CLIP_FORMATS)) \
            or (mode == "broll" and fmt != "react_thoughts"):
        raise ValueError("Invalid format")
    if fmt in CLIP_FORMATS and (raw.get("host") != "camera" or (mode == "plan" and len(sources) != 1)):
        raise ValueError("Invalid format")
    clip_trim, broll_items, broll_stock, broll_plan = parse_clip_options(raw, fmt, mode)
    if fmt == "moment_take" and (raw.get("host") != "camera" or (mode == "plan" and len(sources) != 1)):
        raise ValueError("Invalid format")
    moment_ranges, moment_pip, write_ids = parse_moment_options(raw, fmt, mode)
    if fmt == "pause_react" and (raw.get("host") != "camera" or (mode == "plan" and len(sources) != 1)
                                 or (raw.get("pause_layout") or "box") not in PAUSE_LAYOUTS or (raw.get("pause_captions") or "member") not in PAUSE_CAPTIONS):
        raise ValueError("Invalid format")
    image_source = None
    if fmt == "image":
        image_source = raw.get("image_source")
        credit = image_source.get("credit", "") if isinstance(image_source, dict) else None
        if raw.get("host") != "camera" or not isinstance(image_source, dict) or not set(image_source) <= {"path", "credit"} \
                or not _abs_path(image_source.get("path")) or not image_source["path"].lower().endswith(IMAGE_EXTENSIONS) \
                or not isinstance(credit, str) or len(credit) > 120 or "\0" in credit:
            raise ValueError("Invalid image source")
        image_source = {"path": image_source["path"], "credit": " ".join(credit.split())}
    elif raw.get("image_source") is not None:
        raise ValueError("Invalid image source")
    if fmt not in ("commentary", "silent", "image", "pause_react", "moment_take", *CLIP_FORMATS) or not isinstance(reactions, dict) or any(
            k not in REACTION_KINDS or not isinstance(v, str) or len(v) > 4096 or "\0" in v or not os.path.isabs(v) for k, v in reactions.items()):
        raise ValueError("Invalid format")
    layout = raw.get("camera_layout") or ("greenscreen" if fmt == "image" else "filmed")
    backdrop = raw.get("camera_backdrop") or "blur"
    color = raw.get("camera_backdrop_color") or "#111111"
    if layout not in CAMERA_LAYOUTS or backdrop not in CAMERA_BACKDROPS or not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise ValueError("Invalid camera layout")
    talk = raw.get("camera_talk", False)
    if talk is not None and not isinstance(talk, bool):
        raise ValueError("Invalid camera talk")
    recordings = parse_recordings(raw.get("recordings"), fmt)
    presenter, heygen_voice, heygen_price = parse_presenter(raw, fmt)
    from clip_engine.services.rendering_service import validate_headline_look
    from clip_engine.services.brand_mark import validate_brand_mark
    headline_look = validate_headline_look(raw.get("headline_look"))
    try:
        keyword = normalize_keyword(raw.get("cta_keyword"))
    except ValueError:
        raise ValueError("Invalid call-to-action keyword") from None
    return RemixConfig(
        sources=list(sources), output_dir=raw["output_dir"], angle=angle, count=count, host=raw["host"],
        order=raw.get("order") or "moment_first",
        voice=voice, voice_model=voice_model, voice_reference=reference, voice_transcript=raw.get("voice_transcript") or "",
        avatar_photo=photo, brand_identity=raw.get("brand_identity") or "",
        brand_name=raw.get("brand_name") or "", creator=raw.get("creator") or "",
        caption_preset=raw.get("caption_preset") or "pop", include_captions=raw.get("include_captions") is not False,
        format=fmt, reactions=dict(reactions), reactions_ai=raw.get("reactions_ai") is not False,
        cta_keyword=keyword, cta_offer=" ".join((raw.get("cta_offer") or "").split())[:80],
        headline_look=headline_look, cta_clip=raw.get("cta_clip") is True,
        camera_layout=layout, camera_backdrop=backdrop, camera_backdrop_color=color.upper(), camera_talk=talk is True,
        recordings=recordings, image_source=image_source, brand_mark=validate_brand_mark(raw.get("brand_mark")),
        pause_layout=raw.get("pause_layout") or "box", pause_captions=raw.get("pause_captions") or "member",
        moment_ranges=moment_ranges, moment_pip=moment_pip, write_ids=write_ids,
        clip_trim=clip_trim, broll_items=broll_items, broll_stock=broll_stock, broll_plan=broll_plan,
        presenter=presenter, heygen_voice=heygen_voice, heygen_usd_per_second=heygen_price,
    )


def parse_presenter(raw, fmt):
    """Avatar on camera (host "lipsync") made on HeyGen by the app: presenter "heygen", whether the avatar speaks in its
    HeyGen voice, and HeyGen's published price per second (or None) for estimates. Voiced takes only."""
    import math
    presenter = raw.get("presenter") or ""
    voice = raw.get("heygen_voice", False)
    price = raw.get("heygen_usd_per_second")
    if presenter not in ("", "heygen") or not isinstance(voice, bool):
        raise ValueError("Invalid presenter")
    if price is not None and (isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or not 0 <= price <= 10):
        raise ValueError("Invalid presenter")
    if presenter and (raw.get("host") != "lipsync" or fmt != "commentary"):
        raise ValueError("Invalid presenter")
    return presenter, voice and bool(presenter), None if price is None else float(price)


class HeygenLines:
    """The app makes HeyGen videos (it holds the key): a request goes out as a protocol line
    {"type": "heygen", "id", "key", "audio", "text", "out", "label"}, and the app answers on stdin with
    {"type": "heygen_result", "id", "ok", "path"} or {"ok": false, "error", "stop_all"}. Lines are read on a thread."""

    def __init__(self, stream):
        self.stream = stream
        self.loop = None
        self.pending = {}
        self.count = 0
        self.closed = False

    def start(self, loop):
        import threading
        self.loop = loop
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.stream:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("type") == "heygen_result" and type(message.get("id")) is int:
                self.loop.call_soon_threadsafe(self._settle, message["id"], message)
        self.loop.call_soon_threadsafe(self._close)

    def _settle(self, ident, message):
        future = self.pending.pop(ident, None)
        if future is not None and not future.done():
            future.set_result(message)

    def _close(self):
        self.closed = True
        for ident in list(self.pending):
            self._settle(ident, {"ok": False, "error": "The app stopped waiting for HeyGen."})

    async def __call__(self, *, key, audio, text, out, label):
        from clip_engine.services.remix_service import RemixError
        if self.closed:
            raise RemixError("The app stopped waiting for HeyGen.")
        self.count += 1
        ident = self.count
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        emit({"type": "heygen", "id": ident, "key": str(key)[:16], "audio": audio, "text": text, "out": out, "label": str(label)[:80]})
        message = await future
        if message.get("ok") is not True:
            error = RemixError(str(message.get("error") or "HeyGen could not make this video. Try again.")[:400])
            error.stop_all = message.get("stop_all") is True
            raise error
        return {"path": message.get("path")}


def spent_usd(remixers) -> float:
    """What this run's paid calls cost so far (planning, transcription, writing, voice and video), failed or not."""
    total = 0.0
    for remixer in remixers:
        for cost in (getattr(remixer, "cost_usd", 0), getattr(getattr(remixer, "media", None), "cost_usd", 0)):
            if isinstance(cost, (int, float)) and not isinstance(cost, bool) and cost == cost and 0 < cost < 1e6:
                total += float(cost)
    return round(total, 4)


def failure_line(message: str, remixers) -> dict:
    """The failure line, with what paid calls cost before the failure, so it still reaches the spending ledger."""
    line = {"ok": False, "error": message or "failed"}
    cost = spent_usd(remixers)
    if cost > 0:
        line["cost_usd"] = cost
    return line


def main():
    reserve_stdout_for_protocol()
    remixers = []
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        # One line (the app keeps stdin open for HeyGen answers when the presenter is on HeyGen), or all of it.
        raw = sys.stdin.readline(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError("Request too large")
        raw_request = json.loads(raw)
        config = parse_config(raw_request)
        os.environ["LOCAL_MODE"] = "true"
        from network_guard import install
        install()
        from clip_engine.services.remix_service import Remixer

        def progress(detail, percent):
            emit({"type": "progress", "detail": str(detail)[:160], "percent": max(0, min(100, float(percent)))})

        async def work():
            task = asyncio.current_task()
            if os.name != "nt":
                asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
            if raw_request.get("mode") == "recompose":
                from clip_engine.services.remix_service import recompose
                return await recompose(config, progress)
            if raw_request.get("mode") == "moment":
                remixers.append(Remixer(config["config"], progress))
                return await remixers[-1].pick_another(config["draft_id"])
            if raw_request.get("mode") == "pauses":
                from clip_engine.services.pause_react import detect_pauses
                return {"detection": await asyncio.to_thread(detect_pauses, config["recording"], config["source"],
                                                             config["trim_start"], config["trim_end"])}
            presenter = None
            if raw_request.get("mode") == "render" and getattr(config, "presenter", "") == "heygen":
                presenter = HeygenLines(sys.stdin)
                presenter.start(asyncio.get_running_loop())
            remixer = Remixer(config, progress, presenter=presenter)
            remixers.append(remixer)
            if raw_request.get("mode") == "render":
                approved = raw_request.get("approved")
                if not isinstance(approved, list) or len(approved) > 200:
                    raise ValueError("Invalid approval list")
                return await remixer.render(approved)
            if raw_request.get("mode") == "write":
                return await remixer.write()
            if raw_request.get("mode") == "broll":
                return await remixer.replan_broll()
            return await remixer.plan()

        result = asyncio.run(work())
        emit({"ok": True, **result})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        from clip_engine.services.remix_service import RemixError
        from bridge_runner import describe_failure
        from clip_engine.services.pause_react import PauseReactError
        from clip_engine.services.moment_take import MomentTakeError
        from clip_engine.services.react_thoughts import ReactTemplateError
        if isinstance(error, (RemixError, PauseReactError, MomentTakeError, ReactTemplateError)):
            message = str(error)
        elif isinstance(error, asyncio.CancelledError):
            message = "Cancelled"
        else:
            # Download and transcription failures get the same plain-language
            # explanations as the clip pipeline.
            described = describe_failure(error)
            if described["message"] == "The clipping pipeline failed.":
                # Say what went wrong (first line, no local paths), so it can be acted on or reported.
                from clip_engine.logging_safety import safe_log_text
                first = (str(error).strip().splitlines() or [type(error).__name__])[0]
                # No paths, links or credentials: the shared redactor, then a short first line.
                first = safe_log_text(first).strip()[:220]
                message = f"The remix could not be made: {first or type(error).__name__}"
            else:
                message = f"{described['message']} {described['hint']}"
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f"Remix failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}", file=sys.stderr)
        except Exception:
            pass
        emit(failure_line(message, remixers))
        return 1


if __name__ == "__main__":
    sys.exit(main())
