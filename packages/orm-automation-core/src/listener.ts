import type { Knex } from 'knex';
import { evaluateDsl, type AutomationDslNode } from './evaluator.js';
import { resolveAction } from './actions/index.js';
import type { ActionResult } from './actions/types.js';

export interface FireTriggerOptions {
  /** Knex instance or transaction bound to the tenant company. */
  readonly db: Knex;
  readonly companyId: number;
  /** Optional cap on rules executed per firing (defaults to 50). */
  readonly limit?: number;
}

export interface FireTriggerOutcome {
  readonly ruleId: number;
  readonly runId: number;
  readonly status: 'success' | 'failed' | 'skipped';
  readonly result?: ActionResult;
  readonly error?: string;
}

export interface FireTriggerReport {
  readonly triggerKind: string;
  readonly triggerRef: string;
  readonly matchedRules: number;
  readonly outcomes: FireTriggerOutcome[];
}

const RULE_CODE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

interface RuleRow {
  id: number;
  company_id: number;
  condition: string | null;
  action_kind: string;
  action_config: string | null;
  cooldown_minutes: number;
  dedupe_key_template: string | null;
}

interface RunInsert {
  id: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonColumn(value: string | null): unknown {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Renders a dedupe template such as "score:{payload.score}:{trigger.ref}" by
 * replacing `{path}` tokens with values resolved from the render context.
 * Unresolvable tokens render as empty strings.
 */
export function renderDedupeKey(
  template: string,
  ctx: { readonly payload: unknown; readonly triggerKind: string; readonly triggerRef: string }
): string {
  const resolveToken = (rawPath: string): string => {
    const path = rawPath.trim();
    if (path === 'trigger.kind') return ctx.triggerKind;
    if (path === 'trigger.ref') return ctx.triggerRef;
    if (path === 'payload') return String(JSON.stringify(ctx.payload));
    let current: unknown = { payload: ctx.payload };
    for (const segment of path.split('.')) {
      if (!isRecord(current)) return '';
      current = current[segment];
    }
    if (current === undefined || current === null) return '';
    return typeof current === 'string' ? current : String(JSON.stringify(current));
  };

  const rendered: string[] = [];
  let literalStart = 0;
  let tokenStart = -1;

  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (character === '{') {
      // The previous pattern allowed nested opening braces inside a token.
      if (tokenStart === -1) tokenStart = index;
      continue;
    }
    if (character !== '}' || tokenStart === -1) continue;

    if (index > tokenStart + 1) {
      rendered.push(
        template.slice(literalStart, tokenStart),
        resolveToken(template.slice(tokenStart + 1, index))
      );
      literalStart = index + 1;
    }
    // An empty `{}` is literal; later tokens are still eligible for rendering.
    tokenStart = -1;
  }

  rendered.push(template.slice(literalStart));
  return rendered.join('');
}

function hasRecentRun(
  db: Knex,
  dedupeKey: string,
  cooldownMinutes: number,
  now: Date
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - cooldownMinutes * 60_000);
  return db('automation_runs')
    .where({ dedupe_key: dedupeKey })
    .where('created_at', '>=', cutoff.toISOString())
    .first('id')
    .then((row) => row !== undefined);
}

/**
 * Fires a trigger: loads active rules bound to matching triggers, evaluates
 * each rule's DSL condition, enforces cooldown/dedupe idempotency, runs the
 * bound action, and records an `AutomationRun` per executed rule.
 */
