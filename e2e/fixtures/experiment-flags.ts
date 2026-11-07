/**
 * Force YouTube experiment flags in e2e (e.g. to reproduce a rollout the test account is not in).
 *
 * Set env `E2E_FORCE_EXPERIMENT_FLAGS` to a comma-separated list of flag names, e.g.
 *   E2E_FORCE_EXPERIMENT_FLAGS=kevlar_player_cow_player_component_all_contexts npx playwright test
 * Each listed flag (`name` = on, `name=false` = off) is forced in `ytcfg.data_.EXPERIMENT_FLAGS` (page/Kevlar) and in every
 * `WEB_PLAYER_CONTEXT_CONFIGS[*].serializedExperimentFlags` (player) before YouTube's scripts read them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FORCED_EXPERIMENT_FLAGS: string[] = (process.env.E2E_FORCE_EXPERIMENT_FLAGS ?? '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

/** Fixture option: YouTube experiment flags to force for a test/project (see playwright.config.ts matrix). */
export type ExperimentFlagsOption = string[];

/**
 * Flag sets for the e2e matrix. Each Playwright project runs the whole suite with one set.
 * What each flag changes: docs/YOUTUBE_EXPERIMENT_FLAGS.md.
 */
export const EXPERIMENT_FLAG_SETS = {
  /** What the test account gets by default. */
  NONE: [] as string[],
  /** YouTube's own Document PiP rollout (menus/listeners live in the PiP document, minimized PiP UI). */
  YT_PIP: [
    'web_watch_pip',
    'web_shorts_pip',
    'web_pip_minimize_breakages',
    'web_watch_pip_context_menu_button',
  ],
  /** Player rendered as a CoW component (disposes on plain DOM moves). */
  COW_PLAYER: ['kevlar_player_cow_player_component_all_contexts'],
  /** Profiles without newer rollouts: no "Miniplayer" context menu item, legacy Shorts overlay renderer. */
  LEGACY_UI: [
    'web_player_miniplayer_in_context_menu=false',
    'web_migrate_reel_player_overlay_to_cow=false',
  ],
} as const satisfies Record<string, readonly string[]>;

/** Flags we chose by hand for the flows they change (docs/YOUTUBE_EXPERIMENT_FLAGS.md). */
const CURATED_ALL_FLAGS: string[] = [
  ...EXPERIMENT_FLAG_SETS.YT_PIP,
  ...EXPERIMENT_FLAG_SETS.COW_PLAYER,
  ...EXPERIMENT_FLAG_SETS.LEGACY_UI,
  'kevlar_watch_while_v2',
];

/**
 * Relevant flags in YouTube's code that chromium-all-flags does not force on, with the reason. Killswitches are
 * left out by KILLSWITCH_FLAG_RE (forcing one disables a feature, a state users only see during incidents), YouTube's
 * test switches by TESTING_FLAG_RE.
 */
export const NOT_FORCED_IN_ALL_FLAGS: Record<string, string> = {
  kevlar_watch_fixie:
    'in development (not served): ytd-watch-fixie has no working mini player activation — YouTube`s own `i` does ' +
    'nothing, so PiP from the watch page cannot work; the on-call probes it once it is served',
  html5_block_pip_safari_delay: 'number',
  html5_hard_cap_max_vertical_resolution_for_shorts: 'number',
  html5_picture_in_picture_logging_onresize_ratio: 'number',
  html5_shorts_gapless_next_buffer_in_seconds: 'number',
  web_shorts_error_logging_threshold: 'number',
};
const KILLSWITCH_FLAG_RE = /killswitch|kill_switch|(^|_)disable_/;
/** YouTube's own test / debug switches (e.g. *_for_testing replaces the watch page): never on for users. */
const TESTING_FLAG_RE = /_for_testing|(^|_)debug_/;

/**
 * Relevant boolean flags the Kevlar / player code checks (docs/experiment-flags-baseline.json `codeFlags`, kept
 * up to date by the on-call), all forced on together: a flag rolled out to a few users must not break us unseen.
 */
function readCodeFlags(): string[] {
  const path = join(process.cwd(), 'docs', 'experiment-flags-baseline.json');
  return (JSON.parse(readFileSync(path, 'utf8')) as { codeFlags: string[] }).codeFlags;
}

function codeFlagsForcedOn(): string[] {
  const codeFlags = readCodeFlags();
  const curatedNames = new Set(CURATED_ALL_FLAGS.map((f) => f.split('=')[0]));
  return codeFlags.filter(
    (name) =>
      !curatedNames.has(name) &&
      !KILLSWITCH_FLAG_RE.test(name) &&
      !TESTING_FLAG_RE.test(name) &&
      !(name in NOT_FORCED_IN_ALL_FLAGS)
  );
}

