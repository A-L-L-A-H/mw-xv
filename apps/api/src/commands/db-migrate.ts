import type { Knex } from 'knex';
import {
  computeDesiredSchemaState,
  planAddonsSchemaSync,
  type SchemaDiffPlan,
} from '@moonwitness/orm';
import { createMigrationDatabase } from '../database/knex.js';
import { API_SCHEMA_VERSION, coordinateApiMigration } from '../database/schema-state.js';
import { getApiAddonManifests, installApiAddons } from '../addons/registry.js';
import { startupErrorContext, redactStartupErrorText } from '../startup-diagnostics.js';

export interface PreDeployMigrationOptions {
  dryRun?: boolean;
  json?: boolean;
}

export async function runPreDeployMigrations(
  db: Knex,
  superadminPassword: string | undefined,
  options: PreDeployMigrationOptions = {}
): Promise<SchemaDiffPlan | void> {
  if (options.dryRun) {
    const manifests = getApiAddonManifests();
    return planAddonsSchemaSync(db, manifests);
  }

  const desired = computeDesiredSchemaState(getApiAddonManifests(), API_SCHEMA_VERSION);
  await coordinateApiMigration(db, {
    desired,
    migrate: async () => {
      await installApiAddons(db, superadminPassword, undefined, { skipBootMigrations: false });
    },
  });
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const json = args.has('--json');

  const db = createMigrationDatabase();
  try {
    const plan = await runPreDeployMigrations(db, process.env.SUPERADMIN_PASSWORD, {
      dryRun,
      json,
    });
    if (dryRun && plan) {
      if (json) {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      } else {
        process.stdout.write(
          `Schema diff plan: ${plan.items.length} change(s), destructive=${plan.hasDestructive}\n`
        );
        for (const item of plan.items) {
          process.stdout.write(`  [${item.category}] ${item.table}: ${item.detail}\n`);
        }
      }
      if (plan.hasDestructive) {
        process.exitCode = 2;
      }
    } else if (json) {
      process.stdout.write(`${JSON.stringify({ status: 'ok' })}\n`);
    } else {
      process.stdout.write('Pre-deploy database migrations completed safely.\n');
    }
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error) => {
    const message = error instanceof Error ? redactStartupErrorText(error.message) : String(error);
    process.stderr.write(`Pre-deploy migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
