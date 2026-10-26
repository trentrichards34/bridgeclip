/**
 * The writer's two reference scenes (our own work, made by hand for this app): the level of design a scene is held to.
 * Both are in the Dark product UI theme and read only the look's tokens, so they draw in any theme.
 */
export const SCENE_EXAMPLES: { brief: string; html: string }[] = [
  {
    brief: 'STAGE scene (the speaker in a card under the area), 1080 x 806 area, 20.80 s, Dark product UI. Words: "you need 3 things@0.40 ... a new follower@2.90 ... a camera@6.10 you already own@7.00 ... obvious@7.90 ... a script@9.40 that hooks people@10.40 with the first line@12.30 ... a schedule@15.50 ... you can keep@16.90 weekly@17.70 consistently@18.80 without@20.05 expensive gear@19.85". Hero object: the first video they describe, as an app window whose rows ARE the three things. Motif: a stamp on the setback word. Every key word lights, adds or changes something; the window keeps a slow tilt the whole time; no word is under 44 px.',
    html: `<div id="cg-root" data-duration="20.80">
<div class="spot"></div>
<div class="grid"></div>
<div class="count"><span class="n">3</span><span class="w">things</span></div>
<div class="tilt">
 <div class="win">
  <div class="bar"><i></i><i></i><i></i><span class="title">your first video</span></div>
  <div class="row r1"><div class="hl"></div><div class="num"><i></i><span>1</span></div><div class="txt"><b>a camera</b><small>you already own</small></div><div class="tag">obvious</div><svg class="ok" viewBox="0 0 40 40"><path d="M9 21 L17 29 L31 12"/></svg></div>
  <div class="row r2"><div class="hl"></div><div class="num"><i></i><span>2</span></div><div class="txt"><b>a script</b><small>hooks people</small></div><div class="tag">first line</div><svg class="ok" viewBox="0 0 40 40"><path d="M9 21 L17 29 L31 12"/></svg></div>
  <div class="row r3"><div class="hl"></div><div class="num"><i></i><span>3</span></div><div class="txt"><b>a schedule</b><small>you can keep</small></div><div class="chips"><span class="c1">weekly</span><span class="c2">consistently</span></div><svg class="ok" viewBox="0 0 40 40"><path d="M9 21 L17 29 L31 12"/></svg></div>
 </div>
 <div class="sales"><div class="s s1"><span class="dot"></span>new follower</div><div class="s s2"><span class="dot"></span>new follower</div><div class="s s3"><span class="dot"></span>new follower</div></div>
</div>
<div class="viral"><span>expensive gear</span></div>
<div class="stamp">WITHOUT</div>
</div>
<style>
#cg-root .spot{position:absolute;left:140px;top:28px;width:800px;height:750px;background:radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--cg-accent) 38%, transparent), color-mix(in srgb, var(--cg-accent) 8%, transparent) 45%, transparent 70%)}
#cg-root .grid{position:absolute;left:48px;right:48px;top:28px;bottom:28px;border-radius:40px;background-image:linear-gradient(color-mix(in srgb, var(--cg-ink) 5%, transparent) 2px, transparent 2px),linear-gradient(90deg, color-mix(in srgb, var(--cg-ink) 5%, transparent) 2px, transparent 2px);background-size:60px 60px}
#cg-root .count{position:absolute;left:64px;top:36px;display:flex;align-items:baseline;gap:18px;font-family:var(--cg-font-display);color:var(--cg-ink)}
#cg-root .count .n{font-size:150px;font-weight:800;line-height:1;color:var(--cg-accent);text-shadow:0 0 40px var(--cg-glow)}
#cg-root .count .w{font-size:72px;font-weight:700}
#cg-root .tilt{position:absolute;left:60px;top:210px;width:960px;height:560px;transform:perspective(1600px) rotateX(10deg) rotateY(-8deg);transform-origin:50% 60%}
#cg-root .win{position:absolute;left:0;top:0;width:820px;height:540px;border-radius:34px;background:linear-gradient(160deg, var(--cg-panel), color-mix(in srgb, var(--cg-panel) 45%, var(--cg-ground)));border:3px solid color-mix(in srgb, var(--cg-accent) 55%, transparent);box-shadow:0 0 70px color-mix(in srgb, var(--cg-glow) 60%, transparent), 0 40px 80px rgba(0,0,0,.6)}
#cg-root .bar{display:flex;align-items:center;gap:12px;height:86px;padding:0 28px;border-bottom:2px solid color-mix(in srgb, var(--cg-ink) 8%, transparent)}
#cg-root .bar i{width:18px;height:18px;border-radius:50%;background:color-mix(in srgb, var(--cg-ink) 25%, transparent)}
#cg-root .title{margin-left:14px;font-family:var(--cg-font-body);font-weight:700;font-size:44px;color:var(--cg-ink)}
#cg-root .row{position:relative;display:flex;align-items:center;gap:22px;height:140px;margin:0 22px;padding:0 22px;border-radius:24px}
#cg-root .row+.row{margin-top:8px}
#cg-root .hl{position:absolute;inset:0;border-radius:24px;background:color-mix(in srgb, var(--cg-accent) 16%, transparent);opacity:0}
#cg-root .num{position:relative;width:84px;height:84px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-family:var(--cg-font-display);font-weight:800;font-size:56px;color:var(--cg-ink);background:color-mix(in srgb, var(--cg-ink) 8%, transparent);border:3px solid color-mix(in srgb, var(--cg-ink) 15%, transparent)}
#cg-root .num i{position:absolute;inset:-3px;border-radius:22px;background:var(--cg-accent);opacity:0}
#cg-root .num span{position:relative}
#cg-root .txt{position:relative;display:flex;flex-direction:column}
#cg-root .txt b{font-family:var(--cg-font-display);font-size:64px;line-height:1.02;color:var(--cg-ink)}
#cg-root .txt small{font-family:var(--cg-font-body);font-size:44px;line-height:1.05;color:var(--cg-muted)}
#cg-root .tag{position:relative;margin-left:auto;font-family:var(--cg-font-body);font-weight:700;font-size:44px;color:var(--cg-ink);padding:10px 20px;border-radius:999px;background:color-mix(in srgb, var(--cg-accent) 22%, transparent);border:2px solid color-mix(in srgb, var(--cg-accent) 70%, transparent)}
#cg-root .chips{position:relative;margin-left:auto;display:flex;flex-direction:column;gap:6px}
#cg-root .chips span{font-family:var(--cg-font-body);font-weight:700;font-size:44px;line-height:1.1;color:var(--cg-ink);padding:2px 18px;border-radius:999px;background:color-mix(in srgb, var(--cg-accent) 22%, transparent);border:2px solid color-mix(in srgb, var(--cg-accent) 70%, transparent)}
#cg-root .ok{position:absolute;right:-60px;top:46px;width:48px;height:48px}
#cg-root .ok path{fill:none;stroke:var(--cg-accent);stroke-width:7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40}
#cg-root .sales{position:absolute;left:560px;top:250px;width:400px}
#cg-root .s{position:absolute;left:0;width:400px;height:84px;border-radius:22px;display:flex;align-items:center;gap:14px;padding:0 22px;font-family:var(--cg-font-body);font-weight:700;font-size:44px;color:var(--cg-paper-ink);background:var(--cg-paper);box-shadow:0 20px 40px rgba(0,0,0,.45)}
#cg-root .s .dot{width:26px;height:26px;border-radius:50%;background:var(--cg-accent);flex:none}
#cg-root .viral{position:absolute;left:250px;top:330px;padding:26px 44px;background:var(--cg-panel);border-radius:28px;border:3px dashed color-mix(in srgb, var(--cg-ink) 50%, transparent);font-family:var(--cg-font-display);font-weight:800;font-size:76px;color:var(--cg-ink)}
#cg-root .stamp{position:absolute;left:330px;top:450px;padding:4px 26px;border:9px solid var(--cg-bad);border-radius:16px;background:color-mix(in srgb, var(--cg-ground) 60%, transparent);font-family:var(--cg-font-display);font-weight:900;font-size:84px;letter-spacing:4px;color:var(--cg-bad);transform:rotate(-12deg)}
</style>
<script>
const tl = gsap.timeline({ paused: true });
const R = '#cg-root ';
tl.set(R + '.viral', { autoAlpha: 0 }, 0).set(R + '.stamp', { autoAlpha: 0 }, 0);
tl.from(R + '.spot', { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, 0);
tl.from(R + '.count .n', { scale: 0.6, autoAlpha: 0, duration: 0.5, ease: 'back.out(1.4)' }, 0.4);
tl.from(R + '.count .w', { x: -30, autoAlpha: 0, duration: 0.45, ease: 'expo.out' }, 0.7);
tl.from(R + '.tilt', { y: 80, rotationX: 30, autoAlpha: 0, duration: 0.8, ease: 'expo.out' }, 0.85);
tl.from(R + '.title', { autoAlpha: 0, x: -20, duration: 0.4 }, 3.9);
tl.from(R + '.row', { autoAlpha: 0.15, duration: 0.01 }, 0);
tl.to(R + '.tilt', { rotationY: -4, rotationX: 7, duration: 18, ease: 'none' }, 1.7);
tl.from(R + '.s1', { y: -60, autoAlpha: 0, duration: 0.45, ease: 'expo.out' }, 2.9).to(R + '.s1', { y: 96, duration: 0.4, ease: 'power2.out' }, 3.35);
tl.from(R + '.s2', { y: -60, autoAlpha: 0, duration: 0.45, ease: 'expo.out' }, 3.3).to(R + '.s1', { y: 192, duration: 0.4 }, 3.75).to(R + '.s2', { y: 96, duration: 0.4 }, 3.75);
tl.from(R + '.s3', { y: -60, autoAlpha: 0, duration: 0.45, ease: 'expo.out' }, 3.7);
tl.to(R + '.sales', { x: 120, autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, 5.6);
const light = (row, at) => { tl.to(R + row, { autoAlpha: 1, duration: 0.3 }, at).to(R + row + ' .hl', { opacity: 1, duration: 0.3 }, at).to(R + row + ' .num i', { opacity: 1, duration: 0.3 }, at).from(R + row + ' b', { x: -24, duration: 0.5, ease: 'expo.out' }, at); };
light('.r1', 6.1); tl.from(R + '.r1 small', { autoAlpha: 0, duration: 0.3 }, 7.0); tl.from(R + '.r1 .tag', { scale: 0.7, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.4)' }, 7.9); tl.to(R + '.r1 .ok path', { strokeDashoffset: 0, duration: 0.4 }, 8.3);
tl.to(R + '.r1 .hl', { opacity: 0.3, duration: 0.4 }, 9.3);
light('.r2', 9.4); tl.from(R + '.r2 small', { autoAlpha: 0, duration: 0.3 }, 10.4); tl.from(R + '.r2 .tag', { scale: 0.7, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.4)' }, 12.3); tl.to(R + '.r2 .ok path', { strokeDashoffset: 0, duration: 0.4 }, 13.0);
tl.to(R + '.r2 .num', { scale: 1.08, duration: 0.5, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 10.6);
tl.to(R + '.r2 .tag', { y: -6, duration: 0.6, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 12.8);
tl.to(R + '.r2 .hl', { opacity: 0.3, duration: 0.4 }, 14.0);
tl.to(R + '.count .n', { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1 }, 14.0);
light('.r3', 15.5); tl.from(R + '.r3 small', { autoAlpha: 0, duration: 0.3 }, 16.9); tl.from(R + '.r3 .c1', { x: 30, autoAlpha: 0, duration: 0.35, ease: 'expo.out' }, 17.7); tl.from(R + '.r3 .c2', { x: 30, autoAlpha: 0, duration: 0.35, ease: 'expo.out' }, 18.8); tl.to(R + '.r3 .ok path', { strokeDashoffset: 0, duration: 0.4 }, 19.0);
tl.to(R + '.viral', { autoAlpha: 1, duration: 0.01 }, 19.85).from(R + '.viral', { y: 40, scale: 0.9, duration: 0.35, ease: 'expo.out' }, 19.85);
tl.to(R + '.stamp', { autoAlpha: 1, duration: 0.01 }, 20.05).from(R + '.stamp', { scale: 2.2, duration: 0.22, ease: 'power4.in' }, 20.05).to(R + '.viral', { opacity: 0.45, duration: 0.2 }, 20.27);
tl.to(R + '.tilt', { x: 2, y: -3, duration: 0.08, yoyo: true, repeat: 3 }, 20.27);
tl.to(R + '.spot,' + R + '.grid,' + R + '.count,' + R + '.tilt,' + R + '.viral,' + R + '.stamp', { autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, 20.45);
window.__timelines = [tl];
</script>`
  },
  {
    brief: 'VISUAL scene (the whole frame is the stage, no speaker), 1080 x 1268 area, 15.00 s, Dark product UI. Words: "For the course, I\'m actually using AI@1.50 ... old posts@4.20 a voice memo@5.80 an outline@7.60 ... asks a few questions@9.90 ... an entire email course@10.90 for me@13.20 ... the result@14.10". Hero object: the AI tool, a glowing chip the inputs are wired into, and the course window it fills in.',
    html: `<div id="cg-root" data-duration="15.00">
<div class="spot"></div>
<div class="grid"></div>
<div class="label">For the course, I'm actually using <span class="ai">AI</span></div>
<div class="ins">
 <div class="in i1"><svg viewBox="0 0 60 60"><rect x="8" y="10" width="44" height="40" rx="8"/><path d="M18 24h24M18 33h24M18 42h14"/></svg><span>old posts</span></div>
 <div class="in i2"><svg viewBox="0 0 60 60"><rect x="6" y="14" width="40" height="32" rx="8"/><path d="M46 24l10-6v24l-10-6z"/></svg><span>a voice memo</span></div>
 <div class="in i3"><svg viewBox="0 0 60 60"><circle cx="30" cy="26" r="15"/><path d="M23 44h14M25 51h10"/></svg><span>an outline</span></div>
</div>
<svg class="wires" viewBox="0 0 984 600"><path class="w1" d="M330 95 C470 95 420 300 492 300"/><path class="w2" d="M330 215 C450 215 440 300 492 300"/><path class="w3" d="M330 335 C450 335 440 300 492 300"/></svg>
<div class="chip"><div class="halo"></div><div class="pins"></div><b>AI</b><small>tool</small></div>
<div class="qs"><div class="q q1">a few questions</div><div class="q q2">?</div><div class="q q3">?</div></div>
<div class="prod">
 <div class="pbar"><i></i><i></i><i></i><span>an entire email course</span></div>
 <div class="mods"><div class="m"><i></i></div><div class="m"><i></i></div><div class="m"><i></i></div><div class="m"><i></i></div></div>
 <div class="done">for me</div>
</div>
<div class="outcome">the result</div>
</div>
<style>
#cg-root .spot{position:absolute;left:90px;top:28px;width:900px;height:1100px;background:radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--cg-accent) 34%, transparent), color-mix(in srgb, var(--cg-accent) 6%, transparent) 50%, transparent 72%)}
#cg-root .grid{position:absolute;left:48px;right:48px;top:28px;bottom:28px;border-radius:40px;background-image:linear-gradient(color-mix(in srgb, var(--cg-ink) 5%, transparent) 2px, transparent 2px),linear-gradient(90deg, color-mix(in srgb, var(--cg-ink) 5%, transparent) 2px, transparent 2px);background-size:60px 60px}
#cg-root .label{position:absolute;left:70px;right:70px;top:60px;text-align:center;font-family:var(--cg-font-display);font-weight:700;font-size:58px;line-height:1.1;color:var(--cg-ink)}
#cg-root .ai{color:var(--cg-accent);text-shadow:0 0 30px var(--cg-glow)}
#cg-root .ins{position:absolute;left:60px;top:250px;width:420px}
#cg-root .in{position:absolute;left:0;width:440px;height:104px;display:flex;align-items:center;gap:16px;padding:0 20px;border-radius:24px;background:linear-gradient(160deg, var(--cg-panel), color-mix(in srgb, var(--cg-panel) 50%, var(--cg-ground)));border:3px solid color-mix(in srgb, var(--cg-ink) 14%, transparent);font-family:var(--cg-font-body);font-weight:700;font-size:44px;line-height:1.02;color:var(--cg-ink);box-shadow:0 24px 50px rgba(0,0,0,.5)}
#cg-root .in svg{width:56px;height:56px;flex:none}
#cg-root .in svg *{fill:none;stroke:var(--cg-accent);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
#cg-root .i1{top:0}#cg-root .i2{top:124px}#cg-root .i3{top:248px}
#cg-root .wires{position:absolute;left:48px;top:200px;width:984px;height:600px}
#cg-root .wires path{transform:translateY(6px);fill:none;stroke:var(--cg-accent);stroke-width:6;stroke-linecap:round;stroke-dasharray:420;stroke-dashoffset:420;opacity:.85}
#cg-root .chip{position:absolute;left:560px;top:390px;width:240px;height:240px;border-radius:44px;background:linear-gradient(150deg, var(--cg-panel), color-mix(in srgb, var(--cg-panel) 40%, var(--cg-ground)));border:4px solid var(--cg-accent);box-shadow:0 0 80px var(--cg-glow), inset 0 0 40px color-mix(in srgb, var(--cg-accent) 25%, transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;transform:perspective(900px) rotateX(14deg) rotateY(-14deg)}
#cg-root .halo{position:absolute;inset:-30px;border-radius:70px;box-shadow:0 0 120px var(--cg-glow);opacity:0}
#cg-root .chip b{position:relative;font-family:var(--cg-font-display);font-size:110px;line-height:1;color:var(--cg-ink)}
#cg-root .chip small{position:relative;font-family:var(--cg-font-body);font-size:44px;color:var(--cg-muted)}
#cg-root .pins{position:absolute;inset:-22px;border-radius:56px;border:6px dotted color-mix(in srgb, var(--cg-accent) 55%, transparent)}
#cg-root .qs{position:absolute;left:770px;top:300px;width:220px}
#cg-root .q{position:absolute;padding:12px 22px;border-radius:26px 26px 26px 6px;background:var(--cg-paper);color:var(--cg-paper-ink);font-family:var(--cg-font-body);font-weight:700;font-size:44px;box-shadow:0 16px 30px rgba(0,0,0,.45)}
#cg-root .q1{left:-200px;top:-70px;white-space:nowrap}#cg-root .q2{left:70px;top:30px;font-size:56px;padding:4px 24px}#cg-root .q3{left:130px;top:120px;font-size:56px;padding:4px 24px}
#cg-root .prod{position:absolute;left:110px;top:720px;width:860px;height:380px;border-radius:34px;background:linear-gradient(160deg, var(--cg-panel), color-mix(in srgb, var(--cg-panel) 40%, var(--cg-ground)));border:3px solid color-mix(in srgb, var(--cg-accent) 60%, transparent);box-shadow:0 0 80px color-mix(in srgb, var(--cg-glow) 65%, transparent),0 40px 80px rgba(0,0,0,.6);transform:perspective(1600px) rotateX(12deg);transform-origin:50% 100%}
#cg-root .pbar{display:flex;align-items:center;gap:12px;height:84px;padding:0 28px;border-bottom:2px solid color-mix(in srgb, var(--cg-ink) 8%, transparent)}
#cg-root .pbar i{width:18px;height:18px;border-radius:50%;background:color-mix(in srgb, var(--cg-ink) 25%, transparent)}
#cg-root .pbar span{margin-left:14px;font-family:var(--cg-font-body);font-weight:700;font-size:44px;color:var(--cg-ink)}
#cg-root .mods{display:flex;gap:20px;padding:30px 28px}
#cg-root .m{position:relative;flex:1;height:170px;border-radius:22px;background:color-mix(in srgb, var(--cg-ink) 7%, transparent);border:3px solid color-mix(in srgb, var(--cg-ink) 12%, transparent)}
#cg-root .m i{position:absolute;inset:-3px;border-radius:22px;background:color-mix(in srgb, var(--cg-accent) 28%, transparent);border:3px solid color-mix(in srgb, var(--cg-accent) 80%, transparent);opacity:0}
#cg-root .done{position:absolute;right:30px;top:-34px;padding:8px 22px;border-radius:999px;background:var(--cg-accent);color:var(--cg-ground);font-family:var(--cg-font-body);font-weight:800;font-size:44px}
#cg-root .outcome{position:absolute;left:300px;top:1010px;padding:10px 34px;border-radius:999px;border:4px solid var(--cg-accent);background:var(--cg-panel);font-family:var(--cg-font-display);font-weight:800;font-size:64px;color:var(--cg-ink);box-shadow:0 0 50px var(--cg-glow)}
</style>
<script>
const tl = gsap.timeline({ paused: true });
const R = '#cg-root ';
tl.from(R + '.spot,' + R + '.grid', { autoAlpha: 0, duration: 0.5 }, 0);
tl.from(R + '.label', { y: 30, autoAlpha: 0, duration: 0.5, ease: 'expo.out' }, 0.4);
tl.from(R + '.ai', { scale: 0.6, duration: 0.4, ease: 'back.out(1.4)' }, 1.5);
tl.from(R + '.chip', { scale: 0.7, autoAlpha: 0, duration: 0.6, ease: 'expo.out' }, 1.55);
tl.to(R + '.pins', { rotation: 90, duration: 13, ease: 'none' }, 1.6);
tl.from(R + '.i1', { x: -60, autoAlpha: 0, duration: 0.5, ease: 'expo.out' }, 4.2).to(R + '.w1', { strokeDashoffset: 0, duration: 0.6 }, 4.7);
tl.from(R + '.i2', { x: -60, autoAlpha: 0, duration: 0.5, ease: 'expo.out' }, 5.8).to(R + '.w2', { strokeDashoffset: 0, duration: 0.6 }, 6.2);
tl.from(R + '.i3', { x: -60, autoAlpha: 0, duration: 0.5, ease: 'expo.out' }, 7.6).to(R + '.w3', { strokeDashoffset: 0, duration: 0.6 }, 7.9);
tl.to(R + '.halo', { opacity: 1, duration: 0.5, yoyo: true, repeat: 3 }, 8.2);
tl.from(R + '.q1', { y: 20, scale: 0.8, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.4)' }, 9.9);
tl.from(R + '.q2', { y: 20, scale: 0.8, autoAlpha: 0, duration: 0.35, ease: 'back.out(1.4)' }, 10.3);
tl.from(R + '.q3', { y: 20, scale: 0.8, autoAlpha: 0, duration: 0.35, ease: 'back.out(1.4)' }, 10.6);
tl.from(R + '.prod', { y: 120, rotationX: 40, autoAlpha: 0, duration: 0.7, ease: 'expo.out' }, 10.9);
tl.from(R + '.m', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.35, stagger: 0.18, ease: 'expo.out' }, 11.6);
tl.to(R + '.m i', { opacity: 1, duration: 0.25, stagger: 0.18 }, 12.0);
tl.from(R + '.done', { scale: 0.6, autoAlpha: 0, duration: 0.35, ease: 'back.out(1.4)' }, 13.2);
tl.from(R + '.outcome', { y: 30, scale: 0.85, autoAlpha: 0, duration: 0.45, ease: 'expo.out' }, 14.1);
tl.to(R + '.prod', { y: -10, duration: 1.2, ease: 'sine.inOut' }, 13.3);
tl.to(R + '.spot,' + R + '.grid,' + R + '.label,' + R + '.ins,' + R + '.wires,' + R + '.chip,' + R + '.qs,' + R + '.prod,' + R + '.outcome', { autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, 14.65);
window.__timelines = [tl];
</script>`
  }
]
