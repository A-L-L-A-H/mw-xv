import { AlertStatus, DeviceStatus, TelemetryBatchStatus } from './models.js';

const ALERT_TRANSITIONS = new Set([
  `${AlertStatus.FIRING}>${AlertStatus.ACKNOWLEDGED}`,
  `${AlertStatus.FIRING}>${AlertStatus.RESOLVED}`,
  `${AlertStatus.ACKNOWLEDGED}>${AlertStatus.RESOLVED}`,
]);

const DEVICE_TRANSITIONS = new Set([
  `${DeviceStatus.PROVISIONED}>${DeviceStatus.ONLINE}`,
  `${DeviceStatus.PROVISIONED}>${DeviceStatus.MAINTENANCE}`,
  `${DeviceStatus.PROVISIONED}>${DeviceStatus.DECOMMISSIONED}`,
  `${DeviceStatus.ONLINE}>${DeviceStatus.OFFLINE}`,
  `${DeviceStatus.ONLINE}>${DeviceStatus.MAINTENANCE}`,
  `${DeviceStatus.ONLINE}>${DeviceStatus.DECOMMISSIONED}`,
  `${DeviceStatus.OFFLINE}>${DeviceStatus.ONLINE}`,
  `${DeviceStatus.OFFLINE}>${DeviceStatus.MAINTENANCE}`,
  `${DeviceStatus.OFFLINE}>${DeviceStatus.DECOMMISSIONED}`,
  `${DeviceStatus.MAINTENANCE}>${DeviceStatus.ONLINE}`,
  `${DeviceStatus.MAINTENANCE}>${DeviceStatus.OFFLINE}`,
  `${DeviceStatus.MAINTENANCE}>${DeviceStatus.DECOMMISSIONED}`,
]);

const TELEMETRY_BATCH_TRANSITIONS = new Set([
  `${TelemetryBatchStatus.PENDING}>${TelemetryBatchStatus.PROCESSING}`,
  `${TelemetryBatchStatus.PENDING}>${TelemetryBatchStatus.FAILED}`,
  `${TelemetryBatchStatus.PROCESSING}>${TelemetryBatchStatus.COMPLETED}`,
  `${TelemetryBatchStatus.PROCESSING}>${TelemetryBatchStatus.FAILED}`,
]);

export function canTransitionAlert(transition: { from: string; to: string }): boolean {
  return ALERT_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function canTransitionDevice(transition: { from: string; to: string }): boolean {
  return DEVICE_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function canTransitionTelemetryBatch(transition: { from: string; to: string }): boolean {
  return TELEMETRY_BATCH_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export interface ThresholdBounds {
  warningMin: number | null;
  warningMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
}

export function validateThresholds(bounds: ThresholdBounds): { valid: boolean; reason: string | null } {
  const { warningMin, warningMax, criticalMin, criticalMax } = bounds;
  if (warningMin !== null && warningMax !== null && warningMin >= warningMax) {
    return { valid: false, reason: 'warning_min must be below warning_max' };
  }
  if (criticalMin !== null && criticalMax !== null && criticalMin >= criticalMax) {
    return { valid: false, reason: 'critical_min must be below critical_max' };
  }
  if (warningMin !== null && criticalMin !== null && criticalMin > warningMin) {
    return { valid: false, reason: 'critical_min must not exceed warning_min' };
  }
  if (warningMax !== null && criticalMax !== null && criticalMax < warningMax) {
    return { valid: false, reason: 'critical_max must not be below warning_max' };
  }
  return { valid: true, reason: null };
}

interface LinearConversion {
  slope: number;
  intercept: number;
}

const UNIT_CONVERSIONS: Record<string, LinearConversion> = {
  'celsius>fahrenheit': { slope: 9 / 5, intercept: 32 },
  'fahrenheit>celsius': { slope: 5 / 9, intercept: -160 / 9 },
  'celsius>kelvin': { slope: 1, intercept: 273.15 },
  'kelvin>celsius': { slope: 1, intercept: -273.15 },
  'fahrenheit>kelvin': { slope: 5 / 9, intercept: 255.37222222222223 },
  'kelvin>fahrenheit': { slope: 9 / 5, intercept: -459.67 },
  'bar>psi': { slope: 14.503773773, intercept: 0 },
  'psi>bar': { slope: 0.0689475729, intercept: 0 },
  'pascal>bar': { slope: 1e-5, intercept: 0 },
  'bar>pascal': { slope: 100000, intercept: 0 },
  'psi>pascal': { slope: 6894.7572932, intercept: 0 },
  'pascal>psi': { slope: 0.00014503773773, intercept: 0 },
  'kilowatt>watt': { slope: 1000, intercept: 0 },
  'watt>kilowatt': { slope: 0.001, intercept: 0 },
  'percent>raw': { slope: 0.01, intercept: 0 },
  'raw>percent': { slope: 100, intercept: 0 },
};

export interface UnitConversionResult {
  value: number;
  error: string | null;
}

export function convertUnit(value: number, fromUnit: string, toUnit: string): UnitConversionResult {
  if (fromUnit === toUnit) {
    return { value, error: null };
  }
  const conversion = UNIT_CONVERSIONS[`${fromUnit}>${toUnit}`];
  if (!conversion) {
    return { value: Number.NaN, error: `no conversion registered from '${fromUnit}' to '${toUnit}'` };
  }
  return { value: conversion.slope * value + conversion.intercept, error: null };
}
