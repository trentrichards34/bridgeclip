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
        render = remix_runner.parse_config({"mode": "render", "output_dir": os.path.abspath("out"), "angle": "mix", "host": "voice"})
        self.assertEqual(render.sources, [])
        cta = remix_runner.parse_config(self.base(cta_keyword=" sales ", cta_offer="  my   playbook "))
        self.assertEqual((cta.cta_keyword, cta.cta_offer), ("SALES", "my playbook"))

    def test_rejects_bad_values(self):
        for bad in (self.base(angle="repost"), self.base(host="clone"), self.base(count=0), self.base(count=True),
                    self.base(output_dir="relative"), self.base(avatar_photo="photo.jpg"), self.base(sources=[]), self.base(sources=["x"] * 11), self.base(sources=[5]), self.base(order="random"), self.base(mode="go"),
                    self.base(creator="x" * 500), self.base(voice=5), self.base(cta_keyword="two words"),
                    self.base(cta_keyword=5), self.base(cta_offer="x" * 500), self.base(voice="onyx"),
                    self.base(voice_model="openai/gpt-4o-mini-tts"), self.base(voice_reference="rel.mp3"), "nope"):
            with self.assertRaises(ValueError):
                remix_runner.parse_config(bad)


if __name__ == "__main__":
    unittest.main()
