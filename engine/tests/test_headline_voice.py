import pytest

from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest
import re

from clip_engine.services.intelligence_planner import (CLIPPER_HEADLINE_LEAD, CREATOR_HEADLINE_LEAD, CREATOR_VOICE_RULE,
                                                       IntelligencePlannerService, headline_voice_rule)


def test_headlines_stay_third_person_unless_the_creator_posts_their_own_video():
    assert headline_voice_rule(None) == '' and headline_voice_rule('clipper') == ''
    rule = headline_voice_rule('creator')
    assert rule == CREATOR_VOICE_RULE and 'own channel' in rule and '"this founder"' in rule


def prompt_for(voice):
    planner = IntelligencePlannerService()
    if voice is not None:
        planner._headline_voice = voice
    return planner._build_system_prompt(clip_count=5, min_duration=20, max_duration=60)


def test_the_headline_section_and_template_follow_the_voice():
    # The default (and 'clipper') is unchanged: third person, with the clipper's examples.
    for voice in (None, 'clipper'):
        prompt = prompt_for(voice)
        assert 'Write it the way a clipper would caption the moment for someone scrolling past, in the third person:' in prompt
        assert '"headline": "<4-12 word third-person story headline>"' in prompt
        assert CLIPPER_HEADLINE_LEAD in prompt and CREATOR_HEADLINE_LEAD not in prompt
    creator = prompt_for('creator')
    headline = creator[creator.index('## HEADLINE'):creator.index('## CAPTION EMPHASIS')]
    assert 'third person' not in headline and 'third-person' not in creator and 'A 9-5 mechanic' not in creator
    assert 'in their own voice' in headline and '"this founder"' in headline
    assert '"headline": "<4-12 word story headline in the creator\'s own voice>"' in creator
    # Shared rules still apply in both voices.
    assert 'Use the real numbers exactly as said' in headline


def test_creator_voice_examples_carry_no_numbers_to_copy():
    for text in (CREATOR_VOICE_RULE, CREATOR_HEADLINE_LEAD):
        examples = re.findall(r'"([^"]+)"', text)
        assert examples and not any(re.search(r'\d', example) for example in examples)


def test_the_request_defaults_to_third_person_and_rejects_unknown_voices():
    assert ClippingJobRequest(video_url='https://example.com/v').headline_voice == 'clipper'
    assert ClippingJobRequest(video_url='https://example.com/v', headline_voice='creator').headline_voice == 'creator'
    with pytest.raises(ValueError, match='headline voice'):
        ClippingJobRequest(video_url='https://example.com/v', headline_voice='first')
