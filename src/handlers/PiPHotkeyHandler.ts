import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { PIP_HOTKEY } from '../constants';
import { isPlainKey, isTypingTarget } from '../utils/hotkeys';
import type { Nullable } from '../types/app';
import { inject, injectable } from '../di';

/**
 * PIP_HOTKEY in the PiP window closes it (the page's key opens PiP: PiPEntryPoints). Closing the window runs the
 * usual return of the player (PiPManager listens to its pagehide).
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
    this.pipWindow?.document.addEventListener('keydown', this.onKeyDown);
  }

  public cleanup(): void {
    this.pipWindow?.document.removeEventListener('keydown', this.onKeyDown);
    this.pipWindow = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || !isPlainKey(e, PIP_HOTKEY) || isTypingTarget(e.target)) return;
    e.preventDefault();
    this.logger.log('Closing PiP from the hotkey');
    this.pipWindow?.close();
  };
}
