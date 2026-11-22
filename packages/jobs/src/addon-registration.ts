import { registerJobHandler, registerOutboxConsumer, type JobHandler } from './runtime.js';

export type AddonOutboxConsumerHandler = Parameters<typeof registerOutboxConsumer>[1];

export interface AddonOutboxConsumerSpec {
  readonly eventType: string;
  readonly handler: AddonOutboxConsumerHandler;
}

export interface AddonJobManifestLike {
  readonly name: string;
  readonly jobHandlers?: readonly JobHandler<unknown>[];
  readonly outboxConsumers?: readonly AddonOutboxConsumerSpec[];
}

/**
 * Registers all `jobHandlers` and `outboxConsumers` declared on active addon manifests.
 * Rejects duplicate job handler names across addons and returns a clean deregister function.
 */
export function registerAddonJobsAndConsumers(addons: readonly AddonJobManifestLike[]): () => void {
  const seenHandlers = new Set<string>();
  const disposers: Array<() => void> = [];

  try {
    for (const addon of addons) {
      for (const handler of addon.jobHandlers ?? []) {
        if (seenHandlers.has(handler.name)) {
          throw new Error(
            `Duplicate job handler "${handler.name}" declared by addon "${addon.name}"`
          );
        }
        seenHandlers.add(handler.name);
        disposers.push(registerJobHandler(handler));
      }
      for (const consumer of addon.outboxConsumers ?? []) {
        disposers.push(registerOutboxConsumer(consumer.eventType, consumer.handler));
      }
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
    throw error;
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
