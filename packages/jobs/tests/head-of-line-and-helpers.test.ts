import { describe, expect, it } from 'vitest';
import { redactLifecyclePayload, registerAddonJobsAndConsumers } from '../src/index.js';

describe('jobs lifecycle & addon registration helpers', () => {
  it('redacts default, hidden, and sensitive fields from lifecycle payloads', () => {
    const redacted = redactLifecyclePayload(
      {
        id: 1,
        name: 'Alice',
        password: 'hash',
        secret: 'top',
        api_key: 'xyz',
        internal_note: 'hidden',
      },
      ['internal_note'],
      ['api_key']
    );
    expect(redacted).toEqual({ id: 1, name: 'Alice' });
  });

  it('registers addon jobHandlers and outboxConsumers, rejects duplicates, and disposes cleanly', () => {
    const dispose = registerAddonJobsAndConsumers([
      {
        name: 'addon-a',
        jobHandlers: [
          {
            name: 'addon_a.ping',
            version: 1,
            parse: (v) => v,
            run: async () => {},
          },
        ],
        outboxConsumers: [
          {
            eventType: 'record.created',
            handler: async () => {},
          },
        ],
      },
    ]);
    dispose();

    expect(() =>
      registerAddonJobsAndConsumers([
        {
          name: 'addon-a',
          jobHandlers: [{ name: 'dup.job', version: 1, parse: (v) => v, run: async () => {} }],
        },
        {
          name: 'addon-b',
          jobHandlers: [{ name: 'dup.job', version: 1, parse: (v) => v, run: async () => {} }],
        },
      ])
    ).toThrow(/Duplicate job handler "dup.job"/);
  });
});
