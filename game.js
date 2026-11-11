/* =========================================================================
   ROCKET ARENA — a Rocket League-flavoured 3D car soccer game.
   Pure WebGL1, procedural textures, no external assets.
   ========================================================================= */
'use strict';

const canvas = document.getElementById('game');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
const fxCanvas = document.getElementById('fx');
const fctx = fxCanvas.getContext('2d');
if (!gl) {
  document.body.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;font:600 16px system-ui;color:#fff;background:#071322;text-align:center;padding:30px">WebGL is required to run Rocket Arena.<br>Please enable hardware acceleration.</div>';
  throw new Error('WebGL unavailable');
}

/* ------------------------------- math ---------------------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const hyp = (x, z) => Math.hypot(x, z);
const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const M4 = {
  ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, target, up) {
    const z = norm3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = norm3([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1
    ]);
  },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  trans(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  scale(x, y, z) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); },
  compose(x, y, z, yaw, pitch, roll) {
    let m = M4.trans(x, y, z);
    if (yaw) m = M4.mul(m, M4.rotY(yaw));
    if (pitch) m = M4.mul(m, M4.rotX(pitch));
    if (roll) m = M4.mul(m, M4.rotZ(roll));
    return m;
  },
  axisAngle(ax, ay, az, a) {
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return new Float32Array([
      t * ax * ax + c, t * ax * ay + s * az, t * ax * az - s * ay, 0,
      t * ax * ay - s * az, t * ay * ay + c, t * ay * az + s * ax, 0,
      t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + c, 0,
      0, 0, 0, 1
    ]);
  },
  point(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }
};

/* ------------------------------- colours -------------------------------- */
function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function shade(c, f) { return [clamp(c[0] * f, 0, 1), clamp(c[1] * f, 0, 1), clamp(c[2] * f, 0, 1)]; }
function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

const COL = {
  blue: rgb('#1677e0'), blueL: rgb('#2b9cf0'), blueD: rgb('#0a4d9e'),
  cyan: rgb('#52dcff'), orange: rgb('#ef6c16'), orangeL: rgb('#ff9a3c'), orangeD: rgb('#b8460a'),
  amber: rgb('#ffc447'), dark: rgb('#08121f'), dark2: rgb('#0d1b2c'), metal: rgb('#24384c'),
  white: rgb('#eaf6ff'), tire: rgb('#0a0d12'), glass: rgb('#0b2238'), net: rgb('#a9d8ee')
};

/* ------------------------------ GL setup -------------------------------- */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(innerWidth * dpr)), h = Math.max(1, Math.floor(innerHeight * dpr));
  canvas.width = w; canvas.height = h;
  fxCanvas.width = w; fxCanvas.height = h;
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  fxCanvas.style.width = innerWidth + 'px'; fxCanvas.style.height = innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

