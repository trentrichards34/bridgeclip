"""End-to-end tests only: stand-ins for a Create run's two paid calls (transcription and the clip planner).

The e2e test runs the real engine through a wrapper Python that puts this folder first on PYTHONPATH and sets
CREATORCLIPS_FAKE_AI=1. Everything else (reading the video, framing, cutting, captions, rendering, the motion
graphics checks and the overlay) is real. The planner answers like a model would: one clip, and when the run
asks for motion graphics (the MOTION GRAPHICS rule and schema), a stat and a list taken from what is said,
plus one card with a number nobody said, which the engine must drop.
"""
import os

if os.environ.get("CREATORCLIPS_FAKE_AI") == "1":
    try:
        import json

        from clip_engine.services import intelligence_planner as planner
        from clip_engine.services import transcription_service as ts

        STEP = 0.35
        LINES = [
            (0.5, "Hi there, welcome back."),
            (2.0, "Today I want to share real numbers."),
            (4.0, "We made fifteen thousand dollars in one month from short clips."),
            (8.5, "Here is how we did it."),
            (10.5, "Three steps: find the hook, cut the pauses, post every day."),
            (15.5, "That is the whole system."),
            (17.5, "Try it this week and tell me how it goes."),
            (21.5, "See you next time."),
        ]

        def segments():
            out = []
            for start, text in LINES:
                words = [ts.TranscriptWord(w, round((start + i * STEP) * 1000), round((start + (i + 1) * STEP - 0.05) * 1000))
                         for i, w in enumerate(text.split())]
                out.append(ts.TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, "S1", words))
            return out

        async def transcribe(self, video_path, work_dir, *args, **kwargs):
            rows = segments()
            return ts.TranscriptionResult(segments=rows, full_text=" ".join(s.text for s in rows), language="en",
                                          api_costs=ts.TranscriptionApiCosts(estimated_cost_usd=0.001, attempts=1))

        ts.TranscriptionService.transcribe = transcribe
        ts.TranscriptionService.__init__ = lambda self, *args, **kwargs: None

        EMPTY = {"value": "", "label": "", "text": "", "title": "", "items": [], "before": "", "after": "", "author": "", "name": "", "role": ""}

        async def call_openrouter(self, model, messages, fallback_models=None):
            system = messages[0]["content"]
            clip = {"moment": {}, "start_time": 2.0, "end_time": 20.9, "summary": "Fifteen thousand a month",
                    "headline": "We made $15,000 in one month from short clips", "tags": ["clips"], "emphasis": ["fifteen"],
                    "scores": {k: 8 for k in ("hook", "standalone", "arc", "quotability", "ending")},
                    "screen_focus": "presenter", "screen_focus_reason": "A story told to camera."}
            if "MOTION GRAPHICS" in system:
                clip["graphics"] = [
                    {**EMPTY, "template": "stat", "time": 4.7, "seconds": 3.5, "placement": "top", "value": "$15,000", "label": "in one month"},
                    {**EMPTY, "template": "list", "time": 10.9, "seconds": 4.5, "placement": "middle", "title": "Three steps",
                     "items": ["Find the hook", "Cut the pauses", "Post every day"]},
                    # Never said: dropped by the engine's check.
                    {**EMPTY, "template": "stat", "time": 16.0, "seconds": 3, "placement": "top", "value": "$90,000", "label": "in one week"},
                ]
            content = json.dumps({"insights": "One clear money story.", "clips": [clip]})
            response = {"model": model, "choices": [{"message": {"content": content}, "finish_reason": "stop"}]}
            return response, {"prompt_tokens": 1000, "completion_tokens": 300, "total_tokens": 1300, "cost": 0.004}

        planner.IntelligencePlannerService._call_openrouter = call_openrouter
    except Exception:  # noqa: BLE001 - only the e2e test uses this; a broken stand-in shows up as a failing test
        pass
