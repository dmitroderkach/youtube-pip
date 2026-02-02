/**
 * Metadata storage for DI decorators (no reflect-metadata dependency)
 */

import type { ServiceId } from './types';

const paramMetadata = new WeakMap<object, ServiceId[]>();
const injectableClasses = new WeakSet<object>();

export function setParamMetadata(target: object, index: number, token: ServiceId): void {
  const existing = paramMetadata.get(target) ?? [];
  existing[index] = token;
  paramMetadata.set(target, existing);
}

export function getParamMetadata(target: object): ServiceId[] | undefined {
  return paramMetadata.get(target);
}

export function setInjectable(target: object): void {
  injectableClasses.add(target);
}

export function isInjectable(target: object): boolean {
  return injectableClasses.has(target);
}
