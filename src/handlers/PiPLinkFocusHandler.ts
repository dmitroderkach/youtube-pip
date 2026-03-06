import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { SELECTORS } from '../selectors';
import { inject, injectable } from '../di';

/**
 * On click on a link (<a>) in PiP window, focuses the main window so navigation works correctly.
 * Uses capture phase to run before other handlers.
 */
@injectable()
export class PiPLinkFocusHandler {
  private readonly logger: Logger;
  private cleanupFn: (() => void) | null = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('PiPLinkFocusHandler');
  }

  /**
   * Start listening for link clicks on PiP body (capture phase) and focus window.
   */
  public initialize(): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) {
      this.logger.warn('PiP window not available for link focus handler');
      return;
    }

    const doc = pipWindow.document;
    if (!doc.body) {
      this.logger.warn('PiP document has no body');
      return;
    }
    const handler = (e: MouseEvent): void => {
      const target = e.target as Element;
      if (target?.closest(SELECTORS.SHORTS_VIDEO_TITLE)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      const anchor = target?.closest('a');
      // Ignore links with target="_blank" to prevent returning to tab when external links are opened in new tab
      if (anchor?.target === '_blank') {
        return;
      }
      if (anchor) {
        window.focus();
      }
    };

    doc.body.addEventListener('click', handler, { capture: true });
    this.cleanupFn = () => doc.body.removeEventListener('click', handler, { capture: true });
    this.logger.debug('PiP link focus handler initialized');
  }

  /**
   * Remove listener.
   */
  public stop(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }
}
