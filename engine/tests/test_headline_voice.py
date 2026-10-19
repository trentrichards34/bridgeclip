import pytest

from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest
from clip_engine.services.intelligence_planner import CREATOR_VOICE_RULE, headline_voice_rule


def test_headlines_stay_third_person_unless_the_creator_posts_their_own_video():
    assert headline_voice_rule(None) == '' and headline_voice_rule('clipper') == ''
    rule = headline_voice_rule('creator')
    assert rule == CREATOR_VOICE_RULE and 'own channel' in rule and '"this founder"' in rule


def test_the_request_defaults_to_third_person_and_rejects_unknown_voices():
    assert ClippingJobRequest(video_url='https://example.com/v').headline_voice == 'clipper'
    assert ClippingJobRequest(video_url='https://example.com/v', headline_voice='creator').headline_voice == 'creator'
    with pytest.raises(ValueError, match='headline voice'):
        ClippingJobRequest(video_url='https://example.com/v', headline_voice='first')
