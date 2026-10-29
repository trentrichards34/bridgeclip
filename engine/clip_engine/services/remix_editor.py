"""Open a finished Remix run in the clip editor.

A Remix video is composed by its own renderer (the borrowed moment beside or above the member's camera or AI
presenter, a pause-and-react cut, a screenshot box, the hook text bar, captions, credits and the graphics chosen in
the review). The clip editor's bake can't make those layouts again, so the editor works over the finished videos:

- the run's videos (each one as rendered, before any call to action was added: clip_NN.original.mp4 when there is
  one) are the editor's source, joined one after another when the run made several (one candidate each);
- captions and hook text are off in the editor (they are already in the picture), the brand mark and the run's
  music are not added again, and the words the video says (kept with each video's edit bundle) become the
  editor's transcript, so graphics added in the editor show only words that are said;
- each candidate is "baked" and replaces its Library video in place (same clip index), like an Automatic run's.

Opening and baking without changes gives the same video (made again at a higher bitrate, so the picture holds).
No AI is called. Everything is written under new names and the project file is committed last.
"""
import asyncio
import json
import os
import re
import shutil
from fractions import Fraction

from clip_engine.services.manual_editor import (
    EditorError, atomic_json, default_crop, failure_code, read_json, source_info, utf16_prefix, validate_candidate,
    validate_candidate_list,
)

MAX_VIDEOS = 100
# A caption line: at most this many words, and a new one after a pause this long.
LINE_WORDS = 12
LINE_GAP_MS = 600
CTA_ID = re.compile(r'[a-f0-9]{16}')
# The joined source is an intermediate the bake reads again: twice the bake's bitrate (a lower CRF on x264).
SOURCE_QUALITY = 2.0


def is_remix_output(output):
    metrics = output.get('metrics') if isinstance(output.get('metrics'), dict) else {}
    return metrics.get('remix') is True


def _video(run, name):
    path = run / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != run:
        return None
    return path


def remix_videos(run, output):
    """The run's videos in clip order: (Library clip, the file as rendered). Clips whose file is gone are left out."""
    clips = sorted((c for c in output.get('clips', []) if isinstance(c, dict) and type(c.get('clip_index')) is int
                    and 0 <= c['clip_index'] <= 999), key=lambda c: c['clip_index'])
    found = []
    for clip in clips:
        index = clip['clip_index']
        # The call to action is added after rendering (main keeps the video as rendered next to it): it is added again
        # after a bake, so the editor works from the video without it.
        path = _video(run, f'clip_{index:02d}.original.mp4') or _video(run, f'clip_{index:02d}.mp4')
        if path is not None:
            found.append((clip, path))
    return found[:MAX_VIDEOS]


def bundle_words(run, index, duration_ms):
    """The words a video says, as captioned (its edit bundle), in the video's own time; [] when it has none."""
    try:
        path = run / '.edit' / f'clip_{index:02d}' / 'edit.json'
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
            return []
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        words = data.get('words') if isinstance(data, dict) else None
        if not isinstance(words, list):
            return []
    except (OSError, ValueError):
        return []
    out = []
    for w in words[:20000]:
        if not (isinstance(w, list) and len(w) == 3 and isinstance(w[0], str) and all(type(v) in (int, float) for v in w[1:])):
            continue
        text = ' '.join(w[0].split())[:200]
        start, end = max(0, round(w[1])), min(duration_ms, round(w[2]))
        if text and start < duration_ms and end > start:
            out.append((text, start, end))
    out.sort(key=lambda w: w[1])
    return out


def caption_lines(words, offset_ms):
    """Words grouped into transcript lines (a pause, a sentence's end or LINE_WORDS words ends one), shifted by offset_ms."""
    lines, current = [], []

    def flush():
        if current:
            lines.append({'start_time_ms': current[0][1] + offset_ms, 'end_time_ms': current[-1][2] + offset_ms,
                          'text': ' '.join(w[0] for w in current),
                          'words': [{'word': w[0], 'start_time_ms': w[1] + offset_ms, 'end_time_ms': w[2] + offset_ms} for w in current]})
            current.clear()
    for word in words:
        if current and (word[1] - current[-1][2] > LINE_GAP_MS or len(current) >= LINE_WORDS):
            flush()
        current.append(word)
        if re.search(r'[.!?]["”’)]*$', word[0]):
            flush()
    flush()
    return lines


