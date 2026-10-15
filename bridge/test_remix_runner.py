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


if __name__ == "__main__":
    unittest.main()


class FailureMessageTest(unittest.TestCase):
    def test_social_failures_have_plain_messages(self):
        from bridge_runner import describe_failure
        for text, words in (("Social login required: Instagram only shares this video with a logged-in viewer", "logged-in viewer"),
                            ("Social login unreadable: CreatorClips could not read your browser's Instagram login", "couldn’t read your browser"),
                            ("Social post has no video: this Instagram post is a photo", "no video")):
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
