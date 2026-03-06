import type { Nullable } from '../types/app';
import type { YouTubePlayer, YouTubeShortsElement } from '../types/youtube';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';
import { SELECTORS } from '../selectors';
import { isPlayingState } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { ShortsInfoPanelHandler } from '../handlers/ShortsInfoPanelHandler';

/**
 * Provides the ytd-shorts element. Set by PiPManager when opening Shorts PiP, cleared when closing.
 */
@injectable()
export class YtdShortsProvider {
  private readonly logger: Logger;
  private shorts: Nullable<YouTubeShortsElement> = null;
  private player: Nullable<YouTubePlayer> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(ShortsInfoPanelHandler) private readonly shortsInfoPanelHandler: ShortsInfoPanelHandler
  ) {
    this.logger = loggerFactory.create('YtdShortsProvider');
  }

  /**
   * Set the ytd-shorts element (or null to clear).
   */
  public setShorts(shorts: Nullable<YouTubeShortsElement>): void {
    this.shorts = shorts;
    this.player = shorts?.querySelector<YouTubePlayer>(SELECTORS.SHORTS_PLAYER) ?? null;
    this.logger.debug('YtdShortsProvider.setShorts', { hasShorts: shorts !== null });
  }

  /**
   * Get the ytd-shorts element. Null until set and after clear.
   */
  public getShorts(): Nullable<YouTubeShortsElement> {
    return this.shorts;
  }

  public hideAllEngagementPanelSections(): void {
    this.shorts
      ?.querySelectorAll<Element>(SELECTORS.ENGAGEMENT_PANEL_EXPANDED)
      .forEach((section) => {
        section.querySelector<HTMLElement>(SELECTORS.ENGAGEMENT_PANEL_VISIBILITY_BUTTON)?.click();
      });
  }

  /**
   * Get the player element. Null until set and after clear.
   */
  public getPlayer(): Nullable<YouTubePlayer> {
    return this.player;
  }

  /**
   * Check if the Shorts container (ytd-shorts) is visible in the current document.
   * Used to decide whether PiP should use Shorts or main player flow.
   */
  public isShortsVisible(): boolean {
    const el = document.querySelector(SELECTORS.YTD_SHORTS);
    if (el == null) return false;
    const style = document.defaultView?.getComputedStyle(el);
    return style?.display !== 'none' && el.getBoundingClientRect().height !== 0;
  }

  /**
   * Get the Shorts player element from the current document (main window).
   * Does not require setShorts to have been called. Use when checking if Shorts stole playback.
   */
  public getShortsPlayerFromDocument(): Nullable<YouTubePlayer> {
    const el = document.querySelector(SELECTORS.YTD_SHORTS);
    return el?.querySelector<YouTubePlayer>(SELECTORS.SHORTS_PLAYER) ?? null;
  }

  /**
   * Check if the Shorts player in the current document is currently playing.
   * Similar to PlayerManager.isPlaying but for the Shorts player from document.
   */
  public isShortsPlayerPlaying(): boolean {
    const player = this.getShortsPlayerFromDocument();
    if (!player || typeof player.getPlayerState !== 'function') return false;
    return isPlayingState(player.getPlayerState());
  }

  /**
   * Reinitialize the shorts life cycle: temporarily remove ytd-shorts from the DOM and restore it
   * when the tab becomes active.
   *
   * Why: after returning the element from PiP to the main page, this component's rendering can loop
   * and constantly consume CPU. Additionally, reel metadata (title, author, etc.) stops updating
   * when switching to the next reel on the main YouTube page.
   *
   * This workaround (remove + restore via placeholder on visibilitychange) restarts the component's
   * life cycle and fixes both issues: the render loop stops and metadata updates correctly again.
   */
  public async reinitShortsLifeCycle(): Promise<void> {
    await new Promise<void>((resolve) => {
      const shorts = this.getShorts();
      if (!shorts) {
        this.logger.warn('reinitShortsLifeCycle: shorts element not found');
        resolve();
        return;
      }
      this.logger.debug('reinitShortsLifeCycle: scheduled, waiting for tab active', {
        visibilityState: document.visibilityState,
      });

      const runWhenTabActive = (): void => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', runWhenTabActive);
        this.logger.debug('reinitShortsLifeCycle: tab active, running remove/restore');

        const parent = shorts.parentElement;
        const isPlaying = isPlayingState(shorts.player?.getPlayerState?.() ?? -1);
        if (!parent) {
          this.logger.warn('reinitShortsLifeCycle: shorts parent element not found');
          resolve();
          return;
        }
        const placeholder = DOMUtils.createPlaceholder('shorts_placeholder');
        DOMUtils.insertPlaceholderBefore(shorts, placeholder);
        shorts.remove();
        this.logger.debug('reinitShortsLifeCycle: shorts removed, scheduling restore in rAF', {
          isPlaying,
        });
        requestAnimationFrame(() => {
          DOMUtils.restoreElementFromPlaceholder(shorts, placeholder);
          if (isPlaying) {
            shorts.player?.playVideo?.();
          }
          this.logger.debug('reinitShortsLifeCycle: restored to DOM', { isPlaying });
          /** Unhide visible info panel paragraphs when shorts are restored to the main page */
          this.shortsInfoPanelHandler.unhideVisibleInfoPanelParagraphs(shorts);
          resolve();
        });
      };
      if (document.visibilityState === 'visible') {
        runWhenTabActive();
      } else {
        document.addEventListener('visibilitychange', runWhenTabActive);
      }
    });
  }
}
