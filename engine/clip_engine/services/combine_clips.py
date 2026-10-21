"""Combine clips: many short phone clips (parts of one video) in, one reel out, through Edit my recording.

Before the plan (mode "clips"), each clip is made into a proxy once: upright (the phone's rotation applied), constant
30 fps, at most 1080 on its short side, H.264 + 48 kHz AAC. A phone films 4K, but the reel is 1080x1920, so a
1080p proxy loses nothing the reel would show, and decoding each 4K (often HEVC) original once instead of at every
step keeps the work fast and the disk use about a fifth of the originals. The reel is made from these proxies (they
are high quality: CRF 18), and they are deleted with the run's working files when the reel is done.

Each proxy is then looked at:
- its shot: FACE (talking head: a face in most sampled frames) or SCREEN (a phone filming a laptop or monitor, or a
  screen recording: little or no face, a large bright flat area). See classify_shot for the thresholds.
- for a SCREEN shot, where to punch in (the middle of the bright screen area, weighted toward the center), and it is
  steadied lightly (vidstab, when FFmpeg has it).
- its average brightness and loudness, so every clip can be evened out to the others before they are joined.

At render time (edit_recording.render_edit with a "combine" config), each piece is cut from its clip's proxy with
that clip's framing, brightness and loudness filters (combine_filters), the clips play in the member's order and,
with transitions on, each change of clip dips through black for 0.2 s.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
import subprocess
from statistics import median
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

Progress = Callable[[str, float], None]

OUT_W, OUT_H, FPS = 1080, 1920, 30
MAX_CLIPS = 30
MAX_CLIP_SECONDS = 10 * 60
SAMPLES = 8
PROXY_VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS)]
PROXY_AUDIO = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts"]
# Shot types (see classify_shot).
FACE_SHARE = 0.5          # a face in at least half the sampled frames: a talking head
FACE_MIN_H = 0.06         # ... and big enough to be the speaker (share of the frame's height)
SCREEN_SHARE = 0.2        # a bright, flat area at least this share of the frame: a screen
LOW_FACE = 0.34           # under this face presence, a clip with no screen found is still treated as a screen shot
# SCREEN framing: a slight punch-in toward the screen, weighted toward the middle.
SCREEN_ZOOM = 1.15
FOCUS_WEIGHT = 0.5
# Evening clips out: brightness within ±0.08 (eq), loudness to -16 LUFS within ±12 dB, before the reel's own loudnorm.
CLIP_LUFS = -16.0
MAX_GAIN_DB = 12.0
MAX_BRIGHTNESS = 0.08
TRANSITION_S = 0.1  # each side of a dip through black (0.2 s in all)
COMBINE_FILE = "combine.json"


class CombineError(Exception):
    """A problem to tell the member as is."""


def clips_dir(root: str) -> str:
    return os.path.join(root, ".work", "clips")


def _run(args: list[str], timeout: float = 3600, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    from clip_engine.services.media_process import media_child_env
    return subprocess.run(args, capture_output=True, timeout=timeout, cwd=cwd, env=media_child_env(), check=False)


def _ffmpeg(args: list[str], timeout: float = 3600, cwd: Optional[str] = None) -> None:
    result = _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout, cwd)
    if result.returncode != 0:
        logger.warning(f"ffmpeg failed: {(result.stderr or b'')[-600:]!r}")
        raise CombineError("One of your clips could not be read. Try an MP4 or MOV video.")


def _probe(path: str) -> dict:
    result = _run(["ffprobe", "-v", "error", *GUARD, "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path], 120)
    try:
        data = json.loads((result.stdout or b"{}").decode("utf-8", "replace"))
    except ValueError:
        data = {}
    video = next((s for s in data.get("streams") or [] if s.get("codec_type") == "video"), None)
    audio = any(s.get("codec_type") == "audio" for s in data.get("streams") or [])
    try:
        seconds = float((data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        seconds = 0.0
    return {"video": video, "audio": audio, "seconds": seconds if math.isfinite(seconds) else 0.0}


def proxy_scale() -> str:
    """Size filter for the upright picture: fits 1080x1920 (portrait or square) or 1920x1080 (landscape), never upscaled."""
    return (f"scale=w='if(gte(ih,iw),min({OUT_W},iw),min({OUT_H},iw))':h='if(gte(ih,iw),min({OUT_H},ih),min({OUT_W},ih))'"
            ":force_original_aspect_ratio=decrease:force_divisible_by=2")


def make_proxy(source: str, out: str) -> dict:
    """The clip upright, 30 fps, at most 1080 on its short side, with sound (silence when it has none)."""
    info = _probe(source)
    if not info["video"]:
        raise CombineError(f"“{os.path.basename(source)}” has no picture. Use a video clip.")
    args = [*GUARD, "-i", source]
    if not info["audio"]:
        args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    # FFmpeg turns the picture upright from the phone's rotation when it decodes (autorotate), so the size is read after.
    vf = f"fps={FPS},{proxy_scale()},setsar=1,format=yuv420p"
    _ffmpeg([*args, "-vf", vf, "-af", "aresample=48000:async=1:first_pts=0", "-map", "0:v:0", "-map", "0:a:0" if info["audio"] else "1:a:0",
             "-t", f"{min(info['seconds'] or MAX_CLIP_SECONDS, MAX_CLIP_SECONDS):.3f}", "-shortest", *PROXY_VIDEO, *PROXY_AUDIO,
             "-movflags", "+faststart", out])
    made = _probe(out)
    if not made["video"]:
        raise CombineError(f"“{os.path.basename(source)}” could not be read.")
    return {"size": [int(made["video"]["width"]), int(made["video"]["height"])], "seconds": round(made["seconds"], 3)}


# ---------------------------------------------------------------------------
# Looking at a clip
# ---------------------------------------------------------------------------

def classify_shot(face_share: float, face_h: float, screen_share: float) -> str:
    """FACE when a big enough face is in at least half the frames; SCREEN when a bright flat area (a screen) covers
    enough of the frame, or when there is (almost) no face at all; otherwise FACE."""
    if face_share >= FACE_SHARE and face_h >= FACE_MIN_H:
        return "face"
    if screen_share >= SCREEN_SHARE:
        return "screen"
    if face_share < LOW_FACE:
        return "screen"
    return "face"


def screen_region(gray: Any, sat: Any) -> tuple[float, tuple[float, float]]:
    """The largest bright, flat (unsaturated) area in a frame: its share of the frame and its middle (fractions)."""
    import cv2
    import numpy as np
    h, w = gray.shape[:2]
    mask = ((gray > 165) & (sat < 60)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        return 0.0, (0.5, 0.5)
    best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh, area = stats[best]
    # A screen is a filled rectangle: its area against its box keeps out scattered bright bits.
    fill = area / max(1, bw * bh)
    share = float(area) / (w * h) if fill >= 0.45 else 0.0
    return share, (float((x + bw / 2) / w), float((y + bh / 2) / h))


def look_at(path: str, samples: int = SAMPLES) -> dict:
    """Faces, screen area and brightness over a few frames spread through the clip."""
    import cv2
    import numpy as np
    from clip_engine.services.remix_service import FACE_MODEL
    capture = cv2.VideoCapture(path)
    faces, heights, screens, centers, lumas, face_boxes = 0, [], [], [], [], []
    seen = 0
    detector = None
    try:
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        for i in range(samples):
            if count > 0:
                capture.set(cv2.CAP_PROP_POS_FRAMES, int(count * (i + 0.5) / samples))
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            seen += 1
            h, w = frame.shape[:2]
            scale = min(1.0, 640 / max(w, h))
            small = cv2.resize(frame, (max(1, round(w * scale)), max(1, round(h * scale)))) if scale < 1 else frame
            sh, sw = small.shape[:2]
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            lumas.append(float(gray.mean()))
            share, center = screen_region(gray, hsv[:, :, 1])
            screens.append(share)
            if share >= SCREEN_SHARE:
                centers.append(center)
            if os.path.isfile(FACE_MODEL):
                if detector is None:
                    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (sw, sh), 0.7, 0.3, 50)
                detector.setInputSize((sw, sh))
                _, found = detector.detect(small)
                if found is not None and len(found):
                    x, y, fw, fh = max(found, key=lambda f: f[2] * f[3])[:4]
                    if fh / sh >= 0.03:
                        faces += 1
                        heights.append(float(fh / sh))
                        face_boxes.append((float(x / sw), float(y / sh), float(fw / sw), float(fh / sh)))
    finally:
        capture.release()
    if not seen:
        raise CombineError("One of your clips could not be read.")
    face_share = faces / seen
    face_h = float(median(heights)) if heights else 0.0
    screen_share = float(median(screens)) if screens else 0.0
    shot = classify_shot(face_share, face_h, screen_share)
    focus = (float(median(c[0] for c in centers)), float(median(c[1] for c in centers))) if centers else (0.5, 0.5)
    face = tuple(float(v) for v in np.median(np.array(face_boxes), axis=0)) if face_boxes else None
    return {"shot": shot, "face_share": round(face_share, 3), "face_h": round(face_h, 3), "screen_share": round(screen_share, 3),
            "focus": [round(focus[0], 3), round(focus[1], 3)], "face": [round(v, 4) for v in face] if face else None,
            "luma": round(float(median(lumas)), 2)}


def measure_lufs(path: str) -> Optional[float]:
    """The clip's integrated loudness (LUFS), or None for silence or when it can't be measured."""
    result = _run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", *GUARD, "-i", path, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"], 600)
    text = (result.stderr or b"").decode("utf-8", "replace")
    found = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", text)
    if not found or found[-1] == "-inf":
        return None
    value = float(found[-1])
    return value if math.isfinite(value) and value > -70 else None


def vidstab_available() -> bool:
    result = _run(["ffmpeg", "-hide_banner", "-filters"], 30)
    return b"vidstabtransform" in (result.stdout or b"")


def steady(path: str, work: str) -> bool:
    """Steady a handheld screen shot lightly (two-pass vidstab), in place. False when it can't be done."""
    out = os.path.join(work, "steady.mp4")
    try:
        _ffmpeg(["-i", path, "-vf", "vidstabdetect=shakiness=5:accuracy=9:result=steady.trf", "-an", "-f", "null", "-"], cwd=work)
        _ffmpeg(["-i", path, "-vf", "vidstabtransform=input=steady.trf:smoothing=10:optzoom=0:crop=keep:maxshift=48:maxangle=0.03:interpol=bilinear",
                 "-map", "0:v:0", "-map", "0:a:0", *PROXY_VIDEO, "-c:a", "copy", "-movflags", "+faststart", "steady.mp4"], cwd=work)
        os.replace(out, path)
        return True
    except (CombineError, OSError) as error:
        logger.warning(f"Steadying skipped: {error}")
        return False
    finally:
        for name in ("steady.trf", "steady.mp4"):
            try:
                os.remove(os.path.join(work, name))
            except OSError:
                pass


