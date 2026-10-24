"""Private worker: Make my cover. Main validates the paths (a video in the member's Library and its run's covers folder).

Request on stdin: {"video": abs path, "out_dir": abs path, "count": 1-6}. Progress lines {"type": "progress", "percent"},
then {"ok": true, "width", "height", "duration_ms", "frames": [{"at_ms", "path", "score", "face": [x, y, w, h]}]} or
{"ok": false}.
"""
import json
import os
import sys

from bridge_runner import emit, reserve_stdout_for_protocol


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(8193)
        if len(raw) > 8192:
            raise ValueError('Request too large')
        config = json.loads(raw)
        video, out_dir, count = config.get('video'), config.get('out_dir'), config.get('count', 3)
        if not isinstance(video, str) or not isinstance(out_dir, str) or not os.path.isabs(video) or not os.path.isabs(out_dir):
            raise ValueError('Invalid request')
        if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 6:
            raise ValueError('Invalid request')
        if not os.path.isfile(video):
            raise ValueError('Video missing')
        os.environ['LOCAL_MODE'] = 'true'
        from network_guard import install
        install()
        from clip_engine.services.cover_frames import cover_frames
        last = [-1]

        def progress(share):
            percent = int(share * 100)
            if percent >= last[0] + 5:
                last[0] = percent
                emit({'type': 'progress', 'percent': percent})
        result = cover_frames(video, out_dir, count, progress)
        emit({'ok': True, 'width': result['width'], 'height': result['height'], 'duration_ms': result['duration_ms'],
              'frames': [{k: f[k] for k in ('at_ms', 'path', 'score', 'face')} for f in result['frames']]})
        return 0
    except Exception as error:  # noqa: BLE001 - only a fixed failure line crosses the bridge
        try:
            print(f'Cover worker failed: {type(error).__name__}', file=sys.stderr)
        except Exception:
            pass
        emit({'ok': False})
        return 1


if __name__ == '__main__':
    sys.exit(main())
