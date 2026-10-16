"""Screen share + webcam: the person fills the frame, cutting to a 50/50 split when the screen matters."""
import asyncio
import os
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from clip_engine.services import layout_analyzer as analyzer
from clip_engine.services.layout_analyzer import (
    Box, ClipLayoutPlan, FrameInfo, LayoutAnalyzer, LayoutType, ShotLayout, SCREEN_THUMB_SIZE,
    apply_screen_focus, person_main_fits, plan_screen_focus, screen_change_times, screen_cue_times,
)
from clip_engine.services.layout_renderer import (
    FILL_CAPTION_Y, build_layout_graph, caption_anchor, shot_views, stacked_panel_heights,
)

FFMPEG = os.environ.get("TEST_FFMPEG") or shutil.which("ffmpeg")
PORTRAIT = os.path.join(os.path.dirname(__file__), "fixtures", "portrait_person.jpg")
# A large webcam on a 1080p screen share: big enough to fill 9:16 within MAX_UPSCALE.
BIG_CAM = Box(.62, .15, .36, .70)
BIG_FACE = Box(.75, .30, .10, .22)
SMALL_CAM = Box(.78, .70, .2, .28)


def assert_valid(segments, start, end):
    assert segments[0][0] == start and segments[-1][1] == end
    for (a0, b0, s0), (a1, b1, s1) in zip(segments, segments[1:]):
        assert b0 == a1 and s0 != s1
    if len(segments) > 1:
        # At most one cut every ~2 s, no shot shorter than 1.5 s.
        assert all(b - a >= analyzer.SPLIT_MIN_CUT_GAP_MS for a, b, _ in segments)


class TestPlanning:
    def test_no_change_keeps_the_person(self):
        assert plan_screen_focus(0, 20000, []) == [(0, 20000, False)]

    def test_one_change_shows_the_split_for_at_least_three_seconds(self):
        segments = plan_screen_focus(0, 20000, [8000])
        assert segments == [(0, 7700, False), (7700, 11000, True), (11000, 20000, False)]
        assert_valid(segments, 0, 20000)

    def test_continuing_changes_extend_the_split(self):
        segments = plan_screen_focus(0, 30000, [8000, 10000, 12500])
        assert segments == [(0, 7700, False), (7700, 15500, True), (15500, 30000, False)]

    def test_splits_closer_than_two_seconds_merge(self):
        # 8 s -> split until 11 s; next change at 12.8 s starts at 12.5 s: a 1.5 s gap.
        segments = plan_screen_focus(0, 30000, [8000, 12800])
        assert segments == [(0, 7700, False), (7700, 15800, True), (15800, 30000, False)]
        far = plan_screen_focus(0, 30000, [8000, 13400])
        assert [s for _, _, s in far] == [False, True, False, True, False]
        assert_valid(far, 0, 30000)

    def test_short_person_shots_at_the_edges_join_the_split(self):
        start = plan_screen_focus(0, 20000, [1200])
        assert start == [(0, 4200, True), (4200, 20000, False)]
        end = plan_screen_focus(0, 20000, [18500])
        assert end == [(0, 18000, False), (18000, 20000, True)]
        assert_valid(end, 0, 20000)

    def test_a_change_at_the_very_end_still_gets_a_full_shot(self):
        segments = plan_screen_focus(0, 20000, [19900])
        assert segments == [(0, 18000, False), (18000, 20000, True)]

    def test_constant_changes_stay_on_the_split(self):
        demo = list(range(500, 20000, 1500))
        assert plan_screen_focus(0, 20000, demo) == [(0, 20000, True)]

    @pytest.mark.parametrize("events", [[300, 2600, 5100, 9000], [4000, 6500, 9100, 11800, 16000], [100, 19999],
                                        list(range(0, 30000, 4900))])
    def test_every_plan_respects_the_cut_rules(self, events):
        segments = plan_screen_focus(1000, 31000, [e + 1000 for e in events])
        assert_valid(segments, 1000, 31000)
        assert segments == plan_screen_focus(1000, 31000, [e + 1000 for e in events])  # deterministic

    def test_short_shots_are_not_cut(self):
        assert plan_screen_focus(0, 3000, [1000]) == [(0, 3000, True)]
        assert plan_screen_focus(0, 3000, []) == [(0, 3000, False)]


