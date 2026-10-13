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
STRING_LIMITS = {"source": 8192, "output_dir": 4096, "angle": 32, "host": 16, "voice": 32, "avatar_photo": 4096,
                 "brand_identity": 60000, "brand_name": 120, "creator": 120, "caption_preset": 64}


def parse_config(raw):
    from clip_engine.services.remix_service import ANGLES, HOSTS, MAX_REMIXES, RemixConfig
    if not isinstance(raw, dict):
        raise ValueError("Invalid request")
    for key, limit in STRING_LIMITS.items():
        value = raw.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > limit or "\0" in value):
            raise ValueError(f"Invalid {key}")
    if not raw.get("source") or not isinstance(raw.get("output_dir"), str) or not os.path.isabs(raw["output_dir"]):
        raise ValueError("Invalid source or output")
    photo = raw.get("avatar_photo")
    if photo is not None and not os.path.isabs(photo):
        raise ValueError("Invalid avatar photo")
    if raw.get("angle") not in ANGLES or raw.get("host") not in HOSTS:
        raise ValueError("Invalid style")
    count = raw.get("count", 3)
    if type(count) is not int or not 1 <= count <= MAX_REMIXES:
        raise ValueError("Invalid count")
    return RemixConfig(
        source=raw["source"], output_dir=raw["output_dir"], angle=raw["angle"], count=count, host=raw["host"],
        voice=raw.get("voice") or "onyx", avatar_photo=photo, brand_identity=raw.get("brand_identity") or "",
        brand_name=raw.get("brand_name") or "", creator=raw.get("creator") or "",
        caption_preset=raw.get("caption_preset") or "pop", include_captions=raw.get("include_captions") is not False,
    )


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError("Request too large")
        config = parse_config(json.loads(raw))
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
            return await Remixer(config, progress).run()

        result = asyncio.run(work())
        emit({"ok": True, **result})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        from clip_engine.services.remix_service import RemixError
        message = str(error) if isinstance(error, RemixError) else None
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f"Remix failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}", file=sys.stderr)
        except Exception:
            pass
        emit({"ok": False, "error": message or "failed"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
