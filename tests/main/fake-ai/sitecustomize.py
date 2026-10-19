"""End-to-end tests only: stand-ins for the engine's paid OpenRouter calls (transcription and the planning/writing model).

The e2e test runs the real engine through a wrapper Python that puts this folder first on PYTHONPATH and sets
CREATORCLIPS_FAKE_AI=1. Everything else (downloading, cutting, framing, rendering, captions) is real.
"""
import os

if os.environ.get("CREATORCLIPS_FAKE_AI") == "1":
    try:
        import json
        import re
        from types import SimpleNamespace

        from clip_engine.services import remix_service
        from clip_engine.services import transcription_service as ts

        def sentence(text, start, end):
            items = text.split()
            step = (end - start) / len(items)
            return [ts.TranscriptWord(w, round((start + i * step) * 1000), round((start + (i + 1) * step - 0.04) * 1000)) for i, w in enumerate(items)]

        # What is "said" in any stretch of the long video (relative to the stretch), and in a member's take.
        STRETCH = (sentence("This is the setup.", 0.5, 2.0) + sentence("Then he says fifteen billion scam ads run every day.", 2.4, 6.0)
                   + sentence("That is wild.", 6.4, 7.4) + sentence("Anyway let us move on.", 9.0, 11.0))
        TAKE = sentence("Honestly that number scared me. Here is what I do about it.", 0.3, 3.5)

        def _init(self, *args, **kwargs):
            pass

        async def transcribe_audio(self, path, **kwargs):
            name = os.path.basename(str(path))
            words = STRETCH if name.startswith("range-") else TAKE
            segment = ts.TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, " ".join(w.word for w in words), None, list(words))
            return ts.TranscriptionResult(segments=[segment], full_text=segment.text, api_costs=SimpleNamespace(estimated_cost_usd=0.001))

        ts.TranscriptionService.__init__ = _init
        ts.TranscriptionService.transcribe_audio = transcribe_audio
        written = {"count": 0}
        HEADLINES = ["He says 15 billion scam ads run every day", "Fifteen billion scam ads a day, really?"]

        async def chat_completion(client, payload):
            name = payload["response_format"]["json_schema"]["name"]
            if name == "react_broll_plan":
                # React, then my thoughts: the member's own clips, in order, over their words (from 2 s, 1.6 s each, a gap between).
                clips = json.loads(payload["messages"][1]["content"].split("THE CREATOR'S CLIPS (data)\n", 1)[1].split("\n", 1)[0])
                answer = {"shots": [{"start_seconds": 2.0 + i * 2.8, "end_seconds": 3.6 + i * 2.8, "item": c["id"], "query": "city street"} for i, c in enumerate(clips[:2])]}
                return {"choices": [{"message": {"content": json.dumps(answer)}}]}, {"cost": 0.004}
            if name == "moment_pick":
                start = float(re.search(r"THE STRETCH: ([\d.]+)s", payload["messages"][1]["content"]).group(1))
                answer = {"start_seconds": start + 2.6, "end_seconds": start + 6.2, "quote": "fifteen billion scam ads", "why": "A shocking number."}
            else:
                headline = HEADLINES[written["count"] % len(HEADLINES)]
                written["count"] += 1
                answer = {"headline": headline, "post_caption": "That number scared me.\n\n1. Check who runs the ad.\n2. Never pay from an ad.",
                          "self_check": {"invented_claims": False}}
            return {"choices": [{"message": {"content": json.dumps(answer)}}]}, {"cost": 0.01}

        remix_service.chat_completion = chat_completion
    except Exception:  # noqa: BLE001 - only the e2e test uses this; a broken stand-in shows up as a failing test
        pass