def thumb(color=40, rects=()):
    image = np.full(SCREEN_THUMB_SIZE[::-1], color, np.uint8)
    for (x0, y0, x1, y1), value in rects:
        tw, th = SCREEN_THUMB_SIZE
        image[int(y0 * th):int(y1 * th), int(x0 * tw):int(x1 * tw)] = value
    return image


def frames_with(thumbs):
    return [FrameInfo(t, [], None, thumb=image) for t, image in thumbs]


class TestChangeSignal:
    def test_slide_change_is_detected_once(self):
        frames = frames_with([(t, thumb(40 if t < 3000 else 200)) for t in range(0, 6000, 250)])
        assert screen_change_times(frames, Box(0, 0, .6, 1), BIG_CAM, 0, 6000) == [3000]

    def test_movement_inside_the_webcam_is_ignored(self):
        frames = frames_with([(t, thumb(40, [((.65, .2, .95, .8), 40 + (t // 250) % 2 * 150)])) for t in range(0, 4000, 250)])
        assert screen_change_times(frames, Box(0, 0, 1, 1), BIG_CAM, 0, 4000) == []

    def test_a_moving_cursor_is_not_a_change(self):
        frames = frames_with([(t, thumb(40, [((.1 + t / 40000, .5, .1 + t / 40000 + .011, .52), 255)]))
                              for t in range(0, 4000, 250)])
        assert screen_change_times(frames, Box(0, 0, .6, 1), BIG_CAM, 0, 4000) == []

    def test_scrolling_text_is_a_change(self):
        def page(offset):
            return thumb(230, [((.05, (y + offset) / 54, .55, (y + offset + 1) / 54), 20) for y in range(0, 50, 4)])
        frames = frames_with([(t, page(0 if t < 2000 else 2)) for t in range(0, 4000, 250)])
        assert screen_change_times(frames, Box(0, 0, .6, 1), BIG_CAM, 0, 4000) == [2000]

    def test_frames_are_sampled_at_about_four_fps(self):
        # Extra frames near a camera change (precise scan) don't add comparisons.
        times = sorted(set(range(0, 4000, 250)) | {1010, 1020, 1030})
        frames = frames_with([(t, thumb(40 if t < 1020 else 200)) for t in times])
        assert screen_change_times(frames, Box(0, 0, .6, 1), BIG_CAM, 0, 4000) == [1250]

    def test_speech_cues(self):
        words = [SimpleNamespace(word=w, start_time_ms=10000 + i * 300) for i, w in enumerate(
            "so as you can see we CLICK here and Here’s the next slide".split())]
        segments = [SimpleNamespace(words=words)]
        # "as you can see" (and "you can see" in it), "click", "here's", "next slide".
        assert screen_cue_times(segments, 9000, 10000) == [1300, 1600, 2800, 3700, 4300]
        assert screen_cue_times(segments, 0, 5000) == []
        assert screen_cue_times(None, 0, 5000) == []


class TestShots:
    def shot(self, cam=BIG_CAM, face=BIG_FACE):
        return ShotLayout(0, 12000, LayoutType.SCREEN_CAM, source="vision", screen_box=Box(0, 0, .6, 1),
                          cam_box=cam, cam_face=face)

    def test_webcam_size_decides_whether_the_person_can_fill(self):
        assert person_main_fits(self.shot(), 1920, 1080)
        assert not person_main_fits(self.shot(SMALL_CAM, Box(.85, .75, .06, .12)), 1920, 1080)
        assert person_main_fits(self.shot(SMALL_CAM, Box(.85, .75, .06, .12)), 3840 * 2, 2160 * 2)

    def test_small_webcam_keeps_the_split(self):
        shot = self.shot(SMALL_CAM, Box(.85, .75, .06, .12))
        assert apply_screen_focus([shot], [], [], 1920, 1080) == [shot]

    def test_person_main_with_a_split_while_the_screen_changes(self):
        frames = frames_with([(t, thumb(40 if t < 6000 else 200)) for t in range(0, 12000, 250)])
        shots = apply_screen_focus([self.shot()], frames, [], 1920, 1080)
        assert [(s.start_ms, s.end_ms, s.layout) for s in shots] == [
            (0, 5700, LayoutType.TALKING_HEAD), (5700, 9000, LayoutType.SCREEN_CAM), (9000, 12000, LayoutType.TALKING_HEAD)]
        person, split = shots[0], shots[1]
        assert person.detected_layout == split.detected_layout == LayoutType.SCREEN_CAM
        # The person fills the frame from inside the webcam only.
        (x, y, w, h), dest = shot_views(person, 1000, 1920, 1080, 1080, 1920)[0]
        assert dest == (0, 0, 1080, 1920)
        assert x >= BIG_CAM.x * 1920 and x + w <= (BIG_CAM.x + BIG_CAM.w) * 1920 + 1
        assert y >= BIG_CAM.y * 1080 and y + h <= (BIG_CAM.y + BIG_CAM.h) * 1080 + 1
        assert 1920 / h <= analyzer.PERSON_MAIN_MAX_UPSCALE
        assert x <= BIG_FACE.x * 1920 and x + w >= (BIG_FACE.x + BIG_FACE.w) * 1920
        # The split is 50/50 and captions follow the layout per shot.
        assert stacked_panel_heights(split, 1080, 1920) == (960, 960)
        assert caption_anchor(split, 1920, 1080, 1080, 1920) == (5, 960)
        assert caption_anchor(person, 1920, 1080, 1080, 1920) == (5, FILL_CAPTION_Y)

    def test_speech_cue_cuts_to_the_split(self):
        shots = apply_screen_focus([self.shot()], [], [4000], 1920, 1080)
        assert [(s.start_ms, s.end_ms, s.layout) for s in shots] == [
            (0, 3700, LayoutType.TALKING_HEAD), (3700, 7000, LayoutType.SCREEN_CAM), (7000, 12000, LayoutType.TALKING_HEAD)]

    def test_other_layouts_are_untouched(self):
        head = ShotLayout(0, 5000, LayoutType.TALKING_HEAD, focus_path=[(0, .5, .4)])
        assert apply_screen_focus([head], [], [1000], 1920, 1080) == [head]

    def test_analyze_plans_screen_focus_for_automatic_framing_only(self):
        frames = [FrameInfo(t, [BIG_FACE], np.ones((24, 16), np.float32), [.95],
                            thumb=thumb(40 if t < 6000 else 200)) for t in range(0, 12000, 250)]
        reply = dict(layout="screen_cam", cam_box=[150, 620, 850, 980], screen_box=[0, 0, 1000, 600], screen_focus=[], people=[])

        def run(style):
            instance = LayoutAnalyzer()
            async def vision(*_, **__):
                return reply, 0.0
            with patch.object(LayoutAnalyzer, "available", new_callable=lambda: property(lambda _: True)), \
                 patch.object(instance, "_decode_and_detect", return_value=(frames, [(0, cv2.imencode(".jpg", np.zeros((90, 160, 3), np.uint8))[1].tobytes())])), \
                 patch.object(instance, "_vision_enabled", return_value=True), \
                 patch.object(instance, "_vision_classify", side_effect=vision), \
                 patch.object(LayoutAnalyzer, "_refine_webcam_regions"):
                return asyncio.run(instance.analyze("x.mp4", 0, 12000, 1920, 1080, style, precise=False,
                                                    screen_cues_ms=[], capture=True))

        plan = run("auto")
        assert [s.layout for s in plan.shots] == [LayoutType.TALKING_HEAD, LayoutType.SCREEN_CAM, LayoutType.TALKING_HEAD]
        assert plan.trace["screen_focus"][0]["changes"] == [6000]
        assert any(b["kind"] == "screen_focus" for b in plan.trace["boundaries"])
        fill = run("fill")
        assert {s.layout for s in fill.shots} == {LayoutType.TALKING_HEAD} and len(fill.shots) == 1


def make_source(path, seconds=6, fps=10, change_s=3.0):
    """1080p screen share: a slide that changes at change_s, a large webcam on the right."""
    portrait = cv2.imread(PORTRAIT)
    x0, y0 = round(BIG_CAM.x * 1920), round(BIG_CAM.y * 1080)
    cw, ch = round(BIG_CAM.w * 1920), round(BIG_CAM.h * 1080)
    cam = cv2.resize(portrait, (cw, ch))
    proc = subprocess.Popen([FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "1920x1080",
                             "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "ultrafast",
                             "-pix_fmt", "yuv420p", str(path)], stdin=subprocess.PIPE)
    frames = []
    for n in range(seconds * fps):
        second = n / fps >= change_s
        frame = np.full((1080, 1920, 3), (235, 235, 235) if second else (160, 60, 20), np.uint8)
        if second:
            cv2.putText(frame, "SLIDE 2", (180, 300), cv2.FONT_HERSHEY_SIMPLEX, 5, (40, 20, 160), 14)
            for y in range(420, 1000, 90):
                cv2.line(frame, (180, y), (1000, y), (90, 90, 90), 22)
        else:
            cv2.putText(frame, "SLIDE 1", (180, 560), cv2.FONT_HERSHEY_SIMPLEX, 6, (255, 255, 255), 14)
        frame[y0:y0 + ch, x0:x0 + cw] = cam
        proc.stdin.write(frame.tobytes())
        frames.append((round(n * 1000 / fps), frame))
    proc.stdin.close()
    assert proc.wait() == 0
    return frames


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
def test_real_render_cuts_from_person_to_split_when_the_slide_changes(tmp_path):
    source = tmp_path / "share.mp4"
    decoded = make_source(source)
    frames = [FrameInfo(t, [], None, thumb=cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), SCREEN_THUMB_SIZE,
                                                      interpolation=cv2.INTER_AREA))
              for t, image in decoded if t % 250 == 0 or t % 300 == 0]
    shot = ShotLayout(0, 6000, LayoutType.SCREEN_CAM, source="vision", screen_box=Box(0, 0, .6, 1),
                      cam_box=BIG_CAM, cam_face=BIG_FACE)
    plan = ClipLayoutPlan(apply_screen_focus([shot], frames, [], 1920, 1080), 1920, 1080)
    assert [(s.start_ms, s.end_ms, s.layout) for s in plan.shots] == [
        (0, 2700, LayoutType.TALKING_HEAD), (2700, 6000, LayoutType.SCREEN_CAM)]
    out = tmp_path / "out.mp4"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(source), "-filter_complex",
                    build_layout_graph(plan, 1080, 1920, fps="10"), "-map", "[base]", "-c:v", "libx264",
                    "-preset", "ultrafast", str(out)], check=True, capture_output=True)

    def frame_at(t):
        raw = subprocess.run([FFMPEG, "-v", "error", "-ss", str(t), "-i", str(out), "-frames:v", "1",
                              "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], check=True, capture_output=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(1920, 1080, 3).astype(int)

    slide_blue, slide_white = np.array((160, 60, 20)), np.array((235, 235, 235))
    person = frame_at(1.0)
    # The whole frame is the webcam: no slide color anywhere.
    for rows in (person[:200], person[880:1040], person[-200:]):
        assert np.abs(rows - slide_blue).sum(axis=2).min() > 60
    split = frame_at(4.5)
    # Top half: the new slide; bottom half: the webcam; the seam is in the middle.
    top = np.median(split[100:860].reshape(-1, 3), axis=0)
    assert np.abs(top - slide_white).sum() < 40
    bottom = split[1000:1900]
    assert np.abs(np.median(bottom.reshape(-1, 3), axis=0) - slide_white).sum() > 60
    assert np.abs(bottom - slide_white).sum(axis=2).min() > 0  # the webcam, not the slide
