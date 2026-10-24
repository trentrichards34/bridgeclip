"""YouTube videos (landscape, long) from Edit my recording and Combine clips.

A run has a format: "reel" (vertical, short: everything else in edit_recording is about it, and it is unchanged) or
"youtube" (a 16:9 1920x1080 video, often 10-30 minutes). For a YouTube run this module holds:

- the format suggestion (suggest_format): long or landscape recordings start as a YouTube video;
- the landscape layouts: the recording as it was filmed, fitted to 16:9 (a talking head, or a screen recording that
  already has the webcam in it), and camera + screen as a picture-in-picture: the screen with the webcam as a large
  rounded card on the right (the screen fitted beside it) or in the bottom-right corner (pip_rect, screen_rect, the
  FFmpeg graphs in pip_graph / fit_graph);
- the long-form pacing profile (pace_graphics): a dense, branded cold open (a visual every 5-10 s for the first
  60-90 s, its words cards made into full-screen brand cards), then light (about one visual per 12-20 s, only where a
  number, a list or a key line is said; nothing over long screen demos); captions on key lines only (caption_quiet);
- planning a long transcript in sections, so each AI call stays well inside its limits (plan_sections,
  section_transcript, merge_section_plans);
- chapters for the YouTube description, from the director's sections, titled with words said (chapters_for).

The words-said rules are the same as a reel's: nothing here writes a word the speaker did not say.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional, Sequence

FORMATS = ("reel", "youtube")
YT_W, YT_H, FPS = 1920, 1080, 30
# A recording at least this long, or a landscape one at least SUGGEST_LANDSCAPE_S long, starts as a YouTube video.
SUGGEST_LONG_S = 180
SUGGEST_LANDSCAPE_S = 60


def suggest_format(width: Optional[int], height: Optional[int], seconds: float) -> str:
    """The format a run starts with (the member can switch): YouTube for a long recording (3+ minutes) or a landscape
    one over a minute; a short or vertical one is a reel. Mirrors src/shared/longform.ts suggestFormat."""
    seconds = float(seconds or 0)
    if seconds >= SUGGEST_LONG_S:
        return "youtube"
    landscape = bool(width and height and width > height * 1.1)
    return "youtube" if landscape and seconds >= SUGGEST_LANDSCAPE_S else "reel"


def is_youtube(config: Optional[dict]) -> bool:
    return isinstance(config, dict) and config.get("format") == "youtube"


# ---------------------------------------------------------------------------
# Layouts
# ---------------------------------------------------------------------------

LAYOUTS = ("full", "pip")
PIP_SIZES = ("small", "medium", "large")
PIP_CORNERS = ("right", "bottom_right")
CAPTION_MODES = ("key", "all")
DEFAULT_YOUTUBE = {"layout": "pip", "pip_size": "large", "pip_corner": "right", "captions": "key"}
# The webcam card's width as a share of the frame. On the right it is a tall card (3:4, the reference's large
# rounded webcam down the right side); in the corner a 16:9 card over the screen.
PIP_SHARE = {"right": {"small": 0.22, "medium": 0.26, "large": 0.30}, "bottom_right": {"small": 0.22, "medium": 0.27, "large": 0.32}}
PIP_ASPECT = {"right": 3 / 4, "bottom_right": 16 / 9}
MARGIN = 40


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def parse_youtube(raw: Any) -> dict:
    """The member's YouTube choices ({layout, pip_size, pip_corner, captions}), checked; missing keys take the defaults."""
    if raw is None:
        return dict(DEFAULT_YOUTUBE)
    if not isinstance(raw, dict) or not set(raw) <= set(DEFAULT_YOUTUBE):
        raise ValueError("Invalid YouTube layout")
    out = {**DEFAULT_YOUTUBE, **raw}
    if out["layout"] not in LAYOUTS or out["pip_size"] not in PIP_SIZES or out["pip_corner"] not in PIP_CORNERS \
            or out["captions"] not in CAPTION_MODES:
        raise ValueError("Invalid YouTube layout")
    return out


def pip_rect(size: str = "large", corner: str = "right", width: int = YT_W, height: int = YT_H) -> tuple[int, int, int, int]:
    """The webcam card (x, y, w, h px): a tall card centered down the right side, or a 16:9 card in the bottom-right
    corner, `size` of the frame's width, kept inside the margins."""
    size = size if size in PIP_SIZES else "large"
    corner = corner if corner in PIP_CORNERS else "right"
    m = round(MARGIN * width / YT_W)
    w = width * PIP_SHARE[corner][size]
    h = w / PIP_ASPECT[corner]
    if h > height - 2 * m:
        h = height - 2 * m
        w = h * PIP_ASPECT[corner]
    w, h = _even(w), _even(h)
    x = width - m - w
    y = (height - h) // 2 if corner == "right" else height - m - h
    return x - x % 2, y - y % 2, w, h


def pip_radius(w: int, h: int) -> int:
    return max(8, round(min(w, h) * 0.08))


def screen_rect(corner: str, size: str, screen_w: int, screen_h: int, width: int = YT_W, height: int = YT_H) -> tuple[int, int, int, int]:
    """Where the screen recording sits (x, y, w, h px), fitted whole: beside a webcam card on the right (left of it,
    centered in the space), or across the frame with the corner card over it."""
    aspect = screen_w / screen_h if screen_w and screen_h else 16 / 9
    if corner == "right":
        px, _, _, _ = pip_rect(size, corner, width, height)
        m = round(MARGIN * width / YT_W)
        area = (m, m, px - m - round(m * 0.6), height - 2 * m)
    else:
        area = (0, 0, width, height)
    ax, ay, aw, ah = area
    w, h = (aw, aw / aspect) if aw / aspect <= ah else (ah * aspect, ah)
    w, h = _even(w), _even(h)
    return ax + (aw - w) // 2 // 2 * 2, ay + (ah - h) // 2 // 2 * 2, w, h


def pip_share_box(size: str, corner: str) -> list[float]:
    """The webcam card as shares of the frame (x, y, w, h), kept with the editor project so graphics keep clear of it."""
    x, y, w, h = pip_rect(size, corner)
    return [round(x / YT_W, 4), round(y / YT_H, 4), round(w / YT_W, 4), round(h / YT_H, 4)]


def card_mask(path: str, w: int, h: int) -> str:
    """The webcam card's rounded-corner alpha (white inside, black outside), as a grayscale PNG."""
    from PIL import Image, ImageDraw
    scale = 4
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius=pip_radius(w, h) * scale, fill=255)
    big.resize((w, h), Image.LANCZOS).save(path)
    return path


