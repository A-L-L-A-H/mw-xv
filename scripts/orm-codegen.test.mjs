import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildOpenApi31Spec,
  compileWorkspaceOrmCodegen,
  parseOrmSourceFile,
} from './orm-codegen.mjs';

test('parseOrmSourceFile extracts defineModel, fields, enums, relations, and defineAddon statically', () => {
  const source = `
    import { defineAddon, defineModel, fields } from '@moonwitness/orm';
    const STATUS_VALUES = ['draft', 'active', 'archived'] as const;

    export const Category = defineModel('sample.category', {
      table: 'sample_categories',
      fields: {
        code: fields.string({ required: true, unique: true }),
      },
    });

    export const Item = defineModel('sample.item', {
      table: 'sample_items',
      fields: {
        title: fields.string({ required: true }),
        status: fields.enum(STATUS_VALUES, { required: true, default: 'draft' }),
        category: fields.belongsTo(() => Category, { required: true }),
        active: fields.boolean({ required: true, default: true }),
      },
    });

    export const manifest = defineAddon({
      name: 'sample',
      version: '1.2.0',
      depends: ['base'],
      models: [Category, Item],
    });
  `;

  const parsed = parseOrmSourceFile(source, 'packages/orm-sample/src/manifest.ts');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.models.length, 2);
  assert.equal(parsed.addons.length, 1);
  assert.equal(parsed.addons[0].name, 'sample');
  assert.deepEqual(parsed.addons[0].depends, ['base']);

  const itemModel = parsed.models.find((m) => m.modelName === 'sample.item');
  assert.ok(itemModel);
  const statusField = itemModel.fields.find((f) => f.name === 'status');
  assert.deepEqual(statusField.values, ['active', 'archived', 'draft']);
  assert.equal(statusField.hasDefault, true);
  assert.equal(statusField.required, false);
});

test('parseOrmSourceFile resolves a const field map referenced by fields:', () => {
  const source = `
    import { defineModel, fields, type FieldMap } from '@moonwitness/orm';
    const itemFields: FieldMap = {
      title: fields.string({ required: true }),
      code: fields.string({ unique: true }),
    };
    export const Item = defineModel('sample.item', {
      table: 'sample_items',
      fields: itemFields,
    });
  `;
  const parsed = parseOrmSourceFile(source, 'packages/orm-sample/src/models.ts');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.models.length, 1);
  assert.deepEqual(
    parsed.models[0].fields.map((field) => field.name),
    ['code', 'title']
  );
});

test('buildOpenApi31Spec emits valid OpenAPI 3.1.0 schemas and paths', () => {
  const spec = buildOpenApi31Spec(
    [
      {
        modelName: 'sample.widget',
        tableName: 'sample_widgets',
        addon: 'sample',
        fields: [
          { name: 'name', kind: 'string', required: true },
          { name: 'count', kind: 'integer', required: false },
        ],
      },
    ],
    '1.0.0'
  );

  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.components.schemas.sample_widget);
  assert.deepEqual(spec.components.schemas.sample_widget.required, ['id', 'name']);
  assert.ok(spec.paths['/api/models/sample.widget']);
  assert.ok(spec.paths['/api/models/sample.widget/{id}']);
});

test('compileWorkspaceOrmCodegen fails cleanly in --check mode when models or addons are invalid', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-orm-codegen-fail-'));
  try {
    await mkdir(path.join(tempRoot, 'packages/orm-broken/src'), { recursive: true });
    await writeFile(
      path.join(tempRoot, 'packages/orm-broken/package.json'),
      JSON.stringify({ name: '@moonwitness/orm-broken', version: '1.0.0' })
    );
    await writeFile(
      path.join(tempRoot, 'packages/orm-broken/src/index.ts'),
      'export const broken = 1;\n'
    );

    await assert.rejects(
      () => compileWorkspaceOrmCodegen({ workspaceRoot: tempRoot, check: true }),
      /ORM codegen check failed/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('compileWorkspaceOrmCodegen succeeds deterministically against real workspace packages/orm-*', async () => {
  const first = await compileWorkspaceOrmCodegen({ check: true });
  const second = await compileWorkspaceOrmCodegen({ check: true });

  assert.equal(first.passed, true);
  assert.ok(first.addonCount >= 10);
  assert.ok(first.modelCount >= 40);
  assert.equal(first.openApiVersion, '3.1.0');
  assert.equal(first.inventorySha256, second.inventorySha256);
  assert.equal(first.openApiSha256, second.openApiSha256);
});
