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


def cta_in_picture(clip, path):
    """The file the editor uses already ends with the clip's call to action: "Free up space" removed its copy without
    one (clip_NN.original.mp4), so clip_NN.mp4 is all there is. Baking must not add it again."""
    cta = clip.get('cta')
    return not path.name.endswith('.original.mp4') and isinstance(cta, dict) and isinstance(cta.get('id'), str)


def words_path(run, index):
    """Where a Remix video's words are kept apart from its edit bundle (Free up space removes the bundle)."""
    return run / f'clip_{index:02d}.words.json'


def _read_words(path):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
            return None
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        words = data.get('words') if isinstance(data, dict) else None
        return words if isinstance(words, list) else None
    except (OSError, ValueError):
        return None


def bundle_words(run, index, duration_ms):
    """The words a video says, as captioned (its edit bundle, or the copy of its words kept when the bundle was freed),
    in the video's own time; [] when it has none."""
    words = _read_words(run / '.edit' / f'clip_{index:02d}' / 'edit.json')
    if words is None:
        words = _read_words(words_path(run, index))
    if words is None:
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
        in_picture = cta_in_picture(clip, _path)
        c = {'id': f'remix-{index:03d}', 'title': utf16_prefix(title, 200) or f'Video {index + 1}', 'ranges': [[start, end]],
             'scenes': [{'at_ms': 0, 'layout': 'fill', 'crops': [crop]}],
             # Already in the picture: drawn again they would show twice.
             'captions': False, 'caption_preset': 'pop', 'hook': None, 'video_speed': 1,
             'score': 0, 'requires_visual_context': False, 'reason': '', 'review': None,
             'exports': [index], 'status': 'baked', 'caption_edits': [], 'caption_suppression_ranges': [],
             'cta_id': cta['id'] if cta and not in_picture and isinstance(cta.get('id'), str) and CTA_ID.fullmatch(cta['id']) else None,
             'library_clip': index,
             # Where this video sits in the joined source (refreshing it after a Remix re-make swaps just this part).
             'remix_span': [start, end]}
        if in_picture:
            # Its call to action is already at the end of the picture: baking keeps it and never adds one again.
            c['cta_in_picture'] = True
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


def refresh_plan(project, output, run, indices):
    """The joined source's parts when some videos were re-made in Remix ("Edit hook text & captions") after the editor
    project was made: [(start_ms, end_ms, file or None)], end to end over the whole source, where None keeps that part
    of the current source and a file puts the re-made video there (fitted to the same length, so every clip's cut,
    graphics and timing stay). None when it can't be done that way (the editor's video is gone, or a re-made video has
    no place in the source); the project is then made again from the Library's videos."""
    if project.get('media_freed') or not isinstance(project.get('source_id'), str):
        return None
    source = _video(run, f"editor-source-{project['source_id']}.mp4")
    if source is None:
        return None
    clips = {c['clip_index']: c for c in output.get('clips', []) if isinstance(c, dict) and type(c.get('clip_index')) is int}
    duration = project['duration_ms']
    swaps = []
    for index in sorted(set(indices)):
        candidate = next((c for c in project['candidates'] if c.get('library_clip') == index and isinstance(c.get('remix_span'), list)), None)
        if candidate is None or index not in clips:
            return None
        start, end = candidate['remix_span']
        path = _video(run, f'clip_{index:02d}.original.mp4') or _video(run, f'clip_{index:02d}.mp4')
        if path is None or type(start) is not int or type(end) is not int or not 0 <= start < end <= duration:
            return None
        swaps.append((start, end, path))
    swaps.sort(key=lambda s: s[0])
    parts, at = [], 0
    for start, end, path in swaps:
        if start < at:
            return None
        if start > at:
            parts.append((at, start, None))
        parts.append((start, end, path))
        at = end
    if at < duration:
        parts.append((at, duration, None))
    return source, parts


