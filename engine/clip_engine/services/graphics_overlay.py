"""Layer the clip editor's motion graphics over a finished render.

Main draws each graphic with our own templates into a transparent QuickTime
Animation (.mov, ARGB) in the run's ``.graphics/`` folder, and works out where
it plays in the finished clip (output time: through the cut and the export
speed, with cut-out parts dropped). Here each one is placed full-frame over the
clip from its start for its length. The graphic's band already keeps it clear
of the hook and the captions, so there is nothing to position.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS

GRAPHICS_DIR = ".graphics"
# Renders made for Edit my recording and Remix (the clip editor's sweep leaves this folder alone).
REEL_DIR = "reel"
RENDER_FILE = re.compile(r"[a-f0-9]{64}\.mov")
MAX_GRAPHICS = 12
MIN_MS = 100
# How big main drew a graphic: absent is the usual card; "stage" takes the top ~55% of a 9:16 frame.
SIZES = ("compact", "card", "stage")


def checked_graphics(run: Path, raw: object, clip_ms: int, sub: str = "") -> list[dict]:
    """The graphics main asked for, validated: known render files in the run's .graphics/ folder (or `sub` in it),
    inside the clip.

    A graphic past the clip's end is dropped; one running over it is trimmed. An optional "size" ("compact",
    "card" or "stage") is kept so a stage scene can make room for a stage-size graphic.
    """
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_GRAPHICS:
        raise ValueError("Invalid graphics")
    if sub not in ("", REEL_DIR):
        raise ValueError("Invalid graphics folder")
    folder = run / GRAPHICS_DIR
    if folder.is_symlink() or (sub and (folder / sub).is_symlink()):
        raise ValueError("Invalid graphics folder")
    folder = folder / sub if sub else folder
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid graphic")
        name, start, length = item.get("file"), item.get("start_ms"), item.get("duration_ms")
        if not isinstance(name, str) or not RENDER_FILE.fullmatch(name) or type(start) is not int or type(length) is not int:
            raise ValueError("Invalid graphic")
        if start < 0 or length < MIN_MS or length > 60_000:
            raise ValueError("Invalid graphic time")
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("A graphic's render is missing")
        size = item.get("size")
        if size is not None and size not in SIZES:
            raise ValueError("Invalid graphic size")
        if start >= clip_ms - MIN_MS:
            continue
        out.append({"path": str(path), "start_ms": start, "duration_ms": min(length, clip_ms - start), **({"size": size} if size else {})})
    return sorted(out, key=lambda g: g["start_ms"])


def overlay_command(video: str, graphics: Iterable[dict], output: str, width: int, height: int, codec: list[str]) -> list[str]:
    """FFmpeg: the clip with each graphic laid over it at its time (audio copied)."""
    graphics = list(graphics)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", *MEDIA_INPUT_OPTIONS, "-i", video]
    parts, last = [], "[0:v]"
    for i, g in enumerate(graphics, start=1):
        start, end = g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", g["path"]]
        # Shift the graphic to its start, scale it to the frame (renders are made at the output size), keep its alpha.
        parts.append(f"[{i}:v]format=argb,scale={width}:{height},setpts=PTS-STARTPTS+{start:.3f}/TB[g{i}]")
        label = f"[v{i}]"
        parts.append(f"{last}[g{i}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'{label}")
        last = label
    parts.append(f"{last}format=yuv420p[vout]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "0:a?", "-c:a", "copy", *codec,
            "-movflags", "+faststart", output]
    return cmd


def overlay_graphics_file(video: str, graphics: list[dict], width: int, height: int, codec: list[str], run_cmd) -> None:
    """Replace `video` with a copy that has the graphics laid over it (`run_cmd` runs the FFmpeg command)."""
    if not graphics:
        return
    output = f"{video}.graphics.mp4"
    try:
        run_cmd(overlay_command(video, graphics, output, width, height, codec))
        os.replace(output, video)
    finally:
        if os.path.exists(output):
            os.remove(output)


def overlapping(start_ms: int, length_ms: int, windows: Iterable[tuple[float, float]]) -> bool:
    """Whether [start, start + length) (ms) overlaps any of `windows` (seconds)."""
    a, b = start_ms / 1000, (start_ms + length_ms) / 1000
    return any(a < hi and b > lo for lo, hi in windows)


async def overlay_graphics(renderer, video: str, graphics: list[dict]) -> None:
    """Replace `video` with a copy that has the graphics laid over it."""
    if not graphics:
        return
    width, height = await renderer._get_video_dimensions(video)
    fps = await renderer._probe_fps(video)
    output = f"{video}.graphics.mp4"
    try:
        await renderer._run_cmd(overlay_command(video, graphics, output, width, height, renderer._video_codec_args(width, height, fps)))
        os.replace(output, video)
    finally:
        if os.path.exists(output):
            os.remove(output)


async def overlay_run_clips(run: Path, clips: list, progress=None) -> dict:
    """Motion graphics: Auto, after a Create run: lay each clip's rendered graphics over its finished file.

    `clips` is [{clip_index, graphics: [{file, start_ms, duration_ms}]}] from main (start times are the
    finished clip's own). A clip that fails keeps its file as made; the others go on. Returns the clip
    indices done and failed.
    """
    from clip_engine.services.manual_editor import source_info
    from clip_engine.services.rendering_service import RenderingService
    if not isinstance(clips, list) or len(clips) > 100:
        raise ValueError("Invalid clips")
    renderer = RenderingService()
    done, failed, seen = [], [], set()
    for n, item in enumerate(clips):
        index = item.get("clip_index") if isinstance(item, dict) else None
        if type(index) is not int or not 0 <= index <= 999 or index in seen:
            raise ValueError("Invalid clip")
        seen.add(index)
        video = run / f"clip_{index:02d}.mp4"
        ok = False
        try:
            if video.is_symlink() or not video.is_file():
                raise ValueError("The clip is missing")
            clip_ms = round(source_info(video)["duration"])
            await overlay_graphics(renderer, str(video), checked_graphics(run, item.get("graphics"), clip_ms))
            done.append(index)
            ok = True
        except Exception as error:  # noqa: BLE001 - one clip's graphics never stop the others
            import logging
            logging.getLogger(__name__).warning("Graphics could not be laid over clip %s (%s)", index + 1, type(error).__name__)
            failed.append(index)
        if progress:
            progress(index, ok, n + 1, len(clips))
    return {"done": done, "failed": failed}
