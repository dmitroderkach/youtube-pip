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
 * Init script: records a timeline of mini player / player state so CI flakes where YouTube drops the mini player
 * (visible for ~100 ms, player never moved into it) show what happened around it. Records state changes (sampled),
 * mini player related yt-action events, navigations and the watch-while IntersectionObserver callbacks
 * (kevlar_watch_while_v2 deactivates the mini player from them). Must be self-contained (runs in the page).
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
