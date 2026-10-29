"""Motion graphics from the clip editor: main renders each one to a transparent .mov in the run's .graphics/
folder; the engine checks the request and lays them over the finished clip at their output times."""

import asyncio
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clip_engine.services.graphics_overlay import MAX_GRAPHICS_LONG, checked_graphics, overlay_command, overlay_graphics
from clip_engine.services.media_process import run_media

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
NAME = "a" * 64 + ".mov"


def make_run(tmp_path, name=NAME, size=(108, 192), seconds=1.0):
    """A run folder with one transparent qtrle render: a red box in the upper middle, see-through elsewhere."""
    folder = tmp_path / ".graphics"
    folder.mkdir()
    frames = tmp_path / "frames"
    frames.mkdir()
    w, h = size
    for i in range(round(seconds * 30)):
        im = Image.new("RGBA", size, (0, 0, 0, 0))
        im.paste((255, 0, 0, 255), (w // 4, h // 4, 3 * w // 4, h // 2))
        im.save(frames / f"{i:03d}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", str(frames / "%03d.png"), "-c:v", "qtrle",
                    "-pix_fmt", "argb", str(folder / name)], check=True)
    return tmp_path


def test_checked_graphics_validates_names_times_and_trims_to_the_clip(tmp_path):
    (tmp_path / ".graphics").mkdir()
    (tmp_path / ".graphics" / NAME).write_bytes(b"x" * 100)
    assert checked_graphics(tmp_path, None, 5000) == []
    ok = checked_graphics(tmp_path, [{"file": NAME, "start_ms": 4000, "duration_ms": 3000},
                                     {"file": NAME, "start_ms": 500, "duration_ms": 1000}], 5000)
    assert [(g["start_ms"], g["duration_ms"]) for g in ok] == [(500, 1000), (4000, 1000)]
    # Past the end of the clip: dropped.
    assert checked_graphics(tmp_path, [{"file": NAME, "start_ms": 4950, "duration_ms": 1000}], 5000) == []
    for bad in ([{"file": "../x.mov", "start_ms": 0, "duration_ms": 1000}], [{"file": NAME, "start_ms": -1, "duration_ms": 1000}],
                [{"file": NAME, "start_ms": 0, "duration_ms": 1.5}], [{"file": "b" * 64 + ".mov", "start_ms": 0, "duration_ms": 1000}],
                "nope", [{"file": NAME, "start_ms": 0, "duration_ms": 1000}] * (MAX_GRAPHICS_LONG + 1)):
        with pytest.raises(ValueError):
            checked_graphics(tmp_path, bad, 5000)


def test_checked_graphics_keeps_a_known_size(tmp_path):
    (tmp_path / ".graphics").mkdir()
    (tmp_path / ".graphics" / NAME).write_bytes(b"x" * 100)
    ok = checked_graphics(tmp_path, [{"file": NAME, "start_ms": 0, "duration_ms": 1000, "size": "stage"},
                                     {"file": NAME, "start_ms": 2000, "duration_ms": 1000}], 5000)
    assert [g.get("size") for g in ok] == ["stage", None]
    with pytest.raises(ValueError):
        checked_graphics(tmp_path, [{"file": NAME, "start_ms": 0, "duration_ms": 1000, "size": "huge"}], 5000)


def test_checked_graphics_refuses_a_linked_render(tmp_path):
    (tmp_path / ".graphics").mkdir()
    target = tmp_path / "elsewhere.mov"
    target.write_bytes(b"x" * 100)
    (tmp_path / ".graphics" / NAME).symlink_to(target)
    with pytest.raises(ValueError):
        checked_graphics(tmp_path, [{"file": NAME, "start_ms": 0, "duration_ms": 1000}], 5000)


def test_overlay_command_places_each_graphic_at_its_time():
    cmd = overlay_command("/c.mp4", [{"path": "/g1.mov", "start_ms": 1500, "duration_ms": 2000}], "/o.mp4", 1080, 1920, ["-c:v", "libx264"])
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "setpts=PTS-STARTPTS+1.500/TB" in graph
    assert "enable='between(t,1.500,3.500)'" in graph
    assert "scale=1080:1920" in graph
    assert cmd[-1] == "/o.mp4" and "0:a?" in cmd


class FakeRenderer:
    """The bits of RenderingService the overlay uses."""
    async def _get_video_dimensions(self, path):
        return 108, 192

    async def _probe_fps(self, path):
        return "30"

    def _video_codec_args(self, w, h, fps):
        return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18"]

    async def _run_cmd(self, cmd):
        result = await asyncio.to_thread(run_media, cmd)
        assert result.returncode == 0, result.stderr.decode()[-500:]


def frame_at(video, seconds):
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{seconds}", "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(out, np.uint8).reshape(192, 108, 3).astype(int)


@needs_ffmpeg
def test_overlay_lays_the_graphic_over_the_clip_only_during_its_window(tmp_path):
    run = make_run(tmp_path)
    clip = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x204060:s=108x192:r=30:d=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", clip], check=True)
    graphics = checked_graphics(run, [{"file": NAME, "start_ms": 1000, "duration_ms": 1000}], 3000)
    asyncio.run(overlay_graphics(FakeRenderer(), clip, graphics))
    box = (slice(60, 90), slice(35, 75))  # inside the red box
    before, during, after = frame_at(clip, .5)[box].mean((0, 1)), frame_at(clip, 1.5)[box].mean((0, 1)), frame_at(clip, 2.5)[box].mean((0, 1))
    assert during[0] > 200 and during[2] < 60, during
    assert before[0] < 80 and after[0] < 80, (before, after)
    # Outside the box the clip shows through the transparent graphic.
    outside = frame_at(clip, 1.5)[150:180, 10:100].mean((0, 1))
    assert abs(outside - np.array([0x20, 0x40, 0x60])).max() < 20, outside
    # Audio is kept.
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", clip], capture_output=True, text=True).stdout
    assert "audio" in probe
    assert not (tmp_path / "clip.mp4.graphics.mp4").exists()


# ---------------------------------------------------------------------------
# Text behind the speaker (depth "behind")
# ---------------------------------------------------------------------------

from clip_engine.services import graphics_overlay, segmentation  # noqa: E402


def test_checked_graphics_keeps_depth_behind_and_refuses_an_unknown_one(tmp_path):
    (tmp_path / ".graphics").mkdir()
    (tmp_path / ".graphics" / NAME).write_bytes(b"x" * 100)
    ok = checked_graphics(tmp_path, [{"file": NAME, "start_ms": 0, "duration_ms": 1000, "depth": "behind"},
                                     {"file": NAME, "start_ms": 2000, "duration_ms": 1000, "depth": "front"},
                                     {"file": NAME, "start_ms": 3000, "duration_ms": 1000}], 5000)
    assert [g.get("depth") for g in ok] == ["behind", None, None]
    with pytest.raises(ValueError):
        checked_graphics(tmp_path, [{"file": NAME, "start_ms": 0, "duration_ms": 1000, "depth": "under"}], 5000)


def test_behind_windows_merge_overlapping_graphics_and_skip_front_ones():
    graphics = [{"start_ms": 0, "duration_ms": 1000, "depth": "behind"}, {"start_ms": 800, "duration_ms": 1000, "depth": "behind"},
                {"start_ms": 5000, "duration_ms": 500, "depth": "behind"}, {"start_ms": 2000, "duration_ms": 1000}]
    assert graphics_overlay.behind_windows(graphics) == [(0, 1800), (5000, 5500)]
    assert graphics_overlay.behind_windows([{"start_ms": 0, "duration_ms": 1000}]) == []


def test_overlay_command_puts_the_speaker_over_behind_graphics_only_within_their_windows():
    graphics = [{"path": "/front.mov", "start_ms": 500, "duration_ms": 1000},
                {"path": "/behind.mov", "start_ms": 2000, "duration_ms": 1500, "depth": "behind"}]
    mattes = [{"path": "/m.mkv", "start_ms": 2000, "duration_ms": 1500}]
    cmd = overlay_command("/c.mp4", graphics, "/o.mp4", 1080, 1920, ["-c:v", "libx264"], mattes)
    inputs = [cmd[i + 1] for i, a in enumerate(cmd) if a == "-i"]
    # The behind graphic is input 1, the front one 2, the matte 3, the clip again from the window's start 4.
    assert inputs == ["/c.mp4", "/behind.mov", "/front.mov", "/m.mkv", "/c.mp4"]
    again = [i for i, a in enumerate(cmd) if a == "-i"][-1]
    assert cmd[cmd.index("-ss", again - 8):again][:4] == ["-ss", "2.000", "-t", "1.500"]
    graph = cmd[cmd.index("-filter_complex") + 1].split(";")
    order = [next(i for i, p in enumerate(graph) if p.startswith(tag)) for tag in ("[0:v][g1]", "[v1][person0]", "[p0][g2]")]
    assert order == sorted(order), graph
    # The cut-out is the clip's own frames in the window, with the matte as alpha, shown only then.
    assert any(p.startswith("[4:v]trim=duration=1.500") for p in graph)
    assert not any("split=" in p for p in graph)
    assert any(p.startswith("[3:v]scale=1080:1920") for p in graph)
    assert any("alphamerge,setpts=PTS+2.000/TB" in p for p in graph)
    assert any(p.startswith("[v1][person0]overlay") and "between(t,2.000,3.500)" in p for p in graph)
    # Without mattes: the old graph, every graphic in front.
    plain = overlay_command("/c.mp4", graphics, "/o.mp4", 1080, 1920, ["-c:v", "libx264"])
    assert "alphamerge" not in plain[plain.index("-filter_complex") + 1]


def fake_person_matte(calls):
    """write_matte stand-in: a person-shaped matte (a white column down the middle, 40% of the width)."""
    def write(video, out, width, height, fps=30, timeout=None, start=0.0, duration=None, max_edge=720, refine=False):
        calls.append((start, duration, refine))
        frames = max(1, round((duration or 1) * 30))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:r=30:d={frames / 30}",
                        "-vf", f"drawbox=x={int(width * .3)}:y=0:w={int(width * .4)}:h={height}:color=white:t=fill,format=gray",
                        "-c:v", "ffv1", "-pix_fmt", "gray", out], check=True)
        return out
    return write


