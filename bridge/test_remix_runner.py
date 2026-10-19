import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))

import remix_runner  # noqa: E402


class ParseConfigTests(unittest.TestCase):
    def base(self, **over):
        config = {"sources": ["https://youtube.com/watch?v=x"], "output_dir": os.path.abspath("out"), "angle": "reaction",
                  "host": "voice", "count": 2}
        config.update(over)
        return config

    def test_valid_request(self):
        config = remix_runner.parse_config(self.base(voice="sarah", brand_identity="We believe..."))
        self.assertEqual((config.angle, config.count, config.voice, config.host, config.order), ("reaction", 2, "sarah", "voice", "moment_first"))
        clone = remix_runner.parse_config(self.base(voice_model="fish-audio/s2.1-pro", voice_reference=os.path.abspath("v.mp3"), voice_transcript="hi"))
        self.assertEqual((clone.voice_model, clone.voice_transcript), ("fish-audio/s2.1-pro", "hi"))
        silent = remix_runner.parse_config(self.base(format="silent", reactions={"nod": os.path.abspath("nod.mp4")}, reactions_ai=False))
        self.assertEqual((silent.format, silent.reactions, silent.reactions_ai), ("silent", {"nod": os.path.abspath("nod.mp4")}, False))
        render = remix_runner.parse_config({"mode": "render", "output_dir": os.path.abspath("out"), "angle": "mix", "host": "voice"})
        self.assertEqual(render.sources, [])
        cta = remix_runner.parse_config(self.base(cta_keyword=" sales ", cta_offer="  my   playbook "))
        self.assertEqual((cta.cta_keyword, cta.cta_offer), ("SALES", "my playbook"))
        self.assertIsNone(cta.headline_look)
        self.assertFalse(cta.cta_clip)
        self.assertTrue(remix_runner.parse_config(self.base(cta_clip=True)).cta_clip)
        look = remix_runner.parse_config(self.base(headline_look={"look": "brand", "color": "#ff8800", "font": "serif"}))
        self.assertEqual(look.headline_look, {"look": "brand", "color": "#FF8800", "font": "serif"})

    def test_rejects_bad_values(self):
        for bad in (self.base(angle="repost"), self.base(host="clone"), self.base(count=0), self.base(count=True),
                    self.base(output_dir="relative"), self.base(avatar_photo="photo.jpg"), self.base(sources=[]), self.base(sources=["x"] * 11), self.base(sources=[5]), self.base(order="random"), self.base(mode="go"),
                    self.base(creator="x" * 500), self.base(voice=5), self.base(cta_keyword="two words"),
                    self.base(cta_keyword=5), self.base(cta_offer="x" * 500), self.base(voice="onyx"),
                    self.base(voice_model="openai/gpt-4o-mini-tts"), self.base(voice_reference="rel.mp3"), self.base(format="dance"),
                    self.base(format="silent", reactions={"wave": "/x.mp4"}), self.base(format="silent", reactions={"nod": "rel.mp4"}),
                    self.base(headline_look={"look": "neon"}), self.base(headline_look={"color": "red"}), self.base(headline_look="white"), "nope"):
            with self.assertRaises(ValueError):
                remix_runner.parse_config(bad)

    def test_camera_keys(self):
        me = os.path.abspath("me.webm")
        plain = remix_runner.parse_config(self.base(host="camera"))
        self.assertEqual((plain.host, plain.camera_layout, plain.camera_backdrop, plain.camera_backdrop_color, plain.camera_talk, plain.recordings),
                         ("camera", "filmed", "blur", "#111111", False, {}))
        silent = remix_runner.parse_config(self.base(
            host="camera", format="silent", mode="render", camera_layout="cutout", camera_backdrop="brand", camera_backdrop_color="#ff8800",
            camera_talk=True, recordings={"0": {"reaction": {"path": me, "offset_s": 2}}, "3": {"reaction": {"path": me, "offset_s": None}},
                                          "4": {"reaction": {"path": me}}}))
        self.assertEqual((silent.camera_layout, silent.camera_backdrop, silent.camera_backdrop_color, silent.camera_talk),
                         ("cutout", "brand", "#FF8800", True))
        self.assertEqual(silent.recordings, {"0": {"reaction": {"path": me, "offset_s": 2.0}}, "3": {"reaction": {"path": me, "offset_s": None}},
                                             "4": {"reaction": {"path": me, "offset_s": None}}})
        take = {"intro": me, "beats": [me, me], "close": me}
        voiced = remix_runner.parse_config(self.base(host="camera", camera_layout="greenscreen", recordings={"1": take}))
        self.assertEqual((voiced.camera_layout, voiced.recordings), ("greenscreen", {"1": take}))
        self.assertEqual(remix_runner.parse_config(self.base(host="camera", camera_talk=None)).camera_talk, False)

    def image(self, **over):
        me = os.path.abspath("me.webm")
        config = {"mode": "write", "output_dir": os.path.abspath("out"), "host": "camera", "format": "image", "sources": [],
                  "image_source": {"path": os.path.abspath("out/.work/source.png"), "credit": "  The Wall  Street Journal "},
                  "camera_talk": True, "recordings": {"0": {"reaction": {"path": me, "offset_s": 0}}}}
        config.update(over)
        return config

    def test_image_keys(self):
        written = remix_runner.parse_config(self.image())
        self.assertEqual((written.format, written.host, written.camera_layout, written.angle, written.sources, written.camera_talk),
                         ("image", "camera", "greenscreen", "reaction", [], True))
        self.assertEqual(written.image_source, {"path": os.path.abspath("out/.work/source.png"), "credit": "The Wall Street Journal"})
        self.assertEqual(written.recordings["0"]["reaction"]["offset_s"], 0.0)
        render = remix_runner.parse_config(self.image(mode="render", camera_layout="cutout", image_source={"path": os.path.abspath("x.WEBP")}))
        self.assertEqual((render.camera_layout, render.image_source["credit"]), ("cutout", ""))

    def test_rejects_bad_image_values(self):
        me = os.path.abspath("me.webm")
        bads = [
            self.image(mode="plan"), self.image(host="voice"), self.image(image_source=None), self.image(image_source="x.png"),
            self.image(image_source={"path": "rel.png"}), self.image(image_source={"path": os.path.abspath("x.gif")}),
            self.image(image_source={"path": os.path.abspath("x.png"), "credit": 5}),
            self.image(image_source={"path": os.path.abspath("x.png"), "credit": "x" * 121}),
            self.image(image_source={"path": os.path.abspath("x.png"), "url": "https://x"}),
            self.image(recordings={"0": {"intro": me, "beats": [], "close": me}}),
            self.image(recordings={"0": {"reaction": {"path": "rel.webm"}}}),
            self.base(mode="write"),  # write is only for an article or post
            self.base(image_source={"path": os.path.abspath("x.png")}),  # an image only goes with format image
        ]
        for bad in bads:
            with self.assertRaises(ValueError, msg=repr(bad)[:160]):
                remix_runner.parse_config(bad)

    def recompose(self, **over):
        root = os.path.abspath("out")
        config = {"mode": "recompose", "output_dir": root, "clip": "clip_00", "output_path": os.path.join(root, "clip_00-edit-1.mp4"),
                  "headline": "  This creator   says reels make no sales ", "headline_look": {"look": "none"}, "include_captions": False,
                  "caption_preset": "neon", "split": 0.55}
        config.update(over)
        return config

    def test_recompose_keys(self):
        request = remix_runner.parse_config(self.recompose())
        self.assertEqual((request.clip, request.headline, request.include_captions, request.caption_preset, request.split),
                         ("clip_00", "This creator says reels make no sales", False, "neon", 0.55))
        self.assertEqual(request.headline_look, {"look": "none", "color": "#FFFFFF", "font": "clean"})
        plain = remix_runner.parse_config(self.recompose(split=None, headline_look=None, caption_preset=None, include_captions=True))
        self.assertEqual((plain.split, plain.headline_look, plain.caption_preset, plain.include_captions), (None, None, "pop", True))
        self.assertEqual(remix_runner.parse_config(self.recompose(split=0.3, clip="clip_0123")).split, 0.3)
        self.assertEqual(remix_runner.parse_config(self.recompose(split=1 - 0.3)).split, 0.7)
        self.assertEqual(remix_runner.parse_config(self.recompose(final_name="clip_03.mp4")).final_name, "clip_03.mp4")
        self.assertIsNone(remix_runner.parse_config(self.recompose()).final_name)
        for bad in ("x.mp4", "../clip_00.mp4", "clip_00.mov", "clip_0.mp4", 5, ""):
            with self.assertRaises(ValueError):
                remix_runner.parse_config(self.recompose(final_name=bad))

    def test_rejects_bad_recompose_values(self):
        root = os.path.abspath("out")
        bads = [
            self.recompose(output_dir="out"), self.recompose(output_path="clip.mp4"), self.recompose(output_path=os.path.join(root, "x.mov")),
            self.recompose(output_path=os.path.join(root, ".edit", "clip_00", "x.mp4")), self.recompose(output_path=os.path.abspath("other/x.mp4")),
            self.recompose(output_path=os.path.join(root, "x\0.mp4")), self.recompose(clip="clip_0"), self.recompose(clip="../clip_00"),
            self.recompose(clip=None), self.recompose(headline=""), self.recompose(headline="   "), self.recompose(headline=5),
            self.recompose(headline="x" * 301), self.recompose(headline_look={"look": "neon"}), self.recompose(include_captions="yes"),
            self.recompose(caption_preset="comic"), self.recompose(caption_preset=5), self.recompose(split=0.29), self.recompose(split=0.71),
            self.recompose(split=True), self.recompose(split="0.5"), self.recompose(split=float("nan")),
        ]
        for bad in bads:
            with self.assertRaises(ValueError, msg=repr(bad)[:160]):
                remix_runner.parse_config(bad)

    def test_rejects_bad_camera_values(self):
        me = os.path.abspath("me.webm")
        take = {"intro": me, "beats": [], "close": me}
        reaction = {"reaction": {"path": me, "offset_s": 1.0}}
        bads = [
            dict(camera_layout="hologram"), dict(camera_layout=5), dict(camera_backdrop="beach"), dict(camera_backdrop_color="red"),
            dict(camera_backdrop_color="#12345"), dict(camera_backdrop_color="#1234567"), dict(camera_talk="yes"), dict(camera_talk=1),
            dict(recordings=[take]), dict(recordings={"x": take}), dict(recordings={0: take}), dict(recordings={"1": "path"}),
            dict(recordings={"1": dict(take, intro="rel.webm")}), dict(recordings={"1": dict(take, close=None)}),
            dict(recordings={"1": dict(take, beats=["rel.mp4"])}), dict(recordings={"1": dict(take, beats=[me] * 5)}),
            dict(recordings={"1": dict(take, beats=me)}), dict(recordings={"1": {"intro": me, "close": me}}),
            dict(recordings={"1": dict(take, intro=me + "\0x")}), dict(recordings={"1": dict(take, extra=me)}),
            dict(recordings={"1": reaction}),  # a reaction for a voiced take
            dict(format="silent", recordings={"1": take}),  # a voiced take's recordings for Silent react
            dict(format="silent", recordings={"1": {"reaction": {"path": "rel.webm"}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "offset_s": -1}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "offset_s": True}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "offset_s": "2"}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "offset_s": float("nan")}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "offset_s": 99999}}}),
            dict(format="silent", recordings={"1": {"reaction": {"path": me, "volume": 1}}}),
            dict(format="silent", recordings={"1": {"reaction": me}}),
            dict(format="silent", recordings={str(i): reaction for i in range(201)}),
        ]
        for over in bads:
            with self.assertRaises(ValueError, msg=repr(over)[:120]):
                remix_runner.parse_config(self.base(host="camera", **over))

    def pause(self, **over):
        me = os.path.abspath("me.webm")
        timeline = {"start": 0.0, "end": 6.0, "trim_start": 2.0, "trim_end": 20.0, "source": "app",
                    "segments": [{"start": 0.0, "end": 2.0, "kind": "play", "at": 2.0}, {"start": 2.0, "end": 6.0, "kind": "pause", "at": 4.0}]}
        config = {"mode": "render", "output_dir": os.path.abspath("out"), "host": "camera", "format": "pause_react", "sources": [],
                  "pause_layout": "split", "pause_captions": "both", "camera_layout": "cutout",
                  "recordings": {"0": {"reaction": {"path": me, "offset_s": 0}, "timeline": timeline}}}
        config.update(over)
        return config

    def test_pause_react_keys(self):
        made = remix_runner.parse_config(self.pause())
        self.assertEqual((made.format, made.host, made.angle, made.pause_layout, made.pause_captions, made.camera_layout),
                         ("pause_react", "camera", "reaction", "split", "both", "cutout"))
        self.assertEqual(made.recordings["0"]["reaction"], {"path": os.path.abspath("me.webm"), "offset_s": 0.0})
        self.assertEqual(made.recordings["0"]["timeline"]["segments"][1]["kind"], "pause")
        plan = remix_runner.parse_config(self.pause(mode="plan", sources=[os.path.abspath("clip.mp4")], recordings=None,
                                                    pause_layout=None, pause_captions=None))
        self.assertEqual((plan.pause_layout, plan.pause_captions, plan.recordings), ("box", "member", {}))
        self.assertEqual(remix_runner.parse_config(self.pause(mode="write")).format, "pause_react")
        pauses = remix_runner.parse_config({"mode": "pauses", "recording": os.path.abspath("phone.mov"), "source": os.path.abspath("clip.mp4"),
                                            "trim_start": 0, "trim_end": 12.5})
        self.assertEqual(pauses, {"recording": os.path.abspath("phone.mov"), "source": os.path.abspath("clip.mp4"), "trim_start": 0.0, "trim_end": 12.5})

    def test_rejects_bad_pause_react_values(self):
        me = os.path.abspath("me.webm")
        good = self.pause()["recordings"]["0"]
        gap = dict(good["timeline"], segments=[{"start": 0.0, "end": 2.0, "kind": "play", "at": 2.0}, {"start": 3.0, "end": 6.0, "kind": "pause", "at": 4.0}])
        bads = [
            self.pause(host="voice"), self.pause(pause_layout="side"), self.pause(pause_captions="theirs"), self.pause(pause_layout=5),
            self.pause(mode="plan", sources=[]), self.pause(mode="plan", sources=[os.path.abspath("a.mp4"), os.path.abspath("b.mp4")]),
            self.pause(recordings={"0": {"reaction": {"path": me}}}),
            self.pause(recordings={"0": dict(good, timeline=gap)}),
            self.pause(recordings={"0": dict(good, timeline=dict(good["timeline"], end=400.0))}),
            self.pause(recordings={"0": dict(good, reaction={"path": "rel.webm"})}),
            self.pause(recordings={"0": dict(good, reaction={"path": me, "offset_s": 3})}),
            self.pause(recordings={"0": dict(good, extra=1)}),
            {"mode": "pauses", "recording": "rel.mov", "source": os.path.abspath("clip.mp4"), "trim_start": 0, "trim_end": 5},
            {"mode": "pauses", "recording": me, "source": os.path.abspath("clip.mp4"), "trim_start": 3, "trim_end": 3.2},
            {"mode": "pauses", "recording": me, "source": os.path.abspath("clip.mp4"), "trim_start": True, "trim_end": 5},
            {"mode": "pauses", "recording": me, "source": os.path.abspath("clip.mp4"), "trim_start": 0, "trim_end": 5, "output_dir": "/x"},
        ]
        for bad in bads:
            with self.assertRaises(ValueError, msg=repr(bad)[:160]):
                remix_runner.parse_config(bad)

    def moment(self, **over):
        config = {"mode": "plan", "output_dir": os.path.abspath("out"), "host": "camera", "format": "moment_take",
                  "sources": ["https://www.youtube.com/watch?v=pod"], "moment_ranges": [[2220, 2520], [60, 90]], "moment_pip": True,
                  "camera_layout": "cutout"}
        config.update(over)
        return config

    def test_moment_take_keys(self):
        made = remix_runner.parse_config(self.moment())
        self.assertEqual((made.format, made.angle, made.moment_ranges, made.moment_pip, made.camera_layout),
                         ("moment_take", "reaction", [[2220.0, 2520.0], [60.0, 90.0]], True, "cutout"))
        me = os.path.abspath("me.webm")
        render = remix_runner.parse_config(self.moment(mode="render", sources=[], moment_ranges=None,
                                                       recordings={"0": {"reaction": {"path": me, "offset_s": 0}}, "1": {"reaction": {"path": me}}}))
        self.assertEqual(render.recordings["0"], {"reaction": {"path": me, "offset_s": 0.0}})
        self.assertEqual(render.moment_ranges, [])
        written = remix_runner.parse_config(self.moment(mode="write", sources=[], moment_ranges=None, write_ids=[0, 2]))
        self.assertEqual(written.write_ids, [0, 2])
        another = remix_runner.parse_config({"mode": "moment", "output_dir": os.path.abspath("out"), "draft_id": 1})
        self.assertEqual((another["draft_id"], another["config"].format), (1, "moment_take"))

    def test_rejects_bad_moment_take_values(self):
        bads = [
            self.moment(host="voice"), self.moment(moment_ranges=[]), self.moment(moment_ranges=[[0, 5]]), self.moment(moment_ranges=[[0, 20]] * 4),
            self.moment(moment_ranges=[[30, 20]]), self.moment(moment_ranges=[["0", 20]]), self.moment(moment_pip="yes"),
            self.moment(sources=["https://a.example/x", "https://b.example/y"]), self.moment(write_ids=[5]), self.moment(write_ids="0"),
            self.base(moment_ranges=[[0, 20]]), self.base(write_ids=[0]),
            self.moment(mode="render", recordings={"0": {"reaction": {"path": "rel.webm"}}}),
            {"mode": "moment", "output_dir": "out", "draft_id": 0}, {"mode": "moment", "output_dir": os.path.abspath("out"), "draft_id": 3},
            {"mode": "moment", "output_dir": os.path.abspath("out"), "draft_id": True},
            {"mode": "moment", "output_dir": os.path.abspath("out"), "draft_id": 0, "exclude": []},
        ]
        for bad in bads:
            with self.assertRaises(ValueError, msg=repr(bad)[:160]):
                remix_runner.parse_config(bad)

    def clip(self, fmt="react_thoughts", **over):
        config = {"mode": "plan", "output_dir": os.path.abspath("out"), "host": "camera", "format": fmt,
                  "sources": ["https://www.instagram.com/reel/abc"], "camera_layout": "filmed"}
        config.update(over)
        return config

    def test_clip_templates_keys(self):
        made = remix_runner.parse_config(self.clip("clip_then_me"))
        self.assertEqual((made.format, made.angle, made.clip_trim, made.broll_items, made.broll_plan), ("clip_then_me", "reaction", None, [], None))
        me, you, car = os.path.abspath("me.webm"), os.path.abspath("you.mp4"), os.path.abspath("car.mp4")
        items = [{"id": "b0000000a", "path": car, "kind": "video", "name": "car.mp4"}]
        plan = [{"start": 2, "end": 3.5, "item": "b0000000a", "query": "red car", "words": "the car"}, {"start": 5, "end": 7, "item": None, "query": "sea"}]
        render = remix_runner.parse_config(self.clip(mode="render", sources=[], clip_trim=[5000, 20000], broll_items=items, broll_stock=True, broll_plan=plan,
                                                     recordings={"0": {"reaction": {"path": me, "offset_s": 1.25}, "thoughts": {"path": you, "offset_s": 0}}}))
        self.assertEqual(render.recordings["0"], {"reaction": {"path": me, "offset_s": 1.25}, "thoughts": {"path": you, "offset_s": 0.0}})
        self.assertEqual((render.clip_trim, render.broll_stock, [s["item"] for s in render.broll_plan]), ([5000, 20000], True, ["b0000000a", None]))
        # A phone video of you watching: lined up by sound in the engine (no offset).
        phone = remix_runner.parse_config(self.clip(mode="write", sources=[], recordings={"0": {"reaction": {"path": me}, "thoughts": {"path": you}}}))
        self.assertEqual(phone.recordings["0"]["reaction"]["offset_s"], None)
        replan = remix_runner.parse_config(self.clip(mode="broll", sources=[], broll_items=items, broll_stock=False))
        self.assertEqual((replan.format, replan.broll_items[0]["id"]), ("react_thoughts", "b0000000a"))
        taken = remix_runner.parse_config(self.clip("clip_then_me", mode="render", sources=[], clip_trim=[0, 9000], recordings={"0": {"reaction": {"path": me, "offset_s": 0}}}))
        self.assertEqual(taken.recordings["0"], {"reaction": {"path": me, "offset_s": 0.0}})

    def test_rejects_bad_clip_template_values(self):
        me, car = os.path.abspath("me.webm"), os.path.abspath("car.mp4")
        item = {"id": "b0000000a", "path": car, "kind": "video"}
        bads = [
            self.clip(host="still"), self.clip(sources=["https://a.example/x", "https://b.example/y"]),
            self.clip(clip_trim=[0, 500]), self.clip(clip_trim=[0, 181000]), self.clip(clip_trim=[0.5, 5000]), self.clip(clip_trim=[0, 5000, 9]),
            self.clip(broll_items=[dict(item, path="rel.mp4")]), self.clip(broll_items=[dict(item, id="../x")]), self.clip(broll_items=[dict(item, kind="audio")]),
            self.clip(broll_items=[item, item]), self.clip(broll_stock="yes"),
            self.clip(broll_items=[item], broll_plan=[{"start": 2, "end": 4, "item": "b0000000b", "query": ""}]),
            self.clip(broll_plan=[{"start": True, "end": 4, "item": None, "query": ""}]), self.clip(broll_plan=[{"start": 2, "end": 400, "item": None, "query": "x"}]),
            self.clip("clip_then_me", broll_items=[item]), self.clip("clip_then_me", mode="broll", sources=[]), self.base(clip_trim=[0, 5000]),
            self.clip(mode="render", recordings={"0": {"reaction": {"path": me}}}),
            self.clip(mode="render", recordings={"0": {"reaction": {"path": me}, "thoughts": {"path": me, "offset_s": 2}}}),
            self.clip(mode="render", recordings={"0": {"reaction": {"path": me, "offset_s": -1}, "thoughts": {"path": me}}}),
        ]
        for bad in bads:
            with self.assertRaises(ValueError, msg=repr(bad)[:160]):
                remix_runner.parse_config(bad)


