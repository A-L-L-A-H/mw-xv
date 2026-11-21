export interface ServiceToken<T> {
  readonly key: string;
  readonly serviceType?: new (...args: never[]) => T;
}

export interface ServiceRegistration<T> {
  readonly token: ServiceToken<T>;
  readonly value: T;
}

export class ServiceContainer {
  private readonly services = new Map<string, unknown>();

  register<T>(token: ServiceToken<T>, value: T): void {
    this.services.set(token.key, value);
  }

  get<T>(token: ServiceToken<T>): T {
    if (!this.services.has(token.key)) {
      throw new Error(`Service '${token.key}' is not registered.`);
    }
    return this.services.get(token.key) as T;
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.services.has(token.key);
  }

  list(): string[] {
    return [...this.services.keys()];
  }
}

export function createServiceToken<T>(key: string): ServiceToken<T> {
  return { key };
}
