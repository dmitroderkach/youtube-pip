import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { SELECTORS } from '../selectors';
import { inject, injectable } from '../di';

/**
 * When Shorts info panel shows the "link only" block (e.g. Wikipedia),
 * the paragraph text (e.g. "BBC World Service ...") is hidden via
 * is-empty on yt-formatted-string and hidden="true" on yt-attributed-string.
 * This handler observes the PiP document and removes those attributes so the text becomes visible.
 */
@injectable()
export class ShortsInfoPanelHandler {
  private readonly logger: Logger;
  private observer: MutationObserver | null = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('ShortsInfoPanelHandler');
  }

  public initialize(): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow?.document?.body) {
      this.logger.warn('PiP window not available for info panel handler');
      return;
    }

    const doc = pipWindow.document;

    this.observer = new MutationObserver(() => {
      this.unhideVisibleInfoPanelParagraphs(doc);
    });

    this.observer.observe(doc.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['hidden', 'is-empty', 'has-link-only_'],
    });

    this.unhideVisibleInfoPanelParagraphs(doc);
    this.logger.debug('Shorts info panel handler initialized');
  }

  /**
   * Find visible yt-formatted-string[has-link-only_], then in the same panel
   * remove is-empty and hidden so the paragraph content is shown.
   */
  public unhideVisibleInfoPanelParagraphs(doc: Document | Element): void {
    const linkEl = doc.querySelector<HTMLElement>(SELECTORS.INFO_PANEL_LINK_ONLY);
    if (!linkEl) {
      this.logger.debug('Shorts info panel: link only block not found, skipping');
      return;
    }

    const container = linkEl.closest(SELECTORS.INFO_PANEL_CONTENT);
    if (!container) {
      this.logger.debug('Shorts info panel: container not found, skipping');
      return;
    }

    const emptyParagraph = container.querySelector(SELECTORS.INFO_PANEL_EMPTY_PARAGRAPH);
    if (emptyParagraph) {
      this.logger.debug('Shorts info panel: unhiding paragraph content');
      emptyParagraph.removeAttribute('is-empty');
    }
    const hiddenAttributed = container.querySelector(SELECTORS.INFO_PANEL_ATTRIBUTED_HIDDEN);
    if (hiddenAttributed) {
      this.logger.debug('Shorts info panel: unhiding attributed string');
      hiddenAttributed.removeAttribute('hidden');
    }
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.logger.debug('Shorts info panel handler stopped');
  }
}
