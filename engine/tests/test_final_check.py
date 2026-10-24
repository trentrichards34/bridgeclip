"""Fixes from the final quality check on real footage (an edited reel of a creator talking about ads and a sales page):
the planner's hints quote a number said once (not "$4,365 $4,365") and cut at a word; a page named by what it is ("sales
page") is where the member's screenshot shows; the member's logo pops in where the call to action names it (their own
product) while the planner's graphics stay off the call to action; and a logo pop gives way to the ask's graphic."""
from clip_engine.services import edit_direction as ed
from clip_engine.services import edit_recording as er
from clip_engine.services import graphics_director as gd
from clip_engine.services import spoken_cta as sc
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def seg(text, start_s, step=0.35):
    words, t = [], start_s
    for token in text.split():
        words.append(TranscriptWord(token, round(t * 1000), round((t + step - 0.05) * 1000)))
        t += step
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def say(text, start, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


def test_hints_quote_a_number_once_and_cut_at_a_word():
    talk = [seg('Yesterday I spent $4,365 on ads promoting my product.', 1),
            seg('I am a virtual nobody when it comes to the internet and everything on it.', 6)]
    money = next(c for c in gd.find_cues(talk) if c['kind'] == 'money')
    assert money['text'] == 'spent $4,365 on ads'
    hints = gd.cue_hints(talk)
    assert '$4,365 $4,365' not in hints and '"spent $4,365 on ads"' in hints
    identity = next(line for line in hints.split('\n') if ' identity ' in line)
    quoted = identity.split('"')[1]
    assert quoted.endswith('…') and len(quoted) <= 51 and quoted[:-1].split(' ')[-1] in 'I am a virtual nobody when it comes to the internet'.split(' ')


def test_a_sales_page_said_is_where_the_screenshot_shows():
    talk = [seg('We spent money on ads.', 1), seg("We need a sales page that's actually going to get people to buy.", 5), seg('That is the whole plan.', 11)]
    assert any(c['kind'] == 'screen' for c in gd.find_cues(talk))
    (frame,) = [g for g in gd.place_media([], talk, [{'id': 'aaaaaaaaaaaa'}]) if g['template'] == 'fx']
    assert frame['fields'] == {'effect': 'browser-device-stage', 'image': 'aaaaaaaaaaaa'}
    assert 4500 <= frame['at_ms'] <= 5500
    assert "the member's screenshot" in gd.cue_hints(talk, media=True)
    # Without screenshots it is only a hint (the planner never places a picture effect).
    assert gd.place_media([], talk, None) == []


def test_the_members_logo_pops_where_the_call_to_action_names_it_and_planned_graphics_stay_off_it():
    words = (say('Most people never go viral on the internet.', 0.0) + say('Yesterday I spent 4,365 dollars on ads.', 4.0)
             + say('So focus on a really good offer for buyers.', 9.0) + say('Get access to my Product Suite platform for free today.', 14.0))
    marks = [None] * len(words)
    cta = (next(i for i, w in enumerate(words) if w.text == 'Get'), len(words) - 1)
    hook = (0, 7)
    logos = [{'image': 'aaaaaaaaaaaaaaaa', 'name': 'Product Suite', 'aliases': []}]
    on_cta = {'template': 'fx', 'word': cta[0] + 2, 'seconds': 2.5, 'placement': 'top', 'effect': 'headline-slam',
              'fx_fields': [{'key': 'text', 'value': 'my Product Suite platform'}]}
    for k in ('value', 'label', 'text', 'title', 'before', 'after', 'author', 'name', 'role', 'accent', 'subline', 'final', 'phrase',
              'keyword', 'lead', 'wrong', 'icon'):
        on_cta[k] = ''
    on_cta.update(items=[], icons=[], notes=[])
    out = ed.plan_graphics([on_cta], words, marks, {'stage': True, 'register': 'teaching', 'logos': logos}, [hook, cta], logos_in=[cta])
    assert [g['template'] for g in out] == ['logo']
    assert out[0]['fields']['image'] == 'aaaaaaaaaaaaaaaa' and cta[0] <= out[0]['word'] <= cta[1]
    # Without the opening (as before): no logo on the call to action either.
    assert ed.plan_graphics([on_cta], words, marks, {'stage': True, 'register': 'teaching', 'logos': logos}, [hook, cta]) == []


def test_a_logo_pop_gives_way_to_the_asks_graphic():
    cta = {'id': 'g-cta000001', 'template': 'link_cta', 'at_ms': 10_000, 'duration_ms': 3000, 'placement': 'bottom', 'fields': {'text': 'Hit the link'}, 'origin': 'auto'}
    early = {'id': 'g-logo00001', 'template': 'logo', 'at_ms': 8500, 'duration_ms': 1500 + 400, 'placement': 'middle', 'fields': {'image': 'x.png'}, 'origin': 'member'}
    during = {'id': 'g-logo00002', 'template': 'logo', 'at_ms': 10_500, 'duration_ms': 1500, 'placement': 'middle', 'fields': {'image': 'x.png'}, 'origin': 'member'}
    out = sc.with_cta([early, during], cta)
    assert [g['id'] for g in out] == ['g-logo00001', 'g-cta000001']
    assert out[0]['at_ms'] + out[0]['duration_ms'] <= cta['at_ms']
    # The member's other graphics still keep their time (the ask's graphic is left out then).
    mine = {**during, 'template': 'stat', 'fields': {'value': '3'}}
    assert sc.with_cta([mine], cta) == [mine]


def test_the_edit_runner_takes_the_direction_main_sends():
    import pytest
    import edit_runner
    full = {"stage": True, "cta_keyword": "GUIDE", "register": "story",
            "logos": [{"image": "a1b2c3d4e5f60718", "name": "Product Suite", "aliases": ["the suite"]}],
            "media": [{"id": "abcdef123456", "box": [0.1, 0.2, 0.3, 0.1], "tall": True}, {"id": "0123456789ab"}]}
    assert edit_runner._direction(full) == full
    assert edit_runner._direction({"stage": True}) == {"stage": True, "cta_keyword": ""}
    for bad in ({"register": "loud"}, {"logos": [{"image": "../logo.png", "name": "X"}]}, {"logos": [{"image": "a1b2c3d4e5f60718", "name": ""}]},
                {"media": [{"id": "abcdef123456", "box": [0, 0, 2, 1]}]}, {"media": [{"id": "../../x"}]}, {"media": [{"id": "abcdef123456", "tall": False}]},
                {"logos": "Meta"}, {"other": 1}):
        with pytest.raises(ValueError):
            edit_runner._direction({"stage": True, **bad})


def test_an_encoded_true_peak_over_the_ceiling_lowers_the_limiter_for_another_encode():
    from clip_engine.services import sound_design as sd
    assert sd.guarded_limit(sd.GUARD_LIMIT, -1.6) is None and sd.guarded_limit(sd.GUARD_LIMIT, None) is None
    assert sd.guarded_limit(sd.GUARD_LIMIT, float('-inf')) is None
    lower = sd.guarded_limit(sd.GUARD_LIMIT, -0.1)
    # 0.9 dB over the ceiling (plus a little margin): the ceiling comes down by that much, never under the floor.
    assert abs(20 * __import__('math').log10(sd.GUARD_LIMIT / lower) - 1.1) < 1e-6
    assert sd.AAC_CODER == ('-aac_coder', 'fast')
    assert sd.guarded_limit(0.42, 3.0) == sd.GUARD_FLOOR and sd.guarded_limit(sd.GUARD_FLOOR, 0.0) is None
    assert 'limit=0.6000' in sd.loudnorm_filter({'input_i': -16.0}, 0.6) and sd.loudnorm_filter({'input_i': -16.0}).startswith('volume=2.00dB')


def test_a_phones_averaged_frame_rate_is_a_valid_rate_for_the_cut_outs():
    from clip_engine.services import depth_fx
    for ok in ('30', '30000/1001', '5536000/184529', '346000/11533', '60'):
        assert depth_fx.frame_rate_ok(ok), ok
    for bad in ('0', '30/0', '0/1', '1000/1', 'abc', '30.0', '', '30000/1001/2', '12345678901/1'):
        assert not depth_fx.frame_rate_ok(bad), bad


def test_a_late_camera_move_is_put_on_the_timeline_up_front_not_by_holding_the_clip_in_memory(tmp_path):
    """A transition or punch-in split off the clip is padded onto the frame grid (tpad) instead of having its timestamps
    shifted (which made the overlay hold every frame up to the move: the bake was killed for memory on a one-minute
    reel). The same frames change, at the same times."""
    import shutil
    import subprocess
    import pytest
    from clip_engine.services import depth_fx as dx
    assert dx.on_timeline(2.0, "30") == "tpad=start=60:color=black@0,setpts=N*1/30/TB"
    assert dx.on_timeline(3.7, "30000/1001") == "tpad=start=111:color=black@0,setpts=N*1001/30000/TB"
    moves = [dx.Transition("whip", 2.0, 5 / 30), dx.Transition("zoom", 3.0, 4 / 30)]
    graph = dx.transitions_graph("0:v", "v", moves, "30", 160, 284)
    assert "setpts=PTS+" not in graph and graph.count("tpad=start=") == 2
    if not shutil.which("ffmpeg"):
        pytest.skip("needs FFmpeg")
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x284:r=30", "-t", "4", "-pix_fmt", "yuv420p", str(src)], check=True)

    def frames(g):
        out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-filter_complex", g, "-map", "[v]", "-f", "framemd5", "-"],
                             capture_output=True, text=True, check=True).stdout
        return [line.split(",")[-1].strip() for line in out.splitlines() if not line.startswith("#")]
    plain, moved = frames("[0:v]null[v]"), frames(graph)
    changed = [i for i, (a, b) in enumerate(zip(plain, moved)) if a != b]
    assert len(moved) == len(plain) == 120
    # Only the frames of the two moves (around 2.0 s and 3.0 s) change.
    assert changed and all(55 <= i <= 65 or 85 <= i <= 95 for i in changed), changed


