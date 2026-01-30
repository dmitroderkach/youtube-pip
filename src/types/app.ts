/**
 * Application-wide types (non-YouTube)
 */

/** T | null */
export type Nullable<T> = T | null;

/** Copy menu action: video URL, URL at current time, or embed code */
export enum CopyType {
  VIDEO_URL = 'video_url',
  URL_AT_TIME = 'url_at_time',
  EMBED = 'embed',
}

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
