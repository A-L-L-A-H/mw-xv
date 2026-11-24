import type { SeedContext, SeedResult, AddonSeedManifest } from '@moonwitness/orm-base';
import { buildWhatsappHelpdeskSeed } from './seed.js';

export const whatsappSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    const bundle = buildWhatsappHelpdeskSeed();
    const { db } = ctx;
    let inserted = 0;
    let updated = 0;
    const skipped = 0;

    for (const template of bundle.templates) {
      const existing = await db('whatsapp_transactional_templates')
        .where({ id: template.id })
        .first();
      if (existing) {
        await db('whatsapp_transactional_templates').where({ id: template.id }).update(template);
        updated++;
      } else {
        await db('whatsapp_transactional_templates').insert(template);
        inserted++;
      }
    }

    for (const queue of bundle.queues) {
      const existing = await db('whatsapp_helpdesk_routing_queues').where({ id: queue.id }).first();
      if (existing) {
        await db('whatsapp_helpdesk_routing_queues').where({ id: queue.id }).update(queue);
        updated++;
      } else {
        await db('whatsapp_helpdesk_routing_queues').insert(queue);
        inserted++;
      }
    }

    for (const policy of bundle.slaPolicies) {
      const existing = await db('whatsapp_helpdesk_sla_policies').where({ id: policy.id }).first();
      if (existing) {
        await db('whatsapp_helpdesk_sla_policies').where({ id: policy.id }).update(policy);
        updated++;
      } else {
        await db('whatsapp_helpdesk_sla_policies').insert(policy);
        inserted++;
      }
    }

    for (const policy of bundle.escalationPolicies) {
      const existing = await db('whatsapp_helpdesk_escalation_policies')
        .where({ id: policy.id })
        .first();
      if (existing) {
        await db('whatsapp_helpdesk_escalation_policies').where({ id: policy.id }).update(policy);
        updated++;
      } else {
        await db('whatsapp_helpdesk_escalation_policies').insert(policy);
        inserted++;
      }
    }

    for (const rule of bundle.categoryRules) {
      const existing = await db('whatsapp_helpdesk_category_rules')
        .where({ category: rule.category })
        .first();
      if (existing) {
        await db('whatsapp_helpdesk_category_rules')
          .where({ category: rule.category })
          .update(rule);
        updated++;
      } else {
        await db('whatsapp_helpdesk_category_rules').insert(rule);
        inserted++;
      }
    }

    return { inserted, updated, skipped };
  },
};
