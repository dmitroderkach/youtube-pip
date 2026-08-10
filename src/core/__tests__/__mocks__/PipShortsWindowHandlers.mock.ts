import { mock, type MockProxy } from 'vitest-mock-extended';
import { ContextMenuHandler } from '../../../ui/ContextMenuHandler';
import { PiPEventBridgeHandler } from '../../../handlers/PiPEventBridgeHandler';
import { PiPLinkFocusHandler } from '../../../handlers/PiPLinkFocusHandler';
import { DocumentFocusHandler } from '../../../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../../../handlers/TitleSyncHandler';

export interface PipShortsWindowHandlersMocks {
  contextMenuHandler: MockProxy<ContextMenuHandler>;
  pipEventBridgeHandler: MockProxy<PiPEventBridgeHandler>;
  pipLinkFocusHandler: MockProxy<PiPLinkFocusHandler>;
  documentFocusHandler: MockProxy<DocumentFocusHandler>;
  titleSyncHandler: MockProxy<TitleSyncHandler>;
}

export function createPipShortsWindowHandlersMocks(): PipShortsWindowHandlersMocks {
  return {
    contextMenuHandler: mock<ContextMenuHandler>(),
    pipEventBridgeHandler: mock<PiPEventBridgeHandler>(),
    pipLinkFocusHandler: mock<PiPLinkFocusHandler>(),
    documentFocusHandler: mock<DocumentFocusHandler>(),
    titleSyncHandler: mock<TitleSyncHandler>(),
  };
}
