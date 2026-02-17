/**
 * Global types for e2e (browser page context).
 */

interface E2EPipApi {
  trigger(action: string): Promise<void>;
  has(action: string): boolean;
}

declare global {
  interface Window {
    __E2E_PIP__?: E2EPipApi;
  }
}

export {};
