import { vi } from 'vitest';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { Container } from '../di/container';
import type { ServiceId } from '../di/types';
import { PlayerManager } from '../core/PlayerManager';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { YtActionSender } from '../core/YtActionSender';
import { NavigationHandler } from '../core/NavigationHandler';
import { SeekHandler } from '../handlers/SeekHandler';
import { ResizeTracker } from '../ui/ResizeTracker';
import { MenuObserver } from '../ui/MenuObserver';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { MiniPlayerController } from '../ui/MiniPlayerController';
import { DocumentFocusHandler } from '../handlers/DocumentFocusHandler';
import { LikeButtonHandler } from '../handlers/LikeButtonHandler';

const noop = () => {};

/**
 * Creates a mock Logger (all methods no-op).
 * Use in tests to avoid real logging and localStorage.
 */
export function createMockLogger(): Logger {
  return {
    log: vi.fn(noop),
    warn: vi.fn(noop),
    error: vi.fn(noop),
    debug: vi.fn(noop),
  } as unknown as Logger;
}

/**
 * Creates a mock LoggerFactory that returns the same mock logger for any scope.
 */
export function createMockLoggerFactory(): LoggerFactory {
  const logger = createMockLogger();
  return {
    create: () => logger,
  } as unknown as LoggerFactory;
}

/** Classes that tests commonly resolve. Add more as needed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEST_BINDINGS: readonly (new (...args: any[]) => any)[] = [
  PlayerManager,
  YtdAppProvider,
  PipWindowProvider,
  YtActionSender,
  NavigationHandler,
  SeekHandler,
  ResizeTracker,
  MenuObserver,
  ContextMenuHandler,
  MiniPlayerController,
  DocumentFocusHandler,
  LikeButtonHandler,
];

/**
 * Creates a test DI container with:
 * - LoggerFactory bound to a mock (no-op logger).
 * - All TEST_BINDINGS registered with toSelf().
 *
 * In each test you can override any dependency with a mock, then get the class under test:
 *
 *   const c = createTestContainer();
 *   c.bind(PlayerManager).toInstance(myMockPlayerManager);
 *   const sender = c.get(YtActionSender);
 */
export function createTestContainer(): Container {
  const container = new Container();

  container.bind(LoggerFactory).toInstance(createMockLoggerFactory());

  for (const Ctor of TEST_BINDINGS) {
    container.bind(Ctor as ServiceId).toSelf();
  }

  return container;
}
