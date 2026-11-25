import { expect, test, type Page } from '@playwright/test';
import { E2E_SUPERADMIN_PASSWORD } from './constants.js';

interface MockEvent {
  sequence: number;
  type: string;
  payload?: Record<string, unknown>;
}

const approvalFingerprint = 'a'.repeat(64);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill('superadmin');
  await page.getByLabel('Password', { exact: true }).fill(E2E_SUPERADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enter the Shadow' }).click();
  await expect(page).toHaveURL(/\/board$/u);
}

async function installEventSourceMock(page: Page) {
  await page.addInitScript(() => {
    const sources: Array<{
      url: string;
      closed: boolean;
      onopen?: () => void;
      onerror?: () => void;
      listeners: Map<string, Array<(event: { data: string }) => void>>;
    }> = [];
    class MockEventSource {
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readonly readyState = 1;
      closed = false;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor(url: string | URL) {
        this.url = String(url);
        sources.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      removeEventListener(type: string, listener: (event: { data: string }) => void) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
      }
      close() { this.closed = true; }
      dispatchEvent() { return true; }
    }
    Object.defineProperty(window, '__interactiveSources', { value: sources });
    Object.defineProperty(window, '__emitInteractiveSnapshot', {
      value(index: number, payload: unknown) {
        const source = sources[index];
        if (!source || source.closed) throw new Error('EventSource is not open');
        const event = { data: JSON.stringify(payload) };
        for (const listener of source.listeners.get('interactive_snapshot') ?? []) listener(event);
      },
    });
    Object.defineProperty(window, '__interactiveSourceState', {
      value(index: number) {
        const source = sources[index];
        return source ? { url: source.url, closed: source.closed, onerror: Boolean(source.onerror) } : null;
      },
    });
    Object.defineProperty(window, 'EventSource', { value: MockEventSource });
  });
}

