/**
 * Global type declarations for browser APIs
 */

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disablePictureInPicture?: boolean;
}

interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

/**
 * Extended Media Session actions including Chrome-specific ones
 */
type ExtendedMediaSessionAction = MediaSessionAction | 'enterpictureinpicture';

/**
 * Extend MediaSession to support Chrome-specific actions
 */
interface MediaSession {
  setActionHandler(
    action: ExtendedMediaSessionAction,
    handler: MediaSessionActionHandler | null
  ): void;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
  ytcfg?: {
    data_?: {
      INNERTUBE_CONTEXT?: {
        client?: {
          clientVersion?: string;
        };
      };
      EXPERIMENT_FLAGS?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}
