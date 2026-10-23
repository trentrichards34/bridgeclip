"""Depth and camera, rendered end to end on a real person (the portrait fixture, gently moving): a punch-in on a cue,
a stage scene whose head breaks out of the card, and a type takeover with the head between its lines. Saves a contact
sheet of four frames (DEPTH_SHEET: where to; default the test's own folder)."""

import asyncio
import os
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from clip_engine.services import depth_fx as dx
from clip_engine.services import rendering_service as module
from clip_engine.services import segmentation
from clip_engine.services.graphics_overlay import _frame_alpha, behind_mattes, overlay_graphics_file, place_between, text_lines
from clip_engine.services.look_extras import look_extras
from clip_engine.services.manual_editor import manual_plan
from clip_engine.services.rendering_service import RenderingService, RenderRequest
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
FONT = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts", "Anton-Regular.ttf")
pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg") or not segmentation.available(), reason="needs FFmpeg and the cut-out model")

W, H = 1080, 1920
LINE = "Here's the thing: post less, say more."
# The takeover's lines as takeover.ts breaks "Post less. Say more. Every single day." (motion-graphics takeoverLines).
TAKEOVER = ["POST LESS.", "SAY MORE.", "EVERY", "SINGLE DAY."]


def person_video(path: str, seconds: float = 9.0) -> None:
    """The portrait fixture as a 9:16 selfie video that sways a little (so the cut-out is tested on motion)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-r", "30", "-i", os.path.join(FIXTURES, "portrait_person.jpg"),
                    "-f", "lavfi", "-i", f"sine=frequency=220:sample_rate=48000:duration={seconds}",
                    "-filter_complex", "[0:v]scale=764:1306:flags=lanczos,crop=720:1280:x='22+14*sin(2*PI*t/4)':y='13+9*sin(2*PI*t/3)',"
                    "format=yuv420p[v]", "-map", "[v]", "-map", "1:a", "-t", f"{seconds}", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "18", "-c:a", "aac", "-shortest", path], check=True, timeout=300)


def words() -> list[TranscriptSegment]:
    said = [("Most", 200), ("people", 480), ("post", 820), ("every", 1080), ("day.", 1330),
            ("But", 1800), ("here's", 1990), ("the", 2250), ("thing:", 2380), ("post", 2900), ("less.", 3150),
            ("Post", 6250), ("less.", 6480), ("Say", 6800), ("more.", 7020), ("Every", 7300), ("single", 7550), ("day.", 7800)]
    items = [TranscriptWord(w, a, a + 260) for w, a in said]
    return [TranscriptSegment(0, 8000, " ".join(w for w, _ in said), words=items)]


def takeover_mov(path: str, seconds: float = 2.0) -> None:
    """A stand-in for main's Type takeover render (takeover.ts): huge condensed caps filling the width, stacked from
    under the top to just above the captions, each line landing from slight oversize."""
    frames = round(seconds * 30)
    room_top, room_bottom = 0.1 * H, 0.62 * H
    fonts, sizes = [], []
    for text in TAKEOVER:
        size = 200
        font = ImageFont.truetype(FONT, size)
        width = font.getlength(text)
        size = min(int(size * W * 0.9 / width), int((room_bottom - room_top) * 0.34))
        fonts.append(ImageFont.truetype(FONT, size))
        sizes.append(size)
    scale = min(1.0, (room_bottom - room_top) / (sum(sizes) * 1.08))
    fonts = [ImageFont.truetype(FONT, max(10, int(size * scale))) for size in sizes]
    sizes = [f.size for f in fonts]
    gap = ((room_bottom - room_top) - sum(sizes)) / (len(TAKEOVER) + 1)
    tops, y = [], room_top + gap
    for size in sizes:
        tops.append(y)
        y += size + gap
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", "30", "-i", "-",
                             "-c:v", "qtrle", "-pix_fmt", "argb", path], stdin=subprocess.PIPE)
    for f in range(frames):
        t = f / 30
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for i, (text, font, top) in enumerate(zip(TAKEOVER, fonts, tops)):
            p = min(1.0, max(0.0, (t - i * 0.12) / 0.24))
            if p <= 0:
                continue
            e = 1 - (1 - p) ** 4
            scale = 1.12 - 0.12 * e
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            color = (255, 214, 10, round(255 * min(1, p / 0.35))) if i == len(TAKEOVER) - 1 else (255, 255, 255, round(255 * min(1, p / 0.35)))
            ImageDraw.Draw(layer).text((W / 2, top), text, font=font, fill=color, anchor="mt")
            if scale != 1:
                box = (W / 2 * (1 - 1 / scale), top + font.size / 2 - font.size / 2 / scale)
                layer = layer.resize((round(W * scale), round(H * scale))).crop((round(box[0] * scale), 0, round(box[0] * scale) + W, H))
            im = Image.alpha_composite(im, layer)
        proc.stdin.write(im.tobytes())
    proc.stdin.close()
    assert proc.wait(timeout=300) == 0


def assert_behind_lines_readable(laid: dict, mattes: list[dict]) -> None:
    """Measured on its own from the speaker's matte and the takeover's ink, through the takeover: every line behind
    the speaker keeps at least 80% of its ink and no word is mostly hidden."""
    person = tuple(laid.get("person", (1.0, 0, 0)))
    window = mattes[0]
    for share in (0.15, 0.4, 0.65, 0.9):
        at_ms = laid["start_ms"] + laid["duration_ms"] * share
        matte = _frame_alpha(window["path"], (at_ms - window["start_ms"]) / 1000, W, H, alpha=False)
        ink = _frame_alpha(laid["path"], max(0.0, laid["duration_ms"] * max(share, 0.6) / 1000 - 0.05), W, H, alpha=True)
        placed = dx.place_matte(matte, person, W, H)
        for a, b, dst, behind in laid["layout"]:
            if not behind:
                continue
            line, worst_word = dx.line_occlusion(ink[a:b] > 96, placed, dst)
            assert line <= dx.OCCLUDE_MAX, f"a line behind the head loses {line:.0%} of its ink at {share:.0%}"
            assert worst_word <= dx.WORD_OCCLUDE_MAX, f"a word behind the head is {worst_word:.0%} hidden at {share:.0%}"


def frame(path: str, at: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3)


def test_depth_and_camera_on_a_real_person(tmp_path, monkeypatch):
    source = str(tmp_path / "person.mp4")
    person_video(source)
    c = {"ranges": [[0, 9000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0, 0, 1.0, 1.0]]}]}
    service = RenderingService()
    request = RenderRequest(source, str(tmp_path / "clip.mp4"), 0, 9000, 720, 1280, include_captions=False, include_title=False,
                            apply_padding=False, pacing="natural", video_speed=1.0, manual_ranges_ms=[(0, 9000)],
                            manual_plan=manual_plan({"width": 720, "height": 1280}, c), transcript_segments=words(),
                            scenes=[{"scene": "stage", "start_ms": 3600, "end_ms": 5800, "backdrop": "grid", "card": "arch"}],
                            scene_brand_color="#7C3AED", look_extras=look_extras(["punch_zoom"]))
    result = asyncio.run(service.render_clip(request))
    # The punch lands on "thing", the head breaks out in the stage scene, the camera moves at both of its cuts.
    assert [p["at_ms"] for p in result.punches] == [2380] and result.punches[0]["kind"] == "turn"
    assert result.escaped_runs == 1
    assert [(m["at_ms"], m["kind"]) for m in result.scene_moves] == [(3600, "zoom"), (5800, "zoom")]
    # The matte was kept for the next render of this clip.
    assert any(n.startswith("escape-") and n.endswith(".mkv") for n in os.listdir(tmp_path / ".scene-mattes"))
    assert not [n for n in os.listdir(tmp_path) if n.startswith("scene-")]

    # The type takeover over the finished clip: the head between its lines.
    graphic = str(tmp_path / "takeover.mov")
    takeover_mov(graphic)
    graphics = [{"path": graphic, "start_ms": 6200, "duration_ms": 2000, "depth": "between"}]
    mattes = behind_mattes(result.output_path, graphics, tmp_path / "mattes")
    laid = place_between(graphics, mattes, result.output_path, W, H)[0]
    behind = [line for line in laid["layout"] if line[3]]
    assert 1 <= len(behind) < len(TAKEOVER)  # one or two lines above the head, the rest in front of the chest
    assert_behind_lines_readable(laid, mattes)
    codec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
    overlay_graphics_file(result.output_path, graphics, W, H, codec, lambda cmd: subprocess.run(cmd, check=True, timeout=600))

    face, punched, stage, takeover = (frame(result.output_path, t) for t in (1.2, 2.9, 4.6, 7.9))
    sheet = Image.new("RGB", (4 * 270 + 5 * 12, 480 + 2 * 12 + 34), (18, 18, 22))
    draw = ImageDraw.Draw(sheet)
    label = ImageFont.truetype(os.path.join(os.path.dirname(FONT), "Montserrat-ExtraBold.ttf"), 15)
    for i, (img, name) in enumerate(zip((face, punched, stage, takeover), ("Face (wide)", "Punch-in on “thing”", "Frame escape", "Type takeover"))):
        x = 12 + i * (270 + 12)
        sheet.paste(Image.fromarray(img).resize((270, 480), Image.LANCZOS), (x, 12))
        draw.text((x, 12 + 480 + 8), name, font=label, fill=(235, 235, 240))
    out = os.environ.get("DEPTH_SHEET") or str(tmp_path / "depth-sheet.png")
    if os.environ.get("DEPTH_SHEET"):
        shutil.copy(result.output_path, os.path.join(os.path.dirname(out), "depth-clip.mp4"))
    sheet.save(out)
    # Punched in: the face is bigger (the frame's middle column holds more skin and less wall).
    assert np.abs(punched.astype(int) - face.astype(int)).mean() > 8
    # Escape: right above the card's top edge, over the head's middle, is the speaker's hair (dark), not the light backdrop.
    from clip_engine.services.stage_scenes import geometry
    card_y = geometry(W, H).card_y
    head = stage[card_y - 40:card_y - 10, W // 2 - 40:W // 2 + 40].reshape(-1, 3).mean(axis=0)
    backdrop = stage[card_y - 40:card_y - 10, 60:140].reshape(-1, 3).mean(axis=0)
    assert np.abs(head - backdrop).sum() > 90
    # Takeover: the room is darkened; the last (yellow) line is drawn over the chest.
    yellow = (takeover[..., 0] > 200) & (takeover[..., 1] > 170) & (takeover[..., 2] < 90)
    assert yellow.sum() > 2000
    # The room stays a room (softened and a little darker, not black): the frame's bottom corners keep some light.
    assert takeover[int(0.92 * H):, :120].mean() > 25

    assert os.path.getsize(out) > 10000
    assert dx.CUE_ZOOM > 1


def test_a_color_grade_reaches_the_footage_the_card_and_the_escaped_head_but_never_the_backdrop(tmp_path):
    """Mono: the full-frame shot, the stage card and the head breaking out of it turn gray; the brand backdrop keeps its
    color (it is a graphic), and the head still escapes."""
    source = str(tmp_path / "person.mp4")
    person_video(source)
    c = {"ranges": [[0, 9000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0, 0, 1.0, 1.0]]}]}
    request = RenderRequest(source, str(tmp_path / "clip.mp4"), 0, 9000, 720, 1280, include_captions=False, include_title=False,
                            apply_padding=False, pacing="natural", video_speed=1.0, manual_ranges_ms=[(0, 9000)],
                            manual_plan=manual_plan({"width": 720, "height": 1280}, c), transcript_segments=words(),
                            scenes=[{"scene": "stage", "start_ms": 3600, "end_ms": 5800, "backdrop": "grid", "card": "arch"}],
                            scene_brand_color="#7C3AED", color_grade="mono")
    result = asyncio.run(RenderingService().render_clip(request))
    assert result.escaped_runs == 1

    def saturation(pixels: np.ndarray) -> float:
        p = pixels.reshape(-1, 3).astype(int)
        return float((p.max(axis=1) - p.min(axis=1)).mean())

    face, stage = frame(result.output_path, 1.2), frame(result.output_path, 4.6)
    from clip_engine.services.stage_scenes import geometry
    g = geometry(W, H)
    assert saturation(face[H // 3:2 * H // 3, W // 4:3 * W // 4]) < 6
    card = stage[g.card_y + 60:g.card_y + 300, W // 2 - 120:W // 2 + 120]
    head = stage[g.card_y - 40:g.card_y - 10, W // 2 - 40:W // 2 + 40]
    backdrop = stage[g.card_y - 220:g.card_y - 120, 30:150]
    assert saturation(card) < 6 and saturation(head) < 8, (saturation(card), saturation(head))
    assert saturation(backdrop) > 30, saturation(backdrop)
