"""Edit my recording / Combine clips: the headline and the Triple Hook (elements quoted exactly, said words only,
exact numbers first), checked on the owner's real recording and on small scripts. Only the text changes."""
import asyncio
import json
import os

import pytest

from clip_engine.services import edit_frameworks as ef
from clip_engine.services import edit_recording as er

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "edit_owner_transcript.json")


def owner_words():
    with open(FIXTURE) as f:
        return [er.Word(t, s, e, 0) for t, s, e in json.load(f)["words"]]


def say(text, start=0.0, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


def find(words, phrase, after=0):
    tokens = phrase.split()
    for i in range(after, len(words) - len(tokens) + 1):
        if [w.text for w in words[i:i + len(tokens)]] == tokens:
            return i
    raise AssertionError(phrase)


def owner_plan():
    """The owner's run as it came out: opens on the first line, headline "You do not have to be an influencer"."""
    words = owner_words()
    marks = er.analyze_takes(words)
    plan = er.basic_plan(words, marks)
    end = find(words, "internet.")
    plan["hooks"] = [{"id": 0, "start": 0, "end": end, "text": "You do not have to be an influencer", "why": ""}]
    return words, plan


# ---------------------------------------------------------------------------
# Triple Hook elements
# ---------------------------------------------------------------------------

def test_the_owner_opening_has_the_twist_but_no_qualifier_or_exact_number():
    found = ef.detect_elements("You do not have to be an influencer or have a huge audience in order to make a lot of money on the internet.")
    assert found["twist"].startswith("You do not have to be an influencer")
    assert found["main_statement"] and not found["specific"]  # "make a lot of money": a result, but no number
    assert found["qualifier"] is None


@pytest.mark.parametrize("line, role, quote", [
    ("Yesterday I spent $4,365 on ads promoting my product", "main_statement", "Yesterday I spent $4,365 on ads promoting my product"),
    ("we ended up generating $8,188 Now, I can't stress this enough.", "main_statement", "we ended up generating $8,188"),
    ("Turns out about three million people look for that every single week on TikTok alone.", "main_statement",
     "Turns out about three million people look for that every single week on TikTok alone."),
    ("Now we need eyeballs, and this is gonna be controversial because there's only two ways to get eyeballs.", "qualifier",
     "this is gonna be controversial because there's only two ways to get eyeballs."),
    ("I can't stress this enough.", "qualifier", "I can't stress this enough."),
    ("It was all without going viral, all without people sharing my content.", "twist", "It was all without going viral"),
])
def test_elements_are_quoted_exactly_as_said(line, role, quote):
    found = ef.detect_elements(line)
    assert found[role] == quote
    assert quote in line


def test_a_method_in_a_headline_is_spotted():
    assert ef.reveals_method("Here's how I did it: I ran ads to a quiz.")
    assert ef.reveals_method("The secret is a low ticket offer.")
    assert not ef.reveals_method("You do not have to be an influencer to make money.")


# ---------------------------------------------------------------------------
# The headline
# ---------------------------------------------------------------------------

def test_the_owner_headline_repeating_the_line_becomes_said_words_that_add_the_exact_result():
    words, plan = owner_plan()
    marks, hook = list(plan["marks"]), dict(plan["hooks"][0])
    ef.stack_headlines(plan, words)
    h = plan["hooks"][0]
    assert h["text"] == "We ended up generating $8,188"
    assert h["repeated"] == "You do not have to be an influencer"
    assert er.headline_said(h["text"], words)
    # Only the text: the cut and the opening line stay exactly as planned.
    assert plan["marks"] == marks and (h["start"], h["end"]) == (hook["start"], hook["end"])


def test_the_owner_headline_options_add_the_qualifier_without_losing_the_number():
    words, plan = owner_plan()
    ef.stack_headlines(plan, words)
    options = plan["hooks"][0]["options"]
    assert 1 <= len(options) <= 3
    assert options[0]["text"] == "I can't stress this enough: we ended up generating $8,188"
    for o in options:
        assert er.headline_said(o["text"], words)
        assert len(o["text"].split()) <= er.MAX_HOOK_TEXT_WORDS
        # Together with the spoken twist, every option keeps the exact number and adds an element.
        assert ef.detect_elements(o["text"])["specific"]


def test_headline_candidates_use_only_said_words_and_never_someone_elses_quote():
    words, plan = owner_plan()
    hook = plan["hooks"][0]
    said = ef.detect_elements(ef.line_text(words, plan["marks"], hook["start"], hook["end"]))
    candidates = ef.headline_candidates(words, plan["marks"], set(range(hook["start"], hook["end"] + 1)), said)
    texts = [c["text"] for c in candidates]
    assert texts[:2] == ["We ended up generating $8,188", "I spent $4,365 on ads"]
    assert all(er.headline_said(t, words) for t in texts)
    # "people are saying, "I don't have $4,000."": their words, not the member's.
    assert not any("$4,000" in t for t in texts)


def test_a_headline_that_says_something_else_is_kept():
    words, plan = owner_plan()
    plan["hooks"][0]["text"] = "I'm a virtual nobody online"
    ef.stack_headlines(plan, words)
    assert plan["hooks"][0]["text"] == "I'm a virtual nobody online" and "repeated" not in plan["hooks"][0]


def test_a_headline_never_gives_away_the_how():
    words = say("You do not need ads. The secret is a quiz funnel. I made $8,188 in one day.")
    plan = {"marks": [None] * len(words), "cta": None, "hooks": [{"id": 0, "start": 0, "end": 4, "text": "You do not need ads", "why": ""}]}
    ef.stack_headlines(plan, words)
    h = plan["hooks"][0]
    assert h["text"] == "I made $8,188 in one day"
    assert not any("secret" in o["text"].lower() for o in h["options"])


def test_the_call_to_action_is_never_a_headline():
    words = say("Most coaches undercharge. Follow me for 3 more tips.")
    plan = {"marks": [None] * len(words), "cta": {"start": 3, "end": len(words) - 1},
            "hooks": [{"id": 0, "start": 0, "end": 2, "text": "Most coaches undercharge", "why": ""}]}
    ef.stack_headlines(plan, words)
    assert plan["hooks"][0]["text"] == "Most coaches undercharge" and plan["hooks"][0]["options"] == []


def test_compose_joins_said_fragments_in_triple_hook_order():
    assert ef.compose([("main_statement", "We ended up generating $8,188"), ("qualifier", "I can't stress this enough.")]) \
        == "I can't stress this enough: we ended up generating $8,188"
    assert ef.compose([("main_statement", "I sold 40 courses"), ("twist", "Without going viral")]) == "I sold 40 courses, without going viral"


def test_plan_edit_completes_the_headline_and_leaves_the_cut_alone(monkeypatch):
    words = owner_words()
    end = find(words, "internet.")
    sent = []

    async def planner(_client, payload):
        sent.append(payload)
        raw = {"hooks": [{"start": 0, "end": end, "text": "You do not have to be an influencer", "why": "Bold claim."}], "cuts": [],
               "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": [], "cards": []}
        return {"choices": [{"message": {"content": json.dumps(raw)}}]}, {"cost": 0.01}
    monkeypatch.setattr(er, "chat_completion", planner)
    review = asyncio.run(er.plan_edit({"words": words, "names": ["take.mp4"]}, lambda *_: None))
    assert "HOOK TEXT (Triple Hook Playbook)" in sent[0]["messages"][0]["content"]
    hook = review["hooks"][0]
    assert hook["text"] == "We ended up generating $8,188" and (hook["start"], hook["end"]) == (0, end)
    assert hook["options"][0]["text"] == "I can't stress this enough: we ended up generating $8,188"
    assert review["cost_usd"] == pytest.approx(0.01)


def test_a_kept_headline_stays_and_still_gets_options(monkeypatch):
    words = owner_words()
    end = find(words, "internet.")

    async def planner(_client, _payload):
        raw = {"hooks": [{"start": 0, "end": end, "text": "You do not have to be an influencer", "why": ""}], "cuts": [],
               "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": [], "cards": []}
        return {"choices": [{"message": {"content": json.dumps(raw)}}]}, {"cost": 0.0}
    monkeypatch.setattr(er, "chat_completion", planner)
    review = asyncio.run(er.plan_edit({"words": words, "names": ["take.mp4"], "fixed_hook": "I spent $4,365 on ads"}, lambda *_: None))
    assert review["hooks"][0]["text"] == "I spent $4,365 on ads"
    assert review["kept_hook"] == {"kept": True, "text": "I spent $4,365 on ads", "fresh": "We ended up generating $8,188"}
    # Its options build on the kept headline (it keeps its exact number).
    assert review["hooks"][0]["options"] and all("$4,365" in o["text"] or "$8,188" in o["text"] for o in review["hooks"][0]["options"])
