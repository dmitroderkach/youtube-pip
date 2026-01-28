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

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
  ytcfg?: {
    data_?: {
      INNERTUBE_CONTEXT?: {
        client?: {
          clientVersion?: string;
        };
      };
    };
  };
}
