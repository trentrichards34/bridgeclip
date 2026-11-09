"""Make my cover: the speaker's best frames of a finished video, for its cover (Reels, TikTok, YouTube).

The video is sampled (about two frames a second, at most MAX_SAMPLES, never its first or last half second); each sample's
biggest face (YuNet) is scored on what makes a cover frame work:

- sharp: the face's detail (variance of the Laplacian; a frame mid-move or out of focus scores low),
- eyes open: each eye's patch (around the detector's eye landmarks) against the face's own contrast (an open eye has a
  dark iris and pupil on white; a closed one is skin and a lash line),
- centered and a good size: the face near the middle and big enough to read on a phone, not cut by the frame,
- expressive: a smile (the mouth corners wide against the eyes) or an open mouth (a dark mouth), as said on camera.

The best COVER_COUNT frames at least MIN_GAP_S apart are written as full-size JPEGs.
"""
from __future__ import annotations

import math
import os
import subprocess
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

import numpy as np

FACE_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "models", "face_detection_yunet_2023mar.onnx"))
COVER_COUNT = 3
SAMPLE_FPS = 2.0
MAX_SAMPLES = 240
# Frames are looked at this tall (long side); the picks are written at the video's own size.
DETECT_PX = 640
EDGE_S = 0.5
# Picks at least this far apart (or a sixth of the video, if shorter), so the three choices differ.
MIN_GAP_S = 2.0
# How much each quality counts.
WEIGHTS = {"sharp": 0.25, "eyes": 0.32, "centered": 0.13, "size": 0.12, "expressive": 0.18}
# Eyes this closed (or less open) count as shut: such a frame drops far down the list; eyes short of EYES_OPEN
# (half closed, mid-blink) cost more than their weight.
EYES_SHUT = 0.3
EYES_OPEN = 0.7


@dataclass
class FrameScore:
    at_ms: int
    total: float
    face: tuple[float, float, float, float]  # x, y, w, h as shares of the frame
    parts: dict = field(default_factory=dict)


