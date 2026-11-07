import { ResizeTracker } from '../ui/ResizeTracker';
import { MenuObserver } from '../ui/MenuObserver';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { SeekHandler } from '../handlers/SeekHandler';
import { PiPEventBridgeHandler } from '../handlers/PiPEventBridgeHandler';
import { NavigationHandler } from '../core/NavigationHandler';
import { DocumentFocusHandler } from '../handlers/DocumentFocusHandler';
import { TitleSyncHandler } from '../handlers/TitleSyncHandler';
import type { PiPCleanupCallback } from '../types/app';
import { inject, injectable } from '../di';

/**
 * Initializes PiP window handlers and returns cleanup callback
 */
@injectable()
export class PiPWindowHandlers {
  constructor(
    @inject(ResizeTracker) private readonly resizeTracker: ResizeTracker,
    @inject(MenuObserver) private readonly menuObserver: MenuObserver,
    @inject(ContextMenuHandler) private readonly contextMenuHandler: ContextMenuHandler,
    @inject(SeekHandler) private readonly seekHandler: SeekHandler,
    @inject(PiPEventBridgeHandler) private readonly pipEventBridgeHandler: PiPEventBridgeHandler,
    @inject(NavigationHandler) private readonly navigationHandler: NavigationHandler,
    @inject(DocumentFocusHandler) private readonly documentFocusHandler: DocumentFocusHandler,
    @inject(TitleSyncHandler) private readonly titleSyncHandler: TitleSyncHandler
  ) {}

  public async initialize(miniplayer: Element): Promise<PiPCleanupCallback> {
    this.navigationHandler.initialize();
    this.resizeTracker.start(miniplayer);
    void this.menuObserver.start();
    this.contextMenuHandler.initialize();
    this.seekHandler.initialize();
    this.pipEventBridgeHandler.initialize();
    this.documentFocusHandler.initialize();
    this.titleSyncHandler.initialize();

    return () => {
      this.titleSyncHandler.cleanup();
      this.documentFocusHandler.cleanup();
      this.seekHandler.cleanup();
      this.pipEventBridgeHandler.stop();
      this.contextMenuHandler.stop();
      this.menuObserver.stop();
      this.resizeTracker.stop();
      this.navigationHandler.cleanup();
    };
  }
}
