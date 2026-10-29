"""Open an Automatic run in the clip editor.

An Automatic run renders its clips straight away. To edit one later (its
headline, cut, framing or captions), the run becomes an editor project built
from what it already made: one baked candidate per saved clip, using that
clip's source time ranges, framing, headline, captions, call to action and
speed as recorded. No AI is called and the chosen moments never change.

Exporting a candidate from such a project replaces its Library clip in place
(same clip index), so posted marks and the Library card stay attached.

The source video comes from main: the copy the run kept (editor-source.mp4),
a copy main made from the original local file (editor-source-<id>.mp4), or a
fresh download of the run's link. Everything is written under new names and
the project file is committed last, with one atomic rename.
"""
import asyncio
import json
import math
import os
import re
import shutil
import tempfile
from pathlib import Path

from clip_engine.services.auto_graphics import checked_saved, checked_saved_scenes
from clip_engine.services.manual_editor import (
    MAX_HOOK_CHARS, EditorError, atomic_json, default_crop, failure_code, local_file, media_name, read_json,
    scene_for_shot, source_info, utf16_prefix, validate_candidate, validate_candidate_list,
)


def saved_sound(raw, duration_ms):
    """A Create clip's recorded sound effects ({on, register, music_db?, cues}) as an editor candidate keeps them, or None."""
    if raw is None:
        return None
    from clip_engine.services.sound_design import validate_candidate_sound
    try:
        validate_candidate_sound(raw, duration_ms)
    except ValueError:
        return None
    return {k: raw[k] for k in ('on', 'register', 'music_db', 'cues') if k in raw}


# The editor's limits (validate_candidate, parseCandidateEdit in src/shared/clip-editor.ts).
MAX_RANGES = 24
MAX_SCENES = 60
MIN_RANGE_MS = 100
# Parts of an Automatic render the editor cannot make again (shown to the member).
OMITTED = ('broll', 'hook_preview', 'background', 'title_card')
HANDLE_POSITIONS = ('top-left', 'top-right', 'bottom-left', 'bottom-right')
CTA_ID = re.compile(r'[a-f0-9]{16}')
PRESET_ID = re.compile(r'[a-zA-Z0-9_-]{1,64}')
# A source downloaded again must match the run's (yt-dlp can differ by a frame or two).
DURATION_TOLERANCE_MS = 1500


def _bool(value):
    return value is True


def parse_settings(raw):
    """The run's Create settings as main sends them, checked."""
    from clip_engine.services.rendering_service import validate_headline_look
    if not isinstance(raw, dict):
        raise ValueError('Invalid run settings')
    aspect = raw.get('aspect_ratio')
    if aspect not in ('9:16', '16:9'):
        raise ValueError('Invalid aspect ratio')
    speed = raw.get('video_speed', 1)
    if type(speed) not in (int, float) or not math.isfinite(speed) or not 1 <= speed <= 2:
        raise ValueError('Invalid video speed')
    preset = raw.get('caption_preset') or 'pop'
    if not isinstance(preset, str) or not PRESET_ID.fullmatch(preset):
        raise ValueError('Invalid caption preset')
    keyword = raw.get('cta_keyword') or ''
    if not isinstance(keyword, str) or (keyword and not re.fullmatch(r'[A-Z0-9][A-Z0-9-]{1,19}', keyword)):
        raise ValueError('Invalid call-to-action keyword')
    offer = raw.get('cta_offer') or ''
    if not isinstance(offer, str) or len(offer) > 200 or any(ord(c) < 32 for c in offer):
        raise ValueError('Invalid call-to-action offer')
    mark = raw.get('brand_mark')
    if mark is not None:
        if (not isinstance(mark, dict) or set(mark) - {'handle', 'logo', 'position'} or not isinstance(mark.get('handle', ''), str)
                or len(mark.get('handle', '')) > 80 or any(ord(c) < 32 for c in mark.get('handle', ''))
                or type(mark.get('logo', False)) is not bool or mark.get('position', 'bottom-right') not in HANDLE_POSITIONS):
            raise ValueError('Invalid brand mark')
        mark = {'handle': ' '.join(mark.get('handle', '').split()), 'logo': mark.get('logo', False),
                'position': mark.get('position', 'bottom-right')}
        if not mark['handle'] and not mark['logo']:
            mark = None
    return {
        'aspect_ratio': aspect,
        'layout_style': raw.get('layout_style') if raw.get('layout_style') in ('auto', 'fill', 'fit') else 'auto',
        'include_captions': raw.get('include_captions', True) is not False,
        'caption_preset': preset,
        'include_title': raw.get('include_title', True) is not False,
        'title_style': 'headline' if raw.get('title_style') == 'headline' else 'card',
        'headline_look': validate_headline_look(raw.get('headline_look')),
        'video_speed': speed,
        'pacing': 'natural' if raw.get('pacing') == 'natural' else 'tight',
        'background': _bool(raw.get('background')),
        'broll': _bool(raw.get('broll')),
        'hook_preview': _bool(raw.get('hook_preview')),
        'headline_voice': 'creator' if raw.get('headline_voice') == 'creator' else 'clipper',
        'cta_keyword': keyword,
        'cta_offer': ' '.join(offer.split()),
        'brand_mark': mark,
    }


