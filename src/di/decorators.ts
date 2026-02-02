import { setParamMetadata } from './metadata';
import type { ServiceId } from './types';

/**
 * Marks a constructor parameter for injection.
 * Accepts Symbol/string token or class constructor (Inversify-style).
 */
export function inject(token: ServiceId) {
  return (target: object, _key: string | symbol | undefined, index: number): void => {
    setParamMetadata(target, index, token);
  };
}

/**
 * Marks a class as injectable (can be resolved by container)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function injectable(): (target: any) => void {
  return (): void => {
    // Mark as injectable; metadata is stored via @inject on params
  };
}