if __name__ == "__main__":
    unittest.main()


class FailureMessageTest(unittest.TestCase):
    def test_social_failures_have_plain_messages(self):
        from bridge_runner import describe_failure
        for text, words in (("Social login required: Instagram only shares this video with a logged-in viewer", "logged-in viewer"),
                            ("Social login unreadable: CreatorClips could not read your browser's Instagram login", "couldn’t read your browser"),
                            ("Social post has no video: this Instagram post is a photo", "no video"),
                            ("Social link not supported: this kind of Facebook link isn't supported.", "link isn’t supported"),
                            ("Social link not supported: Instagram stories aren't supported.", "stories aren’t supported")):
            self.assertIn(words, describe_failure(Exception(text))["message"])

    def test_unknown_failures_never_show_paths_links_or_keys(self):
        import io
        from contextlib import redirect_stdout
        from unittest.mock import patch
        out = io.StringIO()
        raw = {"mode": "plan", "output_dir": os.path.abspath("out"), "angle": "mix", "host": "voice", "sources": ["https://a.example/v"]}
        boom = RuntimeError("Weird failure at C:\\Users\\trent\\x.mp4 and /private/var/folders/x/y.mp4 via https://bucket.s3.amazonaws.com/v.mp4?X-Amz-Signature=abc")
        sent = []
        with patch("sys.stdin", io.StringIO(__import__("json").dumps(raw))), patch.object(remix_runner, "parse_config", side_effect=boom), \
                patch.object(remix_runner, "reserve_stdout_for_protocol", lambda: None), patch.object(remix_runner, "emit", sent.append), redirect_stdout(out):
            remix_runner.main()
        line = __import__("json").dumps(sent[-1])
        for leak in ("trent", "/private/var", "amazonaws", "Signature"):
            self.assertNotIn(leak, line)
        self.assertIn("The remix could not be made: Weird failure", line)
        self.assertFalse(sent[-1]["ok"])