def stage_layers(work: str, rect: tuple[int, int, int, int], screen_box: tuple[int, int, int, int], width: int = YT_W,
                 height: int = YT_H) -> tuple[str, str]:
    """The picture-in-picture's two still layers (PNG): the backdrop (a calm dark gradient with soft shadows under the
    screen and the webcam card) and the top layer (the screen's rounded corners in the backdrop's color, a thin light
    edge on the screen and a ring around the card)."""
    import os
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    x, y, w, h = rect
    sx, sy, sw, sh = screen_box
    r, sr = pip_radius(w, h), max(8, round(min(sw, sh) * 0.022))
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    d = np.sqrt(((xx - width * 0.3) / width) ** 2 + ((yy - height * 0.15) / height) ** 2)
    t = np.clip(d / 1.1, 0, 1)[..., None]
    base = (np.array([28, 33, 46], np.float32) * (1 - t) + np.array([9, 11, 16], np.float32) * t).astype(np.uint8)
    back = Image.fromarray(base, "RGB")
    shadow = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle((sx, sy + 14, sx + sw, sy + sh + 20), radius=sr + 6, fill=170)
    draw.rounded_rectangle((x, y + 14, x + w, y + h + 20), radius=r + 6, fill=190)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    back = Image.composite(Image.new("RGB", (width, height), (0, 0, 0)), back, shadow)
    backdrop = os.path.join(work, "pip-backdrop.png")
    back.save(backdrop)
    # Top: the backdrop outside the screen's rounded corners (so the screen reads as a rounded window), its edge, the ring.
    inside = Image.new("L", (width, height), 0)
    ImageDraw.Draw(inside).rounded_rectangle((sx, sy, sx + sw - 1, sy + sh - 1), radius=sr, fill=255)
    box = Image.new("L", (width, height), 0)
    ImageDraw.Draw(box).rectangle((sx, sy, sx + sw - 1, sy + sh - 1), fill=255)
    corners = Image.fromarray(np.minimum(np.asarray(box), 255 - np.asarray(inside)).astype(np.uint8), "L")
    top = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    top.paste(back.convert("RGBA"), (0, 0), corners)
    edge = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((sx, sy, sx + sw - 1, sy + sh - 1), radius=sr, outline=(255, 255, 255, 34), width=2)
    ImageDraw.Draw(edge).rounded_rectangle((x - 4, y - 4, x + w + 3, y + h + 3), radius=r + 4, fill=(255, 255, 255, 64))
    top = Image.alpha_composite(top, edge)
    layer = os.path.join(work, "pip-top.png")
    top.save(layer)
    return backdrop, layer


def fit_graph(src: str, out: str, width: int = YT_W, height: int = YT_H) -> str:
    """Filter graph: a recording fitted whole into the 16:9 frame over a dark, blurred copy of itself (a 16:9
    recording simply fills it; a phone's vertical one gets soft sides)."""
    return (f"{src}split=2[fa][fb];[fa]scale={width // 8}:{height // 8}:force_original_aspect_ratio=increase,crop={width // 8}:{height // 8},"
            f"gblur=sigma=6,eq=brightness=-0.18,scale={width}:{height},setsar=1[fbg];"
            f"[fb]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[ffg];"
            f"[fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps={FPS}{out}")


def pip_graph(screen: str, camera: str, mask: str, backdrop: str, top: str, out: str, rect: tuple[int, int, int, int],
              screen_box: tuple[int, int, int, int], face_x: float = 0.5) -> str:
    """Filter graph: the screen fitted in `screen_box` on the dark backdrop (stage_layers), the top layer (rounded
    corners, edge, the card's ring), then the webcam cropped to the card around the face (`face_x`: its center as a
    share of the camera's width), rounded by `mask`, at `rect`."""
    x, y, w, h = rect
    sx, sy, sw, sh = screen_box
    fx = min(1.0, max(0.0, face_x))
    return (f"{screen}scale={sw}:{sh},setsar=1[sfg];{backdrop}format=yuv420p[bg];[bg][sfg]overlay={sx}:{sy}:shortest=1[sc];"
            f"[sc]{top}overlay=0:0:shortest=1[sf];"
            f"{camera}scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}:'max(0,min(iw-{w},iw*{fx:.4f}-{w}/2))':'(ih-{h})*0.4',setsar=1,format=yuva420p[cam];"
            f"{mask}format=gray,scale={w}:{h}[mk];[cam][mk]alphamerge[card];[sf][card]overlay={x}:{y}:shortest=1,setsar=1,fps={FPS},format=yuv420p{out}")


# ---------------------------------------------------------------------------
# Long-form pacing
# ---------------------------------------------------------------------------

COLD_OPEN_S = (60.0, 90.0)
# A visual every 5-10 s in the cold open; then about one per 12-20 s.
COLD_GAP_S = (5.0, 10.0)
BODY_GAP_S = (12.0, 20.0)
# Plain words cards: in the body they only come as captions on key lines (the screen is the visual).
TEXT_CARDS = ("statement", "title", "quote", "big_words", "headline_pill", "sticky_notes", "takeover")
# Effects that are made of the words said (the cold open's kinetic type and chips), and number effects (shown over
# the screen as a stat overlay, not a full card).
WORD_EFFECTS = ("titlecard-lockup", "per-word-rise", "state-chip-rail", "marker-highlight", "flanking-words", "vox-annotate")
NUMBER_EFFECTS = ("count-up", "number-pop-in", "gauge", "waffle-chart")
NUMBER_TEMPLATES = ("stat",)
KEEP_ALWAYS = ("chapter", "link_cta", "comment_cta", "logo", "screen_frame")
# A screen demo this long (no graphic cue in it) keeps only zoom-ins.
DEMO_MIN_MS = 20_000


def cold_open_ms(total_ms: int) -> int:
    """How long the dense cold open runs: 60-90 s (about 6% of the video), never more than 40% of a short one."""
    total_s = max(0.0, total_ms / 1000)
    return int(round(1000 * min(total_s * 0.4, max(COLD_OPEN_S[0], min(COLD_OPEN_S[1], total_s * 0.06)))))


def _register_factor(register: Optional[str]) -> float:
    return {"story": 1.4, "minimal": 2.0}.get(register or "", 1.0)


def pacing_profile(total_ms: int, register: Optional[str] = None) -> dict:
    """The long-form pacing for a video this long, in ms: the cold open's length, the least time between two visuals
    there and after it (the register stretches both: a story is sparser, minimal sparser still)."""
    k = _register_factor(register)
    return {"cold_open_ms": cold_open_ms(total_ms), "cold_gap_ms": int(COLD_GAP_S[0] * 1000 * min(k, 1.5)),
            "cold_max_gap_ms": int(COLD_GAP_S[1] * 1000 * min(k, 1.5)), "body_gap_ms": int(BODY_GAP_S[0] * 1000 * k),
            "body_max_gap_ms": int(BODY_GAP_S[1] * 1000 * k)}


def _effect(g: dict) -> str:
    return str((g.get("fields") or {}).get("effect") or "") if g.get("template") == "fx" else ""