export async function fireTrigger(
  kind: string,
  ref: string,
  payload: unknown,
  options: FireTriggerOptions
): Promise<FireTriggerReport> {
  const { db, companyId } = options;
  const limit = options.limit ?? 50;
  const now = new Date();

  const triggers = await db('automation_triggers')
    .where({ kind, ref, is_active: true, company_id: companyId })
    .select('id');
  if (triggers.length === 0) {
    return { triggerKind: kind, triggerRef: ref, matchedRules: 0, outcomes: [] };
  }
  const triggerIds = triggers.map((t: { id: number }) => Number(t.id));

  const rules = (await db('automation_rules')
    .whereIn('trigger_id', triggerIds)
    .where({ is_active: true, company_id: companyId })
    .orderBy('sequence', 'asc')
    .orderBy('id', 'asc')
    .limit(limit)
    .select(
      'id',
      'company_id',
      'condition',
      'action_kind',
      'action_config',
      'cooldown_minutes',
      'dedupe_key_template'
    )) as RuleRow[];

  const outcomes: FireTriggerOutcome[] = [];

  for (const rule of rules) {
    const condition = parseJsonColumn(rule.condition) as AutomationDslNode | undefined;
    const actionConfig = (parseJsonColumn(rule.action_config) as Record<string, unknown>) ?? {};

    let evaluation: ReturnType<typeof evaluateDsl>;
    try {
      evaluation = evaluateDsl(condition, payload);
    } catch (error) {
      outcomes.push({
        ruleId: Number(rule.id),
        runId: 0,
        status: 'skipped',
        error: error instanceof Error ? error.message : 'invalid condition DSL',
      });
      continue;
    }
    if (!evaluation.matched) {
      const insertedSkipped = (await db('automation_runs')
        .insert({
          rule_id: Number(rule.id),
          trigger_ref: ref,
          input: JSON.stringify(payload ?? null),
          output: null,
          status: 'skipped',
          error: `condition not matched: ${evaluation.reason}`,
          company_id: companyId,
        })
        .returning('id')) as RunInsert[];
      outcomes.push({
        ruleId: Number(rule.id),
        runId: Number((insertedSkipped[0] as unknown as { id: number }).id ?? insertedSkipped[0]),
        status: 'skipped',
        error: `condition not matched: ${evaluation.reason}`,
      });
      continue;
    }

    const dedupeKey = rule.dedupe_key_template
      ? renderDedupeKey(rule.dedupe_key_template, { payload, triggerKind: kind, triggerRef: ref })
      : null;

    if (dedupeKey !== null && rule.cooldown_minutes > 0) {
      const recent = await hasRecentRun(db, dedupeKey, rule.cooldown_minutes, now);
      if (recent) {
        const inserted = (await db('automation_runs')
          .insert({
            rule_id: Number(rule.id),
            trigger_ref: ref,
            input: JSON.stringify(payload ?? null),
            output: null,
            status: 'skipped',
            error: 'dedupe: rule fired within cooldown window',
            dedupe_key: dedupeKey,
            company_id: companyId,
          })
          .returning('id')) as RunInsert[];
        outcomes.push({
          ruleId: Number(rule.id),
          runId: Number((inserted[0] as unknown as { id: number }).id ?? inserted[0]),
          status: 'skipped',
          error: 'dedupe: rule fired within cooldown window',
        });
        continue;
      }
    }

    const action = resolveAction(rule.action_kind);
    if (action === null) {
      const inserted = (await db('automation_runs')
        .insert({
          rule_id: Number(rule.id),
          trigger_ref: ref,
          input: JSON.stringify(payload ?? null),
          output: null,
          status: 'failed',
          error: `unknown action kind: ${rule.action_kind}`,
          company_id: companyId,
        })
        .returning('id')) as RunInsert[];
      outcomes.push({
        ruleId: Number(rule.id),
        runId: Number((inserted[0] as unknown as { id: number }).id ?? inserted[0]),
        status: 'failed',
        error: `unknown action kind: ${rule.action_kind}`,
      });
      continue;
    }

    const insertedRun = (await db('automation_runs')
      .insert({
        rule_id: Number(rule.id),
        trigger_ref: ref,
        input: JSON.stringify(payload ?? null),
        output: null,
        status: 'running',
        started_at: now.toISOString(),
        dedupe_key: dedupeKey,
        company_id: companyId,
      })
      .returning('id')) as RunInsert[];
    const runId = Number((insertedRun[0] as unknown as { id: number }).id ?? insertedRun[0]);

    let result: ActionResult;
    try {
      result = await action(
        { db, companyId, ruleId: Number(rule.id), triggerRef: ref, dedupeKey },
        actionConfig,
        { payload, config: actionConfig }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db('automation_runs').where({ id: runId }).update({
        status: 'failed',
        error: message,
        finished_at: new Date().toISOString(),
      });
      outcomes.push({ ruleId: Number(rule.id), runId, status: 'failed', error: message });
      continue;
    }

    await db('automation_runs')
      .where({ id: runId })
      .update({
        status: result.ok ? 'success' : 'failed',
        output: JSON.stringify(result.detail ?? null),
        error: result.error ?? null,
        finished_at: new Date().toISOString(),
      });
    outcomes.push({
      ruleId: Number(rule.id),
      runId,
      status: result.ok ? 'success' : 'failed',
      result,
      error: result.error,
    });
  }

  return { triggerKind: kind, triggerRef: ref, matchedRules: rules.length, outcomes };
}

export const AUTOMATION_RULE_CODE_PATTERN = RULE_CODE_PATTERN;
