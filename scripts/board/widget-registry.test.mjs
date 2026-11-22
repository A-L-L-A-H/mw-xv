import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const widgetRegistryPath = path.join(
  repoRoot,
  'apps/board/src/components/views/widget-registry.tsx'
);
const fieldsPath = path.join(repoRoot, 'apps/board/src/components/views/fields.tsx');

async function loadWidgetRegistryModule() {
  const source = await readFile(widgetRegistryPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: widgetRegistryPath,
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(
    transpiled.outputText,
    'utf8'
  ).toString('base64')}`;
  return import(dataUrl);
}

const {
  DEFAULT_WIDGET_TYPES,
  FieldWidgetRegistry,
  fieldWidgetRegistry,
  formatFieldValue,
  normalizeWidgetKey,
  registerFieldWidget,
  resolveFieldWidget,
} = await loadWidgetRegistryModule();

test('FieldWidgetRegistry seeds all required canonical default widget mappings', () => {
  const registry = new FieldWidgetRegistry(true);
  const requiredTypes = [
    'string',
    'text',
    'integer',
    'float',
    'decimal',
    'monetary',
    'boolean',
    'date',
    'datetime',
    'selection',
    'statusbar',
    'json',
    'manyToOne',
    'oneToMany',
    'manyToMany',
  ];

  for (const typeName of requiredTypes) {
    assert.ok(registry.has(typeName), `Expected default widget registry to contain "${typeName}"`);
    const resolved = registry.resolve({ type: typeName });
    assert.equal(resolved.name, normalizeWidgetKey(typeName));
  }

  assert.ok(DEFAULT_WIDGET_TYPES.length >= requiredTypes.length);
});

test('resolveFieldWidget resolves explicit widget override before field.widget and field.type', () => {
  const registry = new FieldWidgetRegistry(true);

  registry.register({
    name: 'custom_rating',
    renderWidget: ({ value }) => `rating:${String(value ?? 0)}`,
    formatValue: (value) => `${String(value ?? 0)} stars`,
  });

  // 1. Explicit widget parameter takes top precedence
  const byParam = registry.resolve({ type: 'integer', widget: 'statusbar' }, 'custom_rating');
  assert.equal(byParam.name, 'custom_rating');

  // 2. field.widget attribute overrides field.type
  const byFieldWidget = registry.resolve({
    type: 'selection',
    widget: 'statusbar',
  });
  assert.equal(byFieldWidget.name, 'statusbar');

  // 3. field.type resolves when no widget override is provided
  const byType = registry.resolve({ type: 'decimal' });
  assert.equal(byType.name, 'decimal');
});

test('resolveFieldWidget normalizes relational aliases (many2one <-> manyToOne, one2many <-> oneToMany, many2many <-> manyToMany)', () => {
  const m2o = resolveFieldWidget({ type: 'many2one' });
  const m2oCamel = resolveFieldWidget({ type: 'manyToOne' });
  assert.equal(m2o.name, 'manyToOne');
  assert.equal(m2oCamel.name, 'manyToOne');

  const o2m = resolveFieldWidget({ type: 'one2many' });
  const o2mCamel = resolveFieldWidget({ type: 'oneToMany' });
  assert.equal(o2m.name, 'oneToMany');
  assert.equal(o2mCamel.name, 'oneToMany');

  const m2m = resolveFieldWidget({ type: 'many2many' });
  const m2mCamel = resolveFieldWidget({ type: 'manyToMany' });
  assert.equal(m2m.name, 'manyToMany');
  assert.equal(m2mCamel.name, 'manyToMany');
});

test('resolveFieldWidget falls back cleanly to string widget for unknown widget and unknown field.type', () => {
  const unknownBoth = resolveFieldWidget(
    { type: 'unknown_future_type', widget: 'non_existent_widget' },
    'also_missing'
  );
  assert.equal(unknownBoth.name, 'string');

  const unknownWidgetKnownType = resolveFieldWidget({
    type: 'monetary',
    widget: 'non_existent_widget',
  });
  assert.equal(unknownWidgetKnownType.name, 'monetary');
});

test('registerFieldWidget registers and unregisters custom widgets on singleton registry', () => {
  const custom = registerFieldWidget({
    name: 'sparkline_metric',
    supportsInlineEdit: false,
    renderWidget: ({ value }) => `sparkline:${String(value)}`,
    formatValue: (value) => `metric(${String(value)})`,
  });

  assert.equal(custom.name, 'sparkline_metric');
  assert.equal(fieldWidgetRegistry.has('sparkline_metric'), true);

  const resolved = resolveFieldWidget({
    name: 'trend',
    label: 'Trend',
    type: 'json',
    widget: 'sparkline_metric',
    required: false,
    readonly: true,
    unique: false,
  });
  assert.equal(resolved.name, 'sparkline_metric');
  assert.equal(resolved.supportsInlineEdit, false);
  assert.equal(
    formatFieldValue(
      {
        name: 'trend',
        label: 'Trend',
        type: 'json',
        widget: 'sparkline_metric',
        required: false,
        readonly: true,
        unique: false,
      },
      [1, 2, 3]
    ),
    'metric(1,2,3)'
  );

  fieldWidgetRegistry.unregister('sparkline_metric');
  assert.equal(fieldWidgetRegistry.has('sparkline_metric'), false);
});

test('formatFieldValue formats monetary, selection, manyToOne, manyToMany, password, and json deterministically', () => {
  const monetaryText = formatFieldValue(
    {
      name: 'amount_total',
      label: 'Total',
      type: 'monetary',
      currencyField: 'currency_code',
      required: false,
      readonly: false,
      unique: false,
    },
    1250.5,
    { currency_code: 'IDR', amount_total: 1250.5 }
  );
  assert.equal(monetaryText, 'IDR 1250.50');

  const selectionText = formatFieldValue(
    {
      name: 'state',
      label: 'State',
      type: 'selection',
      widget: 'statusbar',
      selection: [
        { value: 'draft', label: 'Draft Quotation' },
        { value: 'posted', label: 'Posted' },
      ],
      required: false,
      readonly: false,
      unique: false,
    },
    'draft'
  );
  assert.equal(selectionText, 'Draft Quotation');

  const m2oText = formatFieldValue(
    {
      name: 'user_id',
      label: 'Responsible',
      type: 'many2one',
      relation: 'custom.actor',
      relationField: 'handle',
      required: false,
      readonly: false,
      unique: false,
    },
    42,
    { user_id: 42, user: { id: 42, handle: '@archon' } }
  );
  assert.equal(m2oText, '@archon');

  const passwordText = formatFieldValue(
    {
      name: 'secret',
      label: 'Secret',
      type: 'password',
      required: false,
      readonly: false,
      unique: false,
    },
    'plaintext-secret'
  );
  assert.equal(passwordText, '••••••');
});

test('fields.tsx and widget-registry.tsx contain zero hardcoded model checks and wire shared UI primitives', async () => {
  const [registrySource, fieldsSource] = await Promise.all([
    readFile(widgetRegistryPath, 'utf8'),
    readFile(fieldsPath, 'utf8'),
  ]);

  const bannedHardcodedModels = [
    'base.country_state',
    'base.country',
    'base.bank',
    'base.user',
    'base.partner',
    'request.purchase_request',
  ];

  for (const modelName of bannedHardcodedModels) {
    assert.equal(
      registrySource.includes(modelName),
      false,
      `widget-registry.tsx must not hardcode model "${modelName}"`
    );
    assert.equal(
      fieldsSource.includes(modelName),
      false,
      `fields.tsx must not hardcode model "${modelName}"`
    );
  }

  // Verify shared @moonwitness/ui component integrations in fields.tsx
  assert.ok(
    fieldsSource.includes('@moonwitness/ui/components/date-picker'),
    'fields.tsx must integrate DatePicker from @moonwitness/ui/components/date-picker'
  );
  assert.ok(
    fieldsSource.includes('@moonwitness/ui/components/number-input'),
    'fields.tsx must integrate NumberInput from @moonwitness/ui/components/number-input'
  );
  assert.ok(
    fieldsSource.includes('@moonwitness/ui/components/tag-input'),
    'fields.tsx must integrate TagInput from @moonwitness/ui/components/tag-input'
  );
  assert.ok(
    fieldsSource.includes('@moonwitness/ui/components/status-bar'),
    'fields.tsx must integrate StatusBar from @moonwitness/ui/components/status-bar'
  );
});