def omitted_parts(settings):
    """What the editor can't render again for this run (kept by clips the member doesn't re-export)."""
    parts = []
    if settings['broll']:
        parts.append('broll')
    if settings['hook_preview']:
        parts.append('hook_preview')
    if settings['background']:
        parts.append('background')
    if settings['include_title'] and not draws_headline(settings):
        parts.append('title_card')
    return parts


def draws_headline(settings):
    """Whether the run drew a headline (hook) above its clips, as run_hook decides."""
    return (settings['aspect_ratio'] == '9:16' and settings['title_style'] == 'headline'
            and settings['include_title'] and not settings['background'])


def clip_hook(settings, clip):
    """The clip's headline as drawn: its words and the run's look; None when the run drew none."""
    from clip_engine.services.rendering_service import parse_headline_look
    if not draws_headline(settings):
        return None
    words = clip.get('headline') if isinstance(clip.get('headline'), str) and clip['headline'].strip() else clip.get('summary')
    text = ' '.join(utf16_prefix(' '.join(str(words or '').split()), MAX_HOOK_CHARS).split())
    if not text or any(ord(char) < 32 for char in text):
        return None
    look = parse_headline_look(settings['headline_look'])
    return {'text': text, 'look': look.as_dict()}


def _int(value):
    return type(value) in (int, float) and math.isfinite(value)


def _ranges(value):
    """[[a, b], …] of numbers, or None."""
    if not isinstance(value, list) or not value:
        return None
    result = []
    for item in value:
        if not isinstance(item, (list, tuple)) or len(item) != 2 or not all(_int(n) for n in item):
            return None
        result.append([float(item[0]), float(item[1])])
    return result


def normalize_ranges(ranges, duration_ms):
    """Ordered, non-overlapping integer ranges of at least MIN_RANGE_MS inside the source, at most MAX_RANGES.

    Tight pacing can keep more pieces than the editor holds: the shortest gaps
    are closed first (a little pause comes back) so the clip keeps its words.
    """
    pieces = []
    for a, b in sorted(ranges):
        a, b = max(0, round(a)), min(duration_ms, round(b))
        if b - a <= 0:
            continue
        if pieces and a <= pieces[-1][1]:
            pieces[-1][1] = max(pieces[-1][1], b)
        else:
            pieces.append([a, b])
    while len(pieces) > MAX_RANGES:
        gap = min(range(len(pieces) - 1), key=lambda i: pieces[i + 1][0] - pieces[i][1])
        pieces[gap:gap + 2] = [[pieces[gap][0], pieces[gap + 1][1]]]
    # A sliver (under 0.1s) joins its neighbor instead of being dropped.
    i = 0
    while i < len(pieces) and len(pieces) > 1:
        if pieces[i][1] - pieces[i][0] < MIN_RANGE_MS:
            j = i - 1 if i > 0 and (i == len(pieces) - 1 or pieces[i][0] - pieces[i - 1][1] <= pieces[i + 1][0] - pieces[i][1]) else i + 1
            lo, hi = min(i, j), max(i, j)
            pieces[lo:hi + 1] = [[pieces[lo][0], pieces[hi][1]]]
            i = 0
            continue
        i += 1
    if len(pieces) == 1 and pieces[0][1] - pieces[0][0] < MIN_RANGE_MS:
        return []
    return pieces


