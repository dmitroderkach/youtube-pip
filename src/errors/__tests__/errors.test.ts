import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import { AppInitializationError } from '../AppInitializationError';
import { AppRuntimeError } from '../AppRuntimeError';
import { PiPError } from '../PiPError';
import { PiPCriticalError } from '../PiPCriticalError';

describe('AppError', () => {
  class ConcreteError extends AppError {
    constructor(message: string, cause?: unknown) {
      super(message, cause);
      this.name = 'ConcreteError';
    }
  }

  it('sets message and cause', () => {
    const err = new ConcreteError('msg', { foo: 1 });
    expect(err.message).toBe('msg');
    expect(err.cause).toEqual({ foo: 1 });
  });

  it('works without cause', () => {
    const err = new ConcreteError('msg');
    expect(err.cause).toBeUndefined();
  });

  it('captureStackTrace branch when not available', () => {
    const errProto = Error as unknown as Record<string, unknown>;
    const orig = errProto['captureStackTrace'];
    errProto['captureStackTrace'] = undefined;
    const err = new ConcreteError('no stack');
    expect(err.message).toBe('no stack');
    errProto['captureStackTrace'] = orig;
  });
});

describe('AppInitializationError', () => {
  it('extends AppError with cause', () => {
    const cause = new Error('inner');
    const err = new AppInitializationError('init failed', cause);
    expect(err.message).toBe('init failed');
    expect(err.cause).toBe(cause);
  });
});

describe('AppRuntimeError', () => {
  it('extends AppError', () => {
    const err = new AppRuntimeError('runtime');
    expect(err.message).toBe('runtime');
  });
});

describe('PiPError', () => {
  it('sets name and message', () => {
    const err = new PiPError('pip failed');
    expect(err.name).toBe('PiPError');
    expect(err.message).toBe('pip failed');
  });
});

describe('PiPCriticalError', () => {
  it('sets name and message', () => {
    const err = new PiPCriticalError('critical');
    expect(err.name).toBe('PiPCriticalError');
    expect(err.message).toBe('critical');
  });
});
