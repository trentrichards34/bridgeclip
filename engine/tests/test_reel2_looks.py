"""The second reel's looks: grid / gradient backdrops and the arch card, Highlight box captions on the stage, the
Screen recording's video under its window, words behind the speaker placed by the head, and automatic Orbit /
Feature tile cards and word-timed text cards."""

import asyncio
import os
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clip_engine.config import get_caption_preset
from clip_engine.services import graphics_overlay as go
from clip_engine.services import rendering_service as module
from clip_engine.services import stage_scenes as ss
from clip_engine.services.auto_graphics import card_words, fit_to_clip, parse_planned, word_spans
from clip_engine.services.manual_editor import manual_plan
from clip_engine.services.rendering_service import RenderingService, RenderRequest
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
GRAPH = "[0:v]fps=30[clocked];[clocked]null[base]"
NAME = "a" * 64 + ".mov"


# ---------------------------------------------------------------------------
# Scenes: backdrops and card shapes
# ---------------------------------------------------------------------------

def test_scenes_parse_cards_and_new_backdrops_backward_compatibly():
    scenes = ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 2000, "backdrop": "grid", "card": "arch"},
                              {"scene": "stage", "start_ms": 2000, "end_ms": 4000, "backdrop": "grid"},
                              {"scene": "visual", "start_ms": 4000, "end_ms": 6000, "backdrop": "gradient", "card": "arch"}])
    # Different cards stay apart; a visual scene has no card.
    assert [(s.scene, s.backdrop, s.card) for s in scenes] == [("stage", "grid", "arch"), ("stage", "grid", "rounded"), ("visual", "gradient", "rounded")]
    assert ss.to_dicts(scenes)[0]["card"] == "arch" and "card" not in ss.to_dicts(scenes)[1]
    for bad in ({"card": "oval"}, {"backdrop": "neon"}):
        with pytest.raises(ValueError):
            ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 2000, **bad}])
    pairs = ss.output_scenes([{"scene": "stage", "start_ms": 1000, "end_ms": 3000, "backdrop": "grid", "card": "arch"}], [(0, 5000)], 1.0)
    assert pairs[0][1] == {"scene": "stage", "start_ms": 1000, "end_ms": 3000, "backdrop": "grid", "card": "arch"}
    suggested = ss.suggest_scenes([{"at_ms": 2000, "duration_ms": 2000, "size": "stage"}], 8000, "grid", "arch")
    assert [s.get("card") for s in suggested if s["scene"] == "stage"] == ["arch"]
    assert ss.auto_look("#7C3AED") == ("grid", "arch") and ss.auto_look(None) == ("light", "rounded")


