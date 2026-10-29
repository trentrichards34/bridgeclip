"""Remix layouts from the "You on camera" reference reels: the choices checked, the pictures drawn, and Their clip then
me / React then my thoughts made with them (their captions left alone, the phone card, a voiceover over a screen
recording with a comment banner and circles, proof screenshots popping in)."""

import asyncio
import json
import os
import subprocess

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from clip_engine.services import remix_layouts as rl
from clip_engine.services import remix_service as remix

from .recompose_support import no_ai, recompose, spy_captions
from .test_react_templates import config, env, fake_ai, gray_frames, remixer, rgb_at  # noqa: F401 - env is a fixture

FONT = os.path.join(rl.FONTS, rl.BOLD_FONT)


# ---------------------------------------------------------------------------
# The choices
# ---------------------------------------------------------------------------

def test_layout_choices_are_checked_per_format(tmp_path):
    shot, screen = str(tmp_path / "post.png"), str(tmp_path / "screen.mov")
    assert rl.parse_layout(None, "react_thoughts") == rl.default_layout()
    made = rl.parse_layout({"part1": "phone", "hook_at": "beside", "part2": "screen", "screen": {"path": screen, "id": "s00000000", "name": "x"},
                            "banner": True, "circles": [{"at": 9, "x": 0.5, "y": 0.5}, {"at": 3, "x": 1, "y": 0}],
                            "proofs": [{"id": "p0000000a", "path": shot, "at": 4, "label": "Thread", "highlight": None}]}, "react_thoughts")
    assert made["screen"] == {"path": screen} and [c["at"] for c in made["circles"]] == [3, 9] and made["banner"] is True
    # Circles only mark a screen recording; the banner only in React, then my thoughts.
    assert rl.parse_layout({"circles": [{"at": 3, "x": 0.1, "y": 0.1}]}, "react_thoughts")["circles"] == []
    for bad, fmt in [({"hook_at": "seam"}, "react_thoughts"), ({"hook_at": "beside"}, "react_thoughts"), ({"part1": "phone"}, "clip_then_me"),
                     ({"banner": True}, "clip_then_me"), ({"part2": "screen"}, "react_thoughts"), ({"proofs": [{"id": "p0000000a", "path": shot}]}, "pause_react"),
                     ({"their_captions": "yes"}, "moment_take"), ({"proofs": [{"id": "p0000000a", "path": shot, "highlight": {"x": 0, "y": 0, "w": 0, "h": 1}}]}, "clip_then_me"),
                     ({"proofs": [{"id": "p0000000a", "path": shot, "label": 5, "bad": 1}]}, "clip_then_me")]:
        with pytest.raises(ValueError):
            rl.parse_layout(bad, fmt)
    assert rl.clean_label("  My\x00 post  that is long enough to be cut ") == "My post that is long eno"


def test_proofs_spread_evenly_or_at_their_times_one_at_a_time():
    # Six proofs on a 20 s take: evenly over 2-18.5 s, each 1.5-4 s, never two at once.
    times = rl.proof_times([{"at": None}] * 6, 20.0)
    assert len(times) == 6 and times[0][0] >= rl.PROOF_HEAD_S and times[-1][1] <= 20.0 - rl.PROOF_TAIL_S
    assert all(rl.PROOF_MIN_S - 0.01 <= b - a <= rl.PROOF_MAX_S + 0.01 for a, b in times)
    assert all(times[i][1] <= times[i + 1][0] for i in range(5)), times
    # The member's times (out of order, one too early, one too close to the next) are kept in order and in bounds.
    mine = rl.proof_times([{"at": 9.0}, {"at": 0.5}, {"at": 9.5}], 12.0)
    assert mine[1] == (rl.PROOF_HEAD_S, 6.0) and mine[1][1] < mine[0][0] < mine[0][1] < mine[2][0] < mine[2][1] == 10.5, mine
    assert all(b - a >= rl.PROOF_MIN_S - 0.01 for a, b in mine)
    # More than fit: the latest ones are left out; a take too short for any shows none.
    crowded = rl.proof_times([{"at": 3.0}] * 6, 8.0)
    assert crowded[:2] == [(3.0, 4.5), (4.6, 6.4)] and crowded.count(None) == 4
    assert rl.proof_times([{"at": None}], 2.5) == [None]


