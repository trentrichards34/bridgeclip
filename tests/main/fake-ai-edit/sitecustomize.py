"""End-to-end tests only: a stand-in for Edit my recording's one paid engine call (the plan) and the editor's hook ideas.

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
            # A slower stand-in when the test asks (to look at the progress view while the edit is planned).
            delay = float(os.environ.get("CREATORCLIPS_FAKE_AI_DELAY") or 0)
            if delay > 0:
                import asyncio
                await asyncio.sleep(min(delay, 30))
            text = payload["messages"][1]["content"].split("TRANSCRIPT (data)", 1)[1]
            words = [(int(i), w) for i, w in re.findall(r"(?<![\w.])(\d+):(\S+)", text)]

            def first(word):
                return next(i for i, w in words if w == word)

            # The automatic direction: the plan also directs the motion graphics (every field set, as the schema asks).
            directed = "MOTION GRAPHICS" in payload["messages"][0]["content"]
            blank = {k: ([] if k in ("items", "icons", "notes") else "") for k in (
                "value", "label", "text", "title", "items", "before", "after", "author", "name", "role", "accent", "subline", "final",
                "phrase", "icons", "keyword", "lead", "notes", "wrong", "icon")}

            def graphic(template, word, seconds, **fields):
                return {**blank, "template": template, "word": word, "seconds": seconds, "placement": "top", **fields}

            if "LONG LANDSCAPE YOUTUBE VIDEO" in payload["messages"][0]["content"]:
                # A YouTube video: open on the launch line, end on the call to action; a dense cold open (a title, a
                # stat overlay, numbered chips, a line rising word by word), then a number in the body; a chapter title.
                def fx(word, seconds, effect, **fields):
                    return {**graphic("fx", word, seconds), "effect": effect, "fx_fields": [{"key": k, "value": v} for k, v in fields.items()]}
                plan = {
                    "hooks": [{"start": first("I"), "end": first("AI."), "text": "I launched a brand new tool", "why": "A launch, first."}],
                    "cuts": [], "cta": {"present": True, "start": first("Follow"), "end": first("more.")}, "sounds": [],
                    "graphics": [fx(first("brand"), 3, "titlecard-lockup", title="brand new tool", kicker="I launched a"),
                                 graphic("stat", first("1,227"), 3, value="$1,227", label="monthly recurring revenue"),
                                 fx(first("input,"), 4, "state-chip-rail", states="input\nprocess\noutput"),
                                 fx(first("500"), 3, "per-word-rise", text="500 dollars a week"),
                                 graphic("stat", first("3"), 3, value="3%", label="churn")],
                    "chapter": "brand new tool" if "PART 1 of" not in payload["messages"][0]["content"] or "Give the hooks" in payload["messages"][0]["content"] else "",
                }
                return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.004}

            if "--- Clip 1 (" in text:
                # Combine clips: open on the screen clip's last line, play B, A, C, and a proof graphic on "$8,188".
                plan = {
                    "hooks": [{"start": first("And"), "end": first("screen."), "text": "Here is my screen", "why": "Shows the result first."}],
                    "cuts": [], "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": [], "cards": [],
                    "order": [2, 1, 3], "order_why": "The story first, then the screen as proof.",
                    "proof": [{"word": first("$8,188"), "value": "$8,188", "label": "dashboard says"}],
                }
                if directed:
                    # On the screen clip's dashboard line (no stage there: the screen is the visual).
                    plan["graphics"] = [graphic("statement", first("My"), 3, text="My dashboard says $8,188 today.", accent="dashboard")]
                return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.003}

            if any(w == "dashboard." for _, w in words):
                # Camera + screen: open on the dashboard line, end on the call to action.
                plan = {
                    "hooks": [{"start": first("Watch"), "end": first("dashboard."), "text": "Watch this dashboard", "why": "Shows the screen first."}],
                    "cuts": [], "cta": {"present": True, "start": first("Follow"), "end": first("more.")}, "popups": [], "sounds": [], "cards": [],
                }
                return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.002}

            def last(word):
                return [i for i, w in words if w == word][-1]

            if any(w == "backwards." for _, w in words):
                # The Explainer test's take: open on its first line, end on the call to action; a statement per turn.
                plan = {
                    "hooks": [{"start": first("Most"), "end": first("sales."), "text": "Most people never make sales", "why": "Names the problem."}],
                    "cuts": [], "cta": {"present": True, "start": first("Comment"), "end": first("below.")}, "popups": [], "sounds": [], "cards": [],
                }
                if directed:
                    plan["graphics"] = [graphic("statement", first("But"), 2.5, text="But the order is backwards.", accent="backwards"),
                                        graphic("statement", first("Here"), 2.5, text="Here is the secret.", accent="secret")]
                return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.004}

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
            if directed:
                # The kept take's line, as a statement on the stage.
                plan["graphics"] = [graphic("statement", last("Most"), 2.5, text="Most coaches lose clients.", accent="clients")]
            return {"choices": [{"message": {"content": json.dumps(plan)}}]}, {"cost": 0.004}

        edit_recording.chat_completion = chat_completion

        # The clip editor's hook ideas (one small call): five fixed options from the editor fixture's words.
        from clip_engine.services import hook_ideas

        async def suggest_hooks(settings, title, text, voice="clipper"):
            ideas = [("The event changed everything", "story"), ("That explains the result", "contrarian"), ("Why the event happened", "question"),
                     ("The result nobody expected", "curiosity"), ("What the event explains", "question")]
            return {"hooks": [{"text": t, "grade": "B", "score": 7, "hook_type": k, "elements": {"qualifier": None, "main_statement": t, "twist": None},
                               "evidence": "The event happened", "why": "From the clip."} for t, k in ideas],
                    "cost_usd": 0.004, "cost_incomplete": False, "model": "anthropic/claude-opus-5.5"}

        hook_ideas.suggest_hooks = suggest_hooks
    except Exception:  # noqa: BLE001 - only the e2e test uses this; a broken stand-in shows up as a failing test
        pass
