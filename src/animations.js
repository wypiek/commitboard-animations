// Each animation takes the contribution grid and returns { frames, fps, overlay? }.
// frames: array of Uint8Array(N) with levels 0..4. Every animation loops seamlessly:
// stateless ones are periodic by construction, stateful ones are simulated for two
// loops and only the second (steady-state) loop is kept.

import { W, H, N, idx, cellPos, GEOM } from './grid.js';
import { rng } from './data.js';
import { textBitmap } from './font.js';

const blank = () => new Uint8Array(N);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dim = (data) => data.map((l) => (l > 0 ? 1 : 0));
const TAU = Math.PI * 2;

function put(f, x, y, level) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  if (level > f[i]) f[i] = level;
}

/** Run a stateful step function for two loops and keep the second one. */
function steady(L, step) {
  const frames = [];
  for (let t = 0; t < 2 * L; t++) {
    const f = step(t, t % L);
    if (t >= L) frames.push(f);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Data-driven

/** Your year drops in column by column, settles, then falls through the floor. */
export function gravity(data) {
  const cells = [];
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) if (data[idx(x, y)]) cells.push({ x, y, l: data[idx(x, y)] });

  const colDelay = 0.6;
  const t0 = (c) => Math.round(c.x * colDelay) + (H - 1 - c.y) * 2;
  const inEnd = Math.max(0, ...cells.map((c) => t0(c) + 1 + c.y));
  const exitStart = inEnd + 30;
  const t1 = (c) => exitStart + Math.round((W - 1 - c.x) * colDelay * 0.6);
  const F = exitStart + Math.round((W - 1) * colDelay * 0.6) + H + 8;

  const frames = [];
  for (let t = 0; t < F; t++) {
    const f = blank();
    for (const c of cells) {
      const p = t >= t1(c) ? c.y + (t - t1(c)) : Math.min(c.y, t - t0(c) - 1);
      if (p >= 0 && p < H) f[idx(c.x, p)] = c.l;
    }
    frames.push(f);
  }
  return { frames, fps: 15 };
}

/** A diagonal swell of light rolls across the board, lifting every square it passes. */
export function wave(data) {
  const L = 60;
  const lambda = 17;
  const frames = [];
  for (let t = 0; t < L; t++) {
    const f = blank();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = Math.sin(TAU * ((x + y * 0.7) / lambda - t / L));
        const bump = s > 0.85 ? 3 : s > 0.5 ? 2 : s > 0.15 ? 1 : s < -0.6 ? -1 : 0;
        f[idx(x, y)] = clamp(data[idx(x, y)] + bump, 0, 4);
      }
    frames.push(f);
  }
  return { frames, fps: 15 };
}

/** Conway's Game of Life seeded with your commits, then wiped back to the real board. */
export function life(data) {
  const hold = 14;
  const gens = 38;
  const frames = [];
  for (let i = 0; i < hold; i++) frames.push(data.slice());

  let alive = data.map((l) => (l ? 1 : 0));
  let age = new Int16Array(N).fill(-1); // -1 = original cell, keeps its real colour
  let color = data.slice();
  for (let g = 0; g < gens; g++) {
    const next = new Uint8Array(N);
    const nAge = new Int16Array(N);
    const nColor = blank();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (dx || dy) n += alive[idx((x + dx + W) % W, (y + dy + H) % H)];
        const i = idx(x, y);
        const live = alive[i] ? n === 2 || n === 3 : n === 3;
        if (!live) continue;
        next[i] = 1;
        if (!alive[i]) nAge[i] = 0;
        else nAge[i] = age[i] < 0 ? -1 : age[i] + 1;
        const a = nAge[i];
        nColor[i] = a < 0 ? color[i] : a === 0 ? 4 : a === 1 ? 3 : a < 6 ? 2 : 1;
      }
    alive = next;
    age = nAge;
    color = nColor;
    frames.push(color.slice());
  }

  const last = color;
  for (let k = 0; k <= W; k += 2) {
    const f = blank();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        f[i] = x < k ? data[i] : x === k || x === k + 1 ? 4 : last[i];
      }
    frames.push(f);
  }
  return { frames, fps: 10 };
}

/** A scanner beam bounces back and forth, lighting up your history as it passes. */
export function scanner(data) {
  const P = 2 * (W - 1);
  const lastVisit = new Array(W).fill(-1e9);
  const frames = steady(P, (t, tm) => {
    const pos = tm < W ? tm : P - tm;
    lastVisit[pos] = t;
    const f = blank();
    for (let x = 0; x < W; x++) {
      const b = 4 - (t - lastVisit[x]) * 0.22;
      for (let y = 0; y < H; y++) {
        const i = idx(x, y);
        if (x === pos) f[i] = 4;
        else if (data[i]) f[i] = clamp(Math.min(data[i], Math.ceil(b)), 1, 4);
        else f[i] = b > 3.2 ? 2 : b > 2.5 ? 1 : 0;
      }
    }
    return f;
  });
  return { frames, fps: 20 };
}

