import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import {
  Device,
  DeviceFirmware,
  DeviceType,
  SensorDefinition,
  SensorUnitConversion,
  TelemetryBatch,
  TelemetrySample,
} from './models.js';

export const SENSOR_SEED_VERSION = '1.0.0';

const SENSOR_TABLES = [
  DeviceType.tableName,
  Device.tableName,
  SensorDefinition.tableName,
  TelemetryBatch.tableName,
  TelemetrySample.tableName,
  DeviceFirmware.tableName,
  SensorUnitConversion.tableName,
];

export interface SensorSeedOptions {
  enabled?: boolean;
}

export function isSensorSeedEnabled(options: SensorSeedOptions | undefined): boolean {
  return options?.enabled === true;
}

export async function countSensorRows(
  db: AddonSeedManifest['seed'] extends (ctx: infer C) => unknown
    ? C extends { db: infer D }
      ? D
      : never
    : never
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    SENSOR_TABLES.map(async (table) => {
      const row = await db(table).count({ count: '*' }).first();
      counts[table] = Number(row?.count ?? 0);
    })
  );
  return counts;
}

export const seedManifest: AddonSeedManifest = {
  seedVersion: SENSOR_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext & { options?: SensorSeedOptions }): Promise<SeedResult> {
    // Disabled by default: without an explicit opt-in the addon writes no rows.
    if (!isSensorSeedEnabled(ctx.options)) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    const existing = await countSensorRows(ctx.db);
    const alreadySeeded = Object.values(existing).some((count) => count > 0);
    if (alreadySeeded) {
      const total = Object.values(existing).reduce((sum, count) => sum + count, 0);
      return { inserted: 0, updated: 0, skipped: total };
    }

    const [deviceTypeId] = await ctx
      .db(DeviceType.tableName)
      .insert({
        code: 'DT-ENV-01',
        name: 'Environmental Gateway',
        category: 'gateway',
      })
      .returning('id');

    const [deviceId] = await ctx
      .db(Device.tableName)
      .insert({
        device_id: 'DEV-SEED-001',
        device_type_id: deviceTypeId,
        name: 'Reference Environmental Gateway',
        status: 'online',
        location: 'Facility A, Rooftop',
      })
      .returning('id');

    const [sensorId] = await ctx
      .db(SensorDefinition.tableName)
      .insert({
        sensor_key: 'ambient.temperature',
        device_id: deviceId,
        name: 'Ambient Temperature',
        data_type: 'numeric',
        unit: 'celsius',
        unit_category: 'temperature',
        threshold_warning_max: 40,
        threshold_critical_max: 50,
      })
      .returning('id');

    const [batchId] = await ctx
      .db(TelemetryBatch.tableName)
      .insert({
        batch_id: 'BATCH-SEED-001',
        device_id: deviceId,
        status: 'completed',
        sample_count: 1,
        start_timestamp: '1970-01-01T00:00:00',
        end_timestamp: '1970-01-01T00:05:00',
      })
      .returning('id');

    await ctx.db(TelemetrySample.tableName).insert({
      sample_id: 'SAMPLE-SEED-001',
      sensor_id: sensorId,
      device_id: deviceId,
      batch_id: batchId,
      timestamp: '1970-01-01T00:00:00',
      value_numeric: 22.5,
      unit: 'celsius',
      quality: 'good',
    });

    return { inserted: 5, updated: 0, skipped: 0 };
  },
};
