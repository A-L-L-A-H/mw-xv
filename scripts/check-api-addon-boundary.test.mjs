import assert from 'node:assert/strict';
import test from 'node:test';
import { findApiAddonBoundaryViolations } from './check-api-addon-boundary.mjs';

test('blocks new defineModel, BaseModel subclasses, and defineAddon inside apps/api/src', () => {
  const modelViolations = findApiAddonBoundaryViolations(
    `import { defineModel, fields } from '@moonwitness/orm';\nexport const Foo = defineModel('custom.foo', { fields: { name: fields.string() } });`,
    'apps/api/src/custom/models.ts'
  );
  assert.equal(modelViolations.length, 1);
  assert.match(modelViolations[0], /ORM model definitions are forbidden/u);

  const classViolations = findApiAddonBoundaryViolations(
    `import { BaseModel } from '@moonwitness/orm';\nexport class CustomModel extends BaseModel {}`,
    'apps/api/src/custom/class-model.ts'
  );
  assert.equal(classViolations.length, 1);
  assert.match(classViolations[0], /BaseModel subclasses are forbidden/u);

  const addonViolations = findApiAddonBoundaryViolations(
    `import { defineAddon } from '@moonwitness/orm';\nexport const customAddon = defineAddon({ name: 'custom', version: '1.0.0', models: [] });`,
    'apps/api/src/custom/manifest.ts'
  );
  assert.equal(addonViolations.length, 1);
  assert.match(addonViolations[0], /Addon manifests are forbidden/u);
});

test('prevents direct ./routes/* imports in apps/api/src/app.ts while allowing addon registry', () => {
  const appViolation = findApiAddonBoundaryViolations(
    `import { genericRoutes } from './routes/generic.routes.js';`,
    'apps/api/src/app.ts'
  );
  assert.equal(appViolation.length, 1);
  assert.match(appViolation[0], /must stay thin/u);

  const allowedRegistry = findApiAddonBoundaryViolations(
    `import { installApiAddons, registerApiAddonRoutes } from './addons/registry.js';`,
    'apps/api/src/app.ts'
  );
  assert.deepEqual(allowedRegistry, []);
});

test('retains explicit legacy allowlist only for whatsapp models/manifest pending extraction', () => {
  assert.deepEqual(
    findApiAddonBoundaryViolations(
      `export const WhatsappAccount = defineModel('whatsapp.account', { fields: {} });`,
      'apps/api/src/whatsapp/models.ts'
    ),
    []
  );
  assert.deepEqual(
    findApiAddonBoundaryViolations(
      `export const whatsappManifest = defineAddon({ name: 'whatsapp', version: '1.0.0', models: [] });`,
      'apps/api/src/whatsapp/manifest.ts'
    ),
    []
  );
});
