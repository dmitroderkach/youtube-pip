import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { PIP_HOTKEY } from '../constants';
import { isPlainKey, isTypingTarget } from '../utils/hotkeys';
import type { Nullable } from '../types/app';
import { inject, injectable } from '../di';

/**
 * PIP_HOTKEY in the PiP window closes it and brings the video's tab to the front (the page's key opens PiP:
 * PiPEntryPoints). Closing the window runs the usual return of the player (PiPManager listens to its pagehide).
 */
@injectable()
export class PiPHotkeyHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('PiPHotkeyHandler');
  }

  public initialize(): void {
    this.pipWindow = this.pipWindowProvider.getWindow();
    // Capture phase, registered before DocumentFocusHandler: it forwards every key in PiP to the player / ytd-app and
    // stops the event, so a later or bubbling listener would never see the key
    this.pipWindow?.document.addEventListener('keydown', this.onKeyDown, true);
  }

  public cleanup(): void {
    this.pipWindow?.document.removeEventListener('keydown', this.onKeyDown, true);
    this.pipWindow = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || !isPlainKey(e, PIP_HOTKEY) || isTypingTarget(e.target)) return;
    e.preventDefault();
    this.logger.log('Closing PiP from the hotkey');
    // Bring the video's tab to the front first, like the PiP window's own "back to tab" button: Chrome lets a PiP
    // window focus its opener with the key press's user activation (our code runs in the opener, `window`)
    window.focus();
    this.pipWindow?.close();
  };
}
