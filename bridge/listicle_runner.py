"""Top list videos (Avatar Studio → Top list): draw the frames and encode.

Main writes one JSON request to stdin: the list (header, accent color, handle,
captions on or off) and its parts in order (intro, items 1..N, end card), each
with its voiceover file, length and word timings, plus the output file and a
work folder. Progress goes to stdout as JSON lines; the last line is the result.
"""
import json
import os
import shutil
import sys

from bridge_runner import emit, reserve_stdout_for_protocol

MAX_REQUEST = 262144


def video_args():
    """The H.264 encoder the clip engine uses on this computer (OpenH264, x264 or VideoToolbox)."""
    from clip_engine.services.rendering_service import RenderingService
    service = RenderingService()
    service._verify_ffmpeg()
    return service._video_codec_args(1080, 1920, "30")


def run(config):
    from clip_engine.services.listicle_render import encode, parse_spec, render_frames
    output, work = config['output'], config['work_dir']
    spec = parse_spec(config)
    frames_dir = os.path.join(work, 'frames')
    shutil.rmtree(frames_dir, ignore_errors=True)
    emit({'type': 'progress', 'percent': 2})
    frames = render_frames(spec, frames_dir, lambda share: emit({'type': 'progress', 'percent': round(5 + share * 70)}))
    emit({'type': 'progress', 'percent': 78})
    encode(spec, frames, output, video_args(), ffmpeg=shutil.which('ffmpeg') or 'ffmpeg')
    shutil.rmtree(frames_dir, ignore_errors=True)
    emit({'type': 'progress', 'percent': 100})
    return {'output': output, 'duration_ms': spec.duration_ms}


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError('Request too large')
        config = json.loads(raw)
        for key in ('output', 'work_dir'):
            if not isinstance(config.get(key), str) or not os.path.isabs(config[key]):
                raise ValueError('Invalid path')
        os.environ['LOCAL_MODE'] = 'true'
        from network_guard import install
        install()
        emit({'ok': True, **run(config)})
        return 0
    except Exception as error:  # noqa: BLE001 - reported to main as a failed render
        try:
            from clip_engine.logging_safety import safe_log_text
            print(f'List video failed: {type(error).__name__}: {safe_log_text(str(error))[-500:]}', file=sys.stderr)
        except Exception:
            pass
        emit({'ok': False, 'error': 'failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