def is_number_visual(g: dict) -> bool:
    return g.get("template") in NUMBER_TEMPLATES or _effect(g) in NUMBER_EFFECTS


def is_word_visual(g: dict) -> bool:
    return g.get("template") in TEXT_CARDS or _effect(g) in WORD_EFFECTS


def pace_graphics(graphics: Sequence[dict], total_ms: int, register: Optional[str] = None,
                  demos: Sequence[tuple[int, int]] = ()) -> list[dict]:
    """The automatic graphics paced for a long video (reel ms): in the cold open, a visual at least every cold_gap
    apart, words cards made into full-screen brand cards (size "stage") and numbers kept as overlays over the screen;
    after it, at least body_gap apart, no plain words cards (those come as captions on key lines) and nothing inside a
    long screen demo (`demos`). The member's own graphics, chapters, the call to action and logos always stay. Nothing
    is drawn behind the speaker on a landscape video (no depth)."""
    from clip_engine.services.auto_graphics import MAX_GRAPHICS
    profile = pacing_profile(total_ms, register)
    cold = profile["cold_open_ms"]
    out: list[dict] = []
    last_start = last_end = -10**9
    for g in sorted(graphics, key=lambda g: g["at_ms"]):
        g = {k: v for k, v in g.items() if k != "depth"}
        if g.get("origin") in ("member", "chat") or g.get("template") in KEEP_ALWAYS:
            out.append(g)
            continue
        at = int(g["at_ms"])
        if at < cold:
            # A number over the screen (a stat overlay) only waits for the visual before to leave; cards keep the gap.
            overlay_ok = is_number_visual(g) and at >= last_end + 400
            if at - last_start < profile["cold_gap_ms"] and not overlay_ok:
                continue
            if is_word_visual(g) or g.get("template") in ("list", "checklist", "strike_list", "icon_pop", "feature_tile", "orbit"):
                g = {**g, "size": "stage"}
            elif is_number_visual(g):
                g = {**g, "size": "compact", "placement": "bottom"}
            out.append(g)
            last_start, last_end = at, at + int(g["duration_ms"])
            continue
        if at - last_start < profile["body_gap_ms"] or g.get("template") in TEXT_CARDS:
            continue
        if any(a <= at < b and b - a >= DEMO_MIN_MS for a, b in demos):
            continue
        if is_number_visual(g):
            g = {**g, "size": "compact", "placement": "bottom"}
        elif g.get("size") == "stage" and g.get("template") not in ("staircase", "funnel", "journey", "growth", "idea_hub"):
            g = {**g, "size": "card"}
        out.append(g)
        last_start = at
    return sorted(out, key=lambda g: g["at_ms"])[:MAX_GRAPHICS]


def cold_open_word_limit(words: Sequence[Any], marks: Sequence[Optional[str]], seconds: float) -> int:
    """The last word index (kept, in recording order) said within the first `seconds` of kept speech: the cold open's
    end on the plan's words, for the planner's guidance."""
    spoken = 0.0
    last = 0
    for i, w in enumerate(words):
        if marks[i] is not None:
            continue
        spoken += max(0, w.end_ms - w.start_ms) / 1000 * 1.25
        last = i
        if spoken >= seconds:
            break
    return last


def longform_rule(seconds: float, cold_s: float, cold_end_word: Optional[int], section: int = 0, sections: int = 1) -> str:
    """The planner's guidance for a long landscape video (after the reel's MOTION GRAPHICS rule, which it narrows)."""
    rule = (
        "\n\nTHIS IS A LONG LANDSCAPE YOUTUBE VIDEO (16:9, about " + f"{max(1, round(seconds / 60))}" + " minutes), not a reel. "
        "The pacing is front-loaded, like the best YouTube edits: "
    )
    if section == 0:
        rule += (
            f"THE COLD OPEN (the first {cold_s:.0f} seconds"
            + (f", word indices up to {cold_end_word}" if cold_end_word is not None else "")
            + ") is dense and branded: a visual every 5-10 seconds. Prefer full-screen kinetic type made of their words: fx "
            "titlecard-lockup (a short line as a title), fx per-word-rise (a line rising word by word), fx state-chip-rail "
            "(numbered chips for the steps they name, like 01 Input 02 Process 03 Output, only words said), fx count-up or "
            "fx number-pop-in on every number or result said (shown over the screen), fx marker-highlight on a key phrase. "
        )
    rule += (
        "AFTER THE COLD OPEN the video is screen-led and light: about one visual every 12-20 seconds, only where a number, "
        "a list or a key line is said (a stat, a number effect, one diagram per section); no plain text cards there, and "
        "nothing while they walk through a screen for a long stretch. "
        "Hooks: the hook is the first line of the video, in the cold open. "
    )
    if sections > 1:
        rule += (f"You are planning PART {section + 1} of {sections} of this video (only these words). "
                 + ("Give the hooks from this part. " if section == 0 else "Leave hooks empty in this part. ")
                 + ("The call to action, if any, is in this part. " if section == sections - 1 else "Set cta present false in this part. "))
    rule += ("Also return chapter: a short title for this part's main topic (2-6 words) using ONLY words said in this part, in "
             "their order; empty when none fits.")
    return rule


# ---------------------------------------------------------------------------
# Captions on key lines
# ---------------------------------------------------------------------------

EMPHASIS = {"never", "always", "secret", "exactly", "biggest", "best", "worst", "mistake", "most", "only", "every", "nobody",
            "everyone", "guaranteed", "simple", "fastest", "important", "key", "truth", "stop", "free", "first"}
KEY_LINE_GAP_MS = 20_000


def _sentences(timed: Sequence[Sequence[Any]]) -> list[list[Sequence[Any]]]:
    from clip_engine.services.edit_recording import ends_sentence
    out: list[list[Sequence[Any]]] = []
    current: list[Sequence[Any]] = []
    for w in timed:
        if current and int(w[1]) - int(current[-1][2]) > 900:
            out.append(current)
            current = []
        current.append(w)
        if ends_sentence(str(w[0])) or len(current) >= 24:
            out.append(current)
            current = []
    if current:
        out.append(current)
    return out


def key_lines(timed: Sequence[Sequence[Any]], total_ms: int, cold_ms: int = 0) -> list[tuple[int, int]]:
    """The lines worth a caption (reel ms): every line in the cold open, then a line with a number or a strong word
    (4-18 words), at most one every KEY_LINE_GAP_MS."""
    from clip_engine.services.edit_recording import numbers_in
    out: list[tuple[int, int]] = []
    last = -10**9
    for line in _sentences(timed):
        a, b = int(line[0][1]), int(line[-1][2])
        text = " ".join(str(w[0]) for w in line)
        if a < cold_ms:
            out.append((a, b))
            continue
        tokens = {re.sub(r"[^a-z']", "", str(w[0]).lower()) for w in line}
        strong = bool(numbers_in(text)) or bool(tokens & EMPHASIS)
        if strong and 4 <= len(line) <= 18 and a - last >= KEY_LINE_GAP_MS:
            out.append((a, b))
            last = a
    return out