async function mockMissionControl(page: Page) {
  await page.route('**/api/ai/agents', (route) => route.fulfill({
    json: { success: true, data: [{ id: 7, company_id: 1, code: 'builder', display_name: 'Builder', status: 'active', role_template: 'builder', is_emergency_stopped: false }] },
  }));
  await page.route('**/api/ai/work-contracts', (route) => route.fulfill({
    json: { success: true, data: [{ id: 9, company_id: 1, code: 'WC-9', title: 'Durable task', objective: 'Test durable operations', assigned_agent_id: 7, reviewer_agent_id: 8, execution_policy_id: 1, requested_by_id: 1, risk_tier: 'R2', data_classification: 'local_only', status: 'running', criteria: [] }] },
  }));
  await page.route('**/api/ai/runs', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/ai/artifacts', (route) => route.fulfill({ json: { success: true, data: [] } }));
}

test('creates, resumes, prompts, requests independent review, and renders a terminal session without raw payloads', async ({ page }) => {
  await login(page);
  await installEventSourceMock(page);
  await mockMissionControl(page);
  let status = 'created';
  let events: MockEvent[] = [];
  let lastSequence = 0;
  const commands: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const state = () => ({
    session: { id: 42, agentId: 7, workContractId: 9, status, last_sequence: lastSequence },
    snapshot: { status, version: lastSequence + 1, lastSequence, pending_approval_id: status === 'waiting_approval' ? 3 : null },
    events,
    nextSequence: lastSequence ? lastSequence + 1 : 0,
    gap: false,
  });
  await page.route('**/api/ai/interactive-sessions**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/ai/interactive-sessions' && request.method() === 'GET') {
      await route.fulfill({ json: { success: true, data: lastSequence ? [{ id: 42, status }] : [], nextCursor: null } });
      return;
    }
    if (url.pathname === '/api/ai/interactive-sessions' && request.method() === 'POST') {
      lastSequence = 1;
      status = 'created';
      events = [{ sequence: 1, type: 'session.created', payload: { secret: 'do-not-render' } }];
      await route.fulfill({ status: 201, json: { success: true, data: { id: 42, status } } });
      return;
    }
    if (url.pathname.endsWith('/commands')) {
      const body = request.postDataJSON() as { type: string; payload: Record<string, unknown>; idempotencyKey: string };
      commands.push({ type: body.type, payload: body.payload });
      lastSequence += 1;
      if (body.type === 'prompt') status = 'running';
      if (body.type === 'request_approval') status = 'waiting_approval';
      if (body.type === 'approve') status = 'running';
      events.push({
        sequence: lastSequence,
        type: body.type === 'request_approval' ? 'approval.requested' : `command.${body.type}`,
        payload: body.type === 'request_approval'
          ? { approvalId: 3, fingerprint: approvalFingerprint, capability: body.payload.capability, secret: 'do-not-render' }
          : { prompt: body.payload.prompt, secret: 'do-not-render' },
      });
      await route.fulfill({ json: { success: true, data: { replayed: false, sequence: lastSequence } } });
      return;
    }
    await route.fulfill({ json: { success: true, data: state() } });
  });

  await page.goto('/board/ai/mission-control');
  const panel = page.getByRole('region', { name: 'Durable Interactive Sessions' });
  await expect(panel.getByLabel('Work contract')).toHaveValue('9');
  await expect(panel.getByLabel('Agent', { exact: true })).toHaveValue('7');
  await panel.getByLabel('Initial prompt').fill('Complete the bounded task');
  await panel.getByRole('button', { name: 'Start durable session' }).click();
  await expect(panel.getByLabel('Resume session')).toHaveValue('42');
  await expect(panel.getByText('created', { exact: true })).toBeVisible();
  await panel.getByLabel('Send prompt').fill('Proceed with the plan');
  await panel.getByRole('button', { name: 'Send prompt', exact: true }).click();
  await expect(panel.getByText('running', { exact: true })).toBeVisible();
  await panel.getByLabel('Approval capability').fill('filesystem.write');
  await panel.getByRole('button', { name: 'Request approval' }).click();
  await expect(panel.getByText('waiting_approval', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Approval requires a different company reviewer/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  expect(commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'prompt', payload: { prompt: 'Proceed with the plan' } }),
    expect.objectContaining({ type: 'request_approval', payload: { capability: 'filesystem.write', arguments: {} } }),
  ]));
  await expect(panel.getByText('do-not-render')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as { __emitInteractiveSnapshot: (index: number, payload: unknown) => void };
    w.__emitInteractiveSnapshot(0, {
      snapshot: { status: 'cancelled', lastSequence: 4 },
      events: [{ sequence: 4, type: 'session.cancelled' }],
      nextSequence: 5,
      gap: false,
    });
  });
  await expect(panel.getByText('Terminal session · read only')).toBeVisible();
  await expect(panel.getByLabel('Send prompt')).toBeDisabled();
});

test('reconnects from the applied sequence and replaces state after a gap', async ({ page }) => {
  await login(page);
  await installEventSourceMock(page);
  await mockMissionControl(page);
  let reads = 0;
  await page.route('**/api/ai/interactive-sessions**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ai/interactive-sessions') {
      await route.fulfill({ json: { success: true, data: [{ id: 42, status: 'running' }] } });
      return;
    }
    reads += 1;
    await route.fulfill({ json: { success: true, data: {
      session: { id: 42, status: 'running' },
      snapshot: { status: 'running', lastSequence: 2 },
      events: [{ sequence: 1, type: 'session.running' }, { sequence: 2, type: 'prompt.accepted' }],
      nextSequence: 3,
      gap: false,
    } } });
  });
  await page.goto('/board/ai/mission-control');
  const panel = page.getByRole('region', { name: 'Durable Interactive Sessions' });
  await expect(panel.getByLabel('Resume session')).toHaveValue('42');
  await expect(panel.getByText('prompt.accepted')).toBeVisible();
  const readsBeforeGap = reads;
  await page.evaluate(() => {
    const w = window as unknown as {
      __interactiveSources: Array<{ onerror?: () => void; closed: boolean }>;
      __interactiveSourceState: (index: number) => unknown;
    };
    w.__interactiveSources[0].onerror?.();
    (window as unknown as { __interactiveSources: typeof w.__interactiveSources }).__interactiveSources[0].closed = true;
  });
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { __interactiveSourceState: (index: number) => { url: string } | null };
    return w.__interactiveSourceState(1)?.url;
  })).toContain('afterSequence=3');
  await page.evaluate(() => {
    const w = window as unknown as { __emitInteractiveSnapshot: (index: number, payload: unknown) => void };
    w.__emitInteractiveSnapshot(1, { snapshot: { status: 'running', lastSequence: 9 }, events: [], nextSequence: 3, gap: true });
  });
  await expect(panel.getByText(/Event history gap detected/)).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeGap);
  await expect(panel.getByText('prompt.accepted')).toBeVisible();
});