def _box(value):
    from clip_engine.services.layout_analyzer import Box
    if not isinstance(value, list) or len(value) != 4 or not all(_int(n) for n in value):
        return None
    return Box(*[float(n) for n in value]).clamp()


def shot_from_summary(row):
    """A ShotLayout rebuilt from the summary the render recorded (window time)."""
    from clip_engine.services.layout_analyzer import LayoutType, ShotLayout
    if not isinstance(row, dict) or row.get('layout') not in LayoutType.ALL or not _int(row.get('start_ms')) or not _int(row.get('end_ms')):
        return None
    start, end = round(row['start_ms']), round(row['end_ms'])
    if end <= start or start < 0:
        return None
    people = [box for box in (_box(p) for p in (row.get('people') or [])[:4] if isinstance(row.get('people'), list)) if box]
    focus = row.get('focus')
    path = []
    if isinstance(focus, list) and len(focus) == 2 and all(_int(n) and 0 <= n <= 1 for n in focus):
        path = [(0, float(focus[0]), float(focus[1]))]
    elif row['layout'] == LayoutType.TALKING_HEAD and people:
        # Older runs recorded the people, not the crop's path: center on the main face.
        path = [(0, people[0].cx, people[0].cy)]
    return ShotLayout(start, end, row['layout'], source='saved', detected_layout=row['layout'], focus_path=path, people=people,
        screen_box=_box(row.get('screen_box')), screen_focus=_box(row.get('screen_focus')), cam_box=_box(row.get('cam_box')),
        content_box=_box(row.get('content_box')), crop_bounds=_box(row.get('crop_bounds')),
        cam_box_refined=row.get('cam_box_refined') is True)


def single_scene(settings, w, h, layout=None):
    aspect = 9 / 16 if settings['aspect_ratio'] == '9:16' else 16 / 9
    layout = layout or ('fit' if settings['layout_style'] == 'fit' else 'fill')
    return [{'at_ms': 0, 'layout': layout, 'crops': [default_crop(w, h, aspect)]}]


def clip_scenes(settings, layout_entry, shots, window_start, ranges, w, h, duration_ms):
    """The clip's framing as editor scenes (source time), as close to its render as the saved shots allow."""
    if settings['aspect_ratio'] != '9:16' or settings['layout_style'] == 'fit':
        return single_scene(settings, w, h)
    entry = layout_entry or {}
    if entry.get('render_fallback') or not shots:
        # Letterboxed (a fallback, or no analysis): the whole frame, fitted.
        return single_scene(settings, w, h, 'fit' if entry.get('render_fallback') or entry.get('layout_type') == 'fit' else None)
    start, end = ranges[0][0], ranges[-1][1]
    scenes = []
    for shot in shots:
        if len(scenes) >= MAX_SCENES:
            break
        at = window_start + shot.start_ms
        if window_start + shot.end_ms <= start or at >= end:
            continue
        try:
            scene = scene_for_shot(shot, len(scenes), window_start, w, h, settings['aspect_ratio'])
        except Exception:
            continue
        if scenes:
            scene['at_ms'] = max(round(at), 1)
            if scene['at_ms'] <= scenes[-1]['at_ms'] or scene['at_ms'] >= duration_ms:
                continue
        else:
            scene['at_ms'] = 0
        scenes.append(scene)
    return scenes or single_scene(settings, w, h)


def _window(clip, settings_padding, duration_ms):
    """The render window an older run used (padded unless Jev reviewed the clip)."""
    start, end = round(clip['start_time_ms']), round(clip['end_time_ms'])
    pad = 0 if isinstance(clip.get('editorial'), dict) and clip['editorial'] else max(0, settings_padding)
    window_start = max(0, start - pad)
    return window_start, min(duration_ms, end + pad) - window_start


