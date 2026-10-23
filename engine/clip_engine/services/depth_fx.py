"""Depth and camera: the moves pro editors use that give a flat talking-head reel depth.

- Frame escape (stage scenes): the speaker's head breaks out above the top edge of the speaker card. The card is
  framed a little lower (the eyes near its top edge) and drawn from a taller crop; the part above the card's edge is
  the speaker cut out of the same frames (the selfie segmentation matte, segmentation.py) laid over the stage. The
  matte is made only for the stage scenes' frames, kept per clip window, and checked first: a matte that flickers,
  is mostly soft or misses the speaker turns the escape off for that scene (the card is framed as before).
- Type takeover (graphics depth "between"): one key line in huge type over the whole frame, the room behind darkened
  and blurred; the lines above the speaker's chin go behind them (their head sits between the lines), the lines below
  go in front of their chest. The split comes from the face found in the finished clip.
- Punch-ins on cues (the Zoom extra): a camera punch (1.0 -> 1.18, decelerating over about 6 frames, held, then a
  hard cut back) landing on the stressed word of a turn ("but", "here's the thing"), a reveal or a number; at most
  one every few seconds. The punch's frame is when the sound design's punch hits.
- Scene transitions: switching face / stage / visual cuts through a short camera move (a subtle zoom-through or a
  whip with motion blur, 6-10 frames, the cut in its middle) instead of only the card's slide. The scene's own start
  (the cut) is the moment the sound design's scene whoosh peaks on.

Everything here is pure math or a self-contained FFmpeg filter-graph builder (deterministic for the same input), so
each piece is unit-tested on its own; the renderers call in at one hook point each.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from typing import Optional, Sequence

logger = logging.getLogger(__name__)

Span = tuple[float, float]

# ---------------------------------------------------------------------------
# Frame escape
# ---------------------------------------------------------------------------

# Escape framing: the eye line this share of the card's height below its top edge (the normal card puts it at 0.36),
# so the forehead and hair rise over the edge.
ESCAPE_EYE_Y = 0.12
# The strip above the card the escape draws, as a share of the card's height (room for the hair over the edge).
ESCAPE_EXT = 0.34
# The escape is used only when the face is near the card's top: the eye line inside this share of the card.
ESCAPE_MAX_EYE = 0.30
# Where real hair ends above a face box (share of its height): the top of the head must be in the picture.
HAIR_ABOVE = 0.3
# An escape card comes in no closer than this many face heights (eyes near its top, the chin and shoulders inside).
ESCAPE_MIN_FACES = 1.55
# The share of a scene's face samples that must allow the escape (a missed or jumpy detection doesn't undo it).
ESCAPE_MIN_SHARE = 0.8
# The matte for the escape is cut at this long edge (head edges at card scale), and its version (bump on changes).
ESCAPE_MATTE_EDGE = 960
ESCAPE_MATTE_VERSION = 1
# Frames just outside a stage scene are segmented too (the card slides in and out over them, 350 ms of output time,
# longer on the source's clock at a faster export speed).
ESCAPE_MATTE_PAD_MS = 650
# A matte is good enough when the speaker is found in most frames, its edges are mostly decided, and it is steady.
QUALITY_PRESENT = 0.85
QUALITY_SOFT = 0.35
QUALITY_FLICKER = 0.12
# Escape mattes kept per cache folder (the newest; older ones are removed).
MAX_ESCAPE_MATTES = 16


@dataclass(frozen=True)
class MatteQuality:
    """How a matte did over one span: the share of frames with the speaker in them, the median share of soft (undecided)
    edge pixels, and the median frame-to-frame change of the speaker's shape."""

    present: float
    soft: float
    flicker: float

    @property
    def good(self) -> bool:
        return self.present >= QUALITY_PRESENT and self.soft <= QUALITY_SOFT and self.flicker <= QUALITY_FLICKER

    def as_dict(self) -> dict:
        return {"present": round(self.present, 4), "soft": round(self.soft, 4), "flicker": round(self.flicker, 4)}