def plan_layout(infos, fps):
    """Where each video sits in the joined source: [(start_ms, end_ms, frames)], on whole frames."""
    rate = float(Fraction(fps))
    spans, frames_before = [], 0
    for info in infos:
        frames = max(1, round(info['duration'] * rate / 1000))
        start, end = round(frames_before * 1000 / rate), round((frames_before + frames) * 1000 / rate)
        spans.append((start, end, frames))
        frames_before += frames
    return spans


def build_remix_project(output, videos, infos, spans, words_by_clip, media_id):
    """The editor project for a Remix run's finished videos (no media written)."""
    width, height = infos[0]['width'], infos[0]['height']
    duration_ms = spans[-1][1]
    aspect = '9:16' if height > width else '16:9'
    crop = default_crop(width, height, 9 / 16 if aspect == '9:16' else 16 / 9)
    segments, candidates = [], []
    for (clip, _path), (start, end, _frames), words in zip(videos, spans, words_by_clip):
        index = clip['clip_index']
        segments += caption_lines([w for w in words if w[1] < end - start], start)
        title = ' '.join(str(clip.get('summary') or clip.get('headline') or '').split())
        cta = clip.get('cta') if isinstance(clip.get('cta'), dict) else None
        c = {'id': f'remix-{index:03d}', 'title': utf16_prefix(title, 200) or f'Video {index + 1}', 'ranges': [[start, end]],
             'scenes': [{'at_ms': 0, 'layout': 'fill', 'crops': [crop]}],
             # Already in the picture: drawn again they would show twice.
             'captions': False, 'caption_preset': 'pop', 'hook': None, 'video_speed': 1,
             'score': 0, 'requires_visual_context': False, 'reason': '', 'review': None,
             'exports': [index], 'status': 'baked', 'caption_edits': [], 'caption_suppression_ranges': [],
             'cta_id': cta['id'] if cta and isinstance(cta.get('id'), str) and CTA_ID.fullmatch(cta['id']) else None,
             'library_clip': index}
        candidates.append(c)
    for c in candidates:
        validate_candidate(c, duration_ms, len(segments))
    validate_candidate_list(candidates)
    rows = [{'start_ms': max(0, min(duration_ms, s['start_time_ms'])), 'end_ms': max(0, min(duration_ms, s['end_time_ms'])),
             'text': utf16_prefix(s['text'], 20000)} for s in segments]
    title = utf16_prefix(str(output.get('source_video_title') or 'Remix'), 1024)
    project = {'version': 1, 'revision': 0, 'title': title, 'width': width, 'height': height, 'duration_ms': duration_ms,
               'aspect_ratio': aspect, 'candidates': candidates, 'transcript': rows, 'headline_voice': 'creator',
               'automatic': {'omitted': [], 'estimated_cuts': 0, 'remix': True}, 'source_id': media_id}
    return project, {'segments': segments}


async def join_videos(paths, infos, spans, fps, target, renderer):
    """One source from the videos, one after another at the first one's size and frame rate (one high-quality encode).
    A single video is copied as it is."""
    if len(paths) == 1:
        await asyncio.to_thread(shutil.copyfile, paths[0], target)
        return
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media
    width, height = infos[0]['width'], infos[0]['height']
    rate = float(Fraction(fps))
    inputs, parts = [], []
    for i, (path, info, (_s, _e, frames)) in enumerate(zip(paths, infos, spans)):
        inputs += [*MEDIA_INPUT_OPTIONS, '-i', str(path)]
        seconds = frames / rate
        parts.append(f'[{i}:v:0]fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,'
                     f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,trim=end_frame={frames},setpts=PTS-STARTPTS[v{i}]')
        if info['audio']:
            parts.append(f'[{i}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end={seconds:.6f},asetpts=PTS-STARTPTS[a{i}]')
        else:
            parts.append(f'anullsrc=r=48000:cl=stereo,atrim=end={seconds:.6f},asetpts=PTS-STARTPTS[a{i}]')
    joined = ''.join(f'[v{i}][a{i}]' for i in range(len(paths)))
    graph = ';'.join(parts) + f';{joined}concat=n={len(paths)}:v=1:a=1[v][a]'
    renderer.quality_scale = SOURCE_QUALITY
    try:
        codec = renderer._video_codec_args(width, height, fps)
    finally:
        renderer.quality_scale = 1.0
    temporary = target.with_name(target.name + '.partial.mp4')
    try:
        await asyncio.to_thread(run_media, ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', graph,
                                            '-map', '[v]', '-map', '[a]', *codec, '-pix_fmt', 'yuv420p', '-r', str(fps),
                                            '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', str(temporary)],
                                check=True)
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


