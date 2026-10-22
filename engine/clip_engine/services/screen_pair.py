"""Camera + screen: a talking-head recording and a screen recording made at the same time, as one vertical reel.

The two files are lined up by their sound (the screen recording usually hears the same voice through the laptop's
microphone), or by when each file says it was made when the screen recording has no sound; the member can nudge the
offset. The reel is cut like any edited recording (Edit my recording's plan and review), and each kept stretch of
both recordings goes side by side into one wide "canvas" video: the camera on the left (upright, framed around the
face) and the screen on the right (fitted into a square over a blurred copy of itself). That canvas is the clip
editor's source, so every layout is a crop of it the editor already knows how to draw:

- screen_top: split, the screen on top (about 45%) and the face below, captions on the line between them;
- face_top: the same, the other way round;
- face: the camera alone, full frame;
- screen: the whole screen fitted over a blurred copy of itself ("inset");
- bubble: the screen fitted, the face in a round bubble over its lower corner.

The first layout per stretch is picked here (the face for the hook and the call to action, the screen alone where
it changes a lot while the speaker talks about it, the member's style everywhere else); the member switches any
stretch afterwards in the clip editor, or asks the editor's chat.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional, Sequence

from clip_engine.services.edit_recording import EditError
from clip_engine.services.media_process import run_media

logger = logging.getLogger(__name__)

FPS = 30
OUT_W, OUT_H = 1080, 1920
# The canvas: the camera region (upright 9:16) and the screen region (a square, so the screen fits any panel shape).
CAM_W, CAM_H = 1080, 1920
SCREEN_BOX = 1920
CANVAS_W, CANVAS_H = CAM_W + SCREEN_BOX, max(CAM_H, SCREEN_BOX)

STYLES = ("screen_top", "face_top", "bubble")
KINDS = ("screen_top", "face_top", "face", "screen", "bubble")
FITS = ("fit", "cover")
SPLIT_RANGE = (0.3, 0.7)
DEFAULT_SPLIT = 0.45
# Sync: sound at SYNC_RATE for the fine step, an onset envelope at ENV_RATE for the coarse one.
SYNC_RATE = 8000
ENV_RATE = 100
MAX_SYNC_SECONDS = 30 * 60
MAX_OFFSET_MS = 30 * 60 * 1000
# Below this the sound didn't line up clearly: the files' times are used instead.
MIN_CONFIDENCE = 0.35
# Layout plan.
MIN_SECTION_MS = 1200
HOOK_FACE_MS = (1500, 4000)
DEFAULT_HOOK_FACE_MS = 2000
ACTIVE_LEVEL = 2.0
MIN_SCREEN_MS = 2500
ZOOM_MIN_SECTION_MS = 3000
MAX_SCENES = 60
# Words that point at what's on the screen ("this", "click here"): with a lot changing, the screen goes full.
SCREEN_CUES = frozenset({"this", "these", "here", "see", "look", "click", "watch", "screen", "button", "page", "tab", "menu",
                         "scroll", "open", "select", "drag", "type", "settings", "dashboard", "notice"})
VIDEO_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS)]
MEDIA_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts,concat,wav"]


class PairError(EditError):
    """A plain message for the member."""


def _ffmpeg(args: list[str], timeout: float = 3600) -> None:
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout=timeout)
    if result.returncode != 0:
        logger.warning(f"ffmpeg failed: {(result.stderr or b'')[-600:]!r}")
        raise PairError("Putting your camera and screen together failed.")


def probe(path: str) -> dict:
    """Length, picture size (as shown, after rotation), whether it has sound, and when it was made (epoch s or None)."""
    result = run_media(["ffprobe", "-v", "error", *MEDIA_GUARD, "-show_entries",
                        "format=duration:format_tags=creation_time:stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation",
                        "-of", "json", path], timeout=60)
    try:
        data = json.loads((result.stdout or b"{}").decode("utf-8", "replace"))
    except ValueError:
        data = {}
    fmt = data.get("format") or {}
    try:
        seconds = float(fmt.get("duration") or 0)
    except (TypeError, ValueError):
        seconds = 0.0
    width = height = 0
    audio = False
    for stream in data.get("streams") or []:
        if stream.get("codec_type") == "audio":
            audio = True
        elif stream.get("codec_type") == "video" and not width:
            width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
            rotation = 0
            for side in stream.get("side_data_list") or []:
                if "rotation" in side:
                    rotation = int(float(side["rotation"]))
            rotation = rotation or int(float((stream.get("tags") or {}).get("rotate") or 0))
            if abs(rotation) % 180 == 90:
                width, height = height, width
    return {"seconds": seconds if math.isfinite(seconds) and seconds > 0 else 0.0, "width": width, "height": height,
            "audio": audio, "created": parse_created((fmt.get("tags") or {}).get("creation_time"))}


def parse_created(value: Any) -> Optional[float]:
    """A container's creation_time as epoch seconds; None when missing or not a real filming time."""
    if not isinstance(value, str) or not re.match(r"^\d{4}-\d\d-\d\dT", value):
        return None
    try:
        when = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        return None
    stamp = when.timestamp()
    # 1970 (an unset clock) and far-future times aren't filming times.
    return stamp if 946684800 < stamp < time.time() + 86400 else None


# ---------------------------------------------------------------------------
# Lining the two recordings up
# ---------------------------------------------------------------------------

def read_pcm(path: str, work: str, name: str, rate: int = SYNC_RATE, seconds: float = MAX_SYNC_SECONDS):
    """The file's first audio track as mono float32 at `rate` (at most `seconds`); None when it has no sound."""
    import numpy as np
    out = os.path.join(work, f"{name}.f32")
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *MEDIA_GUARD, "-i", path, "-map", "0:a:0", "-vn",
                        "-ac", "1", "-ar", str(rate), "-t", f"{seconds:.3f}", "-f", "f32le", out], timeout=1800)
    try:
        if result.returncode != 0 or not os.path.isfile(out):
            return None
        samples = np.fromfile(out, dtype=np.float32)
    finally:
        try:
            os.remove(out)
        except OSError:
            pass
    return samples if samples.size >= rate and float(np.max(np.abs(samples))) > 1e-4 else None


