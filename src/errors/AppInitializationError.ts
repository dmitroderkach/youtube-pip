import { AppError } from './AppError';

/**
 * Error thrown during application initialization.
 */
export class AppInitializationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'AppInitializationError';
  }
}
