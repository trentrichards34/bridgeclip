"""Voice clock: ElevenLabs character timings -> words, and the request we would send (no network)."""
import asyncio
import base64
import json

import httpx
import pytest

from clip_engine.services import voice_clock as vc


def alignment(text, step=0.1):
    """A fake character alignment: each character lasts `step` seconds."""
    chars, starts, ends, t = [], [], [], 0.0
    for ch in text:
        chars.append(ch)
        starts.append(round(t, 3))
        t += step
        ends.append(round(t, 3))
    return {"characters": chars, "character_start_times_seconds": starts, "character_end_times_seconds": ends}


def texts(words):
    return [w["word"] for w in words]


def test_splits_on_whitespace_with_times():
    words = vc.words_from_alignment({"alignment": alignment("Hi there  you")})
    assert texts(words) == ["Hi", "there", "you"]
    assert words[0] == {"word": "Hi", "start": 0.0, "end": 0.2}
    assert words[1]["start"] == pytest.approx(0.3) and words[1]["end"] == pytest.approx(0.8)
    assert words[2]["start"] == pytest.approx(1.0)


def test_stray_punctuation_joins_previous_word():
    words = vc.words_from_alignment(alignment("Wait - what ... really ?"))
    assert texts(words) == ["Wait-", "what...", "really?"]
    # The joined mark extends the word's end to the mark's end.
    assert words[0]["end"] == pytest.approx(0.6)
    assert words[2]["end"] == pytest.approx(2.4)


def test_leading_punctuation_joins_next_word():
    words = vc.words_from_alignment(alignment("— hello"))
    assert texts(words) == ["—hello"]
    assert words[0]["start"] == 0.0


def test_cjk_characters_are_words_and_cjk_punctuation_attaches():
    words = vc.words_from_alignment(alignment("你好。世界 ok"))
    assert texts(words) == ["你", "好。", "世", "界", "ok"]
    assert words[1]["start"] == pytest.approx(0.1) and words[1]["end"] == pytest.approx(0.3)
    kana = vc.words_from_alignment(alignment("すごいAI"))
    assert texts(kana) == ["す", "ご", "い", "AI"]


def test_hangul_stays_space_delimited():
    assert texts(vc.words_from_alignment(alignment("안녕 하세요"))) == ["안녕", "하세요"]


def test_curly_quotes_normalized():
    words = vc.words_from_alignment(alignment("“Don’t” stop"))
    assert texts(words) == ['"Don\'t"', "stop"]


def test_prefers_alignment_over_normalized():
    reply = {"alignment": alignment("one"), "normalized_alignment": alignment("two")}
    assert texts(vc.words_from_alignment(reply)) == ["one"]
    assert texts(vc.words_from_alignment({"normalized_alignment": alignment("two")})) == ["two"]


def test_bad_alignment_raises():
    with pytest.raises(vc.VoiceClockError):
        vc.words_from_alignment({"characters": ["a", "b"], "character_start_times_seconds": [0.0],
                                 "character_end_times_seconds": [0.1, 0.2]})
    with pytest.raises(vc.VoiceClockError):
        vc.words_from_alignment({"audio_base64": ""})


def test_word_table():
    table = vc.word_table([{"word": "hi", "start": 0.0, "end": 0.25}, {"word": "you", "start": 0.3, "end": 0.6}])
    assert table.splitlines() == ["   0   0.000   0.250 hi", "   1   0.300   0.600 you"]


def test_build_request_body():
    req = vc.build_request("  It’s here.  ", "JBFqnCBsd6RMkjVDRZzb")
    assert req.url == "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps"
    assert req.params == {"output_format": "mp3_44100_192"}
    assert req.body == {"text": "It's here.", "model_id": vc.DEFAULT_MODEL,
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True}}
    assert "language_code" not in vc.build_request("Hi", "v1", language_code="en-US").body
    assert vc.build_request("Hola", "v1", language_code="es-MX").body["language_code"] == "es"
    assert vc.auth_headers("k")["xi-api-key"] == "k"


@pytest.mark.parametrize("text, voice", [("", "v1"), ("hi", ""), ("hi", "../etc"), ("x" * 5001, "v1")])
def test_build_request_rejects(text, voice):
    with pytest.raises(vc.VoiceClockError):
        vc.build_request(text, voice)


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_synthesize_falls_back_to_multilingual(tmp_path):
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append((body["model_id"], request.headers["xi-api-key"], request.url.params["output_format"]))
        if body["model_id"] == vc.DEFAULT_MODEL:
            return httpx.Response(400, json={"detail": {"message": "model not available for this account"}})
        return httpx.Response(200, json={"audio_base64": base64.b64encode(b"ID3fake").decode(),
                                         "alignment": alignment("Hello world.")})

    async def run():
        async with _client(handler) as client:
            return await vc.synthesize(client, "key", "Hello world.", "voice1", str(tmp_path / "v.mp3"))

    out = asyncio.run(run())
    assert [m for m, _k, _f in seen] == [vc.DEFAULT_MODEL, vc.FALLBACK_MODEL]
    assert all(k == "key" and f == "mp3_44100_192" for _m, k, f in seen)
    assert out["model"] == vc.FALLBACK_MODEL
    assert texts(out["words"]) == ["Hello", "world."]
    assert out["alignment"]["characters"][0] == "H"
    assert (tmp_path / "v.mp3").read_bytes() == b"ID3fake"


def test_synthesize_other_errors_do_not_retry(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(429, json={"detail": "too many requests"})

    async def run():
        async with _client(handler) as client:
            await vc.synthesize(client, "key", "Hi", "voice1", str(tmp_path / "v.mp3"))

    with pytest.raises(vc.VoiceClockError):
        asyncio.run(run())
    assert len(calls) == 1
    assert not (tmp_path / "v.mp3").exists()
