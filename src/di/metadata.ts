/**
 * Metadata storage for DI decorators (no reflect-metadata dependency)
 */

import type { ServiceId } from './types';

const paramMetadata = new WeakMap<object, ServiceId[]>();

export function setParamMetadata(target: object, index: number, token: ServiceId): void {
  const existing = paramMetadata.get(target) ?? [];
  existing[index] = token;
  paramMetadata.set(target, existing);
}

export function getParamMetadata(target: object): ServiceId[] | undefined {
  return paramMetadata.get(target);
}