const MAIN_VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aUV;
uniform mat4 uProj,uView,uModel;
varying vec3 vNrm,vCol,vWorld; varying vec2 vUV;
void main(){
  vec4 wp=uModel*vec4(aPos,1.0);
  vWorld=wp.xyz;
  vNrm=normalize(mat3(uModel[0].xyz,uModel[1].xyz,uModel[2].xyz)*aNrm);
  vCol=aCol; vUV=aUV;
  gl_Position=uProj*uView*wp;
}`;

const MAIN_FS = `
precision mediump float;
varying vec3 vNrm,vCol,vWorld; varying vec2 vUV;
uniform sampler2D uTex;
uniform vec3 uTint,uCam,uFogColor;
uniform float uUseTex,uAlpha,uEmissive,uUnlit,uFogNear,uFogFar,uShine;
void main(){
  vec4 t=vec4(1.0);
  if(uUseTex>0.5) t=texture2D(uTex,vUV);
  if(t.a<0.03) discard;
  vec3 base=vCol*uTint*t.rgb;
  vec3 n=normalize(vNrm);
  vec3 V=normalize(uCam-vWorld);
  if(dot(n,V)<0.0) n=-n;
  vec3 L1=normalize(vec3(0.42,0.86,0.30));
  vec3 L2=normalize(vec3(-0.55,0.38,-0.65));
  float d1=max(dot(n,L1),0.0);
  float d2=max(dot(n,L2),0.0);
  vec3 amb=vec3(0.34,0.40,0.52);
  vec3 lit=base*(amb+vec3(1.0,0.95,0.86)*d1*0.95+vec3(0.28,0.46,0.78)*d2*0.38);
  vec3 H=normalize(L1+V);
  float spec=pow(max(dot(n,H),0.0),36.0)*uShine;
  lit+=vec3(1.0,0.97,0.9)*spec;
  float rim=pow(1.0-max(dot(n,V),0.0),3.0);
  lit+=base*rim*0.35;
  lit=mix(lit,base*1.25,uEmissive);
  lit=mix(lit,base,uUnlit);
  float fog=smoothstep(uFogNear,uFogFar,length(uCam-vWorld));
  lit=mix(lit,uFogColor,fog*0.72);
  gl_FragColor=vec4(lit,uAlpha*t.a);
}`;

const SKY_VS = `
attribute vec2 aPos; varying vec2 vUV;
void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.9999,1.0); }`;
const SKY_FS = `
precision mediump float;
varying vec2 vUV; uniform float uTime,uAspect;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 uv=vUV;
  vec3 top=vec3(0.012,0.027,0.065);
  vec3 mid=vec3(0.035,0.085,0.17);
  vec3 hor=vec3(0.16,0.29,0.44);
  float h=smoothstep(0.0,0.72,uv.y);
  vec3 col=mix(hor,mid,smoothstep(0.0,0.42,uv.y));
  col=mix(col,top,smoothstep(0.4,1.0,uv.y));
  // soft city-like horizon glow
  float glow=exp(-pow((uv.y-0.26)*7.0,2.0));
  col+=vec3(0.10,0.25,0.42)*glow*0.45;
  col+=vec3(0.32,0.16,0.05)*exp(-pow((uv.x-0.72)*4.2,2.0))*exp(-pow((uv.y-0.23)*10.0,2.0))*0.35;
  col+=vec3(0.06,0.17,0.34)*exp(-pow((uv.x-0.26)*4.5,2.0))*exp(-pow((uv.y-0.24)*11.0,2.0))*0.4;
  // sparse stars
  vec2 g=uv*vec2(uAspect,1.0)*180.0;
  vec2 cell=floor(g);
  float star=step(0.9975,hash(cell));
  float d=length(fract(g)-0.5);
  col+=star*smoothstep(0.42,0.0,d)*vec3(0.65,0.82,1.0)*step(0.34,uv.y);
  // faint aurora bands
  float a=sin(uv.x*7.0+uTime*0.06)*0.5+0.5;
  col+=vec3(0.03,0.16,0.24)*a*smoothstep(0.35,0.95,uv.y)*0.35;
  gl_FragColor=vec4(col,1.0);
}`;

const POINT_VS = `
attribute vec3 aPos; attribute float aSize; attribute vec3 aCol; attribute float aAlpha;
uniform mat4 uProj,uView; uniform float uScale;
varying vec3 vCol; varying float vA;
void main(){
  vec4 mv=uView*vec4(aPos,1.0);
  gl_Position=uProj*mv;
  gl_PointSize=clamp(aSize*uScale/max(1.0,-mv.z),1.0,90.0);
  vCol=aCol; vA=aAlpha;
}`;
const POINT_FS = `
precision mediump float;
varying vec3 vCol; varying float vA;
void main(){
  vec2 c=gl_PointCoord-0.5;
  float d=length(c);
  if(d>0.5) discard;
  float a=smoothstep(0.5,0.0,d);
  gl_FragColor=vec4(vCol,vA*a);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const prog = program(MAIN_VS, MAIN_FS);
const skyProg = program(SKY_VS, SKY_FS);
const pointProg = program(POINT_VS, POINT_FS);
const U = {};
['uProj', 'uView', 'uModel', 'uTex', 'uTint', 'uCam', 'uFogColor', 'uUseTex', 'uAlpha', 'uEmissive', 'uUnlit', 'uFogNear', 'uFogFar', 'uShine'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
const SP = {};
['uProj', 'uView', 'uScale'].forEach(n => SP[n] = gl.getUniformLocation(pointProg, n));
const SKYU = { uTime: gl.getUniformLocation(skyProg, 'uTime'), uAspect: gl.getUniformLocation(skyProg, 'uAspect') };

/* ----------------------------- textures --------------------------------- */
function makeTexture(cv, repeat, noMip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, noMip ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (!noMip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}
function canvas2d(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function makeFieldTexture() {
  const [cv, g] = canvas2d(1024, 1024);
  const grd = g.createLinearGradient(0, 0, 0, 1024);
  grd.addColorStop(0, '#0f3e3b'); grd.addColorStop(0.5, '#135247'); grd.addColorStop(1, '#0f3e3b');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
  // mowing stripes along length
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? 'rgba(150,255,215,.028)' : 'rgba(0,20,15,.05)';
    g.fillRect(0, i * 64, 1024, 64);
  }
  // subtle hex/tech weave
  g.globalAlpha = 0.055; g.strokeStyle = '#9ff6dc'; g.lineWidth = 1.2;
  const s = 26;
  for (let row = -1; row < 42; row++) for (let col = -1; col < 42; col++) {
    const cx = col * s * 1.5 + (row % 2) * s * 0.75, cy = row * s * 0.87;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k, xx = cx + Math.cos(a) * s * 0.48, yy = cy + Math.sin(a) * s * 0.48;
      k ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
    }
    g.closePath(); g.stroke();
  }
  g.globalAlpha = 1;
  // team end zones
  const bg = g.createLinearGradient(0, 0, 0, 120);
  bg.addColorStop(0, 'rgba(30,130,255,.22)'); bg.addColorStop(1, 'rgba(30,130,255,0)');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 120);
  const og = g.createLinearGradient(0, 904, 0, 1024);
  og.addColorStop(0, 'rgba(255,120,30,0)'); og.addColorStop(1, 'rgba(255,120,30,.22)');
  g.fillStyle = og; g.fillRect(0, 904, 1024, 120);
  // markings
  g.strokeStyle = 'rgba(235,255,250,.85)'; g.lineWidth = 5;
  g.strokeRect(34, 34, 956, 956);
  g.beginPath(); g.moveTo(34, 512); g.lineTo(990, 512); g.stroke();
  g.beginPath(); g.arc(512, 512, 112, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(235,255,250,.8)';
  g.beginPath(); g.arc(512, 512, 11, 0, TAU); g.fill();
  // goal boxes
  for (const end of [0, 1]) {
    const y = end ? 1024 - 34 : 34, dir = end ? -1 : 1;
    g.strokeRect(512 - 276, y, 552, dir * 138);
    g.strokeRect(512 - 150, y, 300, dir * 54);
    g.beginPath(); g.arc(512, y + dir * 70, 92, end ? Math.PI : 0, end ? 0 : Math.PI); g.stroke();
    g.fillStyle = 'rgba(225,255,246,.5)';
    g.beginPath(); g.arc(512, y + dir * 70, 8, 0, TAU); g.fill();
    // penalty spot
    g.beginPath(); g.arc(512, y + dir * 105, 6, 0, TAU); g.fill();
  }
  // corner arcs
  for (const cx of [34, 990]) for (const cy of [34, 990]) {
    g.beginPath(); g.arc(cx, cy, 30, 0, TAU); g.stroke();
  }
  // subtle scuff marks
  g.globalAlpha = 0.05;
  for (let i = 0; i < 160; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#bfffe0' : '#04231c';
    g.beginPath(); g.ellipse(rand(40, 980), rand(40, 980), rand(3, 22), rand(1, 5), rand(0, 3), 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  // centre emblem
  g.save(); g.translate(512, 512); g.globalAlpha = 0.13;
  g.strokeStyle = '#c8fff1'; g.lineWidth = 16;
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 3 * k;
    g.beginPath(); g.moveTo(Math.cos(a) * 60, Math.sin(a) * 60); g.lineTo(Math.cos(a) * 108, Math.sin(a) * 108); g.stroke();
  }
  g.beginPath(); g.arc(0, 0, 58, 0, TAU); g.stroke(); g.restore();
  g.globalAlpha = 1;
  return makeTexture(cv, false);
}

function makeWallTexture() {
  const [cv, g] = canvas2d(512, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#3b5878'); grd.addColorStop(0.18, '#1c3a5c'); grd.addColorStop(0.8, '#12283f'); grd.addColorStop(1, '#0d1c30');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  // vertical panel seams
  for (let x = 0; x < 512; x += 64) {
    g.fillStyle = 'rgba(160,215,255,.26)'; g.fillRect(x, 0, 2, 512);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 2, 0, 3, 512);
  }
  // horizontal tech lines
  for (let y = 40; y < 512; y += 52) { g.fillStyle = 'rgba(140,205,255,.12)'; g.fillRect(0, y, 512, 2); }
  // diagonal hazard flashes
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(90,170,225,.05)';
    g.beginPath(); g.moveTo(i * 90, 512); g.lineTo(i * 90 + 44, 512); g.lineTo(i * 90 + 120, 380); g.lineTo(i * 90 + 76, 380); g.closePath(); g.fill();
  }
  // bright base band
  g.fillStyle = 'rgba(190,235,255,.2)'; g.fillRect(0, 430, 512, 3);
  g.fillStyle = 'rgba(190,235,255,.08)'; g.fillRect(0, 436, 512, 30);
  return makeTexture(cv, true);
}

function makeCrowdTexture() {
  const [cv, g] = canvas2d(512, 128);
  g.fillStyle = '#0b1a2d'; g.fillRect(0, 0, 512, 128);
  const cols = ['#ffcf6d', '#7fe6f3', '#ff8fa8', '#a9bcff', '#ffffff', '#61e9ff', '#ffad57', '#c792ff'];
  for (let y = 10; y < 124; y += 17) {
    for (let x = 5; x < 512; x += 11) {
      if (Math.random() < 0.8) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = rand(0.42, 0.85);
        g.beginPath();
        g.arc(x + rand(-1.5, 1.5), y + rand(-2, 2), rand(1.8, 3.4), 0, TAU);
        g.fill();
        g.globalAlpha = rand(0.1, 0.3);
        g.fillStyle = '#ffffff';
        g.fillRect(x - 1, y + 3, 2, 3);
      }
    }
  }
  g.globalAlpha = 1;
  // crowd rows
  g.fillStyle = 'rgba(0,0,0,.4)';
  for (let y = 24; y < 128; y += 17) g.fillRect(0, y, 512, 3);
  return makeTexture(cv, true, true);
}

function makeNetTexture() {
  const [cv, g] = canvas2d(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(220,245,255,.85)'; g.lineWidth = 2.6;
  for (let i = 0; i <= 256; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 5;
  g.strokeRect(2, 2, 252, 252);
  return makeTexture(cv, true);
}

function makeGlowTexture() {
  const [cv, g] = canvas2d(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.22, 'rgba(255,255,255,.8)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return makeTexture(cv, false);
}

function makeShadowTexture() {
  const [cv, g] = canvas2d(128, 128);
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,.72)'); gr.addColorStop(0.55, 'rgba(0,0,0,.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return makeTexture(cv, false);
}

function makeBallTexture() {
  const [cv, g] = canvas2d(512, 256);
  g.fillStyle = '#eef4f2'; g.fillRect(0, 0, 512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(0.55, 'rgba(190,205,208,.1)'); grd.addColorStop(1, 'rgba(90,110,120,.35)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  // hex panels
  const R = 25, dx = R * 1.72, dy = R * 1.5;
  for (let row = -1; row < 9; row++) {
    for (let col = -1; col < 16; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0), cy = row * dy;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k - Math.PI / 6;
        const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = '#5d6f78'; g.fill();
      g.fillStyle = 'rgba(250,253,252,.95)';
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k - Math.PI / 6;
        const x = cx + Math.cos(a) * R * 0.72, y = cy + Math.sin(a) * R * 0.72;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.fill();
    }
  }
  // team stripe accents
  g.fillStyle = 'rgba(70,180,255,.35)'; g.fillRect(0, 0, 512, 8);
  g.fillStyle = 'rgba(255,140,50,.35)'; g.fillRect(0, 248, 512, 8);
  // grime
  g.globalAlpha = 0.06;
  for (let i = 0; i < 120; i++) { g.fillStyle = '#27343a'; g.beginPath(); g.arc(rand(0, 512), rand(0, 256), rand(1, 8), 0, TAU); g.fill(); }
  g.globalAlpha = 1;
  return makeTexture(cv, true);
}

function makeBannerTexture() {
  const [cv, g] = canvas2d(512, 256);
  g.clearRect(0, 0, 512, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 9;
  g.beginPath();
  for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k - Math.PI / 2; const x = 76 + Math.cos(a) * 54, y = 128 + Math.sin(a) * 54; k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.stroke();
  g.fillStyle = '#fff'; g.font = 'italic 900 52px system-ui'; g.fillText('N', 76, 132);
  g.font = 'italic 900 84px system-ui'; g.fillText('NEON', 306, 94);
  g.font = '900 30px system-ui'; g.fillStyle = '#fff';
  g.fillText('L E A G U E', 306, 154);
  g.fillStyle = 'rgba(255,255,255,.65)'; g.fillRect(212, 188, 190, 3);
  g.font = '800 15px system-ui'; g.fillStyle = 'rgba(255,255,255,.75)';
  g.fillText('C H A M P I O N S H I P   S E R I E S', 306, 212);
  return makeTexture(cv, false);
}

const TEX = {
  field: makeFieldTexture(),
  wall: makeWallTexture(),
  crowd: makeCrowdTexture(),
  net: makeNetTexture(),
  glow: makeGlowTexture(),
  shadow: makeShadowTexture(),
  ball: makeBallTexture(),
  banner: makeBannerTexture()
};

/* ----------------------------- mesh builder ------------------------------ */
class Mesh {
  constructor(gl) {
    this.gl = gl; this.p = []; this.n = []; this.c = []; this.uv = [];
  }
  vert(x, y, z, nx, ny, nz, col, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.uv.push(u, v);
  }
  tri(a, b, c, col, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.vert(a[0], a[1], a[2], nx, ny, nz, col, ua[0], ua[1]);
    this.vert(b[0], b[1], b[2], nx, ny, nz, col, ub[0], ub[1]);
    this.vert(c[0], c[1], c[2], nx, ny, nz, col, uc[0], uc[1]);
  }
  quad(a, b, c, d, col, uvs) {
    const q = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, col, q[0], q[1], q[2]);
    this.tri(a, c, d, col, q[0], q[2], q[3]);
  }
  smoothTri(a, b, c, na, nb, nc, col, ua, ub, uc) {
    this.vert(a[0], a[1], a[2], na[0], na[1], na[2], col, ua[0], ua[1]);
    this.vert(b[0], b[1], b[2], nb[0], nb[1], nb[2], col, ub[0], ub[1]);
    this.vert(c[0], c[1], c[2], nc[0], nc[1], nc[2], col, uc[0], uc[1]);
  }
  box(x0, y0, z0, x1, y1, z1, col) {
    const a = [x0, y0, z0], b = [x1, y0, z0], c = [x1, y1, z0], d = [x0, y1, z0];
    const e = [x0, y0, z1], f = [x1, y0, z1], g = [x1, y1, z1], h = [x0, y1, z1];
    this.quad(a, b, c, d, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(f, e, h, g, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(e, a, d, h, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(b, f, g, c, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(d, c, g, h, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(e, f, b, a, col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  sphere(cx, cy, cz, r, seg, rings, col) {
    for (let i = 0; i < rings; i++) {
      const v0 = i / rings * Math.PI, v1 = (i + 1) / rings * Math.PI;
      for (let j = 0; j < seg; j++) {
        const u0 = j / seg * TAU, u1 = (j + 1) / seg * TAU;
        const P = (v, u) => [cx + r * Math.sin(v) * Math.cos(u), cy + r * Math.cos(v), cz + r * Math.sin(v) * Math.sin(u)];
        const N = (p) => [(p[0] - cx) / r, (p[1] - cy) / r, (p[2] - cz) / r];
        const a = P(v0, u0), b = P(v1, u0), c = P(v1, u1), d = P(v0, u1);
        const na = N(a), nb = N(b), nc = N(c), nd = N(d);
        const UV = (v, u) => [u / TAU, 1 - v / Math.PI];
        this.smoothTri(a, b, c, na, nb, nc, col, UV(v0, u0), UV(v1, u0), UV(v1, u1));
        this.smoothTri(a, c, d, na, nc, nd, col, UV(v0, u0), UV(v1, u1), UV(v0, u1));
      }
    }
  }
  cylinderX(cx, cy, cz, r, len, seg, col, capCol) {
    const hx = len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const p0 = [cx - hx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
      const p1 = [cx - hx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      const p2 = [cx + hx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      const p3 = [cx + hx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
      const n0 = [0, Math.cos(a0), Math.sin(a0)], n1 = [0, Math.cos(a1), Math.sin(a1)];
      this.smoothTri(p0, p1, p2, n0, n1, n1, col, [i / seg, 0], [(i + 1) / seg, 0], [(i + 1) / seg, 1]);
      this.smoothTri(p0, p2, p3, n0, n1, n0, col, [i / seg, 0], [(i + 1) / seg, 1], [i / seg, 1]);
    }
    const cc = capCol || col;
    for (const side of [-1, 1]) {
      const x = cx + side * hx;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
        const p1 = [x, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
        const p2 = [x, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
        const n = [side, 0, 0];
        if (side > 0) this.smoothTri([x, cy, cz], p1, p2, n, n, n, cc, [0.5, 0.5], [0, 0], [1, 0]);
        else this.smoothTri([x, cy, cz], p2, p1, n, n, n, cc, [0.5, 0.5], [1, 0], [0, 0]);
      }
    }
  }
  build() {
    const n = this.p.length / 3;
    const data = new Float32Array(n * 11);
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      data[o] = this.p[i * 3]; data[o + 1] = this.p[i * 3 + 1]; data[o + 2] = this.p[i * 3 + 2];
      data[o + 3] = this.n[i * 3]; data[o + 4] = this.n[i * 3 + 1]; data[o + 5] = this.n[i * 3 + 2];
      data[o + 6] = this.c[i * 3]; data[o + 7] = this.c[i * 3 + 1]; data[o + 8] = this.c[i * 3 + 2];
      data[o + 9] = this.uv[i * 2]; data[o + 10] = this.uv[i * 2 + 1];
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { vbo, count: n };
  }
}

/* draw helpers */
const A = {
  pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'),
  col: gl.getAttribLocation(prog, 'aCol'), uv: gl.getAttribLocation(prog, 'aUV')
};
const PA = {
  pos: gl.getAttribLocation(pointProg, 'aPos'), size: gl.getAttribLocation(pointProg, 'aSize'),
  col: gl.getAttribLocation(pointProg, 'aCol'), alpha: gl.getAttribLocation(pointProg, 'aAlpha')
};

let VIEW = M4.ident(), PROJ = M4.ident(), CAMERA = { pos: [0, 20, 40], target: [0, 0, 0], fov: 1.1, right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };
const FOG = rgb('#223a55');

function setMainAttribs(vbo) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const stride = 44;
  gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(A.nrm); gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, stride, 36);
}

function drawMesh(mesh, model, o = {}) {
  if (!mesh || !mesh.count) return;
  gl.useProgram(prog);
  gl.uniformMatrix4fv(U.uProj, false, PROJ);
  gl.uniformMatrix4fv(U.uView, false, VIEW);
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.uniform3fv(U.uCam, CAMERA.pos);
  gl.uniform3fv(U.uFogColor, FOG);
  gl.uniform1f(U.uFogNear, 135);
  gl.uniform1f(U.uFogFar, 420);
  gl.uniform1f(U.uAlpha, o.alpha === undefined ? 1 : o.alpha);
  gl.uniform1f(U.uEmissive, o.emissive || 0);
  gl.uniform1f(U.uUnlit, o.unlit ? 1 : 0);
  gl.uniform1f(U.uShine, o.shine === undefined ? 0.25 : o.shine);
  gl.uniform3fv(U.uTint, o.tint || [1, 1, 1]);
  if (o.tex) {
    gl.uniform1f(U.uUseTex, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.tex);
    gl.uniform1i(U.uTex, 0);
  } else gl.uniform1f(U.uUseTex, 0);
  if (o.additive) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
  else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  gl.depthMask(o.depthWrite === undefined ? true : o.depthWrite);
  setMainAttribs(mesh.vbo);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  if (o.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(true);
}

/* =========================================================================
   ARENA GEOMETRY
   ========================================================================= */
const AR = { hw: 50, hl: 70, h: 20, corner: 14, goalW: 28, goalH: 11, goalD: 9 };
const GOAL_HALF = AR.goalW / 2;

function roundedBoundary(hw, hl, r, seg) {
  const pts = [];
  pts.push([hw, -hl + r]);
  pts.push([hw, hl - r]);
  for (let i = 1; i <= seg; i++) { const a = i / seg * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, hl - r + Math.sin(a) * r]); }
  pts.push([-hw + r, hl]);
  for (let i = 1; i <= seg; i++) { const a = Math.PI / 2 + i / seg * Math.PI / 2; pts.push([-hw + r + Math.cos(a) * r, hl - r + Math.sin(a) * r]); }
  pts.push([-hw, -hl + r]);
  for (let i = 1; i <= seg; i++) { const a = Math.PI + i / seg * Math.PI / 2; pts.push([-hw + r + Math.cos(a) * r, -hl + r + Math.sin(a) * r]); }
  pts.push([hw - r, -hl]);
  for (let i = 1; i <= seg; i++) { const a = Math.PI * 1.5 + i / seg * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, -hl + r + Math.sin(a) * r]); }
  return pts;
}

function buildField() {
  const mb = new Mesh(gl);
  const hw = AR.hw, hl = AR.hl;
  const pts = roundedBoundary(hw, hl, AR.corner, 10);
  const C = { x: 0, y: 0.02, z: 0 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const A0 = [a[0], 0.02, a[1]], B0 = [b[0], 0.02, b[1]], Cc = [0, 0.02, 0];
    const uv = (p) => [(p[0] + hw) / (hw * 2), (p[2] + hl) / (hl * 2)];
    mb.tri(Cc, A0, B0, [1, 1, 1], uv(Cc), uv(A0), uv(B0));
  }
  return mb.build();
}

function wallTint(z) {
  const t = clamp(z / (AR.hl * 0.85), -1, 1);
  if (t < 0) return mixc([0.95, 0.98, 1], [0.12, 0.52, 1], -t * 0.6);
  return mixc([0.95, 0.98, 1], [1, 0.5, 0.1], t * 0.6);
}
function glowTint(z) {
  const t = clamp(z / (AR.hl * 0.8), -1, 1);
  if (t < -0.05) return mixc(COL.cyan, COL.blueL, -t * 0.5);
  if (t > 0.05) return mixc(COL.amber, COL.orangeL, t * 0.5);
  return mixc(COL.cyan, COL.amber, clamp((t + 0.05) / 0.1, 0, 1));
}

function wallSeg(mb, glow, p0, p1, y0, y1, tint, uOff) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const u0 = uOff, u1 = uOff + len / 11;
  const v0 = y0 / AR.h, v1 = y1 / AR.h;
  const a = [p0[0], y0, p0[1]], b = [p1[0], y0, p1[1]], c = [p1[0], y1, p1[1]], d = [p0[0], y1, p0[1]];
  mb.quad(a, b, c, d, tint, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  if (glow) {
    const inx = -dz / len, inz = dx / len;
    const off = 0.07;
    const gc = glowTint((p0[1] + p1[1]) / 2);
    const q0 = [p0[0] + inx * off, 0, p0[1] + inz * off], q1 = [p1[0] + inx * off, 0, p1[1] + inz * off];
    for (const band of [[1.65, 2.02], [18.55, 18.9], [0.12, 0.4], [15.3, 15.62]]) {
      const e0 = [q0[0], band[0], q0[2]], e1 = [q1[0], band[0], q1[2]];
      const e2 = [q1[0], band[1], q1[2]], e3 = [q0[0], band[1], q0[2]];
      glow.quad(e0, e1, e2, e3, band[0] < 1 ? shade(gc, 0.5) : gc, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    // vertical energy pillars along the wall
    const dirx = dx / len, dirz = dz / len;
    for (let d = 7; d < len - 3; d += 17) {
      const bx = p0[0] + dirx * d + inx * .08, bz = p0[1] + dirz * d + inz * .08;
      glow.quad([bx, 3.2, bz], [bx + dirx * .28, 3.2, bz + dirz * .28],
                [bx + dirx * .28, 15.2, bz + dirz * .28], [bx, 15.2, bz], shade(gc, 1.05), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
}

function buildWalls() {
  const mb = new Mesh(gl), glow = new Mesh(gl);
  const pts = roundedBoundary(AR.hw, AR.hl, AR.corner, 10);
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
    const endWall = Math.abs(p0[1]) > AR.hl - 0.2 && Math.abs(p1[1]) > AR.hl - 0.2 &&
                    Math.abs(p0[0]) < AR.hw - AR.corner + 1 && Math.abs(p1[0]) < AR.hw - AR.corner + 1;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (endWall) { u += len / 11; continue; }
    wallSeg(mb, glow, p0, p1, 0, AR.h, wallTint((p0[1] + p1[1]) / 2), u);
    u += len / 11;
  }
  // end walls with goal openings
  for (const sign of [-1, 1]) {
    const z = sign * AR.hl;
    const tintL = wallTint(sign * AR.hl);
    const segs = [[-AR.hw + AR.corner, -GOAL_HALF], [GOAL_HALF, AR.hw - AR.corner]];
    for (const s of segs) {
      wallSeg(mb, glow, [s[0], z], [s[1], z], 0, AR.h, tintL, u); u += Math.abs(s[1] - s[0]) / 11;
    }
    // header above goal
    const a = [-GOAL_HALF, AR.goalH, z], b = [GOAL_HALF, AR.goalH, z], c = [GOAL_HALF, AR.h, z], d = [-GOAL_HALF, AR.h, z];
    mb.quad(a, b, c, d, tintL, [[0, AR.goalH / AR.h], [2.5, AR.goalH / AR.h], [2.5, 1], [0, 1]]);
    // header glow
    const gc = glowTint(z);
    glow.quad([-GOAL_HALF, AR.goalH, z - sign * 0.05], [GOAL_HALF, AR.goalH, z - sign * 0.05],
              [GOAL_HALF, AR.goalH + 0.16, z - sign * 0.05], [-GOAL_HALF, AR.goalH + 0.16, z - sign * 0.05],
              gc, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // glowing goal mouth on turf
    glow.quad([-GOAL_HALF, 0.08, z - sign * 0.6], [GOAL_HALF, 0.08, z - sign * 0.6],
              [GOAL_HALF, 0.08, z], [-GOAL_HALF, 0.08, z], shade(gc, 0.8), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  return { wall: mb.build(), glow: glow.build() };
}

function buildStands() {
  const solid = new Mesh(gl), crowd = new Mesh(gl), leds = new Mesh(gl);
  const tiers = 5;
  for (const side of [-1, 1]) {
    for (let i = 0; i < tiers; i++) {
      const x0 = side * (AR.hw + 1.6 + i * 4.6), x1 = x0 + side * 4.6;
      const yTop = 20.5 + i * 4.8;
      const box0 = Math.min(x0, x1), box1 = Math.max(x0, x1);
      const xin = side > 0 ? box0 : box1;
      const y0 = i === 0 ? 14.5 : 20.5 + (i - 1) * 4.8;
      const y1 = yTop - 0.18;
    }
    // led ribbon
    leds.quad([side * (AR.hw + 1.55), 2.1, -AR.hl], [side * (AR.hw + 1.55), 2.1, AR.hl],
              [side * (AR.hw + 1.55), 2.45, AR.hl], [side * (AR.hw + 1.55), 2.45, -AR.hl],
              side > 0 ? COL.orangeL : COL.cyan, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  for (const sign of [-1, 1]) {
    for (let i = 0; i < tiers; i++) {
      const z0 = sign * (AR.hl + 1.6 + i * 4.6), z1 = z0 + sign * 4.6;
      const yTop = 20.5 + i * 4.8;
      const b0 = Math.min(z0, z1), b1 = Math.max(z0, z1);
      const zin = sign > 0 ? b0 : b1;
      const y0 = i === 0 ? 14.5 : 20.5 + (i - 1) * 4.8;
      const y1 = yTop - 0.18;
    }
    leds.quad([-AR.hw, 2.1, sign * (AR.hl + 1.55)], [AR.hw, 2.1, sign * (AR.hl + 1.55)],
              [AR.hw, 2.45, sign * (AR.hl + 1.55)], [-AR.hw, 2.45, sign * (AR.hl + 1.55)],
              sign > 0 ? COL.orangeL : COL.cyan, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // dark back wall behind the crowd bowl
  for (const side of [-1, 1]) solid.box(side > 0 ? AR.hw + 22 : -AR.hw - 26, 0, -AR.hl - 30, side > 0 ? AR.hw + 26 : -AR.hw - 22, 47, AR.hl + 30, rgb('#060f1b'));
  for (const sign of [-1, 1]) solid.box(-AR.hw - 30, 0, sign > 0 ? AR.hl + 22 : -AR.hl - 26, AR.hw + 30, 47, sign > 0 ? AR.hl + 26 : -AR.hl - 22, rgb('#060f1b'));
  // continuous sloped seating banks (far more stadium-like than stepped risers)
  for (const side of [-1, 1]) {
    const xin = side * (AR.hw + 1.2), xout = side * (AR.hw + 23);
    crowd.quad([xin, 19.2, -AR.hl - 8], [xin, 19.2, AR.hl + 8], [xin, 31.5, AR.hl + 8], [xin, 31.5, -AR.hl - 8],
      [1, 1, 1], [[0, 0], [16, 0], [16, 1.1], [0, 1.1]]);
    crowd.quad([xin, 31.5, -AR.hl - 8], [xin, 31.5, AR.hl + 8], [xout, 44.5, AR.hl + 8], [xout, 44.5, -AR.hl - 8],
      [1, 1, 1], [[0, 0], [16, 0], [16, 1.2], [0, 1.2]]);
  }
  for (const sign of [-1, 1]) {
    const zin = sign * (AR.hl + 1.2), zout = sign * (AR.hl + 23);
    crowd.quad([-AR.hw - 8, 19.2, zin], [AR.hw + 8, 19.2, zin], [AR.hw + 8, 31.5, zin], [-AR.hw - 8, 31.5, zin],
      [1, 1, 1], [[0, 0], [16, 0], [16, 1.1], [0, 1.1]]);
    crowd.quad([-AR.hw - 8, 31.5, zin], [AR.hw + 8, 31.5, zin], [AR.hw + 8, 44.5, zout], [-AR.hw - 8, 44.5, zout],
      [1, 1, 1], [[0, 0], [16, 0], [16, 1.2], [0, 1.2]]);
  }
  return { solid: solid.build(), crowd: crowd.build(), leds: leds.build() };
}

function buildGoals() {
  const frame = new Mesh(gl), net = new Mesh(gl), glow = new Mesh(gl);
  for (const sign of [-1, 1]) {
    const z = sign * AR.hl, zBack = sign * (AR.hl + AR.goalD);
    const c = sign < 0 ? COL.blueL : COL.orangeL;
    const edge = shade(c, 0.7);
    // posts
    for (const x of [-GOAL_HALF, GOAL_HALF]) {
      frame.box(x - 0.38, 0, z - 0.45, x + 0.38, AR.goalH, z + 0.45, c);
      glow.quad([x - 0.44, 0, z], [x - 0.44, AR.goalH, z], [x - 0.44, AR.goalH, z + sign * 0.12], [x - 0.44, 0, z + sign * 0.12],
                c, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      // back posts
      frame.box(x - 0.2, 0, zBack - 0.2, x + 0.2, AR.goalH, zBack + 0.2, shade(c, 0.5));
    }
    // crossbar
    frame.box(-GOAL_HALF, AR.goalH - 0.38, z - 0.45, GOAL_HALF, AR.goalH + 0.38, z + 0.45, c);
    frame.box(-GOAL_HALF, AR.goalH - 0.2, zBack - 0.2, GOAL_HALF, AR.goalH + 0.2, zBack + 0.2, shade(c, 0.5));
    // side top rails
    for (const x of [-GOAL_HALF, GOAL_HALF]) frame.box(x - 0.16, AR.goalH - 0.16, z, x + 0.16, AR.goalH + 0.16, zBack, shade(c, 0.5));
    // interior floor
    frame.box(-GOAL_HALF, 0, Math.min(z, zBack), GOAL_HALF, 0.1, Math.max(z, zBack), COL.dark);
    // glow goal line
    glow.quad([-GOAL_HALF, 0.1, z - sign * 0.1], [GOAL_HALF, 0.1, z - sign * 0.1],
              [GOAL_HALF, 0.1, z - sign * 0.34], [-GOAL_HALF, 0.1, z - sign * 0.34], edge, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // net: back
    net.quad([-GOAL_HALF, 0, zBack], [GOAL_HALF, 0, zBack], [GOAL_HALF, AR.goalH, zBack], [-GOAL_HALF, AR.goalH, zBack],
             [1, 1, 1], [[0, 0], [3.2, 0], [3.2, 1.3], [0, 1.3]]);
    // net: sides
    for (const x of [-GOAL_HALF, GOAL_HALF]) {
      net.quad([x, 0, z], [x, 0, zBack], [x, AR.goalH, zBack], [x, AR.goalH, z],
               [1, 1, 1], [[0, 0], [1.1, 0], [1.1, 1.3], [0, 1.3]]);
    }
    // net: top
    net.quad([-GOAL_HALF, AR.goalH, z], [GOAL_HALF, AR.goalH, z], [GOAL_HALF, AR.goalH, zBack], [-GOAL_HALF, AR.goalH, zBack],
             [1, 1, 1], [[0, 0], [3.2, 0], [3.2, 1.1], [0, 1.1]]);
  }
  return { frame: frame.build(), net: net.build(), glow: glow.build() };
}

/* jumbotron dynamic texture */
const jumboCanvas = document.createElement('canvas');
jumboCanvas.width = 512; jumboCanvas.height = 256;
const jctx = jumboCanvas.getContext('2d');
const jumboTex = gl.createTexture();
function uploadJumbo() {
  gl.bindTexture(gl.TEXTURE_2D, jumboTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, jumboCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}
function drawJumbo() {
  const g = jctx;
  g.fillStyle = '#050d18'; g.fillRect(0, 0, 512, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(30,110,200,.32)'); gr.addColorStop(1, 'rgba(6,15,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(110,210,255,.22)'; g.lineWidth = 2;
  for (let x = 0; x < 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.textAlign = 'center';
  g.fillStyle = '#bdeeff'; g.font = '900 23px system-ui';
  g.fillText('NEON LEAGUE', 256, 38);
  g.fillStyle = 'rgba(120,200,240,.5)'; g.font = '800 11px system-ui';
  g.fillText('C H A M P I O N S H I P   S E R I E S', 256, 57);
  g.font = 'italic 900 78px system-ui';
  g.fillStyle = '#7ce5ff'; g.fillText(String(GAME.blue), 132, 152);
  g.fillStyle = '#ffb066'; g.fillText(String(GAME.orange), 380, 152);
  g.fillStyle = '#e8f6ff'; g.font = 'italic 900 52px system-ui';
  const timeTxt = GAME.state === 'ended' ? 'FINAL' : (GAME.overtime ? 'OT +' : '') + clockText();
  g.fillText(timeTxt, 256, 152);
  g.fillStyle = 'rgba(140,210,245,.7)'; g.font = '800 13px system-ui';
  g.fillText(GAME.state === 'goal' ? 'GOAL REVIEW' : 'LIVE  •  3V3  •  5:00', 256, 205);
  g.fillStyle = '#ff8a2b'; g.fillRect(0, 234, 512, 3);
  g.fillStyle = '#3bc9ff'; g.fillRect(0, 237, 512, 3);
  uploadJumbo();
}

function buildJumbo() {
  const frame = new Mesh(gl), screen = new Mesh(gl);
  for (const sign of [-1, 1]) {
    const z = sign * (AR.hl + 4);
    const z2 = z - sign * 1.4;
    frame.box(-18.5, 23.5, Math.min(z, z2), 18.5, 42.5, Math.max(z, z2), COL.dark2);
    const a = [-16.6, 26.0, z2 - sign * 0.04], b = [16.6, 26.0, z2 - sign * 0.04], c = [16.6, 40.0, z2 - sign * 0.04], d = [-16.6, 40.0, z2 - sign * 0.04];
    if (sign > 0) screen.quad(a, b, c, d, [1, 1, 1], [[1, 0], [0, 0], [0, 1], [1, 1]]);
    else screen.quad(b, a, d, c, [1, 1, 1], [[1, 0], [0, 0], [0, 1], [1, 1]]);
    // supports
    frame.box(-11, 19.7, z - 0.5, -10.2, 23.6, z + 0.5, COL.metal);
    frame.box(10.2, 19.7, z - 0.5, 11, 23.6, z + 0.5, COL.metal);
  }
  return { frame: frame.build(), screen: screen.build() };
}

function buildWallDecals() {
  const m = new Mesh(gl);
  const quads = [];
  for (const side of [-1, 1]) {
    const x = side * (AR.hw - 0.12);
    for (const q of [[-34, COL.cyan], [34, COL.orangeL]]) {
      const zc = q[0], col = q[1];
      const uv = side > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]];
      m.quad([x, 4.4, zc - 11], [x, 4.4, zc + 11], [x, 14.8, zc + 11], [x, 14.8, zc - 11], col, uv);
    }
  }
  for (const sign of [-1, 1]) {
    const z = sign * (AR.hl - 0.12);
    const uv = [[1, 0], [0, 0], [0, 1], [1, 1]];
    m.quad([-13.4, 12.2, z], [13.4, 12.2, z], [13.4, 19.3, z], [-13.4, 19.3, z],
      sign < 0 ? COL.blueL : COL.orangeL, uv);
  }
  return m.build();
}

/* simple reusable meshes */
function buildQuadXZ() {
  const m = new Mesh(gl);
  m.quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return m.build();
}
function buildQuadXY() {
  const m = new Mesh(gl);
  m.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return m.build();
}

/* =========================================================================
   CAR MESH
   ========================================================================= */
function lofts(mb, stations, topCol, sideCol, bottomCol) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    const aL = [-a.w, a.y0, a.z], aR = [a.w, a.y0, a.z], aLT = [-a.w, a.y1, a.z], aRT = [a.w, a.y1, a.z];
    const bL = [-b.w, b.y0, b.z], bR = [b.w, b.y0, b.z], bLT = [-b.w, b.y1, b.z], bRT = [b.w, b.y1, b.z];
    mb.quad(aLT, aRT, bRT, bLT, topCol);
    mb.quad(aL, aLT, bLT, bL, shade(sideCol, 0.82));
    mb.quad(aR, bR, bRT, aRT, sideCol);
    mb.quad(aL, bL, bR, aR, bottomCol || COL.dark);
  }
}

function makeCarMesh(team) {
  const isBlue = team === 'blue';
  const body = isBlue ? COL.blue : COL.orange;
  const bodyL = isBlue ? COL.blueL : COL.orangeL;
  const bodyD = isBlue ? COL.blueD : COL.orangeD;
  const accent = isBlue ? COL.cyan : COL.amber;
  const hot = isBlue ? rgb('#d8fbff') : rgb('#fff1c8');
  const m = new Mesh(gl);

  // main chassis
  lofts(m, [
    { z: -2.32, w: 1.15, y0: 0.38, y1: 1.00 },
    { z: -1.25, w: 1.30, y0: 0.36, y1: 1.14 },
    { z: 0.55, w: 1.32, y0: 0.36, y1: 1.16 },
    { z: 1.62, w: 1.20, y0: 0.38, y1: 0.98 },
    { z: 2.43, w: 0.90, y0: 0.42, y1: 0.80 }
  ], body, bodyL, COL.dark);

  // hood / nose accent
  m.quad([-0.68, 1.02, 2.28], [0.68, 1.02, 2.28], [0.74, 1.16, 1.6], [-0.74, 1.16, 1.6], bodyD);
  // front splitter
  m.box(-1.02, 0.24, 2.18, 1.02, 0.40, 2.5, COL.dark);

  // cabin
  lofts(m, [
    { z: -1.5, w: 0.82, y0: 1.08, y1: 1.33 },
    { z: -0.95, w: 0.94, y0: 1.12, y1: 1.62 },
    { z: 0.48, w: 0.92, y0: 1.14, y1: 1.65 },
    { z: 0.96, w: 0.72, y0: 1.12, y1: 1.26 }
  ], body, COL.glass, COL.dark);
  // windshield
  m.quad([-0.82, 1.16, 1.42], [0.82, 1.16, 1.42], [0.7, 1.63, 0.62], [-0.7, 1.63, 0.62], COL.glass);
  // rear window
  m.quad([-0.78, 1.16, -1.5], [0.78, 1.16, -1.5], [0.66, 1.6, -1.02], [-0.66, 1.6, -1.02], COL.glass);
  // roof stripe
  m.quad([-0.19, 1.655, 0.45], [0.19, 1.655, 0.45], [0.19, 1.655, -0.7], [-0.19, 1.655, -0.7], accent);

  // side accent blades
  for (const s of [-1, 1]) {
    m.quad([s * 1.29, 0.72, 1.4], [s * 1.29, 0.72, -1.55], [s * 1.29, 0.94, -1.65], [s * 1.29, 0.94, 1.3], accent);
    // skirts
    m.box(Math.min(s * 1.26, s * 1.42), 0.28, -1.9, Math.max(s * 1.26, s * 1.42), 0.46, 1.7, COL.dark2);
  }

  // fenders
  for (const x of [-1.29, 1.29]) for (const z of [-1.52, 1.52]) {
    m.box(x - 0.16, 0.55, z - 0.7, x + 0.16, 1.18, z + 0.7, body);
  }

  // spoiler
  for (const x of [-0.72, 0.72]) m.box(x - 0.09, 1.05, -2.35, x + 0.09, 1.73, -2.12, COL.metal);
  m.box(-1.34, 1.7, -2.52, 1.34, 1.82, -2.1, accent);
  for (const s of [-1, 1]) m.box(s > 0 ? 1.3 : -1.42, 1.55, -2.52, s > 0 ? 1.42 : -1.3, 1.93, -2.08, bodyD);

  // headlights / taillights
  for (const s of [-1, 1]) {
    m.box(s * 0.52 - 0.19, 0.78, 2.39, s * 0.52 + 0.19, 0.94, 2.47, hot);
    m.box(s * 0.52 - 0.16, 0.8, -2.36, s * 0.52 + 0.16, 0.92, -2.3, isBlue ? rgb('#ff5470') : rgb('#ff7a4a'));
    // boosters
    m.box(s * 0.55 - 0.2, 0.55, -2.5, s * 0.55 + 0.2, 0.95, -2.25, COL.dark);
    m.box(s * 0.55 - 0.12, 0.65, -2.53, s * 0.55 + 0.12, 0.85, -2.48, accent);
  }

  // underglow strip
  m.box(-0.9, 0.29, -1.6, 0.9, 0.35, 1.6, accent);

  // wheels
  for (const x of [-1.38, 1.38]) for (const z of [-1.52, 1.52]) {
    m.cylinderX(x, 0.62, z, 0.63, 0.48, 14, COL.tire);
    const outer = x > 0 ? x + 0.27 : x - 0.27;
    m.cylinderX(outer, 0.62, z, 0.34, 0.06, 12, shade(accent, 0.85));
    m.cylinderX(outer, 0.62, z, 0.13, 0.08, 8, COL.dark);
  }
  return m.build();
}

function buildBall() {
  const m = new Mesh(gl);
  m.sphere(0, 0, 0, 2.4, 32, 20, [1, 1, 1]);
  return m.build();
}

/* pads */
function buildPadRing(r, col) {
  const m = new Mesh(gl);
  const seg = 18;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
    const p0 = [Math.cos(a0) * r, 0.03, Math.sin(a0) * r];
    const p1 = [Math.cos(a1) * r, 0.03, Math.sin(a1) * r];
    const p2 = [Math.cos(a1) * r * 0.72, 0.03, Math.sin(a1) * r * 0.72];
    const p3 = [Math.cos(a0) * r * 0.72, 0.03, Math.sin(a0) * r * 0.72];
    m.quad(p0, p1, p2, p3, col);
  }
  return m.build();
}

/* =========================================================================
   SOUND — tiny procedural WebAudio mix
   ========================================================================= */
const Sound = {
  ready: false, muted: false,
  init() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // reusable noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    this.noiseBuf = buf;
    // engine
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 420; this.engFilter.Q.value = 3;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 54;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 81;
    this.engGain2 = ctx.createGain(); this.engGain2.gain.value = .35;
    this.osc1.connect(this.engFilter); this.osc2.connect(this.engGain2); this.engGain2.connect(this.engFilter);
    this.osc1.start(); this.osc2.start();
    // boost hiss
    this.boostGain = ctx.createGain(); this.boostGain.gain.value = 0;
    this.boostFilter = ctx.createBiquadFilter(); this.boostFilter.type = 'bandpass'; this.boostFilter.frequency.value = 1100; this.boostFilter.Q.value = .7;
    const bn = ctx.createBufferSource(); bn.buffer = buf; bn.loop = true;
    bn.connect(this.boostFilter); this.boostFilter.connect(this.boostGain); this.boostGain.connect(this.master); bn.start();
    // crowd
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.018;
    const cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 620;
    const cn = ctx.createBufferSource(); cn.buffer = buf; cn.loop = true;
    cn.connect(cf); cf.connect(this.crowdGain); this.crowdGain.connect(this.master); cn.start();
    this.crowdSwell = 1;
    this.ready = true;
  },
  toggle() {
    this.muted = !this.muted;
    if (this.ready) this.master.gain.setTargetAtTime(this.muted ? 0 : .7, this.ctx.currentTime, .05);
    return !this.muted;
  },
  update(speed, throttle, boosting, alive) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = clamp(speed / 56, 0, 1);
    this.engGain.gain.setTargetAtTime(alive ? (0.016 + sp * .038 + Math.abs(throttle) * .012) : 0, t, .08);
    this.engFilter.frequency.setTargetAtTime(300 + sp * 900, t, .1);
    this.osc1.frequency.setTargetAtTime(48 + sp * 68, t, .12);
    this.osc2.frequency.setTargetAtTime(72 + sp * 102, t, .12);
    this.boostGain.gain.setTargetAtTime(boosting && alive ? .055 : 0, t, .06);
    this.crowdSwell = smooth(this.crowdSwell, 1, 1.2, 1 / 60);
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(0.017 * this.crowdSwell, t, .4);
  },
  tone(freq, dur, vol, type, slideTo) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .02);
  },
  noise(dur, vol, freq, type, slideTo) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq || 900, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + .02);
  },
  hit(power) {
    const p = clamp(power / 40, 0, 1);
    this.tone(120 - p * 40, .16 + p * .12, .09 + p * .12, 'sine', 45);
    this.noise(.08 + p * .1, .05 + p * .11, 1600, 'lowpass', 400);
  },
  bounce(power) { this.tone(90, .11, .03 + power * .0008, 'sine', 55); },
  pickup(big) { this.tone(big ? 620 : 820, .09, .035, 'triangle', big ? 980 : 1180); },
  beep(high) { this.tone(high ? 880 : 440, .12, .06, 'sine'); },
  jump() { this.tone(240, .12, .025, 'triangle', 380); },
  flip() { this.noise(.18, .04, 1200, 'bandpass', 300); },
  demo() { this.noise(.5, .18, 500, 'lowpass', 60); this.tone(70, .5, .13, 'sine', 28); },
  goal(blue) {
    this.noise(.9, .18, 1800, 'lowpass', 200);
    this.tone(blue ? 420 : 360, .9, .07, 'sine', blue ? 620 : 300);
    this.crowdSwell = 2.8;
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(.1, this.ctx.currentTime, .05);
  },
  resetCrowd() {
    if (this.ready && this.crowdGain) this.crowdGain.gain.setTargetAtTime(.018, this.ctx.currentTime, .6);
    this.crowdSwell = 1;
  },
  ui() { this.tone(520, .06, .03, 'sine', 720); }
};

/* =========================================================================
   INPUT
   ========================================================================= */
const KEYS = new Set();
let jumpQueued = false, pauseQueued = false;
const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd', ' ': ' ', shift: 'shift', control: 'control' };
function keyName(e) {
  let k = e.key.toLowerCase();
  return keyMap[k] || k;
}
addEventListener('keydown', e => {
  const k = keyName(e);
  if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (!KEYS.has(k)) {
    if (k === ' ') jumpQueued = true;
    if (k === 'escape') pauseQueued = true;
    if (k === 'c') toggleCam();
    if (k === 'm') { const on = Sound.toggle(); document.getElementById('soundBtn').textContent = on ? 'SOUND ON' : 'SOUND OFF'; }
    if (k === 'r' && (GAME.state === 'play' || GAME.state === 'kickoff')) resetPlayerCar();
  }
  KEYS.add(k);
}, { passive: false });
addEventListener('keyup', e => KEYS.delete(keyName(e)));
addEventListener('blur', () => KEYS.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden && (GAME.state === 'play' || GAME.state === 'kickoff')) setPaused(true); });

// gamepad
let padPrev = {};
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if (!gp) return null;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const btn = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const jump = btn(0), boost = btn(7) || btn(5), drift = btn(2) || btn(4);
  if (jump && !padPrev.jump) jumpQueued = true;
  padPrev.jump = jump;
  return {
    throttle: clamp(-ay, -1, 1), steer: clamp(ax, -1, 1), jump, boost, drift,
    start: btn(9)
  };
}

/* touch */
document.querySelectorAll('.tbtn').forEach(btn => {
  const k = btn.dataset.k;
  const tap = btn.dataset.tap;
  const down = e => {
    e.preventDefault(); btn.classList.add('on');
    if (tap === 'cam') { toggleCam(); return; }
    if (!KEYS.has(k)) { if (k === ' ') jumpQueued = true; }
    KEYS.add(k);
  };
  const up = e => { e.preventDefault(); btn.classList.remove('on'); if (k) KEYS.delete(k); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

/* =========================================================================
   GAME STATE / ENTITIES
   ========================================================================= */
const GAME = {
  state: 'menu', paused: false, time: 0, blue: 0, orange: 0, clock: 300, countdown: 0,
  overtime: false, otTime: 0, goalTimer: 0, goalTeam: null, scorer: '', shake: 0,
  camMode: 'ball', goalCam: 0, lastTouch: null, hitFlash: 0, lastBeep: 4,
  bannerTimer: 0, jumboTimer: 0, demoCooldown: 0
};
const ball = {
  x: 0, y: 2.4, z: 0, vx: 0, vy: 0, vz: 0, r: 2.4, rot: M4.ident(), scored: false, inGoal: 0
};

function makeCar(team, name, isPlayer, x, z, yaw) {
  return {
    team, name, isPlayer, x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitchVis: 0, rollVis: 0,
    boost: 100, onGround: true, jumps: 0, flipT: 0, flipF: 0, flipS: 0,
    alive: true, respawn: 0, boostActive: false, throttle: 0, steer: 0, drift: false,
    hitCooldown: 0, mesh: makeCarMesh(team), homeX: x, homeZ: z
  };
}
const PLAYER = makeCar('blue', 'YOU', true, 0, -44, 0);
const BOTS = [
  makeCar('blue', 'RIVET', false, -15, -55, 0),
  makeCar('blue', 'VOLT', false, 16, -53, 0),
  makeCar('orange', 'BLAZE', false, 0, 45, Math.PI),
  makeCar('orange', 'TORQUE', false, -15, 55, Math.PI),
  makeCar('orange', 'NITRO', false, 16, 54, Math.PI)
];
const CARS = [PLAYER, ...BOTS];
BOTS.forEach((b, i) => { b.role = 'mid'; b.think = rand(0, .3); b.lane = i % 2 ? 1 : -1; b.skill = rand(.82, 1); });

const PADS = [];
function addPad(x, z, big) {
  PADS.push({ x, z, big, r: big ? 2.5 : 1.35, val: big ? 100 : 12, t: 0, max: big ? 10 : 4, mesh: null, phase: rand(0, TAU) });
}
[[-38, -52, 1], [38, -52, 1], [-38, 0, 1], [38, 0, 1], [-38, 52, 1], [38, 52, 1],
 [-22, -32, 0], [22, -32, 0], [-22, -10, 0], [22, -10, 0], [-22, 12, 0], [22, 12, 0],
 [-22, 34, 0], [22, 34, 0], [-9, -58, 0], [9, -58, 0], [-9, 58, 0], [9, 58, 0]].forEach(p => addPad(p[0], p[1], !!p[2]));
const padRingBig = buildPadRing(2.5, COL.amber);
const padRingSmall = buildPadRing(1.35, COL.amber);
PADS.forEach(p => p.mesh = p.big ? padRingBig : padRingSmall);

const ARENA_LIGHTS = [];
for (const side of [-1, 1]) for (const z of [-45, 0, 45]) ARENA_LIGHTS.push([side * (AR.hw + 23), 43, z]);
for (const sign of [-1, 1]) for (const x of [-30, 0, 30]) ARENA_LIGHTS.push([x, 43, sign * (AR.hl + 23)]);


/* scene */
const SCENE = {};
SCENE.field = buildField();
const walls = buildWalls(); SCENE.wall = walls.wall; SCENE.wallGlow = walls.glow;
const stands = buildStands(); SCENE.stands = stands.solid; SCENE.crowd = stands.crowd; SCENE.leds = stands.leds;
const goals = buildGoals(); SCENE.goalFrame = goals.frame; SCENE.goalNet = goals.net; SCENE.goalGlow = goals.glow;
const jumbo = buildJumbo(); SCENE.jumboFrame = jumbo.frame; SCENE.jumboScreen = jumbo.screen;
SCENE.decals = buildWallDecals();
SCENE.shadow = buildQuadXZ();
SCENE.glowQuad = buildQuadXY();
SCENE.ball = buildBall();
TEX.jumbo = jumboTex;
drawJumbo();

function ballModel() {
  return M4.mul(M4.trans(ball.x, ball.y, ball.z), ball.rot);
}
function carModel(car) {
  if (!car) return M4.ident();
  return M4.compose(car.x, car.y, car.z, car.yaw, car.pitchVis, car.rollVis);
}

/* =========================================================================
   PARTICLES
   ========================================================================= */
const particles = [];
const MAXP = 900;
function spawnParticle(x, y, z, vx, vy, vz, life, size, color, grav, drag) {
  if (particles.length >= MAXP) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav: grav === undefined ? 8 : grav, drag: drag === undefined ? 1.2 : drag });
}
function burst(x, y, z, n, colors, speed, size, life, grav) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), u = rand(-.15, 1), rr = Math.sqrt(Math.max(0, 1 - u * u));
    spawnParticle(x, y, z,
      Math.cos(a) * rr * rand(speed * .2, speed),
      u * rand(speed * .3, speed * .9) + speed * .15,
      Math.sin(a) * rr * rand(speed * .2, speed),
      rand(life * .5, life), rand(size * .4, size),
      colors[(Math.random() * colors.length) | 0], grav, 1.4);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy -= p.grav * dt;
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vz *= d;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < .05) { p.y = .05; p.vy *= -.35; p.vx *= .7; p.vz *= .7; }
  }
}

/* =========================================================================
   FLOW / UI HELPERS
   ========================================================================= */
const $ = id => document.getElementById(id);
function clockText() {
  if (GAME.overtime) return '+' + Math.floor(GAME.otTime / 60) + ':' + String(Math.floor(GAME.otTime % 60)).padStart(2, '0');
  const s = Math.max(0, Math.ceil(GAME.clock));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function showBanner(big, small, cls) {
  const b = $('banner');
  $('bannerBig').textContent = big;
  $('bannerBig').className = 'bannerbig ' + (cls || '');
  $('bannerSmall').textContent = small || '';
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('show', 'pop');
}
function hideBanner() { $('banner').classList.remove('show'); }
function showGoalOverlay(team, scorer) {
  const o = $('goalOverlay');
  o.className = 'goaloverlay show ' + (team === 'orange' ? 'orange' : '');
  $('goalTeam').textContent = team === 'blue' ? 'BLUE SQUAD' : 'ORANGE CREW';
  $('goalScorer').textContent = scorer || '';
  const w = o.querySelector('.goalword');
  w.style.animation = 'none'; void w.offsetWidth; w.style.animation = '';
}
function hideGoalOverlay() { $('goalOverlay').className = 'goaloverlay'; }
function triggerFlash() {
  const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const s = $('shockwave'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
}
function toggleCam() {
  GAME.camMode = GAME.camMode === 'ball' ? 'car' : 'ball';
  const btn = $('camBtn');
  btn.innerHTML = '<span class="dot"></span>' + (GAME.camMode === 'ball' ? 'BALL CAM' : 'CAR CAM');
  btn.classList.toggle('off', GAME.camMode !== 'ball');
}
function setPaused(v) {
  if (GAME.state !== 'play' && GAME.state !== 'kickoff') return;
  GAME.paused = v;
  $('pauseScreen').classList.toggle('hidden', !v);
  $('pauseBtn').textContent = v ? '▶  RESUME' : 'Ⅱ  PAUSE';
  if (v && Sound.ready) Sound.engGain.gain.setTargetAtTime(0, Sound.ctx.currentTime, .05);
}
function resetPads() { PADS.forEach(p => { p.t = 0; p.phase = rand(0, TAU); }); }
function resetKickoff(snap) {
  ball.x = 0; ball.y = 2.4; ball.z = 0; ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.rot = M4.ident(); ball.scored = false; ball.inGoal = 0;
  const spots = {
    blue: [[0, -44], [-15, -55], [16, -53]],
    orange: [[0, 45], [-15, 55], [16, 54]]
  };
  for (const team of ['blue', 'orange']) {
    const list = CARS.filter(c => c.team === team);
    list.forEach((c, i) => {
      const s = spots[team][i] || spots[team][0];
      c.x = s[0]; c.z = s[1]; c.y = 0; c.yaw = team === 'blue' ? 0 : Math.PI;
      c.vx = c.vy = c.vz = 0; c.boost = 100; c.onGround = true; c.jumps = 0;
      c.flipT = 0; c.pitchVis = 0; c.rollVis = 0; c.alive = true; c.respawn = 0;
      c.boostActive = false; c.invuln = 1.5; c.hitCooldown = 0;
    });
  }
  GAME.lastTouch = null;
  GAME.shake = 0;
  resetPads();
  if (snap) camState.snap = true;
}
function startMatch() {
  Sound.init(); Sound.resetCrowd();
  GAME.blue = 0; GAME.orange = 0; GAME.clock = 300; GAME.otTime = 0; GAME.overtime = false;
  GAME.state = 'kickoff'; GAME.countdown = 3.2; GAME.lastBeep = 4; GAME.paused = false;
  GAME.goalTimer = 0; GAME.goalTeam = null; GAME.scorer = ''; GAME.bannerTimer = 0;
  GAME.jumboTimer = 0;
  jumpQueued = false;
  resetKickoff(true);
  hideGoalOverlay(); hideBanner();
  document.body.classList.remove('in-menu');
  $('menu').classList.add('hidden'); $('endScreen').classList.add('hidden'); $('pauseScreen').classList.add('hidden');
  $('pauseBtn').textContent = 'Ⅱ  PAUSE';
  $('modeLabel').textContent = '3V3';
  $('clock').classList.remove('overtime');
  drawJumbo();
}
function startOvertime() {
  GAME.overtime = true; GAME.otTime = 0; GAME.state = 'kickoff'; GAME.countdown = 3.2; GAME.lastBeep = 4;
  resetKickoff(true);
  $('clock').classList.add('overtime');
  $('modeLabel').textContent = 'OVERTIME';
  showBanner('OVERTIME', 'NEXT GOAL WINS', 'ot');
  GAME.bannerTimer = 1.8;
  Sound.beep(true);
}
function endMatch() {
  GAME.state = 'ended';
  hideBanner(); hideGoalOverlay();
  const blueWon = GAME.blue > GAME.orange;
  const tie = GAME.blue === GAME.orange;
  $('endScreen').classList.remove('hidden');
  $('endKicker').textContent = GAME.overtime ? 'OVERTIME COMPLETE' : 'MATCH COMPLETE';
  const title = $('endTitle');
  title.textContent = tie ? 'DRAW' : (blueWon ? 'VICTORY' : 'DEFEAT');
  title.className = blueWon ? 'win' : (tie ? '' : 'lose');
  $('endBlue').textContent = GAME.blue; $('endOrange').textContent = GAME.orange;
  $('endStats').textContent = (GAME.overtime ? 'SUDDEN DEATH' : '3V3 · 5:00') + ' · ' + (blueWon ? 'BLUE SQUAD' : tie ? 'NO WINNER' : 'ORANGE CREW') + ' TAKES IT';
  Sound.resetCrowd();
  drawJumbo();
}
function quitToMenu() {
  GAME.state = 'menu'; GAME.paused = false;
  hideBanner(); hideGoalOverlay();
  $('pauseScreen').classList.add('hidden'); $('endScreen').classList.add('hidden');
  $('menu').classList.remove('hidden');
  document.body.classList.add('in-menu');
  $('pauseBtn').textContent = 'Ⅱ  PAUSE';
  resetKickoff(true);
}
function scoreGoal(team) {
  if (GAME.state !== 'play') return;
  const own = GAME.lastTouch && GAME.lastTouch.team !== team;
  if (team === 'blue') GAME.blue++; else GAME.orange++;
  GAME.state = 'goal'; GAME.goalTimer = 2.7; GAME.goalCam = 2.7; GAME.goalTeam = team;
  GAME.scorer = GAME.lastTouch ? GAME.lastTouch.name : '';
  if (own) GAME.scorer += ' · OWN GOAL';
  GAME.shake = 1.25;
  ball.scored = true;
  const c = team === 'blue' ? [COL.cyan, COL.blueL, COL.white] : [COL.orangeL, COL.amber, COL.white];
  burst(ball.x, ball.y, ball.z, 170, c, 28, 1.4, 2.4, 9);
  for (let i = 0; i < 50; i++) spawnParticle(ball.x, ball.y, ball.z, rand(-10, 10), rand(2, 16), rand(-10, 10), rand(.7, 1.8), rand(.6, 2.2), COL.white, 6, 1.5);
  showGoalOverlay(team, GAME.scorer);
  triggerFlash();
  Sound.goal(team === 'blue');
  drawJumbo();
}
function resetPlayerCar() {
  if (!PLAYER.alive) return;
  PLAYER.x = 0; PLAYER.z = PLAYER.team === 'blue' ? -50 : 50;
  PLAYER.y = 0; PLAYER.vx = PLAYER.vy = PLAYER.vz = 0;
  PLAYER.yaw = PLAYER.team === 'blue' ? 0 : Math.PI;
  PLAYER.boost = Math.max(PLAYER.boost, 34);
  PLAYER.onGround = true; PLAYER.jumps = 0; PLAYER.pitchVis = 0; PLAYER.rollVis = 0;
  camState.snap = true;
  burst(PLAYER.x, 1, PLAYER.z, 18, [COL.cyan, COL.white], 7, .5, .7, 4);
}
function respawnCar(car) {
  car.alive = true; car.respawn = 0;
  const own = car.team === 'blue' ? -1 : 1;
  car.x = car.homeX * .6 + rand(-4, 4); car.z = own * 52; car.y = 0;
  car.vx = car.vy = car.vz = 0; car.yaw = own < 0 ? 0 : Math.PI;
  car.boost = 34; car.onGround = true; car.jumps = 0; car.invuln = 1.6;
  car.pitchVis = 0; car.rollVis = 0; car.flipT = 0;
  if (car.isPlayer) camState.snap = true;
  burst(car.x, 1.2, car.z, 26, car.team === 'blue' ? [COL.cyan, COL.blueL] : [COL.orangeL, COL.amber], 8, .6, .8, 3);
}
function demolish(car) {
  car.alive = false; car.respawn = 3.0;
  burst(car.x, 1.2, car.z, 70, car.team === 'blue' ? [COL.cyan, COL.white, COL.blueL] : [COL.orangeL, COL.white, COL.amber], 16, 1.0, 1.4, 9);
  GAME.shake = Math.max(GAME.shake, .8);
  Sound.demo();
  if (car.isPlayer) {
    triggerFlash();
    showBanner('DEMOLISHED', 'RESPAWNING', 'demo');
    GAME.bannerTimer = 1.4;
  }
}

/* =========================================================================
   PHYSICS
   ========================================================================= */
function keepCarInside(car) {
  const p = 2.25, hw = AR.hw - p, hl = AR.hl - p, r = AR.corner - p;
  let x = car.x, z = car.z, vx = car.vx, vz = car.vz;
  if (Math.abs(x) > hw - r && Math.abs(z) > hl - r) {
    const cx = Math.sign(x) * (hw - r), cz = Math.sign(z) * (hl - r);
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d > r) {
      const nx = dx / d, nz = dz / d;
      x = cx + nx * r; z = cz + nz * r;
      const vn = vx * nx + vz * nz;
      if (vn > 0) { vx -= nx * vn * 1.35; vz -= nz * vn * 1.35; }
    }
  } else {
    if (x > hw) { x = hw; if (vx > 0) vx *= -.35; }
    if (x < -hw) { x = -hw; if (vx < 0) vx *= -.35; }
    if (z > hl) { z = hl; if (vz > 0) vz *= -.35; }
    if (z < -hl) { z = -hl; if (vz < 0) vz *= -.35; }
  }
  car.x = x; car.z = z; car.vx = vx; car.vz = vz;
}

function updateCar(car, dt, c) {
  if (!car.alive) { car.respawn -= dt; if (car.respawn <= 0) respawnCar(car); return; }
  if (car.invuln > 0) car.invuln -= dt;
  if (car.hitCooldown > 0) car.hitCooldown -= dt;

  let fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
  let rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw);
  const throttle = clamp(c.throttle || 0, -1, 1);
  const steer = clamp(c.steer || 0, -1, 1);
  const drift = !!c.drift;
  const boosting = !!c.boost && car.boost > 0;
  car.boostActive = boosting && car.boost > 2;
  car.throttle = throttle; car.steer = steer; car.drift = drift;

  const sp0 = hyp(car.vx, car.vz);
  const fwdSpeed = car.vx * fwdX + car.vz * fwdZ;

  // steering
  if (car.onGround) {
    const turnRate = (2.45 - clamp(sp0 / 58, 0, 1) * 1.05) * (drift ? 1.32 : 1);
    car.yaw += steer * turnRate * dt * (fwdSpeed < -2 ? -1 : 1);
  } else {
    car.yaw += steer * 1.45 * dt;
  }
  fwdX = Math.sin(car.yaw); fwdZ = Math.cos(car.yaw);
  rightX = Math.cos(car.yaw); rightZ = -Math.sin(car.yaw);

  // jump / dodge
  if (c.jump) {
    if (car.onGround) {
      car.vy = 14.6; car.onGround = false; car.jumps = 1; car.y += .02;
      Sound.jump();
      burst(car.x, .5, car.z, 8, [COL.white, rgb('#9fb6c8')], 4, .3, .5, 4);
    } else if (car.jumps < 2) {
      car.jumps = 2;
      const dirLen = Math.hypot(throttle, steer);
      if (dirLen > .25) {
        const df = throttle / dirLen, ds = steer / dirLen;
        car.vx += (fwdX * df + rightX * ds) * 18;
        car.vz += (fwdZ * df + rightZ * ds) * 18;
        car.vy = Math.max(car.vy, 7.5);
        car.flipT = .44; car.flipF = df; car.flipS = ds;
        Sound.flip();
        burst(car.x, car.y + .8, car.z, 12, [COL.cyan, COL.white], 5, .35, .6, 2);
      } else {
        car.vy = 11.5;
        Sound.jump();
      }
    }
  }

  if (car.onGround) {
    if (throttle > 0) {
      car.vx += fwdX * 31 * throttle * dt;
      car.vz += fwdZ * 31 * throttle * dt;
    } else if (throttle < 0) {
      if (fwdSpeed > 1.5) {
        car.vx -= fwdX * 52 * dt; car.vz -= fwdZ * 52 * dt;
      } else if (fwdSpeed > -20) {
        car.vx += fwdX * 17 * throttle * dt; car.vz += fwdZ * 17 * throttle * dt;
      }
    }
    // lateral grip
    const lat = car.vx * rightX + car.vz * rightZ;
    const grip = drift ? 2.1 : 10.5;
    const k = 1 - Math.exp(-grip * dt);
    car.vx -= rightX * lat * k; car.vz -= rightZ * lat * k;
    // rolling friction
    if (Math.abs(throttle) < .08 && !boosting) {
      const fr = Math.exp(-1.6 * dt); car.vx *= fr; car.vz *= fr;
    }
    // drift sparks
    if (drift && sp0 > 16 && Math.random() < dt * 45) {
      spawnParticle(car.x - fwdX * 1.5, .25, car.z - fwdZ * 1.5, rand(-1, 1), rand(.4, 2), rand(-1, 1), rand(.2, .5), rand(.15, .35), rgb('#dff2ff'), 4, 2);
    }
  } else {
    // gentle air pitch steer visual + slight air control
    if (Math.abs(throttle) > .1) { car.vx += fwdX * throttle * 5.5 * dt; car.vz += fwdZ * throttle * 5.5 * dt; }
  }

  if (boosting) {
    const accel = 46;
    car.vx += fwdX * accel * dt; car.vz += fwdZ * accel * dt;
    car.boost = Math.max(0, car.boost - 33 * dt);
    for (const s of [-1, 1]) {
      const p = carLocal(car, s * .55, .78, -2.55);
      spawnParticle(p[0], p[1], p[2], -fwdX * rand(2, 7) + rand(-1.4, 1.4), rand(-.4, 1.6), -fwdZ * rand(2, 7) + rand(-1.4, 1.4),
        rand(.22, .5), rand(.22, .55), car.team === 'blue' ? (Math.random() < .5 ? COL.cyan : COL.blueL) : (Math.random() < .5 ? COL.amber : COL.orangeL), 1.5, 2.2);
    }
  }

  // drag
  const drag = Math.exp(-.09 * dt);
  car.vx *= drag; car.vz *= drag;

  // speed cap
  const maxSp = boosting ? 56 : 37;
  const sp = hyp(car.vx, car.vz);
  if (sp > maxSp) {
    const k = 1 - Math.exp(-6 * dt);
    const ns = lerp(sp, maxSp, k);
    car.vx *= ns / sp; car.vz *= ns / sp;
  }

  car.x += car.vx * dt; car.z += car.vz * dt;
  if (!car.onGround) {
    car.vy -= 34 * dt;
    car.y += car.vy * dt;
    if (car.y <= 0) {
      car.y = 0;
      if (car.vy < -7 && Math.abs(car.vx) + Math.abs(car.vz) > 12) {
        for (let i = 0; i < 10; i++) spawnParticle(car.x + rand(-1, 1), .2, car.z + rand(-1, 1), rand(-2, 2), rand(.5, 2.5), rand(-2, 2), rand(.3, .6), rand(.12, .3), rgb('#b7cad8'), 3, 2);
      }
      car.vy = 0; car.onGround = true; car.jumps = 0; car.flipT = 0;
    }
  } else car.y = 0;

  // visual pitch/roll
  if (car.flipT > 0) {
    car.flipT -= dt;
    const t = 1 - car.flipT / .44;
    car.pitchVis = car.flipF * t * TAU;
    car.rollVis = -car.flipS * t * TAU;
  } else {
    car.pitchVis = smooth(car.pitchVis, 0, 9, dt);
    car.rollVis = smooth(car.rollVis, car.onGround && drift ? -steer * .16 : (car.onGround ? 0 : steer * -.12), 8, dt);
  }

  // supersonic trail
  if (hyp(car.vx, car.vz) > 30 && Math.random() < dt * 34) {
    spawnParticle(car.x - Math.sin(car.yaw) * 2, .5, car.z - Math.cos(car.yaw) * 2, rand(-.6, .6), rand(.2, 1.2), rand(-.6, .6), rand(.2, .45), rand(.15, .3), car.team === 'blue' ? COL.cyan : COL.amber, 1, 1.8);
  }

  keepCarInside(car);
}

function carLocal(car, lx, ly, lz) {
  const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
  return [car.x + c * lx + s * lz, car.y + ly, car.z - s * lx + c * lz];
}

function collideCars(dt) {
  for (let i = 0; i < CARS.length; i++) {
    const a = CARS[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < CARS.length; j++) {
      const b = CARS[j];
      if (!b.alive) continue;
      if (Math.abs(a.y - b.y) > 2.8) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d > 4.2 || d < .0001) continue;
      const nx = dx / d, nz = dz / d;
      const overlap = 4.2 - d;
      a.x -= nx * overlap * .5; a.z -= nz * overlap * .5;
      b.x += nx * overlap * .5; b.z += nz * overlap * .5;
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const imp = -vn * .55;
        a.vx -= nx * imp; a.vz -= nz * imp;
        b.vx += nx * imp; b.vz += nz * imp;
      }
      // demolition
      if (a.hitCooldown <= 0 && a.boostActive && hyp(a.vx, a.vz) > 31 && (a.vx * nx + a.vz * nz) > 25) {
        if (b.invuln <= 0) demolish(b); a.hitCooldown = .7;
      } else if (b.hitCooldown <= 0 && b.boostActive && hyp(b.vx, b.vz) > 31 && (b.vx * -nx + b.vz * -nz) > 25) {
        if (a.invuln <= 0) demolish(a); b.hitCooldown = .7;
      }
    }
  }
}

function ballHit(car) {
  if (!car.alive) return;
  if (Math.abs(car.y - ball.y) > 3.8) return;
  const cs = Math.cos(car.yaw), sn = Math.sin(car.yaw);
  const dx = ball.x - car.x, dz = ball.z - car.z;
  const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
  const ly = ball.y - (car.y + .92);
  const hx = 1.55, hy = .95, hz = 2.55;
  const qx = clamp(lx, -hx, hx), qy = clamp(ly, -hy, hy), qz = clamp(lz, -hz, hz);
  let nx = lx - qx, ny = ly - qy, nz = lz - qz;
  let d = Math.hypot(nx, ny, nz);
  if (d > ball.r) return;
  if (d < .0001) {
    // ball centre inside the box: push out through top
    nx = 0; ny = 1; nz = 0; d = .0001;
  }
  nx /= d; ny /= d; nz /= d;
  const wnx = cs * nx + sn * nz, wny = ny, wnz = -sn * nx + cs * nz;
  const pen = ball.r - d;
  ball.x += wnx * pen; ball.y += wny * pen; ball.z += wnz * pen;
  const rvx = ball.vx - car.vx, rvy = ball.vy - car.vy, rvz = ball.vz - car.vz;
  const vn = rvx * wnx + rvy * wny + rvz * wnz;
  const carSpeed = hyp(car.vx, car.vz);
  const boost = car.boostActive ? 1 : 0;
  const base = Math.max(0, -vn) * 1.08 + 4.5 + carSpeed * .34 + boost * 6;
  const power = clamp(base, 0, 58);
  ball.vx += wnx * power; ball.vy += Math.max(0, wny) * power * .45 + 2.2 + Math.max(0, carSpeed - 16) * .12; ball.vz += wnz * power;
  ball.vy += (1 - Math.abs(wny)) * 1.6;
  car.vx -= wnx * power * .06; car.vz -= wnz * power * .06;
  const sp = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (sp > 90) { const f = 90 / sp; ball.vx *= f; ball.vy *= f; ball.vz *= f; }
  GAME.lastTouch = { team: car.team, name: car.name };
  if (power > 9) {
    GAME.shake = Math.max(GAME.shake, clamp((power - 8) / 80, 0, .5));
    GAME.hitFlash = clamp(power / 55, 0, 1);
    Sound.hit(power);
    const col = car.team === 'blue' ? COL.cyan : COL.amber;
    burst(ball.x, ball.y, ball.z, 8 + (power > 28 ? 10 : 0), [col, COL.white], power * .25, .45, .55, 6);
  }
}

function updateBall(dt) {
  ball.vy -= 32 * dt;
  const drag = Math.exp(-.055 * dt);
  ball.vx *= drag; ball.vz *= drag;
  ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
  const r = ball.r;
  // scoring
  if (!ball.scored) {
    if (ball.z < -AR.hl + .2 && Math.abs(ball.x) < GOAL_HALF - .6 && ball.y < AR.goalH - .3) scoreGoal('orange');
    else if (ball.z > AR.hl - .2 && Math.abs(ball.x) < GOAL_HALF - .6 && ball.y < AR.goalH - .3) scoreGoal('blue');
  }
  const zAbs = Math.abs(ball.z);
  const inGoal = zAbs > AR.hl - .1;
  if (inGoal) {
    const sign = Math.sign(ball.z);
    if (Math.abs(ball.x) > GOAL_HALF - r) { ball.x = Math.sign(ball.x) * (GOAL_HALF - r); ball.vx *= -.5; }
    if (sign * ball.z > AR.hl + AR.goalD - r) { ball.z = sign * (AR.hl + AR.goalD - r); ball.vz *= -.4; }
    if (ball.y < r) { ball.y = r; if (ball.vy < 0) ball.vy = -ball.vy * .55; ball.vx *= .94; ball.vz *= .94; }
    if (ball.y > AR.goalH - r) { ball.y = AR.goalH - r; if (ball.vy > 0) ball.vy *= -.5; }
  } else {
    // rounded corners
    const R = AR.corner - r;
    if (Math.abs(ball.x) > AR.hw - r - AR.corner && Math.abs(ball.z) > AR.hl - r - AR.corner) {
      const cx = Math.sign(ball.x) * (AR.hw - AR.corner), cz = Math.sign(ball.z) * (AR.hl - AR.corner);
      const dx = ball.x - cx, dz = ball.z - cz, d = Math.hypot(dx, dz);
      if (d > R) {
        const nx = dx / d, nz = dz / d;
        ball.x = cx + nx * R; ball.z = cz + nz * R;
        const vn = ball.vx * nx + ball.vz * nz;
        if (vn > 0) { ball.vx -= nx * vn * 1.68; ball.vz -= nz * vn * 1.68; Sound.bounce(Math.abs(vn)); }
      }
    } else {
      if (Math.abs(ball.x) > AR.hw - r) {
        ball.x = Math.sign(ball.x) * (AR.hw - r);
        if (ball.vx * Math.sign(ball.x) > 0) { ball.vx *= -.66; Sound.bounce(Math.abs(ball.vx)); }
      }
      if (Math.abs(ball.z) > AR.hl - r) {
        const sign = Math.sign(ball.z);
        const mouth = Math.abs(ball.x) < GOAL_HALF - .4 && ball.y < AR.goalH - .3;
        if (!mouth) {
          ball.z = sign * (AR.hl - r);
          if (ball.vz * sign > 0) { ball.vz *= -.66; Sound.bounce(Math.abs(ball.vz)); }
        }
      }
    }
    if (ball.y < r) {
      ball.y = r;
      if (ball.vy < 0) {
        if (Math.abs(ball.vy) > 3) Sound.bounce(Math.abs(ball.vy));
        ball.vy = -ball.vy * .62;
      }
      ball.vx *= .985; ball.vz *= .985;
      if (Math.abs(ball.vy) < 1.1) ball.vy = 0;
    }
    if (ball.y > AR.h - r) { ball.y = AR.h - r; if (ball.vy > 0) ball.vy *= -.55; }
  }
  // spin
  const sp = hyp(ball.vx, ball.vz);
  if (sp > .3) ball.rot = M4.mul(M4.axisAngle(ball.vz, 0, -ball.vx, sp / ball.r * dt), ball.rot);
  const sp3 = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (sp3 > 92) { const f = 92 / sp3; ball.vx *= f; ball.vy *= f; ball.vz *= f; }
}

function updatePads(dt) {
  for (const p of PADS) {
    if (p.t > 0) { p.t -= dt; continue; }
    p.phase += dt * 2.5;
    for (const car of CARS) {
      if (!car.alive) continue;
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < p.r + 2.1 && car.boost < 99) {
        car.boost = Math.min(100, car.boost + p.val);
        p.t = p.max;
        if (car.isPlayer) {
          Sound.pickup(p.big);
          burst(p.x, .6, p.z, p.big ? 20 : 9, [COL.amber, COL.orangeL, COL.white], p.big ? 8 : 5, .5, .65, 2);
        }
        break;
      }
    }
  }
}

/* =========================================================================
   AI
   ========================================================================= */
function distBall(c) { return Math.hypot(ball.x - c.x, ball.z - c.z); }
function assignRoles() {
  for (const team of ['blue', 'orange']) {
    const teamCars = CARS.filter(c => c.team === team && c.alive);
    teamCars.sort((a, b) => distBall(a) - distBall(b));
    const bots = teamCars.filter(c => !c.isPlayer);
    const playerFirst = teamCars[0] && teamCars[0].isPlayer;
    bots.forEach((b, i) => {
      if (playerFirst) b.role = i === 0 ? 'mid' : 'defend';
      else b.role = i === 0 ? 'attack' : (i === 1 ? 'mid' : 'defend');
    });
  }
}
function updateAI(dt) {
  GAME.roleTimer = (GAME.roleTimer || 0) - dt;
  if (GAME.roleTimer <= 0) { assignRoles(); GAME.roleTimer = .35; }
  for (const b of BOTS) {
    if (!b.alive) { b.throttle = 0; b.steer = 0; continue; }
    if (b.jumpCd === undefined) b.jumpCd = 0;
    if (b.jumpCd > 0) b.jumpCd -= dt;
    const ownZ = b.team === 'blue' ? -AR.hl : AR.hl;
    const enemyZ = -ownZ;
    const bd = distBall(b);
    let tx = ball.x, tz = ball.z;
    if (b.role === 'attack') {
      const gx = 0, gz = enemyZ;
      let dx = gx - ball.x, dz = gz - ball.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const wrongSide = (b.z - ball.z) * Math.sign(enemyZ) > 1.5 && Math.abs(b.x - ball.x) < 13;
      if (wrongSide) {
        tx = ball.x + b.lane * 16;
        tz = ball.z - Math.sign(enemyZ) * 11;
      } else {
        tx = ball.x - dx * 6.4;
        tz = ball.z - dz * 6.4;
      }
      if (bd < 5.5) { tx = ball.x; tz = ball.z; }
    } else if (b.role === 'mid') {
      const ownDir = Math.sign(ownZ);
      tx = ball.x + b.lane * 10;
      tz = ball.z + ownDir * 16;
      if (Math.abs(tz) > AR.hl - 10) tz = ownDir * (AR.hl - 12);
    } else {
      const ownDir = Math.sign(ownZ);
      tx = clamp(ball.x * .6 + b.lane * 7, -18, 18);
      tz = ownZ - ownDir * -10;
      if (bd < 14) { tx = ball.x; tz = ball.z; }
    }
    let dx = tx - b.x, dz = tz - b.z;
    let desired = Math.atan2(dx, dz);
    let delta = Math.atan2(Math.sin(desired - b.yaw), Math.cos(desired - b.yaw));
    let steer = clamp(delta * 2.4 - b.steer * .08, -1, 1);
    let throttle = Math.abs(delta) < 1.1 ? 1 : (Math.abs(delta) < 2.0 ? .5 : -.55);
    let boost = b.boost > 12 && Math.abs(delta) < .3 && (Math.hypot(dx, dz) > 9 || b.role === 'attack');
    if (b.role === 'attack' && bd < 4.5) { boost = b.boost > 25 && Math.abs(delta) < .5; }
    // don't boost straight into a team-mate
    for (const o of CARS) {
      if (o === b || !o.alive || o.team !== b.team) continue;
      const odx = o.x - b.x, odz = o.z - b.z, od = Math.hypot(odx, odz);
      if (od < 4 && (odx * dx + odz * dz) > 0) throttle *= .5;
    }
    let jump = false;
    if (b.onGround && ball.y > 3.1 && bd < 10.5 && Math.abs(delta) < .9 && b.jumpCd <= 0) {
      jump = true; b.jumpCd = 1.3;
    }
    if (!b.onGround && b.jumps === 1 && bd < 7 && ball.y > b.y + 1.5 && Math.abs(delta) < .7 && b.jumpCd <= 0) {
      jump = true; b.jumpCd = 1.6;
    }
    const skill = b.skill || .85;
    b.throttle = throttle * skill;
    b.steer = steer;
    b.drift = Math.abs(delta) > 1.5 && hyp(b.vx, b.vz) > 18;
    b.aiBoost = boost;
    b.aiJump = jump;
  }
}

function playerControls() {
  const gp = pollPad();
  let throttle = (KEYS.has('w') ? 1 : 0) - (KEYS.has('s') ? 1 : 0);
  let steer = (KEYS.has('d') ? 1 : 0) - (KEYS.has('a') ? 1 : 0);
  let boost = KEYS.has('shift'), drift = KEYS.has('control');
  if (gp) {
    if (Math.abs(gp.throttle) > .12) throttle = gp.throttle;
    if (Math.abs(gp.steer) > .12) steer = gp.steer;
    boost = boost || gp.boost;
    drift = drift || gp.drift;
    if (gp.start && !padPrev.start) {
      if (GAME.state === 'play' || GAME.state === 'kickoff') setPaused(!GAME.paused);
    }
    padPrev.start = gp.start;
  }
  const jump = jumpQueued; jumpQueued = false;
  return { throttle, steer, jump, boost, drift };
}

/* =========================================================================
   UPDATE
   ========================================================================= */
function update(dt) {
  GAME.time += dt;
  GAME.demoCooldown = Math.max(0, GAME.demoCooldown - dt);
  GAME.shake *= Math.pow(.014, dt);
  GAME.hitFlash *= Math.pow(.004, dt);
  updateParticles(dt);

  if (GAME.bannerTimer > 0) {
    GAME.bannerTimer -= dt;
    if (GAME.bannerTimer <= 0 && GAME.state !== 'kickoff') hideBanner();
  }
  GAME.jumboTimer -= dt;
  if (GAME.jumboTimer <= 0) { GAME.jumboTimer = 1; drawJumbo(); }

  if (GAME.state === 'menu' || GAME.state === 'ended') return;

  if (GAME.state === 'kickoff') {
    GAME.countdown -= dt;
    const n = Math.ceil(GAME.countdown);
    if (n !== GAME.lastBeep && n > 0) {
      GAME.lastBeep = n;
      showBanner(String(n), 'GET READY', '');
      Sound.beep(false);
    }
    if (GAME.countdown <= 0) {
      GAME.state = 'play'; GAME.lastBeep = 4;
      showBanner('GO!', '', 'go');
      GAME.bannerTimer = .8;
      Sound.beep(true);
    }
    return;
  }

  if (GAME.state === 'goal') {
    GAME.goalTimer -= dt;
    GAME.goalCam = Math.max(0, GAME.goalCam - dt);
    updateBall(dt);
    if (GAME.goalTimer <= 0) {
      hideGoalOverlay();
      if (GAME.overtime) { endMatch(); return; }
      resetKickoff(true);
      GAME.state = 'kickoff'; GAME.countdown = 3.2; GAME.lastBeep = 4;
    }
    return;
  }

  if (GAME.state !== 'play') return;

  if (GAME.overtime) GAME.otTime += dt;
  else {
    GAME.clock -= dt;
    if (GAME.clock <= 0) {
      GAME.clock = 0;
      if (GAME.blue === GAME.orange) { startOvertime(); return; }
      endMatch(); return;
    }
  }

  const pc = playerControls();
  updateCar(PLAYER, dt, pc);
  updateAI(dt);
  for (const b of BOTS) {
    updateCar(b, dt, {
      throttle: b.throttle || 0, steer: b.aiDrift === false ? (b.steer || 0) : (b.steer || 0),
      jump: !!b.aiJump, boost: !!b.aiBoost, drift: !!b.drift
    });
  }
  collideCars(dt);
  for (const car of CARS) if (car.alive) ballHit(car);
  updateBall(dt);
  if (GAME.state !== 'play') return;
  updatePads(dt);
  if (GAME.demoCooldown <= 0) GAME.demoCooldown = 0;
}

/* =========================================================================
   CAMERA
   ========================================================================= */
const camState = { pos: [0, 45, -100], target: [0, 0, 0], yaw: 0, snap: true, fov: 1.05 };
function updateCamera(dt) {
  const p = PLAYER;
  const sp = p.alive ? hyp(p.vx, p.vz) : 0;
  let dp, dtg, fov = 1.05;
  if (GAME.state === 'menu') {
    const a = GAME.time * .055 + .4;
    dp = [Math.sin(a) * 108, 44 + Math.sin(GAME.time * .12) * 3, Math.cos(a) * 108];
    dtg = [0, 3, 0];
    fov = .96;
  } else if (GAME.state === 'ended') {
    const a = GAME.time * .07;
    dp = [Math.sin(a) * 78, 34, Math.cos(a) * 78];
    dtg = [0, 2, 0];
    fov = .98;
  } else if (GAME.goalCam > 0 && GAME.state === 'goal') {
    const sign = ball.z >= 0 ? 1 : -1;
    const sway = Math.sin(GAME.time * .8) * 3;
    dp = [ball.x * .45 + sway, 8.2, sign * (AR.hl - 23)];
    dtg = [ball.x * .5, 3.2, sign * AR.hl];
    fov = 1.15;
  } else {
    let yaw = p.yaw;
    if (GAME.camMode === 'ball') {
      const dx = ball.x - p.x, dz = ball.z - p.z;
      if (hyp(dx, dz) > 2.2) yaw = Math.atan2(dx, dz);
    }
    const rate = GAME.camMode === 'ball' ? 6.2 : 10;
    camState.yaw = camState.snap ? yaw : lerpAngle(camState.yaw, yaw, 1 - Math.exp(-rate * dt));
    const dist = 13.8 + Math.min(sp * .06, 3.4) + Math.min(p.y * .18, 1.8);
    dp = [p.x - Math.sin(camState.yaw) * dist, p.y + 6.7 + Math.min(sp * .018, 1.2), p.z - Math.cos(camState.yaw) * dist];
    if (GAME.camMode === 'ball') {
      dtg = [lerp(p.x, ball.x, .45), lerp(p.y + 1.7, ball.y, .55), lerp(p.z, ball.z, .45)];
      const bd = Math.hypot(ball.x - p.x, ball.y - p.y, ball.z - p.z);
      if (bd > 55) { dtg[0] = lerp(p.x, ball.x, .28); dtg[2] = lerp(p.z, ball.z, .28); }
    } else {
      dtg = [p.x + Math.sin(p.yaw) * 9, p.y + 2.0, p.z + Math.cos(p.yaw) * 9];
    }
    fov = 1.08 + clamp(sp / 62, 0, 1) * .18 + (p.boostActive ? .03 : 0);
  }
  // keep camera inside the bowl
  dp[0] = clamp(dp[0], -AR.hw + 2.4, AR.hw - 2.4);
  dp[2] = clamp(dp[2], -AR.hl + 2.4, AR.hl - 2.4);
  dp[1] = Math.max(2.2, dp[1]);

  if (camState.snap) {
    camState.pos = dp.slice(); camState.target = dtg.slice(); camState.snap = false;
  } else {
    const kp = 1 - Math.exp(-9 * dt), kt = 1 - Math.exp(-12 * dt);
    camState.pos = [smooth(camState.pos[0], dp[0], 9, dt), smooth(camState.pos[1], dp[1], 9, dt), smooth(camState.pos[2], dp[2], 9, dt)];
    camState.target = [smooth(camState.target[0], dtg[0], 12, dt), smooth(camState.target[1], dtg[1], 12, dt), smooth(camState.target[2], dtg[2], 12, dt)];
  }
  const sh = GAME.shake;
  const pos = [camState.pos[0] + rand(-1, 1) * sh * .55, camState.pos[1] + rand(-1, 1) * sh * .45, camState.pos[2] + rand(-1, 1) * sh * .55];
  const tar = [camState.target[0] + rand(-1, 1) * sh * .22, camState.target[1] + rand(-1, 1) * sh * .18, camState.target[2] + rand(-1, 1) * sh * .22];
  VIEW = M4.lookAt(pos, tar, [0, 1, 0]);
  PROJ = M4.perspective(fov, canvas.width / canvas.height, .35, 520);
  CAMERA.pos = pos;
  CAMERA.target = tar;
  CAMERA.right = [VIEW[0], VIEW[4], VIEW[8]];
  CAMERA.up = [VIEW[1], VIEW[5], VIEW[9]];
  CAMERA.fwd = [-VIEW[2], -VIEW[6], -VIEW[10]];
  CAMERA.fov = fov;
}
function worldToScreen(x, y, z) {
  const vx = VIEW[0] * x + VIEW[4] * y + VIEW[8] * z + VIEW[12];
  const vy = VIEW[1] * x + VIEW[5] * y + VIEW[9] * z + VIEW[13];
  const vz = VIEW[2] * x + VIEW[6] * y + VIEW[10] * z + VIEW[14];
  const cw = PROJ[3] * vx + PROJ[7] * vy + PROJ[11] * vz + PROJ[15];
  const cx = PROJ[0] * vx + PROJ[4] * vy + PROJ[8] * vz + PROJ[12];
  const cy = PROJ[1] * vx + PROJ[5] * vy + PROJ[9] * vz + PROJ[13];
  const inv = cw !== 0 ? 1 / cw : 0;
  return { x: (cx * inv * .5 + .5) * innerWidth, y: (-cy * inv * .5 + .5) * innerHeight, w: cw, nx: cx * inv, ny: cy * inv };
}

/* =========================================================================
   RENDER
   ========================================================================= */
const skyBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const skyAttr = gl.getAttribLocation(skyProg, 'aPos');
const playerRing = buildPadRing(3.4, COL.cyan);
const pointBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MAXP * 8), gl.DYNAMIC_DRAW);

function drawSky() {
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  gl.useProgram(skyProg);
  gl.uniform1f(SKYU.uTime, GAME.time);
  gl.uniform1f(SKYU.uAspect, canvas.width / Math.max(1, canvas.height));
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.enableVertexAttribArray(skyAttr);
  gl.vertexAttribPointer(skyAttr, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
}
function drawGlow(pos, size, color, alpha) {
  const s = size;
  const m = new Float32Array([
    CAMERA.right[0] * s, CAMERA.right[1] * s, CAMERA.right[2] * s, 0,
    CAMERA.up[0] * s, CAMERA.up[1] * s, CAMERA.up[2] * s, 0,
    CAMERA.fwd[0] * s, CAMERA.fwd[1] * s, CAMERA.fwd[2] * s, 0,
    pos[0], pos[1], pos[2], 1
  ]);
  drawMesh(SCENE.glowQuad, m, { tex: TEX.glow, unlit: true, additive: true, tint: color, alpha, depthWrite: false });
}
function drawShadow(x, z, w, d, yaw, alpha, y) {
  const m = M4.mul(M4.mul(M4.trans(x, y === undefined ? .06 : y, z), M4.rotY(yaw || 0)), M4.scale(w, 1, d));
  drawMesh(SCENE.shadow, m, { tex: TEX.shadow, unlit: true, tint: [0, 0, 0], alpha, depthWrite: false });
}
function renderParticles() {
  if (!particles.length) return;
  const n = particles.length;
  const data = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const p = particles[i], o = i * 8;
    data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
    data[o + 3] = p.size; data[o + 4] = p.color[0]; data[o + 5] = p.color[1]; data[o + 6] = p.color[2];
    data[o + 7] = clamp(p.life / p.max, 0, 1) * .95;
  }
  gl.useProgram(pointProg);
  gl.uniformMatrix4fv(SP.uProj, false, PROJ);
  gl.uniformMatrix4fv(SP.uView, false, VIEW);
  gl.uniform1f(SP.uScale, canvas.height * .9);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(PA.pos); gl.vertexAttribPointer(PA.pos, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(PA.size); gl.vertexAttribPointer(PA.size, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(PA.col); gl.vertexAttribPointer(PA.col, 3, gl.FLOAT, false, 32, 16);
  gl.enableVertexAttribArray(PA.alpha); gl.vertexAttribPointer(PA.alpha, 1, gl.FLOAT, false, 32, 28);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.depthMask(false);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.depthMask(true);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function renderScene() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
  drawSky();

  const I = M4.ident();
  // pitch
  drawMesh(SCENE.field, I, { tex: TEX.field, shine: .04, emissive: .05 });
  // walls
  drawMesh(SCENE.wall, I, { tex: TEX.wall, shine: .24, emissive: .3 });
  drawMesh(SCENE.wallGlow, I, { unlit: true, additive: true, alpha: .82, depthWrite: false });
  drawMesh(SCENE.decals, I, { tex: TEX.banner, unlit: true, additive: true, alpha: .55, depthWrite: false });
  // stands
  drawMesh(SCENE.stands, I, { shine: .05 });
  drawMesh(SCENE.crowd, I, { tex: TEX.crowd, unlit: true, alpha: 1 });
  drawMesh(SCENE.leds, I, { unlit: true, additive: true, alpha: .85, depthWrite: false });
  // goals
  drawMesh(SCENE.goalFrame, I, { shine: .25, emissive: .18 });
  drawMesh(SCENE.goalGlow, I, { unlit: true, additive: true, alpha: .9, depthWrite: false });
  // jumbotrons
  drawMesh(SCENE.jumboFrame, I, { shine: .1 });
  drawMesh(SCENE.jumboScreen, I, { tex: TEX.jumbo, unlit: true, emissive: .4 });
  // boost pads
  for (const p of PADS) {
    if (p.t > 0) continue;
    const pulse = .8 + Math.sin(GAME.time * 3 + p.phase) * .2;
    const model = M4.mul(M4.trans(p.x, .04, p.z), M4.scale(pulse, 1, pulse));
    drawMesh(p.mesh, model, { unlit: true, additive: true, alpha: p.big ? .95 : .8, depthWrite: false });
  }
  // contact shadows
  for (const car of CARS) {
    if (!car.alive) continue;
    const a = clamp(.62 - car.y * .035, .12, .62);
    drawShadow(car.x, car.z, 5.6, 3.6, car.yaw, a, .055);
  }
  drawShadow(ball.x, ball.z, 4.3, 4.3, 0, clamp(.6 - (ball.y - ball.r) * .05, .08, .6), .058);
  // cars + ball
  for (const car of CARS) {
    if (!car.alive) continue;
    drawMesh(car.mesh, carModel(car), { shine: .55 });
  }
  drawMesh(SCENE.ball, ballModel(), { tex: TEX.ball, shine: .9, emissive: .1 });
  // nets (transparent)
  drawMesh(SCENE.goalNet, I, { tex: TEX.net, unlit: true, alpha: .8, depthWrite: false });
  // pad beams
  for (const p of PADS) {
    if (p.t > 0) continue;
    const pulse = .75 + Math.sin(GAME.time * 3 + p.phase) * .25;
    drawGlow([p.x, p.big ? 1.8 : .9, p.z], (p.big ? 5.4 : 2.8) * pulse, COL.amber, p.big ? .32 : .22);
  }
  // boosters
  for (const car of CARS) {
    if (!car.alive || !car.boostActive) continue;
    const model = carModel(car);
    const col = car.team === 'blue' ? COL.cyan : COL.orangeL;
    for (const s of [-1, 1]) {
      const p = M4.point(model, [s * .55, .78, -2.72]);
      drawGlow(p, rand(1.5, 2.15), col, .65);
      drawGlow(p, rand(2.6, 3.4), col, .22);
    }
  }
  // stadium lights
  for (const L of ARENA_LIGHTS) {
    drawGlow(L, 9, [0.7, 0.9, 1], .26);
    drawGlow(L, 3.6, [1, 1, 1], .5);
  }
  // goal mouth glows
  for (const sign of [-1, 1]) {
    const gc = sign < 0 ? COL.blueL : COL.orangeL;
    drawGlow([0, AR.goalH * .5, sign * (AR.hl - 1)], 11, gc, .14);
    for (const x of [-GOAL_HALF, GOAL_HALF]) drawGlow([x, AR.goalH, sign * AR.hl], 3.2, gc, .4);
    drawGlow([0, AR.goalH, sign * AR.hl], 4.5, gc, .35);
  }
  renderParticles();
}

/* =========================================================================
   FX CANVAS (speed lines, ball arrow, hit flash)
   ========================================================================= */
function drawFX() {
  const dpr = canvas.width / Math.max(1, innerWidth);
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = innerWidth, H = innerHeight;
  fctx.clearRect(0, 0, W, H);
  if (GAME.state === 'menu' || GAME.state === 'ended') return;
  const speed = PLAYER.alive ? hyp(PLAYER.vx, PLAYER.vz) : 0;
  const intensity = clamp((speed - 19) / 38, 0, 1) + (PLAYER.boostActive ? .26 : 0);
  fctx.save();
  fctx.globalCompositeOperation = 'lighter';
  if (intensity > .02) {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), r0 = Math.min(W, H) * rand(.34, .58), r1 = r0 + rand(30, 160) * intensity;
      fctx.strokeStyle = `rgba(185,235,255,${(.018 + .085 * intensity) * rand(.4, 1)})`;
      fctx.lineWidth = rand(.6, 2.2);
      fctx.beginPath(); fctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      fctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); fctx.stroke();
    }
    if (PLAYER.boostActive) {
      const g = fctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .22, W / 2, H / 2, Math.max(W, H) * .7);
      const col = PLAYER.team === 'blue' ? '50,200,255' : '255,140,50';
      g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${.09 * intensity})`);
      fctx.fillStyle = g; fctx.fillRect(0, 0, W, H);
    }
  }
  fctx.restore();
  // hit flash
  if (GAME.hitFlash > .01) {
    const g = fctx.createRadialGradient(W * .5, H * .5, 0, W * .5, H * .5, Math.min(W, H) * .55);
    g.addColorStop(0, `rgba(255,255,255,${GAME.hitFlash * .16})`);
    g.addColorStop(.4, `rgba(120,220,255,${GAME.hitFlash * .06})`);
    g.addColorStop(1, 'rgba(120,220,255,0)');
    fctx.fillStyle = g; fctx.fillRect(0, 0, W, H);
  }
  // off-screen ball arrow
  const bs = worldToScreen(ball.x, ball.y, ball.z);
  const margin = 54;
  const off = bs.w <= 0 || bs.x < margin || bs.x > W - margin || bs.y < 110 || bs.y > H - margin;
  if (off && (GAME.state === 'play' || GAME.state === 'kickoff')) {
    const vx = VIEW[0] * ball.x + VIEW[4] * ball.y + VIEW[8] * ball.z + VIEW[12];
    const vy = VIEW[1] * ball.x + VIEW[5] * ball.y + VIEW[9] * ball.z + VIEW[13];
    const vz = VIEW[2] * ball.x + VIEW[6] * ball.y + VIEW[10] * ball.z + VIEW[14];
    let ang = Math.atan2(-vy, vx);
    if (vz > 0) ang = Math.atan2(vy, -vx);
    const rx = W * .43, ry = H * .4;
    const ex = W / 2 + Math.cos(ang) * rx, ey = H / 2 + Math.sin(ang) * ry;
    fctx.save();
    fctx.translate(ex, ey); fctx.rotate(ang);
    fctx.shadowColor = '#7ce5ff'; fctx.shadowBlur = 16;
    fctx.fillStyle = 'rgba(235,250,255,.92)';
    fctx.beginPath(); fctx.moveTo(15, 0); fctx.lineTo(-8, -10); fctx.lineTo(-3, 0); fctx.lineTo(-8, 10); fctx.closePath(); fctx.fill();
    fctx.restore();
    const dist = Math.round(Math.hypot(ball.x - PLAYER.x, ball.z - PLAYER.z));
    fctx.fillStyle = 'rgba(190,235,255,.75)'; fctx.font = '800 9px Inter,system-ui,sans-serif'; fctx.textAlign = 'center';
    fctx.fillText(dist + 'M', ex + Math.cos(ang) * 24, ey + Math.sin(ang) * 24 + 3);
  }
}

/* =========================================================================
   HUD
   ========================================================================= */
let lastHud = {};
function updateHUD() {
  if (lastHud.blue !== GAME.blue) { $('blueScore').textContent = GAME.blue; lastHud.blue = GAME.blue; }
  if (lastHud.orange !== GAME.orange) { $('orangeScore').textContent = GAME.orange; lastHud.orange = GAME.orange; }
  const txt = clockText();
  if (lastHud.clock !== txt) { $('clock').textContent = txt; lastHud.clock = txt; }
  $('clock').classList.toggle('overtime', GAME.overtime);
  const b = Math.round(PLAYER.boost);
  const ring = $('boostRing');
  ring.style.setProperty('--p', b);
  ring.classList.toggle('low', b < 25);
  if (lastHud.boost !== b) { $('boostNum').textContent = b; lastHud.boost = b; }
  const kmh = PLAYER.alive ? Math.round(hyp(PLAYER.vx, PLAYER.vz) * 4.25) : 0;
  if (lastHud.speed !== kmh) { $('speedNum').textContent = kmh; lastHud.speed = kmh; }
  $('speedFill').style.width = clamp(kmh / 240 * 100, 0, 100) + '%';
  if (GAME.state === 'play' || GAME.state === 'kickoff') {
    $('pauseBtn').textContent = GAME.paused ? '▶  RESUME' : 'Ⅱ  PAUSE';
  }
}

/* =========================================================================
   RESIZE / BOOT
   ========================================================================= */
function syncSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(innerWidth * dpr)), h = Math.max(1, Math.floor(innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h; fxCanvas.width = w; fxCanvas.height = h;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    fxCanvas.style.width = innerWidth + 'px'; fxCanvas.style.height = innerHeight + 'px';
  }
}
window.addEventListener('resize', syncSize);

/* buttons */
$('playBtn').addEventListener('click', () => { Sound.init(); Sound.ui(); startMatch(); });
$('pauseBtn').addEventListener('click', () => setPaused(!GAME.paused));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => { Sound.ui(); startMatch(); });
$('quitBtn').addEventListener('click', () => { Sound.ui(); quitToMenu(); });
$('rematchBtn').addEventListener('click', () => { Sound.ui(); startMatch(); });
$('menuBtn').addEventListener('click', () => { Sound.ui(); quitToMenu(); });
$('camBtn').addEventListener('click', () => { Sound.ui(); toggleCam(); });
$('soundBtn').addEventListener('click', () => {
  Sound.init();
  const on = Sound.toggle();
  $('soundBtn').textContent = on ? 'SOUND ON' : 'SOUND OFF';
});

/* initial menu state */
resetKickoff(true);
GAME.state = 'menu';
drawJumbo();

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const STEP = 1 / 120;
let lastTime = performance.now(), accum = 0;
function frame(now) {
  const raw = Math.min(.06, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (pauseQueued) {
    pauseQueued = false;
    if (GAME.state === 'play' || GAME.state === 'kickoff') setPaused(!GAME.paused);
  }
  if (!GAME.paused) {
    accum += raw;
    let steps = 0;
    while (accum >= STEP && steps < 6) {
      update(STEP);
      accum -= STEP;
      steps++;
      if (GAME.state === 'menu' || GAME.state === 'ended') break;
    }
    if (steps >= 6) accum = 0;
  } else accum = 0;

  syncSize();
  updateCamera(raw || STEP);
  renderScene();
  drawFX();
  updateHUD();
  Sound.update(
    PLAYER.alive ? hyp(PLAYER.vx, PLAYER.vz) : 0,
    PLAYER.throttle || 0,
    PLAYER.boostActive && GAME.state === 'play',
    PLAYER.alive && GAME.state === 'play' && !GAME.paused
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
