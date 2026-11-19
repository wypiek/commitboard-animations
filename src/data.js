// Load a contribution grid (Uint8Array of N levels 0..4, row-major, y = weekday).

import { W, H, N, idx } from './grid.js';

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

/** Place a list of {date: 'YYYY-MM-DD', level} days onto the 53x7 board. */
export function gridFromDays(days) {
  const grid = new Uint8Array(N);
  if (!days.length) return grid;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = new Date(`${sorted.at(-1).date}T00:00:00Z`);
  const lastWd = last.getUTCDay();
  for (const d of sorted) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const back = Math.round((last - date) / 864e5) + (6 - lastWd);
    const x = W - 1 - Math.floor(back / 7);
    if (x < 0) continue;
    grid[idx(x, date.getUTCDay())] = Math.max(0, Math.min(4, d.level));
  }
  return grid;
}

async function viaGraphQL(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionLevel}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'commitboard-animations',
    },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  if (!res.ok) throw new Error(`GraphQL request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  const weeks = json.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error(`No contribution calendar for user "${user}"`);
  return weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, level: LEVELS[d.contributionLevel] ?? 0 })),
  );
}

async function viaProfilePage(user) {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions`, {
    headers: { 'User-Agent': 'commitboard-animations' },
  });
  if (!res.ok) throw new Error(`Contributions page request failed: ${res.status}`);
  const html = await res.text();
  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*>/g)) {
    const date = tag.match(/data-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const level = tag.match(/data-level="(\d)"/)?.[1];
    if (date && level) days.push({ date, level: Number(level) });
  }
  if (!days.length) throw new Error('Could not find any contribution cells on the profile page');
  return days;
}

/** Real contributions: GraphQL when a token is available, else the public profile page. */
export async function fetchContributions(user, token) {
  const days = token ? await viaGraphQL(user, token) : await viaProfilePage(user);
  return gridFromDays(days);
}

// ---------------------------------------------------------------------------

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

/** A believable fake year: busy weekdays, quiet weekends, streaks and a vacation. */
export function sampleContributions(seed = 'commitboard') {
  const rnd = rng(hashString(seed));
  const grid = new Uint8Array(N);
  let energy = 0.5;
  const vacation = 10 + Math.floor(rnd() * 30);
  const todayRow = 3; // pretend today is a Wednesday
  for (let x = 0; x < W; x++) {
    energy = Math.min(1, Math.max(0.05, energy + (rnd() - 0.5) * 0.45));
    const away = x >= vacation && x < vacation + 2;
    for (let y = 0; y < H; y++) {
      if (x === W - 1 && y > todayRow) continue;
      const weekend = y === 0 || y === 6;
      const p = away ? 0.05 : energy * (weekend ? 0.35 : 0.95);
      if (rnd() > p) continue;
      const r = rnd() * (0.6 + energy);
      grid[idx(x, y)] = r > 1.1 ? 4 : r > 0.8 ? 3 : r > 0.45 ? 2 : 1;
    }
  }
  return grid;
}