@needs_ffmpeg
def test_overlay_lays_the_speaker_back_over_a_behind_graphic_during_its_window(tmp_path, monkeypatch):
    run = make_run(tmp_path, seconds=1.0)
    clip = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x204060:s=108x192:r=30:d=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", clip], check=True)
    calls = []
    monkeypatch.setattr(segmentation, "available", lambda: True)
    monkeypatch.setattr(segmentation, "write_matte", fake_person_matte(calls))
    graphics = checked_graphics(run, [{"file": NAME, "start_ms": 1000, "duration_ms": 1000, "depth": "behind"}], 3000)
    asyncio.run(overlay_graphics(FakeRenderer(), clip, graphics))
    # The matte was made for the graphic's window only, with the edge refinement.
    assert calls == [(1.0, 1.0, True)]
    during = frame_at(clip, 1.5)
    # The red box spans x 27–81; the "speaker" covers x 32–75: there the clip shows, on the box's edges the box does.
    person = during[60:90, 40:68].mean((0, 1))
    edge = during[60:90, 27:30].mean((0, 1))
    assert abs(person - np.array([0x20, 0x40, 0x60])).max() < 25, person
    assert edge[0] > 180 and edge[2] < 80, edge
    before, after = frame_at(clip, .5)[60:90, 27:30].mean((0, 1)), frame_at(clip, 2.5)[60:90, 27:30].mean((0, 1))
    assert before[0] < 80 and after[0] < 80, (before, after)
    # The matte is kept with the graphics, named by the clip and the window.
    kept = list((run / ".graphics" / "mattes").glob("*.mkv"))
    assert len(kept) == 1 and kept[0].name.endswith("-1000-1000-v2.mkv")


