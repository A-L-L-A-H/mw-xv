import { defineModel, fields } from '@moonwitness/orm';

export const DeviceStatus = {
  PROVISIONED: 'provisioned',
  ONLINE: 'online',
  OFFLINE: 'offline',
  MAINTENANCE: 'maintenance',
  DECOMMISSIONED: 'decommissioned',
} as const;

export const DeviceTypeCategory = {
  GATEWAY: 'gateway',
  SENSOR_NODE: 'sensor_node',
  ACTUATOR: 'actuator',
  CONTROLLER: 'controller',
} as const;

export const SensorDataType = {
  NUMERIC: 'numeric',
  BOOLEAN: 'boolean',
  STRING: 'string',
} as const;

export const SensorUnitCategory = {
  TEMPERATURE: 'temperature',
  PRESSURE: 'pressure',
  HUMIDITY: 'humidity',
  LUMINANCE: 'luminance',
  POWER: 'power',
  DIMENSIONLESS: 'dimensionless',
} as const;

export const SensorUnit = {
  CELSIUS: 'celsius',
  FAHRENHEIT: 'fahrenheit',
  KELVIN: 'kelvin',
  PASCAL: 'pascal',
  BAR: 'bar',
  PSI: 'psi',
  PERCENT: 'percent',
  LUX: 'lux',
  WATT: 'watt',
  KILOWATT: 'kilowatt',
  VOLT: 'volt',
  AMPERE: 'ampere',
  RAW: 'raw',
} as const;

export const TelemetryBatchStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const TelemetrySampleQuality = {
  GOOD: 'good',
  UNCERTAIN: 'uncertain',
  BAD: 'bad',
} as const;

export const CalibrationStatus = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const;

export const FirmwareStatus = {
  DRAFT: 'draft',
  RELEASED: 'released',
  DEPRECATED: 'deprecated',
} as const;

export const AlertSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export const AlertStatus = {
  FIRING: 'firing',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
} as const;

