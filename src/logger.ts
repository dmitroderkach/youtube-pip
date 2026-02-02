import { DEBUG_FLAG } from './constants';

/**
 * Format date as YYYY-MM-DD:HH:mm:ss.SSS using Intl.DateTimeFormat
 */
const timestampFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTimestamp(date: Date): string {
  // Intl.DateTimeFormat outputs: "2026-01-27, 12:34:56"
  // Add milliseconds manually: "2026-01-27:12:34:56.789"
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return timestampFormatter.format(date).replace(', ', ':') + '.' + ms;
}

const PREFIX_BRAND = '[YouTube PiP]';
const PREFIX_SCOPE = (scope: string) => `[${scope}]` as const;

/** Timestamp YYYY-MM-DD:HH:mm:ss.SSS – blue */
const STYLE_TIMESTAMP = 'color: #3b82f6; font-weight: 500;';
/** [YouTube PiP] – indigo, bold */
const STYLE_BRAND = 'color: #6366f1; font-weight: 600;';
/** [scope] – amber */
const STYLE_SCOPE = 'color: #f59e0b; font-weight: 500;';
/** Info (log) message – light green */
const STYLE_MSG_INFO = 'color: #86efac;';
/** Warn message – light yellow */
const STYLE_MSG_WARN = 'color: #fde047;';
/** Error message – light red */
const STYLE_MSG_ERROR = 'color: #f87171;';
/** Debug message – muted gray */
const STYLE_MSG_DEBUG = 'color: #a1a1aa;';

/**
 * Logger class for conditional console logging with module scope.
 * Only logs when DEBUG_FLAG is set in localStorage (except error, always logged).
 * Uses %c styling: [YouTube PiP] / [scope] / message in separate colors.
 * Message and optional metadata are passed to console as-is (objects stay expandable).
 */
export class Logger {
  private static instances = new Map<string, Logger>();
  private static enabled = false;
  private static storageListenerAdded = false;
  private static globalMetadata: Record<string, unknown> = {};

  private readonly scope: string;

  private constructor(scope: string) {
    this.scope = scope;
  }

  /**
   * Get logger instance for the given module scope.
   */
  public static getInstance(scope: string): Logger {
    if (!Logger.storageListenerAdded) {
      Logger.enabled = Logger.checkDebugFlag();
      window.addEventListener('storage', () => {
        Logger.enabled = Logger.checkDebugFlag();
      });
      Logger.storageListenerAdded = true;
    }

    let instance = Logger.instances.get(scope);
    if (!instance) {
      instance = new Logger(scope);
      Logger.instances.set(scope, instance);
    }
    return instance;
  }

  private static checkDebugFlag(): boolean {
    try {
      return localStorage.getItem(DEBUG_FLAG) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Set global metadata that will be included in all log messages.
   * Should be called before initializing the application.
   */
  public static setGlobalMetadata(metadata: Record<string, unknown>): void {
    Logger.globalMetadata = { ...metadata };
  }

  private styled(
    fn: (template: string, ...rest: unknown[]) => void,
    msgStyle: string,
    message: string,
    meta?: unknown
  ): void {
    const ts = formatTimestamp(new Date());
    const escaped = message.replace(/%/g, '%%');
    const template = `%c${ts}%c ${PREFIX_BRAND}%c${PREFIX_SCOPE(this.scope)}%c ${escaped}`;

    // Build arguments: template, styles, meta (if provided), global metadata (if exists)
    const args: [string, ...unknown[]] = [
      template,
      STYLE_TIMESTAMP,
      STYLE_BRAND,
      STYLE_SCOPE,
      msgStyle,
    ];

    // Add user-provided metadata first
    if (meta !== undefined) {
      args.push(meta);
    }

    // Add global metadata after user metadata (if exists)
    if (Object.keys(Logger.globalMetadata).length > 0) {
      args.push(Logger.globalMetadata);
    }

    fn(...args);
  }

  /**
   * Log message if debug is enabled. Info level – light green. Optional metadata as second arg.
   */
  public log(message: string, meta?: unknown): void {
    if (Logger.enabled) {
      this.styled(console.log.bind(console), STYLE_MSG_INFO, message, meta);
    }
  }

  /**
   * Log warning if debug is enabled. Optional metadata as second arg.
   */
  public warn(message: string, meta?: unknown): void {
    if (Logger.enabled) {
      this.styled(console.warn.bind(console), STYLE_MSG_WARN, message, meta);
    }
  }

  /**
   * Log error (always logged, regardless of debug flag). Optional metadata as second arg.
   */
  public error(message: string, meta?: unknown): void {
    this.styled(console.error.bind(console), STYLE_MSG_ERROR, message, meta);
  }

  /**
   * Log debug message if debug is enabled. Optional metadata as second arg.
   */
  public debug(message: string, meta?: unknown): void {
    if (Logger.enabled) {
      this.styled(console.debug.bind(console), STYLE_MSG_DEBUG, message, meta);
    }
  }
}

/**
 * Factory for creating Logger instances by scope. Injected via DI (transient).
 */
export class LoggerFactory {
  public create(scope: string): Logger {
    return Logger.getInstance(scope);
  }
}