async def prepare_remix(run, config, report):
    """Make (or make again) a Remix run's editor project from its finished videos.

    config: media_id (32 hex); revision (making it again: the project's current revision, else absent for a first
    project). Writes editor-source-<id>.mp4, editor-preview-<id>.mp4 and transcript.json, then the project."""
    from clip_engine.services.rendering_service import RenderingService
    media_id = config['media_id']
    project_path = run / 'editor-project.json'
    again = config.get('revision')
    if again is None:
        if project_path.exists() or project_path.is_symlink():
            raise EditorError('project_changed', 'This run already has an editor project')
    else:
        current = read_json(run, 'editor-project.json')
        if current.get('revision') != again or not isinstance(current.get('automatic'), dict) or current['automatic'].get('remix') is not True:
            raise EditorError('project_changed', 'The editor project changed')
    output = read_json(run, 'job_output.json', 64 * 1024 * 1024)
    if not is_remix_output(output):
        raise ValueError('Not a Remix run')
    videos = remix_videos(run, output)
    if not videos:
        raise EditorError('source_missing', 'This run has no videos to edit')
    with failure_code('source_incompatible'):
        infos = [await asyncio.to_thread(source_info, path) for _clip, path in videos]
    with failure_code('engine_unavailable'):
        renderer = RenderingService()
    fps = await renderer._probe_fps(str(videos[0][1]))
    if len(videos) == 1:
        # Copied as it is: the source's own timing.
        spans = [(0, max(100, round(infos[0]['duration'])), 0)]
    else:
        spans = plan_layout(infos, fps)
    words = [bundle_words(run, clip['clip_index'], end - start) for (clip, _p), (start, end, _f) in zip(videos, spans)]
    with failure_code('invalid_edit'):
        project, transcript = build_remix_project(output, videos, infos, spans, words, media_id)
    source = run / f'editor-source-{media_id}.mp4'
    report('copy', 0)
    with failure_code('render_failed'):
        await join_videos([p for _c, p in videos], infos, spans, fps, source, renderer)
    report('copy', 100)
    with failure_code('source_incompatible'):
        info = await asyncio.to_thread(source_info, source)
    if info['width'] != project['width'] or info['height'] != project['height'] or info['duration'] < project['duration_ms'] - 100:
        raise EditorError('render_failed', 'The joined video is not the expected size or length')
    preview = run / f'editor-preview-{media_id}.mp4'
    with failure_code('render_failed'):
        await RenderingService().capture_framing_source(str(source), str(preview), progress=lambda p: report('preview', p),
                                                        duration_ms=project['duration_ms'])
    project['frame_preview'] = True
    if again is not None:
        current = read_json(run, 'editor-project.json')
        if current.get('revision') != again:
            raise EditorError('project_changed', 'The editor project changed')
        project['revision'] = again + 1
    elif project_path.exists() or project_path.is_symlink():
        raise EditorError('project_changed', 'This run already has an editor project')
    if len(json.dumps(project).encode('utf8')) > 32 * 1024 * 1024:
        raise EditorError('invalid_edit', 'Editor project is too large')
    atomic_json(run / 'transcript.json', transcript)
    atomic_json(project_path, project)
    return {'candidates': len(project['candidates'])}