def test_grid_and_gradient_backdrops_are_brand_tinted_and_the_grid_shows_at_the_top(tmp_path):
    grid = np.asarray(Image.open(ss.draw_backdrop(str(tmp_path / "g.png"), 1080, 1920, "grid", "#7C3AED")).convert("RGB")).astype(int)
    soft = np.asarray(Image.open(ss.draw_backdrop(str(tmp_path / "s.png"), 1080, 1920, "gradient", "#7C3AED")).convert("RGB")).astype(int)
    # Light lavender at the top, deep purple at the bottom (blue over green: the brand's hue).
    assert grid[100, 540].mean() > 215 and grid[1880, 540].mean() < 175 and grid[1880, 540][2] > grid[1880, 540][1] + 40
    assert soft[1880, 540].mean() > grid[1880, 540].mean()
    # The grid: a line column is lighter than the cell next to it near the top, and gone by the bottom.
    cell = round(1080 / 14)
    x0 = (1080 % cell) // 2
    line, mid = grid[200:260, x0].mean(), grid[200:260, x0 + cell // 2].mean()
    assert line > mid + 2
    assert abs(grid[1850:1900, x0].mean() - grid[1850:1900, x0 + cell // 2].mean()) < 2
    assert abs(soft[200:260, x0].mean() - soft[200:260, x0 + cell // 2].mean()) < 1.5
    # Without a brand color the grid is purple.
    assert ss.backdrop_colors("grid")[1] == ss.backdrop_colors("grid", "#7C3AED")[1]


def test_the_arch_card_is_full_width_and_flush_with_the_bottom(tmp_path):
    geo = ss.geometry(1080, 1920)
    assert geo.card_y + geo.arch_h == 1920 and geo.arch_radius > geo.radius
    arch = ss.build_scene_graph(GRAPH, [ss.Scene("stage", 0, 2000, "grid", "arch")], 1080, 1920, 3000, 1.0, "30", 1, str(tmp_path), "a")
    assert "[sc_carded_arch]" in arch.graph and "overlay=x=0:" in arch.graph and "split=2[sc_card_rgb" not in arch.graph
    assert f"scale=1080:{geo.arch_h}" in arch.graph
    mask = np.asarray(Image.open(next(p for p in arch.inputs if p.endswith("mask-arch.png"))))
    # Rounded at the top corners, square at the bottom ones.
    assert mask[0, 0] == 0 and mask[-1, 0] == 255 and mask[-1, -1] == 255 and mask[0, 540] == 255
    both = ss.build_scene_graph(GRAPH, [ss.Scene("stage", 0, 2000, "light"), ss.Scene("stage", 2000, 4000, "grid", "arch")], 1080, 1920, 5000,
                                1.0, "30", 1, str(tmp_path), "b")
    # One framing, split for the two shapes; the rounded card's runs crop its middle.
    assert "split=2[sc_card_rgb_rounded][sc_card_rgb_arch]" in both.graph
    assert f"crop={geo.card_w}:{geo.card_h}:" in both.graph and "[sc_carded]" in both.graph and "[sc_carded_arch]" in both.graph
    assert both.graph.count("[base]") == 1


def _mean(path, at, box):
    x, y, w, h = box
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", path, "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


@needs_ffmpeg
def test_render_draws_the_arch_card_on_the_grid(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (180, 320))
    source = tmp_path / "red.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0xd02020:s=320x180:d=4:r=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
                    "-c:v", "mpeg4", "-q:v", "2", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=120)
    c = {"ranges": [[0, 4000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0.34, 0, 0.32, 1.0]]}]}
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2"]
    request = RenderRequest(str(source), str(tmp_path / "clip.mp4"), 0, 4000, 320, 180, include_captions=False, include_title=False,
                            apply_padding=False, pacing="natural", manual_ranges_ms=[(0, 4000)],
                            manual_plan=manual_plan({"width": 320, "height": 180}, c), scene_brand_color="#7C3AED",
                            scenes=[{"scene": "stage", "start_ms": 500, "end_ms": 3500, "backdrop": "grid", "card": "arch"}])
    result = asyncio.run(service.render_clip(request))
    red = lambda rgb: rgb[0] > 150 and rgb[1] < 90  # noqa: E731
    # The card reaches the frame's bottom-left corner (no margin), its top corners are rounded off onto the grid.
    assert red(_mean(result.output_path, 2.0, (0, 312, 6, 6)))
    corner = _mean(result.output_path, 2.0, (0, 182, 3, 3))  # just under the card's top (320 * (1 - 32/1920 - 0.42) = 180)
    assert not red(corner) and corner[2] > corner[1] + 20
    # Above it, the lavender top of the grid.
    assert _mean(result.output_path, 2.0, (20, 10, 140, 40)).min() > 190


# ---------------------------------------------------------------------------
# Captions in a scene's band
# ---------------------------------------------------------------------------

def test_highlight_box_preset_draws_a_crisp_box_per_line(tmp_path):
    from clip_engine.services.caption_generator import CaptionGeneratorService
    style = get_caption_preset("highlight_box")
    assert style.line_box_shape == "rect" and style.line_box_opacity == 1.0 and style.max_words_per_line == 3 and not style.uppercase
    words = [TranscriptWord(w, i * 300, i * 300 + 280) for i, w in enumerate("so i built my own".split())]
    path = asyncio.run(CaptionGeneratorService().generate_captions(
        output_path=str(tmp_path / "c.ass"), caption_style=style, transcript_segments=[TranscriptSegment(0, 1500, "so i built my own", words=words)],
        clip_start_ms=0, clip_end_ms=2000, output_width=1080, output_height=1920))
    text = open(path, encoding="utf-8").read()
    plate = next(line for line in text.split("\n") if line.startswith("Style: Plate,"))
    assert plate.split(",")[15] == "3"  # BorderStyle 3: an opaque box
    assert any(line.startswith("Dialogue: 0,") and ",Plate," in line for line in text.split("\n"))
    assert not any(line.startswith("Dialogue: 4,") and ",Plate," in line for line in text.split("\n"))


def test_band_captions_follow_the_backdrop():
    assert [ss.caption_mode(b) for b in ("light", "brand", "grid", "gradient", "dark", None)] == ["light", "light", "box", "box", "", "light"]
    geo = ss.geometry(1080, 1920)
    segments = ss.edited_segments([ss.Scene("stage", 0, 2000, "grid", "arch"), ss.Scene("stage", 2000, 4000, "light")], 6000, 1.0)
    assert [w[3] for w in ss.caption_windows(segments, geo)] == ["box", "light"]
    member = get_caption_preset("pop")
    boxed = ss.box_backdrop_style(member, "#7C3AED")
    assert boxed.line_box_color == "#7C3AED" and boxed.line_box_shape == "rect" and member.line_box_color is None
    # A very light brand color is darkened so white words stay readable; no brand: purple.
    assert ss._luma(ss.box_backdrop_style(member, "#FFE234").line_box_color) <= 0.63
    assert ss.box_backdrop_style(member).line_box_color == "#7C3AED"
    assert ss.boxed(get_caption_preset("highlight_box")) and not ss.boxed(get_caption_preset("boxed"))
    # The box version's events come in with their own styles, renamed so both looks render.
    normal = "\n".join(["[V4+ Styles]", "Style: Default,Montserrat Black,84", "[Events]",
                        "Dialogue: 0,0:00:00.50,0:00:01.00,Default,,0,0,0,,a", "Dialogue: 0,0:00:02.50,0:00:03.00,Default,,0,0,0,,b"])
    box = "\n".join(["[V4+ Styles]", "Style: Default,Montserrat ExtraBold,74", "Style: Plate,Montserrat ExtraBold,74", "[Events]",
                     "Dialogue: 0,0:00:00.50,0:00:01.00,Plate,,0,0,0,,A", "Dialogue: 4,0:00:00.50,0:00:01.00,Default,,0,0,0,,A",
                     "Dialogue: 0,0:00:02.50,0:00:03.00,Plate,,0,0,0,,B"])
    from clip_engine.services.caption_generator import CaptionGeneratorService
    windows = ss.caption_windows(segments, geo)
    merged = ss.splice_caption_events(normal, box, windows, CaptionGeneratorService._parse_ass_time, "box").split("\n")
    assert "Style: BoxDefault,Montserrat ExtraBold,74" in merged and "Style: BoxPlate,Montserrat ExtraBold,74" in merged
    events = [line for line in merged if line.startswith("Dialogue")]
    assert events == ["Dialogue: 0,0:00:00.50,0:00:01.00,BoxPlate,,0,0,0,,A", "Dialogue: 4,0:00:00.50,0:00:01.00,BoxDefault,,0,0,0,,A",
                      "Dialogue: 0,0:00:02.50,0:00:03.00,Default,,0,0,0,,b"]


# ---------------------------------------------------------------------------
# Screen recording: the video under the window
# ---------------------------------------------------------------------------

def _graphics_run(tmp_path):
    folder = tmp_path / ".graphics"
    (folder / "videos").mkdir(parents=True)
    (folder / NAME).write_bytes(b"x" * 100)
    (folder / "videos" / "0123456789abcdef.mp4").write_bytes(b"x" * 100)
    return tmp_path


def test_a_screen_recording_video_is_checked_like_other_member_media(tmp_path):
    run = _graphics_run(tmp_path)
    inset = {"video": "0123456789abcdef.mp4", "from_ms": 2500, "rect": [0.1, 0.2, 0.8, 0.3], "zoom": [0.2, 0.2, 0.5, 0.5], "fade_ms": 300}
    [g] = go.checked_graphics(run, [{"file": NAME, "start_ms": 0, "duration_ms": 2000, "inset": inset}], 5000)
    assert g["inset"]["path"] == str(run / ".graphics" / "videos" / "0123456789abcdef.mp4") and g["inset"]["from_ms"] == 2500
    # The clip's own video only where the caller knows it.
    src = go.checked_graphics(run, [{"file": NAME, "start_ms": 0, "duration_ms": 2000, "inset": {**inset, "video": "source"}}], 5000, source="/runs/source.mp4")
    assert src[0]["inset"]["path"] == "/runs/source.mp4"
    for bad in ({"video": "source"}, {"video": "../../x.mp4"}, {"video": "ffffffffffffffff.mp4"}, {"rect": [0.5, 0.5, 0.8, 0.8]},
                {"rect": [0, 0, 1]}, {"from_ms": -1}, {"zoom": [0, 0, 0, 0]}, {"extra": 1}):
        with pytest.raises(ValueError):
            go.checked_graphics(run, [{"file": NAME, "start_ms": 0, "duration_ms": 2000, "inset": {**inset, **bad}}], 5000)
    with pytest.raises(ValueError):
        go.checked_graphics(run, [{"file": NAME, "start_ms": 0, "duration_ms": 2000, "depth": "behind", "min_top": 0.9}], 5000)


def test_the_overlay_plays_the_video_under_its_window():
    g = {"path": "/g.mov", "start_ms": 1000, "duration_ms": 3000,
         "inset": {"path": "/screen.mp4", "from_ms": 2500, "rect": [0.1, 0.2, 0.8, 0.3], "zoom": [0.25, 0.25, 0.5, 0.5], "fade_ms": 300}}
    cmd = go.overlay_command("/c.mp4", [g], "/o.mp4", 1080, 1920, ["-c:v", "libx264"])
    i = cmd.index("/screen.mp4")
    assert cmd[i - 1] == "-i" and "-ss" in cmd[:i] and cmd[cmd.index("-ss") + 1] == "2.500"
    graph = cmd[cmd.index("-filter_complex") + 1]
    x, y, w, h = go.inset_box(g["inset"]["rect"], 1080, 1920)
    assert (x, y) == (106, 382) and w % 2 == 0 and h % 2 == 0
    assert f"zoompan=z=" in graph and f"s={w}x{h}" in graph and "fade=t=in:st=0:d=0.300:alpha=1" in graph
    # The video goes in before the window (so the window's border sits over its edges).
    assert graph.index(f"overlay={x}:{y}") < graph.index("[g1]overlay=0:0")


def _write_mov(path, size, draw, frames=30):
    tmp = path.parent / f"{path.stem}-frames"
    tmp.mkdir()
    for k in range(frames):
        im = Image.new("RGBA", size, (0, 0, 0, 0))
        draw(im)
        im.save(tmp / f"{k:03d}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", str(tmp / "%03d.png"), "-c:v", "qtrle", "-pix_fmt", "argb", str(path)],
                   check=True, timeout=120)


def _pixel(path, at, x, y):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", path, "-frames:v", "1", "-vf", f"crop=4:4:{x}:{y}",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


@needs_ffmpeg
def test_screen_recording_composite_on_real_video(tmp_path):
    w, h = 216, 384
    run = tmp_path
    (run / ".graphics" / "videos").mkdir(parents=True)
    clip = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x2040c0:s={w}x{h}:r=30:d=3", "-f", "lavfi",
                    "-i", "sine=frequency=440:sample_rate=48000:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip], check=True)
    # The member's video: green for its first second, then yellow (it starts 1 s in, so the window shows yellow).
    video = run / ".graphics" / "videos" / "0123456789abcdef.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x20c040:s=320x320:r=30:d=1", "-f", "lavfi",
                    "-i", "color=c=0xe0d020:s=320x320:r=30:d=4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)], check=True)
    # The window: a dark frame with a see-through hole.
    hole = (40, 100, 136, 136)
    _write_mov(run / ".graphics" / NAME, (w, h), lambda im: (im.paste((10, 10, 14, 255), (30, 80, 186, 246)),
                                                             im.paste((0, 0, 0, 0), (hole[0], hole[1], hole[0] + hole[2], hole[1] + hole[3]))), frames=45)
    rect = [hole[0] / w, hole[1] / h, hole[2] / w, hole[3] / h]
    graphics = go.checked_graphics(run, [{"file": NAME, "start_ms": 1000, "duration_ms": 1500,
                                          "inset": {"video": "0123456789abcdef.mp4", "from_ms": 1000, "rect": rect, "fade_ms": 100}}], 3000)

    class Renderer:
        async def _get_video_dimensions(self, _):
            return w, h

        async def _probe_fps(self, _):
            return "30"

        def _video_codec_args(self, *_):
            return ["-c:v", "libx264", "-pix_fmt", "yuv420p"]

        async def _run_cmd(self, cmd):
            subprocess.run(cmd, check=True, timeout=300)

    asyncio.run(go.overlay_graphics(Renderer(), clip, graphics))
    inside, frame = _pixel(clip, 1.8, 100, 160), _pixel(clip, 1.8, 33, 90)
    assert inside[0] > 170 and inside[1] > 160 and inside[2] < 90, inside  # the video (yellow) in the hole
    assert frame.max() < 40, frame  # the window's dark border
    assert _pixel(clip, 0.5, 100, 160)[2] > 150  # before: the clip (blue)
    assert _pixel(clip, 2.8, 100, 160)[2] > 150  # after: the clip again


# ---------------------------------------------------------------------------
# Words behind the speaker: placed by the head
# ---------------------------------------------------------------------------

def test_text_lines_and_the_head_are_found_in_alpha_and_matte():
    alpha = np.zeros((400, 200), np.uint8)
    alpha[50:110, 20:180] = 255
    alpha[120:180, 30:170] = 255
    alpha[115:117, 100:102] = 255  # a speck between lines joins nothing (too thin, too few)
    assert go.text_lines(alpha) == [(50, 110), (120, 180)]
    matte = np.zeros((400, 200), np.uint8)
    matte[150:, 60:140] = 255
    assert go.head_top(matte) == 150 and go.head_top(np.zeros((10, 10), np.uint8)) is None
    assert go.text_x_span(alpha) == (20, 180)


def test_behind_place_moves_the_words_so_the_head_covers_a_third_of_the_last_line():
    lines = [(300, 400), (420, 520)]  # last line 420-520 (100 tall)
    # Head at 450 covers 70%: moved up 40 so it meets the line 70% down (covers 30%).
    assert go.behind_place(lines, 450, 1920, 0.08) == (1.0, 0, -40)
    # Already about right: left alone.
    assert go.behind_place(lines, 490, 1920, 0.08) == (1.0, 0, 0)
    # The head well below: moved down, at most 12% of the frame.
    assert go.behind_place(lines, 600, 1920, 0.08) == (1.0, 0, 110)
    assert go.behind_place(lines, 1200, 1920, 0.08) == (1.0, 0, round(0.12 * 1920))
    # No room above the band's top: anchored there and shrunk about its middle.
    s, x, y = go.behind_place(lines, 460, 1920, 300 / 1920, (40, 1040))
    assert go.MIN_SHRINK <= s < 1 and y == round(300 - s * 300) and x == round(540 * (1 - s))
    assert abs(300 + s * (420 - 300) + (1 - go.HEAD_COVER) * s * 100 - 460) < 2
    # Never smaller than MIN_SHRINK.
    assert go.behind_place(lines, 330, 1920, 300 / 1920, (40, 1040))[0] == go.MIN_SHRINK
    # A head above the band (cut off at the top) or nobody: left as drawn.
    assert go.behind_place(lines, 100, 1920, 0.08) == (1.0, 0, 0)
    assert go.behind_place(lines, None, 1920, 0.08) == (1.0, 0, 0)


@needs_ffmpeg
def test_place_behind_measures_the_rendered_words_and_the_matte(tmp_path):
    w, h = 216, 384
    words = tmp_path / "w.mov"
    _write_mov(words, (w, h), lambda im: (im.paste((255, 255, 255, 255), (20, 60, 196, 100)), im.paste((255, 255, 255, 255), (20, 110, 196, 150))))
    matte = tmp_path / "m.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={w}x{h}:r=30:d=1",
                    "-vf", f"drawbox=x=70:y=118:w=76:h={h - 118}:color=white:t=fill,format=gray", "-c:v", "ffv1", "-pix_fmt", "gray", str(matte)], check=True)
    g = {"path": str(words), "start_ms": 0, "duration_ms": 1000, "depth": "behind", "min_top": 0.05}
    [placed] = go.place_behind([g], [{"path": str(matte), "start_ms": 0, "duration_ms": 1000}], w, h)
    # Last line 110-150 with the head at 118 (80% covered): up so the head meets it 70% down.
    s, x, y = placed["place"]
    assert s == 1.0 and x == 0 and abs(y - (118 - (110 + 28))) <= 2
    cmd = go.overlay_command("/c.mp4", [placed], "/o.mp4", w, h, ["-c:v", "libx264"])
    assert f"overlay=0:{y}" in cmd[cmd.index("-filter_complex") + 1]