def clip_ranges(clip, layout_entry, trace, audit_entry, settings, segments, shots, padding, duration_ms):
    """The source ranges the clip kept, best evidence first. Returns (ranges, how, window_start)."""
    from clip_engine.services.clip_editor import compute_keep_intervals, reaction_intervals, window_words
    from clip_engine.services.layout_analyzer import ClipLayoutPlan
    entry = layout_entry or {}
    window_start, window_ms = _window(clip, padding, duration_ms)
    if _int(entry.get('window_start_ms')):
        window_start = round(entry['window_start_ms'])
    kept = _ranges(entry.get('kept_source_ms'))
    if kept:
        return kept, 'recorded', window_start
    if isinstance(trace, dict) and isinstance(trace.get('window'), dict) and _int(trace['window'].get('start_ms')):
        keeps = _ranges(trace.get('keeps'))
        if keeps:
            start = trace['window']['start_ms']
            return [[start + a, start + b] for a, b in keeps], 'recorded', round(start)
    retained = _ranges(((audit_entry or {}).get('report') or {}).get('retained_source'))
    if retained:
        return retained, 'recorded', window_start
    if settings['pacing'] == 'tight' and segments and not entry.get('render_fallback') == 'letterbox_natural':
        # Older runs didn't save their cut: work out tight pacing again from the words' timing (no AI).
        words = window_words(segments, window_start, window_ms)
        if words:
            plan = ClipLayoutPlan(shots, 0, 0) if shots else None
            keeps = compute_keep_intervals(words, window_ms, plan, reaction_intervals(segments, window_start, window_ms))
            if keeps:
                return [[window_start + a, window_start + b] for a, b in keeps], 'estimated', window_start
    return [[window_start, window_start + window_ms]], 'natural', window_start


def _json_file(run, name, limit=32 * 1024 * 1024):
    try:
        return read_json(run, name, limit)
    except (OSError, ValueError):
        return None


# A start or end moved by less than this is the cut snapping to words (edit-log.ts EDGE_MIN_MS): no words are quoted.
EDGE_MIN_MS = 400
QUOTE_WORDS = 4


def span_words(segments, start_ms, end_ms):
    """Up to QUOTE_WORDS words said between start_ms and end_ms (a word counts when its middle is inside), '…' when there are more."""
    if end_ms - start_ms < EDGE_MIN_MS:
        return None
    words = []
    for segment in segments:
        if segment.end_time_ms <= start_ms or segment.start_time_ms >= end_ms:
            continue
        for word in segment.words or []:
            middle = (word.start_time_ms + word.end_time_ms) / 2
            text = ' '.join(str(word.word or '').split())
            if start_ms <= middle < end_ms and text and not any(ord(c) < 32 for c in text):
                words.append(text)
    if not words:
        return None
    return utf16_prefix(' '.join(words[:QUOTE_WORDS]) + ('…' if len(words) > QUOTE_WORDS else ''), 120)


def auto_baseline(clip, audit_entry, ranges, how, segments, candidate, duration_ms):
    """What the run's automatic pass did to this clip, for the editor's "What changed" list (edit-log.ts).

    The cut is only recorded when the run saved it (not worked out again), and the
    picked moment is the planner's interval before Jev moved its edges (edit_audit.json),
    else the clip's own start and end.
    """
    baseline = {'hook': candidate['hook']['text'] if candidate.get('hook') else None, 'captions': bool(candidate['captions']),
                'caption_preset': candidate['caption_preset'],
                'split_at': [s['at_ms'] for s in candidate['scenes'] if s.get('layout') == 'split']}
    if how != 'recorded':
        return baseline
    baseline['ranges'] = [list(r) for r in ranges]
    interval = (audit_entry or {}).get('original_interval')
    if not (isinstance(interval, list) and len(interval) == 2 and all(_int(n) for n in interval)):
        interval = [clip['start_time_ms'], clip['end_time_ms']]
    a, b = max(0, round(interval[0])), min(duration_ms, round(interval[1]))
    if b - a < MIN_RANGE_MS:
        return baseline
    baseline['moment'] = [a, b]
    if (before := span_words(segments, a, ranges[0][0])):
        baseline['before_words'] = before
    if (after := span_words(segments, ranges[-1][1], b)):
        baseline['after_words'] = after
    return baseline


