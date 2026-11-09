"""Reading the words on a screen recording's frame, offline, so a zoom can land on the number or phrase the speaker
says (and a glowing box can go around it, like "$1,227" on a dashboard).

The PaddleOCR PP-OCRv3 detection and recognition models (Apache-2.0, bundled in assets/models/ocr, unmodified) run on
ONNX Runtime (MIT) on the CPU: about half a second a frame, and only a few frames a video are read (where a number
or a key line is said over a screen). Without ONNX Runtime (an Intel Mac, an old macOS) available() is False and
nothing here runs: the zooms still follow the screen's activity.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from typing import Any, Optional, Sequence

logger = logging.getLogger(__name__)

MODELS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "models", "ocr"))
DET_MODEL = os.path.join(MODELS, "ch_PP-OCRv3_det_infer.onnx")
REC_MODEL = os.path.join(MODELS, "ch_PP-OCRv3_rec_infer.onnx")
# The detector sees the frame at most this big on its long side (multiples of 32).
DET_SIDE = 960
DET_THRESH, BOX_THRESH, UNCLIP = 0.3, 0.5, 1.6
REC_H, REC_MAX_W = 48, 1280
MIN_SCORE = 0.6

_lock = threading.Lock()
_sessions: dict[str, Any] = {}


def available() -> bool:
    """Whether words can be read here: ONNX Runtime imports and both models are bundled."""
    if not (os.path.isfile(DET_MODEL) and os.path.isfile(REC_MODEL)):
        return False
    try:
        import onnxruntime  # noqa: F401
    except Exception:  # noqa: BLE001 - missing or unloadable on this machine: no OCR
        return False
    return True


def _session(path: str):
    with _lock:
        if path not in _sessions:
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2) // 2))
            options.log_severity_level = 3
            _sessions[path] = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
        return _sessions[path]


def _characters() -> list[str]:
    meta = _session(REC_MODEL).get_modelmeta().custom_metadata_map
    return (meta.get("character") or "").splitlines()


def detect(image) -> list[tuple[float, float, float, float]]:
    """Text line boxes (x0, y0, x1, y1 px) in a BGR frame (DB text detector; boxes grown like its unclip)."""
    import cv2
    import numpy as np
    h, w = image.shape[:2]
    s = min(1.0, DET_SIDE / max(h, w))
    nh, nw = max(32, int(round(h * s / 32)) * 32), max(32, int(round(w * s / 32)) * 32)
    x = cv2.resize(image, (nw, nh)).astype(np.float32)[:, :, ::-1] / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    det = _session(DET_MODEL)
    prob = det.run(None, {det.get_inputs()[0].name: x})[0][0, 0]
    mask = cv2.dilate((prob > DET_THRESH).astype(np.uint8), np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours[:1000]:
        bx, by, bw, bh = cv2.boundingRect(c)
        if bw < 3 or bh < 3:
            continue
        region = prob[by:by + bh, bx:bx + bw][mask[by:by + bh, bx:bx + bw] > 0]
        if region.size == 0 or float(region.mean()) < BOX_THRESH:
            continue
        d = bw * bh * UNCLIP / (2 * (bw + bh))
        boxes.append((max(0.0, (bx - d) * w / nw), max(0.0, (by - d) * h / nh), min(float(w), (bx + bw + d) * w / nw),
                      min(float(h), (by + bh + d) * h / nh)))
    return sorted(boxes, key=lambda b: (round(b[1] / 10), b[0]))


def recognize(image, box: Sequence[float]) -> tuple[str, float]:
    """The words in one line box (CTC decode) and how sure the model is (0..1)."""
    import cv2
    import numpy as np
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    crop = image[max(0, y0):y1, max(0, x0):x1]
    if crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
        return "", 0.0
    width = int(min(REC_MAX_W, max(16, REC_H * crop.shape[1] / crop.shape[0])))
    r = cv2.resize(crop, (width, REC_H)).astype(np.float32)[:, :, ::-1] / 255.0
    r = ((r - 0.5) / 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    rec = _session(REC_MODEL)
    out = rec.run(None, {rec.get_inputs()[0].name: r})[0][0]
    chars = _characters()
    idx, probs = out.argmax(1), out.max(1)
    text, scores, prev = [], [], 0
    for i, p in zip(idx, probs):
        if i != prev and i != 0:
            text.append(chars[i - 1] if 0 < i <= len(chars) else " ")
            scores.append(float(p))
        prev = i
    return "".join(text).strip(), (sum(scores) / len(scores) if scores else 0.0)


def read(image) -> list[dict]:
    """Every line of words on a BGR frame: [{box (x0, y0, x1, y1 px), text, score}], confident lines only."""
    out = []
    for box in detect(image)[:80]:
        text, score = recognize(image, box)
        if text and score >= MIN_SCORE:
            out.append({"box": box, "text": text, "score": round(score, 3)})
    return out


def _norm(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", text.lower())


def _digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def find_said(lines: Sequence[dict], said: str) -> Optional[tuple[float, float, float, float]]:
    """Where on the frame the words said are written (x0, y0, x1, y1 px), or None. A number matches by its digits
    ("$1,227" said, "$1,227.00" shown; at least two digits, the shown number starting with them); words match as a
    run of letters inside a line (at least 6 letters), and the box is narrowed to the matched part of the line."""
    digits = _digits(said)
    if len(digits) >= 2 and re.search(r"\d", said):
        best = None
        for line in lines:
            for m in re.finditer(r"[$€£]?\d[\d,.]*%?", line["text"]):
                shown = _digits(m.group())
                if shown == digits or (shown.startswith(digits) and re.fullmatch(r"[$€£]?[\d,]+(\.0+)?%?", m.group())
                                       and len(_digits(m.group().split(".")[0])) == len(digits)):
                    box = _part(line, m.start(), m.end())
                    if best is None or line["score"] > best[0]:
                        best = (line["score"], box)
        return best[1] if best else None
    want = _norm(said)
    if len(want) < 6:
        return None
    for line in lines:
        text = line["text"]
        flat, where = [], []
        for k, ch in enumerate(text):
            n = _norm(ch)
            if n:
                flat.append(n)
                where.append(k)
        hit = "".join(flat).find(want)
        if hit >= 0:
            return _part(line, where[hit], where[hit + len(want) - 1] + 1)
    return None


def _part(line: dict, a: int, b: int) -> tuple[float, float, float, float]:
    """The share of a line's box its characters [a, b) take (characters spread evenly across the box)."""
    x0, y0, x1, y1 = line["box"]
    n = max(1, len(line["text"]))
    pad = (x1 - x0) / n * 0.3
    return (max(x0, x0 + (x1 - x0) * a / n - pad), y0, min(x1, x0 + (x1 - x0) * b / n + pad), y1)
