import { AppError } from './AppError';

/**
 * Error thrown during PiP operations.
 */
export class PiPError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'PiPError';
  }
}