def _clip01(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


def sharpness(gray: np.ndarray) -> float:
    """0..1: the variance of the Laplacian of a face crop scaled to 128 px tall (log-scaled: ~30 soft, ~600 crisp)."""
    import cv2
    h, w = gray.shape[:2]
    if h < 8 or w < 8:
        return 0.0
    crop = cv2.resize(gray, (max(8, round(w * 128 / h)), 128), interpolation=cv2.INTER_AREA)
    var = float(cv2.Laplacian(crop, cv2.CV_64F).var())
    return _clip01((math.log1p(var) - math.log1p(30.0)) / (math.log1p(600.0) - math.log1p(30.0)))


def eye_openness(face_ycc: np.ndarray, eyes: Sequence[tuple[float, float]]) -> float:
    """0..1 from the eye patches (face-crop pixels, YCrCb, around each eye landmark): an open eye shows the iris, the
    pupil and the white, none of them skin; a closed one is the lid (skin) and a thin lash line. The share of non-skin
    pixels in a tight patch around each eye, against the skin of the cheeks under them (so lighting doesn't matter):
    about 0.35 shut, 0.65 and up open."""
    if len(eyes) < 2:
        return 0.5
    (lx, ly), (rx, ry) = eyes[0], eyes[1]
    d = math.dist((lx, ly), (rx, ry))
    h, w = face_ycc.shape[:2]
    if d < 8:
        return 0.5
    cheek = face_ycc[int(min(ly, ry) + d * 0.45):int(max(ly, ry) + d * 0.7), int(min(lx, rx)):int(max(lx, rx))].reshape(-1, 3)
    if len(cheek) < 10:
        return 0.5
    skin = np.median(cheek, axis=0)
    shares = []
    for ex, ey in eyes[:2]:
        y0, y1, x0, x1 = int(ey - d * 0.12), int(ey + d * 0.12), int(ex - d * 0.25), int(ex + d * 0.25)
        if y0 < 0 or x0 < 0 or y1 > h or x1 > w or y1 - y0 < 2 or x1 - x0 < 4:
            continue
        patch = face_ycc[y0:y1, x0:x1].reshape(-1, 3)
        chroma = np.hypot(patch[:, 1] - skin[1], patch[:, 2] - skin[2])
        shares.append(float(((chroma > 9) | (patch[:, 0] < skin[0] * 0.55)).mean()))
    if not shares:
        return 0.5
    return _clip01((float(np.mean(shares)) - 0.42) / 0.26)


def expressiveness(face_gray: np.ndarray, eyes: Sequence[tuple[float, float]], mouth: Sequence[tuple[float, float]]) -> float:
    """0..1: a smile (the mouth corners wide against the eyes) or an open mouth (dark between and under the corners)."""
    if len(eyes) < 2 or len(mouth) < 2:
        return 0.4
    eye_d = math.dist(eyes[0], eyes[1]) or 1.0
    mouth_w = math.dist(mouth[0], mouth[1])
    smile = _clip01((mouth_w / eye_d - 0.72) / 0.35)
    h, w = face_gray.shape[:2]
    (mx0, my0), (mx1, my1) = mouth
    x0, x1 = int(min(mx0, mx1)), int(max(mx0, mx1))
    yc = (my0 + my1) / 2
    y0, y1 = int(yc - mouth_w * 0.12), int(yc + mouth_w * 0.35)
    opened = 0.0
    if 0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h:
        region = face_gray[y0:y1, x0:x1]
        opened = _clip01(float((region < np.percentile(face_gray, 10)).mean()) / 0.25)
    return _clip01(0.6 * smile + 0.4 * opened + 0.15)


def placement(face: tuple[float, float, float, float]) -> tuple[float, float]:
    """(centered, size) 0..1 for a face (shares of the frame): near the middle (the eyes a bit above it), as big as a
    phone reads, not cut by the frame's edge."""
    x, y, w, h = face
    cx, cy = x + w / 2, y + h / 2
    centered = _clip01(1 - abs(cx - 0.5) * 2.2) * _clip01(1 - max(0.0, abs(cy - 0.42) - 0.12) * 2.5)
    size = _clip01(min((h - 0.06) / 0.14, 1.0, (0.7 - h) / 0.2))
    if x < 0.005 or y < 0.005 or x + w > 0.995 or y + h > 0.995:
        size *= 0.4
    return centered, size


def score_frame(frame_bgr: np.ndarray, detection: Sequence[float], at_ms: int) -> FrameScore:
    """One sample's score from its face (a YuNet row: box, five landmarks, confidence)."""
    import cv2
    H, W = frame_bgr.shape[:2]
    bx, by, bw, bh = (float(v) for v in detection[:4])
    lm = [(float(detection[4 + 2 * i]), float(detection[5 + 2 * i])) for i in range(5)]
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    x0, y0 = max(0, int(bx)), max(0, int(by))
    x1, y1 = min(W, int(bx + bw)), min(H, int(by + bh))
    face_gray = gray[y0:y1, x0:x1]
    # A margin around the box: the eye patches and the cheeks under them stay inside.
    ycc = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    if face_gray.size == 0:
        return FrameScore(at_ms, 0.0, (0, 0, 0, 0))
    local = [(px - x0, py - y0) for px, py in lm]
    parts = {"sharp": sharpness(face_gray), "eyes": eye_openness(ycc, lm[:2]),
             "expressive": expressiveness(face_gray, local[:2], local[3:5])}
    face = (bx / W, by / H, bw / W, bh / H)
    parts["centered"], parts["size"] = placement(face)
    total = sum(WEIGHTS[k] * parts[k] for k in WEIGHTS)
    if parts["eyes"] < EYES_SHUT:
        total *= 0.4
    elif parts["eyes"] < EYES_OPEN:
        total *= 0.75 + 0.25 * (parts["eyes"] - EYES_SHUT) / (EYES_OPEN - EYES_SHUT)
    return FrameScore(at_ms, round(total, 4), face, {k: round(v, 3) for k, v in parts.items()})


def pick_best(scores: Sequence[FrameScore], count: int = COVER_COUNT, gap_ms: int = round(MIN_GAP_S * 1000)) -> list[FrameScore]:
    """The best `count` frames at least `gap_ms` apart (relaxed to half, then none, when the video is too short)."""
    ranked = sorted((s for s in scores if s.total > 0), key=lambda s: (-s.total, s.at_ms))
    for gap in (gap_ms, gap_ms // 2, 0):
        picked: list[FrameScore] = []
        for s in ranked:
            if all(abs(s.at_ms - p.at_ms) >= gap for p in picked):
                picked.append(s)
            if len(picked) == count:
                return picked
        if len(picked) == count or gap == 0:
            return picked
    return []


def _probe(video: str) -> tuple[int, int, float]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                          "-of", "default=nw=1", video], capture_output=True, text=True, check=True, timeout=60).stdout
    values = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    return int(values["width"]), int(values["height"]), float(values.get("duration") or 0)


