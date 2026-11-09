"""Edit my recording / Combine clips: the same recording keeps its last headline (checked against its words)."""
import asyncio
import json

from clip_engine.services import edit_recording as er


def say(text, start=0.0, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


WORDS = say("Most coaches charge way too little for their time. I raised my prices three times this year. "
            "Here is how self-doubt kept me cheap.")


def test_a_headline_passes_only_with_words_and_numbers_the_speaker_said():
    assert er.headline_said("Coaches charge too little", WORDS)
    # A plural either way, a hyphenated word in parts, and a number said as a word shown as digits.
    assert er.headline_said("Coach charges too little", WORDS)
    assert er.headline_said("Self doubt kept me cheap", WORDS)
    assert er.headline_said("I raised my prices 3 times", WORDS)
    # A word or a number they never said fails.
    assert not er.headline_said("Coaches charge too little for clients", WORDS)
    assert not er.headline_said("I raised my prices 5 times", WORDS)
    assert not er.headline_said("…", WORDS)


def test_the_kept_headline_goes_on_the_first_hook_and_the_new_one_is_kept_too():
    plan = {"hooks": [{"id": 0, "start": 0, "end": 8, "text": "Coaches undercharge", "why": ""},
                      {"id": 1, "start": 10, "end": 17, "text": "Three raises", "why": ""}]}
    er.keep_headline(plan, WORDS, "  Most coaches charge too little  ")
    assert plan["hooks"][0]["text"] == "Most coaches charge too little"
    assert plan["hooks"][1]["text"] == "Three raises"
    assert plan["kept_hook"] == {"kept": True, "text": "Most coaches charge too little", "fresh": "Coaches undercharge"}


def test_a_kept_headline_that_fails_the_check_falls_back_to_the_new_one():
    plan = {"hooks": [{"id": 0, "start": 0, "end": 8, "text": "Coaches undercharge", "why": ""}]}
    er.keep_headline(plan, WORDS, "Ten secrets nobody tells you")
    assert plan["hooks"][0]["text"] == "Coaches undercharge"
    assert plan["kept_hook"] == {"kept": False, "text": "", "fresh": "Coaches undercharge"}
    # Too long for a headline: never kept.
    plan = {"hooks": [{"id": 0, "start": 0, "end": 8, "text": "Coaches undercharge", "why": ""}]}
    er.keep_headline(plan, WORDS, " ".join(["coaches"] * 20))
    assert plan["kept_hook"]["kept"] is False
    # No headline kept from before: the plan is left as it is.
    plan = {"hooks": [{"id": 0, "start": 0, "end": 8, "text": "Coaches undercharge", "why": ""}]}
    er.keep_headline(plan, WORDS, "")
    assert "kept_hook" not in plan


def _run_plan(monkeypatch, fixed, ai_text="A brand new headline every time"):
    sent = []

    async def completion(_client, payload):
        sent.append(payload)
        raw = {"hooks": [{"start": 0, "end": 8, "text": ai_text, "why": "Bold claim."}], "cuts": [],
               "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": [], "cards": []}
        return {"choices": [{"message": {"content": json.dumps(raw)}}]}, {"cost": 0.001}

    monkeypatch.setattr(er, "chat_completion", completion)
    config = {"words": WORDS, "names": ["take.mp4"], **({"fixed_hook": fixed} if fixed is not None else {})}
    review = asyncio.run(er.plan_edit(config, lambda *args: None))
    return review, sent


def test_planning_the_same_recording_again_keeps_its_headline(monkeypatch):
    review, sent = _run_plan(monkeypatch, "Most coaches charge too little")
    assert review["hooks"][0]["text"] == "Most coaches charge too little"
    assert review["kept_hook"] == {"kept": True, "text": "Most coaches charge too little", "fresh": "A brand new headline every time"}
    assert "THE HEADLINE THEY USED LAST TIME" in sent[0]["messages"][1]["content"]


def test_planning_with_a_headline_that_no_longer_fits_writes_a_new_one(monkeypatch):
    review, sent = _run_plan(monkeypatch, "Ten secrets nobody tells you", ai_text="Self-doubt kept me cheap")
    assert review["hooks"][0]["text"] == "Self-doubt kept me cheap"
    assert review["kept_hook"]["kept"] is False
    assert "LAST TIME" not in sent[0]["messages"][1]["content"]


def test_planning_without_a_kept_headline_is_unchanged(monkeypatch):
    review, _ = _run_plan(monkeypatch, None, ai_text="Self-doubt kept me cheap")
    assert review["hooks"][0]["text"] == "Self-doubt kept me cheap" and "kept_hook" not in review


def test_the_bridge_passes_the_kept_headline_to_the_planner():
    import edit_runner
    words = [["Hello", 0, 400, 0], ["world.", 450, 900, 0]]
    base = {"mode": "plan", "output_dir": "/tmp/edit-x", "sources_count": 1, "words": words}
    assert edit_runner.parse_request({**base, "fixed_hook": "Hello world"})["fixed_hook"] == "Hello world"
    assert "fixed_hook" not in edit_runner.parse_request(base)
    try:
        edit_runner.parse_request({**base, "fixed_hook": 5})
        raise AssertionError("a headline that isn't text is refused")
    except ValueError:
        pass
