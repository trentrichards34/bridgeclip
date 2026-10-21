"""End-to-end tests only: a stand-in for Edit my recording's one paid engine call (the plan).

The e2e test runs the real engine through a wrapper Python that puts this folder first on PYTHONPATH and sets
CREATORCLIPS_FAKE_AI=1. Transcription is stood in for by the test's local OpenRouter stand-in (in the app); the
local retake analysis, every check of the plan, cutting, framing, sound and rendering are real.
"""
import os

if os.environ.get("CREATORCLIPS_FAKE_AI") == "1":
    try:
        import json
        import re

        from clip_engine.services import edit_recording

        async def chat_completion(client, payload):
            text = payload["messages"][1]["content"].split("TRANSCRIPT (data)", 1)[1]
            words = [(int(i), w) for i, w in re.findall(r"(?<![\w.])(\d+):(\S+)", text)]

            def first(word):
                return next(i for i, w in words if w == word)

            if "--- Clip 1 (" in text:
                # Combine clips: open on the screen clip's last line, play B, A, C, and a proof graphic on "$8,188".
                plan = {
                    "hooks": [{"start": first("And"), "end": first("screen."), "text": "Here is my screen", "why": "Shows the result first."}],
                    "cuts": [], "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": [], "cards": [],
                    "order": [2, 1, 3], "order_why": "The story first, then the screen as proof.",
                    "proof": [{"word": first("$8,188"), "value": "$8,188", "label": "dashboard says"}],
                }
                return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.003}

            def last(word):
                return [i for i, w in words if w == word][-1]

            plan = {
                "hooks": [
                    {"start": first("Fifteen"), "end": first("wait."), "text": "15 billion messages wait", "why": "A number that stops the scroll."},
                    {"start": last("Most"), "end": last("clients."), "text": "Most coaches lose so many clients", "why": "Names the problem."},
                ],
                "cuts": [],
                "cta": {"present": True, "start": first("Follow"), "end": first("more.")},
                "popups": [{"word": first("billion"), "text": "15 billion", "kind": "number"}],
                "sounds": [{"word": first("billion"), "sound": "pop"}],
                "cards": [{"word": first("messages"), "seconds": 2.5, "type": "stat", "title": "15 billion", "items": ["messages wait"]}],
            }
            return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.004}

        edit_recording.chat_completion = chat_completion
    except Exception:  # noqa: BLE001 - only the e2e test uses this; a broken stand-in shows up as a failing test
        pass
