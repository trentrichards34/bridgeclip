"""Person cut-out for "Me, on camera": a grayscale matte video from the member's recording.

The MediaPipe selfie segmentation model (Apache-2.0, bundled in assets/models) runs
through OpenCV DNN on each frame at most 720p internally. The probability map is
smoothed over time (so edges don't flicker), softly thresholded, eroded a little
and feathered, then written as a lossless gray video the compositor scales and
uses with FFmpeg's alphamerge.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
from typing import Optional

import numpy as np

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, MediaProcessError, media_child_env, media_process

try:  # OpenCV is part of the engine's dependencies; the cut-out is skipped without it.
    import cv2
except ImportError:  # pragma: no cover - packaging problem
    cv2 = None

logger = logging.getLogger(__name__)

MODEL_FILE = "selfie_segmentation.tflite"
MODEL_SIZE = 256
# Frames are segmented and the matte written at no more than this edge (CPU budget).
MAX_INTERNAL_EDGE = 720
# 20 minutes at 30 fps: far longer than any recording a remix uses.
MAX_FRAMES = 20 * 60 * 30
MATTE_TIMEOUT_SECONDS = 30 * 60
# Weight of the newest frame in the running average (lower = steadier, laggier edges).
SMOOTHING = 0.6
# Soft threshold: below LOW is background, above HIGH is person, a ramp between.
LOW, HIGH = 0.35, 0.75


def _valid_rate(fps: int | str) -> bool:
    """A frame rate as a positive number or "num/den" (kept to digits, for the FFmpeg arguments)."""
    if isinstance(fps, bool):
        return False
    if isinstance(fps, (int, float)):
        return 0 < fps <= 240
    import re
    match = re.fullmatch(r"(\d{1,6})(?:/(\d{1,6}))?", fps) if isinstance(fps, str) else None
    if not match or int(match.group(1)) <= 0:
        return False
    den = int(match.group(2) or 1)
    return den > 0 and int(match.group(1)) / den <= 240


def model_path() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "models", MODEL_FILE))


def available() -> bool:
    return cv2 is not None and os.path.isfile(model_path())


def internal_size(width: int, height: int, max_edge: int = MAX_INTERNAL_EDGE) -> tuple[int, int]:
    """The working size: the frame scaled down to max_edge on its long side, even numbers."""
    scale = min(1.0, max_edge / max(width, height))
    return max(2, int(round(width * scale / 2)) * 2), max(2, int(round(height * scale / 2)) * 2)


class SelfieSegmenter:
    """Per-frame person probability (0..1, frame size) from the selfie segmentation model."""

    def __init__(self, path: Optional[str] = None):
        if cv2 is None:
            raise RuntimeError("OpenCV is not available")
        self.net = cv2.dnn.readNetFromTFLite(path or model_path())

    def probability(self, bgr: np.ndarray) -> np.ndarray:
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        # The model sees a square. A portrait frame is stretched (it was trained on
        # selfies); a landscape one is letterboxed so the person isn't squeezed thin.
        if w > h * 1.2:
            side = w
            square = np.zeros((side, side, 3), np.float32)
            top = (side - h) // 2
            square[top:top + h] = rgb
            self.net.setInput(cv2.dnn.blobFromImage(square, 1.0, (MODEL_SIZE, MODEL_SIZE)))
            out = self.net.forward().reshape(MODEL_SIZE, MODEL_SIZE)
            return cv2.resize(out, (side, side), interpolation=cv2.INTER_LINEAR)[top:top + h]
        self.net.setInput(cv2.dnn.blobFromImage(rgb, 1.0, (MODEL_SIZE, MODEL_SIZE)))
        out = self.net.forward().reshape(MODEL_SIZE, MODEL_SIZE)
        return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)


class MatteSmoother:
    """Temporal smoothing and edge clean-up that turn probabilities into an 8-bit matte."""

    def __init__(self, width: int, height: int, smoothing: float = SMOOTHING):
        self.smoothing = smoothing
        self.previous: Optional[np.ndarray] = None
        edge = max(width, height)
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)) if edge < 900 else \
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        blur = max(3, int(round(edge / 180)) | 1)
        self.blur = (blur, blur)

    def __call__(self, probability: np.ndarray) -> np.ndarray:
        prob = np.clip(np.nan_to_num(probability.astype(np.float32)), 0.0, 1.0)
        if self.previous is not None and self.previous.shape == prob.shape:
            prob = self.smoothing * prob + (1.0 - self.smoothing) * self.previous
        self.previous = prob
        ramp = np.clip((prob - LOW) / (HIGH - LOW), 0.0, 1.0)
        ramp = ramp * ramp * (3.0 - 2.0 * ramp)  # smoothstep: soft but decisive edges
        ramp = cv2.erode(ramp, self.kernel)
        ramp = cv2.GaussianBlur(ramp, self.blur, 0)
        return (ramp * 255.0 + 0.5).astype(np.uint8)


def guided_filter(guide: np.ndarray, p: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """He et al.'s guided filter (gray guide, float32 0..1): `p` with its edges moved onto the guide's edges."""
    size = (2 * radius + 1, 2 * radius + 1)
    mean = lambda x: cv2.boxFilter(x, -1, size)  # noqa: E731
    mean_i, mean_p = mean(guide), mean(p)
    a = (mean(guide * p) - mean_i * mean_p) / (mean(guide * guide) - mean_i * mean_i + eps)
    b = mean_p - a * mean_i
    return mean(a) * guide + mean(b)


class EdgeRefiner:
    """A tighter matte for words behind the speaker: the model's probability (made at its own small size) is
    smoothed over time, then snapped to the picture's edges with a guided filter at the matte's full size (hair
    follows its real outline instead of a soft blob), then softly thresholded."""

    def __init__(self, width: int, height: int, smoothing: float = SMOOTHING):
        self.size = (width, height)
        self.smoothing = smoothing
        self.previous: Optional[np.ndarray] = None
        self.radius = max(3, int(round(max(width, height) / 120)))
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))

    def __call__(self, probability: np.ndarray, bgr: np.ndarray) -> np.ndarray:
        prob = np.clip(np.nan_to_num(probability.astype(np.float32)), 0.0, 1.0)
        if self.previous is not None and self.previous.shape == prob.shape:
            prob = self.smoothing * prob + (1.0 - self.smoothing) * self.previous
        self.previous = prob
        if prob.shape[1::-1] != self.size:
            prob = cv2.resize(prob, self.size, interpolation=cv2.INTER_LINEAR)
        guide = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        q = np.clip(guided_filter(guide, prob, self.radius, 2e-3), 0.0, 1.0)
        ramp = np.clip((q - 0.4) / (0.75 - 0.4), 0.0, 1.0)
        ramp = ramp * ramp * (3.0 - 2.0 * ramp)
        ramp = cv2.erode(ramp, self.kernel)
        return (ramp * 255.0 + 0.5).astype(np.uint8)


def matte_image(bgr: np.ndarray, segmenter: Optional[SelfieSegmenter] = None) -> np.ndarray:
    """The matte for one picture (uint8, the picture's size)."""
    h, w = bgr.shape[:2]
    return MatteSmoother(w, h)((segmenter or SelfieSegmenter()).probability(bgr))


def write_matte(video: str, out: str, width: int, height: int, fps: int | str = 30,
                timeout: float = MATTE_TIMEOUT_SECONDS, start: float = 0.0, duration: Optional[float] = None,
                max_edge: int = MAX_INTERNAL_EDGE, refine: bool = False) -> str:
    """A gray matte video (FFV1 in Matroska, lossless, full range) for `video`, frame for frame.

    `width`/`height` are the video's size; the matte is written at the internal size
    (same aspect, at most `max_edge`) and scaled by the compositor. `fps` may be a rate
    like "30000/1001". `start`/`duration` (seconds): only that part of the video (a matte
    for one window, starting at its first frame). `refine`: edges snapped to the picture (EdgeRefiner), for words
    behind the speaker. Raises MediaProcessError on failure."""
    if not available():
        raise MediaProcessError("Background removal is not available")
    if width <= 0 or height <= 0 or not _valid_rate(fps) or start < 0 or (duration is not None and duration <= 0):
        raise MediaProcessError("Invalid matte size")
    mw, mh = internal_size(width, height, max_edge)
    seek = ["-ss", f"{start:.3f}"] if start > 0 else []
    length = ["-t", f"{duration:.3f}"] if duration is not None else []
    decode = ["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, *seek, "-i", video, *length, "-map", "0:v:0", "-an", "-sn", "-dn",
              "-vf", f"fps={fps},scale={mw}:{mh}:flags=area", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    encode = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{mw}x{mh}",
              "-r", str(fps), "-i", "pipe:0", "-c:v", "ffv1", "-pix_fmt", "gray", out]
    segmenter = SelfieSegmenter()
    smooth = EdgeRefiner(mw, mh) if refine else MatteSmoother(mw, mh)
    frame_bytes = mw * mh * 3
    with tempfile.TemporaryFile() as errors:
        writer = subprocess.Popen(encode, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, env=media_child_env())
        timer = threading.Timer(timeout, lambda: writer.poll() is None and writer.kill())
        timer.daemon = True
        timer.start()
        frames = 0
        try:
            with media_process(decode, timeout=timeout) as (reader, _stderr):
                while True:
                    raw = reader.stdout.read(frame_bytes)
                    if not raw:
                        break
                    if len(raw) != frame_bytes:
                        raise MediaProcessError("Incomplete frame while cutting out the presenter")
                    frames += 1
                    if frames > MAX_FRAMES:
                        raise MediaProcessError("The recording is too long to cut out")
                    image = np.frombuffer(raw, np.uint8).reshape(mh, mw, 3)
                    try:
                        if refine:
                            # The model sees a square of 256 anyway: run it on a smaller copy, refine at full size.
                            small = cv2.resize(image, internal_size(mw, mh, MAX_INTERNAL_EDGE), interpolation=cv2.INTER_AREA)
                            matte = smooth(segmenter.probability(small), image)
                        else:
                            matte = smooth(segmenter.probability(image))
                        writer.stdin.write(matte.tobytes())
                    except (BrokenPipeError, OSError):
                        raise MediaProcessError("Writing the cut-out failed") from None
            if reader.returncode:
                raise MediaProcessError("Reading the recording failed")
            writer.stdin.close()
            writer.wait()
            if writer.returncode or frames == 0:
                errors.seek(0)
                logger.warning(f"Matte encode failed: {errors.read()[-400:]!r}")
                raise MediaProcessError("Writing the cut-out failed")
        finally:
            timer.cancel()
            if writer.poll() is None:
                writer.kill()
                writer.wait()
    return out