def thumbnail(path: str, out: str, seconds: float) -> Optional[str]:
    try:
        _ffmpeg(["-ss", f"{min(1.0, max(0.0, seconds * 0.3)):.3f}", *GUARD, "-i", path, "-frames:v", "1", "-vf", "scale=216:-2", "-q:v", "4", out], 120)
        return out if os.path.isfile(out) else None
    except CombineError:
        return None


async def prepare_clips(config: dict, progress: Progress) -> dict:
    """Mode "clips": a proxy, the shot type, framing, brightness and loudness of every clip (written to combine.json)."""
    import asyncio
    root = config["output_dir"]
    folder = clips_dir(root)
    os.makedirs(folder, exist_ok=True)
    sources: list[str] = config["sources"]
    stab = await asyncio.to_thread(vidstab_available)
    clips: list[dict] = []
    for n, source in enumerate(sources):
        base = 5 + 90 * n / len(sources)
        step = 90 / len(sources)
        part = f" ({n + 1} of {len(sources)})" if len(sources) > 1 else ""
        progress(f"Getting your clips ready{part}", base)
        proxy = os.path.join(folder, f"clip-{n:02d}.mp4")
        made = await asyncio.to_thread(make_proxy, source, proxy)
        progress(f"Looking at your clips{part}", base + step * 0.7)
        seen = await asyncio.to_thread(look_at, proxy)
        steadied = False
        if seen["shot"] == "screen" and stab:
            steadied = await asyncio.to_thread(steady, proxy, folder)
        lufs = await asyncio.to_thread(measure_lufs, proxy)
        thumb = await asyncio.to_thread(thumbnail, proxy, os.path.join(folder, f"thumb-{n:02d}.jpg"), made["seconds"])
        clips.append({"src": n, "proxy": proxy, "thumb": thumb, "size": made["size"], "seconds": made["seconds"], **seen,
                      "lufs": None if lufs is None else round(lufs, 2), "steadied": steadied})
    with open(os.path.join(folder, COMBINE_FILE), "w", encoding="utf-8") as handle:
        json.dump({"clips": clips}, handle)
    progress("Your clips are ready", 100)
    return {"clips": [{k: c[k] for k in ("src", "proxy", "thumb", "shot", "seconds", "steadied", "size")} for c in clips]}


