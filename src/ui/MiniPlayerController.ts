import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { SELECTORS } from '../selectors';
import { TIMEOUTS, YT_EVENTS, YT_ACTION_NAMES } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { PlayerManager } from '../core/PlayerManager';
import { YtdAppProvider } from '../core/YtdAppProvider';
import type { Nullable } from '../types/app';
import type { MiniPlayerElement } from '../types/youtube';
import { AppInitializationError } from '../errors/AppInitializationError';
import { inject, injectable } from '../di';

/**
 * Controls mini player visibility and state using YouTube native actions.
 * Holds a reference to the miniplayer DOM element, initialized at app startup.
 */
@injectable()
export class MiniPlayerController {
  private readonly logger: Logger;
  private miniplayer: Nullable<MiniPlayerElement> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider
  ) {
    this.logger = loggerFactory.create('MiniPlayerController');
  }

  /**
   * Initialize with main document. Call at app startup.
   * Waits for ytd-miniplayer element with standard timeout.
   * @throws AppInitializationError if miniplayer element not found
   */
  public async initialize(): Promise<void> {
    try {
      const element = await DOMUtils.waitForElementSelector<MiniPlayerElement>(
        SELECTORS.MINIPLAYER,
        document,
        TIMEOUTS.ELEMENT_WAIT
      );
      this.miniplayer = element;
      this.logger.debug('Miniplayer initialized');
    } catch (cause) {
      throw new AppInitializationError(`${SELECTORS.MINIPLAYER} element not found`, cause);
    }
  }

  /**
   * Get the miniplayer element reference. Always defined after initialize().
   */
  public getMiniplayer(): MiniPlayerElement {
    return this.miniplayer!;
  }
  /**
   * Check if mini player is currently visible
   */
  public isVisible(): boolean {
    const isVisible = !!document.querySelector(SELECTORS.MINIPLAYER_HOST);
    this.logger.debug(`Mini player visible: ${isVisible}`);
    return isVisible;
  }

  /**
   * Activate mini player using YouTube native action
   * Uses YT_EVENTS.ACTION with YT_ACTION_NAMES.ACTIVATE_MINIPLAYER
   */
  public activateMiniPlayer(): void {
    this.logger.debug('Activating mini player via YouTube API');

    const ytdApp = this.ytdAppProvider.getApp();
    if (typeof ytdApp.fire !== 'function') {
      this.logger.error('ytd-app fire method not found');
      return;
    }

    try {
      ytdApp.fire(YT_EVENTS.ACTION, {
        actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER,
        args: [false],
        optionalAction: false,
        returnValue: [undefined],
      });
      this.logger.debug('Mini player activation event dispatched');
    } catch (e) {
      this.logger.error('Error activating mini player:', e);
    }
  }

  /**
   * Toggle mini player mode using YouTube native API
   *
   * If mini player is active, navigates back to full player using YT_EVENTS.NAVIGATE.
   * Otherwise, activates mini player using YT_EVENTS.ACTION with YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH.
   *
   * @returns void
   */
  public toggleMiniPlayer(): void {
    const ytdApp = this.ytdAppProvider.getApp();
    if (typeof ytdApp.fire !== 'function') {
      this.logger.error('ytd-app fire method not found');
      return;
    }

    try {
      if (ytdApp.miniplayerIsActive) {
        // Return to full player: use YT_EVENTS.NAVIGATE with watchEndpoint
        this.logger.debug('Returning to full player via YouTube API');

        // Get video ID from player using PlayerManager
        const videoId = this.playerManager.getVideoId();
        if (!videoId) {
          this.logger.error('Video ID not found, cannot navigate to full player');
          return;
        }

        ytdApp.fire(YT_EVENTS.NAVIGATE, {
          endpoint: {
            watchEndpoint: { videoId },
          },
        });
        this.logger.debug(`Navigation to full player dispatched for video ${videoId}`);
      } else {
        // Activate miniplayer: use YT_EVENTS.ACTION with YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH
        this.logger.debug('Activating miniplayer via YouTube API');
        ytdApp.fire(YT_EVENTS.ACTION, {
          actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH,
          args: null,
          optionalAction: false,
          returnValue: [undefined],
        });
        this.logger.debug('Miniplayer activation event dispatched');
      }
    } catch (e) {
      this.logger.error('Error toggling mini player:', e);
    }
  }
}
