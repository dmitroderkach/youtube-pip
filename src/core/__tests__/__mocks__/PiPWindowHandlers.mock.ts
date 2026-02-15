import { mock, type MockProxy } from 'vitest-mock-extended';
import { ResizeTracker } from '../../../ui/ResizeTracker';
import { MenuObserver } from '../../../ui/MenuObserver';
import { ContextMenuHandler } from '../../../ui/ContextMenuHandler';
import { SeekHandler } from '../../../handlers/SeekHandler';
import { LikeButtonHandler } from '../../../handlers/LikeButtonHandler';
import { NavigationHandler } from '../../NavigationHandler';
import { DocumentFocusHandler } from '../../../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../../../handlers/TitleSyncHandler';

export interface PiPWindowHandlersMocks {
  resizeTracker: MockProxy<ResizeTracker>;
  menuObserver: MockProxy<MenuObserver>;
  contextMenuHandler: MockProxy<ContextMenuHandler>;
  seekHandler: MockProxy<SeekHandler>;
  likeButtonHandler: MockProxy<LikeButtonHandler>;
  navigationHandler: MockProxy<NavigationHandler>;
  documentFocusHandler: MockProxy<DocumentFocusHandler>;
  titleSyncHandler: MockProxy<TitleSyncHandler>;
}

export function createPiPWindowHandlersMocks(): PiPWindowHandlersMocks {
  return {
    resizeTracker: mock<ResizeTracker>(),
    menuObserver: mock<MenuObserver>(),
    contextMenuHandler: mock<ContextMenuHandler>(),
    seekHandler: mock<SeekHandler>(),
    likeButtonHandler: mock<LikeButtonHandler>(),
    navigationHandler: mock<NavigationHandler>(),
    documentFocusHandler: mock<DocumentFocusHandler>(),
    titleSyncHandler: mock<TitleSyncHandler>(),
  };
}
