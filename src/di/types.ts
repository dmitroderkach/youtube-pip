/**
 * Shared DI types
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor = new (...args: any[]) => any;

/** Token: Symbol, string, or class constructor */
export type ServiceId = symbol | string | Constructor;
