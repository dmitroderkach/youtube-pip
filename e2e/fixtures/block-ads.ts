/**
 * E2E: no ads, for specs where an ad only gets in the way (copy, keyboard). Removes the ad fields from YouTube's
 * player responses before YouTube reads them — the same approach as ad blockers' "json-prune": the inline
 * `ytInitialPlayerResponse` and JSON parsed from /youtubei responses (SPA navigations). Other specs keep ads:
 * the load ads put on the page is part of what the suite checks (e.g. the watch-while race in ADR §18).
 *
 * Unskippable ads cannot be ended from the page (seeking the ad video does not end it), so waiting them out made
 * those specs slow and flaky.
 */
export type BlockAdsOption = boolean;

/** Init script (self-contained, runs in the page). */
export function installAdBlock(): void {
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      value.forEach(prune);
    } else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of AD_KEYS) delete obj[key];
      if (obj.playerResponse) prune(obj.playerResponse);
    }
    return value;
  };

  const originalParse = JSON.parse;
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) =>
    prune(originalParse.apply(JSON, args))) as typeof JSON.parse;

  const originalJson = Response.prototype.json;
  Response.prototype.json = function (this: Response) {
    return originalJson.call(this).then(prune);
  };

  let initial: unknown;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    get: () => initial,
    set: (value: unknown) => {
      initial = prune(value);
    },
  });
}
