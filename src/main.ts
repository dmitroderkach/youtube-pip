import { Logger } from './logger';
import { MiniPlayerController } from './ui/MiniPlayerController';
import { PlayerManager } from './core/PlayerManager';
import { NavigationHandler } from './core/NavigationHandler';
import { PiPManager } from './core/PiPManager';
import { ResizeTracker } from './ui/ResizeTracker';
import { MenuObserver } from './ui/MenuObserver';
import { ContextMenuHandler } from './ui/ContextMenuHandler';
import { SeekHandler } from './handlers/SeekHandler';
import { LikeButtonHandler } from './handlers/LikeButtonHandler';
import { MediaSessionHandler } from './handlers/MediaSessionHandler';
import { getGlobalMetadata } from './utils/VersionDetector';
import type { PiPCleanupCallback } from './types/app';

// Set global metadata before initializing the application
Logger.setGlobalMetadata(getGlobalMetadata());

const logger = Logger.getInstance('Main');

/**
 * Main application class
 */
class YouTubePiPApp {
  private miniPlayerController: MiniPlayerController;
  private playerManager: PlayerManager;
  private navigationHandler: NavigationHandler;
  private pipManager: PiPManager;
  private resizeTracker: ResizeTracker;
  private menuObserver: MenuObserver;
  private contextMenuHandler: ContextMenuHandler;
  private seekHandler: SeekHandler;
  private likeButtonHandler: LikeButtonHandler;
  private mediaSessionHandler: MediaSessionHandler;

  constructor() {
    this.miniPlayerController = new MiniPlayerController();
    this.playerManager = new PlayerManager();
    this.navigationHandler = new NavigationHandler();
    this.resizeTracker = new ResizeTracker();
    this.menuObserver = new MenuObserver();
    this.contextMenuHandler = new ContextMenuHandler();
    this.seekHandler = new SeekHandler();
    this.likeButtonHandler = new LikeButtonHandler();

    this.pipManager = new PiPManager(
      this.miniPlayerController,
      this.playerManager,
      this.navigationHandler,
      (pipWindow, miniplayer) => this.createPiPWindowCallback(pipWindow, miniplayer)
    );

    this.mediaSessionHandler = new MediaSessionHandler(this.pipManager);
  }

  /**
   * Callback for PiPManager: init handlers when PiP opens, return cleanup on close
   */
  private async createPiPWindowCallback(
    pipWindow: Window,
    miniplayer: Element
  ): Promise<PiPCleanupCallback> {
    await this.initializePiPWindowHandlers(pipWindow, miniplayer);
    return () => {
      this.seekHandler.cleanup();
      this.likeButtonHandler.cleanup();
      this.contextMenuHandler.stop();
    };
  }

  /**
   * Initialize the application
   */
  public async initialize(): Promise<void> {
    logger.log('Initializing YouTube PiP application');

    // Initialize media session handler
    this.mediaSessionHandler.initialize();

    logger.log('YouTube PiP application initialized');
  }

  /**
   * Initialize all handlers for PiP window
   * Called when PiP window is opened
   */
  private async initializePiPWindowHandlers(pipWindow: Window, miniplayer: Element): Promise<void> {
    logger.debug('Initializing PiP window handlers');

    // Initialize handlers
    this.resizeTracker.start(miniplayer, pipWindow);
    // Run in background - may wait indefinitely for menu to appear
    void this.menuObserver.start(pipWindow);
    // Run in background - may wait indefinitely for menu to appear
    void this.contextMenuHandler.initialize(pipWindow);
    this.seekHandler.initialize(pipWindow);
    this.likeButtonHandler.initialize(pipWindow);

    logger.debug('All PiP window handlers initialized');
  }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new YouTubePiPApp();
    app.initialize().catch((e) => {
      Logger.getInstance('Main').error('Error initializing application:', e);
    });
  });
} else {
  const app = new YouTubePiPApp();
  app.initialize().catch((e) => {
    Logger.getInstance('Main').error('Error initializing application:', e);
  });
}