async def refresh_source(source, parts, fps, width, height, target, renderer):
    """The joined source again, with the re-made videos in their places: kept parts are cut from the current source on
    whole frames, each re-made video is fitted to its part's frames (cut, or its last frame held). One encode."""
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media
    rate = float(Fraction(fps))
    frame = lambda ms: round(ms * rate / 1000)
    old_audio = (await asyncio.to_thread(source_info, source))['audio']
    inputs, graph, files = [*MEDIA_INPUT_OPTIONS, '-i', str(source)], [], 0
    kept = [i for i, part in enumerate(parts) if part[2] is None]
    if kept:
        # The current source feeds every kept part.
        graph.append(f'[0:v:0]split={len(kept)}' + ''.join(f'[s{i}]' for i in kept))
        if old_audio:
            graph.append(f'[0:a:0]asplit={len(kept)}' + ''.join(f'[t{i}]' for i in kept))
    look = f'fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p'
    for i, (start, end, path) in enumerate(parts):
        frames = max(1, frame(end) - frame(start))
        seconds = frames / rate
        if path is None:
            graph.append(f'[s{i}]trim=start_frame={frame(start)}:end_frame={frame(start) + frames},setpts=PTS-STARTPTS,{look}[v{i}]')
            audio = f'[t{i}]atrim=start={frame(start) / rate:.6f},asetpts=PTS-STARTPTS,' if old_audio else None
        else:
            files += 1
            info = await asyncio.to_thread(source_info, path)
            inputs += [*MEDIA_INPUT_OPTIONS, '-i', str(path)]
            graph.append(f'[{files}:v:0]{look},tpad=stop_mode=clone:stop_duration={seconds:.3f},trim=end_frame={frames},setpts=PTS-STARTPTS[v{i}]')
            audio = f'[{files}:a:0]' if info['audio'] else None
        if audio:
            graph.append(f'{audio}aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end={seconds:.6f},asetpts=PTS-STARTPTS[a{i}]')
        else:
            graph.append(f'anullsrc=r=48000:cl=stereo,atrim=end={seconds:.6f},asetpts=PTS-STARTPTS[a{i}]')
    joined = ''.join(f'[v{i}][a{i}]' for i in range(len(parts)))
    filters = ';'.join(graph) + f';{joined}concat=n={len(parts)}:v=1:a=1[v][a]'
    renderer.quality_scale = SOURCE_QUALITY
    try:
        codec = renderer._video_codec_args(width, height, fps)
    finally:
        renderer.quality_scale = 1.0
    temporary = target.with_name(target.name + '.partial.mp4')
    try:
        await asyncio.to_thread(run_media, ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', filters,
                                            '-map', '[v]', '-map', '[a]', *codec, '-pix_fmt', 'yuv420p', '-r', str(fps),
                                            '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', str(temporary)],
                                check=True)
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


async def refresh_remix(run, current, output, plan, media_id, report):
    """Put re-made videos into the editor project in place: a new joined source and preview, the same project (every
    clip's cut, graphics and other changes kept), the re-made clips' call to action as their files now have it."""
    from clip_engine.services.rendering_service import RenderingService
    source, parts = plan
    with failure_code('engine_unavailable'):
        renderer = RenderingService()
    fps = await renderer._probe_fps(str(source))
    target = run / f'editor-source-{media_id}.mp4'
    report('copy', 0)
    with failure_code('render_failed'):
        await refresh_source(source, parts, fps, current['width'], current['height'], target, renderer)
    report('copy', 100)
    with failure_code('source_incompatible'):
        info = await asyncio.to_thread(source_info, target)
    if info['width'] != current['width'] or info['height'] != current['height'] or info['duration'] < current['duration_ms'] - 100:
        raise EditorError('render_failed', 'The joined video is not the expected size or length')
    preview = run / f'editor-preview-{media_id}.mp4'
    with failure_code('render_failed'):
        await RenderingService().capture_framing_source(str(target), str(preview), progress=lambda p: report('preview', p),
                                                        duration_ms=current['duration_ms'])
    clips = {c['clip_index']: c for c in output['clips'] if isinstance(c, dict) and type(c.get('clip_index')) is int}
    remade = {path: start for start, _end, path in parts if path is not None}
    for c in current['candidates']:
        span = c.get('remix_span')
        index = c.get('library_clip')
        path = next((p for p, start in remade.items() if isinstance(span, list) and span[0] == start), None)
        if path is None or index not in clips:
            continue
        cta = clips[index].get('cta') if isinstance(clips[index].get('cta'), dict) else None
        if cta_in_picture(clips[index], path):
            c['cta_in_picture'] = True
            c['cta_id'] = None
        elif c.pop('cta_in_picture', None) and not c.get('cta_edited'):
            c['cta_id'] = cta['id'] if cta and isinstance(cta.get('id'), str) and CTA_ID.fullmatch(cta['id']) else None
    current['source_id'] = media_id
    current.pop('preview_id', None)
    current['frame_preview'] = True
    return current


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
    plan = refresh_plan(current, output, run, config['refresh']) if again is not None and config.get('refresh') else None
    if plan is not None:
        project = await refresh_remix(run, current, output, plan, media_id, report)
        latest = read_json(run, 'editor-project.json')
        if latest.get('revision') != again:
            raise EditorError('project_changed', 'The editor project changed')
        project['revision'] = again + 1
        atomic_json(project_path, project)
        return {'candidates': len(project['candidates']), 'refreshed': sum(1 for p in plan[1] if p[2] is not None)}
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

