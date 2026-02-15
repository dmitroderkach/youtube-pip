import { PiPManager } from '../core/PiPManager';
import { AppInitializationError } from '../errors/AppInitializationError';
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
}
