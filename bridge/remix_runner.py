"""Remix runner: commentary videos from someone else's viral moments.

Main writes one JSON request to stdin. Progress and the result are JSON lines
on stdout (see bridge_runner.emit). Keys come from the environment, like the
clip pipeline: OPENROUTER_API_KEY (required) and PEXELS_API_KEY (optional).
"""
import asyncio
import json
import os
import signal
import sys

from bridge_runner import reserve_stdout_for_protocol, emit

MAX_REQUEST = 262144
STRING_LIMITS = {"output_dir": 4096, "angle": 32, "host": 16, "voice": 32, "avatar_photo": 4096, "order": 16,
                 "brand_identity": 60000, "brand_name": 120, "creator": 120, "caption_preset": 64, "mode": 8,
                 "cta_keyword": 32, "cta_offer": 200}


def parse_config(raw):
    from clip_engine.services.remix_service import ANGLES, HOSTS, MAX_REMIXES, MAX_SOURCES, ORDERS, RemixConfig, normalize_keyword
    if not isinstance(raw, dict):
        raise ValueError("Invalid request")
    for key, limit in STRING_LIMITS.items():
        value = raw.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > limit or "\0" in value):
            raise ValueError(f"Invalid {key}")
    if raw.get("mode", "plan") not in ("plan", "render"):
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
    if raw.get("angle") not in ANGLES or raw.get("host") not in HOSTS:
        raise ValueError("Invalid style")
    count = raw.get("count", 3)
    if type(count) is not int or not 1 <= count <= MAX_REMIXES:
        raise ValueError("Invalid count")
    try:
        keyword = normalize_keyword(raw.get("cta_keyword"))
    except ValueError:
        raise ValueError("Invalid call-to-action keyword") from None
    return RemixConfig(
        sources=list(sources), output_dir=raw["output_dir"], angle=raw["angle"], count=count, host=raw["host"],
        order=raw.get("order") or "moment_first",
        voice=raw.get("voice") or "onyx", avatar_photo=photo, brand_identity=raw.get("brand_identity") or "",
        brand_name=raw.get("brand_name") or "", creator=raw.get("creator") or "",
        caption_preset=raw.get("caption_preset") or "pop", include_captions=raw.get("include_captions") is not False,
        cta_keyword=keyword, cta_offer=" ".join((raw.get("cta_offer") or "").split())[:80],
    )


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(MAX_REQUEST + 1)
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
            remixer = Remixer(config, progress)
            if raw_request.get("mode") == "render":
                approved = raw_request.get("approved")
                if not isinstance(approved, list) or len(approved) > 200:
                    raise ValueError("Invalid approval list")
                return await remixer.render(approved)
            return await remixer.plan()

        result = asyncio.run(work())
        emit({"ok": True, **result})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        from clip_engine.services.remix_service import RemixError
        from bridge_runner import describe_failure
        if isinstance(error, RemixError):
            message = str(error)
        elif isinstance(error, asyncio.CancelledError):
            message = "Cancelled"
        else:
            # Download and transcription failures get the same plain-language
            # explanations as the clip pipeline.
            described = describe_failure(error)
            message = None if described["message"] == "The clipping pipeline failed." else f"{described['message']} {described['hint']}"
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f"Remix failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}", file=sys.stderr)
        except Exception:
            pass
        emit({"ok": False, "error": message or "failed"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
