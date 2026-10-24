"""Automatic direction (Motion graphics: Auto with the newer templates, and Stage layouts): the planner may pick
statements, crossed-out lists, sticky notes, icon rows, a hook headline and a comment prompt; every word on them
must be said near them (accents inside their text, items in order), each starts on its first spoken word with
its items revealed as said, about one per 6.5 s without overlaps or the comment keyword's last seconds, and
the big ones are stage size with a stage scene around them that the render draws and the editor shows."""

from clip_engine.services import auto_graphics as ag
import json
import re
from pathlib import Path

import pytest

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest, JobStatus
from clip_engine.services.auto_graphics import (
    GRAPHIC_ICONS, accent_inside, checked_saved, checked_saved_scenes, clean_fields, fit_to_clip, graphic_size, item_times,
    max_cards, motion_graphics_rule, on_stage, parse_planned, spoken_start, stage_scenes_for, words_said,
)
from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment
from clip_engine.services.rendering_service import RenderRequest, RenderResult
from clip_engine.services.stage_scenes import output_scenes
from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord
from clip_engine.services.video_downloader import displayed_sideways

from .test_more_clips_and_caption_language import run_pipeline

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def approved_candidates(monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(pipeline_module.CoherenceReviewer, 'prepare', AsyncMock(return_value=True))


def line(start, text, step=400):
    words = text.split()
    timed = [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed[-1].end_time_ms, text, words=timed)


SAID = [
    line(10_000, "Stop guessing what to post."),
    line(13_000, "Not scraping, not brittle selectors, just a typed client."),
    line(20_000, "Turn websites into APIs."),
    line(24_000, "I use Gmail, YouTube and Slack every day."),
    line(29_000, "Comment API and I will send it to you."),
]
CLIP = [(10_000, 40_000)]
STAGE = {'stage': True, 'headline_off': True, 'cta_keyword': 'API'}


def card(template, at, fields, duration=4000):
    return {'template': template, 'at_ms': at, 'duration_ms': duration, 'placement': 'top', 'fields': fields}


STRIKE = card('strike_list', 13_000, {'items': 'scraping\nbrittle selectors', 'final': 'just a typed client.', 'accent': 'typed client.'})
STATEMENT = card('statement', 20_000, {'text': 'Turn websites into APIs.', 'accent': 'APIs.'}, 2500)
ICONS = card('icon_pop', 24_400, {'items': 'Gmail\nYouTube\nSlack', 'icons': 'mail\nvideo\nmessage'}, 3000)
NOTES = card('sticky_notes', 20_000, {'items': 'Turn websites\ninto APIs.'}, 2500)


# --- the planner's suggestions ----------------------------------------------

def test_new_templates_are_shape_checked_and_gated_by_the_members_settings():
    def raw(template, **fields):
        return {'template': template, 'time': 21, 'seconds': 3, 'placement': 'top', **fields}
    planned = parse_planned([
        raw('statement', text='Turn websites into APIs.', accent='APIs.', subline=''),
        raw('sticky_notes', items=['Turn websites', 'into APIs.', 'fast', 'a fourth']),
        raw('sticky_notes', items=['only one']),  # needs two notes
        raw('strike_list', items=['scraping'], final=''),  # needs its final line
        raw('icon_pop', items=['Gmail', 'YouTube'], icons=['mail', 'youtube-logo', 'video']),
        raw('headline_pill', text='Stop guessing', phrase='what to post'),
        raw('comment_cta', keyword='api', lead='Comment'),
        raw('comment_cta', keyword='GUIDE', lead='Comment'),  # not the member's keyword
    ], 10_000, 40_000, STAGE)
    assert [g['template'] for g in planned] == ['statement', 'sticky_notes', 'icon_pop', 'headline_pill', 'comment_cta']
    assert planned[1]['fields'] == {'items': 'Turn websites\ninto APIs.\nfast'}  # three notes at most
    # Unknown or brand icons are left out (the tile draws the item's letter); never a logo.
    assert planned[2]['fields']['icons'] == 'mail\n'  # one per item
    # The member's keyword, exactly as they set it.
    assert planned[4]['fields']['keyword'] == 'API'
    # Without "No hook text" or a keyword, those two are never suggested.
    plain = parse_planned([raw('headline_pill', text='Stop', phrase='guessing'), raw('comment_cta', keyword='API')], 10_000, 40_000)
    assert plain == []


def test_the_rule_names_the_patterns_and_only_offers_what_the_member_allows():
    rule = motion_graphics_rule()
    for pattern in ('strike_list', 'statement', 'sticky_notes', 'icon_pop', '"list"', '"stat"', 'never a brand logo', 'Use ONLY words said'):
        assert pattern in rule
    assert 'headline_pill' not in rule and 'comment_cta' not in rule
    rule = motion_graphics_rule({'headline_off': True, 'cta_keyword': 'API'})
    assert 'headline_pill' in rule and 'keyword exactly "API"' in rule


def test_icons_match_the_editors_list():
    source = (ROOT / 'src/shared/motion-graphics.ts').read_text()
    block = re.search(r'export const GRAPHIC_ICONS = \[(.*?)\] as const', source, re.S).group(1)
    assert tuple(re.findall(r"'([a-z]+)'", block)) == GRAPHIC_ICONS


# --- nothing made up --------------------------------------------------------

def test_every_word_of_a_newer_card_is_said_near_it():
    assert words_said(STRIKE, SAID) and words_said(STATEMENT, SAID) and words_said(ICONS, SAID) and words_said(NOTES, SAID)
    # One made-up word is enough to drop a newer card (the older ones allow a few).
    assert not words_said({**STATEMENT, 'fields': {'text': 'Turn websites into money.', 'accent': 'money.'}}, SAID)
    assert not words_said({**STATEMENT, 'fields': {**STATEMENT['fields'], 'subline': 'in minutes'}}, SAID)
    assert not words_said({**NOTES, 'fields': {'items': 'Turn websites\ninto cash'}}, SAID)
    assert not words_said({**ICONS, 'fields': {**ICONS['fields'], 'items': 'Gmail\nTikTok\nSlack'}}, SAID)
    # Said, but too far from the card.
    assert not words_said({**STATEMENT, 'at_ms': 30_000}, SAID)


def test_accents_must_be_inside_their_text():
    assert accent_inside('Turn websites into APIs.', 'apis') and accent_inside('just a typed client.', 'Typed client')
    assert not accent_inside('Turn websites into APIs.', 'scraping')
    assert not words_said({**STATEMENT, 'fields': {**STATEMENT['fields'], 'accent': 'websites APIs'}}, SAID)
    assert not words_said({**STRIKE, 'fields': {**STRIKE['fields'], 'accent': 'scraping'}}, SAID)  # in the items, not the final line


def test_items_must_be_said_in_order_and_their_times_are_kept():
    assert item_times(STRIKE, SAID) == [13_400, 14_200, 15_000]  # scraping, brittle selectors, just a typed client
    assert item_times(ICONS, SAID) == [24_800, 25_200, 26_000]
    swapped = {**STRIKE, 'fields': {**STRIKE['fields'], 'items': 'brittle selectors\nscraping'}}
    assert item_times(swapped, SAID) is None and not words_said(swapped, SAID)
    assert not words_said({**ICONS, 'fields': {**ICONS['fields'], 'items': 'Slack\nGmail'}}, SAID)


def test_icons_must_be_generic_ones_and_comment_prompts_need_the_ask():
    assert not words_said({**ICONS, 'fields': {**ICONS['fields'], 'icons': 'mail\nyoutube\nmessage'}}, SAID)
    assert clean_fields('icon_pop', {'items': ['Gmail'], 'icons': ['youtube']}) == {'items': 'Gmail'}
    ask = card('comment_cta', 29_000, {'keyword': 'API', 'lead': 'Comment'}, 2500)
    assert words_said(ask, SAID)
    assert not words_said({**ask, 'at_ms': 21_000}, SAID)  # nobody asked for a comment there


# --- timing, density, overlap, size ------------------------------------------

def test_a_card_starts_on_its_first_spoken_word_with_items_revealed_as_said():
    late = {**STATEMENT, 'at_ms': 21_200}
    assert spoken_start(late, SAID) == 20_000
    # A common first word alone doesn't move a card: its next words must follow.
    assert spoken_start(card('title', 24_000, {'text': 'I love it'}), SAID) is None
    (strike,) = fit_to_clip([{**STRIKE, 'at_ms': 13_700}], SAID, CLIP, 1.0, STAGE)
    assert strike['at_ms'] == 13_400  # "scraping" (the first item)
    assert strike['fields']['item_ms'] == '0\n800\n1600'
    assert strike['size'] == 'stage' and strike['origin'] == 'auto'


def test_size_is_stage_for_the_big_cards_only_when_stage_layouts_are_on():
    for template in ('statement', 'strike_list', 'sticky_notes', 'browser_frame', 'list', 'checklist'):
        assert graphic_size(template, True) == 'stage' and graphic_size(template, False) == 'card'
    for template in ('stat', 'icon_pop', 'headline_pill', 'comment_cta', 'lower_third', 'quote', 'title'):
        assert graphic_size(template, True) == 'card'
    kept = fit_to_clip([STATEMENT, ICONS], SAID, CLIP, 1.0, {**STAGE, 'stage': False})
    assert [g['size'] for g in kept] == ['card', 'card']


def test_about_one_card_per_six_and_a_half_seconds_at_most_five_a_minute():
    assert [max_cards(s * 1000) for s in (5, 10, 20, 30, 45, 60, 90)] == [1, 1, 3, 4, 4, 5, 8]


def test_cards_never_overlap_and_a_weaker_one_is_cut_short_before_a_stronger_one():
    notes = {**NOTES, 'at_ms': 20_000, 'duration_ms': 5000}  # runs into the icon row at 24.4 s
    kept = fit_to_clip([notes, ICONS, STRIKE], SAID, CLIP, 1.0, STAGE)
    # (Sticky notes are a fallback: the notes come out as the richer chip rail their words fit.)
    assert [ag.kind_of(g) for g in kept] == ['strike_list', 'fx:state-chip-rail', 'icon_pop']
    for a, b in zip(kept, kept[1:]):
        assert a['at_ms'] + a['duration_ms'] <= b['at_ms']
    assert kept[1]['at_ms'] + kept[1]['duration_ms'] <= kept[2]['at_ms'] - 150
    # A short clip keeps fewer.
    assert len(fit_to_clip([STRIKE, STATEMENT, ICONS], SAID, [(10_000, 22_000)], 1.0, STAGE)) == 1


def test_the_hook_headline_opens_the_clip_and_the_keyword_keeps_its_last_seconds():
    hook = card('headline_pill', 10_100, {'text': 'Stop guessing', 'phrase': 'what to post.'}, 3000)
    (kept,) = fit_to_clip([hook], SAID, CLIP, 1.0, STAGE)
    assert kept['at_ms'] == 10_000 and kept['template'] == 'headline_pill'  # in the first second, unlike the rest
    assert fit_to_clip([hook], SAID, CLIP, 1.0, {**STAGE, 'headline_off': False}) == []
    # Comment keyword: no card in the last 4 s (the keyword shows there), others end before them.
    ask = card('comment_cta', 29_000, {'keyword': 'API', 'lead': 'Comment'}, 3000)
    assert fit_to_clip([ask], SAID, [(10_000, 32_000)], 1.0, STAGE) == []
    (kept,) = fit_to_clip([ask], SAID, CLIP, 1.0, STAGE)
    assert kept['at_ms'] == 29_000 and kept['size'] == 'card'
    (trimmed,) = fit_to_clip([ICONS], SAID, [(10_000, 31_000)], 1.0, STAGE)
    assert trimmed['at_ms'] + trimmed['duration_ms'] <= 27_000
    assert fit_to_clip([ask], SAID, CLIP, 1.0, {**STAGE, 'cta_keyword': ''}) == []


# --- stage scenes -------------------------------------------------------------

def test_stage_scenes_go_around_stage_cards_in_source_time():
    kept = fit_to_clip([STRIKE, ICONS], SAID, CLIP, 1.0, STAGE)
    scenes = stage_scenes_for(kept, 10_000, 40_000)
    assert scenes == [{'scene': 'stage', 'start_ms': 13_000, 'end_ms': 17_400, 'backdrop': 'light'}]
    assert on_stage(kept[0], scenes) and not on_stage(kept[1], scenes)
    assert stage_scenes_for([{**g, 'size': 'card'} for g in kept], 10_000, 40_000) == []
    # Through a cut and the speed onto the finished clip's clock (outputScenes in scenes.ts).
    pairs = output_scenes(scenes, [(10_000, 14_000), (15_000, 40_000)], 1.25)
    assert [out for _, out in pairs] == [{'scene': 'stage', 'start_ms': 2400, 'end_ms': 5120, 'backdrop': 'light'}]


def test_saved_graphics_and_scenes_read_back_for_the_editor():
    (strike,) = fit_to_clip([STRIKE], SAID, CLIP, 1.0, STAGE)
    assert checked_saved([strike], 60_000) == [strike]
    assert checked_saved([{**strike, 'fields': {**strike['fields'], 'item_ms': '../x'}}], 60_000)[0]['fields'].get('item_ms') is None
    good = [{'scene': 'stage', 'start_ms': 13_000, 'end_ms': 17_700}, {'scene': 'visual', 'start_ms': 20_000, 'end_ms': 22_000, 'backdrop': 'dark'}]
    assert checked_saved_scenes(good, 60_000) == good
    for bad in ([{'scene': 'face', 'start_ms': 0, 'end_ms': 2000}], [{'scene': 'stage', 'start_ms': 0, 'end_ms': 500}],
                [good[1], good[0]], 'x', [{'scene': 'stage', 'start_ms': 0, 'end_ms': 99_000}]):
        assert checked_saved_scenes(bad, 60_000) == []


def test_phone_videos_filmed_upright_are_read_the_right_way_round():
    assert displayed_sideways({'side_data_list': [{'rotation': -90}]}) and displayed_sideways({'tags': {'rotate': '270'}})
    assert not displayed_sideways({'side_data_list': [{'rotation': 180}]}) and not displayed_sideways({})


def test_pipeline_with_stage_layouts_draws_stage_scenes_and_records_them(monkeypatch, tmp_path):
    source = tmp_path / 'source.mp4'
    source.write_bytes(b'video' * 100)
    seen, renders = {}, []

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=SAID, full_text=' '.join(s.text for s in SAID))

    async def plan(**kwargs):
        seen.update(kwargs)
        segment = ClipPlanSegment(10_000, 40_000, 0.9, summary='APIs', headline='Turn any website into an API')
        segment.graphics = [STRIKE, ICONS]
        return ClipPlanResponse(segments=[segment], total_clips=1)

    async def render(request: RenderRequest):
        renders.append(request)
        open(request.output_path, 'wb').write(b'mp4')
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=30_000, kept_source_ms=[[10_000, 40_000]],
                            window_start_ms=10_000, stage_scenes=[dict(s) for s in request.source_scenes])

    request = ClippingJobRequest(video_url=str(source), job_id='direction', quality_bar='off', motion_graphics=True, stage_layouts=True,
                                 aspect_ratio='9:16', title_style='headline', include_captions=True,
                                 headline_look={'look': 'none'}, cta_keyword='API')
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, render=render)
    assert result.status == JobStatus.COMPLETED, result.error
    assert seen['graphics_options'] == {'headline_off': True, 'cta_keyword': 'API', 'stage': True, 'chapters': True, 'tone': 'dark'}
    (sent,) = renders
    # No "step one… step two…" said: no chapter header, so the hook isn't handed over.
    assert sent.headline_hide_source_ms is None
    assert sent.source_scenes == [{'scene': 'stage', 'start_ms': 13_000, 'end_ms': 17_400, 'backdrop': 'grid'}]
    entry = result.output.metrics['clip_layouts'][0]
    assert [(g['template'], g['size']) for g in entry['graphics']] == [('strike_list', 'stage'), ('icon_pop', 'card')]
    assert entry['stage_scenes'] == [{'scene': 'stage', 'start_ms': 13_000, 'end_ms': 17_400, 'backdrop': 'grid'}]
    assert result.output.metrics['requested_settings']['stage_layouts'] is True
    # The editor opens the clip with the stage scene in its Scenes row.
    plan_file = json.loads((tmp_path / 'out' / 'direction' / 'auto-graphics.json').read_text())
    (candidate,) = plan_file['project']['candidates']
    assert candidate['stage_scenes'] == entry['stage_scenes'] and candidate['graphics'] == entry['graphics']


