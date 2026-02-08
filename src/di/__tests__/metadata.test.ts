import { describe, it, expect } from 'vitest';
import { setParamMetadata, getParamMetadata, setInjectable, isInjectable } from '../metadata';

describe('metadata', () => {
  it('setParamMetadata and getParamMetadata store and return param tokens', () => {
    const target = function Foo() {};
    setParamMetadata(target, 0, 'TokenA');
    setParamMetadata(target, 1, 'TokenB');
    expect(getParamMetadata(target)).toEqual(['TokenA', 'TokenB']);
  });

  it('getParamMetadata returns undefined for unknown target', () => {
    expect(getParamMetadata(function Unknown() {})).toBeUndefined();
  });

  it('setParamMetadata extends existing array by index', () => {
    const target = function Bar() {};
    setParamMetadata(target, 2, 'Third');
    expect(getParamMetadata(target)).toEqual([undefined, undefined, 'Third']);
  });

  it('setInjectable and isInjectable mark class as injectable', () => {
    const target = function Baz() {};
    expect(isInjectable(target)).toBe(false);
    setInjectable(target);
    expect(isInjectable(target)).toBe(true);
  });
});
