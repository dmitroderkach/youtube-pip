import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Provides the PiP window reference.
 * Set by PiPManager when PiP opens, cleared when PiP closes.
 */
@injectable()
export class PipWindowProvider {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;

  constructor(@inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create('PipWindowProvider');
  }

  /**
   * Set the PiP window (called by PiPManager when PiP opens/closes).
   */
  public setWindow(pipWindow: Nullable<Window>): void {
    this.pipWindow = pipWindow;
    this.logger.debug('PipWindowProvider.setWindow', { hasWindow: pipWindow !== null });
  }

  /**
   * Get the PiP window.
   */
  public getWindow(): Nullable<Window> {
    return this.pipWindow;
  }
}
