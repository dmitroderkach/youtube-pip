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
  window: Window | null;
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

/**
 * YouTube's job scheduler (scheduler.js), exposed as window.yt.scheduler.instance.
 * Jobs of one priority run in FIFO order; Kevlar's addLowPriorityJob(fn, delay) is addJob(fn, 1, delay).
 */
interface YouTubeSchedulerInstance {
  addJob?(job: () => void, priority: number, delayMs?: number): number;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
  yt?: {
    scheduler?: {
      instance?: YouTubeSchedulerInstance;
    };
  };
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
