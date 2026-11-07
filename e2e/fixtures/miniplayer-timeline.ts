import type { Page } from '@playwright/test';

/** Max entries kept in the page (oldest dropped). */
const MAX_ENTRIES = 400;

/** Sampling interval for the player/mini player state summary (ms). */
const SAMPLE_INTERVAL_MS = 100;

declare global {
  interface Window {
    __E2E_MINIPLAYER_TIMELINE__?: string[];
  }
}

/**
 * Init script: records a timeline of mini player / player state, printed on test failure (see
 * miniplayerTimelineOnFailure in ./index.ts). Records sampled state changes, mini player related yt-action events,
 * navigations, the watch-while IntersectionObserver callbacks and the stack of every mini player setActive() (so
 * the caller of a deactivate() is visible). Found the kevlar_watch_while_v2 stale-job deactivation
 * (docs/E2E_TESTS.md). Must be self-contained (runs in the page).
 */
export function installMiniplayerTimeline(limits: { maxEntries: number; sampleMs: number }): void {
  if (window.top !== window) return;
  const t0 = performance.now();
  const log: string[] = [];
  window.__E2E_MINIPLAYER_TIMELINE__ = log;
  const push = (msg: string) => {
    log.push(`${Math.round(performance.now() - t0)}ms ${msg}`);
    if (log.length > limits.maxEntries) log.shift();
  };

  interface PlayerApi extends HTMLElement {
    getPlayerState?(): number;
  }
  const summary = (): string => {
    const app = document.querySelector('ytd-app') as
      | (HTMLElement & { miniplayerIsActive?: boolean })
      | null;
    const mini = document.querySelector('ytd-miniplayer');
    const player = document.querySelector<PlayerApi>('#movie_player');
    const where = !player
      ? 'none'
      : player.closest('ytd-miniplayer-player-container')
        ? 'mini-container'
        : player.closest('ytd-miniplayer')
          ? 'mini'
          : 'page';
    let state = '?';
    try {
      state = String(player?.getPlayerState?.());
    } catch {
      /* player API not ready */
    }
    const pip = window.documentPictureInPicture?.window;
    return [
      `url=${location.pathname}`,
      `mini=${mini ? (mini.className.includes('ComponentVisible') ? 'visible' : 'hidden') : 'none'}`,
      `active=${app?.miniplayerIsActive}`,
      `player=${where}`,
      `ad=${!!player?.classList.contains('ad-showing')}`,
      `state=${state}`,
      `pip=${pip ? (pip.document.querySelector('#movie_player') ? 'player' : 'empty') : 'none'}`,
    ].join(' ');
  };

  // Deep stack: YouTube's generator wrapper adds ~8 frames between deactivate() and its caller
  const STACK_FRAMES = 40;
  const stackOf = () => {
    const prevLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = STACK_FRAMES + 2;
    const stack = new Error().stack ?? '';
    Error.stackTraceLimit = prevLimit;
    return (
      stack
        .split('\n')
        .slice(2)
        // Drop the event-dispatch and generator-runner frames; keep YouTube's named functions
        .filter((l) => !/at (?:new Promise|<anonymous>:)/.test(l))
        // Keep function name + line; YouTube's bundle URLs are hundreds of characters long
        .map((l) => `      ${l.trim().replace(/\(?https?:\/\/[^)\s]*?:(\d+):\d+\)?/, ':$1')}`)
        .join('\n')
    );
  };

  let last = '';
  setInterval(() => {
    const s = summary();
    if (s !== last) {
      last = s;
      push(s);
    }
  }, limits.sampleMs);

  window.addEventListener(
    'yt-action',
    (e) => {
      const name = (e as CustomEvent<{ actionName?: string }>).detail?.actionName ?? '';
      if (/miniplayer|pip|picture/i.test(name)) push(`yt-action ${name}`);
      // Mini player setActive(true/false) dispatches this synchronously, so its stack shows who (de)activated it.
      if (name === 'yt-close-popup-action')
        push(`yt-action ${name} (mini player setActive)\n${stackOf()}`);
    },
    true
  );
  for (const type of ['yt-navigate-start', 'yt-navigate-finish']) {
    window.addEventListener(type, () => push(type), true);
  }

  const OrigIO = window.IntersectionObserver;
  window.IntersectionObserver = class extends OrigIO {
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      super((entries, obs) => {
        const e = entries[entries.length - 1];
        const target = e?.target as HTMLElement | undefined;
        if (target?.closest?.('ytd-watch-flexy') && /player/.test(target.id)) {
          push(`watch IO #${target.id} ratio=${e.intersectionRatio.toFixed(2)} | ${summary()}`);
        }
        cb(entries, obs);
      }, opts);
    }
  };
}

export const MINIPLAYER_TIMELINE_LIMITS = { maxEntries: MAX_ENTRIES, sampleMs: SAMPLE_INTERVAL_MS };

export async function readMiniplayerTimeline(page: Page): Promise<string> {
  return page
    .evaluate(() => (window.__E2E_MINIPLAYER_TIMELINE__ ?? []).join('\n'))
    .catch((e: unknown) => `timeline unavailable: ${String(e)}`);
}
