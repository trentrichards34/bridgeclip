"""Screen-aware zoom: activity regions on a screen recording, the zoom path (easing, holds, pans, caps), the director's
use of zooms on long-form videos, the graphics cap that grows with a YouTube video's length, and a real render on a
synthetic screen recording (the zoom lands on the box being typed into)."""
from __future__ import annotations

import os
import shutil
import subprocess

import numpy as np
import pytest

from clip_engine.services import screen_zoom as sz
from tests import zoom_fixture as zf

HAS_FFMPEG = shutil.which("ffmpeg") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")


@pytest.fixture(scope="module")
def desk(tmp_path_factory):
    if not HAS_FFMPEG:
        pytest.skip("needs ffmpeg")
    folder = tmp_path_factory.mktemp("desk")
    return zf.write_fake_desktop(str(folder / "desk.mp4"))


def _share(box):
    x0, y0, x1, y1 = box
    return x0 / zf.W, y0 / zf.H, x1 / zf.W, y1 / zf.H


# ---------------------------------------------------------------------------
# Activity and focus regions
# ---------------------------------------------------------------------------

@needs_ffmpeg
def test_activity_marks_the_scroll_as_a_cut_and_leaves_out_the_always_busy_webcam(desk, tmp_path):
    act = sz.read_activity(desk, None, cache_dir=str(tmp_path))
    assert act.count == pytest.approx(zf.SECONDS * 1000 / sz.STEP_MS, abs=2)
    cuts = [act.at(i) for i in range(act.count) if act.cuts[i]]
    assert cuts and all(zf.SCROLL_AT * 1000 - 300 <= t <= zf.SCROLL_AT * 1000 + 800 for t in cuts)
    # The webcam spot changes every frame: its cells are always busy.
    x0, y0, x1, y1 = _share(zf.CAM_BOX)
    cam = act.persistent[int(y0 * sz.ROWS):int(np.ceil(y1 * sz.ROWS)), int(x0 * sz.COLS):int(np.ceil(x1 * sz.COLS))]
    assert cam.mean() > 0.3
    # The typing box is not.
    tx0, ty0, tx1, ty1 = _share(zf.TYPE_BOX)
    assert act.persistent[int(ty0 * sz.ROWS):int(ty1 * sz.ROWS), int(tx0 * sz.COLS):int(tx1 * sz.COLS)].mean() < 0.1
    # Read again from the cache (same answer, no FFmpeg).
    again = sz.read_activity(desk, None, cache_dir=str(tmp_path))
    assert (again.grids == act.grids).all() and len(os.listdir(tmp_path)) == 1


@needs_ffmpeg
def test_focus_regions_settle_on_the_typing_then_the_menu(desk, tmp_path):
    regions = sz.focus_regions(sz.read_activity(desk, None, cache_dir=str(tmp_path)))
    assert len(regions) >= 2
    typing, menu = regions[0], regions[-1]
    # The typing region starts as the typing does (the cursor's glide before it is travel, not focus) and holds it.
    assert zf.TYPE_START * 1000 - 600 <= typing.start_ms <= zf.TYPE_START * 1000 + 600
    assert typing.end_ms >= zf.TYPE_END * 1000 - 1000
    cx, cy = typing.box[0] + typing.box[2] / 2, typing.box[1] + typing.box[3] / 2
    tx0, ty0, tx1, ty1 = _share(zf.TYPE_BOX)
    assert tx0 - 0.05 <= cx <= tx1 + 0.05 and ty0 - 0.05 <= cy <= ty1 + 0.05
    assert max(typing.box[2], typing.box[3]) < 0.45
    mx0, my0, mx1, my1 = _share(zf.MENU_BOX)
    assert menu.start_ms >= zf.MENU_START * 1000 - 500
    mcx, mcy = menu.box[0] + menu.box[2] / 2, menu.box[1] + menu.box[3] / 2
    assert mx0 - 0.25 <= mcx <= mx1 + 0.05 and my0 - 0.1 <= mcy <= my1 + 0.1


def _grid(cells):
    g = np.zeros((sz.ROWS, sz.COLS), np.uint8)
    for r, c in cells:
        g[r, c] = 9
    return g


