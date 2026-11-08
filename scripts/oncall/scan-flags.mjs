/**
 * On-call (docs/ONCALL.md), two scans of YouTube experiment flags that can touch the userscript:
 *
 * - Code: every flag the Kevlar and player bundles check, whether or not it is rolled out to anyone yet. The bundles
 *   are the same for every user, so this is the complete list of what the code can do. Flag-reading functions are
 *   minified differently in every build, so they are found from the data: a call target whose string arguments are
 *   mostly flags this page was served is a flag reader, and all its arguments are flags.
 * - Served: the flags this logged-out page got (page EXPERIMENT_FLAGS + player serializedExperimentFlags). YouTube
 *   buckets visitors randomly, so this is a sample of what is rolled out now, different on every load.
 *
 * Both are compared with docs/experiment-flags-baseline.json and with flags already reported by earlier runs.
 * The scan fails loudly (non-zero exit → Telegram report) when reading flags looks broken.
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
/**
 * Code that our flows go through. A flag checked within ANCHOR_WINDOW characters of one of these (about one
 * minified function) is relevant whatever its name, e.g. the watch-page code around mini player activation.
 */
const CODE_ANCHORS = [
  'yt-activate-miniplayer',
  'yt-deactivate-miniplayer',
  'ytd-miniplayer',
  'yt-miniplayer',
  'onCollapseMiniplayer',
  'SET_MINIPLAYER_IS_ACTIVE',
  'enterpictureinpicture',
  'documentPictureInPicture',
  'pictureInPicture',
  'setActionHandler',
  'appendTo',
  'ytd-player',
  'ytd-shorts',
  'ytp-contextmenu',
  'ytp-bezel',
];
const ANCHOR_WINDOW = 600;
/** A call target is a flag reader when it has this many distinct string arguments … */
const FLAG_READER_MIN_ARGS = 20;
/**
 * … and at least this share of them are flags the page was served. Real readers measure ~30% (boolean readers:
 * most flags in the code are not sent to logged-out pages) or ~90–100% (number / string readers); other call
 * targets with string arguments measure ~0%.
 */
const FLAG_READER_MIN_SERVED_SHARE = 0.15;
/** Fewer relevant code flags than this share of the baseline means flag reading broke, not that YouTube removed them. */
const MIN_CODE_FLAGS_SHARE_OF_BASELINE = 0.5;
/**
 * Some loads get YouTube's module-set loader (`ytmainappweb.base_module_set…/m=base`, ~1 MB) instead of the full
 * Kevlar bundle (`ytmainappweb.kevlar_base…/m=kevlar_base_module,kevlar_main_module,…`, ~10 MB): an experiment
 * bucket whose code arrives later in lazy modules, so the page source holds only a fraction of the flag checks.
 * The page is loaded again (a new random bucket) until it has the full bundle, at most this many times.
 */
const PAGE_ATTEMPTS = 4;
const FULL_KEVLAR_BUNDLE_RE = /\/ytmainappweb\/_\/js\/k=ytmainappweb\.kevlar_base\./;
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

/**
 * Flags checked in a bundle: arguments of call targets that mostly receive served flags (see header), and for each
 * the code anchors (CODE_ANCHORS) found near one of its checks.
 */
function codeFlags(source, servedNames) {
  const calls = [];
  const byCallee = new Map();
  const call = /([\w$.]{1,40})\(\s*"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"\s*\)/g;
  for (const m of source.matchAll(call)) {
    const callee = m[1].includes('.') ? m[1].slice(m[1].lastIndexOf('.')) : m[1]; // a.J.N → .N
    calls.push({ callee, name: m[2], index: m.index });
    const args = byCallee.get(callee) ?? new Set();
    args.add(m[2]);
    byCallee.set(callee, args);
  }
  const readerNames = new Set();
  const readers = [];
  for (const [callee, args] of byCallee) {
    const served = [...args].filter((a) => servedNames.has(a)).length;
    if (args.size >= FLAG_READER_MIN_ARGS && served / args.size >= FLAG_READER_MIN_SERVED_SHARE) {
      readers.push(`${callee}(${args.size})`);
      readerNames.add(callee);
    }
  }
  const anchors = [];
  for (const anchor of CODE_ANCHORS) {
    for (let i = source.indexOf(anchor); i !== -1; i = source.indexOf(anchor, i + 1))
      anchors.push({ anchor, i });
  }
  const flags = new Set();
  const nearAnchors = new Map();
  for (const c of calls) {
    if (!readerNames.has(c.callee)) continue;
    flags.add(c.name);
    for (const { anchor, i } of anchors) {
      if (Math.abs(i - c.index) > ANCHOR_WINDOW) continue;
      const set = nearAnchors.get(c.name) ?? new Set();
      set.add(anchor);
      nearAnchors.set(c.name, set);
    }
  }
  return { flags, readers, nearAnchors };
}

