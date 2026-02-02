import { AppError } from './AppError';

/**
 * Error thrown for general runtime errors (non-initialization).
 */
export class AppRuntimeError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'AppRuntimeError';
  }
}