def test_a_sample_box_is_the_busiest_group_and_ignores_always_busy_cells():
    grid = _grid([(5, 5), (5, 6), (6, 5), (6, 6), (20, 40)])
    persistent = np.zeros((sz.ROWS, sz.COLS), bool)
    box = sz.sample_box(grid, persistent)
    assert box == pytest.approx((5 / sz.COLS, 5 / sz.ROWS, 7 / sz.COLS, 7 / sz.ROWS))
    persistent[5:7, 5:7] = True
    assert sz.sample_box(grid, persistent) == pytest.approx((40 / sz.COLS, 20 / sz.ROWS, 41 / sz.COLS, 21 / sz.ROWS))
    assert sz.sample_box(np.zeros_like(grid), persistent) is None


def test_whole_screen_changes_and_scrolls_are_cuts_tiny_noise_is_not():
    a = np.full((sz.GRID_H, sz.GRID_W), 120, np.uint8)
    b = a.copy()
    b[:] = 30
    assert sz.grid_of(a, b)[1] is True
    # A scroll on a sparse page: thin lines move all over.
    c = a.copy()
    c[::9, :] = 20
    d = a.copy()
    d[4::9, :] = 20
    assert sz.grid_of(c, d)[1] is True
    # A cursor moving: a few pixels.
    e = a.copy()
    e[50:54, 80:83] = 0
    grid, cut = sz.grid_of(a, e)
    assert cut is False and 0 < int((grid >= sz.CELL_MIN).sum()) <= 4


def _activity(boxes_by_ms, total_ms=20000, cut_at=()):
    n = total_ms // sz.STEP_MS
    grids = np.zeros((n, sz.ROWS, sz.COLS), np.uint8)
    cuts = np.zeros(n, bool)
    for i in range(n):
        t = i * sz.STEP_MS
        for (a, b), (r0, c0, r1, c1) in boxes_by_ms:
            if a <= t < b:
                grids[i, r0:r1, c0:c1] = 9
        if any(abs(t - c) < sz.STEP_MS for c in cut_at):
            cuts[i] = True
    return sz.Activity(sz.STEP_MS, 0, grids, cuts, np.zeros((sz.ROWS, sz.COLS), bool))


