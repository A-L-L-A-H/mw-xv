import { describe, expect, it } from 'vitest';

import * as pack from '../src/index.js';
import * as canonical_clinical from '@moonwitness/orm-clinical';
import * as canonical_public_services from '@moonwitness/orm-public-services';
import * as canonical_sensor from '@moonwitness/orm-sensor';
import * as canonical_signal from '@moonwitness/orm-signal';
import * as canonical_sim from '@moonwitness/orm-sim';
import * as canonical_rnd from '@moonwitness/orm-rnd';
import * as canonical_content_factory from '@moonwitness/orm-content-factory';
import * as canonical_accounting from '@moonwitness/orm-accounting';
import * as canonical_hr from '@moonwitness/orm-hr';
import * as canonical_inventory from '@moonwitness/orm-inventory';

describe('clinical compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.clinical).toBeTypeOf('object');
    expect(pack.clinicalManifest).toBe(canonical_clinical.manifest);
  });
});

describe('public_services compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.public_services).toBeTypeOf('object');
    expect(pack.public_servicesManifest).toBe(canonical_public_services.manifest);
  });
});

describe('sensor compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.sensor).toBeTypeOf('object');
    expect(pack.sensorManifest).toBe(canonical_sensor.manifest);
  });
});

describe('signal compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.signal).toBeTypeOf('object');
    expect(pack.signalManifest).toBe(canonical_signal.manifest);
  });
});

describe('sim compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.sim).toBeTypeOf('object');
    expect(pack.simManifest).toBe(canonical_sim.simAddon);
  });
});

describe('rnd compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.rnd).toBeTypeOf('object');
    expect(pack.rndManifest).toBe(canonical_rnd.manifest);
  });
});

describe('content_factory compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.content_factory).toBeTypeOf('object');
    expect(pack.content_factoryManifest).toBe(canonical_content_factory.manifest);
  });
});

describe('accounting compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.accounting).toBeTypeOf('object');
    expect(pack.accountingManifest).toBe(canonical_accounting.manifest);
  });
});

describe('hr compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.hr).toBeTypeOf('object');
    expect(pack.hrManifest).toBe(canonical_hr.manifest);
  });
});

describe('inventory compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.inventory).toBeTypeOf('object');
    expect(pack.inventoryManifest).toBe(canonical_inventory.manifest);
  });
});
