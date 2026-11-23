import { CronExpressionParser } from 'cron-parser';
import type { Transaction } from 'objection';
import { Cron, Job } from './models.js';

export interface CronTickOptions {
  now?: Date;
  limit?: number;
  timezone?: string;
}

export interface ParsedCron {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

export function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronDayOfWeek(dayOfWeek),
  };
}

function parseCronField(field: string, min: number, max: number): number {
  if (field === '*') return min;
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const stepValue = parseInt(step, 10);
    if (!Number.isInteger(stepValue) || stepValue <= 0) {
      throw new Error(`Invalid step value in cron field: ${field}`);
    }
    return min;
  }
  const value = parseInt(field, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Cron field value out of range [${min}-${max}]: ${field}`);
  }
  return value;
}

function parseCronDayOfWeek(field: string): number {
  if (field === '*') return 0;
  const dayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const lower = field.toLowerCase();
  if (dayMap[lower] !== undefined) return dayMap[lower];
  const value = parseInt(field, 10);
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error(`Cron field value out of range [0-6]: ${field}`);
  }
  return value;
}

export function evaluateNextTick(expression: string, from: Date, timezone: string): Date {
  try {
    const parser = CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: timezone,
    });
    return parser.next().toDate();
  } catch (error) {
    throw new Error(
      `Failed to evaluate next tick for expression "${expression}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export function evaluateNextTicks(
  expression: string,
  from: Date,
  timezone: string,
  count: number
): Date[] {
  const results: Date[] = [];
  try {
    const parser = CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: timezone,
    });
    for (let i = 0; i < count; i++) {
      results.push(parser.next().toDate());
    }
    return results;
  } catch (error) {
    throw new Error(
      `Failed to evaluate next ticks for expression "${expression}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function dispatchDueCrons(
  trx: Transaction,
  options: CronTickOptions = {}
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;

  const due = await Cron.query(trx)
    .where({ enabled: true, active: true })
    .where('next_run_at', '<=', now.toISOString())
    .orderBy('next_run_at', 'asc')
    .limit(limit)
    .forUpdate();

  let dispatched = 0;

  for (const cron of due) {
    const locked = await Cron.query(trx).findById(cron.id).forUpdate();
    if (
      !locked ||
      !locked.enabled ||
      locked.active === false ||
      locked.next_run_at > now.toISOString()
    ) {
      continue;
    }

    const occurrences: Date[] = [];
    const iterator = CronExpressionParser.parse(locked.cron_expression, {
      currentDate: new Date(new Date(locked.next_run_at).getTime() - 1000),
      tz: locked.timezone,
    });

    for (let index = 0; index < 10_000; index++) {
      const occurrence = iterator.next().toDate();
      if (occurrence > now) break;
      occurrences.push(occurrence);
    }

    if (occurrences.length === 0) continue;

    const policy = locked.misfire_policy;
    let selected: Date[];
    if (policy === 'skip') {
      selected = [];
    } else if (policy === 'coalesce') {
      selected = [occurrences[0]];
    } else {
      selected = occurrences.slice(0, Math.max(1, locked.max_catch_up));
    }

    const currentlyRunning = await Job.query(trx)
      .where({ cron_id: locked.id, status: 'running' })
      .first();

    const queued = await Job.query(trx).where({ cron_id: locked.id, status: 'queued' });

    if (locked.concurrency_policy === 'forbid' && (currentlyRunning || queued.length > 0)) {
      continue;
    } else if (locked.concurrency_policy === 'replace') {
      if (currentlyRunning) {
        await Job.query(trx).findById(currentlyRunning.id).patch({ cancel_requested: true });
      }
      for (const pending of queued) {
        await Job.query(trx).findById(pending.id).patch({ status: 'cancelled' });
      }
    }

    const selectedKeys = new Set(selected.map((date) => date.toISOString()));

    for (const occurrence of occurrences) {
      if (!selectedKeys.has(occurrence.toISOString())) continue;

      const scheduleKey = `cron:${locked.id}:${occurrence.toISOString()}`;
      const existing = await Job.query(trx).findOne({ schedule_key: scheduleKey });
      if (existing) continue;

      await Job.query(trx).insert({
        handler: locked.handler,
        handler_version: locked.handler_version,
        payload: locked.payload,
        company_id: locked.company_id,
        requested_by_id: locked.requested_by_id,
        cron_id: locked.id,
        schedule_key: scheduleKey,
        available_at: now.toISOString(),
        max_attempts: 5,
      });
      dispatched++;
    }

    const nextExpression = CronExpressionParser.parse(locked.cron_expression, {
      currentDate: now,
      tz: locked.timezone,
    });
    await Cron.query(trx).findById(locked.id).patch({
      next_run_at: nextExpression.next().toDate().toISOString(),
    });
  }

  return dispatched;
}
