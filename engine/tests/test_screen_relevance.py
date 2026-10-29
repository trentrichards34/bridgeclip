"""Screen share clips: one clip-level decision (presenter, screen or mixed) and the framing it gets."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from clip_engine.services import layout_analyzer as analyzer
from clip_engine.services.automatic_editor import clip_scenes, shot_from_summary
from clip_engine.services.layout_analyzer import (
    SCREEN_THUMB_SIZE, Box, FrameInfo, LayoutAnalyzer, LayoutType, ShotLayout, apply_screen_focus, focus_for_window,
    plan_for_decision, screen_activity,
)
from clip_engine.services.rendering_service import shot_record
from clip_engine.services.screen_relevance import (
    MIXED, PRESENTER, SCREEN, ScreenFocus, clean_decision, clean_reason, fallback_decision, resolve_screen_focus,
    speech_screen_signals,
)

BIG_CAM = Box(.62, .15, .36, .70)
BIG_FACE = Box(.75, .30, .10, .22)
SMALL_CAM = Box(.78, .70, .2, .28)
SCREEN_BOX = Box(0, 0, .6, 1)


def thumb(color=40, rects=()):
    image = np.full(SCREEN_THUMB_SIZE[::-1], color, np.uint8)
    tw, th = SCREEN_THUMB_SIZE
    for (x0, y0, x1, y1), value in rects:
        image[int(y0 * th):int(y1 * th), int(x0 * tw):int(x1 * tw)] = value
    return image


def page(offset):
    """A page of text lines scrolled down by `offset` thumbnail rows."""
    return thumb(230, [((.05, ((y + offset) % 54) / 54, .55, ((y + offset) % 54 + 1) / 54), 20) for y in range(0, 54, 4)])


def frames_with(thumbs):
    return [FrameInfo(t, [], None, thumb=image) for t, image in thumbs]


def scrolling(end_ms=12000):
    """A page scrolling continuously (one row every 250 ms, the analysis rate)."""
    return frames_with([(t, page(t // 250)) for t in range(0, end_ms, 250)])


def slide_change(at_ms=6000, end_ms=12000):
    return frames_with([(t, thumb(40 if t < at_ms else 200)) for t in range(0, end_ms, 250)])


def words(text, start=0, step=300):
    return [SimpleNamespace(word=w, start_time_ms=start + i * step) for i, w in enumerate(text.split())]


def segment(text, start=0, step=300):
    return SimpleNamespace(words=words(text, start, step))


def shot(cam=BIG_CAM, face=BIG_FACE, end=12000):
    return ShotLayout(0, end, LayoutType.SCREEN_CAM, source="vision", screen_box=SCREEN_BOX, cam_box=cam, cam_face=face)


def layouts(shots):
    return [(s.start_ms, s.end_ms, s.layout) for s in shots]


class TestDecision:
    def test_planner_values_are_cleaned(self):
        assert clean_decision(" Presenter ") == PRESENTER and clean_decision("split") is None and clean_decision(3) is None
        assert clean_reason("  A story\nabout ads ") == "A story about ads"
        assert len(clean_reason("x" * 500)) == 160 and clean_reason(None) == ""

    def test_member_choice_wins_over_the_planner(self):
        assert resolve_screen_focus("split", PRESENTER, "story").decision == SCREEN
        assert resolve_screen_focus("presenter", SCREEN, "demo").decision == PRESENTER
        assert resolve_screen_focus("presenter").source == "mode"

    def test_smart_uses_the_planner_then_falls_back_to_the_speech(self):
        planned = resolve_screen_focus("smart", "mixed", "Ends by showing the dashboard")
        assert (planned.decision, planned.reason, planned.source) == (MIXED, "Ends by showing the dashboard", "planner")
        # Older models and visual-only plans give nothing (or junk): the speech decides.
        story = resolve_screen_focus("smart", None, None, cue_count=0, refs=0, words=80, window_ms=30000)
        assert (story.decision, story.source) == (PRESENTER, "speech")
        assert resolve_screen_focus("smart", "bogus", cue_count=0, refs=0, words=80, window_ms=30000).decision == PRESENTER
        assert resolve_screen_focus(None).mode == "smart"

    def test_fallback_reads_how_much_the_speech_points_at_the_screen(self):
        assert fallback_decision(0, 1, 90, 30000)[0] == PRESENTER
        assert fallback_decision(1, 0, 90, 30000)[0] == MIXED
        assert fallback_decision(2, 3, 90, 30000)[0] == MIXED  # one pointer every few seconds is not a walkthrough
        assert fallback_decision(3, 4, 90, 30000)[0] == SCREEN  # 10 per 30 s
        assert fallback_decision(0, 0, 0, 30000)[:2] == (MIXED, "No speech to judge by, so it cuts to the screen when it changes")

    def test_speech_signals(self):
        demo = [segment("so you can see the dashboard here click this button and scroll down to the chart")]
        refs, count = speech_screen_signals(demo, 0, 10000)
        assert count == 16 and refs == 7  # you can see, dashboard, click, button, this button, scroll, chart
        story = [segment("I stopped running ads the day I realized my best clients came from referrals")]
        assert speech_screen_signals(story, 0, 10000)[0] == 0
        assert speech_screen_signals(demo, 20000, 5000) == (0, 0) and speech_screen_signals(None, 0, 1) == (0, 0)

    def test_window_decision_combines_cues_and_speech(self):
        talk = [segment("as you can see on the screen this slide shows the chart click the button scroll down", 1000)]
        cues, focus = focus_for_window(talk, 0, 20000)
        assert cues and focus.decision == SCREEN and focus.source == "speech"
        cues, focus = focus_for_window(talk, 0, 20000, "smart", "presenter", "An opinion")
        assert focus.decision == PRESENTER and cues  # cues still reach the analyzer; the decision ignores them


class TestActivity:
    def test_continuous_scrolling_is_motion_not_a_change(self):
        activity = screen_activity(scrolling(), SCREEN_BOX, BIG_CAM, 0, 12000)
        assert len(activity["changes"]) > 30
        assert activity["persistent"] == [] and activity["motion"] == [[0, 11750]]

    def test_a_slide_change_that_holds_is_one_persistent_change(self):
        activity = screen_activity(slide_change(6000), SCREEN_BOX, BIG_CAM, 0, 12000)
        assert activity == {"changes": [6000], "persistent": [6000], "motion": []}

    def test_a_change_that_does_not_hold_is_ignored(self):
        # A popup flashing for 1 s, and a change too close to the end of the window to know it held.
        flash = frames_with([(t, thumb(200 if 4000 <= t < 5000 else 40)) for t in range(0, 12000, 250)])
        assert screen_activity(flash, SCREEN_BOX, BIG_CAM, 0, 12000)["persistent"] == []
        late = slide_change(11000)
        assert screen_activity(late, SCREEN_BOX, BIG_CAM, 0, 12000)["persistent"] == []

    def test_a_page_change_after_scrolling_counts_once_it_settles(self):
        frames = frames_with([(t, page(t // 250) if t < 4000 else page(16) if t < 6000 else thumb(120)) for t in range(0, 12000, 250)])
        activity = screen_activity(frames, SCREEN_BOX, BIG_CAM, 0, 12000)
        assert activity["motion"] == [[0, 4000]] and activity["persistent"] == [6000]


class TestFraming:
    def test_presenter_fills_the_frame_whatever_the_screen_does(self):
        for frames in (scrolling(), slide_change()):
            [person] = apply_screen_focus([shot()], frames, [4000], 1920, 1080, focus=ScreenFocus(PRESENTER, "", "planner"))
            assert person.layout == LayoutType.TALKING_HEAD and (person.start_ms, person.end_ms) == (0, 12000)
            assert person.crop_bounds == BIG_CAM.clamp()

    def test_presenter_keeps_the_split_when_the_webcam_cannot_fill(self):
        small = shot(SMALL_CAM, Box(.85, .75, .06, .12))
        assert apply_screen_focus([small], slide_change(), [], 1920, 1080, focus=ScreenFocus(PRESENTER, "", "mode", "presenter")) == [small]

    def test_screen_stays_split_while_the_screen_is_active(self):
        focus = ScreenFocus(SCREEN, "", "planner")
        assert layouts(apply_screen_focus([shot()], scrolling(), [], 1920, 1080, focus=focus)) == [(0, 12000, LayoutType.SCREEN_CAM)]
        # A screen that never changes (a chart being discussed) stays on the split too.
        still = frames_with([(t, thumb(40)) for t in range(0, 12000, 250)])
        assert layouts(apply_screen_focus([shot()], still, [], 1920, 1080, focus=focus)) == [(0, 12000, LayoutType.SCREEN_CAM)]

    def test_screen_cuts_to_the_presenter_only_for_long_still_stretches(self):
        # Scrolling for 4 s, then 26 s of a still page: the presenter takes the long still stretch.
        frames = frames_with([(t, page(t // 250) if t < 4000 else page(16)) for t in range(0, 30000, 250)])
        shots = apply_screen_focus([shot(end=30000)], frames, [], 1920, 1080, focus=ScreenFocus(SCREEN, "", "mode", "split"))
        assert layouts(shots) == [(0, 7000, LayoutType.SCREEN_CAM), (7000, 30000, LayoutType.TALKING_HEAD)]
        # Shorter still gaps (under 8 s) stay on the split.
        frames = frames_with([(t, page(t // 250) if t < 4000 or 10000 <= t < 14000 else page(16)) for t in range(0, 16000, 250)])
        shots = apply_screen_focus([shot(end=16000)], frames, [], 1920, 1080, focus=ScreenFocus(SCREEN, "", "planner"))
        assert layouts(shots) == [(0, 16000, LayoutType.SCREEN_CAM)]

    def test_mixed_ignores_scrolling_no_flapping(self):
        shots = apply_screen_focus([shot()], scrolling(), [], 1920, 1080, focus=ScreenFocus(MIXED, "", "planner"))
        assert layouts(shots) == [(0, 12000, LayoutType.TALKING_HEAD)]

    def test_mixed_shows_a_held_slide_change_once(self):
        shots = apply_screen_focus([shot()], slide_change(6000), [], 1920, 1080, focus=ScreenFocus(MIXED, "", "planner"))
        assert layouts(shots) == [(0, 5700, LayoutType.TALKING_HEAD), (5700, 9000, LayoutType.SCREEN_CAM),
                                  (9000, 12000, LayoutType.TALKING_HEAD)]

    def test_mixed_starts_on_the_screen_when_the_opening_words_point_at_it(self):
        shots = apply_screen_focus([shot()], [], [600], 1920, 1080, focus=ScreenFocus(MIXED, "", "planner"))
        assert layouts(shots) == [(0, 3600, LayoutType.SCREEN_CAM), (3600, 12000, LayoutType.TALKING_HEAD)]

    def test_mixed_holds_and_never_flip_flops(self):
        # Two cues 6 s apart leave a 2.7 s presenter gap between splits: it joins the split.
        shots = apply_screen_focus([shot(end=30000)], [], [5000, 11000], 1920, 1080, focus=ScreenFocus(MIXED, "", "planner"))
        assert layouts(shots) == [(0, 4700, LayoutType.TALKING_HEAD), (4700, 14000, LayoutType.SCREEN_CAM),
                                  (14000, 30000, LayoutType.TALKING_HEAD)]

    @pytest.mark.parametrize("events", [[300], [2600, 5100, 9000], [4000, 9100, 16000], [100, 29999], list(range(0, 30000, 4900)), [27500]])
    def test_mixed_minimum_holds(self, events):
        segments = plan_for_decision(MIXED, 0, 30000, {"changes": [], "persistent": events, "motion": []}, [])
        assert segments[0][0] == 0 and segments[-1][1] == 30000
        for (a, b, split), nxt in zip(segments, segments[1:] + [None]):
            assert b - a >= (analyzer.MIXED_MIN_SPLIT_MS if split else analyzer.MIXED_MIN_PERSON_MS)
            if nxt is not None:
                assert b == nxt[0] and split != nxt[2]
        interior = segments[1:-1]
        assert all(b - a >= analyzer.MIXED_MERGE_GAP_MS for a, b, split in interior if not split)

    def test_default_is_mixed(self):
        assert layouts(apply_screen_focus([shot()], scrolling(), [], 1920, 1080)) == [(0, 12000, LayoutType.TALKING_HEAD)]


def run_analyze(frames, focus, cam=(150, 620, 850, 980)):
    reply = dict(layout="screen_cam", cam_box=list(cam), screen_box=[0, 0, 1000, 600], screen_focus=[], people=[])
    instance = LayoutAnalyzer()

    async def vision(*_, **__):
        return reply, 0.0
    detected = [FrameInfo(f.t_ms, [BIG_FACE], np.ones((24, 16), np.float32), [.95], thumb=f.thumb) for f in frames]
    with patch.object(LayoutAnalyzer, "available", new_callable=lambda: property(lambda _: True)), \
         patch.object(instance, "_decode_and_detect", return_value=(detected, [(0, cv2.imencode(".jpg", np.zeros((90, 160, 3), np.uint8))[1].tobytes())])), \
         patch.object(instance, "_vision_enabled", return_value=True), \
         patch.object(instance, "_vision_classify", side_effect=vision), \
         patch.object(LayoutAnalyzer, "_refine_webcam_regions"):
        return asyncio.run(instance.analyze("x.mp4", 0, 12000, 1920, 1080, "auto", precise=False, capture=True,
                                            screen_focus=focus))


def test_analyze_records_the_decision_and_logs_it(caplog):
    caplog.set_level("INFO")
    plan = run_analyze(slide_change(), ScreenFocus(PRESENTER, "An opinion about pricing", "planner"))
    assert [s.layout for s in plan.shots] == [LayoutType.TALKING_HEAD]
    assert plan.screen_focus == {"decision": PRESENTER, "reason": "An opinion about pricing", "source": "planner", "mode": "smart",
                                 "person_fits": True}
    assert plan.trace["screen_focus"][0]["decision"] == PRESENTER and plan.trace["screen_focus"][0]["persistent"] == [6000]
    assert "screen focus presenter (planner: An opinion about pricing)" in caplog.text
    # A small webcam: the split stays, and the record says why.
    small = run_analyze(slide_change(), ScreenFocus(PRESENTER, "", "mode", "presenter"), cam=(700, 780, 980, 980))
    assert {s.layout for s in small.shots} == {LayoutType.SCREEN_CAM} and small.screen_focus["person_fits"] is False


def test_videos_without_a_screen_share_have_no_decision():
    reply = dict(layout="talking_head", cam_box=[], screen_box=[], screen_focus=[], people=[[100, 350, 700, 650]])
    instance = LayoutAnalyzer()

    async def vision(*_, **__):
        return reply, 0.0
    frames = [FrameInfo(t, [Box(.43, .2, .14, .3)], np.ones((24, 16), np.float32), [.95]) for t in range(0, 6000, 250)]
    with patch.object(LayoutAnalyzer, "available", new_callable=lambda: property(lambda _: True)), \
         patch.object(instance, "_decode_and_detect", return_value=(frames, [(0, cv2.imencode(".jpg", np.zeros((90, 160, 3), np.uint8))[1].tobytes())])), \
         patch.object(instance, "_vision_enabled", return_value=True), \
         patch.object(instance, "_vision_classify", side_effect=vision):
        plan = asyncio.run(instance.analyze("x.mp4", 0, 6000, 1920, 1080, "auto", precise=False,
                                            screen_focus=ScreenFocus(SCREEN, "", "mode", "split")))
    assert [s.layout for s in plan.shots] == [LayoutType.TALKING_HEAD] and plan.screen_focus is None


def test_edited_automatic_clip_keeps_the_presenter_and_split_scenes():
    """An Automatic run opened in the editor rebuilds each scene's layout from the saved shots."""
    shots = apply_screen_focus([shot()], slide_change(6000), [], 1920, 1080, focus=ScreenFocus(MIXED, "", "planner"))
    saved = json.loads(json.dumps([shot_record(s) for s in shots]))
    rebuilt = [shot_from_summary(row) for row in saved]
    settings = {'aspect_ratio': '9:16', 'layout_style': 'auto'}
    scenes = clip_scenes(settings, {'layout_type': 'talking_head'}, rebuilt, 1000, [[1000, 13000]], 1920, 1080, 30000)
    assert [(s['at_ms'], s['layout']) for s in scenes] == [(0, 'fill'), (6700, 'split'), (10000, 'fill')]
    # The presenter's crop stays inside the webcam.
    for scene in (scenes[0], scenes[2]):
        x, y, w, h = scene['crops'][0]
        assert x >= BIG_CAM.x - .01 and x + w <= BIG_CAM.x + BIG_CAM.w + .01
        assert y >= BIG_CAM.y - .01 and y + h <= BIG_CAM.y + BIG_CAM.h + .01
