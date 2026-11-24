import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import {
  AUTOMATION_ACTIONS,
  resolveAction,
  type AutomationActionContext,
  type AutomationActionInput,
} from '../src/index.js';
import type { AutomationActionKind } from '../src/models.js';

interface RecordedInsert {
  table: string;
  row: Record<string, unknown>;
}

type TableRegistry = Map<string, number>;

function createDb() {
  const inserts: RecordedInsert[] = [];
  const nextIds: TableRegistry = new Map();

  const db = ((table: string) => ({
    insert(row: Record<string, unknown>) {
      inserts.push({ table, row });
      const id = (nextIds.get(table) ?? 0) + 1;
      nextIds.set(table, id);
      return {
        returning() {
          return Promise.resolve([{ id }]);
        },
      };
    },
  })) as unknown as Knex;

  return { db, inserts, nextIds };
}

function createContext(db: Knex): AutomationActionContext {
  return { db, companyId: 7, ruleId: 42, triggerRef: 'ref-1', dedupeKey: 'k:1' };
}

function makeInput(payload: unknown, config: Record<string, unknown> = {}): AutomationActionInput {
  return { payload, config };
}

function firstInsertFor(inserts: RecordedInsert[], table: string): Record<string, unknown> {
  const found = inserts.find((entry) => entry.table === table);
  if (!found) throw new Error(`no insert recorded for table ${table}`);
  return found.row;
}

describe('action registry', () => {
  it('resolves every registered kind and rejects unknown kinds', () => {
    for (const kind of Object.keys(AUTOMATION_ACTIONS) as AutomationActionKind[]) {
      expect(resolveAction(kind)).toBe(AUTOMATION_ACTIONS[kind]);
    }
    expect(resolveAction('teleport')).toBeNull();
  });
});

describe('notify action', () => {
  it('inserts a notification.deliver outbox event', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.notify(
      createContext(db),
      {},
      makeInput({ recipientId: 5 }, { templateCode: 'lead.hot', severity: 'critical' })
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'outbox_events');
    expect(row.event_type).toBe('notification.deliver');
    expect(row.company_id).toBe(7);
    expect(JSON.parse(String(row.payload))).toMatchObject({
      recipientId: 5,
      templateCode: 'lead.hot',
    });
  });

  it('rejects missing recipient and template', async () => {
    const { db } = createDb();
    const noRecipient = await AUTOMATION_ACTIONS.notify(
      createContext(db),
      { templateCode: 'x' },
      makeInput({})
    );
    expect(noRecipient.ok).toBe(false);
    const noTemplate = await AUTOMATION_ACTIONS.notify(
      createContext(db),
      {},
      makeInput({ recipientId: 5 })
    );
    expect(noTemplate.ok).toBe(false);
    const badSeverity = await AUTOMATION_ACTIONS.notify(
      createContext(db),
      { templateCode: 'x', severity: 'loud' },
      makeInput({ recipientId: 5 })
    );
    expect(badSeverity.ok).toBe(false);
  });
});

describe('enqueue_job action', () => {
  it('inserts a queued job with idempotency key', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.enqueue_job(
      createContext(db),
      { handler: 'report.build', payload: { scope: 'weekly' } },
      makeInput({})
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'jobs');
    expect(row).toMatchObject({
      handler: 'report.build',
      status: 'queued',
      company_id: 7,
      idempotency_key: 'k:1',
    });
  });

  it('rejects invalid handler and non-object payload', async () => {
    const { db } = createDb();
    const badHandler = await AUTOMATION_ACTIONS.enqueue_job(
      createContext(db),
      { handler: 'BAD HANDLER!' },
      makeInput({})
    );
    expect(badHandler.ok).toBe(false);
    const badPayload = await AUTOMATION_ACTIONS.enqueue_job(
      createContext(db),
      { handler: 'report.build', payload: 'scalar' },
      makeInput({})
    );
    expect(badPayload.ok).toBe(false);
  });
});

