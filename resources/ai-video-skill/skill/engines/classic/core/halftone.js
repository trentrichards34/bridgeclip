// ───────────────────────── halftone compositor (WebGL) ─────────────────────────
// Composites the two 2D layers into the output canvas:
//   T (tone)  → printed as round halftone dots on cream paper: grey/black = ink dots (angle 0°), pure red #FF0000 = accent dots,
//               pure green #00FF00 = second-ink dots (both at 45°). White = bare paper. Cell 5 px, round dots (sq 0.25).
//   K (ink)   → crisp, composited on top untouched (lines, type, UI, the presenter).
// Plus: a halftone DOT WIPE between scenes (48 px cells, 4 directions) and fine paper grain (±0.9%, re-seeded at 24 fps).
function makeHalftone(out, toneC, inkC) {
  const gl = out.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL is not available in this browser');
  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const FS = `
precision highp float;
uniform sampler2D uTone, uInk;
uniform vec2 uRes;
uniform float uTime, uWipe, uMode, uCell, uAngK, uAngR, uSq, uGrain;
uniform vec3 uWipeCol, uPaper, uRedInk, uInk2, uInkK;
// tone encoding: black = 1 - max(rgb); accent = r - max(g,b); second ink = g - max(r,b)
float dens(vec4 s, float ch) { return ch < 0.5 ? 1.0 - max(s.r, max(s.g, s.b)) : ch < 1.5 ? s.r - max(s.g, s.b) : s.g - max(s.r, s.b); }
float screen(vec2 px, float ang, float cell, float ch) {
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c*px.x + s*px.y, -s*px.x + c*px.y) / cell;
  vec2 b = floor(q);
  float cov = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = b + vec2(float(i), float(j)) + 0.5;
    vec2 w = cc * cell;
    vec2 cp = vec2(c*w.x - s*w.y, s*w.x + c*w.y);
    float d = clamp(dens(texture2D(uTone, cp / uRes), ch), 0.0, 1.0);
    d = smoothstep(0.03, 0.97, d);
    float r = sqrt(d) * 0.76;
    float dist = max(abs(q.x - cc.x), abs(q.y - cc.y)) * uSq + length(q - cc) * (1.0 - uSq);
    cov = max(cov, clamp((r - dist) * cell + 0.5, 0.0, 1.0));
  }
  return cov;
}
float wipeField(vec2 uv) {
  if (uMode < 0.5) return (uv.x * 0.55 + uv.y * 0.9) / 1.45;
  if (uMode < 1.5) return length((uv - 0.5) * vec2(0.5625, 1.0)) * 1.75;
  if (uMode < 2.5) return 1.0 - uv.y;
  return uv.x;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = px / uRes;
  vec3 col = uPaper;
  col = mix(col, uRedInk, screen(px, uAngR, uCell, 1.0));
  col = mix(col, uInk2, screen(px, uAngR, uCell, 2.0));
  col = mix(col, uInkK, screen(px, uAngK, uCell, 0.0));
  vec4 ink = texture2D(uInk, uv);
  col = mix(col, ink.rgb, ink.a);
  if (uWipe > 0.0 && uWipe < 2.0) {
    float cell = 48.0;
    vec2 q = px / cell;
    float cov = 0.0;
    vec2 b = floor(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 cc = b + vec2(float(i), float(j)) + 0.5;
      float f = clamp(wipeField(cc * cell / uRes), 0.0, 1.0);
      float a = uWipe <= 1.0 ? clamp(uWipe * 1.6 - f * 0.6, 0.0, 1.0) : 1.0 - clamp((uWipe - 1.0) * 1.6 - f * 0.6, 0.0, 1.0);
      float r = sqrt(a) * 0.76;
      cov = max(cov, clamp((r - length(q - cc)) * cell + 0.5, 0.0, 1.0));
    }
    col = mix(col, uWipeCol, cov);
  }
  col += (hash(px + fract(uTime * 7.13) * 100.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const tex = unit => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const texTone = tex(0), texInk = tex(1);
  gl.uniform1i(U('uTone'), 0); gl.uniform1i(U('uInk'), 1);
  gl.uniform2f(U('uRes'), out.width, out.height);
  gl.viewport(0, 0, out.width, out.height);
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  // o: { t, paper, accent, ink2, ink, wipe: {p, mode, col}, cell, angK, angR, sq, grain }
  return function draw(o) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texTone);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toneC);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texInk);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inkC);
    gl.uniform3f(U('uPaper'), ...rgb(o.paper)); gl.uniform3f(U('uRedInk'), ...rgb(o.accent));
    gl.uniform3f(U('uInk2'), ...rgb(o.ink2)); gl.uniform3f(U('uInkK'), ...rgb(o.ink || '#111111'));
    gl.uniform1f(U('uWipe'), o.wipe ? o.wipe.p : 0); gl.uniform1f(U('uMode'), o.wipe ? o.wipe.mode : 0);
    gl.uniform3f(U('uWipeCol'), ...rgb(o.wipe ? o.wipe.col : '#111111'));
    gl.uniform1f(U('uTime'), Math.floor(o.t * 24) / 24);
    gl.uniform1f(U('uCell'), o.cell ?? 5); gl.uniform1f(U('uAngK'), o.angK ?? 0); gl.uniform1f(U('uAngR'), o.angR ?? 0.785);
    gl.uniform1f(U('uSq'), o.sq ?? 0.25); gl.uniform1f(U('uGrain'), o.grain ?? 0.018);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}
