"""Motion gate: a static draft fails, a moving one passes, flat stretches carry their words."""
import shutil
import subprocess

import numpy as np
import pytest

from clip_engine.services import motion_gate as mg

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")


def make_clip(path, lavfi, seconds=4):
    args = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", lavfi,
            "-t", str(seconds), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", path]
    subprocess.run(args, check=True)
    return path


def test_targets_table():
    assert mg.STYLE_TARGETS["2d"] == mg.StyleTarget(motion=4.8, big_per_s=0.65, flat_share=0.27, window_floor=2.0)
    assert set(mg.STYLE_TARGETS) == {"2d", "explainer", "voxel"}


def test_scoring_from_differences_finds_flat_stretch_and_words():
    # 6 s: lively for 2 s, dead for 2 s, lively again; a big step every 0.5 s while lively.
    diffs = np.full(60, 6.0)
    diffs[20:40] = 0.2
    diffs[[0, 5, 10, 15, 45, 50, 55]] = 20.0
    words = [{"word": "first", "start": 0.5, "end": 0.9}, {"word": "dead", "start": 2.4, "end": 2.8},
             {"word": "air", "start": 3.1, "end": 3.5}, {"word": "late", "start": 5.5, "end": 5.9}]
    report = mg.score_differences(diffs, "2d", words)
    assert report.duration == pytest.approx(6.0)
    assert report.big_per_s == pytest.approx(7 / 6)
    assert len(report.flat_stretches) == 1
    stretch = report.flat_stretches[0]
    assert stretch.start >= 1.5 and stretch.end <= 4.5
    assert stretch.words == ["dead", "air"]
    assert report.flat_share > 0.27 and not report.passed
    assert any("flat" in r for r in report.reasons)
    assert "dead air" in report.summary()


def test_unknown_style_and_empty():
    with pytest.raises(ValueError):
        mg.score_differences(np.ones(20), "anime")
    assert not mg.score_differences(np.array([]), "2d").passed


@needs_ffmpeg
def test_static_clip_fails(tmp_path):
    clip = make_clip(str(tmp_path / "static.mp4"), "color=c=0x8080a0:s=216x384:r=30")
    report = mg.score_video(clip, "2d", words=[{"word": "hello", "start": 1.0, "end": 1.4}])
    assert not report.passed
    assert report.motion < 0.5 and report.big_per_s == 0 and report.flat_share == pytest.approx(1.0)
    assert len(report.reasons) == 3
    assert report.flat_stretches and "hello" in report.flat_stretches[0].words


@needs_ffmpeg
def test_moving_clip_passes(tmp_path):
    clip = make_clip(str(tmp_path / "moving.mp4"), "color=c=gray:s=216x384:r=30,noise=alls=60:allf=t")
    report = mg.score_video(clip, "2d")
    assert report.passed, report.summary()
    assert report.motion >= 4.8 and report.big_per_s >= 0.65 and report.flat_share <= 0.27
    assert report.flat_stretches == []
    assert report.duration == pytest.approx(4.0, abs=0.2)


@needs_ffmpeg
def test_mask_hides_presenter_corner(tmp_path):
    # Dead gray frame with a busy box in the bottom-right corner (a stand-in for a presenter).
    clip = str(tmp_path / "corner.mp4")
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=gray:s=216x384:r=30",
                    "-f", "lavfi", "-i", "color=c=gray:s=108x128:r=30",
                    "-filter_complex", "[1:v]noise=alls=100:allf=t[box];[0:v][box]overlay=108:256[v]",
                    "-map", "[v]", "-t", "3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
                    clip], check=True)
    unmasked = mg.score_video(clip, "2d")
    masked = mg.score_video(clip, "2d", mask=(0.5, 2 / 3, 0.5, 1 / 3))
    assert unmasked.motion > masked.motion * 10
    assert not masked.passed and masked.motion < 0.5
    with pytest.raises(ValueError):
        mg.score_video(clip, "2d", mask=(0, 0, 1, 1))