def test_a_stage_card_the_render_could_not_stage_is_a_card(monkeypatch, tmp_path):
    source = tmp_path / 'source.mp4'
    source.write_bytes(b'video' * 100)

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=SAID, full_text='x')

    async def plan(**kwargs):
        segment = ClipPlanSegment(10_000, 40_000, 0.9, summary='APIs')
        segment.graphics = [STRIKE]
        return ClipPlanResponse(segments=[segment], total_clips=1)

    async def render(request: RenderRequest):
        open(request.output_path, 'wb').write(b'mp4')
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=30_000, kept_source_ms=[[10_000, 40_000]],
                            window_start_ms=10_000)

    # A gameplay background: no stage layouts at all.
    background = tmp_path / 'bg.mp4'
    background.write_bytes(b'x')
    request = ClippingJobRequest(video_url=str(source), job_id='nostage', quality_bar='off', motion_graphics=True, stage_layouts=True,
                                 aspect_ratio='9:16', background_video_path=str(background))
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, render=render)
    assert result.status == JobStatus.COMPLETED, result.error
    entry = result.output.metrics['clip_layouts'][0]
    assert entry['graphics'][0]['size'] == 'card' and 'stage_scenes' not in entry


# --- Audit: nothing unsaid sneaks onto a card, and word timing keeps the spacing rules ---

