import { PiPManager } from '../core/PiPManager';
import { AppInitializationError } from '../errors/AppInitializationError';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

const PIP_ACTION: ExtendedMediaSessionAction = 'enterpictureinpicture';

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

    const mediaSession = navigator.mediaSession;
    const originalSetActionHandler = mediaSession.setActionHandler.bind(mediaSession);

    const handler: MediaSessionActionHandler = () => {
      this.logger.log('Media session enterpictureinpicture action triggered');
      this.pipManager.open().catch((e) => {
        this.logger.error('Error opening PiP from media session:', e);
      });
    };

    try {
      // 'enterpictureinpicture' is a Chrome-specific Media Session action
      originalSetActionHandler(PIP_ACTION, handler);
      this.logger.debug('Media session action handler registered');
    } catch (e) {
      throw new AppInitializationError('Error registering media session action handler', e);
    }

    this.guardActionHandler(mediaSession, originalSetActionHandler);
  }

  /**
   * YouTube (web_shorts_pip / web_watch_pip experiments) re-registers its own
   * enterpictureinpicture handler, or clears it with null, on every SPA navigation.
   * Either replaces ours, so PiP stops opening. Ignore page attempts to change
   * this action; pass all other actions through unchanged.
   */
  private guardActionHandler(
    mediaSession: MediaSession,
    originalSetActionHandler: MediaSession['setActionHandler']
  ): void {
    mediaSession.setActionHandler = (action, actionHandler) => {
      if (action === PIP_ACTION) {
        this.logger.debug('Blocked override of enterpictureinpicture handler');
        return;
      }
      originalSetActionHandler(action, actionHandler);
    };
  }
}