def test_caption_band_finds_burned_in_captions_not_busy_footage():
    def frame(word=None, busy=False):
        img = Image.new("RGB", (1080, 1920), (90, 110, 130))
        draw = ImageDraw.Draw(img)
        if busy:
            for x in range(0, 1080, 18):
                for y in range(0, 1920, 18):
                    draw.rectangle([x, y, x + 8, y + 8], fill=(255, 255, 255) if (x + y) % 36 else (0, 0, 0))
        draw.ellipse([300, 300, 800, 900], fill=(200, 160, 130))
        if word:
            draw.text((540, 1320), word, font=ImageFont.truetype(FONT, 96), fill=(255, 255, 255), stroke_width=8, stroke_fill=(0, 0, 0), anchor="mm")
        return np.asarray(img.convert("L").resize((270, 480)))
    assert rl.caption_band(frame("CHANGED MY")) is not None and rl.caption_band(frame("WEEK")) is not None
    assert rl.caption_band(frame()) is None and rl.caption_band(frame(busy=True)) is None
    assert rl.has_burned_captions([frame("THIS"), frame("SERUM"), frame(), frame("WORKS")])
    assert not rl.has_burned_captions([frame(), frame("ONE"), frame(), frame()])


def test_pictures_seam_box_beside_text_banner_circle_and_card(tmp_path):
    w, h = rl.seam_hook_image("$1M from less than 6,000 followers and a very long tail that has to wrap twice", str(tmp_path / "s.png"), 1080)
    seam = Image.open(tmp_path / "s.png")
    assert w <= 1080 * rl.SEAM_MAX_W + 40 and h - 36 <= 2 * rl.SEAM_HALF
    # White box, black text.
    assert seam.getpixel((w // 2, 30))[:3] == (255, 255, 255) and min(seam.convert("L").getdata()) < 40
    spot = rl.beside_spot((620, 400, 260, 300), 1080, 1920, 900)
    assert spot["x"] + spot["w"] <= 620 and spot["align"] == "right"
    left = rl.beside_spot((120, 400, 260, 300), 1080, 1920, 900)
    assert left["x"] >= 380 and left["align"] == "left"
    bw, bh = rl.beside_hook_image("How to do this....", str(tmp_path / "b.png"), spot)
    assert bh - 2 * 20 <= spot["max_h"] + 60
    rl.banner_image("FLY", str(tmp_path / "k.png"), 1080)
    rl.circle_image(str(tmp_path / "c.png"), 300, 200)
    circle = np.asarray(Image.open(tmp_path / "c.png"))
    red = (circle[..., 0] > 180) & (circle[..., 1] < 90) & (circle[..., 3] > 200)
    # A loop of red around an open middle.
    assert red.any() and not red[90:110, 140:160].any()
    card = rl.phone_card(360, 640, 1080, 1920)
    assert card["w"] <= 0.6 * 1080 + 2 and card["x"] + card["w"] == 1080 - rl.CARD_MARGIN and card["y"] + card["h"] == 1920 - rl.CARD_BOTTOM_SAFE
    assert rl.phone_card(640, 360, 1080, 1920)["w"] == 648
    proof = tmp_path / "post.png"
    Image.new("RGB", (600, 900), (200, 30, 200)).save(proof)
    placed = rl.proof_card_image(str(proof), str(tmp_path / "card.png"), 1080, 1920, "Thread", {"x": 0.5, "y": 0.5, "w": 0.25, "h": 0.1})
    cx, cy, cw, ch = placed["card"]
    assert ch <= rl.PROOF_MAX_H * 1920 + 1 and placed["highlight"] == [cx + round(0.5 * cw), cy + round(0.5 * ch), round(0.25 * cw), round(0.1 * ch)]
    assert rl.fit_rect(1920, 1080, 1080, 1920) == (0, 656, 1080, 608)
    spots = rl.circle_spots([{"at": 1, "x": 0.5, "y": 0.5}, {"at": 30, "x": 0, "y": 0}], (0, 656, 1080, 608), 1080, 1920, 10.0)
    assert len(spots) == 1 and (spots[0]["cx"], spots[0]["cy"]) == (540, 960)
    assert rl.proof_anchors([(5.0, 8.0, 1600)], 1382) == [[5000, 1382], [8000, 1600]]


# ---------------------------------------------------------------------------
# Real renders
# ---------------------------------------------------------------------------

LAYOUT_SAMPLES = os.environ.get("REMIX_LAYOUT_SAMPLES")


def frame_png(path, t, name):
    if LAYOUT_SAMPLES:
        os.makedirs(LAYOUT_SAMPLES, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", os.path.join(LAYOUT_SAMPLES, f"{name}.png")], check=True)


def captioned_reel(env):
    """Their reel with its own captions burned in: a calm picture, a moving square, white outlined words low down."""
    words = env.tmp / "words.png"
    img = Image.new("RGBA", (360, 640), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((180, 450), "THIS SERUM", font=ImageFont.truetype(FONT, 40), fill=(255, 255, 255, 255),
                             stroke_width=4, stroke_fill=(0, 0, 0, 255), anchor="mm")
    img.save(words)
    path = str(env.tmp / "captioned.mp4")
    subprocess.run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x335577:s=360x640:d=12:r=30",
                    "-f", "lavfi", "-i", "color=c=0xd0a070:s=80x80:d=12:r=30", "-i", str(words),
                    "-f", "lavfi", "-i", "sine=frequency=1000:duration=12:sample_rate=48000",
                    "-filter_complex", "[0:v][1:v]overlay=x='40+t*10':y=160[a];[a][2:v]overlay=0:0[v]", "-map", "[v]", "-map", "3:a",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path], check=True, timeout=120)
    return path


def proof_files(env):
    post, thread = str(env.tmp / "post.png"), str(env.tmp / "thread.jpg")
    Image.new("RGB", (600, 900), (200, 30, 200)).save(post)
    Image.new("RGB", (1200, 500), (30, 200, 220)).save(thread)
    return post, thread


def test_their_clip_then_me_leaves_their_captions_and_pops_in_proofs(env, monkeypatch):
    fake_ai(monkeypatch)
    reel = captioned_reel(env)
    post, thread = proof_files(env)
    layout = {"their_captions": "auto", "proofs": [{"id": "p0000000a", "path": post, "at": None, "label": "My post", "highlight": {"x": 0.1, "y": 0.4, "w": 0.5, "h": 0.1}},
                                                   {"id": "p0000000b", "path": thread, "at": 7.5, "label": "", "highlight": None}]}
    cfg = lambda: remix.RemixConfig(**{**vars(config(env, "clip_then_me", recordings={"0": {"reaction": {"path": env.take, "offset_s": 0}}},  # noqa: E731
                                                     trim=[0, 6000], source=reel)), "layout": layout, "headline_look": {"look": "none"}})
    asyncio.run(remixer(cfg(), env)[0].plan())
    seen = spy_captions(monkeypatch)
    r, _ = remixer(cfg(), env)
    [made] = asyncio.run(r.render([{"id": 0, "headline": "This serum changed her skin in a week? Not mine"}]))["remixes"]
    op = 6.0
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    # Their captions were seen (the auto check): none of ours over their clip; the member's words after the cut.
    assert data["tags"]["their_captions"] is True and data["words"][0][1] >= op * 1000 and "serum" not in seen[0][0].split(" Honestly")[0]
    manifest = json.load(open(made["manifest_path"]))
    details = manifest["presenter"]["clip_then_me"]
    assert details["their_captions"] is True and [p["label"] for p in details["proofs"]] == ["My post", ""]
    # No hook text: their clip fills the frame from the top.
    assert data["compose"]["panel_h"] == 1920
    # The proofs: the first spread over the take, the second at the member's 7.5 s; captions move under each card.
    proofs = data["tags"]["proofs"]
    assert proofs[1]["start"] == pytest.approx(op + 7.5) and proofs[0]["start"] < proofs[1]["start"]
    first = proofs[0]
    assert first["highlight"][0] > first["card"][0] and first["highlight"][2] < first["card"][2]
    assert data["tags"]["caption_anchors"][1][1] >= first["card"][1] + first["card"][3]
    x, y, w, h = first["card"]
    mid = (first["start"] + first["end"]) / 2
    magenta = rgb_at(made["path"], mid, f"40:40:{x + w // 2 - 20}:{y + 20}")
    assert magenta[0] > 150 and magenta[1] < 90 and magenta[2] > 150, magenta
    x2, y2, w2, h2 = proofs[1]["card"]
    cyan = rgb_at(made["path"], proofs[1]["start"] + 0.8, f"40:40:{x2 + w2 // 2 - 20}:{y2 + h2 // 2 - 20}")
    assert cyan[1] > 150 and cyan[2] > 150 and cyan[0] < 90, cyan
    # Before the first card: the member (no magenta).
    member = rgb_at(made["path"], op + 1.0, f"40:40:{x + w // 2 - 20}:{y + 20}")
    assert member[1] > 100, member
    frame_png(made["path"], 2.0, "clip-then-me-part1-their-captions")
    frame_png(made["path"], mid, "clip-then-me-proof-card")
    # The member said "No captions": theirs are captioned again.
    layout["their_captions"] = "no"
    asyncio.run(remixer(cfg(), env)[0].plan())
    again = asyncio.run(remixer(cfg(), env)[0].render([{"id": 0, "headline": "This serum changed her skin in a week? Not mine"}]))["remixes"][0]
    stem = os.path.splitext(os.path.basename(again["path"]))[0]
    assert json.load(open(os.path.join(env.out, ".edit", stem, "edit.json")))["words"][0][0] == "This"


def screen_recording(env):
    path = str(env.tmp / "screen.mp4")
    subprocess.run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xf0f0f0:s=640x360:d=6:r=30",
                    "-vf", "drawbox=x=40:y=40:w=200:h=60:color=0x2050d0:t=fill", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
                   check=True, timeout=120)
    return path


def test_react_phone_card_then_voiceover_over_a_screen_recording(env, monkeypatch):
    fake_ai(monkeypatch)
    screen = screen_recording(env)
    post, _ = proof_files(env)
    layout = {"their_captions": "no", "part1": "phone", "hook_at": "beside", "part2": "screen", "screen": {"path": screen}, "banner": True,
              "circles": [{"at": 4.0, "x": 0.22, "y": 0.2}],
              "proofs": [{"id": "p0000000a", "path": post, "at": 8.0, "label": "Thread", "highlight": None}]}
    recordings = {"0": {"reaction": {"path": env.watch, "offset_s": 1.0}, "thoughts": {"path": env.take, "offset_s": 0}}}
    # The member's face high on the right of part 1: the hook text goes on the open left side, beside it.
    face = (600, 330, 300, 360)
    monkeypatch.setattr(remix.Remixer, "_part1_face", staticmethod(lambda cam, bar_h, panel_h: face))
    cfg = lambda: remix.RemixConfig(**{**vars(config(env, "react_thoughts", recordings=recordings, trim=[2000, 8000])), "layout": layout,  # noqa: E731
                                       "broll_plan": []})
    asyncio.run(remixer(cfg(), env)[0].plan())
    r, _ = remixer(cfg(), env)
    [made] = asyncio.run(r.render([{"id": 0, "headline": "How to do this"}]))["remixes"]
    op = 6.0
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    tags = data["tags"]
    # Phone card: the member fills the frame (no bar), their clip (moving) in a rounded card in the lower right.
    assert data["compose"]["panel_h"] == 1920 and tags["part1"]["at"] == "phone"
    x, y, w, h = tags["part1"]["box"]
    assert x + w == 1080 - rl.CARD_MARGIN and w <= 650 and y + h == 1920 - rl.CARD_BOTTOM_SAFE
    panel = os.path.join(env.out, ".edit", "clip_00", "panel.mp4")
    inside = gray_frames(panel, crop=f"{w // 2}:{h // 2}:{x + w // 4}:{y + h // 4}")[: round(op * 30) - 2]
    behind = gray_frames(panel, crop="200:200:40:200")[: round(op * 30) - 2]
    assert np.median(np.abs(np.diff(inside, axis=0)).mean(axis=(1, 2))) > 0.5
    assert np.abs(np.diff(behind, axis=0)).mean(axis=(1, 2)).max() < 0.5
    # The card's corner is rounded (the member shows through) and the hook text sits beside the head, only in part 1.
    corner = rgb_at(made["path"], 1.0, f"6:6:{x + 2}:{y + 2}")
    assert abs(corner[2] - 0x70) < 40, corner
    assert tags["hook"]["at"] == "beside" and tags["hook"]["window"] == [0.0, op]
    spot = tags["hook"]["spot"]
    assert spot["x"] + spot["w"] <= face[0] and spot["y"] <= face[1] + face[3] // 2 and spot["y"] + spot["max_h"] <= y
    hook_px = np.asarray(Image.open(_frame(made["path"], 1.0, env)).convert("L")).astype(int)[spot["y"]:spot["y"] + 120, spot["x"]:spot["x"] + spot["w"]]
    assert (hook_px > 235).mean() > 0.03
    after = np.asarray(Image.open(_frame(made["path"], op + 1.5, env)).convert("L")).astype(int)[spot["y"]:spot["y"] + 120, spot["x"]:spot["x"] + spot["w"]]
    assert (after > 235).mean() < (hook_px > 235).mean() / 3, "the hook text shows in part 1 only"
    # Part 2: the screen recording fitted whole (white with a blue bar) over a blurred copy; the banner at the top; the
    # red circle at 4 s where it was marked; the proof card at 8 s; the end tag isn't repeated (the banner says it).
    rect = rl.fit_rect(640, 360, 1080, 1920)
    white = rgb_at(made["path"], op + 2.0, f"40:40:{rect[0] + 700}:{rect[1] + 300}")
    assert min(white) > 200, white
    blue = rgb_at(made["path"], op + 2.0, f"20:20:{rect[0] + 120}:{rect[1] + 120}")
    assert blue[2] > 150 and blue[0] < 90, blue
    assert tags["cta_window"] is None
    spot = rl.circle_spots(layout["circles"], rect, 1080, 1920, 12.0)[0]
    ring = np.asarray(Image.open(_frame(made["path"], op + 4.6, env)).convert("RGB")).astype(int)
    band = ring[spot["cy"] - spot["h"] // 2:spot["cy"] + spot["h"] // 2, spot["cx"] - spot["w"] // 2:spot["cx"] + spot["w"] // 2]
    assert ((band[..., 0] > 180) & (band[..., 1] < 90)).sum() > 300
    before = np.asarray(Image.open(_frame(made["path"], op + 2.0, env)).convert("RGB")).astype(int)[spot["cy"] - spot["h"] // 2:spot["cy"] + spot["h"] // 2,
                                                                                                     spot["cx"] - spot["w"] // 2:spot["cx"] + spot["w"] // 2]
    assert ((before[..., 0] > 180) & (before[..., 1] < 90)).sum() < 30
    top = np.asarray(Image.open(_frame(made["path"], op + 2.0, env)).convert("L"))[100:260, 200:880]
    assert (top > 240).mean() > 0.05
    [proof] = tags["proofs"]
    assert proof["start"] == pytest.approx(op + 8.0) and proof["label"] == "Thread"
    manifest = json.load(open(made["manifest_path"]))["presenter"]["react_thoughts"]
    assert (manifest["part1"], manifest["part2"], manifest["comment_banner"], manifest["circles"]) == ("phone", "screen", True, 1)
    for t, name in ((1.5, "react-phone-card"), (op + 2.0, "react-screen-banner"), (op + 4.6, "react-screen-circle"), (op + 8.6, "react-screen-proof")):
        frame_png(made["path"], t, name)
    # Edit hook text & captions: the hook stays beside the head (no bar), made from the kept parts.
    no_ai(monkeypatch)
    edited = recompose(env.out, headline="How I made this in two minutes")
    assert abs(edited["duration_seconds"] - (op + 12.0)) < 0.2
    frame_png(edited["path"], 1.5, "react-phone-card-edited")


def test_screen_recording_missing_is_refused(env):
    with pytest.raises(remix.RemixError, match="screen recording"):
        remixer(remix.RemixConfig(**{**vars(config(env, "react_thoughts")), "layout": {"part2": "screen"}}), env)


def _frame(path, t, env):
    out = str(env.tmp / f"f-{t:.2f}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", out], check=True, timeout=60)
    return out
