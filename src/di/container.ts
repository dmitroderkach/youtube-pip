import { getParamMetadata, isInjectable } from './metadata';
import type { Constructor, ServiceId } from './types';
import { AppRuntimeError } from '../errors/AppRuntimeError';

type Scope = 'singleton' | 'transient';

interface Binding {
  token: ServiceId;
  implementation: Constructor;
  scope: Scope;
  instance?: unknown;
}

export class Container {
  private readonly bindings = new Map<ServiceId, Binding>();

  /** Bind by Symbol/string token or by class constructor */
  public bind<_T>(token: ServiceId): BindingTo {
    return {
      to: (implementation: Constructor) => {
        this.bindings.set(token, {
          token,
          implementation,
          scope: 'singleton',
        });
      },
      toSelf: (): void => {
        if (typeof token !== 'function') {
          throw new AppRuntimeError('toSelf() requires a class constructor as token');
        }
        this.bindings.set(token, {
          token,
          implementation: token as Constructor,
          scope: 'singleton',
        });
      },
      toTransient: (implementation: Constructor) => {
        this.bindings.set(token, {
          token,
          implementation,
          scope: 'transient',
        });
      },
      toInstance: (instance: unknown) => {
        this.bindings.set(token, {
          token,
          /* v8 ignore next -- factory never called, instance returned directly */
          implementation: (() => instance) as unknown as Constructor,
          scope: 'singleton',
          instance,
        });
      },
    };
  }

  public get<T>(token: ServiceId, resolutionStack = new Set<ServiceId>()): T {
    const name = this.tokenName(token);
    const binding = this.bindings.get(token);

    if (!binding) {
      throw new AppRuntimeError(`No binding for ${name}`);
    }

    if (binding.instance !== undefined) {
      return binding.instance as T;
    }

    if (resolutionStack.has(token)) {
      const chain = [...resolutionStack, token].map((t) => this.tokenName(t)).join(' → ');
      throw new AppRuntimeError(`Circular dependency detected: ${chain}`);
    }

    resolutionStack.add(token);
    try {
      const Ctor = binding.implementation;
      if (!isInjectable(Ctor)) {
        throw new AppRuntimeError(`${this.tokenName(token)} must be decorated with @injectable()`);
      }
      const paramTokens = getParamMetadata(Ctor) ?? [];
      const paramCount = (Ctor as { length: number }).length;
      for (let i = 0; i < paramCount; i++) {
        if (paramTokens[i] === undefined) {
          throw new AppRuntimeError(
            `${this.tokenName(token)}: constructor parameter at index ${i} must be decorated with @inject(token)`
          );
        }
      }
      const args = paramTokens.map((t) => this.get(t as ServiceId, resolutionStack));

      const instance = new (Ctor as new (...args: unknown[]) => T)(...args);

      if (binding.scope === 'singleton') {
        binding.instance = instance;
      }

      return instance;
    } finally {
      resolutionStack.delete(token);
    }
  }

  private tokenName(token: ServiceId): string {
    return typeof token === 'function' ? token.name || 'anonymous' : String(token);
  }

  public unbind(token: ServiceId): void {
    this.bindings.delete(token);
  }
}

interface BindingTo {
  to(implementation: Constructor): void;
  toSelf(): void;
  toTransient(implementation: Constructor): void;
  toInstance(instance: unknown): void;
}
