import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { YT_EVENTS } from '../constants';
import { inject, injectable } from '../di';

/**
 * Bridges yt-navigate and yt-action events from PiP document to the app (ytd-app) in PiP.
 * Listens on the PiP window document and forwards events via app.fire().
 */
@injectable()
export class PiPEventBridgeHandler {
  private readonly logger: Logger;
  private cleanupFns: Array<() => void> = [];

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider
  ) {
    this.logger = loggerFactory.create('PiPEventBridgeHandler');
  }

  /**
   * Start listening on PiP document and forward events to app.fire().
   */
  public initialize(): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) {
      this.logger.warn('PiP window not available for event bridge');
      return;
    }

    const doc = pipWindow.document;
    const app = this.ytdAppProvider.getApp();
    if (!app.fire) {
      this.logger.warn('app.fire not available');
      return;
    }

    const onNavigate = (e: CustomEvent): void => {
      this.logger.debug('Forwarding navigate event to app:', e.detail);
      app.fire!(YT_EVENTS.NAVIGATE, e.detail);
    };
    const onAction = (e: CustomEvent): void => {
      this.logger.debug('Forwarding action event to app:', e.detail);
      app.fire!(YT_EVENTS.ACTION, e.detail);
    };

    doc.addEventListener(YT_EVENTS.NAVIGATE, onNavigate as EventListener);
    doc.addEventListener(YT_EVENTS.ACTION, onAction as EventListener);
    this.cleanupFns.push(
      () => doc.removeEventListener(YT_EVENTS.NAVIGATE, onNavigate as EventListener),
      () => doc.removeEventListener(YT_EVENTS.ACTION, onAction as EventListener)
    );

    this.logger.debug('PiP event bridge initialized');
  }

  /**
   * Remove listeners.
   */
  public stop(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }
}
