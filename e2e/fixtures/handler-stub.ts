/**
 * E2E handler stub: runs in browser via addInitScript, exposes __E2E_PIP__.trigger/has.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(process.cwd());
const scriptPath = join(projectRoot, 'dist/userscript.js');

/** Handler stub: collects mediaSession.setActionHandler, exposes __E2E_PIP__.trigger/has. Runs in browser. */
export function initHandlerStub(userscriptBody: string): void {
  function installE2EHandlerStub(): {
    trigger: (action: string) => Promise<void>;
    has: (action: string) => boolean;
    ready: () => boolean;
  } {
    const handlers: Record<string, () => void | Promise<void>> = {};
    let stubSetter: unknown = null;
    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaSession &&
      typeof navigator.mediaSession.setActionHandler === 'function'
    ) {
      const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = function (action: string, handler: unknown) {
        if (typeof action === 'string' && typeof handler === 'function')
          handlers[action] = handler as () => void | Promise<void>;
        return original(
          action as ExtendedMediaSessionAction,
          handler as MediaSessionActionHandler | null
        );
      };
      stubSetter = navigator.mediaSession.setActionHandler;
    }
    const api = {
      trigger(action: string): Promise<void> {
        const fn = handlers[action];
        if (typeof fn !== 'function')
          return Promise.reject(new Error('No handler registered for action: ' + action));
        try {
          return Promise.resolve(fn() as Promise<void>);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      has(action: string): boolean {
        return typeof handlers[action] === 'function';
      },
      /**
       * The userscript is ready: it registered its handler and then replaced setActionHandler with its guard
       * (MediaSessionHandler). Only after that is the stored enterpictureinpicture handler guaranteed to be ours:
       * with web_watch_pip / web_shorts_pip YouTube registers its own handler first, which `has` alone accepts.
       */
      ready(): boolean {
        return (
          typeof handlers.enterpictureinpicture === 'function' &&
          stubSetter !== null &&
          navigator.mediaSession.setActionHandler !== stubSetter
        );
      },
    };
    if (typeof globalThis !== 'undefined')
      (globalThis as unknown as { __E2E_PIP__: typeof api }).__E2E_PIP__ = api;
    return api;
  }
  installE2EHandlerStub();
  eval(userscriptBody);
}

/** Userscript body (without header). Requires build. */
export function getUserscriptBody(): string {
  if (!existsSync(scriptPath)) {
    throw new Error('Run "npm run build" first. dist/userscript.js not found.');
  }
  const raw = readFileSync(scriptPath, 'utf8');
  return raw.replace(/^[\s\S]*?\/\/ ==\/UserScript==\s*\n?/m, '');
}
