"""End-to-end tests only: a stand-in for the B-roll video's one paid engine call (the plan).

The e2e test runs the real engine through a wrapper Python that puts this folder first on PYTHONPATH and sets
CREATORCLIPS_FAKE_AI=1. The stand-in picks no shots (so the engine's own matching of words to the library's
descriptions picks every one) and suggests one title card on words the voiceover says (the engine still checks them).
Everything else (slots, matching, cutting, the voiceover, captions, graphics, the editor's bake) is real.
"""
import os

if os.environ.get("CREATORCLIPS_FAKE_AI") == "1":
    try:
        import json
        import re

        from clip_engine.services import broll_video

        async def chat_completion(client, payload):
            text = payload["messages"][1]["content"].split("Slots (number | seconds | what is said):", 1)[1]
            slots = re.findall(r"^(\d+) \| ([\d.]+)-([\d.]+) \| (.*)$", text, re.M)
            # One title card: the shortest whole phrase of 4+ words after the first 2 seconds, as said.
            phrases = [(len(said.split()), float(start), said) for _, start, _end, said in slots if float(start) >= 2.0 and len(said.split()) >= 4]
            graphics = []
            if phrases:
                _, start, said = min(phrases)
                graphics.append({"template": "title", "time": start, "seconds": 2.5, "placement": "middle",
                                 "value": "", "label": "", "text": " ".join(w.strip(".,!?") for w in said.split()), "title": "", "items": [],
                                 "before": "", "after": "", "author": "", "name": "", "role": "", "accent": "", "subline": "", "final": "",
                                 "phrase": "", "icons": [], "keyword": "", "lead": ""})
            return {"choices": [{"message": {"content": json.dumps({"slots": [], "graphics": graphics})}}], "usage": {"cost": 0.002}}, {}

        broll_video.chat_completion = chat_completion
    except Exception as error:  # pragma: no cover - a broken stand-in shows in the test's own checks
        print(f"fake-ai-broll: {error}")
