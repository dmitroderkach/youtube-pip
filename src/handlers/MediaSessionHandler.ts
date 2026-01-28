import { Logger } from '../logger';
import { MediaSessionMetadata } from '../types/youtube';
import { PiPManager } from '../core/PiPManager';
import { AppInitializationError } from '../errors/AppInitializationError';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('MediaSessionHandler');

/**
 * Handles Media Session API integration
 */
export class MediaSessionHandler {
  private pipManager: PiPManager;

  constructor(pipManager: PiPManager) {
    this.pipManager = pipManager;
  }

  /**
   * Initialize media session handler
   */
  public initialize(): void {
    if (!('mediaSession' in navigator)) {
      logger.warn('Media Session API not available');
      return;
    }

    this.registerActionHandler();
    this.setupTitleSync();
    logger.debug('Media session handler initialized');
  }

  /**
   * Register enterpictureinpicture action handler
   */
  private registerActionHandler(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    try {
      // 'enterpictureinpicture' is a Chrome-specific Media Session action
      navigator.mediaSession.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
        logger.log('Media session enterpictureinpicture action triggered');
        this.pipManager.open().catch((e) => {
          logger.error('Error opening PiP from media session:', e);
        });
      });
      logger.debug('Media session action handler registered');
    } catch (e) {
      throw new AppInitializationError('Error registering media session action handler', e);
    }
  }

  /**
   * Setup title synchronization from MediaSession metadata
   */
  private setupTitleSync(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    try {
      const prototype = Object.getPrototypeOf(navigator.mediaSession);
      const desc = Object.getOwnPropertyDescriptor(prototype, 'metadata');
      if (!desc || !desc.get || !desc.set) {
        logger.warn('Could not get original metadata descriptor');
        return;
      }

      Object.defineProperty(navigator.mediaSession, 'metadata', {
        get: () => desc.get!.call(navigator.mediaSession),
        set: (value: Nullable<MediaSessionMetadata>) => {
          desc.set!.call(navigator.mediaSession, value);

          // Sync title if available
          if (value && value.title) {
            this.pipManager.updateTitle(value.title);
          }
        },
        configurable: true,
        enumerable: true,
      });

      logger.debug('Media session title sync configured');
    } catch (e) {
      throw new AppInitializationError('Error setting up title sync', e);
    }
  }
}
