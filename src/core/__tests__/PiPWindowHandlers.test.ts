import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createPiPWindowHandlersMocks } from './__mocks__/PiPWindowHandlers.mock';
import { PiPWindowHandlers } from '../PiPWindowHandlers';
import { ResizeTracker } from '../../ui/ResizeTracker';
import { MenuObserver } from '../../ui/MenuObserver';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';
import { SeekHandler } from '../../handlers/SeekHandler';
import { PiPEventBridgeHandler } from '../../handlers/PiPEventBridgeHandler';
import { NavigationHandler } from '../NavigationHandler';
import { DocumentFocusHandler } from '../../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../../handlers/TitleSyncHandler';
import { PiPHotkeyHandler } from '../../handlers/PiPHotkeyHandler';

describe('PiPWindowHandlers', () => {
  let handlers: PiPWindowHandlers;
  let mocks: ReturnType<typeof createPiPWindowHandlersMocks>;

  beforeEach(() => {
    mocks = createPiPWindowHandlersMocks();
    const c = createTestContainer();
    c.bind(ResizeTracker).toInstance(mocks.resizeTracker);
    c.bind(MenuObserver).toInstance(mocks.menuObserver);
    c.bind(ContextMenuHandler).toInstance(mocks.contextMenuHandler);
    c.bind(SeekHandler).toInstance(mocks.seekHandler);
    c.bind(PiPEventBridgeHandler).toInstance(mocks.pipEventBridgeHandler);
    c.bind(NavigationHandler).toInstance(mocks.navigationHandler);
    c.bind(DocumentFocusHandler).toInstance(mocks.documentFocusHandler);
    c.bind(TitleSyncHandler).toInstance(mocks.titleSyncHandler);
    c.bind(PiPHotkeyHandler).toInstance(mocks.pipHotkeyHandler);
    c.bind(PiPWindowHandlers).toSelf();
    handlers = c.get(PiPWindowHandlers);
  });

  it('initialize calls initialize on navigation, seek, event bridge, contextMenu, documentFocus, titleSync and start on resize, menuObserver', async () => {
    const miniplayer = document.createElement('div');
    const cleanup = await handlers.initialize(miniplayer);

    expect(mocks.navigationHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.resizeTracker.start).toHaveBeenCalledWith(miniplayer);
    expect(mocks.menuObserver.start).toHaveBeenCalledOnce();
    expect(mocks.contextMenuHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.seekHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.pipEventBridgeHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.documentFocusHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.titleSyncHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.pipHotkeyHandler.initialize).toHaveBeenCalledOnce();

    expect(typeof cleanup).toBe('function');
  });

  it('cleanup callback calls cleanup/stop on all handlers in reverse order', async () => {
    const miniplayer = document.createElement('div');
    const cleanup = await handlers.initialize(miniplayer);
    expect(typeof cleanup).toBe('function');

    void cleanup();

    expect(mocks.titleSyncHandler.stopSync).toHaveBeenCalledOnce();

    expect(mocks.pipHotkeyHandler.cleanup).toHaveBeenCalledOnce();
    expect(mocks.titleSyncHandler.cleanup).not.toHaveBeenCalled();
    expect(mocks.documentFocusHandler.cleanup).toHaveBeenCalledOnce();
    expect(mocks.seekHandler.cleanup).toHaveBeenCalledOnce();
    expect(mocks.pipEventBridgeHandler.stop).toHaveBeenCalledOnce();
    expect(mocks.contextMenuHandler.stop).toHaveBeenCalledOnce();
    expect(mocks.menuObserver.stop).toHaveBeenCalledOnce();
    expect(mocks.resizeTracker.stop).toHaveBeenCalledOnce();
    expect(mocks.navigationHandler.cleanup).toHaveBeenCalledOnce();
  });
});
