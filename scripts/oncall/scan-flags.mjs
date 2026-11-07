/**
 * On-call (docs/ONCALL.md): read the YouTube experiment flags a logged-out watch page gets (page
 * EXPERIMENT_FLAGS + player serializedExperimentFlags), keep the ones that can touch the userscript, and compare
 * them with the baseline in the repo and with flags already reported by earlier runs. Also downloads the Kevlar
 * and player bundles so the investigation can read them offline.
 *
 * Usage: node scripts/oncall/scan-flags.mjs <out-dir> [seen-flags.json]
 * Writes <out-dir>/flags.json, <out-dir>/watch.html and <out-dir>/js/*.js; updates seen-flags.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, seenPath] = process.argv.slice(2);
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const BASELINE_PATH = 'docs/experiment-flags-baseline.json';
/** Flag names that can affect PiP, the mini player, menus, keyboard, Shorts or the player we move around. */
const RELEVANT_FLAG_RE =
  /pip|picture|miniplayer|mini_player|cow|context_?menu|watch_while|hotkey|keyboard|shortcut|shorts|reel|speedmaster|draggable|popup|player_component|append_to|bezel|copy_?link/i;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Skip the EU consent interstitial
  Cookie: 'SOCS=CAI; CONSENT=YES+',
};

/** JSON object literal that starts at `start` ("{"), respecting strings. */
function sliceObject(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function ytcfgObjects(html) {
  const objects = [];
  const marker = 'ytcfg.set({';
  for (let i = html.indexOf(marker); i !== -1; i = html.indexOf(marker, i + 1)) {
    const json = sliceObject(html, i + marker.length - 1);
    if (!json) continue;
    try {
      objects.push(JSON.parse(json));
    } catch {
      /* not plain JSON */
    }
  }
  return objects;
}

async function download(url, path) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

mkdirSync(join(outDir, 'js'), { recursive: true });
const res = await fetch(WATCH_URL, { headers: HEADERS });
const html = await res.text();
writeFileSync(join(outDir, 'watch.html'), html);

const pageFlags = {};
const playerFlags = {};
let playerJsUrl = null;
for (const cfg of ytcfgObjects(html)) {
  Object.assign(pageFlags, cfg.EXPERIMENT_FLAGS ?? {});
  playerJsUrl ??= cfg.PLAYER_JS_URL ?? null;
  for (const ctx of Object.values(cfg.WEB_PLAYER_CONTEXT_CONFIGS ?? {})) {
    for (const pair of String(ctx.serializedExperimentFlags ?? '').split('&')) {
      const [name, value = ''] = pair.split('=');
      if (name) playerFlags[name] = decodeURIComponent(value);
    }
  }
}
if (Object.keys(pageFlags).length === 0) {
  throw new Error(`no EXPERIMENT_FLAGS on ${WATCH_URL} (HTTP ${res.status}); consent or bot page?`);
}

const relevant = {};
for (const [name, value] of Object.entries(pageFlags)) {
  if (RELEVANT_FLAG_RE.test(name)) relevant[name] = { where: 'page', value: String(value) };
}
for (const [name, value] of Object.entries(playerFlags)) {
  if (!RELEVANT_FLAG_RE.test(name)) continue;
  relevant[name] = relevant[name]
    ? { where: 'page+player', value: relevant[name].value }
    : { where: 'player', value };
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).flags);
const seen = new Set(
  seenPath && existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : []
);
const newFlags = Object.keys(relevant)
  .filter((name) => !baseline.has(name) && !seen.has(name))
  .sort();
const goneFlags = [...baseline].filter((name) => !(name in relevant)).sort();

// Bundles for offline reading: Kevlar (desktop app) scripts and the player
const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map((m) => new URL(m[1].replace(/&amp;/g, '&'), 'https://www.youtube.com').href)
  .filter((u) => /\/ytmainappweb\/_\/js\/|desktop_polymer|scheduler/.test(u));
if (playerJsUrl) scriptUrls.push(new URL(playerJsUrl, 'https://www.youtube.com').href);
const bundles = [];
for (const [i, url] of [...new Set(scriptUrls)].entries()) {
  const file = join(
    outDir,
    'js',
    `${String(i).padStart(2, '0')}-${url.includes('/player/') ? 'player' : 'kevlar'}.js`
  );
  try {
    await download(url, file);
    bundles.push({ file, url });
  } catch (error) {
    bundles.push({ file: null, url, error: String(error) });
  }
}

const result = {
  scannedAt: new Date().toISOString(),
  url: WATCH_URL,
  pageFlagCount: Object.keys(pageFlags).length,
  playerFlagCount: Object.keys(playerFlags).length,
  relevantFlagCount: Object.keys(relevant).length,
  newFlags: newFlags.map((name) => ({ name, ...relevant[name] })),
  goneFlags,
  relevant,
  bundles,
};
writeFileSync(join(outDir, 'flags.json'), JSON.stringify(result, null, 2));
if (seenPath)
  writeFileSync(seenPath, JSON.stringify([...new Set([...seen, ...Object.keys(relevant)])].sort()));
console.log(
  `flags: ${result.pageFlagCount} page, ${result.playerFlagCount} player, ${result.relevantFlagCount} relevant, ` +
    `${newFlags.length} new, ${goneFlags.length} gone from baseline, ${bundles.filter((b) => b.file).length} bundles`
);
