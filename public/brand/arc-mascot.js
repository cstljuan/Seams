// arc-mascot.js v3 - "Arc", the Seams mascot (ShellHacks 2026)
// A lightning bolt with a face. ONE solid colour, no mouth. Speaks by pulsing the whole body.
//
// v3 adds (Arc Lab):
//  - stronger mouse follow: eyes travel further, eyes foreshorten toward the look side,
//    the whole bolt tilts toward the cursor
//  - "waiting wrap": both eyes orbit around the head as if it were a turning cylinder
//  - flip: facing="right" | "left" | "auto" (auto turns to face the cursor), animated turn
//  - drag the body in any direction (elastic), press and hold to squeeze, drag the tip (boing)
//  - eye-color + eyes="cut" (transparent) | "solid"
//
// Interaction patterns and the wrap timing curve are adapted from agent-robot-avatar
// (github.com/cx-artlab/agent-robot-avatar), MIT License, Copyright (c) 2026 CX ART Lab.
// The character itself is original (Juan's sketch).
//
// <arc-mascot size="190" color="#F5BC42" facing="auto" follow="on"></arc-mascot>
// el.play('success') -> Promise (one-shot, returns to the held state)
// el.set('waiting-wrap') -> holds a looping state until changed
// el.startWaiting({variant:'wrap'}) / el.reset() / el.setLevel(0..1) / el.flip() / el.face('left')

const NS = 'http://www.w3.org/2000/svg';

// sx sy scale, lean skew deg, zig zigzag depth, tip reach, rot deg, bob, ew eh eye size, mode eye style
const BASE = { sx: 1, sy: 1, lean: 0, zig: 1, tip: 1, rot: 0, bob: 1, ew: 1, eh: 1, mode: 'oval' };
const S = {
  idle:      {},
  bored:     { sy: .97, rot: 4, bob: .4, eh: .42, mode: 'lid', drift: 1, loop: 1 },
  waiting:   { bob: .6, scan: 1, loop: 1 },
  'waiting-wrap': { bob: .5, mode: 'wrap', loop: 1 },
  input:     { bob: .5, ew: .9, eh: .85, look: [-3, 8], sym: 'typing', loop: 1 },
  thinking:  { lean: -6, rot: -4, bob: .5, ew: .9, eh: .8, look: [-6, -8], sym: 'dots', loop: 1 },
  talk:      { bob: 1.2, pulse: 1, loop: 1 },
  sleep:     { sx: 1.08, sy: .9, lean: 4, zig: .75, tip: .85, rot: 8, bob: .35, eh: .1, mode: 'closed', sym: 'zz', loop: 1 },
  send:      { mode: 'happy', nod: 1, dur: 950 },
  success:   { sx: 1.05, sy: .96, bob: 2.2, mode: 'happy', hop: 1, sym: 'check', dur: 1500 },
  failure:   { sx: 1.04, sy: .9, lean: 6, zig: .8, tip: .8, rot: 10, bob: .3, eh: .8, mode: 'sad', dur: 1700 },
  warning:   { sx: .92, sy: 1.14, zig: 1.35, tip: 1.2, bob: .2, ew: 1.1, eh: 1.2, jitter: 1, sym: 'bang', dur: 1600 },
  inspect:   { lean: 3, bob: .4, mode: 'inspect', inspectScan: 1, sym: 'lens', dur: 2200 },
  blocked:   { sx: 1.03, sy: .97, zig: .9, bob: .2, mode: 'angry', sym: 'stop', shake: .5, dur: 1700 },
  error:     { zig: 1.1, bob: 0, mode: 'x', shake: 1, sym: 'spark', dur: 1500 },
  surprise:  { sx: .94, sy: 1.1, zig: 1.1, tip: 1.1, bob: .3, ew: 1.35, eh: 1.3, mode: 'wide', hop: .6, dur: 1300 },
  wake:      { sx: 1.02, sy: 1.02, bob: 1.4, mode: 'wake', dur: 1600 },
  found:     { sx: .96, sy: 1.06, lean: -8, zig: 1.2, tip: 1.12, rot: -10, bob: .8, ew: 1.2, eh: 1.2, mode: 'wide', point: 1, dur: 1700 },
  happy:     { sx: 1.06, sy: .95, zig: 1.05, bob: 2, mode: 'happy', hop: 1, dur: 1400 },
  wink:      { lean: 3, rot: 3, mode: 'wink', dur: 1100 },
  confused:  { lean: -4, rot: -12, bob: .6, mode: 'confused', sym: 'q', dur: 1800 },
  squeeze:   { sx: 1.18, sy: .8, zig: .9, tip: .9, bob: 0, ew: 1.1, eh: .3, mode: 'squint', loop: 1 },
};
for (const k in S) S[k] = { ...BASE, ...S[k] };
const LOOPING = new Set(Object.keys(S).filter(k => S[k].loop || k === 'idle'));
// Names used by agent-robot-avatar and the earlier Arc versions map onto these.
const ALIAS = {
  normal: 'idle', wait: 'waiting', wrap: 'waiting-wrap', nod: 'send', warn: 'warning', alert: 'warning',
  'system-error': 'error', wide: 'surprise', notify: 'found', exclaim: 'warning', speak: 'talk',
  listen: 'waiting', suspicious: 'inspect',
};
const resolveName = n => ALIAS[n] || n;

