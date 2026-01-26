/**
 * Application-wide types (non-YouTube)
 */

/** T | null */
export type Nullable<T> = T | null;

/** Document or Element – e.g. for querySelector root */
export type DocumentOrElement = Document | Element;

/** Cleanup fn invoked before returning player from PiP to main */
export type PiPCleanupCallback = () => void | Promise<void>;

/** Callback when PiP window is ready: init handlers, optionally return cleanup fn */
export type PiPWindowReadyCallback = (
  pipWindow: Window,
  miniplayer: Element
) => void | PiPCleanupCallback | Promise<void | PiPCleanupCallback>;

/** Getter/setter descriptor (e.g. for MediaSession metadata override) */
export interface MetadataPropertyDescriptor {
  get?(): unknown;
  set?(value: unknown): void;
}
