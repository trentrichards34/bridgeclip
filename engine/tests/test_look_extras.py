"""Look extras: optional motion effects (zoom punch, keyword pill, accent words, progress bar, comment box, b-roll tags,
proof highlights). Each one is off unless picked; the caption ASS, filter text and pictures are checked here, plus real
small renders on Create, Remix and Edit my recording sampled frame by frame.

Set EXTRAS_FRAMES=<dir> to keep sample frames of the renders for a look."""

import asyncio
import json
import os
import re
import shutil
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from clip_engine.config import get_caption_preset
from clip_engine.services import look_extras as lx
from clip_engine.services.caption_generator import CaptionGeneratorService, contrast_text
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass

FIXTURE_FACE = os.path.join(os.path.dirname(__file__), "fixtures", "portrait_person.jpg")
TEXT = ("Most people quit their job way too early. Here is the part nobody says. You need 1000 true fans first, "
        "and that takes about eighteen months of steady posting. So start today, keep going, and comment below.")


def timed_words(text=TEXT, start=300):
    words, t = [], start
    for w in text.split():
        words.append(TranscriptWord(w, t, t + 260))
        t += 330 if not w.endswith(".") else 600
    return words


def segments(words):
    return [TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, " ".join(w.word for w in words), "S1", words)]


def captions(tmp_path, style, emphasis=None, words=None):
    words = words or timed_words()
    path = asyncio.run(CaptionGeneratorService().generate_captions(
        segments(words), 0, words[-1].end_time_ms + 500, str(tmp_path / "c.ass"), caption_style=style, emphasis_words=emphasis))
    return open(path, encoding="utf-8").read()


def dialogue(ass, layer=None):
    lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    return [line for line in lines if layer is None or line.startswith(f"Dialogue: {layer},")]


def keep_frame(path, t, name):
    folder = os.environ.get("EXTRAS_FRAMES")
    if folder:
        os.makedirs(folder, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", os.path.join(folder, name)], check=True)


def frame(path, t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "image2pipe",
                          "-vcodec", "png", "-"], capture_output=True, check=True, timeout=120).stdout
    import io
    return np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(float)


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------

def test_extras_are_parsed_in_a_fixed_order_and_unknown_ones_dropped():
    assert lx.parse_look_extras(None) == () and lx.parse_look_extras([]) == ()
    assert lx.parse_look_extras(["progress_bar", "glow", "punch_zoom", "progress_bar", 3]) == ("punch_zoom", "progress_bar")
    with pytest.raises(ValueError):
        lx.parse_look_extras("punch_zoom")
    extras = lx.look_extras(["comment_box"], "#2f6bff", " sales ")
    assert (extras.ids, extras.color, extras.keyword) == (("comment_box",), "#2F6BFF", "SALES")
    assert not lx.look_extras([]) and lx.look_extras([], "#2f6bff").color is None  # no extras, no color
    with pytest.raises(ValueError):
        lx.look_extras(["progress_bar"], "blue")
    assert lx.look_extras(["comment_box"], None, "two words").keyword == ""
    # Kept with an edit bundle and read back; anything unreadable is no extras.
    assert lx.from_record(json.loads(json.dumps(extras.record()))) == extras
    assert not lx.from_record(None) and not lx.from_record({"ids": "x"}) and not lx.from_record({"ids": ["glow"]})


def test_a_highlight_box_is_four_shares_of_the_picture():
    assert lx.parse_highlight(None) is None
    assert lx.parse_highlight({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05}) == (0.1, 0.2, 0.3, 0.05)
    assert lx.parse_highlight([0, 0, 1, 1]) == (0, 0, 1, 1)
    for bad in ([0.9, 0, 0.2, 0.1], [0, 0, 0, 0.1], [-0.1, 0, 0.2, 0.2], [0, 0, True, 0.2], {"x": 0}, "0,0,1,1", [0, 0, float("nan"), 1]):
        with pytest.raises(ValueError):
            lx.parse_highlight(bad)
    assert lx.highlight_rect((0.5, 0.25, 0.25, 0.1), (100, 200, 400, 800)) == (300, 400, 100, 80)


