import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { PiPEventBridgeHandler } from '../handlers/PiPEventBridgeHandler';
import { PiPLinkFocusHandler } from '../handlers/PiPLinkFocusHandler';
import { DocumentFocusHandler } from '../handlers/DocumentFocusHandler';
import type { PiPCleanupCallback } from '../types/app';
import { PiPHotkeyHandler } from '../handlers/PiPHotkeyHandler';
import { inject, injectable } from '../di';
import { TitleSyncHandler } from '../handlers/TitleSyncHandler';

/**
 * PiP window handlers for Shorts: context menu, event bridge, link focus.
 */
@injectable()
export class PipShortsWindowHandlers {
  constructor(
    @inject(ContextMenuHandler) private readonly contextMenuHandler: ContextMenuHandler,
    @inject(PiPEventBridgeHandler) private readonly pipEventBridgeHandler: PiPEventBridgeHandler,
    @inject(PiPLinkFocusHandler) private readonly pipLinkFocusHandler: PiPLinkFocusHandler,
    @inject(DocumentFocusHandler) private readonly documentFocusHandler: DocumentFocusHandler,
    @inject(TitleSyncHandler) private readonly titleSyncHandler: TitleSyncHandler,
    @inject(PiPHotkeyHandler) private readonly pipHotkeyHandler: PiPHotkeyHandler
  ) {}

  public async initialize(): Promise<PiPCleanupCallback> {
    this.contextMenuHandler.initialize(true);
    this.pipEventBridgeHandler.initialize();
    this.pipLinkFocusHandler.initialize();
    this.documentFocusHandler.initialize(true);
    this.titleSyncHandler.initialize(true);
    this.pipHotkeyHandler.initialize();
    return () => {
      this.contextMenuHandler.stop();
      this.pipEventBridgeHandler.stop();
      this.pipLinkFocusHandler.stop();
      this.pipHotkeyHandler.cleanup();
      this.documentFocusHandler.cleanup();
      // The page title stays held until the player is back (PiPManager)
      this.titleSyncHandler.stopSync();
    };
  }
}
