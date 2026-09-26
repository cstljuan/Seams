// arc-mascot.js - "Arc", the Seams mascot (v2 placeholder, ShellHacks 2026)
// A lightning bolt with a face. ONE solid colour, no gradients, no filters, no glow.
// Eyes and symbols are cut out of (or drawn in) the same single colour.
//
// Built the way the two references work:
//  - bloub (bloub.vercel.app): one solid shape that morphs continuously between states,
//    every value driven by springs, expressions changed by eye shapes only.
//  - agent-robot-avatar (github.com/CX-ArtLab/agent-robot-avatar): a zero-dependency web
//    component with play(action), idle blinking, pointer-following eyes, press-to-squeeze,
//    startWaiting(), reset(), reduced-motion support, and state events.
// The character itself is original (from Juan's sketch): a bolt with a head and two tall eyes,
// tip pointing down-left.
//
// <arc-mascot size="160" color="#101418" state="idle"></arc-mascot>
// el.play('happy') -> Promise (one-shot reactions return to idle)
// el.set('thinking') -> holds a looping state until changed
// el.startWaiting() / el.reset() / el.setLevel(0..1) for talking

const NS = 'http://www.w3.org/2000/svg';

// shape params: sx sy (scale), lean (skew deg), zig (depth of the zigzag), tip (tip reach), rot (deg), bob
// eyes: ew eh (eye size multipliers), mode: oval | happy | closed | wide | x | squint | wink | sad | confused
const S = {
  idle:      { sx: 1,    sy: 1,    lean: 0,   zig: 1,    tip: 1,    rot: 0,   bob: 1,   ew: 1,   eh: 1,    mode: 'oval' },
  thinking:  { sx: 1,    sy: 1,    lean: -6,  zig: 1,    tip: 1,    rot: -4,  bob: .5,  ew: .9,  eh: .8,   mode: 'oval', look: [-5, -6], sym: 'dots', loop: 1 },
  waiting:   { sx: 1,    sy: 1,    lean: 0,   zig: 1,    tip: 1,    rot: 0,   bob: .6,  ew: 1,   eh: 1,    mode: 'oval', scan: 1, loop: 1 },
  talk:      { sx: 1,    sy: 1,    lean: 0,   zig: 1,    tip: 1,    rot: 0,   bob: 1.2, ew: 1,   eh: 1,    mode: 'oval', mouth: 1, loop: 1 },
  sleep:     { sx: 1.08, sy: .9,   lean: 4,   zig: .75,  tip: .85,  rot: 8,   bob: .35, ew: 1,   eh: .1,   mode: 'closed', sym: 'zz', loop: 1 },
  happy:     { sx: 1.06, sy: .95,  lean: 0,   zig: 1.05, tip: 1,    rot: 0,   bob: 2,   ew: 1,   eh: 1,    mode: 'happy', hop: 1, dur: 1400 },
  wink:      { sx: 1,    sy: 1,    lean: 3,   zig: 1,    tip: 1,    rot: 3,   bob: 1,   ew: 1,   eh: 1,    mode: 'wink', dur: 1100 },
  wide:      { sx: .94,  sy: 1.1,  lean: 0,   zig: 1.1,  tip: 1.1,  rot: 0,   bob: .3,  ew: 1.35,eh: 1.3,  mode: 'wide', dur: 1300 },
  alert:     { sx: .92,  sy: 1.14, lean: 0,   zig: 1.35, tip: 1.2,  rot: 0,   bob: .2,  ew: 1.1, eh: 1.2,  mode: 'oval', jitter: 1, sym: 'bang', dur: 1600 },
  found:     { sx: .96,  sy: 1.06, lean: -8,  zig: 1.2,  tip: 1.12,  rot: -10, bob: .8,  ew: 1.2, eh: 1.2,  mode: 'wide', point: 1, dur: 1700 },
  success:   { sx: 1.05, sy: .96,  lean: 0,   zig: 1,    tip: 1,    rot: 0,   bob: 2.2, ew: 1,   eh: 1,    mode: 'happy', hop: 1, sym: 'check', dur: 1500 },
  failure:   { sx: 1.04, sy: .9,   lean: 6,   zig: .8,   tip: .8,   rot: 10,  bob: .3,  ew: 1,   eh: .8,   mode: 'sad', dur: 1700 },
  error:     { sx: 1,    sy: 1,    lean: 0,   zig: 1.1,  tip: 1,    rot: 0,   bob: 0,   ew: 1,   eh: 1,    mode: 'x', shake: 1, dur: 1400 },
  confused:  { sx: 1,    sy: 1,    lean: -4,  zig: 1,    tip: 1,    rot: -12, bob: .6,  ew: 1,   eh: 1,    mode: 'confused', sym: 'q', dur: 1800 },
  suspicious:{ sx: 1.02, sy: .98,  lean: 5,   zig: .95,  tip: 1,    rot: 4,   bob: .4,  ew: 1.1, eh: .35,  mode: 'squint', look: [6, 0], dur: 1800 },
  squeeze:   { sx: 1.18, sy: .8,   lean: 0,   zig: .9,   tip: .9,   rot: 0,   bob: 0,   ew: 1.1, eh: .3,   mode: 'squint' },
};
const LOOPING = new Set(Object.keys(S).filter(k => S[k].loop || k === 'idle' || k === 'squeeze'));
// Same action names as the two references, so their docs/examples map 1:1.
// agent-robot-avatar: idle bored waiting input send success failure warning inspect blocked error surprise sleep wake
// bloub states: idle thinking wink wide alert notify exclaim sleep
const ALIAS = {
  bored: 'sleep', input: 'waiting', send: 'success', warning: 'alert', inspect: 'suspicious', blocked: 'failure',
  surprise: 'wide', wake: 'happy', notify: 'found', exclaim: 'alert', speak: 'talk', listen: 'waiting',
};
const resolve = n => ALIAS[n] || n;

