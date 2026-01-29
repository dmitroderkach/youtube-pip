/**
 * Application-wide types (non-YouTube)
 */

/** T | null */
export type Nullable<T> = T | null;

/** T | Promise<T> - for values that can be sync or async */
export type MaybePromise<T> = T | Promise<T>;

/** Document or Element – e.g. for querySelector root */
export type DocumentOrElement = Document | Element;

/** Cleanup fn invoked before returning player from PiP to main */
export type PiPCleanupCallback = () => MaybePromise<void>;

/** Callback when PiP window is ready: init handlers, optionally return cleanup fn */
export type PiPWindowReadyCallback = (
  pipWindow: Window,
  miniplayer: Element
) => MaybePromise<void | PiPCleanupCallback>;

/** Getter/setter descriptor (e.g. for MediaSession metadata override) */
export interface MetadataPropertyDescriptor {
  get?(): unknown;
  set?(value: unknown): void;
}