mkdirSync(join(outDir, 'js'), { recursive: true });
let res;
let html;
let pageAttempts = 0;
while (pageAttempts < PAGE_ATTEMPTS) {
  pageAttempts++;
  res = await fetch(WATCH_URL, { headers: HEADERS });
  html = await res.text();
  if (FULL_KEVLAR_BUNDLE_RE.test(html)) break;
  console.log(
    `page load ${pageAttempts}: no full Kevlar bundle (module-set loader?), loading again`
  );
}
const fullKevlarBundle = FULL_KEVLAR_BUNDLE_RE.test(html);
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

const baselineJson = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const baseline = new Set(baselineJson.flags);
const baselineCode = new Set(baselineJson.codeFlags ?? []);
// seen-flags.json: { served: [...], code: [...] } (older runs: a plain array of served flags)
const seenJson = seenPath && existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : {};
const seen = new Set(Array.isArray(seenJson) ? seenJson : (seenJson.served ?? []));
const seenCode = new Set(Array.isArray(seenJson) ? [] : (seenJson.code ?? []));
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

const servedNames = new Set([...Object.keys(pageFlags), ...Object.keys(playerFlags)]);
const allCodeFlags = new Set();
const codeNearAnchors = new Map();
const flagReaders = [];
for (const bundle of bundles) {
  if (!bundle.file) throw new Error(`bundle not downloaded: ${bundle.url} (${bundle.error})`);
  const { flags, readers, nearAnchors } = codeFlags(readFileSync(bundle.file, 'utf8'), servedNames);
  for (const f of flags) allCodeFlags.add(f);
  for (const [name, set] of nearAnchors) {
    codeNearAnchors.set(name, new Set([...(codeNearAnchors.get(name) ?? []), ...set]));
  }
  flagReaders.push(`${bundle.file.split('/').pop()}: ${readers.join(' ') || 'none'}`);
}
if (
  !bundles.some((b) => b.url.includes('/player/')) ||
  !bundles.some((b) => b.url.includes('ytmainappweb'))
) {
  throw new Error(
    `Kevlar or player bundle not found on the page: ${bundles.map((b) => b.url).join(', ')}`
  );
}
// Relevant: the name says so, or it is checked next to code our flows go through
const codeRelevant = [...allCodeFlags]
  .filter((name) => RELEVANT_FLAG_RE.test(name) || codeNearAnchors.has(name))
  .sort();
if (codeRelevant.length < baselineCode.size * MIN_CODE_FLAGS_SHARE_OF_BASELINE) {
  throw new Error(
    `reading flags from the bundles looks broken: ${codeRelevant.length} relevant flags vs ${baselineCode.size} ` +
      `in the baseline (flag readers: ${flagReaders.join('; ')})` +
      (fullKevlarBundle
        ? ''
        : `; none of ${pageAttempts} page loads had the full Kevlar bundle (ytmainappweb.kevlar_base), only ` +
          `YouTube's module-set loader (base_module_set, m=base) whose code comes in lazy modules: if that is the rollout ` +
          `now, the scan has to fetch those modules`)
  );
}
const describeCodeFlag = (name) => ({
  name,
  why: [
    ...(RELEVANT_FLAG_RE.test(name) ? ['name'] : []),
    ...[...(codeNearAnchors.get(name) ?? [])].map((a) => `near ${a}`),
  ],
  served: servedNames.has(name),
  value: name in pageFlags ? String(pageFlags[name]) : playerFlags[name],
});
const newCodeFlags = codeRelevant
  .filter((name) => !baselineCode.has(name) && !seenCode.has(name))
  .map(describeCodeFlag);
const removedCodeFlags = [...baselineCode].filter((name) => !allCodeFlags.has(name)).sort();

const result = {
  scannedAt: new Date().toISOString(),
  url: WATCH_URL,
  pageAttempts,
  fullKevlarBundle,
  pageFlagCount: Object.keys(pageFlags).length,
  playerFlagCount: Object.keys(playerFlags).length,
  relevantFlagCount: Object.keys(relevant).length,
  codeFlagCount: allCodeFlags.size,
  codeRelevantCount: codeRelevant.length,
  flagReaders,
  newCodeFlags,
  removedCodeFlags,
  newFlags: newFlags.map((name) => ({ name, ...relevant[name] })),
  goneFlags,
  codeRelevant,
  relevant,
  bundles,
};
writeFileSync(join(outDir, 'flags.json'), JSON.stringify(result, null, 2));
if (seenPath) {
  writeFileSync(
    seenPath,
    JSON.stringify({
      served: [...new Set([...seen, ...Object.keys(relevant)])].sort(),
      code: [...new Set([...seenCode, ...codeRelevant])].sort(),
    })
  );
}
console.log(
  `code: ${allCodeFlags.size} flags checked, ${codeRelevant.length} relevant, ${newCodeFlags.length} new, ` +
    `${removedCodeFlags.length} removed (${flagReaders.join('; ')})\n` +
    `served: ${result.pageFlagCount} page, ${result.playerFlagCount} player, ${result.relevantFlagCount} relevant, ` +
    `${newFlags.length} new, ${goneFlags.length} gone from baseline`
);
