import { AppError } from './AppError';

/**
 * Thrown when a PiP operation has left the YouTube page in a broken state.
 * e.g. Mini player was moved to PiP window but a required DOM element is missing,
 * so the main page cannot be restored correctly.
 */
export class PiPCriticalError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'PiPCriticalError';
  }
}