def build_candidates(run, output, settings, segments, w, h, duration_ms, padding):
    """One baked candidate per saved clip (at most 100), in clip order."""
    from clip_engine.services.caption_translation import CAPTION_LANGUAGES
    metrics = output.get('metrics') if isinstance(output.get('metrics'), dict) else {}
    layouts = {e.get('clip_index'): e for e in metrics.get('clip_layouts', []) if isinstance(e, dict)} if isinstance(metrics.get('clip_layouts'), list) else {}
    audit = _json_file(run, 'edit_audit.json') or {}
    audit_entries = {e.get('clip_index'): e for e in audit.get('candidates', []) if isinstance(e, dict) and e.get('status') == 'rendered'} \
        if isinstance(audit.get('candidates'), list) else {}
    captions = settings['include_captions'] and metrics.get('captions_status') != 'unavailable_without_transcript'
    # 'estimated': a clip whose cut wasn't saved (a tight-paced clip shown at natural length when it couldn't be worked out
    # counts too); main's lacksRecordedCuts (edit-automatic.ts) asks the same question before converting.
    candidates, notes = [], {'estimated': 0}
    clips = sorted((c for c in output.get('clips', []) if isinstance(c, dict) and type(c.get('clip_index')) is int
                    and 0 <= c['clip_index'] <= 999 and _int(c.get('start_time_ms')) and _int(c.get('end_time_ms'))),
                   key=lambda c: c['clip_index'])
    for clip in clips[:100]:
        index = clip['clip_index']
        if not (run / f'clip_{index:02d}.mp4').is_file():
            continue
        entry = layouts.get(index)
        shots = [s for s in (shot_from_summary(row) for row in (entry or {}).get('shots', [])[:200]) if s] if entry else []
        trace = _json_file(run, f'clip_{index:02d}.framing.json', 8 * 1024 * 1024)
        raw, how, window_start = clip_ranges(clip, entry, trace, audit_entries.get(index), settings, segments, shots, padding, duration_ms)
        ranges = normalize_ranges(raw, duration_ms)
        if not ranges:
            continue
        hook = clip_hook(settings, clip)
        cta = clip.get('cta') if isinstance(clip.get('cta'), dict) else None
        language = clip.get('caption_language') if clip.get('caption_language') in CAPTION_LANGUAGES else None
        title = utf16_prefix(' '.join(str(clip.get('summary') or '').split()), 200) or f'Clip {index + 1}'
        score = clip.get('virality_score')
        c = {'id': f'clip-{index:03d}', 'title': title, 'ranges': ranges,
             'scenes': clip_scenes(settings, entry, shots, window_start, ranges, w, h, duration_ms),
             'score': max(0, min(100, score)) if _int(score) else 0, 'requires_visual_context': False, 'reason': '',
             'captions': captions, 'caption_preset': settings['caption_preset'], 'video_speed': settings['video_speed'],
             'exports': [index], 'review': None, 'status': 'baked', 'caption_edits': [], 'caption_suppression_ranges': [],
             'hook': hook, 'cta_id': cta['id'] if cta and isinstance(cta.get('id'), str) and CTA_ID.fullmatch(cta['id']) else None,
             'library_clip': index, **({'caption_language': language} if language else {}),
             # Motion graphics the run drew on the clip (Motion graphics: Auto), editable in the Graphics row.
             **({'graphics': graphics} if (graphics := checked_saved((entry or {}).get('graphics'), duration_ms)) else {}),
             # Stage layouts the run drew (source time), shown in the Scenes row.
             **({'stage_scenes': stages} if (stages := checked_saved_scenes((entry or {}).get('stage_scenes'), duration_ms)) else {}),
             # Sound effects the run mixed into the clip (they follow its graphics and scenes, so a re-bake keeps them).
             **({'sound': sound} if (sound := saved_sound((entry or {}).get('sound'), duration_ms)) else {})}
        try:
            validate_candidate(c, duration_ms, len(segments))
        except (ValueError, TypeError, KeyError):
            # Unusable saved framing: keep the cut, frame the whole clip simply.
            c['scenes'] = single_scene(settings, w, h)
            try:
                validate_candidate(c, duration_ms, len(segments))
            except (ValueError, TypeError, KeyError):
                continue
        c['auto'] = auto_baseline(clip, audit_entries.get(index), ranges, how, segments, c, duration_ms)
        if how == 'estimated' or (how == 'natural' and settings['pacing'] == 'tight'
                                  and (entry or {}).get('render_fallback') != 'letterbox_natural'):
            notes['estimated'] += 1
        candidates.append(c)
    return candidates, notes