@needs_ffmpeg
def test_behind_mattes_reuse_a_kept_matte_and_fall_back_to_front_without_the_model(tmp_path, monkeypatch):
    run = make_run(tmp_path)
    clip = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x204060:s=108x192:r=30:d=2", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", clip], check=True)
    graphics = checked_graphics(run, [{"file": NAME, "start_ms": 500, "duration_ms": 1000, "depth": "behind"}], 2000)
    calls = []
    monkeypatch.setattr(segmentation, "available", lambda: True)
    monkeypatch.setattr(segmentation, "write_matte", fake_person_matte(calls))
    first = graphics_overlay.behind_mattes(clip, graphics)
    again = graphics_overlay.behind_mattes(clip, graphics)
    assert first == again and len(calls) == 1
    assert graphics_overlay.behind_mattes(clip, [{**graphics[0], "depth": None}]) == []
    monkeypatch.setattr(segmentation, "available", lambda: False)
    assert graphics_overlay.behind_mattes(clip, graphics) == []

    def broken(*args, **kwargs):
        raise RuntimeError("model failed")
    monkeypatch.setattr(segmentation, "available", lambda: True)
    monkeypatch.setattr(segmentation, "write_matte", broken)
    (run / ".graphics" / "mattes").rename(run / ".graphics" / "old")
    assert graphics_overlay.behind_mattes(clip, graphics) == []


def test_edge_refiner_snaps_a_blurry_probability_to_the_picture_edge():
    if segmentation.cv2 is None:
        pytest.skip("needs OpenCV")
    # The picture: a bright person (left half) on a dark wall; the model's guess: a soft ramp around x=50 of 100.
    image = np.zeros((100, 100, 3), np.uint8)
    image[:, :50] = 220
    prob = np.tile(np.clip((60 - np.arange(100)) / 20, 0, 1), (100, 1)).astype(np.float32)
    matte = segmentation.EdgeRefiner(100, 100)(prob, image).astype(int)
    assert matte[50, 40] > 230 and matte[50, 58] < 25, matte[50, 36:62]


@pytest.mark.skipif(not shutil.which("ffmpeg") or not segmentation.available(), reason="needs FFmpeg and the cut-out model")
def test_write_matte_covers_only_the_window(tmp_path):
    clip = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=3", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", clip], check=True)
    out = segmentation.write_matte(clip, str(tmp_path / "m.mkv"), 180, 320, "30", start=1.0, duration=1.0, max_edge=320, refine=True)
    frames = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height",
                             "-of", "csv=p=0", out], capture_output=True, text=True, check=True).stdout.strip()
    assert frames == "180,320,30", frames
