import type { Nullable } from '../types/app';
import type { YouTubePlayer, YouTubeShortsElement } from '../types/youtube';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';
import { SELECTORS } from '../selectors';
import { isPlayingState } from '../constants';
import { TIMEOUTS } from '../constants';

/**
 * Provides the ytd-shorts element. Set by PiPManager when opening Shorts PiP, cleared when closing.
 */
@injectable()
export class YtdShortsProvider {
  private readonly logger: Logger;
  private shorts: Nullable<YouTubeShortsElement> = null;
  private player: Nullable<YouTubePlayer> = null;
  private originalLoadVideo: Nullable<(index: number) => void> = null;
  private lockedShortsRef: Nullable<YouTubeShortsElement> = null;
  private restoreLoadVideoAfterId: ReturnType<typeof setTimeout> | null = null;

  constructor(@inject(LoggerFactory) loggerFactory: LoggerFactory) {
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
   * Replace loadVideo on the current shorts element with a no-op that only logs.
   * If loadVideo is not called after idle, the original method is restored automatically.
   */
  public lockLoadVideo(): void {
    const shorts = this.getShorts();
    if (!shorts) {
      this.logger.debug('lockLoadVideo: no shorts');
      return;
    }

    const scheduleRestore = (): void => {
      if (this.restoreLoadVideoAfterId != null) {
        clearTimeout(this.restoreLoadVideoAfterId);
      }
      this.restoreLoadVideoAfterId = setTimeout(() => {
        this.restoreLoadVideoAfterId = null;
        this.restoreLoadVideoLock();
      }, TIMEOUTS.IDLE_TIMEOUT);
    };

    if (this.lockedShortsRef != null) {
      this.logger.debug('lockLoadVideo: already locked');
      scheduleRestore();
      return;
    }
    this.lockedShortsRef = shorts;
    this.originalLoadVideo = shorts.loadVideo ?? null;

    shorts.loadVideo = (index: number): void => {
      this.logger.debug('loadVideo intercepted', { index });
      scheduleRestore();
    };
    scheduleRestore();
    this.logger.debug('lockLoadVideo: loadVideo replaced, will restore after idle');
  }

  private restoreLoadVideoLock(): void {
    if (this.lockedShortsRef == null) return;
    if (this.restoreLoadVideoAfterId != null) {
      clearTimeout(this.restoreLoadVideoAfterId);
      this.restoreLoadVideoAfterId = null;
    }
    this.lockedShortsRef.loadVideo = this.originalLoadVideo ?? undefined;
    this.logger.debug('lockLoadVideo: original loadVideo restored');
    this.lockedShortsRef = null;
    this.originalLoadVideo = null;
  }
}
