#!/usr/bin/env node
// Usage:
//   node src/cli.js --user <github-login> [--out dist] [--text "HELLO"] [--only wave,life]
//   node src/cli.js --sample [--seed abc] [--out examples]
// GITHUB_TOKEN (env) is used for the GraphQL API when present.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ANIMATIONS } from './animations.js';
import { fetchContributions, sampleContributions } from './data.js';
import { renderSVG, PALETTES, escapeXml } from './grid.js';

const { values: args } = parseArgs({
  options: {
    user: { type: 'string' },
    token: { type: 'string' },
    sample: { type: 'boolean', default: false },
    seed: { type: 'string', default: 'commitboard' },
    out: { type: 'string', default: 'dist' },
    text: { type: 'string' },
    only: { type: 'string' },
    themes: { type: 'string', default: 'light,dark' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`commitboard-animations

  --user <login>   GitHub user whose contribution graph to animate
  --token <token>  GitHub token (default: $GITHUB_TOKEN); uses GraphQL when set
  --sample         use generated sample data instead of a real user
  --seed <str>     seed for --sample (default: commitboard)
  --out <dir>      output directory (default: dist)
  --text <msg>     message for the marquee animation
  --only <names>   comma-separated subset of: ${Object.keys(ANIMATIONS).join(', ')}
  --themes <list>  comma-separated themes (default: light,dark)`);
  process.exit(0);
}

const user = args.user ?? process.env.GITHUB_REPOSITORY_OWNER;
const token = args.token ?? process.env.GITHUB_TOKEN;

let data;
if (args.sample || !user) {
  if (!args.sample) console.warn('No --user given; using sample data.');
  data = sampleContributions(args.seed);
} else {
  console.log(`Fetching contributions for ${user}${token ? ' (GraphQL)' : ' (public page)'}...`);
  data = await fetchContributions(user, token);
}

const names = args.only ? args.only.split(',').map((s) => s.trim()) : Object.keys(ANIMATIONS);
const themes = args.themes.split(',').map((s) => s.trim());
for (const n of names) if (!ANIMATIONS[n]) throw new Error(`Unknown animation "${n}"`);
for (const t of themes) if (!PALETTES[t]) throw new Error(`Unknown theme "${t}"`);

await mkdir(args.out, { recursive: true });
for (const name of names) {
  const { fn, title } = ANIMATIONS[name];
  const anim = fn(data, { text: args.text || undefined });
  for (const theme of themes) {
    const svg = renderSVG(anim, { theme, title: `${title} · commit board` });
    const file = join(args.out, `${name}-${theme}.svg`);
    await writeFile(file, svg);
    console.log(`${file.padEnd(32)} ${String(anim.frames.length).padStart(4)} frames  ${(svg.length / 1024).toFixed(0).padStart(4)} KB`);
  }
}

// Simple local preview page.
const cards = names
  .map((n) => {
    const { title, blurb } = ANIMATIONS[n];
    const imgs = themes.map((t) => `<img class="${t}" src="${n}-${t}.svg" alt="${escapeXml(title)}">`).join('');
    return `<section><h2>${escapeXml(title)} <code>${n}</code></h2><p>${escapeXml(blurb)}</p>${imgs}</section>`;
  })
  .join('\n');
await writeFile(
  join(args.out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Commit board animations</title>
<style>
body{font:15px system-ui,sans-serif;margin:24px;background:#fff;color:#1f2328}
section{margin-bottom:28px}img{display:block;max-width:100%}img.dark{display:none}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}img.light{display:none}img.dark{display:block}}
</style>
<h1>Commit board animations</h1>
${cards}`,
);
