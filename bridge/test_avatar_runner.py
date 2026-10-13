"""The Avatar Studio finisher turns narration timings into caption segments."""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'engine'))

import avatar_runner  # noqa: E402


class AvatarRunnerTests(unittest.TestCase):
    def test_words_group_into_sentences_clamped_to_the_video(self):
        words = [
            {'word': 'Stop', 'start_ms': 0, 'end_ms': 300},
            {'word': 'this.', 'start_ms': 300, 'end_ms': 700},
            {'word': 'Here', 'start_ms': 900, 'end_ms': 1100},
            {'word': 'is', 'start_ms': 1100, 'end_ms': 1200},
            {'word': 'why!', 'start_ms': 1200, 'end_ms': 5000},
            {'word': 'late', 'start_ms': 6000, 'end_ms': 6500},
            {'word': '   ', 'start_ms': 10, 'end_ms': 20},
        ]
        segments = avatar_runner.build_segments(words, 2000)
        self.assertEqual([s.text for s in segments], ['Stop this.', 'Here is why!'])
        self.assertEqual(segments[1].end_time_ms, 2000)
        for segment in segments:
            for word in segment.words:
                self.assertLess(word.start_time_ms, word.end_time_ms)

    def test_long_runs_without_punctuation_are_split(self):
        words = [{'word': f'w{i}', 'start_ms': i * 100, 'end_ms': i * 100 + 90} for i in range(40)]
        segments = avatar_runner.build_segments(words, 10_000)
        self.assertTrue(all(len(s.words) <= 18 for s in segments))
        self.assertEqual(sum(len(s.words) for s in segments), 40)

    def test_without_transcription_the_estimate_is_used(self):
        import asyncio
        words = [{'word': 'Hi.', 'start_ms': 0, 'end_ms': 400}]
        segments, timing = asyncio.run(avatar_runner.transcript_segments({'words': words, 'transcribe': False}, '/missing.mp4', 1000))
        self.assertEqual(timing, 'estimated')
        self.assertEqual(segments[0].text, 'Hi.')
        segments, timing = asyncio.run(avatar_runner.transcript_segments({'words': [], 'transcribe': False}, '/missing.mp4', 1000))
        self.assertEqual((segments, timing), ([], 'none'))


if __name__ == '__main__':
    unittest.main()