def build_project(run, settings, source, segments, transcript_rows, output, padding):
    """The editor project for an Automatic run (no media written)."""
    info = source_info(source)
    duration_ms = round(info['duration'])
    expected = output.get('source_video_duration_seconds')
    if _int(expected) and expected > 0 and abs(expected * 1000 - duration_ms) > max(DURATION_TOLERANCE_MS, expected * 10):
        raise EditorError('source_changed', 'The source video is not the one this run used')
    w, h = info['width'], info['height']
    candidates, notes = build_candidates(run, output, settings, segments, w, h, duration_ms, padding)
    if not candidates:
        raise EditorError('invalid_edit', 'No clips could be opened in the editor')
    validate_candidate_list(candidates)
    automatic = {'omitted': omitted_parts(settings), 'estimated_cuts': notes['estimated']}
    if settings['brand_mark']:
        automatic['brand_mark'] = settings['brand_mark']
    if settings['cta_keyword']:
        automatic['cta_keyword'] = settings['cta_keyword']
        if settings['cta_offer']:
            automatic['cta_offer'] = settings['cta_offer']
    title = utf16_prefix(str(output.get('source_video_title') or ''), 1024)
    return {'version': 1, 'revision': 0, 'title': title, 'width': w, 'height': h, 'duration_ms': duration_ms,
            'aspect_ratio': settings['aspect_ratio'], 'candidates': candidates, 'transcript': transcript_rows,
            'headline_voice': settings['headline_voice'], 'automatic': automatic}


def read_transcript(run):
    """The run's saved transcript as segments and editor rows; EditorError when there is none."""
    from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord
    try:
        rows = read_json(run, 'transcript.json')['segments']
        def timing(item):
            return {**item, 'start_time_ms': round(item['start_time_ms']), 'end_time_ms': round(item['end_time_ms'])}
        segments = [TranscriptSegment(**{**timing(s), 'words': [TranscriptWord(**timing(w)) for w in s.get('words', [])]}) for s in rows]
    except Exception as error:
        raise EditorError('transcript_missing', 'This run has no saved transcript') from error
    return segments


def editor_rows(segments, duration_ms):
    return [{'start_ms': max(0, min(duration_ms, s.start_time_ms)), 'end_ms': max(0, min(duration_ms, s.end_time_ms)),
             'text': utf16_prefix(s.text, 20000)} for s in segments][:100000]


async def download_source(run, url, media_id, progress):
    """Download the run's link again into editor-source-<id>.mp4 (no transcription, no AI)."""
    from clip_engine.services.video_downloader import VideoDownloaderService
    target = run / media_name('source', media_id)
    work = Path(tempfile.mkdtemp(prefix='.editor-download-', dir=run))
    loop = asyncio.get_running_loop()
    try:
        downloader = VideoDownloaderService()
        downloader.progress_callback = lambda _label, percent, *_: loop.call_soon_threadsafe(progress, 'download', percent) \
            if percent is not None else None
        try:
            result = await downloader.download_video(url=url, output_dir=str(work))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            raise EditorError('download_failed', 'The video could not be downloaded again') from error
        os.replace(result.video_path, target)
        os.chmod(target, 0o600)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return target