# ---------------------------------------------------------------------------
# Captions: keyword pill and accent words
# ---------------------------------------------------------------------------

def test_without_extras_the_captions_are_unchanged(tmp_path):
    style = get_caption_preset("pop")
    plain = captions(tmp_path, style, ["quit"])
    assert lx.caption_style(style, lx.LookExtras()) is style
    assert lx.caption_style(style, lx.look_extras(["progress_bar"])) is style
    assert captions(tmp_path, lx.caption_style(style, lx.look_extras(["progress_bar"])), ["quit"]) == plain
    assert "\\fn" not in plain and not dialogue(plain, 3)


def test_keyword_pill_puts_each_groups_key_word_in_a_brand_color_pill(tmp_path):
    style = get_caption_preset("pop")
    styled = lx.caption_style(style, lx.look_extras(["keyword_pill"], "#2F6BFF"))
    assert styled.keyword_pill_color == "#2F6BFF" and style.keyword_pill_color is None  # a copy; the preset is untouched
    # No brand color: the preset's punch color.
    assert lx.caption_style(style, lx.look_extras(["keyword_pill"])).keyword_pill_color == style.emphasis_color
    ass = captions(tmp_path, styled, ["quit", "1000"])
    pills = dialogue(ass, 3)
    assert pills, "a pill layer"
    blue = "&H00FF6B2F"
    # The first group ("MOST PEOPLE QUIT"): the punch word "QUIT" has the pill on every event of the group, the rest none.
    first = [line for line in pills if "QUIT" in line]
    assert first and all(re.search(r"\{[^}]*\\1c" + re.escape(blue) + r"[^}]*\}QUIT", line) for line in first)
    assert all(re.search(r"\\alpha&HFF&\\bord0\\shad0\}MOST", line) for line in first)
    # The word on the pill reads in a contrasting color, with no stroke.
    faces = [line for line in dialogue(ass, 4) if "QUIT" in line]
    assert all(re.search(r"\\bord0\\1c&H00FFFFFF\}QUIT", line) for line in faces)
    # Hard spaces keep the pill clear of its neighbors.
    assert "\\h" in faces[0]
    # A group with no punch word: its strongest word ("EARLY", a number before anything else).
    assert any(re.search(r"\\1c" + re.escape(blue) + r"[^}]*\}EARLY", line) for line in pills)
    assert any(re.search(r"\\1c" + re.escape(blue) + r"[^}]*\}1000", line) for line in pills)
    assert contrast_text("#FFE234") == "#111111" and contrast_text("#2F6BFF") == "#FFFFFF"


def test_accent_words_switch_one_word_per_group_to_a_lowercase_italic_serif(tmp_path):
    style = get_caption_preset("pop")
    styled = lx.caption_style(style, lx.look_extras(["accent_words"]))
    assert styled.accent_font == lx.ACCENT_FONT
    ass = captions(tmp_path, styled, ["quit"])
    faces = dialogue(ass, 4)
    accent = re.compile(r"\\fnInstrument Serif\\i1\\b0\\fs(\d+)[^}]*\}([^{\\]+)")
    found = {m.group(2) for line in faces for m in accent.finditer(line)}
    assert "quit" in found and "early" in found and "QUIT" not in " ".join(found)
    assert all(int(m.group(1)) == round(style.font_size * 1.15) for line in faces for m in accent.finditer(line))
    # Every other word switches back to the preset's face (overrides carry on along a line).
    assert re.search(r"\\fnMontserrat Black\\i0\\b0\\fs84[^}]*\}MOST", faces[0])
    # The serif keeps a lighter stroke than the preset's.
    assert re.search(r"\\bord2\.7\\3c[^}]*\}quit", " ".join(faces))
    # Groups of one word keep the preset's face.
    one = captions(tmp_path, styled, None, [TranscriptWord("Everything.", 0, 400), TranscriptWord("Absolutely.", 500, 900)])
    assert "Instrument Serif" not in one


