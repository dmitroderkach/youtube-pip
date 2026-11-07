/**
 * Force YouTube experiment flags in e2e (e.g. to reproduce a rollout the test account is not in).
 *
 * Set env `E2E_FORCE_EXPERIMENT_FLAGS` to a comma-separated list of flag names, e.g.
 *   E2E_FORCE_EXPERIMENT_FLAGS=kevlar_player_cow_player_component_all_contexts npx playwright test
 * Each listed flag is set to `true` in `ytcfg.data_.EXPERIMENT_FLAGS` before YouTube's scripts read it.
 */
export const FORCED_EXPERIMENT_FLAGS: string[] = (process.env.E2E_FORCE_EXPERIMENT_FLAGS ?? '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

type YtcfgLike = {
  set?: (...args: unknown[]) => unknown;
  data_?: { EXPERIMENT_FLAGS?: Record<string, unknown> };
};

/** Runs in the browser via addInitScript: wraps window.ytcfg so every ytcfg.set keeps the flags on. */
export function installForcedExperimentFlags(flags: string[]): void {
  const forced = Object.fromEntries(flags.map((f) => [f, true]));
  const patch = (cfg: YtcfgLike | undefined): void => {
    if (cfg?.data_) {
      cfg.data_.EXPERIMENT_FLAGS = { ...(cfg.data_.EXPERIMENT_FLAGS ?? {}), ...forced };
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
