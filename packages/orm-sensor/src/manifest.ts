import { defineAddon } from '@moonwitness/orm';
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
} from './models.js';
import { views } from './views.js';

export const manifest = defineAddon({
  name: 'sensor',
  version: '1.0.0',
  displayName: 'Sensor / IoT Telemetry',
  category: 'science-gov-rnd',
  summary: 'Device fleet, telemetry ingestion, calibration, and alerting for Sensor/IoT estates.',
  depends: ['base'],
  models: [
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
  ],
  views,
  menus: [
    {
      model: Device.modelName,
      label: 'Devices',
      group: 'Sensor/IoT',
      sequence: 10,
    },
    {
      model: DeviceType.modelName,
      label: 'Device Types',
      group: 'Sensor/IoT',
      sequence: 20,
    },
    {
      model: DeviceFirmware.modelName,
      label: 'Device Firmware',
      group: 'Sensor/IoT',
      sequence: 30,
    },
    {
      model: SensorDefinition.modelName,
      label: 'Sensor Definitions',
      group: 'Sensor/IoT',
      sequence: 40,
    },
    {
      model: TelemetryBatch.modelName,
      label: 'Telemetry Batches',
      group: 'Sensor/IoT',
      sequence: 50,
    },
    {
      model: TelemetrySample.modelName,
      label: 'Telemetry Samples',
      group: 'Sensor/IoT',
      sequence: 60,
    },
    {
      model: Calibration.modelName,
      label: 'Calibrations',
      group: 'Sensor/IoT',
      sequence: 70,
    },
    {
      model: SensorUnitConversion.modelName,
      label: 'Unit Conversions',
      group: 'Sensor/IoT',
      sequence: 80,
    },
    {
      model: AlertRule.modelName,
      label: 'Alert Rules',
      group: 'Sensor/IoT',
      sequence: 90,
    },
    {
      model: AlertEvent.modelName,
      label: 'Alert Events',
      group: 'Sensor/IoT',
      sequence: 100,
    },
  ],
});
