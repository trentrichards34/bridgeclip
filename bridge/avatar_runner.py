"""Avatar Studio finisher: captions, hook title and optional gameplay split.

Main writes one JSON request to stdin with the assembled avatar video, the
narration's estimated word timings and the look to apply. When `transcribe`
is set (and main passed an OpenRouter key), the audio is transcribed for exact
word timing, falling back to the estimate. The clip engine then renders it
like any other clip, so Avatar Studio videos match Create's presets.
"""
import asyncio
import json
import os
import re
import signal
import sys

from bridge_runner import reserve_stdout_for_protocol, emit

MAX_REQUEST = 262144
MAX_WORDS = 2000


def build_segments(words, duration_ms):
    """Sentence-sized transcript segments with word timings, clamped to the video."""
    from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord
    segments, current = [], []
    for item in words[:MAX_WORDS]:
        text = str(item.get('word', '')).strip()[:60]
        start = max(0, min(int(item.get('start_ms', 0)), duration_ms))
        end = max(start + 1, min(int(item.get('end_ms', start + 1)), duration_ms))
        if not text or start >= duration_ms:
            continue
        current.append(TranscriptWord(word=text, start_time_ms=start, end_time_ms=end))
        if re.search(r'[.!?]["\')\]]*$', text) or len(current) >= 18:
            segments.append(current)
            current = []
    if current:
        segments.append(current)
    return [
        TranscriptSegment(
            start_time_ms=group[0].start_time_ms, end_time_ms=group[-1].end_time_ms,
            text=' '.join(w.word for w in group), words=group,
        )
        for group in segments
    ]


async def transcript_segments(config, video, duration_ms):
    """Exact word timing from speech recognition, or the estimate from main."""
    estimated = build_segments(config.get('words') or [], duration_ms)
    if not config.get('transcribe'):
        return estimated, 'estimated' if estimated else 'none'
    import tempfile
    from clip_engine.services.transcription_service import TranscriptionService
    try:
        with tempfile.TemporaryDirectory(prefix='avatar-asr-') as work_dir:
            result = await TranscriptionService().transcribe(video, work_dir)
        segments = [s for s in result.segments if s.words and s.start_time_ms < duration_ms]
        if segments:
            return segments, 'transcribed'
    except Exception as error:  # noqa: BLE001 - fall back to the estimate
        print(f'Transcription failed, using estimated timing: {type(error).__name__}', file=sys.stderr)
    return estimated, 'estimated' if estimated else 'none'


async def finish(config):
    from clip_engine.config import LayoutStyle, get_caption_preset
    from clip_engine.services.clip_editor import Pacing
    from clip_engine.services.rendering_service import RenderingService, RenderRequest

    video, output = config['video'], config['output']
    duration_ms = int(config['duration_ms'])
    if duration_ms <= 0 or duration_ms > 10 * 60 * 1000:
        raise ValueError('Invalid duration')
    background = config.get('background_video') or None
    if background is not None and not os.path.isabs(background):
        raise ValueError('Invalid background')
    preset = str(config.get('caption_preset') or 'pop')
    try:
        style = get_caption_preset(preset)
    except Exception:
        style = get_caption_preset('pop')
    title = str(config.get('title') or '').strip()[:80] or None
    service = RenderingService()
    width, height = await service._get_video_dimensions(video)
    segments, timing = await transcript_segments(config, video, duration_ms) if config.get('include_captions', True) else ([], 'none')
    layout = LayoutStyle.AUTO if config.get('layout') == 'auto' else LayoutStyle.FILL
    request = RenderRequest(
        video_path=video, output_path=output, start_time_ms=0, end_time_ms=duration_ms,
        source_width=width or 1080, source_height=height or 1920,
        transcript_segments=segments or None,
        include_captions=bool(config.get('include_captions', True)) and bool(segments), caption_style=style,
        title_text=title, include_title=bool(config.get('include_title', True)) and title is not None,
        apply_padding=False, aspect_ratio='9:16', layout_style=layout,
        background_video_path=background, pacing=Pacing.NATURAL,
        progress_callback=lambda phase, percent: emit({'type': 'progress', 'phase': str(phase)[:40], 'percent': percent}),
    )
    result = await service.render_clip(request)
    return {'output': result.output_path, 'duration_ms': result.duration_ms, 'captions': timing}


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError('Request too large')
        config = json.loads(raw)
        for key in ('video', 'output'):
            if not isinstance(config.get(key), str) or not os.path.isabs(config[key]):
                raise ValueError('Invalid path')
        os.environ['LOCAL_MODE'] = 'true'
        from network_guard import install
        install()

        async def work():
            task = asyncio.current_task()
            if os.name != 'nt':
                asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
            return await finish(config)
        result = asyncio.run(work())
        emit({'ok': True, **result})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f'Avatar finish failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}', file=sys.stderr)
        except Exception:
            pass
        emit({'ok': False, 'error': 'render_failed' if type(error).__name__ == 'RenderingError' else 'failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