# ---------------------------------------------------------------------------
# Automatic direction: Orbit, Feature tile, word-timed text cards
# ---------------------------------------------------------------------------

def line(start, text, step=300):
    ws = text.split()
    timed = [TranscriptWord(w, start + i * step, start + i * step + step - 60) for i, w in enumerate(ws)]
    return TranscriptSegment(start, timed[-1].end_time_ms, text, words=timed)


SAID = [line(2000, "We run ads, landing pages, emails and reports from one account."),
        line(8000, "Competitor research is built in."),
        line(14000, "Skip the scraping completely."),
        line(20000, "So I built my own ads manager.")]


def test_orbit_and_feature_tiles_are_planned_from_what_is_said():
    raw = [{"template": "orbit", "time": 2.6, "seconds": 4, "placement": "top", "text": "", "items": ["ads", "landing pages", "emails", "reports"],
            "icons": ["megaphone", "globe", "mail", "chart"]},
           {"template": "feature_tile", "time": 8.0, "seconds": 3, "placement": "top", "items": ["Competitor research"], "icons": ["search"]},
           # A brand logo as an icon, and words never said: both dropped.
           {"template": "orbit", "time": 14.0, "seconds": 3, "placement": "top", "items": ["Meta", "Google", "TikTok"], "icons": ["meta", "globe", "video"]},
           {"template": "feature_tile", "time": 20.0, "seconds": 3, "placement": "top", "items": ["AI copywriter"], "icons": ["bot"]}]
    planned = parse_planned(raw, 0, 26000)
    assert [g["template"] for g in planned] == ["orbit", "feature_tile", "orbit", "feature_tile"]
    assert planned[2]["fields"]["icons"] == "\nglobe\nvideo"  # the brand name is no icon
    kept = fit_to_clip(planned, SAID, [(0, 26000)], 1.0, {"stage": True})
    assert [(g["template"], g["size"]) for g in kept] == [("orbit", "stage"), ("feature_tile", "stage")]
    # Nodes come in as they're said.
    assert len(kept[0]["fields"]["item_ms"].split("\n")) == 4