def onset_envelope(x, rate: int = SYNC_RATE, env_rate: int = ENV_RATE):
    """Where the sound starts getting louder (syllables, clicks), ENV_RATE times a second, zero mean and unit spread."""
    import numpy as np
    hop = rate // env_rate
    n = x.size // hop
    if n < 4:
        return np.zeros(max(n, 1), dtype=np.float64)
    frames = x[:n * hop].astype(np.float64).reshape(n, hop)
    level = np.log1p(1000.0 * np.sqrt(np.mean(frames * frames, axis=1)))
    rise = np.maximum(0.0, np.diff(level, prepend=level[0]))
    rise -= rise.mean()
    spread = rise.std()
    return rise / spread if spread > 1e-9 else rise


def xcorr(a, b):
    """Full cross-correlation by FFT: out[k + len(b) - 1] = sum_n a[n + k] * b[n], k from -(len(b) - 1) to len(a) - 1."""
    import numpy as np
    size = 1 << int(math.ceil(math.log2(max(2, a.size + b.size - 1))))
    spectrum = np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size))
    full = np.fft.irfft(spectrum, size)
    return np.concatenate([full[size - (b.size - 1):] if b.size > 1 else full[:0], full[:a.size]])


def _peak_ratio(r, at: int, guard: int) -> float:
    """How far the peak stands above the best other peak (outside `guard` samples of it): 0 (a tie) to 1."""
    import numpy as np
    peak = float(r[at])
    if peak <= 0:
        return 0.0
    rest = np.concatenate([r[:max(0, at - guard)], r[at + guard + 1:]])
    second = float(rest.max()) if rest.size else 0.0
    return max(0.0, min(1.0, 1.0 - max(0.0, second) / peak))