class Spring {
  constructor(v, k = 180, c = 16) { this.x = v; this.v = 0; this.t = v; this.k = k; this.c = c; }
  step(dt) { this.v += (this.k * (this.t - this.x) - this.c * this.v) * dt; this.x += this.v * dt; return this.x; }
}

function roundPoly(pts, r) {
  const n = pts.length; let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1, rr = Math.min(r, l1 / 2.2, l2 / 2.2);
    const a = [p1[0] + v1[0] / l1 * rr, p1[1] + v1[1] / l1 * rr], b = [p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr];
    d += (i ? ' L' : 'M') + a[0].toFixed(2) + ',' + a[1].toFixed(2) + ` Q${p1[0].toFixed(2)},${p1[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  }
  return d + 'Z';
}

// ---- waiting wrap: eyes on a rotating cylinder (timing curve from agent-robot-avatar, MIT) ----
const WRAP_CYCLE = 2400, HEAD_CX = 99, WRAP_R = 36, EYE_HALF = 15;
const EYE_ANGLE = Math.asin(EYE_HALF / WRAP_R);
const WRAP_FRAMES = [
  [0, 0, null],
  [834, -Math.PI / 2 + EYE_ANGLE, [.612, 0, .876, .34]],
  [996, -Math.PI / 2 - EYE_ANGLE, null],
  [1260, -3 * Math.PI / 2 + EYE_ANGLE, null],
  [1390, -3 * Math.PI / 2 - EYE_ANGLE, null],
  [2400, -2 * Math.PI, [.168, .725, .324, 1]],
];
function bez(t, c) {
  if (!c || t <= 0 || t >= 1) return t;
  const b = (s, a, z) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * z + s * s * s;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (b(m, c[0], c[2]) < t) lo = m; else hi = m; }
  return b((lo + hi) / 2, c[1], c[3]);
}
function wrapAngle(ms) {
  const time = ms % WRAP_CYCLE;
  const i = Math.max(1, WRAP_FRAMES.findIndex(f => f[0] >= time));
  const a = WRAP_FRAMES[i - 1], b = WRAP_FRAMES[i];
  return a[1] + (b[1] - a[1]) * bez((time - a[0]) / (b[0] - a[0]), b[2]);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const soft = (v, lim) => lim * Math.tanh(v / lim);

class ArcMascot extends HTMLElement {
  static get observedAttributes() { return ['state', 'color', 'eye-color', 'eyes', 'size', 'facing', 'follow', 'follow-strength']; }

  connectedCallback() {
    if (this.svg) return;
    const size = +(this.getAttribute('size') || 160);
    Object.assign(this.style, { display: 'inline-block', width: size + 'px', height: size + 'px', touchAction: 'none', cursor: 'grab', userSelect: 'none' });
    const id = 'arc' + Math.random().toString(36).slice(2, 8);
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 200 200'); this.svg.setAttribute('width', '100%'); this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('role', 'img'); this.svg.setAttribute('aria-label', 'Arc, the Seams mascot');
    this.svg.style.overflow = 'visible';
    this.svg.innerHTML = `
      <defs><mask id="${id}m" maskUnits="userSpaceOnUse" x="-100" y="-100" width="400" height="400">
        <rect x="-100" y="-100" width="400" height="400" fill="#fff"/>
        <g class="cut" fill="#000" stroke="#000" stroke-linecap="round" stroke-linejoin="round"></g>
      </mask></defs>
      <g class="all">
        <path class="body" mask="url(#${id}m)"/>
        <g class="eyes" stroke-linecap="round" stroke-linejoin="round"></g>
      </g>
      <g class="sym" stroke-linecap="round" stroke-linejoin="round"></g>`;
    this.appendChild(this.svg);
    const q = s => this.svg.querySelector(s);
    this.body = q('.body'); this.cut = q('.cut'); this.eyesG = q('.eyes'); this.sym = q('.sym'); this.all = q('.all');
    this.applyColor();

    this.sp = {};
    for (const k of ['sx', 'sy', 'lean', 'zig', 'tip', 'rot', 'bob', 'ew', 'eh']) this.sp[k] = new Spring(S.idle[k]);
    this.sp.lx = new Spring(0, 140, 15); this.sp.ly = new Spring(0, 140, 15);
    this.sp.hop = new Spring(0, 260, 14);
    this.sp.fl = new Spring(1, 150, 16);          // facing, -1..1 (passes through 0 = side view)
    this.sp.dx = new Spring(0, 220, 10); this.sp.dy = new Spring(0, 220, 10);   // body drag
    this.sp.tx = new Spring(0, 260, 7); this.sp.ty = new Spring(0, 260, 7);     // tip drag
    this.sp.tilt = new Spring(0, 90, 13);          // follow tilt
    this.mode = 'oval'; this.cfg = S.idle; this.name = 'idle'; this.base = 'idle'; this.level = null;
    this.t = 0; this.last = performance.now(); this.blinkAt = 1.5; this.blink = 0; this.stateT = 0;
    this.ptrN = [0, 0]; this.ptrDx = 0; this.facingSign = 1; this.hold = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.readFacing();

    this.onMove = e => {
      const r = this.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy) || 1, k = Math.min(1, m / 260);
      this.ptrN = [dx / m * k, dy / m * k]; this.ptrDx = dx;
      if (this.press) this.pressMove(e);
    };
    this.onDown = e => this.pressStart(e);
    this.onUp = () => this.pressEnd();
    window.addEventListener('pointermove', this.onMove);
    this.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp); window.addEventListener('pointercancel', this.onUp);
    this.set(this.getAttribute('state') || 'idle');
    const loop = now => { this.frame(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp);
    this.removeEventListener('pointerdown', this.onDown); this.svg?.remove(); this.svg = null;
  }
  attributeChangedCallback(n) {
    if (!this.sp) return;
    if (n === 'state') this.set(this.getAttribute('state'));
    if (n === 'color' || n === 'eye-color' || n === 'eyes') this.applyColor();
    if (n === 'facing') this.readFacing();
    if (n === 'size') { const s = +(this.getAttribute('size') || 160); this.style.width = this.style.height = s + 'px'; }
  }
  get follow() { return this.getAttribute('follow') !== 'off'; }
  get strength() { const v = parseFloat(this.getAttribute('follow-strength')); return Number.isFinite(v) ? v : 1; }
  readFacing() {
    const f = this.getAttribute('facing') || 'right';
    this.facingMode = f;
    if (f === 'left') this.facingSign = -1; else if (f === 'right') this.facingSign = 1;
    this.sp.fl.t = this.facingSign;
  }
  face(dir) { this.setAttribute('facing', dir); return this; }
  flip() { const next = this.facingSign > 0 ? 'left' : 'right'; this.setAttribute('facing', next); return next; }
  applyColor() {
    const c = this.getAttribute('color') || 'currentColor';
    const ec = this.getAttribute('eye-color') || '#ffffff';
    const solid = this.getAttribute('eyes') === 'solid';
    this.body.setAttribute('fill', c); this.sym.setAttribute('fill', c); this.sym.setAttribute('stroke', c);
    this.eyesG.setAttribute('fill', ec); this.eyesG.setAttribute('stroke', ec);
    this.eyesG.style.display = solid ? '' : 'none';
  }

  // ---- gestures ----
  toSvg(e) {
    const pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = this.svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 100, y: 100 };
  }
  tipWorld() { const x = 66 + this.sp.tx.x, y = 184 + this.sp.ty.x; return [this.facingSign > 0 ? x : 200 - x, y]; }
  pressStart(e) {
    e.preventDefault(); this.setPointerCapture?.(e.pointerId);
    const p = this.toSvg(e), tip = this.tipWorld();
    this.press = { x: e.clientX, y: e.clientY, onTip: Math.hypot(p.x - tip[0], p.y - tip[1]) < 30, moved: false };
    this.style.cursor = 'grabbing';
    clearTimeout(this.holdTmr);
    if (!this.press.onTip) this.holdTmr = setTimeout(() => {
      if (this.press && !this.press.moved) { this.press.holding = true; this.set('squeeze'); this.emit('arc-gesture', 'hold'); }
    }, 380);
  }
  pressMove(e) {
    const p = this.press, dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > 6 && !p.holding) { p.moved = true; clearTimeout(this.holdTmr); this.emit('arc-gesture', p.onTip ? 'tip' : 'drag'); }
    if (!p.moved) return;
    const scale = 200 / (this.getBoundingClientRect().width || 200);
    if (p.onTip) {
      const s = this.toSvg(e); let bx = this.facingSign > 0 ? s.x : 200 - s.x;
      this.sp.tx.t = soft(bx - 66, 48); this.sp.ty.t = soft(s.y - 184, 48);
      this.sp.tx.x = this.sp.tx.t; this.sp.ty.x = this.sp.ty.t;
    } else {
      this.sp.dx.t = soft(dx * scale * .55, 46); this.sp.dy.t = soft(dy * scale * .55, 46);
    }
  }
  pressEnd() {
    const p = this.press; if (!p) return; this.press = null; clearTimeout(this.holdTmr);
    this.style.cursor = 'grab';
    this.sp.dx.t = 0; this.sp.dy.t = 0; this.sp.tx.t = 0; this.sp.ty.t = 0;
    if (p.holding) { this.base = this.prevBase || 'idle'; this.hold = 0; this.play('happy'); return; }
    if (p.moved) {
      const big = Math.hypot(this.sp.dx.x, this.sp.dy.x) > 22 || Math.hypot(this.sp.tx.x, this.sp.ty.x) > 18;
      if (big) this.play('surprise');
    }
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true })); }

  // ---- state machine ----
  _go(name) {
    const c = S[name] || S.idle; this.cfg = c; this.name = S[name] ? name : 'idle'; this.mode = c.mode; this.stateT = 0;
    for (const k in c) if (this.sp[k] && !['dx', 'dy', 'hop', 'tx', 'ty'].includes(k)) this.sp[k].t = c[k];
    if (c.hop) this.sp.hop.v = -170 * c.hop;
    if (name === 'warning' || name === 'surprise') this.sp.sy.v += 3;
    if (name === 'waiting-wrap') this.wrapStart = performance.now();
    this.emit('arc-state', this.name);
  }
  set(name) {
    name = resolveName(name || 'idle');
    if (!S[name]) name = 'idle';
    if (LOOPING.has(name)) {
      if (name === 'squeeze') this.prevBase = this.base === 'squeeze' ? this.prevBase : this.base;
      clearTimeout(this.tmr); this.base = name; this._go(name);
    } else this.play(name);
    return this;
  }
  play(name) {
    name = resolveName(name); if (!S[name]) name = 'idle';
    if (LOOPING.has(name)) { this.set(name); return Promise.resolve(); }
    clearTimeout(this.tmr); this._go(name);
    return new Promise(res => { this.tmr = setTimeout(() => { this._go(this.base); res(); }, S[name].dur || 1400); });
  }
  startWaiting(opts) { return this.set(opts?.variant === 'wrap' ? 'waiting-wrap' : 'waiting'); }
  reset() { clearTimeout(this.tmr); return this.set('idle'); }
  setLevel(v) { this.level = v == null ? null : clamp(v, 0, 1); return this; }

  frame(now) {
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now; this.t += dt; this.stateT += dt;
    const t = this.t, c = this.cfg, m = this.reduced ? .25 : 1, str = this.strength;

    // facing: auto turns toward the cursor with a little hysteresis
    if (this.facingMode === 'auto' && this.follow && !this.press) {
      if (this.ptrDx > 40 && this.facingSign < 0) this.facingSign = 1;
      else if (this.ptrDx < -40 && this.facingSign > 0) this.facingSign = -1;
      this.sp.fl.t = this.facingSign;
    }
    const fs = this.facingSign;

    // where the eyes look (world space, +x = right)
    let look = [0, 0];
    if (this.press?.moved) {
      const d = this.press.onTip ? [this.sp.tx.x * fs, this.sp.ty.x] : [this.sp.dx.x, this.sp.dy.x];
      const n = Math.hypot(...d) || 1; look = [d[0] / n * 13, d[1] / n * 9];
    } else if (c.scan) look = [Math.sin(t * 2.4) * 12, 2];
    else if (c.inspectScan) look = [Math.sin(t * 1.6) * 11, -2 + Math.sin(t * .9) * 4];
    else if (c.drift) look = [-10 * fs + Math.sin(t * .5) * 4, 7];
    else if (c.look) look = [c.look[0] * fs, c.look[1]];
    else if (this.follow) look = [this.ptrN[0] * 14 * str, this.ptrN[1] * 11 * str];
    if (c.mode === 'wrap') look = [0, 0];
    this.sp.lx.t = look[0] * fs; this.sp.ly.t = look[1];   // eyes live inside the flipped group
    this.sp.tilt.t = this.follow && !c.look && !c.scan && !c.drift && c.mode !== 'wrap' ? this.ptrN[0] * 7 * str : 0;
    this.sp.rot.t = c.rot * fs;

    const v = {}; for (const k in this.sp) v[k] = this.sp[k].step(dt);
    if (this.press?.holding) { this.hold = Math.min(1, this.hold + dt * .8); }

    // body transform
    let tx = v.dx, ty = Math.sin(t * 2.2) * 4 * v.bob * m + v.hop * .12 + v.dy + (this.follow ? this.ptrN[1] * 3 * str : 0);
    if (c.jitter) { tx += (Math.random() - .5) * 3; ty += (Math.random() - .5) * 2; }
    if (c.shake) tx += Math.sin(this.stateT * 40) * 7 * c.shake * Math.max(0, 1 - this.stateT * 1.2);
    if (c.nod) ty += Math.sin(Math.min(1, this.stateT / .55) * Math.PI * 2) * 9 * Math.max(0, 1 - this.stateT * 1.4);
    const cx = 100, cy = 104;
    const amp = c.pulse ? (this.level != null ? this.level : (Math.sin(t * 10) + 1) / 2) : 0;
    const pulse = this.reduced ? 1 : 1 + amp * .12;
    const dragLen = Math.hypot(v.dx, v.dy);
    const hs = this.hold * .14;
    const sx = v.sx * pulse * (1 + Math.abs(v.dx) / 260 + hs), sy = v.sy * pulse * (1 + Math.abs(v.dy) / 260 - dragLen / 900 - hs * .8);
    let lean = v.lean + (-v.dx * .35) * fs;
    if (c.mode === 'wrap') lean += Math.sin(wrapAngle(now - (this.wrapStart || now))) * 5;
    const rot = v.rot + v.tilt;
    const fl = Math.abs(v.fl) < .04 ? (v.fl < 0 ? -.04 : .04) : v.fl;
    this.all.setAttribute('transform',
      `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${rot.toFixed(2)} ${cx} ${cy}) translate(${cx} ${cy}) scale(${(sx * fl).toFixed(3)} ${sy.toFixed(3)}) skewX(${lean.toFixed(2)}) translate(${-cx} ${-cy})`);

    // bolt: head block on top, zigzag, tip down-left when facing right
    const z = v.zig, tp = v.tip, wob = Math.sin(t * 3) * 1.2 * m;
    const point = c.point ? Math.sin(this.stateT * 14) * 6 * Math.max(0, 1 - this.stateT) : 0;
    const pts = [
      [58, 26], [142, 20],
      [134, 92 - 4 * (z - 1)],
      [100 + 58 * z, 94 + wob],
      [100 - 34 * tp + point + v.tx, 104 + 80 * tp + v.ty],
      [92 + 6 * (z - 1), 118],
      [56 - 6 * (z - 1), 120],
    ];
    this.body.setAttribute('d', roundPoly(pts, 9));

    // eyes
    if (t > this.blinkAt) { this.blink = 1; this.blinkAt = t + (c.sym === 'typing' ? 1.2 : 2) + Math.random() * 3.5; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const blinkable = ['oval', 'wide', 'wrap', 'inspect'].includes(this.mode);
    const bk = blinkable ? 1 - Math.sin(Math.min(1, this.blink) * Math.PI) * .9 : 1;
    const ey = 56 + v.ly, rx = 7.5 * v.ew, ry = 14 * v.eh * bk;
    const nx = clamp(v.lx / 14, -1, 1);
    let h = '';
    const oval = (x, y, a, b) => `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${Math.max(.6, a).toFixed(2)}" ry="${Math.max(1.4, b).toFixed(2)}"/>`;
    const arcL = (x, y, up) => `<path fill="none" stroke-width="5.5" d="M${x - 8},${y + (up ? 4 : -3)} Q${x},${y + (up ? -8 : 7)} ${x + 8},${y + (up ? 4 : -3)}"/>`;

    if (this.mode === 'wrap') {
      const ang = wrapAngle(now - (this.wrapStart || now));
      for (const off of [-EYE_ANGLE, EYE_ANGLE]) {
        const a = ang + off, front = Math.cos(a);
        if (front <= 0.02) continue;
        const w = rx * front, side = clamp(1 - front, 0, 1);
        h += oval(HEAD_CX + WRAP_R * Math.sin(a), ey, w, ry * (1 - .25 * side * side));
      }
    } else {
      [84, 114].forEach((x0, i) => {
        const d = x0 - HEAD_CX, sd = Math.sign(d);
        // perspective: eyes crowd together and the eye on the look side foreshortens
        const x = HEAD_CX + d * (1 - .22 * Math.abs(nx)) + v.lx;
        const squash = 1 - .38 * Math.max(0, nx * sd) - .08 * Math.abs(nx);
        const erx = rx * squash, ery = ry * (1 - .06 * Math.abs(nx));
        switch (this.mode) {
          case 'happy': h += arcL(x, ey, true); break;
          case 'closed': h += `<path fill="none" stroke-width="5" d="M${x - 8},${ey + 2} L${x + 8},${ey + 2}"/>`; break;
          case 'wink': h += i ? arcL(x, ey, true) : oval(x, ey, erx, ery); break;
          case 'x': h += `<path fill="none" stroke-width="5" d="M${x - 7},${ey - 7} L${x + 7},${ey + 7} M${x + 7},${ey - 7} L${x - 7},${ey + 7}"/>`; break;
          case 'sad': h += oval(x, ey + 3, erx * .9, ery * .8); break;
          case 'lid': h += oval(x, ey + 5, erx, Math.max(3, ery)); break;
          case 'confused': h += oval(x, ey + (i ? -2 : 3), erx * (i ? 1.15 : .7), ery * (i ? 1.1 : .55)); break;
          case 'squint': h += `<rect x="${(x - 9).toFixed(2)}" y="${(ey - 2.5).toFixed(2)}" width="18" height="${Math.max(4, ry * .6).toFixed(2)}" rx="2.5"/>`; break;
          case 'inspect': h += i ? oval(x, ey - 1, erx * 1.25, ery * 1.15) : `<rect x="${(x - 8).toFixed(2)}" y="${(ey - 2).toFixed(2)}" width="16" height="5" rx="2.5"/>`; break;
          case 'angry': h += oval(x, ey + 3, erx, ery * .7); break;
          case 'wake': {
            const k = clamp(this.stateT / .45, 0, 1), b2 = this.stateT > .7 && this.stateT < .85 ? .15 : 1;
            h += oval(x, ey, erx * (1 + .25 * (1 - Math.abs(1 - 2 * k))), Math.max(1.5, ery * k * b2)); break;
          }
          default: h += oval(x, ey, erx, ery);
        }
      });
      if (this.mode === 'sad') h += `<path fill="none" stroke-width="4.5" d="M72,36 L92,42 M126,36 L106,42"/>`;
      if (this.mode === 'angry') h += `<path fill="none" stroke-width="5" d="M72,38 L93,46 M126,38 L105,46"/>`;
    }
    this.cut.innerHTML = h;
    if (this.eyesG.style.display !== 'none') this.eyesG.innerHTML = h;

    // symbols: outside the body, same colour, on the side Arc faces, never mirrored
    const sT = this.stateT, ax = 166;
    const side = v.fl >= 0 ? 0 : 200 - 2 * ax;   // shift the whole symbol cluster to the other side
    let s = '';
    if (c.sym === 'dots') for (let i = 0; i < 3; i++) s += `<circle cx="${156 + i * 12}" cy="${30 - i * 6}" r="${(3.5 + 1.5 * Math.sin(t * 5 - i)).toFixed(2)}" stroke="none"/>`;
    if (c.sym === 'typing') for (let i = 0; i < 3; i++) s += `<circle cx="${152 + i * 11}" cy="${150 - Math.max(0, Math.sin(t * 7 - i * .9)) * 6}" r="3.6" stroke="none"/>`;
    if (c.sym === 'zz') { const k = (t * .6) % 1; s += `<text x="${150 + k * 10}" y="${40 - k * 16}" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${18 + k * 6}" opacity="${(1 - k).toFixed(2)}" stroke="none">z</text>`; }
    if (c.sym === 'bang' && sT > .1) s += `<rect x="160" y="16" width="9" height="30" rx="4.5" stroke="none"/><circle cx="164.5" cy="56" r="5" stroke="none"/>`;
    if (c.sym === 'q') s += `<path fill="none" stroke-width="6" d="M154,26 Q154,14 166,14 Q178,14 178,26 Q178,34 167,38 L167,44"/><circle cx="167" cy="54" r="4" stroke="none"/>`;
    if (c.sym === 'check') { const k = Math.min(1, sT * 3); s += `<path fill="none" stroke-width="7" stroke-dasharray="60" stroke-dashoffset="${(60 * (1 - k)).toFixed(1)}" d="M152,32 L162,42 L182,18"/>`; }
    if (c.sym === 'lens') { const lx2 = 166 + Math.sin(t * 1.6) * 4; s += `<circle cx="${lx2}" cy="30" r="10" fill="none" stroke-width="5"/><path fill="none" stroke-width="6" d="M${lx2 + 7},37 L${lx2 + 15},45"/>`; }
    if (c.sym === 'stop' && sT > .08) s += `<circle cx="168" cy="30" r="13" fill="none" stroke-width="5"/><path fill="none" stroke-width="5" d="M159,39 L177,21"/>`;
    if (c.sym === 'spark') { const k = (sT * 3) % 1; s += `<path fill="none" stroke-width="4.5" opacity="${(1 - k).toFixed(2)}" d="M160,${18 - k * 6} L168,${30 - k * 6} L162,${32 - k * 6} L172,${46 - k * 6}"/>`; }
    this.sym.setAttribute('transform', `translate(${(tx + side).toFixed(2)} ${ty.toFixed(2)})`);
    this.sym.innerHTML = s;
  }
}
if (!customElements.get('arc-mascot')) customElements.define('arc-mascot', ArcMascot);
window.ArcMascot = ArcMascot; window.ARC_STATES = S; window.ARC_ALIASES = ALIAS;
