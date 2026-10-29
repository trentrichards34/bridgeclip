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

    def _finish_request(self, config):
        import asyncio
        from unittest import mock
        from clip_engine.services import rendering_service
        captured = {}

        class FakeService:
            async def _get_video_dimensions(self, video):
                return 1080, 1920

            async def render_clip(self, request):
                captured['request'] = request
                return mock.Mock(output_path=request.output_path, duration_ms=1000)

        with mock.patch.object(rendering_service, 'RenderingService', FakeService):
            asyncio.run(avatar_runner.finish({'video': '/in.mp4', 'output': '/out.mp4', 'duration_ms': 1000, 'include_captions': False, **config}))
        return captured['request']

    def test_hook_text_is_drawn_as_a_headline_in_the_chosen_look(self):
        look = {'look': 'brand', 'color': '#ff0000', 'font': 'serif'}
        request = self._finish_request({'title': 'Stop doing this', 'include_title': True, 'title_style': 'headline',
                                        'headline_text': 'Stop doing this', 'headline_look': look})
        self.assertEqual(request.title_style, 'headline')
        self.assertEqual(request.headline_text, 'Stop doing this')
        self.assertEqual(request.headline_look, {'look': 'brand', 'color': '#FF0000', 'font': 'serif'})
        self.assertTrue(request.include_title)

    def test_older_requests_keep_the_title_card_and_bad_looks_are_refused(self):
        request = self._finish_request({'title': 'Hook', 'include_title': True})
        self.assertEqual((request.title_style, request.headline_text, request.headline_look), ('card', None, None))
        with self.assertRaises(ValueError):
            self._finish_request({'title': 'Hook', 'title_style': 'headline', 'headline_look': {'look': 'rainbow'}})
        with self.assertRaises(ValueError):
            self._finish_request({'title': 'Hook', 'title_style': 'marquee'})


if __name__ == '__main__':
    unittest.main()
