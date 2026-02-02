import { SELECTORS } from '../selectors';
import { TIMEOUTS } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import type { Nullable } from '../types/app';
import type { NotificationTopbarButtonRenderer, YouTubeAppElement } from '../types/youtube';
import { AppInitializationError } from '../errors/AppInitializationError';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Provides the main document's ytd-app element.
 * Initialized at app startup; reference persists when moving between main window and PiP.
 */
@injectable()
export class YtdAppProvider {
  private readonly logger: Logger;
  private app: Nullable<YouTubeAppElement> = null;
  private notifyRenderer: Nullable<NotificationTopbarButtonRenderer> = null;

  constructor(@inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create('YtdAppProvider');
  }

  /**
   * Initialize with main document. Call at app startup.
   * Waits for ytd-app element with standard timeout.
   * @throws AppInitializationError if ytd-app element not found
   */
  public async initialize(): Promise<void> {
    try {
      const element = await DOMUtils.waitForElementSelector<YouTubeAppElement>(
        SELECTORS.YTD_APP,
        document,
        TIMEOUTS.ELEMENT_WAIT
      );
      this.app = element;
      try {
        this.notifyRenderer =
          await DOMUtils.waitForElementSelector<NotificationTopbarButtonRenderer>(
            SELECTORS.NOTIFICATION_TOPBAR_BUTTON_RENDERER,
            document,
            TIMEOUTS.ELEMENT_WAIT
          );
      } catch (err) {
        this.logger.warn(
          `${SELECTORS.NOTIFICATION_TOPBAR_BUTTON_RENDERER} not found, notification count will be omitted from title`,
          err
        );
        this.notifyRenderer = null;
      }
      this.logger.debug('ytd-app initialized');
    } catch (cause) {
      throw new AppInitializationError(`${SELECTORS.YTD_APP} element not found`, cause);
    }
  }

  /**
   * Get the ytd-app element (main document). Always defined after initialize().
   */
  public getApp(): YouTubeAppElement {
    return this.app!;
  }

  /**
   * Get the notification topbar button renderer. May be null if not yet rendered.
   */
  public getNotifyRenderer(): Nullable<NotificationTopbarButtonRenderer> {
    return this.notifyRenderer;
  }
}
