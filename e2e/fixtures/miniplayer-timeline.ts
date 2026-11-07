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

  // Who deactivates the mini player: wrap the ytd-watch-flexy methods that can do it (updatePlayerLocation →
  // deactivateMiniplayerAndResetPlayer with web_watch_pip / kevlar_watch_while_v2) and log every player state
  // change (watch-while mode deactivates on ENDED). Method names survive YouTube's minification.
  const argText = (x: unknown): string => {
    try {
      return JSON.stringify(x) ?? String(x);
    } catch {
      return typeof x;
    }
  };
  // Kevlar keeps element methods on a controller (element.polymerController), not on the element class.
  const wrapMethods = (tag: string, names: string[], withStack: string[]) => {
    const wait = setInterval(() => {
      const el = document.querySelector(tag) as (Element & { polymerController?: object }) | null;
      const target = el?.polymerController ?? null;
      if (!target) return;
      clearInterval(wait);
      for (const name of names) {
        let proto: object | null = target;
        while (proto && !Object.prototype.hasOwnProperty.call(proto, name)) {
          proto = Object.getPrototypeOf(proto);
        }
        const orig = proto && (proto as Record<string, unknown>)[name];
        if (!proto || typeof orig !== 'function') {
          push(`hook: ${tag}.${name} not found`);
          continue;
        }
        const wrapped = function (this: unknown, ...args: unknown[]) {
          push(
            `${tag}.${name}(${args.map(argText).join(', ').slice(0, 80)}) | ${summary()}${
              withStack.includes(name) ? `\n${stackOf()}` : ''
            }`
          );
          return (orig as (...a: unknown[]) => unknown).apply(this, args);
        };
        try {
          Object.defineProperty(proto, name, {
            value: wrapped,
            configurable: true,
            writable: true,
          });
          push(`hook: ${tag}.${name} wrapped`);
        } catch (e) {
          push(`hook: ${tag}.${name} not wrapped: ${String(e)}`);
        }
      }
    }, 20);
  };
  wrapMethods(
    'ytd-watch-flexy',
    [
      'deactivateMiniplayerAndResetPlayer',
      'updatePlayerLocation',
      'isTwoColumnsChanged_',
      'onTheaterReduxValueUpdate',
      'onFullscreenReduxValueUpdate',
    ],
    ['deactivateMiniplayerAndResetPlayer', 'updatePlayerLocation']
  );

  const stateHooked = new WeakSet<Element>();
  setInterval(() => {
    const player = document.querySelector('#movie_player') as
      | (HTMLElement & { addEventListener(type: 'onStateChange', cb: (s: number) => void): void })
      | null;
    if (!player || stateHooked.has(player)) return;
    stateHooked.add(player);
    try {
      player.addEventListener('onStateChange', (state: number) =>
        push(`player onStateChange ${state}`)
      );
    } catch {
      stateHooked.delete(player);
    }
  }, 50);

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