/** Pixel text scrolls across a dimmed copy of your board. */
export function marquee(data, { text = 'COMMIT EARLY, COMMIT OFTEN ♥' } = {}) {
  const bmp = textBitmap(text);
  const F = W + bmp.width + 1;
  const base = dim(data);
  const frames = Array.from({ length: F }, () => base);
  const fps = 14;

  const overlay = ({ pal, dur }) => {
    const { CELL, STEP, RX } = GEOM;
    const [ox, oy] = cellPos(0, 0);
    const clipW = W * STEP - GEOM.GAP;
    const clipH = H * STEP - GEOM.GAP;
    const shifts = Array.from({ length: F }, (_, f) => `${(W - f) * STEP} 0`).join(';');
    const rects = bmp.pixels
      .map(([x, y]) => {
        const [px, py] = cellPos(x, y);
        return `<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" rx="${RX}"/>`;
      })
      .join('');
    return (
      `<clipPath id="board"><rect x="${ox}" y="${oy}" width="${clipW}" height="${clipH}"/></clipPath>` +
      `<g clip-path="url(#board)"><g fill="${pal[4]}" transform="translate(${W * STEP} 0)">` +
      `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${dur}" repeatCount="indefinite" values="${shifts}"/>` +
      `${rects}</g></g>`
    );
  };
  return { frames, fps, overlay };
}

// ---------------------------------------------------------------------------
// Effects (your board shows through faintly where it makes sense)

/** Raindrops land on the board and send rings outward. */
export function ripple(data) {
  const L = 72;
  const rnd = rng(11);
  const drops = Array.from({ length: 7 }, (_, i) => ({
    cx: 3 + Math.floor(rnd() * (W - 6)),
    cy: Math.floor(rnd() * H),
    t0: Math.floor((i * L) / 7 + rnd() * 4),
  }));
  const base = dim(data);
  const frames = [];
  for (let t = 0; t < L; t++) {
    const f = base.slice();
    for (const d of drops) {
      const a = (t - d.t0 + L) % L;
      if (a > 26) continue;
      const r = a * 0.45;
      const lvl = clamp(4 - Math.floor(a / 7), 1, 4);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const dist = Math.hypot(x - d.cx, y - d.cy);
          if (a < 2 && dist < 0.8) put(f, x, y, 4);
          if (Math.abs(dist - r) < 0.55) put(f, x, y, lvl);
          else if (a > 3 && Math.abs(dist - (r - 1.6)) < 0.5) put(f, x, y, Math.max(1, lvl - 1));
        }
    }
    frames.push(f);
  }
  return { frames, fps: 15 };
}

/** Falling code rain with bright heads and fading tails. */
export function matrix(data) {
  const L = 48;
  const rnd = rng(7);
  const streaks = [];
  for (let x = 0; x < W; x++)
    for (let k = 0; k < 2; k++)
      streaks.push({
        x,
        s: Math.floor(rnd() * L),
        v: rnd() < 0.5 ? 1 : 0.5,
        tail: 3 + Math.floor(rnd() * 3),
      });
  const base = dim(data);
  const frames = [];
  for (let t = 0; t < L; t++) {
    const f = base.slice();
    for (const st of streaks) {
      const age = (t - st.s + L) % L;
      const head = Math.floor(age * st.v) - 1;
      for (let d = 0; d <= st.tail; d++) put(f, st.x, head - d, d === 0 ? 4 : Math.max(1, 4 - d));
    }
    frames.push(f);
  }
  return { frames, fps: 15 };
}

/** Rockets climb the board and burst into sparks. */
export function fireworks() {
  const L = 90;
  const rnd = rng(23);
  const count = 8;
  const rockets = Array.from({ length: count }, (_, i) => {
    const by = 2 + Math.floor(rnd() * 2);
    return {
      x: 4 + Math.floor(rnd() * (W - 8)),
      by,
      t0: Math.floor((i * L) / count + rnd() * 5),
      rise: (H - 1 - by) * 2,
    };
  });
  const dirs = Array.from({ length: 12 }, (_, k) => [Math.cos((k * TAU) / 12), Math.sin((k * TAU) / 12)]);
  const frames = [];
  for (let t = 0; t < L; t++) {
    const f = blank();
    for (const r of rockets) {
      const a = (t - r.t0 + L) % L;
      if (a < r.rise) {
        const y = H - 1 - Math.floor(a / 2);
        put(f, r.x, y, 3);
        put(f, r.x, y + 1, 1);
        continue;
      }
      const b = a - r.rise;
      if (b >= 18) continue;
      if (b < 2) {
        put(f, r.x, r.by, 4);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(f, r.x + dx, r.by + dy, 3);
      }
      const lvl = 4 - Math.floor(b / 5);
      for (const [cx, cy] of dirs) {
        const px = r.x + cx * b * 0.55;
        const py = r.by + cy * b * 0.45 + 0.012 * b * b;
        put(f, px, py, lvl);
        if (b > 3) put(f, r.x + cx * (b - 2) * 0.55, r.by + cy * (b - 2) * 0.45 + 0.012 * (b - 2) ** 2, Math.max(1, lvl - 2));
      }
    }
    frames.push(f);
  }
  return { frames, fps: 15 };
}

