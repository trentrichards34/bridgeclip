"""Effects (`fx` graphics, HyperFrames units): the engine reads the catalog the app writes (data/fx_catalog.json),
keeps saved effect graphics valid, and holds their shown words and numbers to the words-said rule."""
from clip_engine.services import auto_graphics as ag
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def line(start, text, step=400):
    words = text.split()
    timed = [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed[-1].end_time_ms, text, words=timed)


SAID = [
    line(10_000, "We grew to 1200 members in one year."),
    line(14_000, "Plan it, make it, share it."),
]


def fx(fields, at=10_000, length=3500):
    return {'template': 'fx', 'at_ms': at, 'duration_ms': length, 'placement': 'top', 'fields': fields}


def test_catalog_is_loaded_with_its_guidance():
    catalog = ag.fx_catalog()
    assert 35 <= len(catalog) <= 45
    count = catalog['count-up']
    assert count['jobs'] == ['prove'] and count['sound'] == 'tick' and count['use_when'] and count['avoid_when']
    assert {f['key'] for f in count['fields']} >= {'value', 'prefix', 'suffix'}
    assert 'fx' in ag.SAVED_TEMPLATES and 'fx' in ag.AUTO_TEMPLATES


def test_fields_are_cleaned_by_the_effects_own_schema():
    clean = ag.clean_fields('fx', {'effect': 'chart-story', 'data': '12\n28\n45', 'type': 'pie', 'unit': '%', 'items': 'x', 'backing': 'none'})
    assert clean == {'effect': 'chart-story', 'data': '12\n28\n45', 'unit': '%', 'backing': 'none'}
    assert ag.clean_fields('fx', {'effect': 'x-follow-card', 'text': 'hi'}) == {}
    assert ag.has_content('fx', {'effect': 'count-up', 'value': '1200'})
    assert not ag.has_content('fx', {'effect': 'count-up'})


def test_saved_effects_are_read_back_with_their_cue_times():
    saved = [{'id': 'g-fx01', **fx({'effect': 'count-up', 'value': '1200', 'cue_ms': '600'}), 'size': 'stage'},
             {'id': 'g-fx02', **fx({'effect': 'nope', 'value': '1'})}]
    out = ag.checked_saved(saved, 60_000)
    assert [g['id'] for g in out] == ['g-fx01']
    assert out[0]['fields'] == {'effect': 'count-up', 'value': '1200', 'cue_ms': '600'}
    assert out[0]['size'] == 'stage'


def test_words_said_checks_only_what_the_effect_shows():
    # The number is said; choices and the effect's name are never checked as words.
    assert ag.words_said(fx({'effect': 'count-up', 'value': '1200', 'suffix': 'members', 'backing': 'none'}), SAID)
    assert not ag.words_said(fx({'effect': 'count-up', 'value': '1500'}), SAID)
    assert ag.words_said(fx({'effect': 'constellation-hub', 'hub': 'Plan', 'nodes': 'make\nshare'}, at=14_000), SAID)
    # Every shown word must be said (an effect is held to the strict rule).
    assert not ag.words_said(fx({'effect': 'constellation-hub', 'hub': 'Plan', 'nodes': 'make\nsell'}, at=14_000), SAID)
    assert not ag.words_said(fx({'effect': 'nope', 'text': 'Plan'}, at=14_000), SAID)
