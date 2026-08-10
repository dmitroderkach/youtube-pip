import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createPipShortsWindowHandlersMocks } from './__mocks__/PipShortsWindowHandlers.mock';
import { PipShortsWindowHandlers } from '../PipShortsWindowHandlers';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';
import { PiPEventBridgeHandler } from '../../handlers/PiPEventBridgeHandler';
import { PiPLinkFocusHandler } from '../../handlers/PiPLinkFocusHandler';
import { DocumentFocusHandler } from '../../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../../handlers/TitleSyncHandler';

describe('PipShortsWindowHandlers', () => {
  let handlers: PipShortsWindowHandlers;
  let mocks: ReturnType<typeof createPipShortsWindowHandlersMocks>;

  beforeEach(() => {
    mocks = createPipShortsWindowHandlersMocks();
    const c = createTestContainer();
    c.bind(ContextMenuHandler).toInstance(mocks.contextMenuHandler);
    c.bind(PiPEventBridgeHandler).toInstance(mocks.pipEventBridgeHandler);
    c.bind(PiPLinkFocusHandler).toInstance(mocks.pipLinkFocusHandler);
    c.bind(DocumentFocusHandler).toInstance(mocks.documentFocusHandler);
    c.bind(TitleSyncHandler).toInstance(mocks.titleSyncHandler);
    c.bind(PipShortsWindowHandlers).toSelf();
    handlers = c.get(PipShortsWindowHandlers);
  });

  it('initialize calls initialize on all handlers and returns cleanup that calls stop/cleanup', async () => {
    const cleanup = await handlers.initialize();

    expect(mocks.contextMenuHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.pipEventBridgeHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.pipLinkFocusHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.documentFocusHandler.initialize).toHaveBeenCalledOnce();
    expect(mocks.titleSyncHandler.initialize).toHaveBeenCalledWith(true);

    expect(typeof cleanup).toBe('function');
    void cleanup();

    expect(mocks.contextMenuHandler.stop).toHaveBeenCalledOnce();
    expect(mocks.pipEventBridgeHandler.stop).toHaveBeenCalledOnce();
    expect(mocks.pipLinkFocusHandler.stop).toHaveBeenCalledOnce();
    expect(mocks.documentFocusHandler.cleanup).toHaveBeenCalledOnce();
    expect(mocks.titleSyncHandler.cleanup).toHaveBeenCalledOnce();
  });
});
