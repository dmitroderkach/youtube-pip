import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { ContextMenuHandler, type ContextMenuVisibilityCallback } from '../ContextMenuHandler';
import { PlayerManager } from '../../core/PlayerManager';
import { YtdAppProvider } from '../../core/YtdAppProvider';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { COPY_MENU_INDICES, UI_CLASSES } from '../../constants';
import { SELECTORS } from '../../selectors';
import {
  buildVideoUrlPayload,
  buildUrlAtTimePayload,
  buildEmbedPayload,
} from '../../utils/copyPayload';

/** Sample embed size for tests (not used in app code) */
const EMBED_SAMPLE = { WIDTH: 640, HEIGHT: 360 } as const;
/** Current time in seconds used in "URL at time" copy tests */
const CURRENT_TIME_SEC = 30;

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    waitForElementSelector: vi.fn(),
    createPlaceholder: vi.fn(() => document.createComment('placeholder')),
    insertPlaceholderBefore: vi.fn(),
    restoreElementFromPlaceholder: vi.fn(),
    copyViaTextarea: vi.fn().mockReturnValue(true),
  },
}));

describe('ContextMenuHandler', () => {
  let handler: ContextMenuHandler;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;
  let mockPipProvider: MockProxy<PipWindowProvider>;

  beforeEach(() => {
    mockPlayerManager = mock<PlayerManager>();
    mockYtdAppProvider = mock<YtdAppProvider>();
    mockPipProvider = mock<PipWindowProvider>();

    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    handler = c.get(ContextMenuHandler);
  });

  it('subscribeContextMenu returns unsubscribe that removes callback', () => {
    const cb: ContextMenuVisibilityCallback = vi.fn();
    const unsubscribe = handler.subscribeContextMenu(cb);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(cb).not.toHaveBeenCalled();
  });

  it('stop when not initialized does not throw', () => {
    expect(() => handler.stop()).not.toThrow();
  });

  it('initialize sets pipWindow and can be followed by stop', async () => {
    const pipWindow = { document: document.implementation.createHTMLDocument() } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    const menuEl = document.createElement('div');
    menuEl.style.display = 'none';
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl);
    await handler.initialize();
    expect(() => handler.stop()).not.toThrow();
  });

  it('initialize catch path when waitForElementSelector rejects', async () => {
    const pipWindow = { document: document.implementation.createHTMLDocument() } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValue(new Error('timeout'));
    await handler.initialize();
    expect(() => handler.stop()).not.toThrow();
  });

  it('initialize with visible menu calls notifyVisibility(true) and subscriber is notified', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    menuEl.style.display = 'block';
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    const cb: ContextMenuVisibilityCallback = vi.fn();
    handler.subscribeContextMenu(cb);
    await handler.initialize();
    expect(cb).toHaveBeenCalledWith(true);
    handler.stop();
  });

  it('copy click on VIDEO_URL item copies video url', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({
      video_id: 'vid1',
      title: 'T',
      list: undefined,
    });
    mockPlayerManager.getCurrentTime.mockReturnValue(0);
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    const videoUrlItem = items[COPY_MENU_INDICES.VIDEO_URL];
    videoUrlItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalledWith(
      pipDoc,
      buildVideoUrlPayload('vid1', null)
    );
    handler.stop();
  });

  it('copy click on URL_AT_TIME item copies url with time', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({ video_id: 'v2', title: 'T', list: undefined });
    mockPlayerManager.getCurrentTime.mockReturnValue(CURRENT_TIME_SEC);
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    const item = items[COPY_MENU_INDICES.URL_AT_TIME];
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalledWith(
      pipDoc,
      buildUrlAtTimePayload('v2', null, CURRENT_TIME_SEC)
    );
    handler.stop();
  });

  it('copy click on EMBED item copies embed iframe', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({
      video_id: 'emb1',
      title: 'Title',
      list: undefined,
    });
    mockPlayerManager.getCurrentTime.mockReturnValue(0);
    mockPlayerManager.getPlayerSize.mockReturnValue({
      width: EMBED_SAMPLE.WIDTH,
      height: EMBED_SAMPLE.HEIGHT,
    });
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.EMBED].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalledWith(
      pipDoc,
      buildEmbedPayload('emb1', null, 'Title', {
        width: EMBED_SAMPLE.WIDTH,
        height: EMBED_SAMPLE.HEIGHT,
      })
    );
    handler.stop();
  });

  it('copy click on EMBED item with playlistId includes list in embed src', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({
      video_id: 'v2',
      title: 'T2',
      list: 'PL456',
    });
    mockPlayerManager.getCurrentTime.mockReturnValue(0);
    mockPlayerManager.getPlayerSize.mockReturnValue({
      width: EMBED_SAMPLE.WIDTH,
      height: EMBED_SAMPLE.HEIGHT,
    });
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.EMBED].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenLastCalledWith(
      pipDoc,
      buildEmbedPayload('v2', 'PL456', 'T2', {
        width: EMBED_SAMPLE.WIDTH,
        height: EMBED_SAMPLE.HEIGHT,
      })
    );
    handler.stop();
  });

  it('copy click on DEBUG_INFO item copies getDebugInfo', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getDebugInfo.mockReturnValue('debug output');
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.DEBUG_INFO].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalledWith(pipDoc, 'debug output');
    handler.stop();
  });

  it('copy click on VIDEO_URL when videoId missing does not copy', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.copyViaTextarea).mockClear();
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue(null);
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.VIDEO_URL].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).not.toHaveBeenCalled();
    handler.stop();
  });

  it('copy click on DEBUG_INFO when getDebugInfo empty does not copy', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.copyViaTextarea).mockClear();
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getDebugInfo.mockReturnValue('');
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.DEBUG_INFO].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).not.toHaveBeenCalled();
    handler.stop();
  });

  it('mutation observer when menu closed in pip restores to main', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    menuEl.style.display = 'block';
    pipDoc.body.appendChild(menuEl);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation(
      (element: Node, placeholder: Comment) => {
        element.parentNode?.insertBefore(placeholder, element);
        return true;
      }
    );
    await handler.initialize();
    menuEl.style.display = 'none';
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(DOMUtils.restoreElementFromPlaceholder).toHaveBeenCalled();
    handler.stop();
  });

  it('copy with playlistId includes list in payload', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.copyViaTextarea).mockClear();
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({ video_id: 'v', title: 'T', list: 'PL123' });
    mockPlayerManager.getCurrentTime.mockReturnValue(0);
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.VIDEO_URL].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalledWith(
      pipDoc,
      buildVideoUrlPayload('v', 'PL123')
    );
    handler.stop();
  });

  it('copy when copyViaTextarea returns false does not throw', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.copyViaTextarea).mockReturnValue(false);
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    mockPlayerManager.getVideoData.mockReturnValue({ video_id: 'v', title: 'T', list: undefined });
    mockPlayerManager.getCurrentTime.mockReturnValue(0);
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[COPY_MENU_INDICES.VIDEO_URL].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).toHaveBeenCalled();
    handler.stop();
  });

  it('copy click on non-panel menuitem does nothing (index -1)', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const otherContainer = pipDoc.createElement('div');
    const orphanItem = pipDoc.createElement('div');
    orphanItem.className = UI_CLASSES.MENU_ITEM;
    otherContainer.appendChild(orphanItem);
    pipDoc.body.appendChild(otherContainer);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    vi.mocked(DOMUtils.copyViaTextarea).mockClear();
    await handler.initialize();
    orphanItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).not.toHaveBeenCalled();
    handler.stop();
  });

  it('copy click on panel item that is not a copy action does nothing', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const panelMenu = pipDoc.createElement('div');
    panelMenu.className = UI_CLASSES.PANEL_MENU;
    for (let i = 0; i < 6; i++) {
      const item = pipDoc.createElement('div');
      item.className = UI_CLASSES.MENU_ITEM;
      panelMenu.appendChild(item);
    }
    pipDoc.body.appendChild(panelMenu);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    pipDoc.body.appendChild(menuEl);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    vi.mocked(DOMUtils.copyViaTextarea).mockClear();
    await handler.initialize();
    const items = pipDoc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    items[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(DOMUtils.copyViaTextarea).not.toHaveBeenCalled();
    handler.stop();
  });

  it('click inside context menu container does not dismiss menu', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const container = pipDoc.createElement('div');
    container.className = UI_CLASSES.CONTEXT_MENU_CONTAINER;
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    menuEl.style.display = 'block';
    container.appendChild(menuEl);
    pipDoc.body.appendChild(container);
    const cb: ContextMenuVisibilityCallback = vi.fn();
    handler.subscribeContextMenu(cb);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    await handler.initialize();
    menuEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menuEl.style.display).toBe('block');
    expect(cb).not.toHaveBeenLastCalledWith(false);
    handler.stop();
  });

  it('click outside context menu dismisses it and notifies visibility false', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = `${UI_CLASSES.CONTEXT_MENU} ${UI_CLASSES.CONTEXT_MENU_CONTAINER}`;
    menuEl.style.display = 'block';
    pipDoc.body.appendChild(menuEl);
    const outside = pipDoc.createElement('div');
    pipDoc.body.appendChild(outside);
    const cb: ContextMenuVisibilityCallback = vi.fn();
    handler.subscribeContextMenu(cb);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    await handler.initialize();
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menuEl.style.display).toBe('none');
    expect(cb).toHaveBeenLastCalledWith(false);
    handler.stop();
  });

  it('when menu closes in pip and placeholder has no parent does not call restore', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    menuEl.style.display = 'block';
    pipDoc.body.appendChild(menuEl);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.restoreElementFromPlaceholder).mockClear();
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    vi.mocked(DOMUtils.createPlaceholder).mockReturnValue(null as never);
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation(
      (element: Node, placeholder: Comment) => {
        if (placeholder) element.parentNode?.insertBefore(placeholder, element);
        return true;
      }
    );
    await handler.initialize();
    menuEl.setAttribute('style', 'display: none');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(DOMUtils.restoreElementFromPlaceholder).not.toHaveBeenCalled();
    handler.stop();
    expect(DOMUtils.restoreElementFromPlaceholder).not.toHaveBeenCalled();
    vi.mocked(DOMUtils.createPlaceholder).mockReturnValue(
      document.createComment('placeholder') as never
    );
  });

  it('stop when menu was in pip calls restoreElementFromPlaceholder', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const menuEl = pipDoc.createElement('div');
    menuEl.className = UI_CLASSES.CONTEXT_MENU;
    menuEl.style.display = 'block';
    pipDoc.body.appendChild(menuEl);
    mockYtdAppProvider.getApp.mockReturnValue(document.body as never);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(menuEl as never);
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation(
      (element: Node, placeholder: Comment) => {
        element.parentNode?.insertBefore(placeholder, element);
        return true;
      }
    );
    await handler.initialize();
    handler.stop();
    expect(DOMUtils.restoreElementFromPlaceholder).toHaveBeenCalled();
  });
});
