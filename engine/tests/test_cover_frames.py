"""Make my cover: picking the speaker's best frames (cover_frames)."""

import os
import subprocess

import cv2
import numpy as np

from clip_engine.services import cover_frames as cf

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_sharpness_ranks_a_crisp_face_over_a_soft_one():
    img = cv2.imread(os.path.join(FIXTURES, "portrait_person.jpg"), cv2.IMREAD_GRAYSCALE)
    sharp = cf.sharpness(img)
    soft = cf.sharpness(cv2.GaussianBlur(img, (0, 0), 3))
    assert sharp > soft + 0.3 and 0 <= soft < sharp <= 1


def _eye_face(open_eye: bool) -> np.ndarray:
    """A skin-colored face crop (YCrCb) with two eyes: open (white, a dark iris) or closed (skin and a lash line)."""
    skin = np.array([150, 150, 115], np.uint8)  # Y, Cr, Cb of light skin
    face = np.tile(skin, (200, 200, 1)).astype(np.uint8)
    for cx in (65, 135):
        if open_eye:
            cv2.ellipse(face, (cx, 80), (16, 8), 0, 0, 360, (225, 128, 128), -1)  # the white
            cv2.circle(face, (cx, 80), 7, (60, 120, 140), -1)  # the iris
        else:
            cv2.line(face, (cx - 15, 82), (cx + 15, 82), (70, 135, 120), 2)  # the lash line
    return face.astype(np.float32)


def test_eye_openness_tells_open_eyes_from_shut_ones():
    eyes = [(65.0, 80.0), (135.0, 80.0)]
    opened = cf.eye_openness(_eye_face(True), eyes)
    shut = cf.eye_openness(_eye_face(False), eyes)
    assert opened > 0.6 and shut < cf.EYES_SHUT


def test_placement_prefers_a_big_centered_face_not_cut_by_the_edge():
    centered, size = cf.placement((0.35, 0.25, 0.3, 0.25))
    assert centered > 0.9 and size == 1
    off, _ = cf.placement((0.75, 0.25, 0.2, 0.25))
    assert off < 0.3
    _, small = cf.placement((0.47, 0.3, 0.05, 0.06))
    _, cut = cf.placement((0.0, 0.25, 0.3, 0.25))
    assert small < 0.3 and cut < size


def test_pick_best_spreads_the_choices_and_relaxes_on_a_short_video():
    scores = [cf.FrameScore(t, s, (0.3, 0.3, 0.3, 0.3)) for t, s in [(1000, 0.9), (1500, 0.89), (2000, 0.88), (5000, 0.7), (9000, 0.6), (9500, 0.1)]]
    assert [p.at_ms for p in cf.pick_best(scores, 3, 2000)] == [1000, 5000, 9000]
    # Too short for the gap: half the gap, then none, rather than fewer than asked.
    assert [p.at_ms for p in cf.pick_best(scores[:3], 3, 2000)] == [1000, 1500, 2000]
    assert cf.pick_best([], 3) == []


def test_cover_frames_picks_the_sharp_open_faced_frames_of_a_real_person(tmp_path):
    """A 9 s portrait video: soft (out of focus) for its first 3 s and last 3 s, sharp in the middle: the picks come
    from the sharp part, written as full-size JPEGs with the face box."""
    still = os.path.join(FIXTURES, "portrait_person.jpg")
    video = str(tmp_path / "person.mp4")
    blur = "gblur=sigma=6:enable='lt(t,3)+gte(t,6)'"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-r", "30", "-i", still, "-t", "9",
                    "-vf", f"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,{blur},format=yuv420p",
                    "-c:v", "libx264", "-preset", "ultrafast", video], check=True, timeout=120)
    seen = []
    result = cf.cover_frames(video, str(tmp_path / "covers"), 3, seen.append)
    assert (result["width"], result["height"]) == (720, 1280) and abs(result["duration_ms"] - 9000) < 100
    frames = result["frames"]
    assert len(frames) == 3 and seen and seen[-1] == 1.0
    sharp_part = [f for f in frames if 3000 <= f["at_ms"] < 6000]
    assert frames[0] in sharp_part, [f["at_ms"] for f in frames]
    for f in frames:
        assert os.path.isfile(f["path"]) and f["path"].endswith(f"frame-{f['at_ms']}.jpg")
        img = cv2.imread(f["path"])
        assert img.shape[:2] == (1280, 720)
        x, y, w, h = f["face"]
        assert 0.2 < x + w / 2 < 0.8 and 0 < h < 0.6
