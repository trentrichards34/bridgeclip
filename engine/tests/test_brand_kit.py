"""Brand kit in the engine: the brand text reaching Create's planner prompt (advisory),
the comment-keyword line in Create post captions, and the handle/logo overlay
(validated, placed in its corner at ~4% height and 70% opacity), on Create renders
and kept in a Remix edit bundle for re-making."""

import asyncio
import json
import os
import subprocess
from types import SimpleNamespace

import pytest
from PIL import Image

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services import brand_mark
from clip_engine.services import rendering_service as rendering_module
from clip_engine.services.ai_clipping_pipeline import AIClippingPipeline, ClippingJobRequest, JobStatus
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService, RenderRequest
from clip_engine.services.transcription_service import TranscriptionResult

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass
from .test_background_split import _mean
from .test_plan_boundaries import make_transcript

BRAND = ("Core promise: pull-ups for busy parents.\nVoice: plain, warm, no hype.\n"
         "Proof (real results only): Dana went from 0 to 5 pull-ups in 8 weeks.")


def test_brand_text_reaches_the_create_planner_as_advisory_context(monkeypatch, tmp_path):
    from unittest.mock import AsyncMock
    from clip_engine.services.intelligence_planner import BRAND_IDENTITY_RULE
    monkeypatch.setattr(RenderingService, '_verify_ffmpeg', lambda self: None)
    settings = pipeline_module.get_settings()
    monkeypatch.setattr(settings, 'local_mode', True)
    monkeypatch.setattr(settings, 'local_output_dir', str(tmp_path / 'out'))
    monkeypatch.setattr(type(settings), 'temp_directory', property(lambda self: str(tmp_path / 'work')))
    seen = []

    async def complete(**kwargs):
        system = kwargs['messages'][0]['content']
        user = ' '.join(part['text'] for part in kwargs['messages'][1]['content'] if part['type'] == 'text')
        seen.append((system, user))
        return ({'choices': [{'message': {'content': json.dumps({'insights': 'none', 'clips': []})}, 'finish_reason': 'stop'}]},
                {'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12, 'cost': .001})

    for brand in (BRAND, ''):
        pipeline = AIClippingPipeline()
        monkeypatch.setattr(pipeline.intelligence_planner, '_call_openrouter', AsyncMock(side_effect=complete))
        monkeypatch.setattr(pipeline.source_context_service, 'build', AsyncMock(return_value={'status': 'unavailable', 'source': {}, 'brief': None, 'research_status': 'disabled', 'citations': [], 'cost_usd': 0, 'requests': [], 'cost_incomplete': False}))
        monkeypatch.setattr(pipeline.video_downloader, 'download_video', AsyncMock(return_value=SimpleNamespace(
            video_path='fixture.mp4', file_size_bytes=1, metadata=SimpleNamespace(title='Pull-up tips', duration_seconds=60, width=1920, height=1080))))
        monkeypatch.setattr(pipeline.transcription_service, 'transcribe', AsyncMock(return_value=TranscriptionResult(segments=make_transcript(12), full_text='Tips.')))
        monkeypatch.setattr(pipeline.rendering_service, 'render_clip', AsyncMock())
        result = asyncio.run(pipeline.process_video(ClippingJobRequest(
            video_url='fixture.mp4', job_id='brand' if brand else 'plain', brand_identity=brand, brand_name='Pull-Up Lab')))
        assert result.status == JobStatus.FAILED  # the fixture plan is empty; only the prompt matters here
    (with_system, with_user), (plain_system, plain_user) = seen
    assert BRAND_IDENTITY_RULE in with_system and BRAND_IDENTITY_RULE not in plain_system
    assert json.dumps(BRAND, ensure_ascii=False)[1:-1] in with_user and 'Pull-Up Lab' in with_user
    assert 'CREATOR BRAND IDENTITY' not in plain_user
    # Advisory, never a source of facts or a sales pitch.
    assert 'Never put a result, number' in BRAND_IDENTITY_RULE and 'Do not mention the offer' in BRAND_IDENTITY_RULE


def test_request_normalizes_the_keyword_and_keeps_it_out_of_review_runs():
    request = ClippingJobRequest(video_url='x', cta_keyword=' sales ', cta_offer='  my   free plan ', brand_identity='  ' + BRAND + '  ',
                                 brand_mark={'handle': '@coach', 'logo_path': None, 'position': 'top-left'})
    assert (request.cta_keyword, request.cta_offer, request.brand_identity) == ('SALES', 'my free plan', BRAND)
    review = ClippingJobRequest(video_url='x', workflow='review', cta_keyword='SALES', brand_mark={'handle': '@c', 'logo_path': None, 'position': 'top-left'})
    assert (review.cta_keyword, review.brand_mark) == ('', None)
    with pytest.raises(ValueError):
        ClippingJobRequest(video_url='x', cta_keyword='two words')


def test_create_post_caption_ends_with_the_comment_keyword_line():
    from clip_engine.services.remix_service import cta_line as remix_cta_line
    segment = SimpleNamespace(summary='Your first pull-up', headline=None, tags=['pull ups', 'fitness', 'Pull Ups', 'busy parents'])
    caption = brand_mark.create_post_caption(segment, 'PULL', 'my 4-week plan.')
    assert caption == "Your first pull-up\n\n#PullUps #fitness #BusyParents\n\nComment PULL and I'll send you my 4-week plan."
    assert caption.endswith(remix_cta_line('PULL', 'my 4-week plan.'))
    assert brand_mark.create_post_caption(segment, '', 'x') is None
    assert brand_mark.create_post_caption(SimpleNamespace(summary='', headline='', tags=[]), 'SALES', '').endswith(
        "Comment SALES and I'll send you the full breakdown.")


def test_brand_mark_is_validated(tmp_path):
    logo = tmp_path / 'logo.png'
    Image.new('RGBA', (40, 20), (255, 255, 255, 255)).save(logo)
    assert brand_mark.validate_brand_mark(None) is None
    assert brand_mark.validate_brand_mark({'handle': '  @coach  name ', 'logo_path': None, 'position': 'top-right'}) == {
        'handle': '@coach name', 'logo_path': None, 'position': 'top-right'}
    # A logo that went missing is dropped; with no handle there's nothing to draw.
    assert brand_mark.validate_brand_mark({'handle': '', 'logo_path': str(tmp_path / 'gone.png'), 'position': 'top-left'}) is None
    assert brand_mark.validate_brand_mark({'handle': '', 'logo_path': str(logo)})['position'] == 'bottom-right'
    for bad in ({'handle': 'x' * 31}, {'handle': 'a\nb'}, {'handle': '@a', 'position': 'middle'}, {'handle': '@a', 'logo_path': 'logo.png'},
                {'handle': '@a', 'logo_path': str(tmp_path / 'logo.svg')}, {'handle': '@a', 'extra': 1}, 'x'):
        with pytest.raises(ValueError):
            brand_mark.validate_brand_mark(bad)


def test_mark_image_is_small_and_see_through(tmp_path):
    logo = tmp_path / 'logo.png'
    Image.new('RGBA', (300, 100), (255, 255, 255, 255)).save(logo)
    out = str(tmp_path / 'mark.png')
    w, h = brand_mark.mark_image({'handle': '', 'logo_path': str(logo), 'position': 'top-left'}, out, 1080, 1920)
    assert h == round(1920 * 0.04) and w == round(300 * h / 100)
    assert Image.open(out).getpixel((w // 2, h // 2))[3] == round(255 * 0.70)
    w2, h2 = brand_mark.mark_image({'handle': '@coachname', 'logo_path': str(logo), 'position': 'top-left'}, out, 1080, 1920)
    assert h2 == h and w2 > w and w2 <= round(1080 * 0.42)
    # Corners: below the hook text at the top, under the captions at the bottom, inside the margins.
    assert brand_mark.mark_position('top-left', 1080, 1920, 200, 77, top_from=400) == (40, 420)
    x, y = brand_mark.mark_position('bottom-right', 1080, 1920, 200, 77, captions_to=1450)
    assert x == 1080 - 200 - 40 and y >= 1450 and y + 77 <= 1920 * 0.90


def _dark_source(tmp_path, ffmpeg):
    path = tmp_path / 'dark.mp4'
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x202020:s=64x64:r=30:d=3',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'aac', '-shortest', str(path)],
                   check=True, timeout=120)
    return path


@needs_libass
def test_create_render_draws_the_logo_in_its_corner_and_the_keyword_at_the_end(tmp_path, monkeypatch):
    ffmpeg, _ = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(rendering_module, "get_output_dimensions", lambda *_: (360, 640))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    logo = tmp_path / 'logo.png'
    Image.new('RGBA', (100, 100), (255, 255, 255, 255)).save(logo)
    mark = {'handle': '', 'logo_path': str(logo), 'position': 'bottom-right'}
    request = RenderRequest(str(_dark_source(tmp_path, ffmpeg)), str(tmp_path / "clip.mp4"), 0, 3000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, include_title=False, brand_mark=mark, cta_keyword='SALES')
    result = asyncio.run(service.render_clip(request))
    assert result.render_fallback is None
    size = round(640 * 0.04)
    x, y = brand_mark.mark_position('bottom-right', 360, 640, size, size)
    inside = _mean(ffmpeg, result.output_path, 1.0, f"crop={size - 8}:{size - 8}:{x + 4}:{y + 4}")
    # White at 70% over the dark frame: clearly lighter than the video, clearly not solid white.
    assert 150 < inside.mean() < 225, inside
    for crop in (f"crop={size}:{size}:{360 - x - size}:{y}", f"crop={size}:{size}:{x}:20"):
        assert _mean(ffmpeg, result.output_path, 1.0, crop).mean() < 60  # the other corners stay as filmed
    # "Comment SALES": a white tag over the upper middle in the last seconds only.
    tag = f"crop=60:10:150:{round(640 * 0.30) + 8}"
    assert _mean(ffmpeg, result.output_path, 0.5, tag).mean() < 60
    assert _mean(ffmpeg, result.output_path, 2.6, tag).mean() > 150


def test_remix_keeps_the_mark_in_the_edit_bundle_for_re_making(tmp_path):
    from clip_engine.services.remix_service import RemixConfig, Remixer
    logo = tmp_path / '.brand-logo.png'
    Image.new('RGBA', (10, 10), (255, 255, 255, 255)).save(logo)
    remixer = Remixer.__new__(Remixer)
    remixer.config = RemixConfig(output_dir=str(tmp_path), brand_mark={'handle': '@coach', 'logo_path': str(logo), 'position': 'top-right'})
    tags: dict = {'style': 'silent'}
    assert remixer._brand_mark_tag(tags)['handle'] == '@coach'
    assert tags['brand_mark'] == {'handle': '@coach', 'logo': '.brand-logo.png', 'position': 'top-right'}
    # Re-making later: no mark in the config, the bundle's tags bring it back (the logo from the run folder).
    again = Remixer.__new__(Remixer)
    again.config = RemixConfig(output_dir=str(tmp_path))
    restored = again._brand_mark_tag(json.loads(json.dumps(tags)))
    assert restored == {'handle': '@coach', 'logo_path': os.path.join(os.path.realpath(tmp_path), '.brand-logo.png'), 'position': 'top-right'}
    # Older bundles have no mark; a tampered one is ignored.
    assert again._brand_mark_tag({'style': 'silent'}) is None
    assert again._brand_mark_tag({'brand_mark': {'handle': '@a', 'logo': '../../etc/x.png', 'position': 'top-left'}})['logo_path'] is None
    assert again._brand_mark_tag({'brand_mark': {'handle': '@a', 'position': 'nowhere'}}) is None
