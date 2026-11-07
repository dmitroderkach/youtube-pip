import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { YT_EVENTS } from '../constants';
import { inject, injectable } from '../di';

/**
 * Bridges events from the PiP document to the main window: yt-navigate and yt-action go to the main
 * ytd-app via app.fire(); mouseup is re-dispatched on the main document (see onMouseUp).
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

    // YouTube's press/drag helper (used e.g. by "hold for 2x" speed) listens for mouseup on the main document
    // unless its own PiP experiments are on. A mouseup inside PiP never reaches it, so every click on the video
    // looks like a press that is still held and switches playback to 2x. Forward mouseups to the main document.
    const onMouseUp = (e: MouseEvent): void => {
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          button: e.button,
          buttons: e.buttons,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        })
      );
    };

    doc.addEventListener(YT_EVENTS.NAVIGATE, onNavigate as EventListener);
    doc.addEventListener(YT_EVENTS.ACTION, onAction as EventListener);
    doc.addEventListener('mouseup', onMouseUp, true);
    this.cleanupFns.push(
      () => doc.removeEventListener(YT_EVENTS.NAVIGATE, onNavigate as EventListener),
      () => doc.removeEventListener(YT_EVENTS.ACTION, onAction as EventListener),
      () => doc.removeEventListener('mouseup', onMouseUp, true)
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
