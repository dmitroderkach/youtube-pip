import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DEBUG_FLAG = 'YOUTUBE_PIP_DEBUG';

describe('Logger', () => {
  let storage: Record<string, string>;
  let Logger: typeof import('../logger').Logger;

  beforeEach(async () => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.resetModules();
    const mod = await import('../logger');
    Logger = mod.Logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getInstance returns same instance for same scope', () => {
    const a = Logger.getInstance('Test');
    const b = Logger.getInstance('Test');
    expect(a).toBe(b);
  });

  it('getInstance returns different instances for different scopes', () => {
    const a = Logger.getInstance('A');
    const b = Logger.getInstance('B');
    expect(a).not.toBe(b);
  });

  it('error is always logged regardless of debug flag', () => {
    Logger.getInstance('E').error('err');
    expect(console.error).toHaveBeenCalled();
  });

  it('log is not called when debug disabled', () => {
    storage[DEBUG_FLAG] = 'false';
    Logger.getInstance('L').log('msg');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('log is called when debug enabled', () => {
    storage[DEBUG_FLAG] = 'true';
    Logger.getInstance('L').log('msg');
    expect(console.log).toHaveBeenCalled();
  });

  it('setGlobalMetadata stores metadata', () => {
    Logger.setGlobalMetadata({ foo: 1 });
    storage[DEBUG_FLAG] = 'true';
    Logger.getInstance('M').log('x');
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { foo: 1 }
    );
  });

  it('warn is called when debug enabled', () => {
    storage[DEBUG_FLAG] = 'true';
    Logger.getInstance('W').warn('w');
    expect(console.warn).toHaveBeenCalled();
  });

  it('debug is called when debug enabled', () => {
    storage[DEBUG_FLAG] = 'true';
    Logger.getInstance('D').debug('d');
    expect(console.debug).toHaveBeenCalled();
  });

  it('handles localStorage getItem throwing', () => {
    vi.mocked(localStorage.getItem).mockImplementationOnce(() => {
      throw new Error('localStorage');
    });
    const log = Logger.getInstance('X');
    expect(() => log.error('e')).not.toThrow();
  });

  it('getInstance adds storage listener and updates enabled on storage event', () => {
    storage[DEBUG_FLAG] = 'false';
    Logger.getInstance('StorageScope');
    storage[DEBUG_FLAG] = 'true';
    window.dispatchEvent(new Event('storage'));
    Logger.getInstance('StorageScope').log('after storage');
    expect(console.log).toHaveBeenCalled();
  });

  it('log with meta and globalMetadata includes both in args', () => {
    Logger.setGlobalMetadata({ global: 1 });
    storage[DEBUG_FLAG] = 'true';
    Logger.getInstance('GM').log('msg', { user: 2 });
    expect(console.log).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { user: 2 },
      { global: 1 }
    );
  });
});

describe('LoggerFactory', () => {
  it('create returns Logger instance for scope', async () => {
    const { Logger: L, LoggerFactory: LF } = await import('../logger');
    const factory = new LF();
    const logger = factory.create('Scope');
    expect(logger).toBeDefined();
    expect(L.getInstance('Scope')).toBe(logger);
  });
});