export const SensorUnitConversion = defineModel('sensor.unit_conversion', {
  table: 'sensor_unit_conversions',
  order: 'category asc, from_unit asc',
  fields: {
    from_unit: fields.enum(Object.values(SensorUnit) as [string, ...string[]], {
      required: true,
      label: 'From Unit',
    }),
    to_unit: fields.enum(Object.values(SensorUnit) as [string, ...string[]], {
      required: true,
      label: 'To Unit',
    }),
    formula: fields.string({
      required: true,
      label: 'Conversion Formula',
      help: 'Expression in x (linear form: a * x + b)',
    }),
    category: fields.enum(Object.values(SensorUnitCategory) as [string, ...string[]], {
      required: true,
      label: 'Unit Category',
    }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const DeviceType = defineModel('sensor.device_type', {
  table: 'sensor_device_types',
  order: 'name asc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Type Code' }),
    name: fields.string({ required: true }),
    category: fields.enum(Object.values(DeviceTypeCategory) as [string, ...string[]], {
      required: true,
      default: DeviceTypeCategory.SENSOR_NODE,
      label: 'Category',
    }),
    manufacturer: fields.string({ label: 'Manufacturer' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const Device = defineModel('sensor.device', {
  table: 'sensor_devices',
  order: 'create_date desc',
  fields: {
    device_id: fields.string({ required: true, unique: true, label: 'Device ID' }),
    device_type: fields.belongsTo(DeviceType, { required: true }),
    name: fields.string({ required: true }),
    status: fields.enum(Object.values(DeviceStatus) as [string, ...string[]], {
      required: true,
      default: DeviceStatus.PROVISIONED,
    }),
    location: fields.string({ label: 'Location' }),
    last_seen_at: fields.datetime({ label: 'Last Seen At' }),
    provisioned_at: fields.date({ label: 'Provisioned At' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const SensorDefinition = defineModel('sensor.definition', {
  table: 'sensor_definitions',
  order: 'name asc',
  fields: {
    sensor_key: fields.string({ required: true, unique: true, label: 'Sensor Key' }),
    device: fields.belongsTo(Device, { required: true }),
    name: fields.string({ required: true }),
    data_type: fields.enum(Object.values(SensorDataType) as [string, ...string[]], {
      required: true,
      default: SensorDataType.NUMERIC,
      label: 'Data Type',
    }),
    unit: fields.enum(Object.values(SensorUnit) as [string, ...string[]], {
      required: true,
      default: SensorUnit.RAW,
    }),
    unit_category: fields.enum(Object.values(SensorUnitCategory) as [string, ...string[]], {
      required: true,
      default: SensorUnitCategory.DIMENSIONLESS,
      label: 'Unit Category',
    }),
    threshold_warning_min: fields.float({ label: 'Warning Threshold Min' }),
    threshold_warning_max: fields.float({ label: 'Warning Threshold Max' }),
    threshold_critical_min: fields.float({ label: 'Critical Threshold Min' }),
    threshold_critical_max: fields.float({ label: 'Critical Threshold Max' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const TelemetryBatch = defineModel('sensor.telemetry_batch', {
  table: 'sensor_telemetry_batches',
  order: 'start_timestamp desc',
  fields: {
    batch_id: fields.string({ required: true, unique: true, label: 'Batch ID' }),
    device: fields.belongsTo(Device, { required: true }),
    status: fields.enum(Object.values(TelemetryBatchStatus) as [string, ...string[]], {
      required: true,
      default: TelemetryBatchStatus.PENDING,
    }),
    sample_count: fields.integer({ required: true, default: 0, label: 'Sample Count' }),
    start_timestamp: fields.datetime({ required: true, label: 'Start Timestamp' }),
    end_timestamp: fields.datetime({ label: 'End Timestamp' }),
    received_at: fields.datetime({ label: 'Received At' }),
    processed_at: fields.datetime({ label: 'Processed At' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const TelemetrySample = defineModel('sensor.telemetry_sample', {
  table: 'sensor_telemetry_samples',
  order: 'timestamp desc',
  fields: {
    sample_id: fields.string({ required: true, unique: true, label: 'Sample ID' }),
    sensor: fields.belongsTo(SensorDefinition, { required: true }),
    device: fields.belongsTo(Device, { required: true }),
    batch: fields.belongsTo(TelemetryBatch),
    timestamp: fields.datetime({ required: true }),
    value_numeric: fields.float({ label: 'Numeric Value' }),
    unit: fields.enum(Object.values(SensorUnit) as [string, ...string[]], {
      required: true,
      default: SensorUnit.RAW,
    }),
    quality: fields.enum(Object.values(TelemetrySampleQuality) as [string, ...string[]], {
      required: true,
      default: TelemetrySampleQuality.GOOD,
    }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const Calibration = defineModel('sensor.calibration', {
  table: 'sensor_calibrations',
  order: 'calibration_date desc',
  fields: {
    calibration_id: fields.string({ required: true, unique: true, label: 'Calibration ID' }),
    sensor: fields.belongsTo(SensorDefinition, { required: true }),
    device: fields.belongsTo(Device, { required: true }),
    calibration_date: fields.date({ required: true, label: 'Calibration Date' }),
    next_calibration_date: fields.date({ label: 'Next Calibration Date' }),
    status: fields.enum(Object.values(CalibrationStatus) as [string, ...string[]], {
      required: true,
      default: CalibrationStatus.SCHEDULED,
    }),
    method: fields.string({ label: 'Calibration Method' }),
    offset: fields.float({ default: 0, label: 'Offset' }),
    gain: fields.float({ default: 1, label: 'Gain' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const DeviceFirmware = defineModel('sensor.device_firmware', {
  table: 'sensor_device_firmwares',
  order: 'release_date desc',
  fields: {
    firmware_id: fields.string({ required: true, unique: true, label: 'Firmware ID' }),
    device_type: fields.belongsTo(DeviceType, { required: true }),
    version: fields.string({ required: true }),
    release_date: fields.date({ label: 'Release Date' }),
    status: fields.enum(Object.values(FirmwareStatus) as [string, ...string[]], {
      required: true,
      default: FirmwareStatus.DRAFT,
    }),
    changelog: fields.text({ label: 'Changelog' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const AlertRule = defineModel('sensor.alert_rule', {
  table: 'sensor_alert_rules',
  order: 'name asc',
  fields: {
    rule_id: fields.string({ required: true, unique: true, label: 'Rule ID' }),
    sensor: fields.belongsTo(SensorDefinition, { required: true }),
    device: fields.belongsTo(Device, { required: true }),
    name: fields.string({ required: true }),
    condition: fields.string({ required: true, label: 'Condition Expression' }),
    severity: fields.enum(Object.values(AlertSeverity) as [string, ...string[]], {
      required: true,
      default: AlertSeverity.WARNING,
    }),
    enabled: fields.boolean({ required: true, default: true }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});

export const AlertEvent = defineModel('sensor.alert_event', {
  table: 'sensor_alert_events',
  order: 'triggered_at desc',
  fields: {
    event_id: fields.string({ required: true, unique: true, label: 'Event ID' }),
    rule: fields.belongsTo(AlertRule, { required: true }),
    sensor: fields.belongsTo(SensorDefinition, { required: true }),
    device: fields.belongsTo(Device, { required: true }),
    triggered_at: fields.datetime({ required: true, label: 'Triggered At' }),
    status: fields.enum(Object.values(AlertStatus) as [string, ...string[]], {
      required: true,
      default: AlertStatus.FIRING,
    }),
    severity: fields.enum(Object.values(AlertSeverity) as [string, ...string[]], {
      required: true,
      default: AlertSeverity.WARNING,
    }),
    trigger_value: fields.json({ label: 'Trigger Value' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-clinical/orm-science records',
    }),
  },
});