# ---------------------------------------------------------------------------
# At render time
# ---------------------------------------------------------------------------

def read_clips(root: str, count: int) -> dict[int, dict]:
    """The clips' proxies and looks from mode "clips" (only files inside the run's clips folder are used)."""
    folder = clips_dir(root)
    try:
        with open(os.path.join(folder, COMBINE_FILE), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        raise CombineError("Your clips' working files are missing. Start again with your clips.") from None
    real = os.path.realpath(folder)
    out: dict[int, dict] = {}
    for clip in data.get("clips") or []:
        if not isinstance(clip, dict) or type(clip.get("src")) is not int or not 0 <= clip["src"] < count:
            continue
        proxy = clip.get("proxy")
        if not isinstance(proxy, str) or os.path.dirname(os.path.realpath(proxy)) != real or not os.path.isfile(proxy):
            continue
        out[clip["src"]] = clip
    return out


def luma_targets(clips: list[dict]) -> dict[str, float]:
    """The brightness each kind of shot is evened toward: the median of the clips of that kind (a white screen isn't
    made to match a face in a dim room, only other screens)."""
    out: dict[str, float] = {}
    for shot in ("face", "screen"):
        lumas = [float(c["luma"]) for c in clips if c.get("shot") == shot and isinstance(c.get("luma"), (int, float))]
        if lumas:
            out[shot] = float(median(lumas))
    return out


def brightness_shift(luma: Optional[float], target: Optional[float]) -> float:
    """Half of the way toward the target (lightly), within ±MAX_BRIGHTNESS; nothing for a small difference."""
    if luma is None or target is None or not math.isfinite(luma):
        return 0.0
    shift = 0.5 * (target - luma) / 255
    return 0.0 if abs(shift) < 2 / 255 else round(max(-MAX_BRIGHTNESS, min(MAX_BRIGHTNESS, shift)), 4)


def gain_db(lufs: Optional[float], target: float = CLIP_LUFS) -> float:
    if lufs is None or not math.isfinite(lufs):
        return 0.0
    return round(max(-MAX_GAIN_DB, min(MAX_GAIN_DB, target - lufs)), 2)


def screen_crop(size: tuple[int, int], focus: tuple[float, float], zoom: float = SCREEN_ZOOM) -> tuple[int, int, int, int]:
    """The crop (w, h, x, y) that punches in `zoom` times toward the screen's middle, weighted toward the frame's middle."""
    w, h = size
    cw, ch = round(w / zoom) // 2 * 2, round(h / zoom) // 2 * 2
    fx = FOCUS_WEIGHT * 0.5 + (1 - FOCUS_WEIGHT) * focus[0]
    fy = FOCUS_WEIGHT * 0.5 + (1 - FOCUS_WEIGHT) * focus[1]
    x = round(min(max(0.0, fx * w - cw / 2), w - cw))
    y = round(min(max(0.0, fy * h - ch / 2), h - ch))
    return cw, ch, x, y


def combine_filters(clip: dict, luma_target: Optional[float]) -> tuple[str, str]:
    """The video filters (framing, brightness) and audio filter (loudness) that go before a piece's own cut and fit,
    for one clip (its prepared file: see framed_source). The piece's own filter then covers 1080x1920."""
    vf: list[str] = []
    size = tuple(int(v) for v in clip.get("size") or (OUT_W, OUT_H))
    if clip.get("shot") == "screen" and size[0] <= size[1]:
        focus = tuple(float(v) for v in (clip.get("focus") or (0.5, 0.5)))[:2]
        cw, ch, x, y = screen_crop(size, focus)  # type: ignore[arg-type]
        vf.append(f"crop={cw}:{ch}:{x}:{y}")
    shift = brightness_shift(clip.get("luma"), luma_target)
    if shift:
        vf.append(f"eq=brightness={shift}")
    gain = gain_db(clip.get("lufs"))
    # Turned up, the peaks are held under full scale (the pieces are 16-bit PCM until the reel's own loudness pass).
    return ",".join(vf), (f"volume={gain}dB" + (",alimiter=limit=0.89:level=disabled" if gain > 0 else "") if gain else "")


def framed_source(clip: dict, work: str, warnings: list[str]) -> str:
    """The file a clip's pieces are cut from: its proxy, or for a landscape clip a 9:16 version of it (a talking head
    framed around the face as Edit my recording does; a screen recording as a square around the screen's middle over a
    blurred copy of itself)."""
    from clip_engine.services.remix_service import frame_member_in_place
    proxy = clip["proxy"]
    w, h = (int(v) for v in clip.get("size") or (OUT_W, OUT_H))
    if w <= h * 1.05:
        return proxy
    out = os.path.join(work, f"framed-{int(clip['src']):02d}.mp4")
    if clip.get("shot") == "screen":
        side = h // 2 * 2
        focus = float((clip.get("focus") or (0.5, 0.5))[0])
        x = round(min(max(0.0, focus * w - side / 2), w - side))
        graph = (f"[0:v]split[a][b];[a]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},boxblur=24:2,"
                 f"eq=brightness=-0.15[bg];[b]crop={side}:{side}:{x}:0,scale={OUT_W}:{OUT_W}[fg];"
                 f"[bg][fg]overlay=x=0:y={round((OUT_H - OUT_W) * 0.42)},setsar=1,format=yuv420p[v]")
        try:
            _ffmpeg([*GUARD, "-i", proxy, "-filter_complex", graph, "-map", "[v]", "-map", "0:a:0", *PROXY_VIDEO, "-c:a", "copy", out])
            return out
        except CombineError:
            warnings.append("A screen clip couldn't be framed, so it is shown centered.")
            return proxy
    shutil.copyfile(proxy, out)
    frame_member_in_place(out, "filmed", warnings)
    return out


def remove_work(root: str) -> None:
    shutil.rmtree(clips_dir(root), ignore_errors=True)