def caption_quiet(timed: Sequence[Sequence[Any]], total_ms: int, mode: str = "key", cold_ms: int = 0) -> list[list[int]]:
    """Caption suppression ranges (reel ms) for key-lines-only captions: everything but the key lines (sorted, apart,
    each at least 100 ms, at most 200 of them, as the editor checks). [] with captions on every line."""
    if mode != "key" or total_ms <= 0:
        return []
    keep = key_lines(timed, total_ms, cold_ms)
    out: list[list[int]] = []
    at = 0
    for a, b in keep:
        lo, hi = at, max(at, a - 60)
        if hi - lo >= 100:
            out.append([lo, hi])
        at = max(at, b + 120)
    if total_ms - at >= 100:
        out.append([at, int(total_ms)])
    while len(out) > 200:
        # Join the two closest neighbors (their key line goes quiet).
        k = min(range(len(out) - 1), key=lambda i: out[i + 1][0] - out[i][1])
        out[k:k + 2] = [[out[k][0], out[k + 1][1]]]
    return out


# ---------------------------------------------------------------------------
# Long transcripts: planned in sections
# ---------------------------------------------------------------------------

# About 9-10 minutes of speech per AI call: the transcript, the guidance and the answer stay well inside the model's limits.
SECTION_WORDS = 1400


def plan_sections(words: Sequence[Any], max_words: int = SECTION_WORDS) -> list[tuple[int, int]]:
    """The transcript in sections [lo, hi) of about equal size (at most `max_words`), each ending at a spoken line's end."""
    from clip_engine.services.edit_recording import lines_of
    n = len(words)
    if n <= max_words:
        return [(0, n)] if n else []
    count = math.ceil(n / max_words)
    target = n / count
    lines = lines_of(list(words))
    out: list[tuple[int, int]] = []
    lo = 0
    for line in lines:
        end = line[-1] + 1
        if len(out) < count - 1 and end - lo >= target * 0.85 and (end - lo >= target or end - lo + len(line) > max_words):
            out.append((lo, end))
            lo = end
    if lo < n:
        out.append((lo, n))
    # A section a single very long line made too big is split at word boundaries.
    fixed: list[tuple[int, int]] = []
    for a, b in out:
        while b - a > max_words:
            fixed.append((a, a + max_words))
            a += max_words
        fixed.append((a, b))
    return fixed


def section_transcript(words: Sequence[Any], marks: Sequence[Optional[str]], names: Sequence[str], lo: int, hi: int) -> str:
    """The plan's transcript for words [lo, hi), with their global indices (the merged plan's indices stay valid)."""
    from clip_engine.services.edit_recording import lines_of
    out: list[str] = []
    src = -1
    for line in lines_of(list(words)):
        if not lo <= line[0] < hi:
            continue
        first = words[line[0]]
        if first.src != src:
            src = first.src
            if len(names) > 1:
                out.append(f"--- Take file {src + 1}: {names[src] if src < len(names) else ''} ---")
        hint = " (likely a retake or filler: " + ", ".join(sorted({marks[i] for i in line if marks[i]})) + ")" \
            if any(marks[i] for i in line) else ""
        out.append(f"[{first.start_ms / 1000:.1f}s]{hint} " + " ".join(f"{i}:{words[i].text}" for i in line))
    return "\n".join(out)


def merge_section_plans(raws: Sequence[Optional[dict]], sections: Sequence[tuple[int, int]]) -> dict:
    """One plan from the sections' answers: the hooks from the first part that gives any, the call to action from the
    last that has one, cuts, sounds and graphics from each part kept within its own words, and each part's chapter title
    with the word it starts on."""
    merged: dict[str, Any] = {"hooks": [], "cuts": [], "cta": {"present": False, "start": 0, "end": 0}, "sounds": [], "graphics": [],
                              "chapters": []}

    def inside(value: Any, lo: int, hi: int) -> bool:
        return type(value) is int and lo <= value < hi

    for raw, (lo, hi) in zip(raws, sections):
        if not isinstance(raw, dict):
            continue
        if not merged["hooks"]:
            merged["hooks"] = [h for h in raw.get("hooks") or [] if isinstance(h, dict) and inside(h.get("start"), lo, hi) and inside(h.get("end"), lo, hi)]
        merged["cuts"] += [c for c in raw.get("cuts") or [] if isinstance(c, dict) and inside(c.get("start"), lo, hi) and inside(c.get("end"), lo, hi)]
        cta = raw.get("cta")
        if isinstance(cta, dict) and cta.get("present") is True and inside(cta.get("start"), lo, hi) and inside(cta.get("end"), lo, hi):
            merged["cta"] = dict(cta)
        merged["sounds"] += [s for s in raw.get("sounds") or [] if isinstance(s, dict) and inside(s.get("word"), lo, hi)]
        merged["graphics"] += [g for g in raw.get("graphics") or [] if isinstance(g, dict) and inside(g.get("word"), lo, hi)]
        for key in ("popups", "cards"):
            if isinstance(raw.get(key), list):
                merged.setdefault(key, []).extend(x for x in raw[key] if isinstance(x, dict) and inside(x.get("word"), lo, hi))
        title = raw.get("chapter")
        if isinstance(title, str) and title.strip():
            merged["chapters"].append({"word": lo, "title": title.strip()})
    return merged


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------

# YouTube shows chapters when the first starts at 0:00, there are at least 3 and each is at least 10 s long.
MIN_CHAPTERS, MAX_CHAPTERS = 3, 12
MIN_CHAPTER_MS = 10_000
CHAPTER_EVERY_S = 180
LEAD_WORDS = {"so", "and", "but", "okay", "ok", "now", "um", "uh", "like", "well", "right", "alright", "then", "also", "anyway"}
MAX_TITLE_WORDS = 6


def _clean(token: str) -> str:
    return re.sub(r"[^\w'$%€£.,-]", "", token).strip(".,")


def said_title(text: str, said: Sequence[str]) -> str:
    """A chapter title kept only when every word in it is said (in `said`, in that order); else ''."""
    from clip_engine.services.edit_recording import norm
    wanted = [norm(t) for t in text.split() if norm(t)]
    if not wanted or len(wanted) > MAX_TITLE_WORDS + 2:
        return ""
    pool = [norm(t) for t in said]
    at = 0
    for w in wanted:
        try:
            at = pool.index(w, at) + 1
        except ValueError:
            return ""
    return " ".join(_clean(t) for t in text.split() if _clean(t))