describe('create_task action', () => {
  it('inserts a project task', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.create_task(
      createContext(db),
      { projectId: 1, stageId: 2, title: 'Follow up', code: 'T-01' },
      makeInput({})
    );
    expect(result.ok).toBe(true);
    expect(firstInsertFor(inserts, 'project_tasks')).toMatchObject({
      project_id: 1,
      stage_id: 2,
      code: 'T-01',
      priority: 'normal',
      company_id: 7,
    });
  });

  it('rejects invalid project/stage/title/code/priority', async () => {
    const { db } = createDb();
    const base = { projectId: 1, stageId: 2, title: 't', code: 'T1' };
    expect(
      (
        await AUTOMATION_ACTIONS.create_task(
          createContext(db),
          { ...base, projectId: 0 },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.create_task(
          createContext(db),
          { ...base, stageId: -1 },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.create_task(
          createContext(db),
          { ...base, title: '  ' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.create_task(
          createContext(db),
          { ...base, code: '1 bad' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.create_task(
          createContext(db),
          { ...base, priority: 'asap' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('record_income action', () => {
  it('enqueues the income sync job', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.record_income(
      createContext(db),
      { amountMinor: 150000, currency: 'IDR', memo: 'invoice 7' },
      makeInput({})
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'jobs');
    expect(row.handler).toBe('income.sync-entry');
    expect(JSON.parse(String(row.payload))).toMatchObject({
      amountMinor: 150000,
      currency: 'IDR',
      source: 'automation.rule',
      ruleId: 42,
    });
  });

  it('rejects non-positive amounts and malformed currency', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.record_income(
          createContext(db),
          { amountMinor: 0, currency: 'IDR' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.record_income(
          createContext(db),
          { amountMinor: 10, currency: 'idr' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('publish_content action', () => {
  it('inserts a content publish job', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.publish_content(
      createContext(db),
      { contentId: 9, channel: 'newsletter' },
      makeInput({})
    );
    expect(result.ok).toBe(true);
    expect(firstInsertFor(inserts, 'content_publish_jobs')).toMatchObject({
      content_id: 9,
      channel: 'newsletter',
      status: 'queued',
      source_rule_id: 42,
    });
  });

  it('rejects invalid contentId and channel', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.publish_content(
          createContext(db),
          { contentId: 0, channel: 'x' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.publish_content(
          createContext(db),
          { contentId: 9, channel: '  ' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('post_social action', () => {
  it('inserts a post queue row', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.post_social(
      createContext(db),
      { accountId: 3, body: 'Hello world' },
      makeInput({})
    );
    expect(result.ok).toBe(true);
    expect(firstInsertFor(inserts, 'post_queue')).toMatchObject({
      account_id: 3,
      body: 'Hello world',
      status: 'queued',
    });
  });

  it('rejects invalid accountId and empty body', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.post_social(
          createContext(db),
          { accountId: 0, body: 'x' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.post_social(
          createContext(db),
          { accountId: 3, body: '' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('run_bot action', () => {
  it('inserts a bot session', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.run_bot(
      createContext(db),
      { botId: 11, sessionKind: 'greeting' },
      makeInput({ greeting: 'hi' })
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'bot_sessions');
    expect(row).toMatchObject({ bot_id: 11, session_kind: 'greeting', status: 'queued' });
    expect(JSON.parse(String(row.input))).toEqual({ greeting: 'hi' });
  });

  it('rejects invalid botId', async () => {
    const { db } = createDb();
    expect(
      (await AUTOMATION_ACTIONS.run_bot(createContext(db), { botId: 'x' }, makeInput({}))).ok
    ).toBe(false);
  });
});

describe('sync_ecommerce action', () => {
  it('inserts a marketplace sync job', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.sync_ecommerce(
      createContext(db),
      { marketplace: 'shopee', direction: 'push' },
      makeInput({ sku: 'SKU-1' })
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'marketplace_sync_jobs');
    expect(row).toMatchObject({ marketplace: 'shopee', direction: 'push', status: 'queued' });
    expect(JSON.parse(String(row.payload))).toEqual({ sku: 'SKU-1' });
  });

  it('rejects invalid marketplace and direction', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.sync_ecommerce(
          createContext(db),
          { marketplace: '' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await AUTOMATION_ACTIONS.sync_ecommerce(
          createContext(db),
          { marketplace: 'x', direction: 'sideways' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('run_public_tool action', () => {
  it('inserts a public tool invocation', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.run_public_tool(
      createContext(db),
      { tool: 'weather.lookup' },
      makeInput({ city: 'Jakarta' })
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'public_tool_invocations');
    expect(row).toMatchObject({
      tool_name: 'weather.lookup',
      status: 'queued',
      source_rule_id: 42,
    });
    expect(JSON.parse(String(row.payload))).toEqual({ city: 'Jakarta' });
  });

  it('rejects invalid tool names', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.run_public_tool(
          createContext(db),
          { tool: 'BAD NAME' },
          makeInput({})
        )
      ).ok
    ).toBe(false);
  });
});

describe('run_agent action', () => {
  it('enqueues an agent run job', async () => {
    const { db, inserts } = createDb();
    const result = await AUTOMATION_ACTIONS.run_agent(
      createContext(db),
      { agentId: 5, workContractId: 6 },
      makeInput({ question: 'why' })
    );
    expect(result.ok).toBe(true);
    const row = firstInsertFor(inserts, 'jobs');
    expect(row.handler).toBe('ai.run-agent');
    expect(JSON.parse(String(row.payload))).toMatchObject({
      agentId: 5,
      workContractId: 6,
      source: 'automation.rule',
      ruleId: 42,
    });
  });

  it('rejects invalid agentId and workContractId', async () => {
    const { db } = createDb();
    expect(
      (
        await AUTOMATION_ACTIONS.run_agent(
          createContext(db),
          { agentId: 0, workContractId: 1 },
          makeInput({})
        )
      ).ok
    ).toBe(false);
    expect(
      (await AUTOMATION_ACTIONS.run_agent(createContext(db), { agentId: 1 }, makeInput({}))).ok
    ).toBe(false);
  });
});