def frame_stats(matte, previous=None) -> tuple[bool, float, float]:
    """(speaker present, soft share of the speaker's pixels, change from the previous frame) for one uint8 matte."""
    import numpy as np
    person = matte > 32
    count = int(person.sum())
    present = count > matte.size * 0.01
    soft = float(((matte > 32) & (matte < 224)).sum()) / max(1, count)
    flicker = 0.0
    if previous is not None:
        a, b = matte > 128, previous > 128
        union = int((a | b).sum())
        flicker = float((a ^ b).sum()) / max(1, union)
    return present, soft, flicker


def summarize(stats: Sequence[tuple[bool, float, float]]) -> MatteQuality:
    """A span's quality from its frames' stats (the first frame's change is not counted)."""
    if not stats:
        return MatteQuality(0.0, 1.0, 1.0)
    present = sum(1 for s in stats if s[0]) / len(stats)
    soft = sorted(s[1] for s in stats if s[0]) or [1.0]
    flicker = sorted(s[2] for s in stats[1:] if s[0]) or [0.0]
    return MatteQuality(present, soft[len(soft) // 2], flicker[len(flicker) // 2])


def matte_size(src_w: int, src_h: int, max_edge: int = ESCAPE_MATTE_EDGE) -> tuple[int, int]:
    from clip_engine.services.segmentation import internal_size
    return internal_size(src_w, src_h, max_edge)


def _in_spans(t_ms: float, spans: Sequence[tuple[int, int]], pad: int) -> int:
    """The index of the span t is in (with `pad` ms either side), or -1."""
    for i, (a, b) in enumerate(spans):
        if a - pad <= t_ms < b + pad:
            return i
    return -1


def write_span_matte(video: str, out: str, start_ms: int, duration_ms: int, fps: str, src_w: int, src_h: int,
                     spans: Sequence[tuple[int, int]], max_edge: int = ESCAPE_MATTE_EDGE, timeout: float = 1800) -> list[MatteQuality]:
    """A gray matte video (FFV1, lossless) for the render window [start, start + duration) of `video`, frame for frame
    on the render's clock (the same `fps=..:start_time=0:round=near` the render puts on the source), segmented only
    inside `spans` (window ms, with a little padding); every other frame is black. Returns each span's quality."""
    import numpy as np
    from clip_engine.services import segmentation
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, MediaProcessError, media_child_env, media_process
    if not segmentation.available():
        raise MediaProcessError("Background removal is not available")
    if not re.fullmatch(r"\d{1,6}(/\d{1,6})?", fps) or duration_ms <= 0 or start_ms < 0:
        raise MediaProcessError("Invalid matte request")
    num, _, den = fps.partition("/")
    rate = int(num) / int(den or 1)
    mw, mh = matte_size(src_w, src_h, max_edge)
    decode = ["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, "-accurate_seek", "-ss", f"{start_ms / 1000:.6f}",
              "-t", f"{duration_ms / 1000:.6f}", "-i", video, "-map", "0:v:0", "-an", "-sn", "-dn",
              "-vf", f"fps={fps}:start_time=0:round=near,scale={mw}:{mh}:flags=area", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    encode = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{mw}x{mh}",
              "-r", fps, "-i", "pipe:0", "-c:v", "ffv1", "-pix_fmt", "gray", out]
    segmenter = segmentation.SelfieSegmenter()
    blank = np.zeros((mh, mw), np.uint8).tobytes()
    frame_bytes = mw * mh * 3
    stats: list[list[tuple[bool, float, float]]] = [[] for _ in spans]
    refiner, previous, current = None, None, -1
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
                    t_ms = frames * 1000 / rate
                    frames += 1
                    if frames > segmentation.MAX_FRAMES:
                        raise MediaProcessError("The recording is too long to cut out")
                    k = _in_spans(t_ms, spans, ESCAPE_MATTE_PAD_MS)
                    if k < 0:
                        refiner, previous, current = None, None, -1
                        writer.stdin.write(blank)
                        continue
                    if k != current or refiner is None:
                        # A new span: no smoothing across the gap.
                        refiner, previous, current = segmentation.EdgeRefiner(mw, mh), None, k
                    image = np.frombuffer(raw, np.uint8).reshape(mh, mw, 3)
                    matte = refiner(segmenter.probability(image), image)
                    a, b = spans[k]
                    if a <= t_ms < b:
                        stats[k].append(frame_stats(matte, previous))
                    previous = matte
                    try:
                        writer.stdin.write(matte.tobytes())
                    except (BrokenPipeError, OSError):
                        raise MediaProcessError("Writing the cut-out failed") from None
            if reader.returncode:
                raise MediaProcessError("Reading the recording failed")
            writer.stdin.close()
            writer.wait()
            if writer.returncode or frames == 0:
                errors.seek(0)
                logger.warning(f"Escape matte encode failed: {errors.read()[-400:]!r}")
                raise MediaProcessError("Writing the cut-out failed")
        finally:
            timer.cancel()
            if writer.poll() is None:
                writer.kill()
                writer.wait()
    return [summarize(s) for s in stats]


def _cache_key(video: str, start_ms: int, duration_ms: int, fps: str, spans: Sequence[tuple[int, int]], size: tuple[int, int]) -> str:
    try:
        info = os.stat(video)
        ident = f"{os.path.realpath(video)}|{info.st_size}|{info.st_mtime_ns}"
    except OSError:
        ident = video
    text = f"{ident}|{start_ms}|{duration_ms}|{fps}|{list(spans)}|{size}|v{ESCAPE_MATTE_VERSION}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def _prune(folder: str, keep: set[str]) -> None:
    try:
        files = sorted((os.path.join(folder, n) for n in os.listdir(folder) if n.startswith("escape-")),
                       key=lambda p: os.stat(p).st_mtime, reverse=True)
    except OSError:
        return
    for path in files[2 * MAX_ESCAPE_MATTES:]:
        if os.path.basename(path) not in keep and not os.path.islink(path):
            try:
                os.remove(path)
            except OSError:
                pass


def escape_matte(video: str, cache_dir: str, work_dir: str, start_ms: int, duration_ms: int, fps: str, src_w: int, src_h: int,
                 spans: Sequence[tuple[int, int]], stem: str = "escape") -> tuple[Optional[str], list[bool]]:
    """The escape matte for a render window (window ms `spans`), from the cache when it was made before: a link to it
    in `work_dir` (the render removes its inputs when done) and whether each span's matte is good enough.
    (None, all False) when it can't be made."""
    spans = [(int(a), int(b)) for a, b in spans if b > a]
    if not spans:
        return None, []
    try:
        size = matte_size(src_w, src_h)
        key = _cache_key(video, start_ms, duration_ms, fps, spans, size)
        if os.path.islink(os.path.dirname(cache_dir)):
            raise ValueError("Invalid matte folder")
        os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        if os.path.islink(cache_dir):
            raise ValueError("Invalid matte folder")
        path, meta = os.path.join(cache_dir, f"escape-{key}.mkv"), os.path.join(cache_dir, f"escape-{key}.json")
        quality: Optional[list[dict]] = None
        if os.path.isfile(path) and os.path.isfile(meta) and not os.path.islink(path):
            try:
                with open(meta, encoding="utf-8") as handle:
                    quality = json.load(handle).get("quality")
                os.utime(path)
            except (OSError, ValueError):
                quality = None
        if not isinstance(quality, list) or len(quality) != len(spans):
            partial = os.path.join(cache_dir, f".tmp-{os.getpid()}-escape-{key}.mkv")
            try:
                found = write_span_matte(video, partial, start_ms, duration_ms, fps, src_w, src_h, spans)
                os.replace(partial, path)
            finally:
                if os.path.exists(partial):
                    os.remove(partial)
            quality = [q.as_dict() for q in found]
            tmp = meta + f".{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump({"quality": quality}, handle)
            os.replace(tmp, meta)
        _prune(cache_dir, {os.path.basename(path), os.path.basename(meta)})
        oks = [MatteQuality(float(q.get("present", 0)), float(q.get("soft", 1)), float(q.get("flicker", 1))).good for q in quality]
        link = os.path.join(work_dir, f"scene-{stem}-matte.mkv")
        if os.path.lexists(link):
            os.remove(link)
        try:
            os.link(path, link)
        except OSError:
            import shutil
            shutil.copyfile(path, link)
        return link, oks
    except Exception as error:  # noqa: BLE001 - the card is then framed as usual, with no escape
        logger.warning(f"Frame escape skipped: {type(error).__name__}: {error}")
        return None, [False] * len(spans)


# ---------------------------------------------------------------------------
# Type takeover: the split between the lines behind the speaker and the ones in front of them
# ---------------------------------------------------------------------------

# The chin is a little under a YuNet face box's bottom (share of the face height).
CHIN_BELOW = 0.06
# The room behind a takeover: blurred and darkened.
TAKEOVER_BLUR = 26
TAKEOVER_DIM = 0.38


def chin_row(face: Optional[tuple[float, float, float, float]]) -> Optional[int]:
    """The chin's row (frame px) from a face box (x0, y0, x1, y1), or None."""
    if face is None:
        return None
    x0, y0, x1, y1 = face
    return round(y1 + (y1 - y0) * CHIN_BELOW) if y1 > y0 else None


def takeover_split(lines: Sequence[tuple[int, int]], chin: Optional[int], height: int) -> int:
    """The row that splits a takeover's lines: those above it are drawn behind the speaker (the head sits between
    them), those below in front of the chest. A line goes behind when its middle is above the chin. Between two lines
    the split is in their gap; no face: every line behind (the frame height); no line above the chin: 0."""
    if not lines or chin is None:
        return height
    behind = [ln for ln in lines if (ln[0] + ln[1]) / 2 < chin]
    front = [ln for ln in lines if (ln[0] + ln[1]) / 2 >= chin]
    if not front:
        return height
    if not behind:
        return 0
    return max(0, min(height, round((behind[-1][1] + front[0][0]) / 2)))


# In a takeover the speaker (cut out) is shown smaller when filmed close, so the lines behind them still show around the
# head: their face at most this share of the frame's width (never smaller than TAKEOVER_MIN_SCALE), the face centered,
# and moved up or down (within TAKEOVER_RISE above / TAKEOVER_SINK below standing on the frame's bottom edge) so their
# chin meets the gap above the last line. The cut-out fades out at its sides (TAKEOVER_EDGE of its width) and, when it
# no longer reaches the bottom edge, at its bottom (TAKEOVER_FOOT), the last line in front of it.
TAKEOVER_FACE_W = 0.30
TAKEOVER_MIN_SCALE = 0.55
TAKEOVER_RISE = 0.30
TAKEOVER_SINK = 0.12
TAKEOVER_EDGE = 0.04
TAKEOVER_FOOT = 0.18


def takeover_person(face: Optional[tuple[float, float, float, float]], lines: Sequence[tuple[int, int]], width: int,
                    height: int) -> tuple[float, int, int]:
    """(scale, x, y) of the speaker's cut-out in a takeover ((1, 0, 0): as filmed)."""
    if face is None:
        return 1.0, 0, 0
    x0, y0, x1, y1 = face
    if x1 <= x0 or y1 <= y0:
        return 1.0, 0, 0
    scale = round(max(TAKEOVER_MIN_SCALE, min(1.0, TAKEOVER_FACE_W * width / (x1 - x0))), 4)
    sw, sh = max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)
    x = max(0, min(width - sw, round(width / 2 - (x0 + x1) / 2 * scale)))
    standing = height - sh
    y = standing
    chin = chin_row(face)
    if len(lines) >= 2 and chin is not None:
        gap = (lines[-2][1] + lines[-1][0]) / 2
        hair = y0 - HAIR_ABOVE * (y1 - y0)
        lo = max(standing - TAKEOVER_RISE * height, TAKEOVER_MIN_TOP * 0.5 * height - hair * scale)
        y = round(max(lo, min(standing + TAKEOVER_SINK * height, gap - chin * scale)))
    if scale >= 0.995 and abs(y) <= 2:
        return 1.0, 0, 0
    return scale, x, int(y)


def moved_row(row: int, person: tuple[float, int, int]) -> int:
    """A row of the frame where it lands in the takeover's moved cut-out."""
    scale, _, y = person
    return round(y + row * scale)


def person_fade(person: tuple[float, int, int], height: int) -> str:
    """The geq alpha expression that fades a takeover's cut-out at its sides (when smaller) and its foot (when it no
    longer stands on the bottom edge)."""
    scale, _, y = person
    sides = f"*clip(min(X,W-1-X)/(W*{TAKEOVER_EDGE}),0,1)" if scale < 0.995 else ""
    sh = max(2, round(height * scale / 2) * 2)
    foot = f"*clip((H-1-Y)/(H*{TAKEOVER_FOOT}),0,1)" if y + sh < height - 1 else ""
    return f"p(X,Y){sides}{foot}"


# How far the engine may move a takeover up or down (share of the frame) so a gap between its lines meets the chin.
TAKEOVER_MAX_SHIFT = 0.22
TAKEOVER_MIN_TOP = 0.08


def takeover_place(lines: Sequence[tuple[int, int]], chin: Optional[int], height: int) -> tuple[int, int]:
    """(shift, split) for a takeover: the graphic moves `shift` rows (at most TAKEOVER_MAX_SHIFT of the frame, never
    above TAKEOVER_MIN_TOP) so the gap between two of its lines nearest the chin meets it (the head between the lines,
    whatever the framing), and `split` is the row (in the graphic's own rows) between the lines drawn behind the
    speaker and the ones in front. No face, or a single line: no move, and takeover_split's rule."""
    if chin is None or len(lines) < 2:
        return 0, takeover_split(lines, chin, height)
    gaps = [(a[1] + b[0]) / 2 for a, b in zip(lines, lines[1:])]
    nearest = min(gaps, key=lambda g: abs(chin - g))
    room = TAKEOVER_MAX_SHIFT * height
    shift = round(max(TAKEOVER_MIN_TOP * height - lines[0][0], -room, min(room, chin - nearest)))
    split = takeover_split([(a + shift, b + shift) for a, b in lines], chin, height)
    return shift, max(0, min(height, split - shift)) if 0 < split < height else split


def output_to_source(ranges: Sequence[Sequence[int]], speed: float, start_ms: float, end_ms: float) -> list[tuple[int, int]]:
    """The source spans (ms) a stretch of the finished clip [start, end) plays from, through the cut and the speed."""
    a, b = start_ms * speed, end_ms * speed
    out, before = [], 0.0
    for lo, hi in ranges:
        length = hi - lo
        x, y = max(a, before), min(b, before + length)
        if y > x:
            out.append((round(lo + x - before), round(lo + y - before)))
        before += length
    return out


def takeover_backdrop_chain(windows: Sequence[Span]) -> str:
    """Filters (no labels) that blur and darken the clip during the takeovers' windows (seconds)."""
    if not windows:
        return "null"
    on = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in windows)
    return (f"gblur=sigma={TAKEOVER_BLUR}:enable='{on}',"
            f"lutyuv=y=val*{TAKEOVER_DIM}:u=128+(val-128)*0.7:v=128+(val-128)*0.7:enable='{on}'")


