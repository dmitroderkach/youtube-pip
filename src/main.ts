import { Logger } from './logger';
import { createContainer } from './di';
import { PlayerManager } from './core/PlayerManager';
import { YtdAppProvider } from './core/YtdAppProvider';
import { MiniPlayerController } from './ui/MiniPlayerController';
import { MediaSessionHandler } from './handlers/MediaSessionHandler';
import { getGlobalMetadata } from './utils/VersionDetector';

const logger = Logger.getInstance('Main');

/**
 * Initialize the application
 */
async function initializeApp(): Promise<void> {
  Logger.setGlobalMetadata(getGlobalMetadata());

  const container = createContainer();

  logger.log('Initializing YouTube PiP application');

  try {
    const ytdAppProvider = container.get<YtdAppProvider>(YtdAppProvider);
    await ytdAppProvider.initialize();

    const playerManager = container.get<PlayerManager>(PlayerManager);
    await playerManager.initialize();

    const miniPlayerController = container.get<MiniPlayerController>(MiniPlayerController);
    await miniPlayerController.initialize();

    const mediaSessionHandler = container.get<MediaSessionHandler>(MediaSessionHandler);
    mediaSessionHandler.initialize();

    logger.log('YouTube PiP application initialized');
  } catch (error) {
    logger.error('YouTube PiP initialization failed', error);
  }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initializeApp());
} else {
  void initializeApp();
}