def test_the_accent_font_ships_with_its_license():
    fonts = lx.FONTS_DIR
    assert os.path.isfile(os.path.join(fonts, "InstrumentSerif-Italic.ttf")) and os.path.isfile(os.path.join(fonts, "InstrumentSerif-OFL.txt"))
    from PIL import ImageFont
    assert ImageFont.truetype(os.path.join(fonts, "InstrumentSerif-Italic.ttf"), 20).getname() == ("Instrument Serif", "Italic")


# ---------------------------------------------------------------------------
# Zoom punch
# ---------------------------------------------------------------------------

def test_punch_windows_alternate_every_three_to_five_seconds_at_phrase_ends():
    words = [(w.start_time_ms / 1000, w.end_time_ms / 1000, w.word) for w in timed_words()]
    total = words[-1][1] + 0.5
    cuts = lx.phrase_cuts(words, total)
    gaps = np.diff([0.0, *cuts])
    assert len(cuts) >= 3 and all(3.0 <= g <= 5.0 for g in gaps), cuts
    # Each cut sits between words, never inside one.
    assert not any(a < c < b for c in cuts for a, b, _ in words)
    # Sentence ends win when one falls in the window ("early." ends at ~3.1 s).
    ends = [(b + n[0]) / 2 for (a, b, t), n in zip(words, words[1:]) if t.endswith(".")]
    assert any(abs(cuts[0] - e) < 0.01 for e in ends)
    windows = lx.punch_windows(words, total)
    assert windows and windows[0][0] == cuts[0]  # it starts wide
    assert all(b - a >= lx.PUNCH_MIN_PIECE_S for a, b in windows)
    # Only where the speaker fills the frame, never during b-roll.
    held = lx.punch_windows(words, total, eligible=[(0, 6.0)], blocked=[(3.5, 4.5)])
    assert all(b <= 6.0 and not (a < 4.5 and b > 3.5) for a, b in held)
    assert lx.punch_windows(words, total, eligible=[]) == []
    assert lx.punch_windows([], 3.0) == []


def test_punch_graph_cuts_to_a_fixed_crop_on_the_face_and_back():
    rect = lx.punch_rect(1080, 1920, (700, 600))
    assert rect[2:] == (864, 1536) and rect[0] == 216 and rect[1] == 0  # kept inside the frame
    assert lx.punch_rect(1080, 1920, None)[2:] == (864, 1536)
    graph = lx.punch_graph("in", "out", 1080, 1920, [(3.0, 6.5, rect), (10.0, 13.0, (100, 200, 864, 1536))])
    assert graph.startswith("[in]split") and graph.endswith("[out]")
    assert "crop=864:1536:x='if(between(t,3.000,6.500),216,if(between(t,10.000,13.000),100,0))'" in graph
    assert "enable='between(t,3.000,6.500)+between(t,10.000,13.000)'" in graph and "scale=1080:1920" in graph
    # Many windows go in groups (FFmpeg's expression limit).
    many = lx.punch_graph("in", "out", 100, 100, [(i * 2.0, i * 2.0 + 1, (0, 0, 80, 80)) for i in range(45)])
    assert many.count("split") == 3 and many.endswith("[out]")
    assert lx.punch_graph("in", "out", 100, 100, []) == "[in]null[out]"


def test_a_face_pushes_the_comment_box_off_it():
    # No face: the upper middle. A face there: the top. Under the hook text and above the captions either way.
    assert lx.comment_box_center(1920, 124, 120, 1200) == 1920 * 0.30
    center = lx.comment_box_center(1920, 124, 120, 1200, faces=[(300, 500, 780, 1000)])
    assert center == 120 + 62
    low = lx.comment_box_center(1920, 124, 120, 1500, faces=[(300, 60, 780, 700)])
    assert low - 62 >= 700 + 640 * 0.2 and low + 62 <= 1500


# ---------------------------------------------------------------------------
# Pictures: progress bar, comment box, b-roll tags, underline
# ---------------------------------------------------------------------------

