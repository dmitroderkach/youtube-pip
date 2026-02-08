import { describe, it, expect } from 'vitest';
import { inject, injectable } from '../decorators';
import { getParamMetadata, isInjectable } from '../metadata';

describe('inject', () => {
  it('sets param metadata at given index', () => {
    const token = Symbol('X');
    const target = function WithInject() {};
    const decorator = inject(token);
    decorator(target, undefined, 0);
    expect(getParamMetadata(target)).toEqual([token]);
  });
});

describe('injectable', () => {
  it('marks target as injectable', () => {
    class NotYet {}
    expect(isInjectable(NotYet)).toBe(false);
    const dec = injectable();
    dec(NotYet);
    expect(isInjectable(NotYet)).toBe(true);
  });
});
