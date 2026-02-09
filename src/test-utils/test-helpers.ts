import type {
  YouTubePlayer,
  YouTubeAppElement,
  NotificationTopbarButtonRenderer,
} from '../types/youtube';

/**
 * Typed helpers for test mocks. Use instead of inline `as unknown as Type` assertions.
 */

/**
 * Creates a fake Window object for tests. Use when mocking PiP or document window.
 */
export function createFakeWindow(partial: Partial<Window> & { document: Document }): Window {
  return {
    closed: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    ...partial,
  } as Window;
}

/**
 * Creates a fake MouseEvent for tests. Use when simulating click handlers.
 */
export function createFakeMouseEvent(
  partial: Partial<MouseEvent> & { target: EventTarget }
): MouseEvent {
  const { target, ...rest } = partial;
  return { target, currentTarget: null, ...rest } as MouseEvent;
}

/**
 * Creates a fake YouTubePlayer for tests. Use when mocking PlayerManager.getPlayer().
 */
export function createFakePlayer(partial: Partial<YouTubePlayer>): YouTubePlayer {
  const el = document.createElement('div');
  Object.assign(el, partial);
  return el as YouTubePlayer;
}

/**
 * Creates a fake YouTubeAppElement for tests. Use when mocking YtdAppProvider.getApp().
 */
export function createFakeYtdApp(partial: Partial<YouTubeAppElement>): YouTubeAppElement {
  const el = document.createElement('ytd-app') as YouTubeAppElement;
  Object.assign(el, { miniplayerIsActive: false, ...partial });
  return el;
}

/**
 * Creates a fake YouTubeAppElement with fire mock. Accepts vi.fn() without type cast.
 */
export function createFakeYtdAppWithFire(
  fire: unknown,
  miniplayerIsActive = false
): YouTubeAppElement {
  return createFakeYtdApp({
    fire: fire as YouTubeAppElement['fire'],
    miniplayerIsActive,
  });
}

/**
 * Creates a fake YouTubeAppElement with resolveCommand mock. Accepts vi.fn() without type cast.
 */
export function createFakeYtdAppWithResolveCommand(resolveCommand: unknown): YouTubeAppElement {
  return createFakeYtdApp({
    resolveCommand: resolveCommand as YouTubeAppElement['resolveCommand'],
  });
}

/**
 * Creates a fake NotificationTopbarButtonRenderer for getNotifyRenderer mock.
 */
export function createFakeNotifyRenderer(
  partial: Partial<NotificationTopbarButtonRenderer>
): NotificationTopbarButtonRenderer {
  const el = document.createElement('div') as NotificationTopbarButtonRenderer;
  Object.assign(el, partial);
  return el;
}

/**
 * Creates a fake ResizeObserverEntry for tests. Use when simulating resize callbacks.
 */
export function createFakeResizeObserverEntry(
  partial: Partial<ResizeObserverEntry> & { target: Element }
): ResizeObserverEntry {
  const { target, contentRect, ...rest } = partial;
  return {
    contentRect: contentRect ?? ({ width: 0, height: 0 } as DOMRectReadOnly),
    target,
    ...rest,
  } as ResizeObserverEntry;
}
