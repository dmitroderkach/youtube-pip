import { describe, it, expect } from 'vitest';
import { Container } from '../container';
import type { Constructor } from '../types';
import { inject, injectable } from '../decorators';
import { AppRuntimeError } from '../../errors/AppRuntimeError';

@injectable()
class NoDeps {
  /* no constructor params */
}

@injectable()
class WithDep {
  constructor(@inject(NoDeps) public readonly dep: NoDeps) {}
}

@injectable()
class CircularA {
  constructor(@inject('CircularB') public b: CircularB) {}
}
@injectable()
class CircularB {
  constructor(@inject('CircularA') public a: CircularA) {}
}

function NotInjectable() {
  /* not decorated */
}

@injectable()
class MissingParamDec {
  constructor(_x: string) {
    /* param 0 not decorated */
  }
}

describe('Container', () => {
  it('get throws when no binding', () => {
    const c = new Container();
    expect(() => c.get('NoBinding')).toThrow(AppRuntimeError);
    expect(() => c.get('NoBinding')).toThrow(/No binding/);
  });

  it('bind().to() and get return singleton', () => {
    const c = new Container();
    c.bind('Foo').to(NoDeps);
    const a = c.get<NoDeps>('Foo');
    const b = c.get<NoDeps>('Foo');
    expect(a).toBe(b);
  });

  it('bind().toSelf() requires constructor token', () => {
    const c = new Container();
    expect(() => c.bind('StringToken').toSelf()).toThrow(AppRuntimeError);
    expect(() => c.bind('StringToken').toSelf()).toThrow(/toSelf/);
  });

  it('bind().toSelf() binds class to itself', () => {
    const c = new Container();
    c.bind(NoDeps).toSelf();
    expect(c.get(NoDeps)).toBeInstanceOf(NoDeps);
  });

  it('bind().toTransient() returns new instance each time', () => {
    const c = new Container();
    c.bind('T').toTransient(NoDeps);
    const a = c.get<NoDeps>('T');
    const b = c.get<NoDeps>('T');
    expect(a).not.toBe(b);
  });

  it('get resolves dependency chain', () => {
    const c = new Container();
    c.bind(NoDeps).toSelf();
    c.bind(WithDep).toSelf();
    const withDep = c.get(WithDep) as WithDep;
    expect(withDep.dep).toBeInstanceOf(NoDeps);
  });

  it('get throws on circular dependency', () => {
    const c = new Container();
    c.bind('CircularA').to(CircularA);
    c.bind('CircularB').to(CircularB);
    expect(() => c.get('CircularA')).toThrow(AppRuntimeError);
    expect(() => c.get('CircularA')).toThrow(/Circular dependency/);
  });

  it('get throws when implementation is not injectable', () => {
    const c = new Container();
    c.bind('NotInjectable').to(NotInjectable as unknown as Constructor);
    expect(() => c.get('NotInjectable')).toThrow(AppRuntimeError);
    expect(() => c.get('NotInjectable')).toThrow(/@injectable/);
  });

  it('get throws when constructor param is not decorated', () => {
    const c = new Container();
    c.bind('MissingParamDec').to(MissingParamDec);
    expect(() => c.get('MissingParamDec')).toThrow(AppRuntimeError);
    expect(() => c.get('MissingParamDec')).toThrow(/@inject/);
  });

  it('bind().toInstance() returns the same instance', () => {
    const c = new Container();
    const instance = { id: 1 };
    c.bind('Prepared').toInstance(instance);
    expect(c.get<{ id: number }>('Prepared')).toBe(instance);
    expect(c.get<{ id: number }>('Prepared')).toEqual({ id: 1 });
  });

  it('unbind removes binding', () => {
    const c = new Container();
    c.bind('Foo').to(NoDeps);
    c.unbind('Foo');
    expect(() => c.get('Foo')).toThrow(/No binding/);
  });

  it('tokenName uses function name or string', () => {
    const c = new Container();
    c.bind(NoDeps).toSelf();
    expect(c.get(NoDeps)).toBeDefined();
    const sym = Symbol('MySym');
    c.bind(sym).to(NoDeps);
    expect(c.get(sym)).toBeDefined();
  });

  it('tokenName uses "anonymous" for function with no name', () => {
    const Anon = function () {};
    const c = new Container();
    c.bind(Anon as unknown as import('../types').ServiceId).to(NoDeps);
    expect(c.get(Anon as unknown as import('../types').ServiceId)).toBeDefined();
  });
});
