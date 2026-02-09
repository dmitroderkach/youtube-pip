import { vi } from 'vitest';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { Container } from '../di/container';

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

/**
 * Creates a LoggerFactory that returns the given logger. Use when you need a custom logger in tests.
 */
export function createLoggerFactoryWithLogger(logger: Logger): LoggerFactory {
  return {
    create: () => logger,
  } as unknown as LoggerFactory;
}

/**
 * Creates an empty test DI container with only LoggerFactory (mock). No real implementations.
 * Each test must bind the class under test (.toSelf()) and all its dependencies (.toInstance(mock)).
 */
export function createTestContainer() {
  const container = new Container();
  container.bind(LoggerFactory).toInstance(createMockLoggerFactory());
  return container;
}
