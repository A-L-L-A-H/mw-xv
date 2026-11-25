import { defineView } from '@moonwitness/orm';
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

export const views = [
  defineView(DeviceType, {
    title: 'Device Types',
    list: {
      columns: ['code', 'name', 'category', 'manufacturer'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Type',
          columns: 2,
          fields: ['code', 'name', 'category', 'manufacturer', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['code', 'name', 'manufacturer'],
      filters: [{ label: 'Gateways', domain: [['category', '=', 'gateway']] }],
      groupBy: [{ label: 'Category', field: 'category' }],
    },
  }),
  defineView(Device, {
    title: 'Devices',
    list: {
      columns: ['device_id', 'device_type', 'name', 'status', 'location', 'last_seen_at'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Device',
          columns: 2,
          fields: [
            'device_id',
            'device_type',
            'name',
            'status',
            'location',
            'provisioned_at',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['device_id', 'name', 'location'],
      filters: [{ label: 'Online', domain: [['status', '=', 'online']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(SensorDefinition, {
    title: 'Sensor Definitions',
    list: {
      columns: ['sensor_key', 'device', 'name', 'data_type', 'unit'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Sensor',
          columns: 2,
          fields: [
            'sensor_key',
            'device',
            'name',
            'data_type',
            'unit',
            'unit_category',
            'external_ref',
          ],
        },
        {
          title: 'Thresholds',
          columns: 2,
          fields: [
            'threshold_warning_min',
            'threshold_warning_max',
            'threshold_critical_min',
            'threshold_critical_max',
          ],
        },
      ],
    },
    search: {
      fields: ['sensor_key', 'name'],
      filters: [{ label: 'Numeric', domain: [['data_type', '=', 'numeric']] }],
      groupBy: [{ label: 'Unit Category', field: 'unit_category' }],
    },
  }),
  defineView(TelemetryBatch, {
    title: 'Telemetry Batches',
    list: {
      columns: ['batch_id', 'device', 'status', 'sample_count', 'start_timestamp', 'end_timestamp'],
      order: 'start_timestamp desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Batch',
          columns: 2,
          fields: [
            'batch_id',
            'device',
            'status',
            'sample_count',
            'start_timestamp',
            'end_timestamp',
            'received_at',
            'processed_at',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['batch_id'],
      filters: [{ label: 'Completed', domain: [['status', '=', 'completed']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(TelemetrySample, {
    title: 'Telemetry Samples',
    list: {
      columns: ['sample_id', 'sensor', 'device', 'timestamp', 'value_numeric', 'unit', 'quality'],
      order: 'timestamp desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Sample',
          columns: 2,
          fields: [
            'sample_id',
            'sensor',
            'device',
            'batch',
            'timestamp',
            'value_numeric',
            'unit',
            'quality',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['sample_id'],
      filters: [{ label: 'Good Quality', domain: [['quality', '=', 'good']] }],
      groupBy: [{ label: 'Quality', field: 'quality' }],
    },
  }),
  defineView(Calibration, {
    title: 'Calibrations',
    list: {
      columns: [
        'calibration_id',
        'sensor',
        'device',
        'calibration_date',
        'next_calibration_date',
        'status',
      ],
      order: 'calibration_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Calibration',
          columns: 2,
          fields: [
            'calibration_id',
            'sensor',
            'device',
            'calibration_date',
            'next_calibration_date',
            'status',
            'method',
            'offset',
            'gain',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['calibration_id', 'method'],
      filters: [{ label: 'Completed', domain: [['status', '=', 'completed']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(DeviceFirmware, {
    title: 'Device Firmware',
    list: {
      columns: ['firmware_id', 'device_type', 'version', 'release_date', 'status'],
      order: 'release_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Firmware',
          columns: 2,
          fields: [
            'firmware_id',
            'device_type',
            'version',
            'release_date',
            'status',
            'changelog',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['firmware_id', 'version'],
      filters: [{ label: 'Released', domain: [['status', '=', 'released']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(SensorUnitConversion, {
    title: 'Unit Conversions',
    list: {
      columns: ['from_unit', 'to_unit', 'category', 'formula'],
      order: 'category asc, from_unit asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Conversion',
          columns: 2,
          fields: ['from_unit', 'to_unit', 'category', 'formula', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['from_unit', 'to_unit'],
      filters: [{ label: 'Temperature', domain: [['category', '=', 'temperature']] }],
      groupBy: [{ label: 'Category', field: 'category' }],
    },
  }),
  defineView(AlertRule, {
    title: 'Alert Rules',
    list: {
      columns: ['rule_id', 'sensor', 'device', 'name', 'severity', 'condition'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Rule',
          columns: 2,
          fields: [
            'rule_id',
            'sensor',
            'device',
            'name',
            'condition',
            'severity',
            'enabled',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['rule_id', 'name', 'condition'],
      filters: [{ label: 'Critical', domain: [['severity', '=', 'critical']] }],
      groupBy: [{ label: 'Severity', field: 'severity' }],
    },
  }),
  defineView(AlertEvent, {
    title: 'Alert Events',
    list: {
      columns: ['event_id', 'rule', 'sensor', 'device', 'triggered_at', 'status', 'severity'],
      order: 'triggered_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Event',
          columns: 2,
          fields: [
            'event_id',
            'rule',
            'sensor',
            'device',
            'triggered_at',
            'status',
            'severity',
            'trigger_value',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['event_id'],
      filters: [{ label: 'Firing', domain: [['status', '=', 'firing']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
];
