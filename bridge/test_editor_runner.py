"""The editor worker reports fixed failure codes and logs only redacted detail."""

import asyncio
import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'engine'))

import editor_runner  # noqa: E402


class RenderingError(Exception):
    pass


class EditorRunnerTests(unittest.TestCase):
    def test_failures_map_to_fixed_codes(self):
        tagged = ValueError('Mark this clip ready before baking it')
        tagged.editor_code = 'not_ready'
        forged = ValueError('x')
        forged.editor_code = '/private/path'
        http = OSError('HTTP 404')
        http.code = 404
        cases = [(tagged, 'not_ready'), (forged, None), (http, None), (RenderingError('FFmpeg failed'), 'render_failed'),
                 (asyncio.CancelledError(), 'cancelled'), (ModuleNotFoundError('cv2'), 'engine_unavailable'),
                 (RuntimeError('boom'), None)]
        for error, code in cases:
            with self.subTest(error=error):
                self.assertEqual(editor_runner.failure_code(error), code)

    def test_failure_log_keeps_the_tail_and_redacts_paths_and_keys(self):
        try:
            try:
                raise RenderingError('FFmpeg failed: banner\n' + 'noise\n' * 20 +
                                     "Error opening /Users/someone/Library/clip.mp4 token=sk-or-secret\nNo such filter: 'perspective'")
            except RenderingError as cause:
                cause.editor_code = 'render_failed'
                raise ValueError('wrapped') from cause
        except ValueError as error:
            with self.assertLogs('editor_runner', 'ERROR') as logs:
                editor_runner.log_failure('export', 'render_failed', error)
        text = '\n'.join(logs.output)
        self.assertIn("No such filter: 'perspective'", text)
        self.assertIn('Editor export failed (render_failed)', text)
        self.assertNotIn('/Users/someone', text)
        self.assertNotIn('sk-or-secret', text)
        self.assertNotIn('banner', text)

    def test_invalid_request_emits_only_a_fixed_result(self):
        env = {**os.environ, 'PYTHONPATH': os.pathsep.join([os.path.join(ROOT, 'engine'), os.path.join(ROOT, 'bridge')]),
               'PYTHONDONTWRITEBYTECODE': '1'}
        request = json.dumps({'action': 'delete-everything', 'run': '/Users/someone/private'})
        result = subprocess.run([sys.executable, os.path.join(ROOT, 'bridge', 'editor_runner.py')], input=request,
                                capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {'ok': False, 'error': None})
        self.assertIn('Editor request failed (unknown)', result.stderr)
        self.assertNotIn('/Users/someone', result.stdout + result.stderr)

    def test_a_failure_reports_what_paid_calls_cost(self):
        error = RuntimeError('render failed')
        self.assertEqual(editor_runner.failure_message(error, 'render_failed'), {'ok': False, 'error': 'render_failed'})
        error.usage = {'cost_usd': 0.002, 'cost_incomplete': False, 'model': 'google/model', 'path': '/private'}
        self.assertEqual(editor_runner.failure_message(error, 'render_failed'),
                         {'ok': False, 'error': 'render_failed', 'cost_usd': 0.002, 'model': 'google/model'})

    def test_hook_ideas_fit_the_result_line(self):
        self.assertEqual(editor_runner.result_message(None), {'ok': True})
        idea = {'text': '日本語' * 60, 'grade': 'B', 'score': 7, 'hook_type': 'story', 'evidence': '証拠' * 120,
                'elements': {'qualifier': '前' * 100, 'main_statement': None, 'twist': None}, 'why': '理由' * 100}
        message = editor_runner.result_message({'hooks': [idea] * 5, 'cost_usd': 0.01, 'cost_incomplete': False, 'model': 'm', 'extra': 'no'})
        self.assertLessEqual(len(json.dumps(message)), editor_runner.MAX_RESULT_CHARS)
        self.assertTrue(message['ok'] and message['hooks'] and message['cost_usd'] == 0.01 and 'extra' not in message)
        self.assertEqual(message['hooks'][0]['why'], '')
        self.assertIn('hooks_unavailable', editor_runner.ERROR_CODES)
        self.assertIn('suggest-hooks', editor_runner.ACTIONS)

    def test_opening_an_automatic_run_has_its_own_action_and_codes(self):
        self.assertIn('prepare', editor_runner.ACTIONS)
        from clip_engine.services.manual_editor import EDITOR_ERROR_CODES
        for code in ('transcript_missing', 'source_changed', 'download_failed', 'translation_failed'):
            self.assertIn(code, editor_runner.ERROR_CODES)
            self.assertIn(code, EDITOR_ERROR_CODES)
        self.assertEqual(set(EDITOR_ERROR_CODES) | {'cancelled'}, set(editor_runner.ERROR_CODES))


if __name__ == '__main__':
    unittest.main()


def test_fix_layout_returns_the_scenes():
    import editor_runner
    assert 'fix-layout' in editor_runner.ACTIONS
    scenes = [{'scene': 'stage', 'start_ms': 0, 'end_ms': 5000, 'backdrop': 'dark', 'card': 'screen'}]
    assert editor_runner.result_message({'stage_scenes': scenes}) == {'ok': True, 'stage_scenes': scenes}
