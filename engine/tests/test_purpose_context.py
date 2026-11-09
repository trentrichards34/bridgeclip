""""Say what it's for": the member's purpose line and reference picture reach the planning calls (Create's clip
planner, the Edit my recording plan, the Remix writing calls) as data, and the picture is scaled down first."""

import asyncio
import base64
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from clip_engine.services import edit_recording as er
from clip_engine.services import remix_service as remix
from clip_engine.services.purpose_context import (
    MAX_PURPOSE_CHARS, PURPOSE_RULE, REFERENCE_MODEL_EDGE, REFERENCE_RULE, clean_purpose, reference_data_url, system_rules,
    validate_reference_path, with_context,
)
from clip_engine.services.transcription_service import TranscriptionResult

from .test_plan_boundaries import clip, completion, make_planner, make_transcript

PURPOSE = "Instagram reel selling my coaching call"


@pytest.fixture
def picture(tmp_path):
    path = tmp_path / "look.png"
    Image.new("RGB", (2000, 1000), (220, 40, 60)).save(path)
    return str(path)


def test_purpose_is_one_clean_line():
    assert clean_purpose("  Instagram   reel\nselling <my> call  ") == "Instagram reel selling my call"
    assert clean_purpose(None) == "" and clean_purpose(42) == ""
    assert len(clean_purpose("x" * 500)) == MAX_PURPOSE_CHARS


def test_reference_path_is_checked(tmp_path, picture):
    assert validate_reference_path(None) is None
    assert validate_reference_path(picture) == picture
    for bad in ("relative.png", str(tmp_path / "missing.png"), str(tmp_path / "notes.txt"), 5):
        with pytest.raises(ValueError):
            validate_reference_path(bad)


def test_reference_is_scaled_down_before_it_is_sent(picture):
    url = reference_data_url(picture)
    assert url.startswith("data:image/jpeg;base64,")
    with Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))) as sent:
        assert max(sent.size) == REFERENCE_MODEL_EDGE and sent.size == (1024, 512)
    assert reference_data_url(None) is None


def test_context_is_added_as_data(picture):
    assert with_context("TRANSCRIPT", "", None) == "TRANSCRIPT"
    text = with_context("TRANSCRIPT", PURPOSE, None)
    assert text.startswith("TRANSCRIPT") and "WHAT THE VIDEO IS FOR (data" in text and PURPOSE in text
    parts = with_context("TRANSCRIPT", PURPOSE, picture)
    assert parts[0]["type"] == "text" and PURPOSE in parts[0]["text"]
    assert [p["type"] for p in parts[1:]] == ["text", "image_url"]
    assert system_rules("", False) == ""
    assert PURPOSE_RULE in system_rules(PURPOSE, False) and REFERENCE_RULE not in system_rules(PURPOSE, False)
    assert REFERENCE_RULE in system_rules("", True)


def test_create_planner_prompt_includes_the_purpose_and_the_picture(monkeypatch, picture):
    tr = make_transcript(10)
    planner = make_planner(tr)
    seen = {}

    async def complete(**kwargs):
        seen["messages"] = kwargs["messages"]
        return completion([clip(tr[0].start_time_ms / 1000, tr[4].end_time_ms / 1000)]), {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2, "cost": 0}

    monkeypatch.setattr(planner, "_call_openrouter", complete)
    asyncio.run(planner.plan_clips(TranscriptionResult(segments=tr, full_text=""), duration_ranges=["short"], purpose=PURPOSE, reference_image=picture))
    system, user = seen["messages"][0]["content"], seen["messages"][1]["content"]
    assert PURPOSE_RULE in system and REFERENCE_RULE in system
    texts = [part["text"] for part in user if part["type"] == "text"]
    assert any(PURPOSE in text for text in texts)
    assert any(part["type"] == "image_url" and part["image_url"]["url"].startswith("data:image/jpeg") for part in user)

    # Without them, nothing is added.
    asyncio.run(planner.plan_clips(TranscriptionResult(segments=tr, full_text=""), duration_ranges=["short"]))
    assert PURPOSE_RULE not in seen["messages"][0]["content"] and "WHAT THE VIDEO IS FOR" not in json.dumps(seen["messages"])


def test_edit_plan_prompt_includes_the_purpose(monkeypatch, tmp_path):
    seen = {}

    async def fake_chat(client, payload):
        seen["payload"] = payload
        # Not a plan: the edit falls back to the basic plan; only the request matters here.
        return {"choices": [{"message": {"content": "{}"}}]}, {"cost": 0}

    monkeypatch.setattr(er, "chat_completion", fake_chat)
    words = [er.Word(text, i * 400, i * 400 + 300, 0) for i, text in enumerate("So here is the thing about selling coaching calls today.".split())]
    config = {"words": words, "names": ["take.mp4"], "brand_identity": "", "brand_name": "", "hook_hint": "", "purpose": PURPOSE, "output_dir": str(tmp_path)}
    asyncio.run(er.plan_edit(config, lambda *_: None))
    messages = seen["payload"]["messages"]
    assert PURPOSE_RULE in messages[0]["content"]
    assert PURPOSE in messages[1]["content"] and "WHAT THE VIDEO IS FOR (data" in messages[1]["content"]


def test_remix_writing_calls_include_the_purpose(picture):
    cfg = remix.RemixConfig(output_dir="/tmp", purpose=PURPOSE, reference_image=picture)
    host = SimpleNamespace(config=cfg)
    content = remix.Remixer._with_purpose(host, "THE CREATOR'S WORDS")
    assert PURPOSE in content[0]["text"] and content[-1]["type"] == "image_url"
    # A text-only retry leaves the picture out.
    assert remix.Remixer._with_purpose(host, "WORDS", False) == "WORDS\n\nWHAT THE VIDEO IS FOR (data, the member's own words)\n" + PURPOSE
    assert REFERENCE_RULE in remix.Remixer._purpose_rules(host) and REFERENCE_RULE not in remix.Remixer._purpose_rules(host, False)
    plain = SimpleNamespace(config=remix.RemixConfig(output_dir="/tmp"))
    assert remix.Remixer._with_purpose(plain, "WORDS") == "WORDS" and remix.Remixer._purpose_rules(plain) == ""
