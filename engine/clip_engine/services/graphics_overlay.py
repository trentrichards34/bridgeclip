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
RENDER_FILE = re.compile(r"[a-f0-9]{64}\.mov")
MAX_GRAPHICS = 12
MIN_MS = 100


def checked_graphics(run: Path, raw: object, clip_ms: int) -> list[dict]:
    """The graphics main asked for, validated: known render files in the run's .graphics/ folder, inside the clip.

    A graphic past the clip's end is dropped; one running over it is trimmed.
    """
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_GRAPHICS:
        raise ValueError("Invalid graphics")
    folder = run / GRAPHICS_DIR
    if folder.is_symlink():
        raise ValueError("Invalid graphics folder")
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
        if start >= clip_ms - MIN_MS:
            continue
        out.append({"path": str(path), "start_ms": start, "duration_ms": min(length, clip_ms - start)})
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