def test_a_contraction_or_a_digit_word_that_was_not_said_never_passes_as_said():
    said = [line(10_000, "You can afford this course today."), line(14_000, "This is the second step that matters.")]
    # "can't" is not "can" (it would turn what was said around).
    assert not words_said(card('statement', 10_000, {'text': "You can't afford this course"}, 3000), said)
    assert words_said(card('statement', 10_000, {'text': 'You can afford this course'}, 3000), said)
    # A word with a digit that isn't read as a number must be said exactly.
    assert not words_said(card('statement', 14_000, {'text': 'This is the 3rd step'}, 3000), said)
    assert not words_said(card('stat', 14_000, {'value': '3rd', 'label': 'step that matters'}, 3000), said)
    assert not words_said(card('title', 14_000, {'text': 'Web3 step that matters'}, 3000), said)
    said_web3 = [line(14_000, "This Web3 step is the one that matters.")]
    assert words_said(card('statement', 14_000, {'text': 'This Web3 step matters'}, 3000), said_web3)
    # Possessives still match ("brand's" said as "brand").
    assert words_said(card('statement', 10_000, {'text': "You can afford this course's price"}, 3000),
                      [line(10_000, "You can afford this course price today.")])


def test_a_word_that_flips_the_meaning_must_be_said_even_on_the_older_templates():
    said = [line(10_000, "You should run ads to your best offer every single week from now on.")]
    # 7 of 8 words said (over the 75% share), but "never" turns it around: refused.
    assert not words_said(card('title', 10_000, {'text': 'You should never run ads to your offer'}, 3000), said)
    assert not words_said(card('quote', 10_000, {'text': "You shouldn't run ads to your best offer", 'author': ''}, 3000), said)
    assert words_said(card('title', 10_000, {'text': 'You should run ads to your best offer weekly'}, 3000), said)


def test_a_word_timed_card_never_moves_back_into_the_first_second_or_over_the_card_before():
    # Said right as the clip starts: the card is moved out of the first second, and word timing keeps it there.
    said = [line(10_200, "Big money moves fast and then we keep talking about other things for a while longer okay")]
    out = fit_to_clip([card('title', 10_200, {'text': 'Big money moves'}, 2500)], said, [(10_000, 30_000)], 1.0)
    assert out and out[0]['at_ms'] >= 11_000
    # A title whose words were said (with fillers) under the stat before it starts after that stat ends.
    said = [line(10_000, "Here is the number 500 dollars per month we made then big um uh idea comes here and more words", 300)]
    planned = [card('stat', 11_200, {'value': '500 dollars', 'label': 'per month'}, 3000), card('title', 14_400, {'text': 'big idea comes'}, 2500)]
    out = fit_to_clip(planned, said, [(9_000, 30_000)], 1.0)
    for a, b in zip(out, out[1:]):
        assert a['at_ms'] + a['duration_ms'] <= b['at_ms']
