"""Top list videos: the spec check, frame states and the drawn frames."""
import json
import os
import shutil
import subprocess

import pytest
from PIL import Image, ImageDraw

from clip_engine.services import listicle_render as L

ACCENT = (124, 231, 172)


def words(text, duration):
    parts = text.split()
    step = duration / len(parts)
    return [{'word': w, 'start_ms': int(i * step), 'end_ms': int((i + 0.9) * step)} for i, w in enumerate(parts)]


def screenshot(path, size=(1400, 900)):
    img = Image.new('RGB', size, (250, 250, 252))
    draw = ImageDraw.Draw(img)
    draw.rectangle((40, 700, 600, 800), fill=(10, 10, 10))
    img.save(path)
    return path


def spec_raw(tmp_path, count=3, **extra):
    shot = screenshot(str(tmp_path / 'shot.png'))
    items = [{'kind': 'item', 'index': i + 1, 'duration_ms': 2000, 'title': f'Tool {i + 1}', 'accent': f'{i + 1}',
              'words': words(f'Tool number {i + 1} does one thing well.', 1800)} for i in range(count)]
    items[0].update(image=shot, box={'x': 0.02, 'y': 0.75, 'w': 0.42, 'h': 0.15})
    return {'header': 'Web Lab · AI tools', 'accent_color': '#7CE7AC', 'handle': '@weblab', 'captions': True,
            'segments': [{'kind': 'intro', 'duration_ms': 1500, 'title': 'Three tools to try', 'accent': 'try', 'words': words('Three tools to try today.', 1400)},
                         *items, {'kind': 'end', 'duration_ms': 1200}], **extra}


def test_spec_checks_numbering_paths_boxes_and_length(tmp_path):
    spec = L.parse_spec(spec_raw(tmp_path))
    assert spec.count == 3 and spec.header == 'WEB LAB · AI TOOLS' and spec.accent_color == ACCENT
    assert spec.duration_ms == 1500 + 3 * 2000 + 1200
    raw = spec_raw(tmp_path)
    raw['segments'][2]['index'] = 5
    with pytest.raises(L.ListicleSpecError):
        L.parse_spec(raw)
    raw = spec_raw(tmp_path)
    raw['segments'][1]['image'] = 'relative/shot.png'
    with pytest.raises(L.ListicleSpecError):
        L.parse_spec(raw)
    raw = spec_raw(tmp_path)
    raw['segments'][1]['box'] = {'x': 0.8, 'y': 0.1, 'w': 0.5, 'h': 0.2}
    with pytest.raises(L.ListicleSpecError):
        L.parse_spec(raw)
    with pytest.raises(L.ListicleSpecError):
        L.parse_spec(spec_raw(tmp_path, count=2))
    # Unknown colors fall back to the default accent; control characters never reach the frame.
    spec = L.parse_spec({**spec_raw(tmp_path), 'accent_color': 'red', 'header': 'A\x00B'})
    assert spec.accent_color == L._hex(L.DEFAULT_ACCENT) and spec.header == 'A B'


def test_accent_word_is_found_or_falls_back_to_the_last_word():
    assert L.accent_index('Make your videos look different.', 'different') == 4
    assert L.accent_index('Collage B-roll', 'b-roll') == 1
    assert L.accent_index('Two: onetake', 'missing') == 1


def test_captions_sweep_word_by_word_and_clear_after_speech(tmp_path):
    spec = L.parse_spec(spec_raw(tmp_path))
    item = spec.segments[1]
    states = L.segment_states(item, 1, True)
    offsets = [offset for offset, _ in states]
    assert offsets == sorted(offsets) and offsets[0] == 0
    spoken = [state.spoken for _, state in states if state.chunk == 0]
    assert spoken == sorted(spoken) and spoken[-1] >= 3
    # The card pops in, then the highlight box lights up.
    assert states[0][1].pop < 1 and not states[0][1].box_on
    assert any(state.box_on for _, state in states)
    # No captions at all when they are off.
    assert all(state.chunk == -1 for _, state in L.segment_states(item, 1, False))
    rows = L.timeline(spec)
    assert sum(duration for _, duration, _ in rows) == spec.duration_ms


def test_frames_show_the_lit_chip_glowing_box_and_follow_button(tmp_path):
    spec = L.parse_spec(spec_raw(tmp_path))
    renderer = L.FrameRenderer(spec)
    states = L.segment_states(spec.segments[1], 1, True)
    lit = next(state for _, state in states if state.box_on and state.chunk == 0)
    frame = renderer.frame(lit)
    assert frame.size == (1080, 1920)
    pixels = frame.load()

    def accent_pixels(box):
        x0, y0, x1, y1 = box
        return sum(1 for x in range(x0, x1, 3) for y in range(y0, y1, 3)
                   if abs(pixels[x, y][0] - ACCENT[0]) < 30 and abs(pixels[x, y][1] - ACCENT[1]) < 30 and abs(pixels[x, y][2] - ACCENT[2]) < 30)
    # Chip 1 of 3 is lit in the accent color (chips row sits under the title).
    assert accent_pixels((400, 380, 500, 560)) > 50
    # The glowing box around the marked part of the screenshot, in the lower part of the card.
    assert accent_pixels((60, 900, 600, 1470)) > 100
    # Captions: some white words at the bottom.
    assert any(pixels[x, 1620][0] > 240 for x in range(200, 880, 2))
    end = renderer.frame(L.State(len(spec.segments) - 1, 1.0, False, -1, 0))
    assert sum(1 for x in range(300, 780, 4) if end.getpixel((x, 1000))[1] > 200) > 40


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='needs FFmpeg')
def test_encode_makes_a_video_with_the_voice_and_the_full_length(tmp_path):
    voice = str(tmp_path / 'voice.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.2', voice], check=True)
    raw = spec_raw(tmp_path)
    for segment in raw['segments']:
        if segment['kind'] != 'end':
            segment['audio'] = voice
    spec = L.parse_spec(raw)
    frames = L.render_frames(spec, str(tmp_path / 'frames'))
    out = str(tmp_path / 'out.mp4')
    L.encode(spec, frames, out, ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30'])
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out],
                                      check=True, capture_output=True).stdout)
    kinds = {stream['codec_type'] for stream in probe['streams']}
    assert kinds == {'video', 'audio'}
    video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
    assert (video['width'], video['height']) == (1080, 1920)
    assert abs(float(probe['format']['duration']) - spec.duration_ms / 1000) < 0.2
