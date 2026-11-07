/**
 * Force YouTube experiment flags in e2e (e.g. to reproduce a rollout the test account is not in).
 *
 * Set env `E2E_FORCE_EXPERIMENT_FLAGS` to a comma-separated list of flag names, e.g.
 *   E2E_FORCE_EXPERIMENT_FLAGS=kevlar_player_cow_player_component_all_contexts npx playwright test
 * Each listed flag (`name` = on, `name=false` = off) is forced in `ytcfg.data_.EXPERIMENT_FLAGS` (page/Kevlar) and in every
 * `WEB_PLAYER_CONTEXT_CONFIGS[*].serializedExperimentFlags` (player) before YouTube's scripts read them.
 */
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

export const ALL_EXPERIMENT_FLAGS: string[] = [
  ...EXPERIMENT_FLAG_SETS.YT_PIP,
  ...EXPERIMENT_FLAG_SETS.COW_PLAYER,
  ...EXPERIMENT_FLAG_SETS.LEGACY_UI,
  'kevlar_watch_while_v2',
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