def test_a_framework_effect_gets_the_stage_and_a_takeover_is_measured_once_every_line_is_in():
    from clip_engine.services import auto_graphics as ag
    from clip_engine.services import graphics_overlay as go
    # The catalog sizes a flowchart for the stage: with Stage layouts on it gets it (as a card its labels don't read).
    assert ag.graphic_size('fx', True, 'flowchart') == 'stage' and ag.graphic_size('fx', False, 'flowchart') == 'card'
    assert ag.graphic_size('fx', True, 'count-up') == 'card' and ag.graphic_size('fx', True, 'browser-device-stage') == 'stage'
    # A 3 s takeover whose last line comes in near its end (said 2 s in): measured after that, before it leaves.
    assert go.takeover_sample_ms(2990) == 2990 - go.TAKEOVER_EXIT_MS and go.takeover_sample_ms(2990) > 2000 + 240
    assert go.takeover_sample_ms(800) == 800 - go.TAKEOVER_EXIT_MS


def test_an_effect_that_leads_its_beat_waits_so_the_framework_before_shows_its_last_item():
    from clip_engine.services import edit_direction as ed
    flow = {'id': 'g-flow', 'template': 'fx', 'at_ms': 10_000, 'duration_ms': 5000, 'placement': 'top',
            'fields': {'effect': 'flowchart', 'cue_ms': '200\n1500\n3800'}}
    # A marker whose word is said 2.4 s in (its unit's beat 0.9 s in: it may start up to 1.5 s later).
    marker = {'id': 'g-mark', 'template': 'fx', 'at_ms': 14_000, 'duration_ms': 4000, 'placement': 'top',
              'fields': {'effect': 'marker-highlight', 'text': 'a real income', 'word': 'income', 'cue_ms': '2400'}}
    flow_out, mark_out = ed.settle([flow, marker])
    assert mark_out['at_ms'] > 14_000 and mark_out['at_ms'] + int(mark_out['fields']['cue_ms']) == 16_400
    assert mark_out['at_ms'] + mark_out['duration_ms'] == 18_000
    assert flow_out['at_ms'] + flow_out['duration_ms'] >= 10_000 + 3800 + 500
    # A count runs up to its number for its whole run-up: it never starts later than that allows.
    count = {**marker, 'fields': {'effect': 'count-up', 'value': '4,365', 'cue_ms': '1720'}}
    assert ed.settle([flow, count])[1]['at_ms'] == 14_000
