"""Motion graphics from the clip editor: main renders each one to a transparent .mov in the run's .graphics/
folder; the engine checks the request and lays them over the finished clip at their output times."""

import asyncio
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clip_engine.services.graphics_overlay import checked_graphics, overlay_command, overlay_graphics
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
                "nope", [{"file": NAME, "start_ms": 0, "duration_ms": 1000}] * 13):
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