async def prepare(config, progress=None):
    """Convert an Automatic run into an editor project, or bring back a converted project's source.

    config: run, library, media_id (32 hex), mode ('convert' | 'restore'),
    source ('kept' | 'file' | 'download'), url (download), settings (convert),
    revision (restore).
    """
    from clip_engine.config import get_settings
    from clip_engine.services.rendering_service import RenderingService
    def report(phase, percent):
        if progress and percent is not None:
            progress({'phase': phase, 'percent': max(0, min(100, float(percent)))})
    raw_run = Path(config['run'])
    run = raw_run.resolve(strict=True)
    if raw_run.is_symlink() or run.parent != Path(config['library']).resolve(strict=True):
        raise ValueError('Editor project is outside the library')
    media_id = config.get('media_id')
    if not isinstance(media_id, str) or not re.fullmatch(r'[a-f0-9]{32}', media_id):
        raise ValueError('Invalid media id')
    mode, kind = config.get('mode'), config.get('source')
    if mode == 'remix':
        # A Remix run: the editor works over its finished videos (remix_editor.py).
        from clip_engine.services.remix_editor import prepare_remix
        again = config.get('revision')
        if again is not None and (type(again) is not int or again < 0):
            raise ValueError('Invalid editor preparation')
        return await prepare_remix(run, {'media_id': media_id, 'revision': again}, report)
    if mode not in ('convert', 'restore') or kind not in ('kept', 'file', 'download'):
        raise ValueError('Invalid editor preparation')
    project_path = run / 'editor-project.json'
    project = None
    if mode == 'convert':
        if project_path.exists() or project_path.is_symlink():
            raise EditorError('project_changed', 'This run already has an editor project')
        settings = parse_settings(config.get('settings'))
    else:
        project = read_json(run, 'editor-project.json')
        if project.get('version') != 1 or project.get('revision') != config.get('revision') or not isinstance(project.get('automatic'), dict):
            raise EditorError('project_changed', 'The editor project changed')
    # 1. The source video.
    if kind == 'kept':
        if mode != 'convert':
            raise ValueError('A kept copy only opens a new project')
        with failure_code('source_missing'):
            source = local_file(run, 'editor-source.mp4')
    elif kind == 'file':
        with failure_code('source_missing'):
            source = local_file(run, media_name('source', media_id))
    else:
        url = config.get('url')
        if not isinstance(url, str) or not re.match(r'https?://', url) or len(url) > 8192:
            raise ValueError('Invalid source link')
        source = await download_source(run, url, media_id, report)
    with failure_code('source_incompatible'):
        info = await asyncio.to_thread(source_info, source)
    # 2. The project (convert) or its new source (restore).
    if mode == 'convert':
        output = read_json(run, 'job_output.json', 64 * 1024 * 1024)
        segments = read_transcript(run)
        duration_ms = round(info['duration'])
        project = await asyncio.to_thread(build_project, run, settings, source, segments, editor_rows(segments, duration_ms),
                                          output, get_settings().audio_padding_ms)
        if kind == 'kept':
            project['preview_id'] = media_id
        else:
            project['source_id'] = media_id
    else:
        if abs(info['duration'] - project['duration_ms']) > DURATION_TOLERANCE_MS or \
                abs((info['width'] / info['height']) / (project['width'] / project['height']) - 1) > .005:
            raise EditorError('source_changed', 'The source video is not the one this project used')
        project.pop('preview_id', None)
        project.pop('media_freed', None)
        project.update(source_id=media_id, width=info['width'], height=info['height'], revision=project['revision'] + 1)
    # 3. The preview the editor plays (a new name, so nothing open is replaced).
    preview = run / media_name('preview', media_id)
    with failure_code('render_failed'):
        await RenderingService().capture_framing_source(str(source), str(preview), progress=lambda p: report('preview', p),
                                                        duration_ms=project['duration_ms'])
    project['frame_preview'] = True
    # 4. Commit: one atomic write. A restore checks nobody changed the project meanwhile.
    if mode == 'restore':
        current = read_json(run, 'editor-project.json')
        if current.get('revision') != config.get('revision'):
            raise EditorError('project_changed', 'The editor project changed')
    elif project_path.exists() or project_path.is_symlink():
        raise EditorError('project_changed', 'This run already has an editor project')
    if len(json.dumps(project).encode('utf8')) > 32 * 1024 * 1024:
        raise EditorError('invalid_edit', 'Editor project is too large')
    atomic_json(project_path, project)
    return {'candidates': len(project['candidates'])}
