"""Private worker: lay the motion graphics main rendered over a finished Create run's clips.

Main draws each graphic (Motion graphics: Auto) with the editor's templates into the run's .graphics/
folder, then runs this once per run with {run, library, clips: [{clip_index, graphics, sound?}], sound_palette?} on stdin
(sound: the clip's sound effects, mixed after its graphics; sound_palette: the member's own sounds). One
JSON line per finished clip ({"type": "progress", "clip_index", "ok", "done", "total"}), then {"ok": true, "done": [...],
"failed": [...]}. A clip that fails keeps its file as made.
"""
import asyncio
import json
import os
import signal
import sys
from pathlib import Path

from bridge_runner import emit, reserve_stdout_for_protocol


def main():
    reserve_stdout_for_protocol()
    try:
        from clip_engine.logging_safety import install_safe_logging
        install_safe_logging()
        raw = sys.stdin.read(1048577)
        if len(raw) > 1048576:
            raise ValueError('Request too large')
        config = json.loads(raw)
        if not isinstance(config, dict) or not isinstance(config.get('run'), str) or not isinstance(config.get('library'), str):
            raise ValueError('Invalid request')
        if not os.path.isabs(config['run']) or not os.path.isabs(config['library']):
            raise ValueError('Invalid request')
        raw_run = Path(config['run'])
        run = raw_run.resolve(strict=True)
        if raw_run.is_symlink() or run.parent != Path(config['library']).resolve(strict=True):
            raise ValueError('The run is outside the library')
        os.environ['LOCAL_MODE'] = 'true'
        from network_guard import install
        install()
        from clip_engine.services.graphics_overlay import overlay_run_clips

        async def work():
            task = asyncio.current_task()
            if os.name != 'nt':
                asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
            return await overlay_run_clips(run, config.get('clips'), lambda index, ok, done, total: emit({'type': 'progress', 'clip_index': index, 'ok': ok, 'done': done, 'total': total}),
                                           config.get('sound_palette'))
        result = asyncio.run(work())
        emit({'ok': True, 'done': result['done'], 'failed': result['failed']})
        return 0
    except (Exception, asyncio.CancelledError) as error:
        try:
            print(f'Graphics worker failed: {type(error).__name__}', file=sys.stderr)
        except Exception:
            pass
        emit({'ok': False})
        return 1


if __name__ == '__main__':
    sys.exit(main())