def audio_offset(camera, screen, rate: int = SYNC_RATE) -> tuple[float, float]:
    """How many seconds after the camera the screen recording started (negative: before), and how sure (0..1).

    The same moment is at camera time t and screen time t - offset. Coarse: the two onset envelopes cross-correlated
    (robust to different microphones and levels). Fine: the sound itself, phase-only weighted (GCC-PHAT), within a
    few hundredths of a second of the coarse answer."""
    import numpy as np
    ea, eb = onset_envelope(camera, rate), onset_envelope(screen, rate)
    if ea.size < 4 or eb.size < 4:
        return 0.0, 0.0
    r = xcorr(ea, eb)
    # Normalized by how much the two overlap at each lag, so a short overlap at the edges can't win by length alone.
    lags = np.arange(-(eb.size - 1), ea.size)
    overlap = np.minimum(ea.size, lags + eb.size) - np.maximum(0, lags)
    usable = overlap >= min(ea.size, eb.size, 5 * ENV_RATE) * 0.5
    score = np.where(usable, r / np.sqrt(np.maximum(overlap, 1)), 0.0)
    at = int(np.argmax(score))
    confidence = _peak_ratio(score, at, ENV_RATE // 4)
    coarse = float(lags[at]) / ENV_RATE
    return refine_offset(camera, screen, coarse, rate), confidence


def refine_offset(camera, screen, coarse: float, rate: int = SYNC_RATE, reach: float = 0.06, window: float = 90.0) -> float:
    """The coarse offset to the nearest sample, from up to `window` seconds where both recordings overlap."""
    import numpy as np
    start = max(0.0, coarse)
    end = min(camera.size / rate, coarse + screen.size / rate)
    if end - start < 1.0:
        return coarse
    # The middle of the overlap (the start of a recording is often fiddling with the mouse or the camera).
    mid = (start + end) / 2
    a0 = max(start, mid - window / 2)
    a1 = min(end, a0 + window)
    pad = int(reach * rate) + 1
    first = int(a0 * rate)
    cam = camera[first:int(a1 * rate)].astype(np.float64)
    base = max(0, int(round((a0 - coarse) * rate)) - pad)
    scr = screen[base:base + cam.size + 2 * pad].astype(np.float64)
    if cam.size < rate // 2 or scr.size < cam.size // 2:
        return coarse
    size = 1 << int(math.ceil(math.log2(cam.size + scr.size)))
    cross = np.fft.rfft(cam, size) * np.conj(np.fft.rfft(scr, size))
    freqs = np.fft.rfftfreq(size, 1 / rate)
    # Speech band only, every frequency weighted the same (phase transform): a sharp peak whatever the microphones.
    cross = np.where((freqs > 120) & (freqs < 3400), cross / np.maximum(np.abs(cross), 1e-12), 0)
    full = np.fft.irfft(cross, size)
    # Lag k: cam[n + k] ~ scr[n], so camera sample first + n + k is screen sample base + n.
    lags = np.arange(-2 * pad, 2 * pad + 1)
    k = int(lags[int(np.argmax(full[lags % size]))])
    offset = (first + k - base) / rate
    return offset if abs(offset - coarse) <= reach + 1 / rate else coarse


def overlap_ms(offset_s: float, camera_s: float, screen_s: float) -> Optional[tuple[int, int]]:
    """Where the screen recording runs, in camera time (ms); None when the two don't overlap."""
    a, b = max(0.0, offset_s), min(camera_s, offset_s + screen_s)
    return (round(a * 1000), round(b * 1000)) if b - a >= 1.0 else None


def sync_pair(camera: str, screen: str, work: str) -> dict:
    """Line the screen recording up with the camera: by sound when both have it and it matches clearly, else by the
    files' own times. offset_ms: how long after the camera the screen recording started."""
    cam, scr = probe(camera), probe(screen)
    if cam["seconds"] < 1 or scr["seconds"] < 1:
        raise PairError("One of your recordings could not be read. Try an MP4, MOV or WebM video.")
    os.makedirs(work, exist_ok=True)
    result = {"camera_seconds": round(cam["seconds"], 3), "screen_seconds": round(scr["seconds"], 3), "screen_audio": scr["audio"],
              "screen_size": [scr["width"], scr["height"]], "method": "none", "offset_ms": 0, "confidence": 0.0}
    by_sound = None
    if scr["audio"] and cam["audio"]:
        a = read_pcm(camera, work, "camera")
        b = read_pcm(screen, work, "screen") if a is not None else None
        if a is not None and b is not None:
            offset, confidence = audio_offset(a, b)
            by_sound = (offset, confidence)
            if confidence >= MIN_CONFIDENCE and overlap_ms(offset, cam["seconds"], scr["seconds"]):
                result.update(method="audio", offset_ms=round(offset * 1000), confidence=round(confidence, 3))
    if result["method"] == "none" and cam["created"] is not None and scr["created"] is not None:
        offset = scr["created"] - cam["created"]
        if overlap_ms(offset, cam["seconds"], scr["seconds"]):
            result.update(method="time", offset_ms=round(offset * 1000))
    if result["method"] == "none" and by_sound and overlap_ms(by_sound[0], cam["seconds"], scr["seconds"]):
        # A weak match by sound is still a better start than nothing; the member checks it with the preview.
        result.update(method="weak", offset_ms=round(by_sound[0] * 1000), confidence=round(by_sound[1], 3))
    window = overlap_ms(result["offset_ms"] / 1000, cam["seconds"], scr["seconds"])
    result["overlap_ms"] = list(window) if window else None
    return result


def preview_pair(camera: str, screen: str, offset_ms: int, at_ms: int, out: str, seconds: float = 6.0) -> str:
    """A few seconds of both recordings side by side as lined up (small), to check the sync by eye and ear: the camera's
    sound, with the screen recording's own sound mixed in quieter (an echo means they're off)."""
    cam, scr = probe(camera), probe(screen)
    start = max(0.0, min(at_ms / 1000, max(0.0, cam["seconds"] - seconds)))
    s_start = start - offset_ms / 1000
    lead = max(0.0, -s_start)
    vf_screen = (f"tpad=start_duration={lead:.3f}:start_mode=clone,tpad=stop_mode=clone:stop_duration={seconds:.3f},trim=duration={seconds:.3f},"
                 f"setpts=PTS-STARTPTS,fps={FPS},scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2,setsar=1")
    graph = (f"[0:v]fps={FPS},scale=270:480:force_original_aspect_ratio=increase,crop=270:480,setsar=1,trim=duration={seconds:.3f}[c];"
             f"[1:v]{vf_screen}[s];[c][s]hstack=inputs=2[v]")
    args = ["-ss", f"{start:.3f}", *MEDIA_GUARD, "-i", camera, "-ss", f"{max(0.0, s_start):.3f}", *MEDIA_GUARD, "-i", screen]
    if cam["audio"] and scr["audio"]:
        graph += (f";[0:a]atrim=duration={seconds:.3f},asetpts=PTS-STARTPTS[ca];[1:a]adelay={round(lead * 1000)}:all=1,"
                  f"atrim=duration={seconds:.3f},volume=0.45[sa];[ca][sa]amix=inputs=2:duration=first:normalize=0[a]")
        audio = ["-map", "[a]"]
    elif cam["audio"]:
        audio = ["-map", "0:a:0"]
    else:
        audio = []
    _ffmpeg([*args, "-filter_complex", graph, "-map", "[v]", *audio, "-t", f"{seconds:.3f}", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out], timeout=300)
    return out


# ---------------------------------------------------------------------------
# The canvas: where everything sits in the editor's source
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Geometry:
    """Pixel boxes (x, y, w, h) in the canvas."""
    camera: tuple[int, int, int, int]
    region: tuple[int, int, int, int]
    content: tuple[int, int, int, int]
    width: int = CANVAS_W
    height: int = CANVAS_H

    def normalized(self, box: Sequence[float]) -> list[float]:
        x, y, w, h = box
        return [round(x / self.width, 6), round(y / self.height, 6), round(w / self.width, 6), round(h / self.height, 6)]

    def record(self) -> dict:
        """As kept in the editor project (fractions of the canvas)."""
        return {"camera": self.normalized(self.camera), "screen": self.normalized(self.region), "content": self.normalized(self.content)}


def geometry_for(screen_w: int, screen_h: int) -> Geometry:
    """The screen fitted into its square region (even sizes), centered."""
    if screen_w <= 0 or screen_h <= 0:
        screen_w, screen_h = 16, 9
    scale = min(SCREEN_BOX / screen_w, SCREEN_BOX / screen_h)
    cw, ch = max(2, int(screen_w * scale) // 2 * 2), max(2, int(screen_h * scale) // 2 * 2)
    x = CAM_W + (SCREEN_BOX - cw) // 2 // 2 * 2
    y = (SCREEN_BOX - ch) // 2 // 2 * 2
    return Geometry(camera=(0, 0, CAM_W, CAM_H), region=(CAM_W, 0, SCREEN_BOX, SCREEN_BOX), content=(x, y, cw, ch))


def _clamp_box(x: float, y: float, w: float, h: float, bounds: Sequence[float]) -> tuple[float, float, float, float]:
    bx, by, bw, bh = bounds
    w, h = min(w, bw), min(h, bh)
    return max(bx, min(bx + bw - w, x)), max(by, min(by + bh - h, y)), w, h


def face_crop(geom: Geometry, aspect: float, face: Optional[Sequence[float]] = None) -> tuple[float, float, float, float]:
    """A crop of the camera region at `aspect` (width / height) covering it, with the face a little above the middle."""
    x0, y0, cw, ch = geom.camera
    w = min(cw, ch * aspect)
    h = w / aspect
    fx, fy = ((face[0] + face[2]) / 2, (face[1] + face[3]) / 2) if face else (x0 + cw / 2, y0 + ch * 0.36)
    return _clamp_box(fx - w / 2, fy - h * 0.42, w, h, geom.camera)


def bubble_crop(geom: Geometry, face: Optional[Sequence[float]] = None) -> tuple[float, float, float, float]:
    """A square around the face (head and a little of the shoulders) for the round bubble."""
    x0, y0, cw, ch = geom.camera
    if face:
        size = max(cw * 0.45, min(cw, (face[3] - face[1]) * 2.4))
        fx, fy = (face[0] + face[2]) / 2, (face[1] + face[3]) / 2
    else:
        size, fx, fy = cw * 0.8, x0 + cw / 2, y0 + ch * 0.36
    return _clamp_box(fx - size / 2, fy - size * 0.45, size, size, geom.camera)


def screen_crop(geom: Geometry, aspect: float, fit: str, focus: Optional[Sequence[float]] = None) -> tuple[float, float, float, float]:
    """A crop of the screen at `aspect`: fit shows all of it (the blurred copy around it), cover fills the panel
    (around `focus` when given, else the middle)."""
    cx0, cy0, cw, ch = geom.content
    if fit == "cover":
        w = min(cw, ch * aspect)
        h = w / aspect
        mx, my = ((focus[0] + focus[2]) / 2, (focus[1] + focus[3]) / 2) if focus else (cx0 + cw / 2, cy0 + ch / 2)
        return _clamp_box(mx - w / 2, my - h / 2, w, h, geom.content)
    w = max(cw, ch * aspect)
    h = w / aspect
    rx, ry, rw, rh = geom.region
    if h > rh:
        h, w = rh, rh * aspect
    if w > rw:
        w, h = rw, rw / aspect
    return _clamp_box(cx0 + cw / 2 - w / 2, cy0 + ch / 2 - h / 2, w, h, geom.region)


MAX_PUSH = 1.3


def zoom_crop(geom: Geometry, aspect: float, focus: Sequence[float], start: Sequence[float]) -> Optional[tuple[float, float, float, float]]:
    """A gently tighter crop (at most MAX_PUSH closer than `start`, the panel's crop) toward where the screen changes,
    for a slow push in; None when the change covers most of the screen (nothing to push toward)."""
    cx0, cy0, cw, ch = geom.content
    fx0, fy0, fx1, fy1 = focus
    if (fx1 - fx0) * (fy1 - fy0) > 0.45 * cw * ch:
        return None
    sx, sy, sw, sh = start
    w = max(sw / MAX_PUSH, min(sw, (fx1 - fx0) * 1.3), min(sw, (fy1 - fy0) * 1.3 * aspect))
    if w >= sw * 0.95:
        return None
    h = w / aspect
    return _clamp_box((fx0 + fx1) / 2 - w / 2, (fy0 + fy1) / 2 - h / 2, w, h, start)


def panel_aspects(share: float) -> tuple[float, float]:
    """Output aspect (width / height) of the top and bottom panels of a split with the top taking `share`."""
    return OUT_W / (OUT_H * share), OUT_W / (OUT_H * (1 - share))


def scene_for(kind: str, at_ms: int, geom: Geometry, share: float = DEFAULT_SPLIT, fit: str = "fit",
              face: Optional[Sequence[float]] = None, focus: Optional[Sequence[float]] = None) -> dict:
    """One editor layout scene (crops as fractions of the canvas). `share`: the screen's part of the height in a split."""
    if kind not in KINDS:
        raise ValueError("Unknown layout")
    share = round(max(SPLIT_RANGE[0], min(SPLIT_RANGE[1], share)), 2)
    if kind in ("screen_top", "face_top"):
        top = share if kind == "screen_top" else round(1 - share, 2)
        a_top, a_bottom = panel_aspects(top)
        if kind == "screen_top":
            crops = [screen_crop(geom, a_top, fit, focus), face_crop(geom, a_bottom, face)]
        else:
            crops = [face_crop(geom, a_top, face), screen_crop(geom, a_bottom, fit, focus)]
        scene = {"at_ms": at_ms, "layout": "split", "crops": [geom.normalized(c) for c in crops]}
        if abs(top - 0.5) > 1e-9:
            scene["split"] = top
        return scene
    if kind == "face":
        return {"at_ms": at_ms, "layout": "fill", "crops": [geom.normalized(face_crop(geom, OUT_W / OUT_H, face))]}
    if kind == "screen":
        return {"at_ms": at_ms, "layout": "inset", "crops": [geom.normalized(geom.content)]}
    return {"at_ms": at_ms, "layout": "bubble", "crops": [geom.normalized(geom.content), geom.normalized(bubble_crop(geom, face))]}


# ---------------------------------------------------------------------------
# Which layout where
# ---------------------------------------------------------------------------

def _clean(word: str) -> str:
    return re.sub(r"[^a-z']", "", word.lower())


def snap_to_gap(t: int, words: Sequence[Sequence[Any]]) -> int:
    """A switch time moved out of any word it would split: to the gap before or after it, whichever is nearer."""
    for _, s, e, *_ in words:
        if s < t < e:
            return int(s) if t - s < e - t else int(e)
    return int(t)


def plan_sections(total_ms: int, words: Sequence[Sequence[Any]], style: str, *, hook_end_ms: Optional[int] = None,
                  cta_start_ms: Optional[int] = None, activity: Sequence[float] = (), activity_step_ms: int = 200,
                  uncovered: Sequence[tuple[int, int]] = (), auto: bool = True) -> list[tuple[int, str]]:
    """The reel's layouts as (start ms, kind), the first at 0, each running until the next.

    The member's style everywhere, except (when `auto`): the face alone for the hook (the first couple of seconds) and
    the call to action, and the screen alone where it changes a lot for a while and the speaker points at it ("this",
    "click here"). Stretches with no screen recording behind them always show the face."""
    if style not in STYLES:
        raise ValueError("Unknown style")
    total_ms = max(1, int(total_ms))
    kinds = [style] * (total_ms // 100 + 1)  # one entry per 100 ms

    def paint(a: int, b: int, kind: str) -> None:
        for i in range(max(0, a // 100), min(len(kinds), max(0, -(-b // 100)))):
            kinds[i] = kind

    if auto:
        # The screen alone: long enough runs of a busy screen with words pointing at it.
        busy = [level >= ACTIVE_LEVEL for level in _smooth(list(activity), max(1, 1000 // max(1, activity_step_ms)))]
        run_start = None
        for i, flag in enumerate([*busy, False]):
            if flag and run_start is None:
                run_start = i
            elif not flag and run_start is not None:
                a, b = run_start * activity_step_ms, i * activity_step_ms
                said = {_clean(str(w[0])) for w in words if w[1] < b and w[2] > a}
                if b - a >= MIN_SCREEN_MS and said & SCREEN_CUES:
                    paint(a, b, "screen")
                run_start = None
        # The face for the hook and the call to action.
        hook = hook_end_ms if hook_end_ms is not None and HOOK_FACE_MS[0] <= hook_end_ms <= HOOK_FACE_MS[1] else DEFAULT_HOOK_FACE_MS
        paint(0, snap_to_gap(min(hook, total_ms), words), "face")
        if cta_start_ms is not None and 0 < cta_start_ms < total_ms - 800:
            paint(snap_to_gap(cta_start_ms, words), total_ms, "face")
    for a, b in uncovered:
        paint(a, b, "face")
    sections: list[tuple[int, str]] = []
    for i, kind in enumerate(kinds):
        if not sections or sections[-1][1] != kind:
            sections.append((i * 100, kind))
    sections = [(snap_to_gap(at, words) if n else 0, kind) for n, (at, kind) in enumerate(sections)]
    return merge_short(sections, total_ms, uncovered)


def merge_short(sections: list[tuple[int, str]], total_ms: int, uncovered: Sequence[tuple[int, int]] = ()) -> list[tuple[int, str]]:
    """Stretches shorter than MIN_SECTION_MS go to their neighbor (never one that must show the face)."""
    out = [s for s in sections]
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, (at, kind) in enumerate(out):
            end = out[i + 1][0] if i + 1 < len(out) else total_ms
            forced = any(a < end and b > at for a, b in uncovered) and kind == "face"
            if end - at >= MIN_SECTION_MS or forced:
                continue
            if i == 0:
                out[1] = (0, out[1][1])
                del out[0]
            else:
                del out[i]
            changed = True
            break
    merged: list[tuple[int, str]] = []
    for at, kind in out:
        if merged and merged[-1][1] == kind:
            continue
        if merged and at <= merged[-1][0]:
            continue
        merged.append((at, kind))
    if merged:
        merged[0] = (0, merged[0][1])
    return merged[:MAX_SCENES]


def _smooth(values: list[float], width: int) -> list[float]:
    if width <= 1 or not values:
        return values
    out, total = [], 0.0
    window: list[float] = []
    for value in values:
        window.append(value)
        total += value
        if len(window) > width:
            total -= window.pop(0)
        out.append(total / len(window))
    # Centered: shift back by half the window.
    shift = width // 2
    return out[shift:] + [out[-1]] * shift


def scenes_for(sections: Sequence[tuple[int, str]], total_ms: int, geom: Geometry, share: float, fit: str,
               face: Optional[Sequence[float]] = None, focus: Optional[dict] = None, zoom: bool = False) -> list[dict]:
    """Editor scenes for the planned sections; with `zoom`, a split's screen eases in on where it changes (`focus`:
    section start ms → the busy box in canvas pixels)."""
    scenes: list[dict] = []
    for n, (at, kind) in enumerate(sections):
        end = sections[n + 1][0] if n + 1 < len(sections) else total_ms
        scene = scene_for(kind, at, geom, share, fit, face)
        scenes.append(scene)
        box = (focus or {}).get(at)
        if zoom and box and kind in ("screen_top", "face_top") and end - at >= ZOOM_MIN_SECTION_MS and len(scenes) < MAX_SCENES - 1:
            top = scene.get("split", 0.5)
            aspect = panel_aspects(top)[0 if kind == "screen_top" else 1]
            index = 0 if kind == "screen_top" else 1
            x, y, w, h = scene["crops"][index]
            tight = zoom_crop(geom, aspect, box, (x * geom.width, y * geom.height, w * geom.width, h * geom.height))
            if tight:
                pushed = json.loads(json.dumps(scene))
                pushed["at_ms"] = at + 400
                pushed["crops"][index] = geom.normalized(tight)
                pushed["transition_ms"] = int(max(100, min(5000, end - at - 900)) // 100 * 100)
                scenes.append(pushed)
    return scenes


def screen_activity(source: str, geom: Geometry, work: str, step_ms: int = 200) -> tuple[list[float], Any]:
    """How much the screen changes every `step_ms` (mean absolute change, 0..255, on a small gray copy) and the changes
    per cell (for where it changes), read from the canvas."""
    import numpy as np
    x, y, w, h = geom.content
    cols, rows = 64, 36
    raw = os.path.join(work, "activity.gray")
    _ffmpeg([*MEDIA_GUARD, "-i", source, "-an", "-vf", f"crop={w}:{h}:{x}:{y},fps={1000 / step_ms:.4f},scale={cols}:{rows},format=gray",
             "-f", "rawvideo", raw], timeout=3600)
    try:
        frames = np.fromfile(raw, dtype=np.uint8)
    finally:
        try:
            os.remove(raw)
        except OSError:
            pass
    n = frames.size // (cols * rows)
    if n < 2:
        return [], None
    frames = frames[:n * cols * rows].reshape(n, rows, cols).astype(np.float32)
    diffs = np.abs(np.diff(frames, axis=0))
    levels = [0.0] + [float(v) for v in diffs.mean(axis=(1, 2))]
    return levels, np.concatenate([np.zeros((1, rows, cols), dtype=np.float32), diffs])


def busy_box(cells, a_ms: int, b_ms: int, geom: Geometry, step_ms: int = 200) -> Optional[tuple[float, float, float, float]]:
    """Where the screen changes most between a_ms and b_ms, as (x0, y0, x1, y1) canvas pixels, or None."""
    import numpy as np
    if cells is None:
        return None
    i0, i1 = max(0, a_ms // step_ms), min(cells.shape[0], max(a_ms // step_ms + 1, b_ms // step_ms))
    if i1 <= i0:
        return None
    heat = cells[i0:i1].sum(axis=0)
    total = float(heat.sum())
    if total <= 1e-6:
        return None
    rows, cols = heat.shape
    # The smallest box holding most of the change (80% of it along each axis).
    def span(profile):
        cum = np.cumsum(profile) / profile.sum()
        return int(np.searchsorted(cum, 0.1)), int(np.searchsorted(cum, 0.9)) + 1
    c0, c1 = span(heat.sum(axis=0))
    r0, r1 = span(heat.sum(axis=1))
    x, y, w, h = geom.content
    return (x + c0 / cols * w, y + r0 / rows * h, x + min(cols, c1) / cols * w, y + min(rows, r1) / rows * h)


# ---------------------------------------------------------------------------
# Making it
# ---------------------------------------------------------------------------

def normalize_screen(path: str, out: str, size: tuple[int, int], seconds: float) -> str:
    """The screen recording at the canvas's content size, constant 30 fps, no sound (screen recordings often change
    their frame rate as the screen does)."""
    w, h = size
    _ffmpeg([*MEDIA_GUARD, "-i", path, "-an", "-vf", f"fps={FPS},scale={w}:{h}:flags=lanczos,setsar=1,format=yuv420p",
             "-t", f"{seconds + 1:.3f}", *VIDEO_ARGS, out])
    return out


def prepare_camera(path: str, out: str, seconds: float, warnings: list[str]) -> str:
    """The camera recording as constant 30 fps H.264/AAC up to the last kept moment (a phone's 4K file is slow to read
    to its end), reframed to 9:16 around the face when it was filmed landscape."""
    from clip_engine.services.remix_service import RemixError, frame_member_in_place, normalize_recording
    try:
        normalize_recording(path, out, seconds)
    except RemixError:
        raise PairError("Your camera recording could not be read. Try an MP4, MOV or WebM video.") from None
    frame_member_in_place(out, "filmed", warnings)
    return out


def compose_piece(camera: str, screen: str, screen_seconds: float, start: float, seconds: float, offset_s: float,
                  geom: Geometry, out: str) -> None:
    """One kept stretch on the canvas: the camera's [start, start + seconds) beside the screen at the same moment
    (start - offset). Before or after the screen recording its first or last frame holds."""
    frames = max(1, round(seconds * FPS))
    seconds = frames / FPS
    s_start = start - offset_s
    lead = max(0.0, -s_start)
    seek = min(max(0.0, s_start), max(0.0, screen_seconds - 1.0 / FPS))
    x, y, w, h = geom.content
    rx, ry, rw, rh = geom.region
    graph = (f"[1:v]tpad=start_duration={lead:.4f}:start_mode=clone,tpad=stop_mode=clone:stop_duration={seconds + 1:.4f},"
             f"trim=duration={seconds:.4f},setpts=PTS-STARTPTS,fps={FPS},split=2[sa][sb];"
             f"[sa]scale={rw // 4}:{rh // 4}:force_original_aspect_ratio=increase,crop={rw // 4}:{rh // 4},gblur=sigma=10,"
             f"eq=brightness=-0.14,scale={rw}:{rh},setsar=1[bg];"
             f"[sb]scale={w}:{h},setsar=1[fg];[bg][fg]overlay={x - rx}:{y - ry}[scr];"
             f"[0:v]fps={FPS},scale={CAM_W}:{CAM_H}:force_original_aspect_ratio=increase,crop={CAM_W}:{CAM_H},setsar=1[cam];"
             f"[cam][scr]hstack=inputs=2,setsar=1[v]")
    af = (f"aresample=48000,apad,atrim=duration={seconds:.4f},afade=t=in:d=0.008,"
          f"afade=t=out:st={max(0.0, seconds - 0.012):.4f}:d=0.012")
    _ffmpeg(["-ss", f"{start:.6f}", *MEDIA_GUARD, "-i", camera, "-ss", f"{seek:.6f}", *MEDIA_GUARD, "-i", screen, "-t", f"{seconds:.4f}",
             "-filter_complex", graph, "-map", "[v]", "-map", "0:a:0", "-af", af, "-frames:v", str(frames),
             *VIDEO_ARGS, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", out])


def uncovered_ranges(pieces: Sequence[Any], offset_s: float, screen_seconds: float) -> list[tuple[int, int]]:
    """Stretches of the reel (ms) with no screen recording behind them (before it started or after it ended)."""
    out: list[tuple[int, int]] = []
    clock = 0.0
    lo, hi = offset_s, offset_s + screen_seconds
    for piece in pieces:
        a, b = piece.start, piece.end
        for x0, x1 in ((a, min(b, lo)), (max(a, hi), b)):
            if x1 - x0 > 0.05:
                out.append((round((clock + x0 - a) * 1000), round((clock + x1 - a) * 1000)))
        clock += b - a
    return out


def transcript_rows(timed: Sequence[Sequence[Any]]) -> tuple[list[dict], list[dict]]:
    """The reel's words as the editor's transcript (sentences with word times) and its rows."""
    from clip_engine.services.edit_recording import ends_sentence
    segments: list[dict] = []
    current: list[Sequence[Any]] = []
    for word in timed:
        current.append(word)
        if ends_sentence(str(word[0])) or len(current) >= 14:
            segments.append(_segment(current))
            current = []
    if current:
        segments.append(_segment(current))
    rows = [{"start_ms": s["start_time_ms"], "end_ms": s["end_time_ms"], "text": s["text"]} for s in segments]
    return segments, rows


def _segment(words: Sequence[Sequence[Any]]) -> dict:
    return {"start_time_ms": int(words[0][1]), "end_time_ms": int(words[-1][2]), "text": " ".join(str(w[0]) for w in words),
            "speaker_label": None, "audio_events": [],
            "words": [{"word": str(w[0]), "start_time_ms": int(w[1]), "end_time_ms": int(w[2])} for w in words]}


def _atomic_json(path: str, value: Any) -> None:
    temp = f"{path}.{os.getpid()}.tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def default_hook_look() -> dict:
    return {"look": "white", "color": "#FFFFFF", "font": "clean"}


def build_project(title: str, duration_ms: int, geom: Geometry, scenes: list[dict], rows: list[dict], look: Any, screen: dict,
                  face: Optional[Sequence[float]] = None) -> dict:
    """The editor project: one clip, the whole reel, already made (clip 0 in the Library)."""
    hook = {"text": " ".join(look.headline.split())[:200], "look": dict(look.headline_look or default_hook_look())} if look.headline.strip() else None
    candidate = {
        "id": "screen-reel", "title": (title or "Camera + screen")[:200], "ranges": [[0, duration_ms]], "scenes": scenes,
        "captions": bool(look.include_captions), "caption_preset": look.caption_preset, "video_speed": 1, "status": "baked",
        "caption_edits": [], "caption_suppression_ranges": [], "caption_y": None, "hook": hook,
        "requires_visual_context": False, "score": 0, "reason": "Camera + screen", "review": None, "exports": [0], "library_clip": 0,
    }
    return {"version": 1, "revision": 0, "title": (title or "Camera + screen")[:1024], "duration_ms": duration_ms, "width": geom.width,
            "height": geom.height, "aspect_ratio": "9:16", "candidates": [candidate], "transcript": rows, "frame_preview": True,
            "headline_voice": "creator",
            "pair": {**geom.record(), "style": screen["style"], "split": screen["split"], "fit": screen["fit"],
                     **({"face": geom.normalized((face[0], face[1], face[2] - face[0], face[3] - face[1]))} if face else {})}}


async def render_final(root: str, project: dict, source: str, segments: list[dict], out: str) -> int:
    """The reel from the project's one clip, exactly as the editor exports it (so switching a layout there and
    exporting again gives the same look). Returns its length in ms."""
    from clip_engine.config import get_caption_preset
    from clip_engine.services.manual_editor import manual_plan, parse_hook
    from clip_engine.services.rendering_service import RenderingService, RenderRequest
    from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord
    c = project["candidates"][0]
    hook = parse_hook(c.get("hook"))
    hook_options = {"title_style": "headline", "headline_text": hook["text"], "headline_look": hook["look"]} if hook else {}
    transcript = [TranscriptSegment(s["start_time_ms"], s["end_time_ms"], s["text"], words=[TranscriptWord(w["word"], w["start_time_ms"], w["end_time_ms"])
                                                                                            for w in s["words"]]) for s in segments]
    a, b = c["ranges"][0][0], c["ranges"][-1][1]
    with tempfile.TemporaryDirectory(prefix=".screen-export-", dir=root) as work:
        result = await RenderingService().render_clip(RenderRequest(
            video_path=source, output_path=os.path.join(work, "clip.mp4"), start_time_ms=a, end_time_ms=b,
            source_width=project["width"], source_height=project["height"], transcript_segments=transcript,
            include_captions=c["captions"], caption_style=get_caption_preset(c["caption_preset"]), caption_y=c.get("caption_y"),
            apply_padding=False, aspect_ratio="9:16", pacing="natural", video_speed=1,
            manual_ranges_ms=[tuple(r) for r in c["ranges"]], manual_plan=manual_plan(project, c, cover=bool(hook)), **hook_options))
        os.replace(result.output_path, out)
        return int(result.duration_ms)


def face_of(camera: str, pieces: Sequence[Any]) -> Optional[tuple[float, float, float, float]]:
    """The speaker's face in the camera region (canvas px), the middle of a few looks across the kept stretches."""
    from clip_engine.services import look_extras as lx
    if not pieces:
        return None
    step = max(1, len(pieces) // 8)
    windows = [(p.start, p.end) for p in list(pieces)[::step][:8]]
    found = [f for f in lx.face_boxes(camera, windows, (CAM_W, CAM_H), samples=2) if f]
    if not found:
        return None
    found.sort(key=lambda f: (f[0] + f[2]) / 2)
    return found[len(found) // 2]


async def render_screen_reel(config: dict, progress) -> dict:
    """Mode "render" with a screen recording: the canvas (cut like the reviewed edit), the layouts, the editor project
    and the reel itself."""
    from clip_engine.services import edit_recording as er
    root = config["output_dir"]
    screen = config["screen"]
    work = os.path.join(root, ".work")
    os.makedirs(work, exist_ok=True)
    look = config["look"]
    pacing = config.get("pacing") or {}
    pieces, timed = er.build_timeline(config["words"], config["keep"], config["hook"], config["cta"],
                                      pacing.get("max_gap", er.MAX_INNER_GAP), pacing.get("short_pause", er.SHORT_PAUSE))
    total = er.reel_seconds(pieces)
    if total < er.MIN_REEL_SECONDS or not timed:
        raise er.EditError("Keep a few more words: the video would be under two seconds.")
    warnings: list[str] = []
    offset = screen["offset_ms"] / 1000
    progress("Getting your recording ready", 4)
    camera = await asyncio.to_thread(prepare_camera, config["sources"][0], os.path.join(work, "source-0.mp4"), max(p.end for p in pieces) + 1, warnings)
    info = await asyncio.to_thread(probe, screen["path"])
    if info["seconds"] < 1 or not info["width"]:
        raise er.EditError("Your screen recording could not be read. Try an MP4, MOV or WebM video.")
    geom = geometry_for(info["width"], info["height"])
    progress("Getting your screen recording ready", 12)
    screen_file = await asyncio.to_thread(normalize_screen, screen["path"], os.path.join(work, "screen.mp4"), geom.content[2:], info["seconds"])
    files: list[str] = []
    for n, piece in enumerate(pieces):
        if n % 3 == 0:
            progress(f"Putting your camera and screen together ({n + 1} of {len(pieces)})", 20 + 35 * n / len(pieces))
        path = os.path.join(work, f"piece-{n:04d}.mkv")
        try:
            await asyncio.to_thread(compose_piece, camera, screen_file, info["seconds"], piece.start, piece.seconds, offset, geom, path)
        except PairError as error:
            raise er.EditError(str(error)) from None
        files.append(path)
    listing = os.path.join(work, "pieces.txt")
    with open(listing, "w", encoding="utf-8") as handle:
        handle.writelines(f"file '{os.path.basename(f)}'\n" for f in files)
    assembled = os.path.join(work, "assembled.mkv")
    await asyncio.to_thread(er.ffmpeg, ["-f", "concat", "-safe", "0", *er.MEDIA_GUARD, "-i", listing, "-c", "copy", assembled])
    source = os.path.join(root, "editor-source.mp4")
    await er.mix_reel_audio(assembled, source, config, timed, look, work, warnings, progress)
    os.chmod(source, 0o600)
    duration_ms = int(min(round(total * 1000), math.floor((er.probe_seconds(source) or total) * 1000)))
    # Which layout where.
    progress("Picking a layout for each part", 68)
    levels, cells = await asyncio.to_thread(screen_activity, source, geom, work)
    starts = {i: s for _, s, _, i in timed}
    ends = {i: e for _, _, e, i in timed}
    hook_end = max((ends[i] for i in range(config["hook"].start, config["hook"].end + 1) if i in ends), default=None) if config["hook"] else None
    cta_start = min((starts[i] for i in range(config["cta"].start, config["cta"].end + 1) if i in starts), default=None) if config["cta"] else None
    uncovered = uncovered_ranges(pieces, offset, info["seconds"])
    sections = plan_sections(duration_ms, timed, screen["style"], hook_end_ms=hook_end, cta_start_ms=cta_start, activity=levels,
                             uncovered=uncovered, auto=screen["auto"])
    face = await asyncio.to_thread(face_of, camera, pieces)
    focus = {}
    if screen["zoom"]:
        for n, (at, kind) in enumerate(sections):
            end = sections[n + 1][0] if n + 1 < len(sections) else duration_ms
            focus[at] = busy_box(cells, at, end, geom)
    scenes = scenes_for(sections, duration_ms, geom, screen["split"], screen["fit"], face, focus, screen["zoom"])
    segments, rows = transcript_rows(timed)
    title = config.get("title") or look.headline or "Camera + screen"
    project = build_project(title, duration_ms, geom, scenes, rows, look, screen, face)
    _atomic_json(os.path.join(root, "transcript.json"), {"segments": segments})
    progress("Making the preview for the editor", 72)
    from clip_engine.services.rendering_service import RenderingService
    await RenderingService().capture_framing_source(source, os.path.join(root, "editor-preview.mp4"), duration_ms=duration_ms)
    progress("Making your reel", 80)
    final = os.path.join(root, "clip_00.mp4")
    clip_ms = await render_final(root, project, source, segments, final)
    _atomic_json(os.path.join(root, "editor-project.json"), project)
    write_job_output(root, final, clip_ms, look, float(config.get("cost_usd") or 0), f"Camera + screen · {title}", er.post_caption_of(timed))
    shutil.rmtree(work, ignore_errors=True)
    progress("Done", 100)
    counts: dict[str, int] = {}
    for _, kind in sections:
        counts[kind] = counts.get(kind, 0) + 1
    return {"path": final, "duration_seconds": round(clip_ms / 1000, 3), "warnings": warnings[:4], "layouts": counts, "cost_usd": 0.0}


def write_job_output(root: str, clip_path: str, clip_ms: int, look: Any, cost_usd: float, title: str, post_caption: str) -> None:
    """The run in the Library: one clip (the reel), opened in the clip editor to change its layouts."""
    clip = {
        "clip_index": 0, "s3_url": "file://" + os.path.abspath(clip_path), "duration_ms": clip_ms, "start_time_ms": 0, "end_time_ms": clip_ms,
        "virality_score": 0.0, "layout_type": "", "summary": look.headline or title, "headline": look.headline or title, "tags": [],
        "description": None, "render_fallback": None, "ai_generated": False, "post_caption": post_caption or None,
        "editor_candidate": "screen-reel", "editor_revision": 0,
    }
    output = {
        "job_id": os.path.basename(root), "source_video_url": "", "source_video_title": title[:300], "source_video_channel": None,
        "source_video_duration_seconds": round(clip_ms / 1000, 3), "total_clips": 1, "clips": [clip], "transcript_url": None, "plan_url": None,
        "processing_time_seconds": 0, "editor_project": True, "next_clip_index": 1,
        "metrics": {"api_costs": {"total_estimated_cost_usd": round(cost_usd, 4)}, "edit_recording": True, "screen_pair": True},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    _atomic_json(os.path.join(root, "job_output.json"), output)
