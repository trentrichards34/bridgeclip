"""Fixes from the final quality check on real footage (an edited reel of a creator talking about ads and a sales page):
the planner's hints quote a number said once (not "$4,365 $4,365") and cut at a word; a page named by what it is ("sales
page") is where the member's screenshot shows; the member's logo pops in where the call to action names it (their own
product) while the planner's graphics stay off the call to action; and a logo pop gives way to the ask's graphic."""
from clip_engine.services import edit_direction as ed
from clip_engine.services import edit_recording as er
from clip_engine.services import graphics_director as gd
from clip_engine.services import spoken_cta as sc
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def seg(text, start_s, step=0.35):
    words, t = [], start_s
    for token in text.split():
        words.append(TranscriptWord(token, round(t * 1000), round((t + step - 0.05) * 1000)))
        t += step
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def say(text, start, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


def test_hints_quote_a_number_once_and_cut_at_a_word():
    talk = [seg('Yesterday I spent $4,365 on ads promoting my product.', 1),
            seg('I am a virtual nobody when it comes to the internet and everything on it.', 6)]
    money = next(c for c in gd.find_cues(talk) if c['kind'] == 'money')
    assert money['text'] == 'spent $4,365 on ads'
    hints = gd.cue_hints(talk)
    assert '$4,365 $4,365' not in hints and '"spent $4,365 on ads"' in hints
    identity = next(line for line in hints.split('\n') if ' identity ' in line)
    quoted = identity.split('"')[1]
    assert quoted.endswith('…') and len(quoted) <= 51 and quoted[:-1].split(' ')[-1] in 'I am a virtual nobody when it comes to the internet'.split(' ')


def test_a_sales_page_said_is_where_the_screenshot_shows():
    talk = [seg('We spent money on ads.', 1), seg("We need a sales page that's actually going to get people to buy.", 5), seg('That is the whole plan.', 11)]
    assert any(c['kind'] == 'screen' for c in gd.find_cues(talk))
    (frame,) = [g for g in gd.place_media([], talk, [{'id': 'aaaaaaaaaaaa'}]) if g['template'] == 'fx']
    assert frame['fields'] == {'effect': 'browser-device-stage', 'image': 'aaaaaaaaaaaa'}
    assert 4500 <= frame['at_ms'] <= 5500
    assert "the member's screenshot" in gd.cue_hints(talk, media=True)
    # Without screenshots it is only a hint (the planner never places a picture effect).
    assert gd.place_media([], talk, None) == []


def test_the_members_logo_pops_where_the_call_to_action_names_it_and_planned_graphics_stay_off_it():
    words = (say('Most people never go viral on the internet.', 0.0) + say('Yesterday I spent 4,365 dollars on ads.', 4.0)
             + say('So focus on a really good offer for buyers.', 9.0) + say('Get access to my Product Suite platform for free today.', 14.0))
    marks = [None] * len(words)
    cta = (next(i for i, w in enumerate(words) if w.text == 'Get'), len(words) - 1)
    hook = (0, 7)
    logos = [{'image': 'aaaaaaaaaaaaaaaa', 'name': 'Product Suite', 'aliases': []}]
    on_cta = {'template': 'fx', 'word': cta[0] + 2, 'seconds': 2.5, 'placement': 'top', 'effect': 'headline-slam',
              'fx_fields': [{'key': 'text', 'value': 'my Product Suite platform'}]}
    for k in ('value', 'label', 'text', 'title', 'before', 'after', 'author', 'name', 'role', 'accent', 'subline', 'final', 'phrase',
              'keyword', 'lead', 'wrong', 'icon'):
        on_cta[k] = ''
    on_cta.update(items=[], icons=[], notes=[])
    out = ed.plan_graphics([on_cta], words, marks, {'stage': True, 'register': 'teaching', 'logos': logos}, [hook, cta], logos_in=[cta])
    assert [g['template'] for g in out] == ['logo']
    assert out[0]['fields']['image'] == 'aaaaaaaaaaaaaaaa' and cta[0] <= out[0]['word'] <= cta[1]
    # Without the opening (as before): no logo on the call to action either.
    assert ed.plan_graphics([on_cta], words, marks, {'stage': True, 'register': 'teaching', 'logos': logos}, [hook, cta]) == []


def test_a_logo_pop_gives_way_to_the_asks_graphic():
    cta = {'id': 'g-cta000001', 'template': 'link_cta', 'at_ms': 10_000, 'duration_ms': 3000, 'placement': 'bottom', 'fields': {'text': 'Hit the link'}, 'origin': 'auto'}
    early = {'id': 'g-logo00001', 'template': 'logo', 'at_ms': 8500, 'duration_ms': 1500 + 400, 'placement': 'middle', 'fields': {'image': 'x.png'}, 'origin': 'member'}
    during = {'id': 'g-logo00002', 'template': 'logo', 'at_ms': 10_500, 'duration_ms': 1500, 'placement': 'middle', 'fields': {'image': 'x.png'}, 'origin': 'member'}
    out = sc.with_cta([early, during], cta)
    assert [g['id'] for g in out] == ['g-logo00001', 'g-cta000001']
    assert out[0]['at_ms'] + out[0]['duration_ms'] <= cta['at_ms']
    # The member's other graphics still keep their time (the ask's graphic is left out then).
    mine = {**during, 'template': 'stat', 'fields': {'value': '3'}}
    assert sc.with_cta([mine], cta) == [mine]


def test_the_edit_runner_takes_the_direction_main_sends():
    import pytest
    import edit_runner
    full = {"stage": True, "cta_keyword": "GUIDE", "register": "story",
            "logos": [{"image": "a1b2c3d4e5f60718", "name": "Product Suite", "aliases": ["the suite"]}],
            "media": [{"id": "abcdef123456", "box": [0.1, 0.2, 0.3, 0.1], "tall": True}, {"id": "0123456789ab"}]}
    assert edit_runner._direction(full) == full
    assert edit_runner._direction({"stage": True}) == {"stage": True, "cta_keyword": ""}
    for bad in ({"register": "loud"}, {"logos": [{"image": "../logo.png", "name": "X"}]}, {"logos": [{"image": "a1b2c3d4e5f60718", "name": ""}]},
                {"media": [{"id": "abcdef123456", "box": [0, 0, 2, 1]}]}, {"media": [{"id": "../../x"}]}, {"media": [{"id": "abcdef123456", "tall": False}]},
                {"logos": "Meta"}, {"other": 1}):
        with pytest.raises(ValueError):
            edit_runner._direction({"stage": True, **bad})
