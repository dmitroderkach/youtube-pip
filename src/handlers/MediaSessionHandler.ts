import { MediaSessionMetadata } from '../types/youtube';
import { PiPManager } from '../core/PiPManager';
import { AppInitializationError } from '../errors/AppInitializationError';
import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Handles Media Session API integration
 */
@injectable()
export class MediaSessionHandler {
  private readonly logger: Logger;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PiPManager) private readonly pipManager: PiPManager
  ) {
    this.logger = loggerFactory.create('MediaSessionHandler');
  }

  /**
   * Initialize media session handler
   */
  public initialize(): void {
    if (!('mediaSession' in navigator)) {
      this.logger.warn('Media Session API not available');
      return;
    }

    this.registerActionHandler();
    this.setupTitleSync();
    this.logger.debug('Media session handler initialized');
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
      navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
        this.logger.log('Media session enterpictureinpicture action triggered');
        this.pipManager.open().catch((e) => {
          this.logger.error('Error opening PiP from media session:', e);
        });
      });
      this.logger.debug('Media session action handler registered');
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

      if (!this.isValidPropertyDescriptor(desc)) {
        this.logger.warn('Could not get original metadata descriptor');
        return;
      }

      Object.defineProperty(navigator.mediaSession, 'metadata', {
        get: () => desc.get.call(navigator.mediaSession),
        set: (value: Nullable<MediaSessionMetadata>) => {
          desc.set.call(navigator.mediaSession, value);

          // Sync title if available
          if (value && value.title) {
            this.pipManager.updateTitle(value.title);
          }
        },
        configurable: true,
        enumerable: true,
      });

      this.logger.debug('Media session title sync configured');
    } catch (e) {
      throw new AppInitializationError('Error setting up title sync', e);
    }
  }

  /**
   * Type guard for PropertyDescriptor with required get/set methods
   */
  private isValidPropertyDescriptor(
    desc: PropertyDescriptor | undefined
  ): desc is Required<Pick<PropertyDescriptor, 'get' | 'set'>> & PropertyDescriptor {
    return desc !== undefined && typeof desc.get === 'function' && typeof desc.set === 'function';
  }
}
