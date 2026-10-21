"""Layer the clip editor's motion graphics over a finished render.

Main draws each graphic with our own templates into a transparent QuickTime
Animation (.mov, ARGB) in the run's ``.graphics/`` folder, and works out where
it plays in the finished clip (output time: through the cut and the export
speed, with cut-out parts dropped). Here each one is placed full-frame over the
clip from its start for its length. The graphic's band already keeps it clear
of the hook and the captions, so there is nothing to position.

A graphic with depth "behind" sits in the scene, behind the speaker: the clip,
then the graphic, then the speaker cut out of the same frames (the selfie
segmentation matte, segmentation.py) on top, only while it plays. The matte is
made for those windows only, and kept per clip in the graphics folder's
``mattes/`` (named by the clip's bytes and the window), so laying the same clip
again reuses it. Without the cut-out model (or when it fails) the graphic is
laid in front, as before.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Iterable, Optional

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS

GRAPHICS_DIR = ".graphics"
# Renders made for Edit my recording and Remix (the clip editor's sweep leaves this folder alone).
REEL_DIR = "reel"
RENDER_FILE = re.compile(r"[a-f0-9]{64}\.mov")
MAX_GRAPHICS = 12
MIN_MS = 100
# How big main drew a graphic: absent is the usual card; "stage" takes the top ~55% of a 9:16 frame.
SIZES = ("compact", "card", "stage")
# In front of the video (the default) or behind the speaker.
DEPTHS = ("front", "behind")
MATTES_DIR = "mattes"
# Mattes kept per graphics folder (the newest; older ones are removed).
MAX_MATTES = 24
# Mattes for text behind the speaker are cut at a finer size than "Me, on camera" (hair edges over big letters).
BEHIND_MATTE_EDGE = 1280
# Bump when the matte's look changes, so kept mattes are made again.
MATTE_VERSION = 2

logger = logging.getLogger(__name__)


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
        depth = item.get("depth")
        if depth is not None and depth not in DEPTHS:
            raise ValueError("Invalid graphic depth")
        if start >= clip_ms - MIN_MS:
            continue
        out.append({"path": str(path), "start_ms": start, "duration_ms": min(length, clip_ms - start), **({"size": size} if size else {}),
                    **({"depth": "behind"} if depth == "behind" else {})})
    return sorted(out, key=lambda g: g["start_ms"])


def behind_windows(graphics: Iterable[dict]) -> list[tuple[int, int]]:
    """The output windows (start_ms, end_ms) graphics behind the speaker play in, overlapping ones merged."""
    spans = sorted((g["start_ms"], g["start_ms"] + g["duration_ms"]) for g in graphics if g.get("depth") == "behind")
    merged: list[tuple[int, int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def overlay_command(video: str, graphics: Iterable[dict], output: str, width: int, height: int, codec: list[str],
                    mattes: Optional[list[dict]] = None) -> list[str]:
    """FFmpeg: the clip with each graphic laid over it at its time (audio copied).

    `mattes` ([{"path", "start_ms", "duration_ms"}], one per behind window): the graphics behind the speaker go on
    first, then the speaker, cut out of the clip's own frames with each window's matte, then the others. Without
    mattes every graphic is laid over the clip in time order.
    """
    graphics = list(graphics)
    mattes = list(mattes or [])
    if mattes:
        # Behind the speaker first; the speaker; then the rest (each group in time order).
        graphics = [g for g in graphics if g.get("depth") == "behind"] + [g for g in graphics if g.get("depth") != "behind"]
    behind = sum(1 for g in graphics if g.get("depth") == "behind") if mattes else 0
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", *MEDIA_INPUT_OPTIONS, "-i", video]
    for g in graphics:
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", g["path"]]
    for m in mattes:
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", m["path"]]
    parts: list[str] = []
    last = "[0:v]"
    if mattes:
        # The clip's frames are used again for the cut-out: one copy for the picture, one per window.
        parts.append(f"[0:v]split={len(mattes) + 1}[base]" + "".join(f"[src{k}]" for k in range(len(mattes))))
        last = "[base]"

    def lay(i: int, g: dict) -> None:
        nonlocal last
        start, end = g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000
        # Shift the graphic to its start, scale it to the frame (renders are made at the output size), keep its alpha.
        parts.append(f"[{i}:v]format=argb,scale={width}:{height},setpts=PTS-STARTPTS+{start:.3f}/TB[g{i}]")
        parts.append(f"{last}[g{i}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[v{i}]")
        last = f"[v{i}]"

    for i, g in enumerate(graphics[:behind], start=1):
        lay(i, g)
    for k, m in enumerate(mattes):
        start, end = m["start_ms"] / 1000, (m["start_ms"] + m["duration_ms"]) / 1000
        # The window's own frames with its matte (made smaller: scaled up smoothly) as their alpha, back at the window's time.
        parts.append(f"[src{k}]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS,format=yuva444p[pv{k}]")
        parts.append(f"[{len(graphics) + 1 + k}:v]scale={width}:{height}:flags=bicubic,format=gray,setpts=PTS-STARTPTS[pm{k}]")
        parts.append(f"[pv{k}][pm{k}]alphamerge,setpts=PTS+{start:.3f}/TB[person{k}]")
        parts.append(f"{last}[person{k}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[p{k}]")
        last = f"[p{k}]"
    for i, g in enumerate(graphics[behind:], start=behind + 1):
        lay(i, g)
    parts.append(f"{last}format=yuv420p[vout]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "0:a?", "-c:a", "copy", *codec,
            "-movflags", "+faststart", output]
    return cmd


def _file_digest(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _video_rate(video: str) -> tuple[int, int, str]:
    """The clip's frame size and rate ("30000/1001")."""
    import json
    from clip_engine.services.media_process import run_media
    result = run_media(["ffprobe", "-v", "error", *MEDIA_INPUT_OPTIONS, "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate", "-of", "json", video], timeout=60, check=True)
    stream = json.loads(result.stdout)["streams"][0]
    rate = str(stream.get("r_frame_rate") or "30")
    if not re.fullmatch(r"\d{1,6}(/\d{1,6})?", rate) or rate.endswith("/0") or rate.startswith("0"):
        rate = "30"
    return int(stream["width"]), int(stream["height"]), rate


