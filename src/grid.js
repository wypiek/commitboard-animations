// Grid geometry, palettes and the frame -> animated SVG renderer.

export const W = 53; // weeks
export const H = 7; // days
export const N = W * H;
export const idx = (x, y) => y * W + x;

export const PALETTES = {
  light: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  dark: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
};

const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;
const PAD = 4;
const RX = 2;

export const SIZE = {
  width: W * STEP - GAP + 2 * PAD,
  height: H * STEP - GAP + 2 * PAD,
};

/** Top-left pixel position of a grid cell. */
export const cellPos = (x, y) => [PAD + x * STEP, PAD + y * STEP];
export const GEOM = { CELL, GAP, STEP, PAD, RX };

const fmtTime = (v) => {
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * Render a list of frames (Uint8Array of N levels 0..4) to a looping SVG.
 * Every cell gets one discrete SMIL <animate> on its fill, encoded in
 * whichever form is shorter (full value list, or change list + keyTimes).
 * SMIL keeps working when GitHub serves the SVG through an <img> tag.
 */
export function renderSVG(anim, { theme = 'dark', title = 'Commit board' } = {}) {
  const pal = PALETTES[theme];
  const { frames, fps } = anim;
  const F = frames.length;
  const dur = `${fmtTime(F / fps)}s`;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}" viewBox="0 0 ${SIZE.width} ${SIZE.height}" role="img">`,
    `<title>${escapeXml(title)}</title>`,
  );

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const [px, py] = cellPos(x, y);
      const head = `<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" rx="${RX}" fill="${pal[frames[0][i]]}"`;

      const changes = [];
      let prev = -1;
      for (let f = 0; f < F; f++) {
        const v = frames[f][i];
        if (v !== prev) changes.push([f, v]);
        prev = v;
      }
      if (changes.length === 1) {
        parts.push(`${head}/>`);
        continue;
      }

      const full = `values="${Array.from({ length: F }, (_, f) => pal[frames[f][i]]).join(';')}"`;
      const sparse =
        `values="${changes.map(([, v]) => pal[v]).join(';')}" ` +
        `keyTimes="${changes.map(([f]) => fmtTime(f / F)).join(';')}"`;
      const enc = sparse.length < full.length ? sparse : full;

      parts.push(
        `${head}><animate attributeName="fill" calcMode="discrete" dur="${dur}" repeatCount="indefinite" ${enc}/></rect>`,
      );
    }
  }

  if (anim.overlay) parts.push(anim.overlay({ pal, dur, F }));
  parts.push('</svg>');
  return parts.join('\n');
}

export function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
