import { beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import {
  AlertEvent,
  AlertRule,
  Calibration,
  Device,
  DeviceFirmware,
  DeviceType,
  SensorDefinition,
  SensorUnitConversion,
  TelemetryBatch,
  TelemetrySample,
  canTransitionAlert,
  canTransitionDevice,
  canTransitionTelemetryBatch,
  convertUnit,
  manifest,
  seedManifest,
  validateThresholds,
} from '../src/index.js';

const SENSOR_MODELS = [
  SensorUnitConversion,
  DeviceType,
  Device,
  SensorDefinition,
  TelemetryBatch,
  TelemetrySample,
  Calibration,
  DeviceFirmware,
  AlertRule,
  AlertEvent,
];

describe('@moonwitness/orm-sensor addon', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    });
  });

  it('defines every sensor model with the sensor namespace and sensor_ table prefix', () => {
    for (const model of SENSOR_MODELS) {
      expect(model.modelName).toMatch(/^sensor\./);
      expect(model.tableName).toMatch(/^sensor_/);
      expect(model.fields.external_ref).toBeDefined();
    }
  });

  it('installs the sensor addon schema idempotently and leaves tables empty by default', async () => {
    await installAddons(db, [manifest, baseManifest]);
    await installAddons(db, [baseManifest, manifest]);

    expect(manifest.depends).toEqual(['base']);

    for (const model of SENSOR_MODELS) {
      const row = await db(model.tableName).count({ count: '*' }).first();
      expect(Number(row?.count ?? 0)).toBe(0);
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('runs the disabled-by-default seed manifest as a no-op', async () => {
    await installAddons(db, [manifest, baseManifest]);

    expect(seedManifest.seedVersion).toBe('1.0.0');
    expect(seedManifest.dependencies).toEqual(['orm-base']);

    const result = await seedManifest.seed({
      db,
      companyId: 1,
      ownerId: null,
    } as Parameters<typeof seedManifest.seed>[0]);

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });

    const deviceRow = await db(Device.tableName).count({ count: '*' }).first();
    expect(Number(deviceRow?.count ?? 0)).toBe(0);
  });

  it('persists a full sensor graph across device, telemetry, calibration, and alert tables', async () => {
    await installAddons(db, [manifest, baseManifest]);

    const [companyId] = await db('companies')
      .insert({ name: 'Sensor Test Co', timezone: 'UTC' })
      .returning('id');

    const conversionIdRaw = await db(SensorUnitConversion.tableName)
      .insert({
        from_unit: 'celsius',
        to_unit: 'fahrenheit',
        formula: 'x * 9 / 5 + 32',
        category: 'temperature',
        external_ref: 'science.units:1',
      })
      .returning('id');
    const conversionId = Array.isArray(conversionIdRaw) && typeof conversionIdRaw[0] === 'object' && conversionIdRaw[0] !== null ? conversionIdRaw[0].id : (Array.isArray(conversionIdRaw) ? conversionIdRaw[0] : conversionIdRaw);

    const deviceTypeIds = await db(DeviceType.tableName)
      .insert({
        code: 'DT-ENV-01',
        name: 'Environmental Gateway',
        category: 'gateway',
        external_ref: 'science.instrument:9',
      })
      .returning('id');
    const deviceTypeId = typeof deviceTypeIds[0] === 'object' && deviceTypeIds[0] !== null ? deviceTypeIds[0].id : deviceTypeIds[0];

    const deviceIds = await db(Device.tableName)
      .insert({
        device_id: 'DEV-001',
        device_type_id: deviceTypeId,
        name: 'Rooftop Gateway',
        status: 'online',
        location: 'Rooftop, Building A',
        last_seen_at: '2026-11-24T08:00:00',
        provisioned_at: '2026-01-15',
        external_ref: 'clinical.study:11',
      })
      .returning('id');
    const deviceId = typeof deviceIds[0] === 'object' && deviceIds[0] !== null ? deviceIds[0].id : deviceIds[0];

    const sensorIds = await db(SensorDefinition.tableName)
      .insert({
        sensor_key: 'ambient.temperature',
        device_id: deviceId,
        name: 'Ambient Temperature',
        data_type: 'numeric',
        unit: 'celsius',
        unit_category: 'temperature',
        threshold_warning_max: 40,
        threshold_critical_max: 50,
        external_ref: 'science.protocol:3',
      })
      .returning('id');
    const sensorId = typeof sensorIds[0] === 'object' && sensorIds[0] !== null ? sensorIds[0].id : sensorIds[0];

    const batchIds = await db(TelemetryBatch.tableName)
      .insert({
        batch_id: 'BATCH-001',
        device_id: deviceId,
        status: 'completed',
        sample_count: 1,
        start_timestamp: '2026-11-24T08:00:00',
        end_timestamp: '2026-11-24T08:05:00',
        received_at: '2026-11-24T08:05:10',
        processed_at: '2026-11-24T08:05:20',
      })
      .returning('id');
    const batchId = typeof batchIds[0] === 'object' && batchIds[0] !== null ? batchIds[0].id : batchIds[0];

    await db(TelemetrySample.tableName).insert({
      sample_id: 'SAMPLE-001',
      sensor_id: sensorId,
      device_id: deviceId,
      timestamp: '2026-11-24T08:00:00',
      value_numeric: 22.5,
      unit: 'celsius',
      quality: 'good',
      batch_id: batchId,
      external_ref: 'clinical.sample:5',
    });

    await db(Calibration.tableName).insert({
      calibration_id: 'CAL-001',
      sensor_id: sensorId,
      device_id: deviceId,
      calibration_date: '2026-11-01',
      next_calibration_date: '2027-05-01',
      status: 'completed',
      method: 'two-point ice bath',
      offset: 0.25,
      gain: 1.002,
    });

    const firmwareIds = await db(DeviceFirmware.tableName)
      .insert({
        firmware_id: 'FW-001',
        device_type_id: deviceTypeId,
        version: '2.1.0',
        release_date: '2026-06-01',
        status: 'released',
        changelog: 'Add LoRaWAN 1.0.4 support',
      })
      .returning('id');
    const firmwareId = typeof firmwareIds[0] === 'object' && firmwareIds[0] !== null ? firmwareIds[0].id : firmwareIds[0];

    const ruleIds = await db(AlertRule.tableName)
      .insert({
        rule_id: 'RULE-001',
        sensor_id: sensorId,
        device_id: deviceId,
        name: 'High ambient temperature',
        condition: 'value > threshold_critical_max',
        severity: 'critical',
      })
      .returning('id');
    const ruleId = typeof ruleIds[0] === 'object' && ruleIds[0] !== null ? ruleIds[0].id : ruleIds[0];

    await db(AlertEvent.tableName).insert({
      event_id: 'EVENT-001',
      rule_id: ruleId,
      sensor_id: sensorId,
      device_id: deviceId,
      triggered_at: '2026-11-24T08:10:00',
      status: 'firing',
      severity: 'critical',
      trigger_value: JSON.stringify({ value: 52.1 }),
    });

    expect(await db(SensorUnitConversion.tableName).where({ id: conversionId }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(DeviceType.tableName).where({ external_ref: 'science.instrument:9' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(Device.tableName).where({ external_ref: 'clinical.study:11' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(TelemetrySample.tableName).where({ external_ref: 'clinical.sample:5' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(TelemetryBatch.tableName).where({ status: 'completed' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(Calibration.tableName).where({ calibration_id: 'CAL-001' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(DeviceFirmware.tableName).where({ id: firmwareId }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(AlertRule.tableName).where({ id: ruleId }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await db(AlertEvent.tableName).where({ event_id: 'EVENT-001' }).count({ count: '*' }).first()).toMatchObject({ count: 1 });
  });

  it('enforces alert, device, and telemetry-batch state transitions', () => {
    expect(canTransitionAlert({ from: 'firing', to: 'acknowledged' })).toBe(true);
    expect(canTransitionAlert({ from: 'acknowledged', to: 'resolved' })).toBe(true);
    expect(canTransitionAlert({ from: 'resolved', to: 'acknowledged' })).toBe(false);
    expect(canTransitionDevice({ from: 'provisioned', to: 'online' })).toBe(true);
    expect(canTransitionDevice({ from: 'online', to: 'maintenance' })).toBe(true);
    expect(canTransitionDevice({ from: 'decommissioned', to: 'online' })).toBe(false);
    expect(canTransitionTelemetryBatch({ from: 'pending', to: 'processing' })).toBe(true);
    expect(canTransitionTelemetryBatch({ from: 'processing', to: 'completed' })).toBe(true);
    expect(canTransitionTelemetryBatch({ from: 'completed', to: 'processing' })).toBe(false);
  });

  it('validates sensor thresholds and converts units', () => {
    expect(validateThresholds({ warningMin: 0, warningMax: 40, criticalMin: -5, criticalMax: 50 })).toMatchObject({ valid: true });
    expect(validateThresholds({ warningMin: 40, warningMax: 0, criticalMin: null, criticalMax: null })).toMatchObject({ valid: false });
    expect(validateThresholds({ warningMin: 10, warningMax: 40, criticalMin: 20, criticalMax: 50 })).toMatchObject({ valid: false });

    expect(convertUnit(0, 'celsius', 'fahrenheit')).toMatchObject({ value: 32, error: null });
    expect(convertUnit(100, 'celsius', 'celsius')).toMatchObject({ value: 100, error: null });
    expect(convertUnit(1, 'bar', 'psi').value).toBeCloseTo(14.503773773, 6);
    expect(convertUnit(1, 'celsius', 'lux').error).toContain('no conversion registered');
  });
});