class Spring {
  constructor(v, k = 180, c = 16) { this.x = v; this.v = 0; this.t = v; this.k = k; this.c = c; }
  step(dt) { this.v += (this.k * (this.t - this.x) - this.c * this.v) * dt; this.x += this.v * dt; return this.x; }
}

// rounded polygon: every corner cut with a quadratic curve of radius r
function roundPoly(pts, r) {
  const n = pts.length; let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2), rr = Math.min(r, l1 / 2.2, l2 / 2.2);
    const a = [p1[0] + v1[0] / l1 * rr, p1[1] + v1[1] / l1 * rr], b = [p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr];
    d += (i ? ' L' : 'M') + a[0].toFixed(2) + ',' + a[1].toFixed(2) + ` Q${p1[0].toFixed(2)},${p1[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  }
  return d + 'Z';
}

class ArcMascot extends HTMLElement {
  static get observedAttributes() { return ['state', 'color', 'size']; }

  connectedCallback() {
    const size = +(this.getAttribute('size') || 160);
    this.style.display = 'inline-block'; this.style.width = this.style.height = size + 'px';
    this.style.touchAction = 'none'; this.style.cursor = 'pointer';
    const id = 'arc' + Math.random().toString(36).slice(2, 8);
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 200 200'); this.svg.setAttribute('width', '100%'); this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('role', 'img'); this.svg.setAttribute('aria-label', 'Arc, the Seams mascot');
    this.svg.innerHTML = `
      <defs><mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff"/>
        <g class="cut" fill="#000" stroke="#000" stroke-linecap="round" stroke-linejoin="round"></g>
      </mask></defs>
      <g class="all">
        <path class="body" mask="url(#${id}m)"/>
        <g class="sym" stroke-linecap="round" stroke-linejoin="round"></g>
      </g>`;
    this.appendChild(this.svg);
    this.body = this.svg.querySelector('.body'); this.cut = this.svg.querySelector('.cut');
    this.sym = this.svg.querySelector('.sym'); this.all = this.svg.querySelector('.all');
    this.applyColor();

    this.sp = {}; for (const k of ['sx', 'sy', 'lean', 'zig', 'tip', 'rot', 'bob', 'ew', 'eh']) this.sp[k] = new Spring(S.idle[k]);
    this.sp.lx = new Spring(0, 90, 13); this.sp.ly = new Spring(0, 90, 13); this.sp.hop = new Spring(0, 260, 14);
    this.mode = 'oval'; this.cfg = S.idle; this.name = 'idle'; this.base = 'idle'; this.level = null;
    this.t = 0; this.last = performance.now(); this.blinkAt = 1.5; this.blink = 0; this.stateT = 0; this.ptr = [0, 0];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.onMove = e => {
      const r = this.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy) || 1, k = Math.min(1, m / 420); this.ptr = [dx / m * 6 * k, dy / m * 5 * k];
    };
    this.onDown = () => { this.pressed = true; this.set('squeeze'); };
    this.onUp = () => { if (!this.pressed) return; this.pressed = false; this.play(Math.random() < .5 ? 'happy' : 'wink'); };
    window.addEventListener('pointermove', this.onMove);
    this.addEventListener('pointerdown', this.onDown); window.addEventListener('pointerup', this.onUp);
    this.set(this.getAttribute('state') || 'idle');
    const loop = now => { this.frame(now); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() {
    cancelAnimationFrame(this.raf); window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp);
  }
  attributeChangedCallback(n, o, v) {
    if (!this.sp) return; if (n === 'state') this.set(v); if (n === 'color') this.applyColor();
  }
  applyColor() {
    const c = this.getAttribute('color') || 'currentColor';
    this.body.setAttribute('fill', c); this.sym.setAttribute('fill', c); this.sym.setAttribute('stroke', c);
  }

  _go(name) {
    const c = S[name] || S.idle; this.cfg = c; this.name = S[name] ? name : 'idle'; this.mode = c.mode; this.stateT = 0;
    for (const k in this.sp) if (k in c) this.sp[k].t = c[k];
    if (c.hop) this.sp.hop.v = -170;
    if (name === 'alert' || name === 'wide') { this.sp.sy.v += 3; }
    this.dispatchEvent(new CustomEvent('arc-state', { detail: this.name }));
  }
  set(name) { name = resolve(name); if (LOOPING.has(name) || !S[name]) { this.base = S[name] ? name : 'idle'; this._go(this.base); } else this.play(name); return this; }
  play(name) {
    name = resolve(name); if (!S[name]) name = 'idle';
    if (LOOPING.has(name)) { this.set(name); return Promise.resolve(); }
    clearTimeout(this.tmr); this._go(name);
    return new Promise(res => { this.tmr = setTimeout(() => { this._go(this.base); res(); }, S[name].dur || 1400); });
  }
  startWaiting() { return this.set('waiting'); }
  reset() { clearTimeout(this.tmr); return this.set('idle'); }
  setLevel(v) { this.level = v == null ? null : Math.max(0, Math.min(1, v)); return this; }

  frame(now) {
    let dt = Math.min(.05, (now - this.last) / 1000); this.last = now; this.t += dt; this.stateT += dt; const t = this.t;
    const c = this.cfg, m = this.reduced ? .25 : 1;
    const look = c.look || this.ptr; this.sp.lx.t = look[0]; this.sp.ly.t = look[1];
    if (c.scan) { this.sp.lx.t = Math.sin(t * 2.4) * 7; this.sp.ly.t = 1; }
    const v = {}; for (const k in this.sp) v[k] = this.sp[k].step(dt);

    // body transform
    let tx = 0, ty = Math.sin(t * 2.2) * 4 * v.bob * m + v.hop * .12;
    if (c.jitter) { tx += (Math.random() - .5) * 3; ty += (Math.random() - .5) * 2; }
    if (c.shake) tx += Math.sin(this.stateT * 40) * 7 * Math.max(0, 1 - this.stateT * 1.2);
    if (c.hop && this.stateT < .05) this.sp.hop.v = -170;
    const cx = 100, cy = 104;
    this.all.setAttribute('transform',
      `translate(${(tx).toFixed(2)} ${(ty).toFixed(2)}) rotate(${v.rot.toFixed(2)} ${cx} ${cy}) translate(${cx} ${cy}) scale(${v.sx.toFixed(3)} ${v.sy.toFixed(3)}) skewX(${v.lean.toFixed(2)}) translate(${-cx} ${-cy})`);

    // bolt: head block on top, zigzag, tip down-left (from Juan's sketch)
    const z = v.zig, tp = v.tip, wob = Math.sin(t * 3) * 1.2 * m, point = c.point ? Math.sin(this.stateT * 14) * 6 * Math.max(0, 1 - this.stateT) : 0;
    const pts = [
      [58, 26], [142, 20],                          // head top
      [134, 92 - 4 * (z - 1)],                      // right side down
      [100 + 58 * z, 94 + wob],                     // zig out to the right
      [100 - 34 * tp + point, 104 + 80 * tp],       // tip, down-left
      [92 + 6 * (z - 1), 118],                      // back up into the notch
      [56 - 6 * (z - 1), 120],                      // left notch
    ];
    this.body.setAttribute('d', roundPoly(pts, 9));

    // eyes (cut out of the body through the mask)
    if (t > this.blinkAt) { this.blink = 1; this.blinkAt = t + 2 + Math.random() * 3.5; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const bk = this.mode === 'oval' || this.mode === 'wide' ? 1 - Math.sin(Math.min(1, this.blink) * Math.PI) * .9 : 1;
    const ex = [84, 114], ey = 56 + v.ly, rx = 7.5 * v.ew, ry = 14 * v.eh * bk;
    let h = '';
    const oval = (x, y, a, b) => `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${a.toFixed(2)}" ry="${Math.max(1.4, b).toFixed(2)}"/>`;
    const arc = (x, y, up) => `<path fill="none" stroke-width="5.5" d="M${x - 8},${y + (up ? 4 : -3)} Q${x},${y + (up ? -8 : 7)} ${x + 8},${y + (up ? 4 : -3)}"/>`;
    ex.forEach((x0, i) => {
      const x = x0 + v.lx;
      switch (this.mode) {
        case 'happy': h += arc(x, ey, true); break;
        case 'closed': h += `<path fill="none" stroke-width="5" d="M${x - 8},${ey + 2} L${x + 8},${ey + 2}"/>`; break;
        case 'wink': h += i ? arc(x, ey, true) : oval(x, ey, rx, ry); break;
        case 'x': h += `<path fill="none" stroke-width="5" d="M${x - 7},${ey - 7} L${x + 7},${ey + 7} M${x + 7},${ey - 7} L${x - 7},${ey + 7}"/>`; break;
        case 'sad': h += oval(x, ey + 3, rx * .9, ry * .8) ; break;
        case 'confused': h += oval(x, ey + (i ? -2 : 3), rx * (i ? 1.15 : .7), ry * (i ? 1.1 : .55)); break;
        case 'squint': h += `<rect x="${(x - 9).toFixed(2)}" y="${(ey - 2.5).toFixed(2)}" width="18" height="${Math.max(4, ry * .6).toFixed(2)}" rx="2.5"/>`; break;
        default: h += oval(x, ey, rx, ry);
      }
    });
    if (this.mode === 'sad') h += `<path fill="none" stroke-width="4.5" d="M72,36 L92,42 M126,36 L106,42"/>`;
    // mouth only while talking
    if (c.mouth) {
      const env = this.level != null ? this.level : Math.abs(Math.sin(t * 11) * .6 + Math.sin(t * 7.3) * .4);
      h += `<ellipse cx="${(99 + v.lx * .6).toFixed(2)}" cy="${(80 + v.ly * .5).toFixed(2)}" rx="${(5 + env * 3).toFixed(2)}" ry="${(1.5 + env * 6).toFixed(2)}"/>`;
    }
    this.cut.innerHTML = h;

    // symbols, same single colour, outside the body
    let s = '';
    const sT = this.stateT;
    if (c.sym === 'dots') for (let i = 0; i < 3; i++) s += `<circle cx="${156 + i * 12}" cy="${30 - i * 6}" r="${(3.5 + 1.5 * Math.sin(t * 5 - i)).toFixed(2)}"/>`;
    if (c.sym === 'zz') { const k = (t * .6) % 1; s += `<text x="${150 + k * 10}" y="${40 - k * 16}" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${18 + k * 6}" opacity="${(1 - k).toFixed(2)}" stroke="none">z</text>`; }
    if (c.sym === 'bang' && sT > .1) s += `<rect x="160" y="16" width="9" height="30" rx="4.5" stroke="none"/><circle cx="164.5" cy="56" r="5" stroke="none"/>`;
    if (c.sym === 'q') s += `<path fill="none" stroke-width="6" d="M154,26 Q154,14 166,14 Q178,14 178,26 Q178,34 167,38 L167,44"/><circle cx="167" cy="54" r="4" stroke="none"/>`;
    if (c.sym === 'check') { const k = Math.min(1, sT * 3); s += `<path fill="none" stroke-width="7" stroke-dasharray="60" stroke-dashoffset="${(60 * (1 - k)).toFixed(1)}" d="M152,32 L162,42 L182,18"/>`; }
    this.sym.innerHTML = s;
  }
}
customElements.define('arc-mascot', ArcMascot);