def test_progress_bar_is_thin_at_the_top_and_fills_with_the_video(tmp_path):
    track, bar = lx.progress_bar_layers(str(tmp_path), 1080, 1920, 12.5, "#2F6BFF")
    assert (track.x, track.y, bar.y) == ("0", "0", "0") and bar.x == "-w+w*min(1,t/12.500)"
    with Image.open(bar.path) as img:
        assert img.size == (1080, 12) and img.getpixel((5, 5)) == (0x2F, 0x6B, 0xFF, 255)
    # On a hook bar of the same color it would vanish: white (or near-black on a light bar) instead.
    _, white = lx.progress_bar_layers(str(tmp_path / "a"), 1080, 1920, 5, "#2F6BFF", under=(0x2F, 0x6B, 0xFF))
    _, dark = lx.progress_bar_layers(str(tmp_path / "b"), 1080, 1920, 5, None, under=(255, 255, 255))
    assert Image.open(white.path).getpixel((1, 1))[:3] == (255, 255, 255) and Image.open(dark.path).getpixel((1, 1))[:3] == (17, 17, 17)


def test_comment_box_types_the_keyword_in_the_last_seconds(tmp_path):
    assert lx.comment_box_layers(str(tmp_path), "", 1080, 600, 20.0) == []
    layers = lx.comment_box_layers(str(tmp_path), "SALES", 1080, 600, 20.0)
    # Empty, then 1-4 letters, then all five with the cursor blinking on and off.
    assert len(layers) == len("SALES") + 2
    first = layers[0]
    assert "between(t,17.500," in first.enable and "scale=w=" in first.filter and "eval=frame" in first.filter
    starts = [float(re.search(r"between\(t,([\d.]+)", layer.enable).group(1)) for layer in layers[:-2]]
    assert starts == sorted(starts) and starts[0] == 17.5
    # Typed by about 0.7 s before the end; then the cursor blinks.
    done = float(re.search(r"gte\(t,([\d.]+)\)", layers[-1].enable).group(1))
    assert done <= 19.3 and "mod(t-" in layers[-1].enable and "lt(mod" in layers[-2].enable
    with Image.open(layers[-1].path) as img:
        w, h = img.size
        assert w > 1080 * 0.82 and h > 124
    # A dark picture under it gets a dark box.
    lx.comment_box_image("SALES", 5, 1080, str(tmp_path / "dark.png"), dark=True)
    with Image.open(tmp_path / "dark.png") as img:
        assert sum(img.getpixel((img.width // 2, img.height // 2))[:3]) < 200


def test_broll_tags_sit_top_right_while_their_shot_shows(tmp_path):
    assert lx.tag_label("broll") == "B-ROLL" and lx.tag_label("screen") == "SCREEN RECORDING"
    assert lx.tag_label("broll", "  my  product demo ") == "MY PRODUCT DEMO"
    layers = lx.broll_tag_layers(str(tmp_path), [(1.0, 3.0, "B-ROLL"), (4.0, 4.2, "B-ROLL"), (5.0, 8.0, "SCREEN RECORDING")], 1080, 200)
    assert len(layers) == 2  # a sliver gets no tag
    assert layers[0].enable == "between(t,1.000,3.000)" and layers[0].y == "200"
    with Image.open(layers[1].path) as img:
        assert int(layers[1].x) + img.width == 1080 - 40
        # The red dot.
        assert img.getpixel((round(img.height * 0.6), img.height // 2))[:3] == (255, 59, 48)


def test_underline_is_drawn_left_to_right_under_the_number(tmp_path):
    assert lx.underline_layers(str(tmp_path), (0, 0, 4, 4), 1.0, 1080) == []
    layers = lx.underline_layers(str(tmp_path), (300, 400, 200, 60), 1.0, 1080)
    assert len(layers) == 6 and layers[0].enable.startswith("between(t,1.000,") and layers[-1].enable == f"gte(t,{1 + 0.35 * 5 / 6:.3f})"
    widths = []
    for layer in layers:
        with Image.open(layer.path) as img:
            bbox = img.getchannel("A").getbbox()
            widths.append(bbox[2] - bbox[0])
            red = [p for p in img.getdata() if p[3] > 200]
            assert red and all(p[0] > 200 and p[1] < 80 for p in red)
    assert widths == sorted(widths) and widths[-1] >= 200
    assert int(layers[0].y) > 400 + 60 - 40  # under the box's bottom edge


def test_overlay_chain_and_inputs(tmp_path):
    layers = [lx.Layer("a.png", "0", "0"), lx.Layer("b.png", "(W-w)/2", "10", "gte(t,1)", "format=rgba")]
    chain, last = lx.overlay_chain("cap", layers, 3)
    assert last == "lx1"
    assert chain == ("[cap][3:v]overlay=x='0':y='0':enable='1':eof_action=pass[lx0];[4:v]format=rgba[lxi1];"
                     "[lx0][lxi1]overlay=x='(W-w)/2':y='10':enable='gte(t,1)':eof_action=pass[lx1]")
    assert lx.layer_inputs(layers, 7.25) == ["-loop", "1", "-framerate", "30", "-t", "7.250", "-i", "a.png",
                                             "-loop", "1", "-framerate", "30", "-t", "7.250", "-i", "b.png"]
    assert layers[1].as_overlay() == ("b.png", "(W-w)/2", "10", "gte(t,1)", "format=rgba")


# ---------------------------------------------------------------------------
# Real renders
# ---------------------------------------------------------------------------

def _face_video(path, seconds=12, size="1280:720"):
    w, h = size.split(":")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", str(seconds), "-i", FIXTURE_FACE,
                    "-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}",
                    "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=gray,format=yuv420p",
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(path)], check=True, timeout=120)
    return str(path)


def _face_width(img, row):
    """Width of the skin-toned run across a row (the face), a rough size measure."""
    pixels = img[row]
    skin = (pixels[:, 0] > 120) & (pixels[:, 0] > pixels[:, 2] + 25) & (pixels[:, 1] > 70)
    return int(skin.sum())


@needs_libass
def test_create_render_draws_the_extras(tmp_path, monkeypatch):
    from clip_engine.services import rendering_service as rendering_module
    from clip_engine.services.layout_analyzer import Box, ClipLayoutPlan, LayoutType, ShotLayout
    from clip_engine.services.rendering_service import RenderingService, RenderRequest
    ffmpeg, _ = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    W, H = 360, 640
    monkeypatch.setattr(rendering_module, "get_output_dimensions", lambda *_: (W, H))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p"]
    face = Box(0.40, 0.20, 0.20, 0.42)

    async def plan(request, width, height, start, duration):
        shot = ShotLayout(0, duration, LayoutType.TALKING_HEAD, people=[face])
        return ClipLayoutPlan([shot], width, height, face_samples=[(t, [face]) for t in range(0, duration, 250)])

    monkeypatch.setattr(service, "_plan_layout", plan)
    source = _face_video(tmp_path / "src.mp4")
    broll = tmp_path / "broll.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x1050C0:s=640x360:r=30:d=4", "-c:v", "libx264",
                    "-preset", "ultrafast", str(broll)], check=True, timeout=60)
    words = timed_words()
    extras = lx.look_extras(["punch_zoom", "keyword_pill", "progress_bar", "comment_box", "broll_tags"], "#2F6BFF", "SALES")
    request = RenderRequest(source, str(tmp_path / "clip.mp4"), 0, 11000, 1280, 720, pacing="natural", apply_padding=False,
                            include_captions=True, caption_style=get_caption_preset("pop"), transcript_segments=segments(words),
                            include_title=False, emphasis_words=["quit"], cta_keyword="SALES", broll_shots=[(6000, 8000, str(broll))],
                            look_extras=extras)
    result = asyncio.run(service.render_clip(request))
    out = result.output_path
    assert result.render_fallback is None
    for t in (1.0, 3.6, 6.8, 9.6, 10.8):
        keep_frame(out, t, f"create-{t:04.1f}.png")
    cuts = lx.phrase_cuts([(w.start_time_ms / 1000, w.end_time_ms / 1000, w.word) for w in words], 11.0)
    wide, tight = frame(out, cuts[0] / 2), frame(out, (cuts[0] + cuts[1]) / 2)
    # Zoom punch: the face is wider in the tight shot (a hard cut, ~1.25x).
    row = round(H * 0.35)
    assert 1.12 < _face_width(tight, row) / max(1, _face_width(wide, row)) < 1.4
    # Progress bar: lit across about the share of the video played, at the very top.
    early, late = frame(out, 2.0), frame(out, 9.0)
    lit = lambda img: int((np.abs(img[2] - np.array([0x2F, 0x6B, 0xFF])).max(axis=1) < 60).sum())  # noqa: E731
    assert 0.1 < lit(early) / W < 0.3 and 0.7 < lit(late) / W < 0.9
    # The b-roll tag: its red dot at the top right during the b-roll only.
    def red_dot(img):
        part = img[round(H * 0.06):round(H * 0.06) + 40, W - 120:]
        return int(((part[..., 0] > 200) & (part[..., 1] < 110) & (part[..., 2] < 110)).sum())
    assert red_dot(frame(out, 7.0)) > 3 and red_dot(frame(out, 4.0)) == 0
    # The keyword pill: brand blue under the caption's key word somewhere in the lower half.
    pill = lambda img: int((np.abs(img[H // 2:] - np.array([0x2F, 0x6B, 0xFF])).max(axis=2) < 50).sum())  # noqa: E731
    assert pill(frame(out, 1.0)) > 200
    # The comment box: white box over the top area in the last seconds, typed "SALES" with the old tag gone.
    box = lambda img: int((img[: H // 2].min(axis=2) > 235).sum())  # noqa: E731
    assert box(frame(out, 10.6)) > box(frame(out, 5.0)) + 2000
    assert not os.path.exists(tmp_path / "cta-tag-0-11000.png")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_edit_my_recording_reel_with_extras_and_remade_with_them(tmp_path):
    from clip_engine.services import edit_recording as er
    base = tmp_path / "base.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "9", "-i", FIXTURE_FACE, "-f", "lavfi", "-i",
                    "sine=frequency=300:duration=9", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(base)], check=True, timeout=120)
    words = timed_words("I tested every Claude video skill so you don't have to. The free one beat the paid ones twice. Comment below.", 200)
    timed = [[w.word, w.start_time_ms, w.end_time_ms, i] for i, w in enumerate(words)]
    extras = lx.look_extras(["punch_zoom", "accent_words", "progress_bar", "comment_box", "proof_underline"], "#2F6BFF", "LIST")
    look = er.Look("I tested every video skill for you", {"look": "brand", "color": "#2F6BFF", "font": "clean"}, True, "pop", None, extras)
    out = str(tmp_path / "reel.mp4")
    asyncio.run(er.overlay_reel(str(base), out, str(tmp_path / "work"), look, timed, [{"text": "2x faster", "kind": "number", "start_ms": 3000}],
                                8.8, str(tmp_path)))
    for t in (1.5, 3.05, 3.5, 8.6):
        keep_frame(out, t, f"edit-{t:04.1f}.png")
    # The pop-up card pops in: narrower at 50 ms than at 500 ms.
    def card_width(img):
        rows = img[600:900]  # under the hook bar, where the card sits
        blue = (rows[..., 2] > rows[..., 0] + 80) & (rows[..., 2] > rows[..., 1] + 40)
        return int(blue.sum(axis=1).max())
    assert 0 < card_width(frame(out, 3.08)) < card_width(frame(out, 3.5)) * 0.97
    # The progress bar over the blue hook bar turns white so it shows; the comment box in the last seconds.
    top = frame(out, 6.0)[2]
    assert int((top.min(axis=1) > 230).sum()) > 1080 * 0.6
    end = frame(out, 8.6)
    assert int((end[200:900].min(axis=2) > 235).sum()) > 20000
    # Re-made later from the bundle: the extras come back with it.
    root = tmp_path / "run"
    folder = root / ".edit" / "clip_00"
    folder.mkdir(parents=True)
    shutil.copy(base, folder / "base.mp4")
    er.write_bundle(str(root), {"version": er.EDIT_VERSION, "words": timed, "popups": [], "duration": 8.8,
                                "settings": er.settings_of(look), "brand_mark": None, "look_extras": extras.record()})
    seen = []
    original = er.overlay_reel

    async def spy(base_path, out_path, work, look_again, *rest):
        seen.append(look_again.look_extras)
        return await original(base_path, out_path, work, look_again, *rest)
    er.overlay_reel = spy
    try:
        asyncio.run(er.recompose_edit({"output_dir": str(root), "output_path": str(root / "again.mp4"), "headline": "New hook text here",
                                       "headline_look": None, "include_captions": True, "caption_preset": "pop"}, lambda *_: None))
    finally:
        er.overlay_reel = original
    assert seen == [extras]


@needs_libass
def test_remix_screenshot_pops_in_and_its_number_is_underlined(tmp_path, monkeypatch):
    from dataclasses import replace
    from . import test_image_remix as tir
    from .test_camera_remix import make_line_recording
    from clip_engine.services import remix_service as remix
    from clip_engine.services import segmentation
    from .test_camera_remix import FAST_VIDEO, fake_write_matte
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)
    out_dir = tmp_path / "run"
    (out_dir / ".work").mkdir(parents=True)
    env = SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp_path, out=out_dir, source=None)
    image = tir.post_png(out_dir / ".work" / "source.png")
    recording = make_line_recording(env, tmp_path / "take.mp4", 3, (640, 360), 300)
    plain = tir.config
    monkeypatch.setattr(tir, "config", lambda *args, **over: replace(
        plain(*args, **over), image_source={"path": image, "credit": tir.CREDIT, "highlight": [0.25, 0.4, 0.5, 0.1]}))
    run = tir.write_then_render(env, monkeypatch, image, recording, "filmed",
                                look_extras=["proof_underline", "progress_bar"], look_extras_color="#FFD23F")
    path = run.out["path"]
    for t in (0.03, 0.1, 0.6, 1.5):
        keep_frame(path, t, f"remix-image-{t:04.2f}.png")
    # The green post pops in: narrower in its first frames than once settled.
    def green_width(img):
        return int(((np.abs(img[300:1100] - np.array([30, 180, 60])).max(axis=2) < 50).sum(axis=1)).max())
    assert green_width(frame(path, 0.03)) < green_width(frame(path, 0.6)) * 0.97
    # The red underline under the marked box (from 0.45 s on), not before.
    def red(img):
        return int(((img[..., 0] > 190) & (img[..., 1] < 90) & (img[..., 2] < 90)).sum())
    assert red(frame(path, 1.5)) > 800 and red(frame(path, 0.2)) < 50
    # Kept for re-making: the compose spec carries the proof, the tags the extras.
    bundle = json.load(open(out_dir / ".edit" / "clip_00" / "edit.json"))
    assert bundle["compose"]["proof"] == {"highlight": [0.25, 0.4, 0.5, 0.1]}
    assert bundle["tags"]["look_extras"]["ids"] == ["progress_bar", "proof_underline"]


@needs_libass
def test_remix_commentary_final_tags_broll_and_punches_only_on_the_presenter(tmp_path, monkeypatch):
    from clip_engine.services import remix_service as remix
    from clip_engine.services.rendering_service import RenderingService
    from .test_camera_remix import FAST_VIDEO
    ffmpeg, _ = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    assembled = _face_video(tmp_path / "assembled.mp4", seconds=10, size="1080:1920")
    remixer = remix.Remixer.__new__(remix.Remixer)
    remixer.config = remix.RemixConfig(output_dir=str(tmp_path), look_extras=["punch_zoom", "broll_tags", "comment_box"], cta_keyword="REMOTE")
    remixer.progress, remixer.warnings, remixer._clip_offset = (lambda *_: None), [], 0
    words = timed_words("So this is the part where it gets interesting. Watch what happens next with the numbers. Then we talk about it.", 200)
    tags = {"style": "commentary", "credit_text": "", "ai_presenter": False, "excerpt_windows": [[0.0, 2.0]], "ai_windows": [],
            "cta_keyword": "REMOTE", "cta_window": [7.0, 10.0], "broll_windows": [[5.0, 6.5]]}
    out = str(tmp_path / "final.mp4")
    work = tmp_path / "work"
    work.mkdir()
    graphs = []
    original = remix.ffmpeg

    def spy(args, timeout=900):
        graphs.append(args[args.index("-filter_complex") + 1])
        return original(args, timeout)
    monkeypatch.setattr(remix, "ffmpeg", spy)
    asyncio.run(remixer._overlay_final(RenderingService(), assembled, out, str(work), bar_path=None, bar_h=0, clear_h=0, total_s=10.0,
                                       words=words, anchor="panel", tags=tags))
    for t in (1.0, 5.5, 9.6):
        keep_frame(out, t, f"remix-final-{t:04.1f}.png")
    graph = graphs[-1]
    windows = [(float(a), float(b)) for a, b in re.findall(r"between\(t,([\d.]+),([\d.]+)\)", graph.split("crop=")[1].split("[pz0z]")[0])]
    assert windows and all(b <= 2.0 or a >= 2.0 for a, b in windows) and not any(a < 6.5 and b > 5.0 for a, b in windows)
    # The b-roll tag during the b-roll; the comment box types the keyword (the old "Comment REMOTE" tag is left out).
    img = frame(out, 5.8)
    corner = img[24:90, 1080 - 320:]
    assert int(((corner[..., 0] > 200) & (corner[..., 1] < 110)).sum()) > 20
    assert "cta.png" not in " ".join(os.listdir(work))
    assert int((frame(out, 9.7)[100:1300].min(axis=2) > 235).sum()) > 20000
    # Recorded with the bundle's tags: re-making keeps them.
    assert tags["look_extras"] == {"ids": ["punch_zoom", "comment_box", "broll_tags"], "color": None, "keyword": "REMOTE"}
    again = remix.Remixer.__new__(remix.Remixer)
    again.config = remix.RemixConfig(output_dir=str(tmp_path))
    assert again._look_extras_tag(json.loads(json.dumps(tags))).has("broll_tags")
    assert not again._look_extras_tag({"style": "silent"})


def test_edit_runner_reads_the_extras_for_a_render_only():
    import edit_runner
    from clip_engine.services.edit_recording import Look  # noqa: F401
    raw = {"mode": "render", "headline": "Hook", "include_captions": True, "caption_preset": "pop",
           "look_extras": ["comment_box", "glow", "progress_bar"], "look_extras_color": "#2f6bff", "cta_keyword": "list"}
    look = edit_runner._look(raw)
    assert (look.look_extras.ids, look.look_extras.color, look.look_extras.keyword) == (("progress_bar", "comment_box"), "#2F6BFF", "LIST")
    assert not edit_runner._look({**raw, "look_extras": None}).look_extras
    with pytest.raises(ValueError):
        edit_runner._look({**raw, "look_extras": "progress_bar"})
    # Re-making reads them from the saved bundle instead.
    assert edit_runner._look({**raw, "mode": "recompose"}).look_extras is None


def test_create_request_keeps_extras_for_automatic_runs_only():
    from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest
    request = ClippingJobRequest(video_url="x", look_extras=["progress_bar", "punch_zoom", "glow"], look_extras_color="#2f6bff")
    assert (request.look_extras, request.look_extras_color) == (["punch_zoom", "progress_bar"], "#2F6BFF")
    assert ClippingJobRequest(video_url="x").look_extras == []
    review = ClippingJobRequest(video_url="x", workflow="review", look_extras=["progress_bar"])
    assert review.look_extras == [] and review.look_extras_color is None
    with pytest.raises(ValueError):
        ClippingJobRequest(video_url="x", look_extras="progress_bar")
