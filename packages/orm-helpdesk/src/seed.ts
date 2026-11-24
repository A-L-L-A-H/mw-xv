import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

interface SlaPolicySeedRow {
  readonly name: string;
  readonly priority: 'P1' | 'P2' | 'P3' | 'P4';
  readonly first_response_minutes: number;
  readonly resolution_minutes: number;
  readonly business_hours_only: boolean;
  readonly applies_to_queue: 'technical' | 'billing' | 'general' | 'enterprise' | 'all';
  readonly is_active: boolean;
}

interface EscalationRuleSeedRow {
  readonly name: string;
  readonly sla_policy_name: string;
  readonly trigger: 'first_response_breach' | 'resolution_breach' | 'priority_change' | 'reopen';
  readonly escalate_after_minutes: number;
  readonly escalate_to: 'team_lead' | 'on_call' | 'manager' | 'vendor';
  readonly oncall_rotation?: string;
  readonly max_escalations: number;
  readonly is_active: boolean;
}

const SLA_POLICY_SEEDS: readonly SlaPolicySeedRow[] = [
  {
    name: 'P1 - All Queues',
    priority: 'P1',
    first_response_minutes: 15,
    resolution_minutes: 240,
    business_hours_only: false,
    applies_to_queue: 'all',
    is_active: true,
  },
  {
    name: 'P2 - All Queues',
    priority: 'P2',
    first_response_minutes: 60,
    resolution_minutes: 480,
    business_hours_only: false,
    applies_to_queue: 'all',
    is_active: true,
  },
  {
    name: 'P3 - All Queues',
    priority: 'P3',
    first_response_minutes: 240,
    resolution_minutes: 1440,
    business_hours_only: true,
    applies_to_queue: 'all',
    is_active: true,
  },
  {
    name: 'P4 - All Queues',
    priority: 'P4',
    first_response_minutes: 480,
    resolution_minutes: 2880,
    business_hours_only: true,
    applies_to_queue: 'all',
    is_active: true,
  },
  {
    name: 'P1 - Enterprise Queue',
    priority: 'P1',
    first_response_minutes: 10,
    resolution_minutes: 120,
    business_hours_only: false,
    applies_to_queue: 'enterprise',
    is_active: true,
  },
  {
    name: 'P2 - Enterprise Queue',
    priority: 'P2',
    first_response_minutes: 30,
    resolution_minutes: 240,
    business_hours_only: false,
    applies_to_queue: 'enterprise',
    is_active: true,
  },
] as const;

const ESCALATION_RULE_SEEDS: readonly EscalationRuleSeedRow[] = [
  {
    name: 'P1 First Response Breach',
    sla_policy_name: 'P1 - All Queues',
    trigger: 'first_response_breach',
    escalate_after_minutes: 30,
    escalate_to: 'team_lead',
    max_escalations: 2,
    is_active: true,
  },
  {
    name: 'P1 Resolution Breach',
    sla_policy_name: 'P1 - All Queues',
    trigger: 'resolution_breach',
    escalate_after_minutes: 60,
    escalate_to: 'manager',
    max_escalations: 2,
    is_active: true,
  },
  {
    name: 'P2 First Response Breach',
    sla_policy_name: 'P2 - All Queues',
    trigger: 'first_response_breach',
    escalate_after_minutes: 60,
    escalate_to: 'team_lead',
    max_escalations: 2,
    is_active: true,
  },
  {
    name: 'Priority Escalation',
    sla_policy_name: 'P1 - All Queues',
    trigger: 'priority_change',
    escalate_after_minutes: 0,
    escalate_to: 'on_call',
    oncall_rotation: 'primary',
    max_escalations: 1,
    is_active: true,
  },
  {
    name: 'Ticket Reopen',
    sla_policy_name: 'P1 - All Queues',
    trigger: 'reopen',
    escalate_after_minutes: 0,
    escalate_to: 'team_lead',
    max_escalations: 1,
    is_active: true,
  },
] as const;

export async function seedHelpdesk(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const policyIdsByName = new Map<string, number>();

  for (const policy of SLA_POLICY_SEEDS) {
    const existing = await db('helpdesk_sla_policies')
      .where({ name: policy.name })
      .first<{ id: number }>();

    if (existing) {
      await db('helpdesk_sla_policies').where({ id: existing.id }).update({
        priority: policy.priority,
        first_response_minutes: policy.first_response_minutes,
        resolution_minutes: policy.resolution_minutes,
        business_hours_only: policy.business_hours_only,
        applies_to_queue: policy.applies_to_queue,
        is_active: policy.is_active,
        write_date: new Date(),
      });
      policyIdsByName.set(policy.name, existing.id);
      updated++;
    } else {
      const [createdId] = await db('helpdesk_sla_policies').insert({
        name: policy.name,
        priority: policy.priority,
        first_response_minutes: policy.first_response_minutes,
        resolution_minutes: policy.resolution_minutes,
        business_hours_only: policy.business_hours_only,
        applies_to_queue: policy.applies_to_queue,
        is_active: policy.is_active,
      });
      policyIdsByName.set(policy.name, Number(createdId));
      inserted++;
    }
  }

  for (const rule of ESCALATION_RULE_SEEDS) {
    const slaPolicyId = policyIdsByName.get(rule.sla_policy_name);
    if (slaPolicyId === undefined) {
      skipped++;
      continue;
    }

    const existing = await db('helpdesk_escalation_rules')
      .where({ name: rule.name, trigger: rule.trigger })
      .first<{ id: number }>();

    if (existing) {
      await db('helpdesk_escalation_rules').where({ id: existing.id }).update({
        sla_policy_id: slaPolicyId,
        escalate_after_minutes: rule.escalate_after_minutes,
        escalate_to: rule.escalate_to,
        oncall_rotation: rule.oncall_rotation ?? null,
        max_escalations: rule.max_escalations,
        is_active: rule.is_active,
        write_date: new Date(),
      });
      updated++;
    } else {
      await db('helpdesk_escalation_rules').insert({
        name: rule.name,
        sla_policy_id: slaPolicyId,
        trigger: rule.trigger,
        escalate_after_minutes: rule.escalate_after_minutes,
        escalate_to: rule.escalate_to,
        oncall_rotation: rule.oncall_rotation ?? null,
        max_escalations: rule.max_escalations,
        is_active: rule.is_active,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}
