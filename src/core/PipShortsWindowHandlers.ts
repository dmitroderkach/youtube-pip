import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { PiPEventBridgeHandler } from '../handlers/PiPEventBridgeHandler';
import { PiPLinkFocusHandler } from '../handlers/PiPLinkFocusHandler';
import { DocumentFocusHandler } from '../handlers/DocumentFocusHandler';
import { ShortsInfoPanelHandler } from '../handlers/ShortsInfoPanelHandler';
import type { PiPCleanupCallback } from '../types/app';
import { inject, injectable } from '../di';
import { TitleSyncHandler } from '../handlers/TitleSyncHandler';

/**
 * PiP window handlers for Shorts: context menu, event bridge, link focus, info panel unhide.
 */
@injectable()
export class PipShortsWindowHandlers {
  constructor(
    @inject(ContextMenuHandler) private readonly contextMenuHandler: ContextMenuHandler,
    @inject(PiPEventBridgeHandler) private readonly pipEventBridgeHandler: PiPEventBridgeHandler,
    @inject(PiPLinkFocusHandler) private readonly pipLinkFocusHandler: PiPLinkFocusHandler,
    @inject(DocumentFocusHandler) private readonly documentFocusHandler: DocumentFocusHandler,
    @inject(ShortsInfoPanelHandler) private readonly shortsInfoPanelHandler: ShortsInfoPanelHandler,
    @inject(TitleSyncHandler) private readonly titleSyncHandler: TitleSyncHandler
  ) {}

  public async initialize(): Promise<PiPCleanupCallback> {
    this.contextMenuHandler.initialize(true);
    this.pipEventBridgeHandler.initialize();
    this.pipLinkFocusHandler.initialize();
    this.documentFocusHandler.initialize(true);
    this.shortsInfoPanelHandler.initialize();
    this.titleSyncHandler.initialize(true);
    return () => {
      this.contextMenuHandler.stop();
      this.pipEventBridgeHandler.stop();
      this.pipLinkFocusHandler.stop();
      this.documentFocusHandler.cleanup();
      this.shortsInfoPanelHandler.stop();
      this.titleSyncHandler.cleanup();
    };
  }
}