test('independent reviewer loads a bounded approval and submits a decision', async ({ page }) => {
  await login(page);
  await installEventSourceMock(page);
  await mockMissionControl(page);
  const commands: Array<{ type: string; idempotencyKey: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/ai/interactive-sessions**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ai/interactive-sessions') {
      await route.fulfill({ json: { success: true, data: [] } });
      return;
    }
    if (url.pathname === '/api/ai/interactive-sessions/42/approval') {
      await route.fulfill({ json: { success: true, data: {
        approvalId: 3,
        fingerprint: approvalFingerprint,
        capability: 'filesystem.write',
        expiresAt: '2099-01-01T00:00:00.000Z',
        sessionId: 42,
        status: 'waiting_approval',
        ownerId: 7,
        requestedById: 7,
      } } });
      return;
    }
    if (url.pathname.endsWith('/commands')) {
      const body = route.request().postDataJSON() as { type: string; idempotencyKey: string; payload: Record<string, unknown> };
      commands.push(body);
      await route.fulfill({ json: { success: true, data: { replayed: false, sequence: 2 } } });
      return;
    }
    await route.fulfill({ status: 404, json: { success: false, error: 'Session not found' } });
  });
  await page.goto('/board/ai/mission-control');
  const panel = page.getByRole('region', { name: 'Durable Interactive Sessions' });
  await panel.getByLabel('Session ID to review').fill('42');
  await panel.getByRole('button', { name: 'Load pending approval' }).click();
  await expect(panel.getByText('Approval #3 · filesystem.write')).toBeVisible();
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => commands.map((command) => command.type)).toEqual(['approve']);
  expect(commands[0]).toMatchObject({
    payload: { approvalId: 3, fingerprint: approvalFingerprint },
  });
  expect(commands[0]?.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/u);
  await expect(panel.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('cancel sends an idempotency key and surfaces API errors', async ({ page }) => {
  await login(page);
  await installEventSourceMock(page);
  await mockMissionControl(page);
  const commands: Array<{ type: string; idempotencyKey: string }> = [];
  await page.route('**/api/ai/interactive-sessions**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ai/interactive-sessions') {
      await route.fulfill({ json: { success: true, data: [{ id: 42, status: 'waiting_approval' }] } });
      return;
    }
    if (url.pathname.endsWith('/commands')) {
      const body = route.request().postDataJSON() as { type: string; idempotencyKey: string };
      commands.push(body);
      if (body.type === 'cancel') {
        await route.fulfill({ status: 403, json: { success: false, error: 'Session is already locked by another reviewer' } });
        return;
      }
      await route.fulfill({ json: { success: true, data: { replayed: false, sequence: 2 } } });
      return;
    }
    await route.fulfill({ json: { success: true, data: {
      session: { id: 42, status: 'waiting_approval' },
      snapshot: { status: 'waiting_approval', lastSequence: 1 },
      events: [{ sequence: 1, type: 'approval.requested', payload: { approvalId: 3, fingerprint: approvalFingerprint } }],
      nextSequence: 2,
      gap: false,
    } } });
  });
  await page.goto('/board/ai/mission-control');
  const panel = page.getByRole('region', { name: 'Durable Interactive Sessions' });
  await expect(panel.getByRole('button', { name: 'Deny', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Cancel session' }).click();
  await expect(panel.getByRole('alert')).toContainText('Session is already locked by another reviewer');
  await expect.poll(() => commands.map((command) => command.type)).toEqual(['cancel']);
  expect(commands.every((command) => /^[a-f0-9-]{36}$/u.test(command.idempotencyKey))).toBe(true);
});