def sample_scores(video: str, on_progress: Optional[Callable[[float], None]] = None) -> tuple[list[FrameScore], tuple[int, int], float]:
    """Every sample's score (frames with no face are left out), the video's size and length (s)."""
    import cv2
    width, height, duration = _probe(video)
    span = max(0.0, duration - 2 * EDGE_S)
    fps = min(SAMPLE_FPS, MAX_SAMPLES / span) if span > 0 else SAMPLE_FPS
    scale = DETECT_PX / max(width, height)
    w, h = max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{EDGE_S if duration > 2 * EDGE_S else 0:.3f}", "-i", video,
           "-t", f"{span if span > 0 else duration:.3f}", "-vf", f"fps={fps:.5f},scale={w}:{h}:flags=area", "-an",
           "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (w, h), 0.7, 0.3, 50)
    size = w * h * 3
    scores: list[FrameScore] = []
    n = 0
    total = max(1, int(span * fps)) if span > 0 else 1
    try:
        while True:
            raw = proc.stdout.read(size) if proc.stdout else b""
            if len(raw) < size:
                break
            frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
            at_ms = round(((EDGE_S if duration > 2 * EDGE_S else 0) + n / fps) * 1000)
            n += 1
            _, faces = detector.detect(frame)
            if faces is not None and len(faces):
                best = max(faces, key=lambda f: f[2] * f[3])
                scores.append(score_frame(frame, best, at_ms))
            if on_progress:
                on_progress(min(1.0, n / total))
    finally:
        if proc.stdout:
            proc.stdout.close()
        proc.wait(timeout=60)
    return scores, (width, height), duration


def write_frame(video: str, at_ms: int, out_path: str) -> str:
    """The frame at `at_ms` at the video's own size, as a JPEG (written to a temp name, then moved in)."""
    tmp = out_path + ".part.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{at_ms / 1000:.3f}", "-i", video, "-frames:v", "1",
                    "-q:v", "2", tmp], check=True, timeout=60)
    os.replace(tmp, out_path)
    return out_path


def cover_frames(video: str, out_dir: str, count: int = COVER_COUNT, on_progress: Optional[Callable[[float], None]] = None) -> dict:
    """The video's best cover frames, written to `out_dir` as frame-<ms>.jpg: {"width", "height", "duration_ms",
    "frames": [{"at_ms", "path", "score", "face": [x, y, w, h] shares, "parts"}]} (fewer, or none, when no face is seen)."""
    os.makedirs(out_dir, exist_ok=True)
    scores, (width, height), duration = sample_scores(video, on_progress)
    gap = min(round(MIN_GAP_S * 1000), round(duration * 1000 / 6)) if duration > 0 else 0
    frames = []
    for s in pick_best(scores, count, gap):
        path = write_frame(video, s.at_ms, os.path.join(out_dir, f"frame-{s.at_ms}.jpg"))
        frames.append({"at_ms": s.at_ms, "path": path, "score": s.total, "face": [round(v, 4) for v in s.face], "parts": s.parts})
    return {"width": width, "height": height, "duration_ms": round(duration * 1000), "frames": frames}
