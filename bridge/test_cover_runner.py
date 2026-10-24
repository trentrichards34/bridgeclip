"""Make my cover's worker answers one fixed line: frames, or {"ok": false} for anything it can't do."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNER = os.path.join(ROOT, 'bridge', 'cover_runner.py')


def run(request):
    env = {**os.environ, 'PYTHONPATH': os.path.join(ROOT, 'engine') + os.pathsep + os.path.join(ROOT, 'bridge')}
    out = subprocess.run([sys.executable, RUNNER], input=json.dumps(request), capture_output=True, text=True, env=env, timeout=120)
    lines = [json.loads(line) for line in out.stdout.splitlines() if line.strip()]
    return out.returncode, lines


class CoverRunnerTests(unittest.TestCase):
    def test_bad_requests_get_a_plain_failure(self):
        for request in ({'video': 'relative.mp4', 'out_dir': '/tmp/x'}, {'video': '/nope/missing.mp4', 'out_dir': '/tmp/x'},
                        {'video': '/tmp/a.mp4', 'out_dir': '/tmp/x', 'count': 99}, {'video': '/tmp/a.mp4', 'out_dir': '/tmp/x', 'count': True}):
            code, lines = run(request)
            self.assertEqual(code, 1)
            self.assertEqual(lines[-1], {'ok': False})


if __name__ == '__main__':
    unittest.main()