def test_word_timed_cards_show_each_word_as_it_is_said_and_hold_after_the_last():
    assert card_words("statement", {"text": "Skip the scraping", "subline": "completely"}) == ["Skip", "the", "scraping", "completely"]
    assert card_words("big_words", {"text": "a b c d"}) == ["a", "b", "c"]
    g = {"template": "statement", "at_ms": 14000, "duration_ms": 2000, "placement": "top", "fields": {"text": "Skip the scraping completely."}}
    spans = word_spans(g, SAID)
    assert [a for a, _ in spans] == [14000, 14300, 14600, 14900]
    [kept] = fit_to_clip([g], SAID, [(0, 26000)], 1.0, {})
    assert kept["fields"]["word_ms"].split("\n") == ["0", "300", "600", "900"]
    # On screen until 700 ms after "completely." ends (15140).
    assert kept["at_ms"] + kept["duration_ms"] >= 15140 + 700
    title = {"template": "title", "at_ms": 20400, "duration_ms": 1500, "placement": "middle", "fields": {"text": "my own ads manager"}}
    [t] = fit_to_clip([title], SAID, [(0, 26000)], 1.0, {})
    assert t["at_ms"] == 20900 and t["fields"]["word_ms"].split("\n") == ["0", "300", "600", "900"]