def test_regions_need_dwell_and_a_cut_ends_one():
    act = _activity([((1000, 1500), (2, 2, 4, 6)), ((3000, 9000), (10, 30, 13, 38))], cut_at=(6000,))
    regions = sz.focus_regions(act)
    # The half-second blip is too short; the long one is split by the cut.
    assert [(r.start_ms // 250, r.end_ms // 250) for r in regions] == [(12, 24), (25, 36)]
    assert all(r.box[0] == pytest.approx(30 / sz.COLS) for r in regions)
    # Only inside the screen stretches given.
    assert sz.focus_regions(act, [(0, 2000)]) == []


# ---------------------------------------------------------------------------
# Zoom moves and their path
# ---------------------------------------------------------------------------

def _region(a, b, box):
    return sz.Region(a, b, box, [(a, box[0] + box[2] / 2, box[1] + box[3] / 2)], (b - a) // sz.STEP_MS)


def test_scale_fills_about_two_thirds_within_limits():
    assert sz.scale_for((0.3, 0.3, 0.34, 0.2), 2.2) == pytest.approx(2.0, abs=0.01)
    assert sz.scale_for((0.4, 0.4, 0.05, 0.05), 2.2) == sz.MAX_SCALE
    assert sz.scale_for((0.1, 0.1, 0.55, 0.3), 2.2) == sz.MIN_SCALE
    # Never past what the source can show sharply.
    assert sz.scale_for((0.4, 0.4, 0.05, 0.05), 1.5) == 1.5
    # Spread out, or a soft source: none.
    assert sz.scale_for((0.0, 0.0, 0.8, 0.3), 2.2) is None
    assert sz.scale_for((0.4, 0.4, 0.1, 0.1), 1.1) is None
    assert sz.scale_limit(2560, 1280) == 2.2 and sz.scale_limit(1920, 1290) == pytest.approx(1.86, abs=0.01)
    assert sz.scale_limit(1280, 1280) == sz.UPSCALE_SLACK


def test_plan_zooms_paces_caps_and_keeps_clear_of_full_screen_cards():
    regions = [_region(2000, 30000, (0.1, 0.1, 0.2, 0.15)), _region(31000, 36000, (0.6, 0.6, 0.2, 0.2)),
               _region(50000, 56000, (0.5, 0.2, 0.2, 0.2)), _region(70000, 76000, (0.2, 0.6, 0.2, 0.2))]
    moves = sz.plan_zooms(regions, [(0, 100000)], 2.2, blocked=[(68000, 80000)], graphic_starts=[49000])
    starts = [m["at_ms"] for m in moves]
    # The long region is held at most the cap, then eased out.
    first = moves[0]
    assert first["end_ms"] - first["at_ms"] <= sz.EASE_IN_MS + sz.HOLD_CAP_MS + sz.EASE_OUT_MS
    assert 1.4 <= first["keys"][0][3] <= 2.2
    # A zoom starts a few seconds after a graphic does; none under the full-screen card.
    assert any(t == 49000 + sz.AFTER_GRAPHIC_MS for t in starts)
    assert not any(m["at_ms"] < 80000 and m["end_ms"] > 68000 for m in moves)
    # Body zooms are at least BODY_GAP_MS apart.
    assert all(b - a >= sz.BODY_GAP_MS for a, b in zip(starts, starts[1:]))
    for m in moves:
        assert m["max"] == 2.2 and all(1 / k[3] / 2 - 1e-6 <= k[1] <= 1 - 1 / k[3] / 2 + 1e-6 for k in m["keys"])


def test_a_region_right_after_a_zoom_is_panned_to_in_the_same_move():
    regions = [_region(1000, 4000, (0.1, 0.1, 0.2, 0.15)), _region(5000, 8000, (0.6, 0.6, 0.2, 0.15))]
    moves = sz.plan_zooms(regions, [(0, 20000)], 2.2)
    assert len(moves) == 1 and len(moves[0]["keys"]) == 2
    assert moves[0]["keys"][1][1] > moves[0]["keys"][0][1]
    # The cold open's zooms may come closer together than the body's.
    spread = [_region(1000, 3000, (0.1, 0.1, 0.2, 0.15)), _region(6000, 8500, (0.6, 0.6, 0.2, 0.15))]
    assert len(sz.plan_zooms(spread, [(0, 20000)], 2.2, cold_ms=20000)) == 2
    assert len(sz.plan_zooms(spread, [(0, 20000)], 2.2, cold_ms=0)) == 1


def test_crop_path_eases_in_decelerating_holds_pans_and_eases_out():
    move = {"at_ms": 1000, "end_ms": 9000, "keys": [[1000, 0.3, 0.3, 2.0], [5000, 0.7, 0.6, 2.0]], "max": 2.2}
    assert sz.crop_at(move, 500) == (0, 0, 1, 1) and sz.crop_at(move, 9500) == (0, 0, 1, 1)
    widths = [sz.crop_at(move, 1000 + k * 50)[2] for k in range(13)]
    assert all(b < a for a, b in zip(widths, widths[1:]))
    # Decelerating: most of the way in during the first half of the ease.
    assert 1 - sz.crop_at(move, 1300)[2] > 0.75 * (1 - 0.5)
    held = sz.crop_at(move, 3000)
    assert held == pytest.approx((0.05, 0.05, 0.5, 0.5))
    # The pan to the second key, eased over PAN_MS.
    assert sz.crop_at(move, 5000 + sz.PAN_MS + 10) == pytest.approx((0.45, 0.35, 0.5, 0.5))
    mid = sz.crop_at(move, 5000 + sz.PAN_MS // 2)
    assert 0.05 < mid[0] < 0.45
    # Eased out by its end; intensity makes it gentler, never past its max; off: nothing.
    assert sz.crop_at(move, 8990)[2] > 0.95
    assert sz.crop_at({**move, "intensity": 0.5}, 3000)[2] == pytest.approx(1 / 1.5)
    assert sz.crop_at({**move, "intensity": 1.5, "max": 2.2}, 3000)[2] == pytest.approx(1 / 2.2)
    assert sz.crop_at({**move, "on": False}, 3000) == (0, 0, 1, 1)


def test_validate_zooms_rejects_malformed_moves():
    good = [{"at_ms": 0, "end_ms": 2000, "keys": [[0, 0.5, 0.5, 1.5]], "max": 2.0, "on": True, "intensity": 1.2, "clip": "0123456789abcdef.mp4",
             "glow": {"box": [0.1, 0.1, 0.2, 0.1], "at_ms": 500}}]
    assert sz.validate_zooms(good, 5000) == good
    bad = [
        [{**good[0], "clip": "../x.mp4"}], [{**good[0], "keys": [[0, 0.5, 0.5, 3.0]]}], [{**good[0], "end_ms": 6000}],
        [{**good[0], "extra": 1}], [good[0], {**good[0]}], [{**good[0], "intensity": 3}], [{**good[0], "glow": {"box": [0.9, 0, 0.2, 0.1], "at_ms": 0}}],
    ]
    for raw in bad:
        with pytest.raises(ValueError):
            sz.validate_zooms(raw, 5000)
    sz.validate_zoom_area({"area": [0.02, 0.04, 0.6, 0.6], "keep": [0.7, 0.2, 0.25, 0.5], "radius": 0.02})
    with pytest.raises(ValueError):
        sz.validate_zoom_area({"area": [0.5, 0.5, 0.6, 0.6]})


def test_said_numbers_on_screen_become_a_zoom_with_a_glowing_box():
    timed = [("It", 9000, 9200, 0), ("made", 9200, 9500, 1), ("$1,227", 9600, 10400, 2), ("this", 10400, 10600, 3), ("week", 10600, 11000, 4)]
    picks = sz.said_candidates(timed, [(0, 20000)])
    assert picks == [(9600, "$1,227")]
    moves = sz.glow_moves([(9600, "$1,227", [0.3, 0.2, 0.1, 0.05])], 2.0, [(0, 20000)])
    m = moves[0]
    assert m["at_ms"] == 9600 - sz.GLOW_LEAD_MS and m["glow"]["at_ms"] == 9600 and m["keys"][0][3] == 2.0
    assert sz.glow_at(m, 9500) == 0 and sz.glow_at(m, 10200) == 1
    # Said zooms win where activity zooms overlap them.
    follow = [{"at_ms": 8000, "end_ms": 12000, "keys": [[8000, 0.5, 0.5, 1.5]]}, {"at_ms": 15000, "end_ms": 18000, "keys": [[15000, 0.5, 0.5, 1.5]]}]
    merged = sz.merge_moves(follow, moves)
    assert [x["at_ms"] for x in merged] == [m["at_ms"], 15000]


def test_reel_spans_map_a_window_to_the_takes_it_comes_from():
    class P:
        def __init__(self, src, start, end):
            self.src, self.start, self.end = src, start, end

        @property
        def seconds(self):
            return self.end - self.start

    pieces = [P(0, 10.0, 12.0), P(0, 20.0, 25.0)]
    spans = sz.reel_spans(pieces, 1500, 3500, 30, lambda p, t: (f"take{p.src}", t - 1.0))
    assert spans == [("take0", pytest.approx(10.5), 15), ("take0", pytest.approx(19.0), 45)]
    assert sz.clip_size((2560, 1440), (1280, 720)) == (2560, 1440)
    assert sz.clip_size((3840, 2160), (1280, 720)) == (2816, 1584)
    assert sz.clip_size((1280, 720), (1280, 720)) is None


# ---------------------------------------------------------------------------
# The render: the zoom lands on the box being typed into
# ---------------------------------------------------------------------------

def _frame(path, t, w=zf.W, h=zf.H):
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out[:w * h], np.uint8).reshape(h, w).astype(np.float32)


def _ncc(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-6))


@needs_ffmpeg
def test_render_zooms_onto_the_typing_box_and_leaves_the_rest_alone(desk, tmp_path):
    import cv2
    act = sz.read_activity(desk, None, cache_dir=str(tmp_path))
    moves = sz.plan_zooms(sz.focus_regions(act), [(0, int(zf.SECONDS * 1000))], 1.8)
    assert moves
    first = moves[0]
    out = str(tmp_path / "zoomed.mp4")
    assert sz.apply_zooms(desk, out, moves, {"area": [0, 0, 1, 1]}, zf.W, zf.H, zf.FPS, str(tmp_path),
                          ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p"])
    # Outside the move: the same picture.
    before = 1.0
    assert _ncc(_frame(out, before), _frame(desk, before)) > 0.97
    # While held: the frame is the original's crop, scaled up, and that crop holds the typing box.
    t = (first["at_ms"] + sz.EASE_IN_MS + 800) / 1000
    x, y, w, h = sz.crop_at(first, t * 1000)
    src = _frame(desk, t)
    crop = src[int(y * zf.H):int((y + h) * zf.H), int(x * zf.W):int((x + w) * zf.W)]
    expected = cv2.resize(crop, (zf.W, zf.H), interpolation=cv2.INTER_CUBIC)
    got = _frame(out, t)
    assert _ncc(got, expected) > 0.9
    assert _ncc(got, src) < 0.8
    tx0, ty0, tx1, ty1 = _share(zf.TYPE_BOX)
    assert x <= tx0 + 0.02 and y <= ty0 + 0.02 and x + w >= (tx0 + tx1) / 2 and y + h >= ty1 - 0.02
    assert 1 / w >= 1.4


@needs_ffmpeg
def test_render_keeps_the_webcam_card_and_rounded_corners(desk, tmp_path):
    move = {"at_ms": 2000, "end_ms": 6000, "keys": [[2000, 0.4, 0.4, 1.8]], "max": 1.8}
    area = [100 / zf.W, 100 / zf.H, 1000 / zf.W, 560 / zf.H]
    keep = [zf.CAM_BOX[0] / zf.W, (zf.CAM_BOX[1] - 40) / zf.H, 120 / zf.W, 100 / zf.H]
    out = str(tmp_path / "pip.mp4")
    sz.apply_zooms(desk, out, [move], {"area": area, "keep": keep, "radius": 0.05}, zf.W, zf.H, zf.FPS, str(tmp_path),
                   ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p"])
    got, src = _frame(out, 4.0), _frame(desk, 4.0)
    # Outside the area, untouched; the card's place inside it, untouched; the middle of the area, zoomed.
    assert np.abs(got[:90, :] - src[:90, :]).mean() < 3
    kx, ky = int(keep[0] * zf.W) + 20, int(keep[1] * zf.H) + 20
    assert np.abs(got[ky:ky + 40, kx:kx + 40] - src[ky:ky + 40, kx:kx + 40]).mean() < 6
    assert np.abs(got[100 + 2:100 + 6, 100 + 2:100 + 6] - src[100 + 2:100 + 6, 100 + 2:100 + 6]).mean() < 8
    assert np.abs(got[300:400, 500:700] - src[300:400, 500:700]).mean() > 5


# ---------------------------------------------------------------------------
# Words on the screen (only where ONNX Runtime is there)
# ---------------------------------------------------------------------------

def test_find_said_matches_numbers_by_their_digits_and_words_inside_a_line():
    from clip_engine.services import screen_text as st
    lines = [{"box": (100, 100, 400, 130), "text": "Revenue this month: $1,227.00", "score": 0.95},
             {"box": (100, 200, 300, 230), "text": "31 new members", "score": 0.9}]
    box = st.find_said(lines, "$1,227")
    assert box is not None and 250 < box[0] < box[2] <= 400 and box[1] == 100
    assert st.find_said(lines, "1227") is not None
    assert st.find_said(lines, "122") is None
    assert st.find_said(lines, "31") is not None
    assert st.find_said(lines, "new members") is not None
    assert st.find_said(lines, "old members") is None


def test_reading_words_on_a_screen_frame():
    from clip_engine.services import screen_text as st
    if not st.available():
        pytest.skip("ONNX Runtime is not installed here")
    lines = st.read(zf.frame_at(int(8 * zf.FPS)))
    box = st.find_said(lines, "$1,227")
    assert box is not None
    tx0, ty0, tx1, ty1 = zf.TYPE_BOX
    assert tx0 <= box[0] and box[2] <= tx1 + 10 and ty0 <= box[1] <= ty1


# ---------------------------------------------------------------------------
# A Screen recording window's push-in, camera + screen reels
# ---------------------------------------------------------------------------

def test_view_box_maps_the_frame_to_what_a_window_shows():
    # A 1080x1920 reel in a square window: the middle 1080x1080.
    box = sz.view_box((0.0, 0.5, 0.5, 0.1), 1080, 1920, 1.0)
    assert box == pytest.approx((0.0, (960 - 420) / 1080, 0.5, 192 / 1080))


@needs_ffmpeg
def test_screen_frame_push_in_heads_for_the_busy_part(desk, tmp_path):
    field = sz.frame_zoom_field(desk, 2500, 6000, "wide", str(tmp_path))
    assert field
    x, y, w, h = (float(v) for v in field.split(","))
    tx0, ty0, tx1, ty1 = _share(zf.TYPE_BOX)
    assert w == h and 0.5 <= w <= 0.85 and x <= tx0 + 0.05 and y <= ty0 + 0.05
    graphics = [{"template": "screen_frame", "origin": "auto", "at_ms": 0, "duration_ms": 6000, "fields": {"video": "source", "from": "2.5", "shape": "wide"}},
                {"template": "screen_frame", "origin": "member", "at_ms": 0, "duration_ms": 6000, "fields": {"video": "source", "from": "2.5"}}]
    aimed = sz.aim_screen_frames(desk, graphics, str(tmp_path))
    assert aimed[0]["fields"]["zoom"] == field and "zoom" not in aimed[1]["fields"]


def test_camera_screen_sections_push_toward_their_main_region():
    from clip_engine.services import screen_pair as sp
    geom = sp.geometry_for(1920, 1080)
    regions = [_region(1000, 2000, (0.1, 0.1, 0.1, 0.1)), _region(3000, 9000, (0.6, 0.5, 0.2, 0.2))]
    focus = sp.region_focus(regions, 0, 10000, geom)
    x, y, w, h = geom.content
    assert focus["start_ms"] == 3000 and focus["box"][0] == pytest.approx(x + 0.6 * w)
    scenes = sp.scenes_for([(0, "screen_top")], 10000, geom, 0.5, "cover", None, {0: focus}, True)
    assert len(scenes) == 2 and scenes[1]["at_ms"] == 3000
    assert sp.region_focus([_region(0, 9000, (0.0, 0.0, 0.9, 0.9))], 0, 10000, geom) is None


# ---------------------------------------------------------------------------
# Director: zooms on long-form videos, and the graphics cap
# ---------------------------------------------------------------------------

def test_graphics_cap_grows_with_a_youtube_videos_length():
    from clip_engine.services.auto_graphics import graphics_cap
    assert graphics_cap(30 * 60_000, False) == 60
    assert graphics_cap(5 * 60_000, True) == 60
    assert graphics_cap(26 * 60_000, True) == 156
    assert graphics_cap(45 * 60_000, True) == 180


def test_long_form_pacing_and_budget_go_past_sixty_on_a_long_video():
    from clip_engine.services import longform as lf
    total = 26 * 60_000
    budget = lf.graphics_budget(total / 1000)
    assert 60 < budget <= 156
    graphics = [{"id": f"g{i:04d}", "template": "stat", "at_ms": 100_000 + i * 12_500, "duration_ms": 3000, "fields": {"value": "1", "label": "x"},
                 "origin": "auto", "placement": "bottom"} for i in range(120)]
    paced = lf.pace_graphics(graphics, total)
    assert len(paced) > 60


def test_editor_graphics_keeps_the_videos_cap():
    from clip_engine.services import edit_direction as ed
    timed = [("word", i * 1000, i * 1000 + 500, i) for i in range(1600)]
    member = [{"id": f"m{i:04d}", "template": "stat", "word": i * 10, "duration_ms": 2000, "placement": "bottom", "fields": {"value": "1", "label": "x"},
               "origin": "member"} for i in range(100)]
    reel, _ = ed.editor_graphics(member, timed, 1_600_000, {"motion": True})
    long_video, _ = ed.editor_graphics(member, timed, 1_600_000, {"motion": True, "cap": 156})
    assert len(reel) == 60 and len(long_video) == 100


def test_youtube_zooms_stay_off_full_screen_cards_and_off_a_talking_head(tmp_path, monkeypatch):
    from clip_engine.services import longform as lf
    seen = {}

    def fake_plan(video, area, w, h, allowed, max_scale, **kw):
        seen.update(kw, allowed=allowed, max_scale=max_scale)
        return [{"at_ms": 30000, "end_ms": 34000, "keys": [[30000, 0.5, 0.5, 1.8]], "max": max_scale}]

    monkeypatch.setattr(sz, "plan_video", fake_plan)
    graphics = [{"template": "title", "at_ms": 5000, "duration_ms": 3000, "size": "stage"}, {"template": "stat", "at_ms": 40000, "duration_ms": 3000},
                {"template": "chapter", "at_ms": 0, "duration_ms": 60000}]
    zoom = {"area": [0.02, 0.04, 0.67, 0.67], "keep": None, "radius": 0.02, "max_scale": 1.6, "cut": None, "kind": "pip"}
    moves, record = lf.plan_youtube_zooms("v.mp4", zoom, graphics, [], 600_000, str(tmp_path))
    assert seen["blocked"] == [(5000, 8000)] and seen["graphic_starts"] == [5000, 40000] and seen["allowed"] == [(0, 600_000)]
    assert record == {"area": zoom["area"], "radius": 0.02} and moves[0]["max"] == 1.6
    # A recording that is a big face (not a screen): no zooms.
    full = {**zoom, "kind": "full"}
    assert lf.plan_youtube_zooms("v.mp4", full, graphics, [], 600_000, str(tmp_path), face=[0.3, 0.1, 0.7, 0.6]) == ([], None)
    # With a sharper picture: each move gets its own clip.
    made = []

    def cut(a, b, out):
        made.append((a, b))
        open(out, "wb").close()
        return out

    moves, _ = lf.plan_youtube_zooms("v.mp4", {**zoom, "cut": cut}, graphics, [], 600_000, str(tmp_path))
    assert made == [(30000, 34000)] and os.path.isfile(tmp_path / ".zoom" / moves[0]["clip"])


def test_a_youtube_project_carries_its_zooms_and_the_editor_accepts_them():
    from clip_engine.services import longform as lf
    from clip_engine.services.manual_editor import validate_candidate
    candidate = {"id": "c1", "title": "t", "ranges": [[0, 60000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0, 0, 1, 1]]}], "captions": True,
                 "caption_preset": "clean", "video_speed": 1, "status": "ready", "caption_edits": [], "caption_suppression_ranges": []}
    project = {"candidates": [candidate]}
    zooms = [{"at_ms": 30000, "end_ms": 34000, "keys": [[30000, 0.5, 0.5, 1.8]], "max": 1.8}]
    lf.youtube_project(project, {"pip": None, "captions": "all", "zooms": zooms, "zoom_record": {"area": [0, 0, 1, 1]}}, [], 60000, None)
    assert project["zoom"] == {"area": [0, 0, 1, 1]} and project["candidates"][0]["zooms"] == zooms
    validate_candidate(project["candidates"][0], 60000)
    with pytest.raises(ValueError):
        validate_candidate({**project["candidates"][0], "zooms": [{**zooms[0], "end_ms": 90000}]}, 60000)


def test_a_card_sliding_across_the_screen_is_followed_with_gentle_pans():
    n = 80
    grids = np.zeros((n, sz.ROWS, sz.COLS), np.uint8)
    for i in range(n):
        c = 2 + i // 2
        grids[i, 15:20, c:c + 1] = 9          # its leading edge
        grids[i, 15:20, c + 6:c + 7] = 9      # and its trailing edge (one card)
    act = sz.Activity(sz.STEP_MS, 0, grids, np.zeros(n, bool), np.zeros((sz.ROWS, sz.COLS), bool))
    regions = sz.focus_regions(act)
    assert len(regions) == 1
    r = regions[0]
    # Wide over time, small at any moment: zoomed by its size at a moment, not by its whole sweep.
    assert r.box[2] > 0.5 and r.local[0] < 0.25
    moves = sz.plan_zooms(regions, [(0, 20000)], 2.2)
    assert moves and moves[0]["keys"][0][3] >= 1.4
    xs = [k[1] for k in moves[0]["keys"]]
    assert len(xs) >= 2 and all(b > a for a, b in zip(xs, xs[1:]))