def title_from_words(tokens: Sequence[str]) -> str:
    """A title from the words said at a chapter's start: leading fillers dropped, up to the first stop or six words."""
    from clip_engine.services.edit_recording import ends_sentence
    out: list[str] = []
    for raw in tokens:
        word = _clean(str(raw))
        if not word:
            continue
        if not out and word.lower() in LEAD_WORDS:
            continue
        out.append(word)
        if len(out) >= MAX_TITLE_WORDS or ends_sentence(str(raw)) or str(raw).rstrip().endswith(","):
            break
    if not out:
        return ""
    text = " ".join(out)
    return text[0].upper() + text[1:]


def chapters_for(timed: Sequence[Sequence[Any]], total_ms: int, titled: Optional[dict[int, str]] = None) -> list[dict]:
    """The video's chapters [{at_ms, title}] on the reel's clock, each starting on a line, the first at 0:00, each at
    least 10 s: where the director's sections start (`titled`: word index -> title, already checked as said), else about
    one per 3 minutes (3-12) titled from the words said there. [] when the video is too short for 3 chapters."""
    if total_ms < MIN_CHAPTERS * MIN_CHAPTER_MS * 1.5 or not timed:
        return []
    titled = titled or {}
    lines = _sentences(timed)
    starts = [int(line[0][1]) for line in lines]
    line_of = {int(w[3]): k for k, line in enumerate(lines) for w in line if len(w) > 3}
    # The director's sections are chapters where they start (their titles were checked as said)...
    named = {line_of[i]: t for i, t in titled.items() if i in line_of}
    picks = [0]

    def fits(k: int) -> bool:
        return all(abs(starts[k] - starts[p]) >= MIN_CHAPTER_MS for p in picks) and total_ms - starts[k] >= MIN_CHAPTER_MS

    for k in sorted(named):
        if k > 0 and fits(k) and len(picks) < MAX_CHAPTERS:
            picks.append(k)
    # ...and with too few of those, about one every 3 minutes, each on the line closest to its share of the video.
    if len(picks) < MIN_CHAPTERS:
        count = max(MIN_CHAPTERS, min(MAX_CHAPTERS, round(total_ms / 1000 / CHAPTER_EVERY_S)))
        for j in range(1, count):
            want = total_ms * j / count
            best = min(range(len(lines)), key=lambda i: abs(starts[i] - want))
            if fits(best):
                picks.append(best)
    picks.sort()
    out: list[dict] = []
    used: set[str] = set()
    for n, i in enumerate(picks):
        title = named.get(i, "") if named.get(i, "").lower() not in used else ""
        if not title:
            title = title_from_words([str(w[0]) for w in lines[i][:12]])
        if not title or title.lower() in used:
            title = title_from_words([str(w[0]) for line in lines[i + 1:i + 3] for w in line][:12]) or title
        used.add(title.lower())
        out.append({"at_ms": 0 if n == 0 else starts[i], "title": title[:80]})
    return out if len(out) >= MIN_CHAPTERS else []


def clock(ms: int, hours: bool = False) -> str:
    s = max(0, int(ms // 1000))
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if hours else f"{s // 60}:{s % 60:02d}"


def chapters_text(chapters: Sequence[dict]) -> str:
    """The chapters as YouTube reads them in a description: one 'M:SS Title' line each."""
    hours = any(c["at_ms"] >= 3600_000 for c in chapters)
    return "\n".join(f"{clock(c['at_ms'], hours)} {c['title']}" for c in chapters)


# ---------------------------------------------------------------------------
# Long bakes: in chunks
# ---------------------------------------------------------------------------

# A bake longer than this is made in chunks of about CHUNK_MS, so FFmpeg only ever holds one chunk's graphics.
CHUNK_AFTER_MS = 6 * 60_000
CHUNK_MS = 4 * 60_000


def chunk_ranges(total_ms: int, busy: Sequence[tuple[int, int]] = (), chunk_ms: int = CHUNK_MS) -> list[tuple[int, int]]:
    """[start, end) ms chunks covering the video, about `chunk_ms` long, each cut where nothing in `busy` (graphic
    windows) plays, so no graphic is split between two chunks (a cut lands at the nearest free point)."""
    if total_ms <= 0:
        return []
    cuts = [0]
    while total_ms - cuts[-1] > chunk_ms * 1.25:
        want = cuts[-1] + chunk_ms
        free = want
        for a, b in sorted(busy):
            if a < free < b:
                free = b
        if free >= total_ms - 1000:
            break
        cuts.append(int(free))
    cuts.append(int(total_ms))
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1) if cuts[i + 1] > cuts[i]]


# ---------------------------------------------------------------------------
# Planning a YouTube video (Edit my recording / Combine clips, mode "plan")
# ---------------------------------------------------------------------------

# Sections planned at once (each is its own AI call).
PLAN_CONCURRENCY = 3


def longform_schema(schema: dict) -> dict:
    """The plan's schema with a chapter title for the part planned."""
    import json
    out = json.loads(json.dumps(schema))
    out["properties"]["chapter"] = {"type": "string", "description": "This part's main topic in 2-6 words said in it ('' when none fits)"}
    out["required"] = [*out["required"], "chapter"]
    return out


def effective_seconds(kept_s: float) -> float:
    """The length the reel's graphics guidance is given, so its count matches the long-form pacing: one visual per
    ~7 s in the cold open, one per ~16 s after it (the guidance asks for one per ~10 s)."""
    cold = min(kept_s, cold_open_ms(int(kept_s * 1000)) / 1000)
    return 10 * (cold / 7 + max(0.0, kept_s - cold) / 16)