/** Every week becomes an equalizer bar, with peak markers that hang then drop. */
export function equalizer() {
  const L = 90;
  const rnd = rng(5);
  const cols = Array.from({ length: W }, (_, x) => ({
    k1: 2 + Math.floor(rnd() * 3),
    k2: 5 + Math.floor(rnd() * 5),
    p1: x * 0.05 + rnd() * 0.5,
    p2: rnd(),
    amp: 1 - 0.35 * (x / W),
  }));
  const peak = new Array(W).fill(0);
  const hold = new Array(W).fill(0);
  const rowLevel = [1, 1, 2, 2, 3, 3, 4];

  const frames = steady(L, (t) => {
    const raw = cols.map(
      (c) =>
        c.amp *
        (0.2 +
          4.2 * (0.5 + 0.5 * Math.sin(TAU * ((c.k1 * t) / L + c.p1))) ** 1.5 +
          3.4 * (0.5 + 0.5 * Math.sin(TAU * ((c.k2 * t) / L + c.p2))) ** 2),
    );
    const f = blank();
    for (let x = 0; x < W; x++) {
      const sm = 0.25 * raw[Math.max(0, x - 1)] + 0.5 * raw[x] + 0.25 * raw[Math.min(W - 1, x + 1)];
      const h = clamp(Math.round(sm), 0, H);
      if (h >= peak[x]) {
        peak[x] = h;
        hold[x] = 6;
      } else if (hold[x] > 0) hold[x]--;
      else peak[x] = Math.max(h, peak[x] - 0.5);
      for (let k = 0; k < h; k++) f[idx(x, H - 1 - k)] = rowLevel[k];
      const pk = Math.ceil(peak[x]);
      if (pk > h && pk <= H) f[idx(x, H - pk)] = 4;
    }
    return f;
  });
  return { frames, fps: 15 };
}

/** A heart monitor trace sweeps across the board. */
export function pulse() {
  const beat = [0, 0, 0, 0, 0, -1, -1, 0, 0, 0, 1, -4, 2, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, 0, 0, 0];
  const base = 4;
  const line = (x) => base + beat[x % beat.length];
  const lastDraw = new Array(W).fill(-1e9);
  const frames = steady(W, (t, tm) => {
    lastDraw[tm] = t;
    const f = blank();
    for (let x = 0; x < W; x++) {
      const age = t - lastDraw[x];
      const lvl = age === 0 ? 4 : age <= 3 ? 3 : age <= 12 ? 2 : age <= 32 ? 1 : 0;
      if (!lvl) continue;
      const y1 = line(x);
      const y0 = x > 0 ? line(x - 1) : y1;
      const [a, b] = y0 < y1 ? [y0 + 1, y1] : y0 > y1 ? [y1, y0 - 1] : [y1, y1];
      for (let y = a; y <= b; y++) put(f, x, y, lvl);
      put(f, x, y1, lvl);
    }
    return f;
  });
  return { frames, fps: 18 };
}

export const ANIMATIONS = {
  gravity: { fn: gravity, title: 'Gravity', blurb: 'Your year drops in column by column, settles, then falls through the floor.' },
  wave: { fn: wave, title: 'Wave', blurb: 'A diagonal swell of light rolls across your board.' },
  life: { fn: life, title: 'Life', blurb: "Conway's Game of Life seeded with your commits, then wiped back to reality." },
  scanner: { fn: scanner, title: 'Scanner', blurb: 'A bouncing beam lights up your history as it passes.' },
  marquee: { fn: marquee, title: 'Marquee', blurb: 'Your own message scrolls across a dimmed copy of your board.' },
  ripple: { fn: ripple, title: 'Ripple', blurb: 'Raindrops land on the board and send rings outward.' },
  matrix: { fn: matrix, title: 'Code rain', blurb: 'Falling streams with bright heads and fading tails.' },
  fireworks: { fn: fireworks, title: 'Fireworks', blurb: 'Rockets climb the board and burst into sparks.' },
  equalizer: { fn: equalizer, title: 'Equalizer', blurb: 'Every week becomes a bouncing bar with hanging peak markers.' },
  pulse: { fn: pulse, title: 'Pulse', blurb: 'A heart-monitor trace sweeps across the board.' },
};