def _prune_mattes(folder: Path, keep: set[str]) -> None:
    try:
        files = sorted((p for p in folder.iterdir() if p.is_file() and not p.is_symlink()), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    for path in files[MAX_MATTES:]:
        if path.name not in keep:
            try:
                path.unlink()
            except OSError:
                pass


def behind_mattes(video: str, graphics: list[dict], cache: Optional[Path] = None) -> list[dict]:
    """The speaker's matte for each window a graphic plays behind them: [{"path", "start_ms", "duration_ms"}].

    Made only for those windows, and kept in `cache` (default: the graphics folder's mattes/) under the clip's bytes
    and the window, so the same clip laid again reuses them. Empty (the graphics then go in front) when there is no
    behind graphic, the cut-out model isn't available, or making a matte fails."""
    windows = behind_windows(graphics)
    if not windows:
        return []
    from clip_engine.services import segmentation
    if not segmentation.available():
        logger.warning("Text behind the speaker was laid in front: background removal is not available")
        return []
    try:
        folder = cache or Path(next(g["path"] for g in graphics if g.get("depth") == "behind")).parent / MATTES_DIR
        if folder.is_symlink():
            raise ValueError("Invalid mattes folder")
        folder.mkdir(mode=0o700, exist_ok=True)
        width, height, rate = _video_rate(video)
        digest = _file_digest(video)[:32]
        out, names = [], set()
        for a, b in windows:
            name = f"{digest}-{a}-{b - a}-v{MATTE_VERSION}.mkv"
            path = folder / name
            names.add(name)
            if path.is_symlink():
                raise ValueError("Invalid matte")
            if not path.is_file() or path.stat().st_size < 64:
                partial = folder / f".tmp-{os.getpid()}-{name}"
                try:
                    segmentation.write_matte(video, str(partial), width, height, rate, start=a / 1000, duration=(b - a) / 1000,
                                             max_edge=BEHIND_MATTE_EDGE, refine=True)
                    os.replace(partial, path)
                finally:
                    if partial.exists():
                        partial.unlink()
            else:
                os.utime(path)
            out.append({"path": str(path), "start_ms": a, "duration_ms": b - a})
        _prune_mattes(folder, names)
        return out
    except Exception as error:  # noqa: BLE001 - the graphics still go on, in front
        logger.warning(f"Text behind the speaker was laid in front: {type(error).__name__}: {error}")
        return []


def overlay_graphics_file(video: str, graphics: list[dict], width: int, height: int, codec: list[str], run_cmd) -> None:
    """Replace `video` with a copy that has the graphics laid over it (`run_cmd` runs the FFmpeg command)."""
    if not graphics:
        return
    output = f"{video}.graphics.mp4"
    try:
        run_cmd(overlay_command(video, graphics, output, width, height, codec, behind_mattes(video, graphics)))
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
    import asyncio
    width, height = await renderer._get_video_dimensions(video)
    fps = await renderer._probe_fps(video)
    mattes = await asyncio.to_thread(behind_mattes, video, graphics)
    output = f"{video}.graphics.mp4"
    try:
        await renderer._run_cmd(overlay_command(video, graphics, output, width, height, renderer._video_codec_args(width, height, fps), mattes))
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