export const ALL_EXPERIMENT_FLAGS: string[] = [...CURATED_ALL_FLAGS, ...codeFlagsForcedOn()];

/**
 * Relevant killswitches in YouTube's code, all on (own project): YouTube flips one for everybody at once during an
 * incident to turn a feature off — e.g. kevlar_player_append_to_api_killswitch (ytd-player.appendTo, our player
 * moves), popup / copy-link checks — so a flipped killswitch must not break us. Not mixed with all-flags: a
 * killswitch turns off what those flags turn on.
 */
export const KILLSWITCH_EXPERIMENT_FLAGS: string[] = readCodeFlags().filter(
  (name) =>
    KILLSWITCH_FLAG_RE.test(name) &&
    !TESTING_FLAG_RE.test(name) &&
    !(name in NOT_FORCED_IN_ALL_FLAGS)
);

/**
 * Experiment matrix: every Playwright project runs the suite with one set of forced flags, so rollout-specific
 * breakages show up deterministically (docs/YOUTUBE_EXPERIMENT_FLAGS.md). Also used by like-dislike.spec.ts,
 * which runs once per set inside its own single-worker project.
 */
export const FLAG_MATRIX: { name: string; flags: string[] }[] = [
  { name: 'chromium', flags: EXPERIMENT_FLAG_SETS.NONE },
  { name: 'chromium-yt-pip', flags: [...EXPERIMENT_FLAG_SETS.YT_PIP] },
  { name: 'chromium-cow-player', flags: [...EXPERIMENT_FLAG_SETS.COW_PLAYER] },
  { name: 'chromium-legacy-ui', flags: [...EXPERIMENT_FLAG_SETS.LEGACY_UI] },
  { name: 'chromium-all-flags', flags: ALL_EXPERIMENT_FLAGS },
  { name: 'chromium-killswitches', flags: KILLSWITCH_EXPERIMENT_FLAGS },
];

type YtcfgLike = {
  set?: (...args: unknown[]) => unknown;
  data_?: {
    EXPERIMENT_FLAGS?: Record<string, unknown>;
    WEB_PLAYER_CONTEXT_CONFIGS?: Record<string, { serializedExperimentFlags?: string }>;
  };
};

/** Runs in the browser via addInitScript: wraps window.ytcfg so every ytcfg.set keeps the flags on. */
export function installForcedExperimentFlags(flags: string[]): void {
  // "name" forces the flag on; "name=false" forces it off (for flags that are on by default).
  const parsed = flags.map((f) => {
    const [name, value] = f.split('=');
    return [name.trim(), value === undefined ? true : value.trim() !== 'false'] as const;
  });
  const forced = Object.fromEntries(parsed);
  // Page-level flags (read by ytd-app / Kevlar) live in EXPERIMENT_FLAGS; the player reads its own copy from
  // each WEB_PLAYER_CONTEXT_CONFIGS entry's serializedExperimentFlags ("a=true&b=1"). Force both.
  const forcePlayerFlags = (serialized: string | undefined): string => {
    const params = new URLSearchParams(serialized ?? '');
    for (const [name, on] of parsed) params.set(name, on ? 'true' : 'false');
    return params.toString();
  };
  const patch = (cfg: YtcfgLike | undefined): void => {
    if (!cfg?.data_) return;
    cfg.data_.EXPERIMENT_FLAGS = { ...(cfg.data_.EXPERIMENT_FLAGS ?? {}), ...forced };
    for (const ctx of Object.values(cfg.data_.WEB_PLAYER_CONTEXT_CONFIGS ?? {})) {
      if (ctx && typeof ctx === 'object') {
        ctx.serializedExperimentFlags = forcePlayerFlags(ctx.serializedExperimentFlags);
      }
    }
  };
  let current: YtcfgLike | undefined;
  Object.defineProperty(window, 'ytcfg', {
    configurable: true,
    get: () => current,
    set: (value: YtcfgLike) => {
      current = value;
      const set = value?.set as
        | (((...a: unknown[]) => unknown) & { __forced?: boolean })
        | undefined;
      if (set && !set.__forced) {
        const wrapped = Object.assign(
          (...args: unknown[]) => {
            const result = set.apply(value, args);
            patch(value);
            return result;
          },
          { __forced: true }
        );
        value.set = wrapped;
      }
      patch(value);
    },
  });
}