class RecomposeMainTest(unittest.TestCase):
    def test_main_runs_recompose(self):
        import io
        import json
        from unittest.mock import patch
        from clip_engine.services import remix_service
        root = os.path.abspath("out")
        raw = {"mode": "recompose", "output_dir": root, "clip": "clip_00", "output_path": os.path.join(root, "clip_00-edit.mp4"),
               "headline": "This creator says reels make no sales", "include_captions": True, "caption_preset": "pop", "split": None}
        seen, sent = [], []

        async def fake(request, progress):
            seen.append(request)
            return {"path": request.output_path, "duration_seconds": 4.0, "settings": {"headline": request.headline}, "editable": None}
        with patch("sys.stdin", io.StringIO(json.dumps(raw))), patch.object(remix_service, "recompose", fake), \
                patch.object(remix_runner, "reserve_stdout_for_protocol", lambda: None), patch.object(remix_runner, "emit", sent.append), \
                patch("network_guard.install", lambda: None):
            self.assertEqual(remix_runner.main(), 0)
        self.assertEqual(seen[0].clip, "clip_00")
        self.assertEqual(sent[-1], {"ok": True, "path": os.path.join(root, "clip_00-edit.mp4"), "duration_seconds": 4.0,
                                    "settings": {"headline": "This creator says reels make no sales"}, "editable": None})


