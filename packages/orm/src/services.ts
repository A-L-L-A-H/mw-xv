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
  private readonly disposers = new Map<string, () => Promise<void> | void>();

  register<T>(token: ServiceToken<T>, value: T, dispose?: () => Promise<void> | void): void {
    this.services.set(token.key, value);
    if (dispose) this.disposers.set(token.key, dispose);
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

  async disposeAll(): Promise<void> {
    for (const [key, dispose] of [...this.disposers.entries()].reverse()) {
      try {
        await dispose();
      } finally {
        this.disposers.delete(key);
      }
    }
  }
}

export function createServiceToken<T>(key: string): ServiceToken<T> {
  return { key };
}