def graphics_budget(kept_s: float, register: Optional[str] = None) -> int:
    """How many graphics a YouTube video keeps at most: one per 5 s of its cold open, one per 12 s after it (the
    register stretches the body), within the editor's cap."""
    from clip_engine.services.auto_graphics import MAX_GRAPHICS
    profile = pacing_profile(int(kept_s * 1000), register)
    cold = profile["cold_open_ms"] / 1000
    return max(2, min(MAX_GRAPHICS, math.ceil(cold / (profile["cold_gap_ms"] / 1000)) + int(max(0.0, kept_s - cold) // (profile["body_gap_ms"] / 1000))))


def chapter_titles(raw_chapters: Any, words: Sequence[Any], sections: Sequence[tuple[int, int]]) -> list[dict]:
    """The sections' chapter titles kept only when said in that section, in order: [{word, title}]."""
    out = []
    for item in raw_chapters if isinstance(raw_chapters, list) else []:
        if not isinstance(item, dict) or type(item.get("word")) is not int or not isinstance(item.get("title"), str):
            continue
        span = next(((a, b) for a, b in sections if a <= item["word"] < b), None)
        if span is None:
            continue
        title = said_title(item["title"][:80], [w.text for w in words[span[0]:span[1]]])
        if title:
            out.append({"word": item["word"], "title": title[:80]})
    return out[:MAX_CHAPTERS]


async def plan_youtube(config: dict, progress) -> dict:
    """Mode "plan" for a YouTube video: the same plan as a reel's (cuts, hook, call to action, graphics checked against
    the words), with the long-form guidance, and a long transcript planned in sections (one AI call each, a few at a
    time), merged into one plan; each section names its chapter in words said there."""
    import asyncio
    import json
    import httpx
    from clip_engine.config import get_settings
    from clip_engine.services import edit_recording as er
    from clip_engine.services.openrouter import OpenRouterError, apply_reasoning, json_schema_format, message_text
    from clip_engine.services.purpose_context import system_rules, with_context
    words = config["words"]
    names = config.get("names") or []
    clips = (config.get("combine") or {}).get("clips") or []
    base = er.analyze_takes(words)
    settings = get_settings()
    sections = plan_sections(words)
    marked = [m for m in base if m]
    progress(f"Planning your video in {len(sections)} parts" if len(sections) > 1 else "Planning your video and its graphics", 20,
             {"fillers": sum(1 for m in marked if m == "filler"), "retakes": sum(1 for m in marked if m != "filler")})
    brand = (config.get("brand_identity") or "").strip()[:er.MAX_BRAND_CHARS]
    head = (
        "BRAND (data" + (f": {config.get('brand_name')}" if config.get("brand_name") else "") + ")\n" + (brand or "(none)")
        + ("\n\nWHAT THEY MEANT TO OPEN WITH (data)\n" + config["hook_hint"] if config.get("hook_hint") else "")
        + ("\n\nTHE HEADLINE THEY USED LAST TIME ON THIS RECORDING (data: open on the line it comes from)\n" + kept
           if (kept := er.kept_headline(config.get("fixed_hook"), words)) else "")
    )
    direction = isinstance(config.get("direction"), dict)
    options = dict(config.get("direction") or {})
    # About how long the video runs: each take's kept talk, first word to last (pauses are tightened, never removed).
    spans: dict[int, list[int]] = {}
    for i, w in enumerate(words):
        if base[i] is None:
            lo_hi = spans.setdefault(w.src, [w.start_ms, w.end_ms])
            lo_hi[0], lo_hi[1] = min(lo_hi[0], w.start_ms), max(lo_hi[1], w.end_ms)
    kept_s = sum(b - a for a, b in spans.values()) / 1000 * 0.92
    cold_s = cold_open_ms(int(kept_s * 1000)) / 1000
    cold_word = cold_open_word_limit(words, base, cold_s)
    rule = ""
    if direction:
        from clip_engine.services.edit_direction import direction_rule, word_hints
        rule = direction_rule(effective_seconds(kept_s), {**options, "stage": False, "hints": word_hints(words, base, media=bool(options.get("media")))})
    schema = longform_schema(er.combine_schema(direction) if clips else er.plan_schema(direction))
    system_base = (er.plan_system_prompt(direction).replace("ONE short vertical video", "ONE landscape YouTube video")
                   + (er.combine_prompt() if clips else "") + rule + system_rules(config.get("purpose"), bool(config.get("reference_image"))))
    fallbacks = settings.get_planner_fallback_models()
    cost = {"usd": 0.0}
    client = httpx.AsyncClient(base_url=settings.openrouter_base_url, timeout=httpx.Timeout(300.0, connect=30.0),
                               headers={"Authorization": f"Bearer {settings.openrouter_api_key}",
                                        "HTTP-Referer": "https://github.com/trentrichards34/bridgeclip", "X-Title": "CreatorClips Edit"})
    gate = asyncio.Semaphore(PLAN_CONCURRENCY)
    done = {"n": 0}

    async def ask(k: int, lo: int, hi: int) -> Optional[dict]:
        transcript = section_transcript(words, base, names, lo, hi) if len(sections) > 1 else er.format_transcript(words, base, names, clips or None)
        payload: dict[str, Any] = {
            "model": settings.planner_model,
            "messages": [{"role": "system", "content": system_base + longform_rule(kept_s, cold_s, cold_word, k, len(sections))},
                         {"role": "user", "content": with_context(head + "\n\nTRANSCRIPT (data)\n" + transcript, config.get("purpose"),
                                                                  config.get("reference_image") if k == 0 else None)}],
            "response_format": json_schema_format("recording_edit", schema), "provider": {"require_parameters": True}, "max_tokens": 16000,
        }
        if fallbacks:
            payload["models"] = fallbacks
        apply_reasoning(payload, "medium", temperature=0.3)
        async with gate:
            for attempt in range(2):
                try:
                    body, usage = await er.chat_completion(client, payload)
                    if usage.get("cost") is not None:
                        cost["usd"] += float(usage["cost"])
                    content, _ = message_text(body)
                    raw = json.loads(content or "{}")
                    if not isinstance(raw, dict):
                        raise ValueError("not an object")
                    done["n"] += 1
                    progress(f"Planned part {done['n']} of {len(sections)}" if len(sections) > 1 else "Checking the plan", 20 + 70 * done["n"] / len(sections))
                    return raw
                except (OpenRouterError, ValueError) as error:
                    if isinstance(error, OpenRouterError) and not error.retryable:
                        raise er.EditError(er._openrouter_message(str(error))) from None
                    er.logger.warning(f"Planning part {k + 1} attempt {attempt + 1} failed: {error}")
        return None

    warnings: list[str] = []
    try:
        raws = await asyncio.gather(*(ask(k, lo, hi) for k, (lo, hi) in enumerate(sections)))
    except er.EditError as error:
        error.cost_usd = cost["usd"]  # type: ignore[attr-defined]
        raise
    finally:
        await client.aclose()
    if not any(raws):
        warnings.append("The AI plan didn’t come back, so this is a basic edit: clear retakes, restarts and filler words are cut and your first line opens the video.")
        plan = er.basic_plan(words, base)
        if clips:
            plan["combine"] = er.combine_of(None, words, plan, clips)
        raw = {}
    else:
        if not all(raws):
            missing = sum(1 for r in raws if not r)
            warnings.append(f"{missing} part{'s' if missing != 1 else ''} of your video couldn’t be planned by the AI, so "
                            f"{'they get' if missing != 1 else 'it gets'} the basic edit (clear retakes and filler words cut).")
        raw = merge_section_plans(raws, sections) if len(sections) > 1 else {**raws[0], "chapters": (
            [{"word": 0, "title": raws[0]["chapter"]}] if isinstance(raws[0].get("chapter"), str) and raws[0]["chapter"].strip() else [])}
        plan = er.validate_plan(raw, words, base)
        if clips:
            plan["combine"] = er.combine_of(raw, words, plan, clips)
        if direction:
            # The hook is the cold open's first line (no hook bar on a YouTube video): graphics may land on it.
            from clip_engine.services.edit_direction import plan_graphics
            cta = [(plan["cta"]["start"], plan["cta"]["end"])] if plan.get("cta") else []
            try:
                planned = plan_graphics(raw.get("graphics"), words, plan["marks"], {**options, "stage": False, "extra_fx": ["titlecard-lockup"],
                                                                                      "limit": graphics_budget(kept_s, options.get("register"))},
                                        cta, logos_in=cta)
            except Exception as error:  # noqa: BLE001 - graphics are extras: the plan stands without them
                er.logger.warning(f"Planned graphics left out: {type(error).__name__}: {error}")
                planned = []
            plan["graphics"] = [g for g in planned if g["template"] != "logo"]
            plan["logo_pins"] = [{"logo": g["fields"].get("image"), "word": g["word"]} for g in planned if g["template"] == "logo"]
            from clip_engine.services.edit_direction import plan_register
            plan["register"] = plan_register(words, plan["marks"], options)
    er.keep_headline(plan, words, config.get("fixed_hook"))
    review = er.review_of(words, plan, "ai" if any(raws) else "basic", cost["usd"], warnings)
    review["format"] = "youtube"
    chapters = chapter_titles(raw.get("chapters"), words, sections) if raw else []
    if chapters:
        review["chapters"] = chapters
    progress("Plan ready", 100, er._plan_found(review))
    return review


# ---------------------------------------------------------------------------
# Making a YouTube video (mode "render")
# ---------------------------------------------------------------------------

# A YouTube recording may run this long (a reel's recordings: edit_recording.MAX_SOURCE_SECONDS).
MAX_SOURCE_SECONDS = 45 * 60


def cut_landscape_piece(source: str, piece: Any, out: str, pre_vf: str = "", pre_af: str = "", dip_in: bool = False,
                        dip_out: bool = False) -> None:
    """One kept stretch fitted whole into 1920x1080 (fit_graph), with the same tiny audio fades as a reel's pieces."""
    from clip_engine.services import edit_recording as er
    frames = max(1, round(piece.seconds * FPS))
    seconds = frames / FPS
    dip = min(0.1, seconds / 4)
    tail = (f",fade=t=in:st=0:d={dip:.3f}" if dip_in else "") + (f",fade=t=out:st={max(0.0, seconds - dip):.4f}:d={dip:.3f}" if dip_out else "")
    graph = fit_graph(f"[0:v]{pre_vf + ',' if pre_vf else ''}", f"{tail}[v]")
    af = (f"{pre_af + ',' if pre_af else ''}aresample=48000,apad,atrim=duration={seconds:.4f},afade=t=in:d={0.04 if dip_in else 0.008},"
          f"afade=t=out:st={max(0.0, seconds - (0.04 if dip_out else 0.012)):.4f}:d={0.04 if dip_out else 0.012}")
    er.ffmpeg(["-ss", f"{piece.start:.6f}", *er.MEDIA_GUARD, "-i", source, "-t", f"{seconds:.4f}", "-filter_complex", graph, "-af", af,
               "-map", "[v]", "-map", "0:a:0", "-frames:v", str(frames), *er.VIDEO_ARGS, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", out])


def compose_pip_piece(camera: str, screen: str, screen_seconds: float, piece: Any, offset_s: float, mask: str, layers: tuple[str, str],
                      rect: tuple[int, int, int, int], screen_box: tuple[int, int, int, int], face_x: float, out: str) -> None:
    """One kept stretch as screen + webcam picture-in-picture: the camera's [start, end) and the screen at the same
    moment (start - offset; before or after the screen recording its first or last frame holds)."""
    from clip_engine.services import edit_recording as er
    frames = max(1, round(piece.seconds * FPS))
    seconds = frames / FPS
    s_start = piece.start - offset_s
    lead = max(0.0, -s_start)
    seek = min(max(0.0, s_start), max(0.0, screen_seconds - 1.0 / FPS))
    screen_in = (f"[1:v]tpad=start_duration={lead:.4f}:start_mode=clone,tpad=stop_mode=clone:stop_duration={seconds + 1:.4f},"
                 f"trim=duration={seconds:.4f},setpts=PTS-STARTPTS,fps={FPS},")
    graph = pip_graph(screen_in, "[0:v]fps=30,", "[2:v]", "[3:v]", "[4:v]", "[v]", rect, screen_box, face_x)
    af = (f"aresample=48000,apad,atrim=duration={seconds:.4f},afade=t=in:d=0.008,"
          f"afade=t=out:st={max(0.0, seconds - 0.012):.4f}:d=0.012")
    er.ffmpeg(["-ss", f"{piece.start:.6f}", *er.MEDIA_GUARD, "-i", camera, "-ss", f"{seek:.6f}", *er.MEDIA_GUARD, "-i", screen,
               "-loop", "1", "-i", mask, "-loop", "1", "-i", layers[0], "-loop", "1", "-i", layers[1], "-t", f"{seconds:.4f}",
               "-filter_complex", graph, "-map", "[v]", "-map", "0:a:0", "-af", af, "-frames:v", str(frames),
               *er.VIDEO_ARGS, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", out])


def _face_x(video: str, pieces: Sequence[Any]) -> float:
    """The speaker's face's center across the camera (share of its width), for the webcam card's crop; 0.5 when none."""
    try:
        from clip_engine.services import look_extras as lx
        from clip_engine.services.screen_pair import probe
        info = probe(video)
        step = max(1, len(pieces) // 6)
        windows = [(p.start, p.end) for p in list(pieces)[::step][:6]]
        found = [f for f in lx.face_boxes(video, windows, (info["width"], info["height"]), samples=2) if f]
        if not found or not info["width"]:
            return 0.5
        xs = sorted((f[0] + f[2]) / 2 / info["width"] for f in found)
        return float(xs[len(xs) // 2])
    except Exception:  # noqa: BLE001 - a centered crop still works
        return 0.5


async def render_youtube(config: dict, progress) -> dict:
    """Mode "render" for a YouTube video: the kept words cut like a reel's, but on a 1920x1080 30 fps canvas (the
    recording fitted whole, or camera + screen as a picture-in-picture), the sound finished the same way, then made into
    a 16:9 clip editor project (graphics paced for long-form, captions on key lines, chapters) that main bakes."""
    import asyncio
    import os
    from clip_engine.services import edit_recording as er
    from clip_engine.services.remix_service import RemixError, normalize_recording
    root = config["output_dir"]
    work = os.path.join(root, ".work")
    os.makedirs(work, exist_ok=True)
    words = config["words"]
    look = config["look"]
    combine = config.get("combine")
    choice = config.get("youtube") or dict(DEFAULT_YOUTUBE)
    screen = config.get("screen")
    pieces, timed = er.build_timeline(words, config["keep"], config["hook"], config["cta"], er.MAX_INNER_GAP, er.SHORT_PAUSE,
                                      combine["order"] if combine else None)
    total = er.reel_seconds(pieces)
    if total < er.MIN_REEL_SECONDS or not timed:
        raise er.EditError("Keep a few more words: the video would be under two seconds.")
    warnings: list[str] = []
    used = sorted({p.src for p in pieces})
    prepared: dict[int, str] = {}
    filters: dict[int, tuple[str, str]] = {}
    screens: set[int] = set()
    if combine:
        from clip_engine.services import combine_clips as cc
        try:
            clips = cc.read_clips(root, len(config["sources"]))
        except cc.CombineError as error:
            raise er.EditError(str(error)) from None
        if any(src not in clips for src in used):
            raise er.EditError("Your clips' working files are missing. Start again with your clips.")
        lumas = cc.luma_targets(list(clips.values()))
        screens = {src for src, clip in clips.items() if clip.get("shot") == "screen"}
        for src in used:
            # The proxy as filmed (fitted whole into 16:9 below), evened out in brightness and loudness with the others.
            prepared[src] = clips[src]["proxy"]
            shift = cc.brightness_shift(clips[src].get("luma"), lumas.get(clips[src].get("shot") or "face"))
            filters[src] = (f"eq=brightness={shift}" if shift else "", cc.combine_filters(clips[src], None)[1])
    else:
        for n, src in enumerate(used):
            progress(f"Getting your recording ready ({n + 1} of {len(used)})" if len(used) > 1 else "Getting your recording ready",
                     5 + 15 * n / len(used))
            out = os.path.join(work, f"source-{src}.mp4")
            try:
                await asyncio.to_thread(normalize_recording, config["sources"][src], out, max(p.end for p in pieces if p.src == src) + 1)
            except RemixError:
                raise er.EditError("One of your recordings could not be read. Try an MP4, MOV or WebM video.") from None
            prepared[src] = out
    pip = None
    if screen and not combine and choice["layout"] == "pip":
        from clip_engine.services import screen_pair as sp
        info = await asyncio.to_thread(sp.probe, screen["path"])
        if info["seconds"] < 1 or not info["width"]:
            raise er.EditError("Your screen recording could not be read. Try an MP4, MOV or WebM video.")
        progress("Getting your screen recording ready", 20)
        rect = pip_rect(choice["pip_size"], choice["pip_corner"])
        box = screen_rect(choice["pip_corner"], choice["pip_size"], info["width"], info["height"])
        screen_file = await asyncio.to_thread(sp.normalize_screen, screen["path"], os.path.join(work, "screen.mp4"), (box[2], box[3]), info["seconds"])
        mask = card_mask(os.path.join(work, "card-mask.png"), rect[2], rect[3])
        frame = stage_layers(work, rect, box)
        face_x = await asyncio.to_thread(_face_x, prepared[0], pieces)
        pip = {"rect": rect, "box": box, "mask": mask, "frame": frame, "face_x": face_x, "screen": screen_file, "seconds": info["seconds"]}
    files: list[str] = []
    dips = bool(combine and combine.get("transitions"))
    for n, piece in enumerate(pieces):
        if n % 5 == 0:
            progress(f"Cutting ({n + 1} of {len(pieces)})", 25 + 33 * n / len(pieces))
        path = os.path.join(work, f"piece-{n:04d}.mkv")
        if pip:
            await asyncio.to_thread(compose_pip_piece, prepared[piece.src], pip["screen"], pip["seconds"], piece, screen["offset_ms"] / 1000,
                                    pip["mask"], pip["frame"], pip["rect"], pip["box"], pip["face_x"], path)
        else:
            pre_vf, pre_af = filters.get(piece.src, ("", ""))
            await asyncio.to_thread(cut_landscape_piece, prepared[piece.src], piece, path, pre_vf, pre_af,
                                    dips and n > 0 and pieces[n - 1].src != piece.src,
                                    dips and n + 1 < len(pieces) and pieces[n + 1].src != piece.src)
        files.append(path)
    listing = os.path.join(work, "pieces.txt")
    with open(listing, "w", encoding="utf-8") as handle:
        handle.writelines(f"file '{os.path.basename(f)}'\n" for f in files)
    assembled = os.path.join(work, "assembled.mkv")
    await asyncio.to_thread(er.ffmpeg, ["-f", "concat", "-safe", "0", *er.MEDIA_GUARD, "-i", listing, "-c", "copy", assembled])
    for f in files:
        try:
            os.remove(f)
        except OSError:
            pass
    folder = er.edit_dir(root)
    os.makedirs(folder, exist_ok=True)
    base = os.path.join(folder, "base.mp4")
    measured, _ = await er.mix_reel_audio(assembled, base, config, [], work, warnings, progress)
    try:
        os.remove(assembled)
    except OSError:
        pass
    youtube = {"pip": pip_share_box(choice["pip_size"], choice["pip_corner"]) if pip else None, "captions": choice["captions"],
               "chapters": config.get("chapters") or []}
    return await er.finish_as_project({**config, "cutout_intro": False, "raw_intro": False}, root, work, folder, base, pieces, timed, total,
                                      look, measured, 0.0, warnings, progress, screens, [], youtube=youtube)


def youtube_project(project: dict, youtube: dict, timed: Sequence[Sequence[Any]], total_ms: int, register: Optional[str]) -> dict:
    """The editor project made landscape: 1920x1080 16:9, the webcam card's box (graphics keep clear of it), captions
    on key lines (the rest quiet), and no hook bar (a YouTube video opens on its cold open)."""
    project.update({"width": YT_W, "height": YT_H, "aspect_ratio": "16:9",
                    "youtube": {"pip": youtube.get("pip"), "captions": youtube.get("captions", "key")}})
    c = project["candidates"][0]
    c["scenes"] = [{"at_ms": 0, "layout": "fill", "crops": [[0.0, 0.0, 1.0, 1.0]]}]
    c["caption_suppression_ranges"] = caption_quiet(timed, total_ms, youtube.get("captions", "key"), cold_open_ms(total_ms))
    c.pop("stage_scenes", None)
    return project


def youtube_chapters(timed: Sequence[Sequence[Any]], total_ms: int, titles: Sequence[dict], words: Sequence[Any]) -> list[dict]:
    """The video's chapters from the director's section titles (checked again: words said) and the reel's timing."""
    titled = {}
    for item in titles or []:
        lo = item["word"]
        said = [w.text for w in words[lo:lo + 4000]]
        title = said_title(item["title"], said)
        if title:
            titled[lo] = title
    # A section title belongs to the first kept word at or after its section's start.
    kept = sorted(int(w[3]) for w in timed)
    anchored = {}
    for lo, title in titled.items():
        at = next((i for i in kept if i >= lo), None)
        if at is not None:
            anchored[at] = title
    return chapters_for(timed, total_ms, anchored)
