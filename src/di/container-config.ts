import { Container } from './container';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { YtdShortsProvider } from '../core/YtdShortsProvider';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { MiniPlayerController } from '../ui/MiniPlayerController';
import { NavigationHandler } from '../core/NavigationHandler';
import { ResizeTracker } from '../ui/ResizeTracker';
import { MenuObserver } from '../ui/MenuObserver';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { SeekHandler } from '../handlers/SeekHandler';
import { LikeButtonHandler } from '../handlers/LikeButtonHandler';
import { DocumentFocusHandler } from '../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../handlers/TitleSyncHandler';
import { PiPWindowHandlers } from '../core/PiPWindowHandlers';
import { PipShortsWindowHandlers } from '../core/PipShortsWindowHandlers';
import { PiPManager } from '../core/PiPManager';
import { YtActionSender } from '../core/YtActionSender';
import { MediaSessionHandler } from '../handlers/MediaSessionHandler';
import { PiPEventBridgeHandler } from '../handlers/PiPEventBridgeHandler';
import { PiPLinkFocusHandler } from '../handlers/PiPLinkFocusHandler';
import { ShortsInfoPanelHandler } from '../handlers/ShortsInfoPanelHandler';

export function createContainer(): Container {
  const container = new Container();

  container.bind(LoggerFactory).toSelf();
  container.bind(PlayerManager).toSelf();
  container.bind(YtdAppProvider).toSelf();
  container.bind(YtdShortsProvider).toSelf();
  container.bind(PipWindowProvider).toSelf();
  container.bind(MiniPlayerController).toSelf();
  container.bind(NavigationHandler).toSelf();
  container.bind(ResizeTracker).toSelf();
  container.bind(MenuObserver).toSelf();
  container.bind(ContextMenuHandler).toSelf();
  container.bind(SeekHandler).toSelf();
  container.bind(YtActionSender).toSelf();
  container.bind(LikeButtonHandler).toSelf();
  container.bind(DocumentFocusHandler).toSelf();
  container.bind(TitleSyncHandler).toSelf();
  container.bind(PiPWindowHandlers).toSelf();
  container.bind(PiPEventBridgeHandler).toSelf();
  container.bind(PiPLinkFocusHandler).toSelf();
  container.bind(ShortsInfoPanelHandler).toSelf();
  container.bind(PipShortsWindowHandlers).toSelf();
  container.bind(PiPManager).toSelf();
  container.bind(MediaSessionHandler).toSelf();

  return container;
}
