import { mock, type MockProxy } from 'vitest-mock-extended';
import { ResizeTracker } from '../../../ui/ResizeTracker';
import { MenuObserver } from '../../../ui/MenuObserver';
import { ContextMenuHandler } from '../../../ui/ContextMenuHandler';
import { SeekHandler } from '../../../handlers/SeekHandler';
import { PiPEventBridgeHandler } from '../../../handlers/PiPEventBridgeHandler';
import { NavigationHandler } from '../../NavigationHandler';
import { DocumentFocusHandler } from '../../../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../../../handlers/TitleSyncHandler';
import { PiPHotkeyHandler } from '../../../handlers/PiPHotkeyHandler';

export interface PiPWindowHandlersMocks {
  resizeTracker: MockProxy<ResizeTracker>;
  menuObserver: MockProxy<MenuObserver>;
  contextMenuHandler: MockProxy<ContextMenuHandler>;
  seekHandler: MockProxy<SeekHandler>;
  pipEventBridgeHandler: MockProxy<PiPEventBridgeHandler>;
  navigationHandler: MockProxy<NavigationHandler>;
  documentFocusHandler: MockProxy<DocumentFocusHandler>;
  titleSyncHandler: MockProxy<TitleSyncHandler>;
  pipHotkeyHandler: MockProxy<PiPHotkeyHandler>;
}

export function createPiPWindowHandlersMocks(): PiPWindowHandlersMocks {
  return {
    resizeTracker: mock<ResizeTracker>(),
    menuObserver: mock<MenuObserver>(),
    contextMenuHandler: mock<ContextMenuHandler>(),
    seekHandler: mock<SeekHandler>(),
    pipEventBridgeHandler: mock<PiPEventBridgeHandler>(),
    navigationHandler: mock<NavigationHandler>(),
    documentFocusHandler: mock<DocumentFocusHandler>(),
    titleSyncHandler: mock<TitleSyncHandler>(),
    pipHotkeyHandler: mock<PiPHotkeyHandler>(),
  };
}