class PaidFailureTest(unittest.TestCase):
    """A run that paid for calls and then failed still says what it cost, so the spending ledger gets it."""

    def run_main(self, mode, fail_with, cost, media_cost=0.0):
        import io
        import json
        from unittest.mock import patch
        from clip_engine.services import remix_service

        class FakeRemixer:
            def __init__(self, config, progress):
                self.cost_usd = 0.0
                self.media = type("Media", (), {"cost_usd": 0.0})()

            async def fail(self, *args):
                self.cost_usd += cost
                self.media.cost_usd += media_cost
                raise fail_with

            pick_another = plan = write = render = fail
        raw = {"mode": mode, "output_dir": os.path.abspath("out"), "approved": []}
        parsed = {"config": None, "draft_id": 0} if mode == "moment" else None
        sent = []
        with patch("sys.stdin", io.StringIO(json.dumps(raw))), patch.object(remix_runner, "parse_config", return_value=parsed), \
                patch.object(remix_service, "Remixer", FakeRemixer), patch("network_guard.install", lambda: None), \
                patch.object(remix_runner, "reserve_stdout_for_protocol", lambda: None), patch.object(remix_runner, "emit", sent.append):
            self.assertEqual(remix_runner.main(), 1)
        return sent[-1]

    def test_another_moment_that_found_nothing_reports_its_cost(self):
        from clip_engine.services.remix_service import RemixError
        line = self.run_main("moment", RemixError("Range 1 (0:05–0:35): no other moment stood out in it."), 0.04)
        self.assertEqual(line, {"ok": False, "error": "Range 1 (0:05–0:35): no other moment stood out in it.", "cost_usd": 0.04})

    def test_failed_plan_write_and_render_report_their_cost(self):
        from clip_engine.services.remix_service import RemixError
        self.assertEqual(self.run_main("plan", RemixError("OpenRouter reports insufficient credits."), 0.021)["cost_usd"], 0.021)
        self.assertEqual(self.run_main("write", RemixError("the hook text and caption couldn't be written"), 0.01)["cost_usd"], 0.01)
        self.assertEqual(self.run_main("render", RuntimeError("ffmpeg failed"), 0.0, media_cost=0.3)["cost_usd"], 0.3)

    def test_nothing_paid_means_no_cost_on_the_line(self):
        from clip_engine.services.remix_service import RemixError
        self.assertNotIn("cost_usd", self.run_main("moment", RemixError("That moment is no longer in this review."), 0.0))
