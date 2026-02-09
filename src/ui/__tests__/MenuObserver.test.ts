import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { createMenuObserverMocks } from './__mocks__/MenuObserver.mock';
import { MenuObserver } from '../MenuObserver';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { DEFAULT_DIMENSIONS, UI_CLASSES } from '../../constants';

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    waitForElementSelector: vi.fn(),
  },
}));

describe('MenuObserver', () => {
  let observer: MenuObserver;
  let mocks: ReturnType<typeof createMenuObserverMocks>;

  beforeEach(async () => {
    mocks = createMenuObserverMocks();
    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mocks.pipWindowProvider);
    observer = c.get(MenuObserver);
  });

  it('start when pip window is null does not throw', async () => {
    mocks.pipWindowProvider.getWindow.mockReturnValue(null);
    await expect(observer.start()).resolves.toBeUndefined();
  });

  it('start when pip window closed skips observation', async () => {
    const pipWindow = createFakeWindow({
      document: document.implementation.createHTMLDocument(),
      closed: true,
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    await observer.start();
    // runObservation returns early when pipWindow.closed
    expect(observer.stop()).toBeUndefined();
  });

  it('start waits for button then stop disconnects observers', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);

    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);

    await observer.start();
    observer.stop();
    expect(observer.stop()).toBeUndefined();
  });

  it('start when waitForElementSelector rejects does not throw', async () => {
    const pipWindow = createFakeWindow({
      document: document.implementation.createHTMLDocument(),
      closed: false,
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValue(new Error('timeout'));
    await expect(observer.start()).resolves.toBeUndefined();
  });

  it('start when button found observes aria-expanded and expands window when opened', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const resizeTo = vi.fn();
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo,
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.setAttribute('aria-expanded', 'true');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(resizeTo).toHaveBeenCalledWith(
      DEFAULT_DIMENSIONS.PIP_WIDTH,
      DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT
    );
    observer.stop();
  });

  it('when aria-expanded true and playlist panel exists shows panel', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.className = UI_CLASSES.BUTTON_SHAPE;
    button.setAttribute('aria-expanded', 'false');
    const panel = pipDoc.createElement('div');
    panel.className = UI_CLASSES.PLAYLIST_PANEL;
    panel.style.display = 'none';
    pipDoc.body.appendChild(button);
    pipDoc.body.appendChild(panel);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.setAttribute('aria-expanded', 'true');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(panel.style.display).toBe('block');
    observer.stop();
  });

  it('when aria-expanded true and window already tall does not call resizeTo', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const resizeTo = vi.fn();
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo,
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.setAttribute('aria-expanded', 'true');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(resizeTo).not.toHaveBeenCalled();
    observer.stop();
  });

  it('when aria-expanded goes back to false hides playlist panel', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.className = UI_CLASSES.BUTTON_SHAPE;
    button.setAttribute('aria-expanded', 'true');
    const panel = pipDoc.createElement('div');
    panel.className = UI_CLASSES.PLAYLIST_PANEL;
    panel.style.display = 'block';
    pipDoc.body.appendChild(button);
    pipDoc.body.appendChild(panel);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.setAttribute('aria-expanded', 'false');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(panel.style.display).toBe('none');
    observer.stop();
  });

  it('when aria-expanded false and no playlist panel does not crash', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'true');
    pipDoc.body.appendChild(button);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.setAttribute('aria-expanded', 'false');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    observer.stop();
  });

  it('when body child mutates but button still connected does not re-run', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    pipDoc.body.appendChild(pipDoc.createElement('div'));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    observer.stop();
  });

  it('when mutation attributeName is not aria-expanded skips handler', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    let mainObserverCb: (mutations: MutationRecord[]) => void = () => {};
    let observerCount = 0;
    const OrigObserver = globalThis.MutationObserver;
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(cb: (mutations: MutationRecord[]) => void) {
          observerCount++;
          if (observerCount === 1) mainObserverCb = cb;
        }
      }
    );
    await observer.start();
    mainObserverCb([{ attributeName: 'class', attributeNamespace: null } as MutationRecord]);
    vi.stubGlobal('MutationObserver', OrigObserver);
    expect(pipWindow.resizeTo).not.toHaveBeenCalled();
    observer.stop();
  });

  it('when button removed from DOM re-runs observation', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const button = pipDoc.createElement('button');
    button.className = UI_CLASSES.BUTTON_SHAPE;
    button.setAttribute('aria-expanded', 'false');
    pipDoc.body.appendChild(button);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      closed: false,
      outerHeight: DEFAULT_DIMENSIONS.PIP_HEIGHT,
      outerWidth: DEFAULT_DIMENSIONS.PIP_WIDTH,
      resizeTo: vi.fn(),
    });
    mocks.pipWindowProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(button);
    await observer.start();
    button.remove();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    observer.stop();
  });
});