# ---------------------------------------------------------------------------
# Punch-ins on cues
# ---------------------------------------------------------------------------

CUE_ZOOM = 1.18
# The punch's push-in: this many frames, decelerating (most of the travel in the first few).
CUE_RAMP_FRAMES = 6
# It holds at least this long and at most this long (to the end of the phrase), then cuts back.
CUE_MIN_HOLD_S, CUE_MAX_HOLD_S = 0.9, 2.6
# Density: at least this far apart, and at most one per CUE_PER_S on average.
CUE_GAP_S = 4.0
CUE_PER_S = 7.0
MAX_CUE_PUNCHES = 8
# Phrases that turn the talk (the stressed word is the last one), and single turn words.
TURN_PHRASES = (("here's", "the", "thing"), ("here", "is", "the", "thing"), ("the", "truth", "is"), ("the", "secret", "is"),
                ("the", "problem", "is"), ("the", "reason", "is"), ("turns", "out"), ("that's", "why"), ("the", "real"),
                ("plot", "twist"), ("the", "catch"), ("the", "key", "is"), ("what", "nobody"))
TURN_WORDS = frozenset(("but", "however", "instead", "actually", "except", "until"))
NUMBER_WORDS = frozenset(("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
                          "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "million", "billion", "half", "double", "triple"))
_TOKEN = re.compile(r"[a-z0-9$%'.,]+")


def _tok(word: str) -> str:
    return re.sub(r"[^a-z0-9$%']", "", word.lower().replace("’", "'"))


def _is_number(raw: str, tok: str) -> bool:
    return bool(re.search(r"\d", raw)) or tok in NUMBER_WORDS


@dataclass(frozen=True)
class CuePunch:
    """A punch: the push-in starts at `start` (s), lands on the stressed word at `land`, holds, and cuts back at `end`."""

    start: float
    land: float
    end: float
    kind: str  # "turn" | "number"
    word: str


def punch_cues(words: Sequence[tuple[float, float, str]], total_s: float, fps: float = 30.0) -> list[CuePunch]:
    """Where the punch-ins go: on the stressed word of a turn ("but ...", "here's the THING"), a number reveal, at a
    sentence's start or after a pause. Each lands (fully pushed in) on its word, so it starts CUE_RAMP_FRAMES before;
    it holds to the end of that phrase (a sentence end, a comma or a pause), between CUE_MIN_HOLD_S and CUE_MAX_HOLD_S,
    and cuts back there. Strongest first (a phrase turn, then a number, then a turn word), at most one per CUE_PER_S
    on average and CUE_GAP_S apart; never in the first or last second."""
    seq = sorted((float(a), float(b), str(t)) for a, b, t in words if b > a)
    toks = [_tok(t) for _, _, t in seq]
    ramp = CUE_RAMP_FRAMES / max(1.0, fps)
    found: list[tuple[int, int, str]] = []  # (priority, word index of the stressed word, kind)
    for i, tok in enumerate(toks):
        starts_phrase = i == 0 or seq[i - 1][2].strip()[-1:] in ".!?,;:" or seq[i][0] - seq[i - 1][1] >= 0.3
        for phrase in TURN_PHRASES:
            n = len(phrase)
            if tuple(toks[i:i + n]) == phrase:
                found.append((3, i + n - 1, "turn"))
        if tok in TURN_WORDS and starts_phrase and i + 1 < len(seq):
            found.append((1, i, "turn"))
        if _is_number(seq[i][2], tok) and (i == 0 or not _is_number(seq[i - 1][2], toks[i - 1])):
            found.append((2, i, "number"))
    out: list[CuePunch] = []
    limit = min(MAX_CUE_PUNCHES, max(1, int(total_s / CUE_PER_S))) if total_s >= 4 else 0
    taken: set[int] = set()
    for priority, i, kind in sorted(found, key=lambda f: (-f[0], seq[f[1]][0])):
        if len(out) >= limit or i in taken:
            continue
        land = seq[i][0]
        start = land - ramp
        if start < 1.0 or land > total_s - 1.0 - CUE_MIN_HOLD_S:
            continue
        if any(abs(land - p.land) < CUE_GAP_S for p in out):
            continue
        # Hold to the end of the phrase the stressed word is in.
        end = None
        for j in range(i, len(seq)):
            a, b, t = seq[j]
            if b - land > CUE_MAX_HOLD_S:
                break
            nxt = seq[j + 1][0] if j + 1 < len(seq) else None
            if t.strip()[-1:] in ".!?,;:" or nxt is None or nxt - b >= 0.3:
                end = b if nxt is None else (b + nxt) / 2 if nxt - b < 0.3 else b + 0.12
                if end - land >= CUE_MIN_HOLD_S:
                    break
                end = None
        if end is None:
            end = land + CUE_MAX_HOLD_S
        end = min(end, land + CUE_MAX_HOLD_S, total_s - 0.5)
        if end - land < CUE_MIN_HOLD_S * 0.8:
            continue
        taken.add(i)
        out.append(CuePunch(round(start, 3), round(land, 3), round(end, 3), kind, seq[i][2]))
    return sorted(out, key=lambda p: p.start)


def ease_out_cubic(p: float) -> float:
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3


def punch_zoom_at(t: float, punch: CuePunch, zoom: float = CUE_ZOOM, fps: float = 30.0) -> float:
    """The punch's zoom at time t: 1 before it, decelerating up to `zoom` by its word, held, 1 again after its cut."""
    if t < punch.start or t >= punch.end:
        return 1.0
    return 1 + (zoom - 1) * ease_out_cubic((t - punch.start) / max(1e-6, punch.land - punch.start))


def ramp_chain(label: str, out: str, start: float, frames: int, fps: str, width: int, height: int,
               rect: tuple[int, int, int, int], zoom: float = CUE_ZOOM) -> str:
    """The push-in frames of one punch, from [label] (a copy of the full stream) to [out] at their own time: `frames`
    frames from `start`, zoomed from 1 to `zoom` with a decelerating ease toward the punch's crop `rect` (x, y, w, h;
    its top-left moves from the frame's corner to the crop's as the zoom grows), sub-pixel smooth (worked at 2x)."""
    x0, y0, _, _ = rect
    num, _, den = fps.partition("/")
    rate = int(num) / int(den or 1)
    length = frames / rate
    k = 1 - 1 / zoom
    z = f"1+{zoom - 1:.5f}*(1-pow(1-min(1,(on+1)/{frames}),3))"
    return (f"[{label}]trim=start={start:.4f}:duration={length + 0.5 / rate:.4f},setpts=PTS-STARTPTS,"
            f"scale={2 * width}:{2 * height}:flags=bicubic,"
            f"zoompan=z='{z}':x='{2 * x0}*(1-1/zoom)/{k:.6f}':y='{2 * y0}*(1-1/zoom)/{k:.6f}':d=1:s={width}x{height}:fps={fps},"
            f"trim=end_frame={frames},setsar=1,setpts=PTS+{start:.4f}/TB[{out}]")


# ---------------------------------------------------------------------------
# Scene transitions
# ---------------------------------------------------------------------------

TRANSITIONS = ("slide", "zoom", "whip")
DEFAULT_TRANSITION = "zoom"
# Output frames of the camera move around a cut (the cut in the middle).
TRANSITION_FRAMES = {"zoom": 8, "whip": 10}
# How far the subtle zoom-through pushes at the cut.
ZOOM_PEAK = 0.07
# The whip's horizontal blur (pixels at 1080 wide) near the cut.
WHIP_BLUR = 54


@dataclass(frozen=True)
class Transition:
    """A camera move around a scene change: `kind`, its middle (the cut, edited seconds), and its half length (s)."""

    kind: str
    at: float
    half: float

    @property
    def start(self) -> float:
        return self.at - self.half

    @property
    def end(self) -> float:
        return self.at + self.half


def transition_half(kind: str, fps: float, video_speed: float) -> float:
    """Half a transition's length on the edited clock (seconds): its output frames are sped up with the clip."""
    frames = TRANSITION_FRAMES.get(kind, 0)
    return frames / 2 / max(1.0, fps) * video_speed


def scene_transitions(segments: Sequence, fps: float, video_speed: float, total: float) -> list[Transition]:
    """A transition at each change of scene kind (face, stage, visual) on the edited clock: the style of the scene
    being entered (or, into face, of the scene being left); none for 'slide' (the card's slide alone), at the very
    start or end of the clip, or where one would overlap the one before."""
    out: list[Transition] = []
    for prev, seg in zip(segments, segments[1:]):
        if prev.scene == seg.scene:
            continue
        owner = seg if seg.scene != "face" else prev
        kind = getattr(owner, "transition", DEFAULT_TRANSITION) or DEFAULT_TRANSITION
        if kind not in TRANSITION_FRAMES:
            continue
        half = transition_half(kind, fps, video_speed)
        at = seg.start
        if at - half < 1e-3 or at + half > total - 1e-3:
            continue
        if out and out[-1].end > at - half:
            continue
        out.append(Transition(kind, round(at, 4), half))
    return out


def transition_chain(label: str, out: str, tr: Transition, fps: str, width: int, height: int) -> str:
    """[label] (a copy of the full frame) -> [out]: the frames of one transition, back at their own time.

    zoom: a push to 1 + ZOOM_PEAK that accelerates into the cut and decelerates out of it (cut on motion).
    whip: the frame races sideways (a full width over the move, wrapping) with a horizontal motion blur strongest at
    the cut; the new scene arrives already moving and lands decelerating."""
    num, _, den = fps.partition("/")
    rate = int(num) / int(den or 1)
    frames = max(2, round(2 * tr.half * rate))
    head = f"[{label}]trim=start={tr.start:.4f}:duration={frames / rate + 0.5 / rate:.4f},setpts=PTS-STARTPTS,"
    # p: 0..1 across the move (frame centers); the cut at p = 0.5.
    p = f"((on+0.5)/{frames})"
    if tr.kind == "zoom":
        bump = f"if(lt({p},0.5),pow({p}/0.5,2),pow(1-({p}-0.5)/0.5,2))"
        return (head + f"scale={2 * width}:{2 * height}:flags=bicubic,"
                f"zoompan=z='1+{ZOOM_PEAK}*{bump}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={width}x{height}:fps={fps},"
                f"trim=end_frame={frames},setsar=1,setpts=PTS+{tr.start:.4f}/TB[{out}]")
    # whip: x moves 0 -> width accelerating into the cut, then on decelerating (continuous at the cut).
    q = f"((n+0.5)/{frames})"
    x = f"if(lt({q},0.5),{width / 2}*pow({q}/0.5,2),{width}-{width / 2}*pow(1-({q}-0.5)/0.5,2))"
    blur = max(4, round(WHIP_BLUR * width / 1080)) // 2 * 2
    near = f"between(n,{max(0, frames // 2 - 2)},{frames // 2 + 1})"
    return (head + f"split[{out}_a][{out}_b];[{out}_a][{out}_b]hstack=inputs=2,"
            f"crop={width}:{height}:x='min({width},max(0,{x}))':y=0,"
            f"avgblur=sizeX={blur // 3}:sizeY=1,avgblur=sizeX={blur}:sizeY=1:enable='{near}',"
            f"trim=end_frame={frames},setsar=1,setpts=PTS+{tr.start:.4f}/TB[{out}]")


def transitions_graph(src: str, dst: str, transitions: Sequence[Transition], fps: str, width: int, height: int, tag: str = "st") -> str:
    """[src] -> [dst] with each transition's frames laid over their place (a plain copy without any)."""
    if not transitions:
        return f"[{src}]null[{dst}]"
    n = len(transitions)
    parts = [f"[{src}]split={n + 1}[{tag}_m]" + "".join(f"[{tag}_c{k}]" for k in range(n))]
    current = f"{tag}_m"
    for k, tr in enumerate(transitions):
        parts.append(transition_chain(f"{tag}_c{k}", f"{tag}_t{k}", tr, fps, width, height))
        nxt = dst if k == n - 1 else f"{tag}_o{k}"
        parts.append(f"[{current}][{tag}_t{k}]overlay=0:0:eof_action=pass:enable='between(t,{tr.start:.4f},{tr.end - 1e-3:.4f})'[{nxt}]")
        current = nxt
    return ";".join(parts)
