import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyConflictError,
  Environment,
  Registry,
  ValidationError,
  defineAddon,
  defineModel,
  defineView,
  describeFields,
  disableAddon,
  discoverWorkspaceAddons,
  enableAddon,
  expectedIndexNames,
  extendModel,
  extendView,
  fields,
  installAddons,
  introspectDatabaseSchema,
  planAddonsSchemaSync,
  registerAddons,
  resolveViews,
  uninstallAddon,
  validateViews,
  verifyPassword,
} from '../src/index.js';

describe('ORM Engine (Sections 04-07)', () => {
  let db: Knex;

  beforeEach(() => {
    Registry.clear();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('MW-ORM-001 & MW-ORM-002: supports float, decimal, date, datetime, json, and manyToMany with junction table ops', async () => {
    const Tag = defineModel('test.tag', {
      fields: {
        name: fields.string({ required: true }),
      },
    });

    const Product = defineModel('test.product', {
      fields: {
        name: fields.string({ required: true }),
        weight: fields.float({ default: 1.5 }),
        price: fields.decimal({ precision: 12, scale: 2, default: 10.25 }),
        launch_date: fields.date(),
        published_at: fields.datetime(),
        metadata: fields.json(),
        tags: fields.manyToMany(Tag),
      },
    });

    const addon = defineAddon({
      name: 'test_catalog',
      version: '1.0.0',
      models: [Tag, Product],
    });
    await installAddons(db, [addon]);

    const t1 = (await Tag.create({ name: 'Featured' })) as InstanceType<typeof Tag>;
    const t2 = (await Tag.create({ name: 'Sale' })) as InstanceType<typeof Tag>;
    const t3 = (await Tag.create({ name: 'New' })) as InstanceType<typeof Tag>;

    const prod = (await Product.create({
      name: 'Widget',
      weight: 2.75,
      price: 99.95,
      launch_date: '2026-05-01',
      published_at: '2026-05-01T10:00:00Z',
      metadata: { color: 'blue', specs: [1, 2] },
      tags: [t1.id, t2.id],
    })) as InstanceType<typeof Product>;

    const fetched = (await Product.browse(prod.id, { withGraphFetched: 'tags' })) as InstanceType<
      typeof Product
    > & { tags: Array<{ id: number; name: string }> };
    expect(fetched.weight).toBe(2.75);
    expect(Number(fetched.price)).toBe(99.95);
    expect(fetched.launch_date).toBe('2026-05-01');
    expect(fetched.metadata).toEqual({ color: 'blue', specs: [1, 2] });
    expect(fetched.tags.map((t) => t.name).sort()).toEqual(['Featured', 'Sale']);

    await Product.linkManyToMany(prod.id, 'tags', [t3.id]);
    await Product.unlinkManyToMany(prod.id, 'tags', [t1.id]);
    const updated = (await Product.browse(prod.id, { withGraphFetched: 'tags' })) as InstanceType<
      typeof Product
    > & { tags: Array<{ id: number; name: string }> };
    expect(updated.tags.map((t) => t.name).sort()).toEqual(['New', 'Sale']);
  });

  it('MW-ORM-003: extendModel merges fields/unique/constraints in topological addon order and rejects collisions', async () => {
    const Partner = defineModel('ext.partner', {
      fields: {
        name: fields.string({ required: true }),
      },
    });
    const baseAddon = defineAddon({
      name: 'ext_base',
      version: '1.0.0',
      models: [Partner],
    });
    const extAddon = defineAddon({
      name: 'ext_crm',
      version: '1.0.0',
      depends: ['ext_base'],
      models: [],
      extensions: [
        extendModel('ext.partner', {
          fields: {
            vat: fields.string({ index: true }),
          },
          exposedActions: ['action_verify_vat'],
        }),
      ],
    });

    await installAddons(db, [extAddon, baseAddon]);

    const fieldNames = describeFields(Partner).map((f) => f.name);
    expect(fieldNames).toContain('vat');
    expect(Partner.exposedActions).toContain('action_verify_vat');

    const created = (await Partner.create({ name: 'Acme', vat: 'ID-123' })) as InstanceType<
      typeof Partner
    > & { vat: string };
    expect(created.vat).toBe('ID-123');

    // Collision detection
    const badExt = defineAddon({
      name: 'ext_collision',
      version: '1.0.0',
      depends: ['ext_crm'],
      models: [],
      extensions: [
        extendModel('ext.partner', {
          fields: { vat: fields.string() },
        }),
      ],
    });
    await expect(registerAddons(db, [baseAddon, extAddon, badExt])).rejects.toThrow(/collision/i);
  });

  it('MW-ORM-004, MW-ORM-005, MW-ORM-006: computed stored/non-stored fields, defaultGet, onchange, and transactional constraints', async () => {
    const Order = defineModel('test.order', {
      fields: {
        qty: fields.integer({ required: true, default: 1 }),
        unit_price: fields.float({ required: true, default: 10 }),
        subtotal: fields.float({
          store: true,
          depends: ['qty', 'unit_price'],
          compute: (rec) => Number(rec.qty ?? 0) * Number(rec.unit_price ?? 0),
        }),
        summary: fields.string({
          depends: ['qty', 'subtotal'],
          compute: (rec) => `${rec.qty}x = ${rec.subtotal}`,
        }),
      },
      onchange: {
        qty: (vals) => ({
          values: { subtotal: Number(vals.qty ?? 0) * Number(vals.unit_price ?? 0) },
          warnings: Number(vals.qty ?? 0) > 100 ? ['Large order quantity'] : [],
        }),
      },
      constraints: [
        (rec) => {
          if (Number(rec.qty ?? 0) <= 0) {
            throw new ValidationError('Quantity must be positive');
          }
        },
      ],
    });

    await installAddons(db, [
      defineAddon({ name: 'test_sales', version: '1.0.0', models: [Order] }),
    ]);

    // defaultGet
    const defs = await Order.defaultGet();
    expect(defs.qty).toBe(1);
    expect(defs.unit_price).toBe(10);

    // onchange
    const oc = await Order.onchange({ qty: 150, unit_price: 2 }, 'qty');
    expect(oc.values?.subtotal).toBe(300);
    expect(oc.warnings).toEqual(['Large order quantity']);

    // stored & non-stored compute
    const created = (await Order.create({ qty: 3, unit_price: 25 })) as InstanceType<typeof Order>;
    expect(created.subtotal).toBe(75);
    const rows = await Order.search_read([['id', '=', created.id]]);
    expect(rows[0]?.subtotal).toBe(75);
    expect(rows[0]?.summary).toBe('3x = 75');

    // constraint violation
    await expect(Order.create({ qty: 0, unit_price: 10 })).rejects.toThrow(ValidationError);

    // cyclic computed dependency rejected at defineModel time
    expect(() =>
      defineModel('test.cyclic', {
        fields: {
          a: fields.integer({ depends: ['b'], compute: (r) => r.b }),
          b: fields.integer({ depends: ['a'], compute: (r) => r.a }),
        },
      })
    ).toThrow(/Circular computed field/i);
  });

  it('MW-ORM-007, MW-ORM-008, MW-ORM-009, MW-ORM-011, MW-ORM-012: Recordset, displayField/nameGet, expectedWriteDate, unified write pipeline, and dotted order', async () => {
    const Country = defineModel('test.country', {
      displayField: 'code',
      fields: {
        code: fields.string({ required: true, unique: true }),
        name: fields.string({ required: true }),
      },
    });
    const Account = defineModel('test.account', {
      fields: {
        login: fields.string({ required: true, pattern: '^[a-z0-9_]+$' }),
        secret_key: fields.string({ sensitive: true }),
        password: fields.password(),
        country: fields.belongsTo(Country, { onDelete: 'set null' }),
      },
    });

    await installAddons(db, [
      defineAddon({ name: 'test_core', version: '1.0.0', models: [Country, Account] }),
    ]);

    const cId = (await Country.create({ code: 'ID', name: 'Indonesia' })) as InstanceType<
      typeof Country
    >;
    const cAu = (await Country.create({ code: 'AU', name: 'Australia' })) as InstanceType<
      typeof Country
    >;

    expect(cId.display_name).toBe('ID');
    const names = await Country.nameGet([cId.id, cAu.id]);
    expect(names).toEqual(
      expect.arrayContaining([
        [cId.id, 'ID'],
        [cAu.id, 'AU'],
      ])
    );

    const a1 = (await Account.create({
      login: 'zara',
      secret_key: 'top-secret',
      password: 'initial-password',
      country_id: cId.id,
    })) as InstanceType<typeof Account>;
    const a2 = (await Account.create({
      login: 'alice',
      secret_key: 'another-secret',
      password: 'initial-password',
      country_id: cAu.id,
    })) as InstanceType<typeof Account>;

    // Dotted order by belongsTo relation
    const orderedByCountry = (await Account.search([], { order: 'country.name asc' })) as Array<
      InstanceType<typeof Account>
    >;
    expect(orderedByCountry.map((a) => a.login)).toEqual(['alice', 'zara']);

    // Reject invalid dotted order
    await expect(Account.search([], { order: 'country.nonexistent asc' })).rejects.toThrow();

    // Unified write pipeline: password hashing + pattern validation + redaction
    await Account.write([a1.id], { password: 'new-strong-password' });
    const rawRow = (await db('test_account').where({ id: a1.id }).first()) as { password: string };
    expect(rawRow.password.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('new-strong-password', rawRow.password)).toBe(true);

    await expect(Account.write([a1.id], { login: 'INVALID LOGIN!' })).rejects.toThrow();

    const redacted = Account.redactSensitive({
      login: 'zara',
      secret_key: 'top-secret',
      password: 'hash',
    });
    expect(redacted.password).toBeUndefined();
    expect(redacted.secret_key).toBe('[REDACTED]');

    // Optimistic concurrency expectedWriteDate
    await expect(
      Account.write([a1.id], { login: 'zara_2' }, { expectedWriteDate: '1999-01-01T00:00:00.000Z' })
    ).rejects.toThrow(ConcurrencyConflictError);
    await expect(
      Account.unlink([a1.id], true, { expectedWriteDate: '1999-01-01T00:00:00.000Z' })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Recordset
    const env = new Environment({ userId: 1 });
    const rs = await env.search<InstanceType<typeof Account>>('test.account', []);
    expect(rs.length).toBe(2);
    expect(() => rs.ensureOne()).toThrow(ValidationError);
    const filtered = rs.filtered((r) => r.login === 'alice');
    expect(filtered.ensureOne().id).toBe(a2.id);
    expect(filtered.mapped('login')).toEqual(['alice']);
    await filtered.executeAction('action_archive');
    const reloaded = (await Account.browse(a2.id)) as InstanceType<typeof Account>;
    expect(reloaded.active).toBe(false);
  });

  it('MW-SCHEMA-001, MW-SCHEMA-005, MW-SCHEMA-007, MW-ADDON-002..005: introspection, dry-run plan, orphan index cleanup, addon lifecycle & rollback', async () => {
    const Item = defineModel('sch.item', {
      fields: {
        name: fields.string({ required: true }),
        status: fields.enum(['draft', 'done'] as const, { default: 'draft' }),
      },
    });
    const baseAddon = defineAddon({
      name: 'sch_base',
      version: '1.0.0',
      models: [Item],
    });

    // Dry-run plan before install
    const initialPlan = await planAddonsSchemaSync(db, [baseAddon]);
    expect(initialPlan.hasDestructive).toBe(false);
    expect(initialPlan.items.some((i) => i.action === 'create_table')).toBe(true);
    expect(await db.schema.hasTable('sch_item')).toBe(false);

    // Install and introspect
    await installAddons(db, [baseAddon]);
    const snaps = await introspectDatabaseSchema(db, ['sch_item']);
    const snap = snaps.get('sch_item')!;
    expect(snap.exists).toBe(true);
    expect(snap.columns.map((c) => c.name)).toContain('status');

    // Create a DBA index and an orphan mw_idx_* index
    await db.raw('CREATE INDEX dba_custom_idx ON sch_item (name)');
    await db.raw('CREATE INDEX mw_idx_deadbeef0000 ON sch_item (name)');
    await installAddons(db, [baseAddon]);
    const afterReconcile = (await introspectDatabaseSchema(db, ['sch_item'])).get('sch_item')!;
    const idxNames = afterReconcile.indexes.map((i) => i.name);
    expect(idxNames).toContain('dba_custom_idx');
    expect(idxNames).not.toContain('mw_idx_deadbeef0000');

    // Addon compatibility & topo sort
    const depAddon = defineAddon({
      name: 'sch_ext',
      version: '1.0.0',
      depends: ['sch_base'],
      compatibility: { sch_base: '>=1.0.0' },
      models: [],
    });
    expect(discoverWorkspaceAddons([depAddon, baseAddon]).map((a) => a.name)).toEqual([
      'sch_base',
      'sch_ext',
    ]);

    await installAddons(db, [baseAddon, depAddon]);

    // Cannot disable or uninstall sch_base while sch_ext depends on it
    await expect(disableAddon(db, 'sch_base')).rejects.toThrow(ConcurrencyConflictError);
    await expect(uninstallAddon(db, 'sch_base')).rejects.toThrow(ConcurrencyConflictError);

    // Disable -> enable -> uninstall leaf addon
    await disableAddon(db, 'sch_ext');
    const disabledRow = (await db('_orm_addons').where({ name: 'sch_ext' }).first()) as {
      status: string;
    };
    expect(disabledRow.status).toBe('disabled');
    await enableAddon(db, 'sch_ext');
    await uninstallAddon(db, 'sch_ext');
    expect(await db('_orm_addons').where({ name: 'sch_ext' }).first()).toBeUndefined();

    // Atomic in-memory rollback on failed install
    const BadModel = defineModel('sch.bad', { fields: { x: fields.string() } });
    const failingAddon = defineAddon({
      name: 'sch_fail',
      version: '1.0.0',
      models: [BadModel],
      setup: async () => {
        throw new Error('simulated setup failure');
      },
    });
    await expect(installAddons(db, [baseAddon, failingAddon])).rejects.toThrow(
      /simulated setup failure/
    );
    expect(Registry.has('sch.bad')).toBe(false);
  });

  it('MW-VIEW-001..010: multi-view registry, extendView, view validation, enhanced defaults, and Registry.getGeneration()', async () => {
    const Task = defineModel('vw.task', {
      displayField: 'title',
      fields: {
        title: fields.string({ required: true }),
        stage: fields.enum(['todo', 'doing', 'done'] as const, { default: 'todo' }),
        deadline: fields.date(),
        hours: fields.float(),
        secret: fields.password(),
      },
    });

    const genBefore = Registry.getGeneration();
    const baseView = defineView(Task, {
      title: 'Tasks',
      list: {
        columns: ['title', { name: 'hours', aggregate: 'sum' }],
        editable: 'bottom',
      },
      form: {
        sections: [{ title: 'Main', fields: ['title', 'stage'] }],
      },
      kanban: { groupBy: 'stage', stageOrder: ['todo', 'doing', 'done'] },
      calendar: { dateStart: 'deadline', titleField: 'title' },
    });

    const ext1 = extendView(
      'vw.task',
      [
        { target: 'list', position: 'after', anchor: 'title', fields: ['stage'] },
        {
          target: 'form',
          position: 'insertSection',
          section: { title: 'Schedule', fields: ['deadline'] },
        },
        {
          target: 'search',
          position: 'addFilter',
          filter: { label: 'Done', domain: [['stage', '=', 'done']] },
        },
      ],
      { priority: 10, addonName: 'ext1' }
    );

    await registerAddons(db, [
      defineAddon({
        name: 'vw_base',
        version: '1.0.0',
        models: [Task],
        views: [baseView],
        viewExtensions: [ext1],
      }),
    ]);

    expect(Registry.getGeneration()).toBeGreaterThan(genBefore);
    const resolved = resolveViews(Task);
    expect(resolved.displayField).toBe('title');
    expect(resolved.list.columns.map((c) => (typeof c === 'string' ? c : c.name))).toEqual([
      'title',
      'stage',
      'hours',
    ]);
    expect(resolved.form.sections).toHaveLength(2);
    expect(resolved.search.filters.some((f) => f.label === 'Done')).toBe(true);

    // Negative view validation: invalid kanban groupBy & hidden field
    expect(() =>
      validateViews(Task, {
        ...resolved,
        kanban: { groupBy: 'title' },
      })
    ).toThrow(/Kanban groupBy/i);

    expect(() =>
      validateViews(Task, {
        ...resolved,
        list: { columns: ['secret'] },
      })
    ).toThrow(/Write-only field/i);

    expect(() =>
      validateViews(Task, {
        ...resolved,
        calendar: { dateStart: 'title' },
      })
    ).toThrow(/Calendar date field/i);
  });

  it('MW-PERF-004.1..3: benchmarks 1,000+ record relational domain & eager-loading query latency (p50/p95) and verifies composite index (company_id, active, id) usage', async () => {
    const Company = defineModel('perf.company', {
      fields: {
        name: fields.string({ required: true }),
        region: fields.string({ required: true, index: true }),
      },
    });
    const Department = defineModel('perf.department', {
      fields: {
        name: fields.string({ required: true }),
        code: fields.string({ required: true, index: true }),
      },
    });
    const Employee = defineModel('perf.employee', {
      fields: {
        name: fields.string({ required: true }),
        company: fields.belongsTo(Company, { required: true }),
        department: fields.belongsTo(Department, { required: true }),
        salary: fields.integer({ required: true, default: 5000 }),
        bonus: fields.integer({ required: true, default: 500 }),
        total_comp: fields.integer({
          store: true,
          depends: ['salary', 'bonus'],
          compute: (rec) => Number(rec.salary ?? 0) + Number(rec.bonus ?? 0),
        }),
      },
    });

    await installAddons(db, [
      defineAddon({
        name: 'perf_bench',
        version: '1.0.0',
        models: [Company, Department, Employee],
      }),
    ]);

    // MW-PERF-004.2: Verify composite index (company_id, active, id) and FK indexes exist and are used by query planner
    const expectedIdx = expectedIndexNames(Employee);
    const compositeIdx = expectedIdx.indexes.find(
      (idx) => idx.columns.join(',') === 'company_id,active,id'
    );
    expect(compositeIdx).toBeDefined();

    const snapshots = await introspectDatabaseSchema(db, ['perf_employee']);
    const empSnap = snapshots.get('perf_employee')!;
    expect(empSnap.indexes.some((idx) => idx.name === compositeIdx!.name)).toBe(true);
    expect(
      empSnap.indexes.some(
        (idx) => idx.columns.length === 3 && idx.columns.join(',') === 'company_id,active,id'
      )
    ).toBe(true);

    // Seed 2 companies, 4 departments, and 1,200 employee records
    const c1 = (await Company.create({ name: 'Alpha Corp', region: 'APAC' })) as InstanceType<
      typeof Company
    >;
    const c2 = (await Company.create({ name: 'Beta Corp', region: 'EMEA' })) as InstanceType<
      typeof Company
    >;
    const d1 = (await Department.create({ name: 'Engineering', code: 'ENG' })) as InstanceType<
      typeof Department
    >;
    const d2 = (await Department.create({ name: 'Operations', code: 'OPS' })) as InstanceType<
      typeof Department
    >;

    const nowIso = new Date().toISOString();
    const bulkRows = Array.from({ length: 1200 }, (_, i) => {
      const salary = 4000 + (i % 50) * 100;
      const bonus = (i % 10) * 100;
      return {
        name: `Employee ${i + 1}`,
        company_id: i % 2 === 0 ? c1.id : c2.id,
        department_id: i % 3 === 0 ? d1.id : d2.id,
        salary,
        bonus,
        total_comp: salary + bonus,
        active: true,
        create_date: nowIso,
        write_date: nowIso,
      };
    });
    await db.batchInsert('perf_employee', bulkRows, 200);

    // Verify EXPLAIN QUERY PLAN uses the composite index (company_id, active, id)
    const explainRows = (await db.raw(
      'EXPLAIN QUERY PLAN SELECT id, name, total_comp FROM perf_employee WHERE company_id = ? AND active = 1 ORDER BY id ASC LIMIT 100',
      [c1.id]
    )) as Array<{ detail?: string }>;
    const planDetails = explainRows.map((r) => r.detail ?? '').join(' ');
    expect(planDetails).toContain(compositeIdx!.name);

    // MW-PERF-004.1 & MW-PERF-004.3: Measure p50/p95 latency over 15 iterations for 1,200+ record relational domain + eager loading
    const latenciesMs: number[] = [];
    let lastCount = 0;
    for (let iter = 0; iter < 15; iter += 1) {
      const t0 = performance.now();
      const results = await Employee.search_read(
        [
          ['company_id', '=', c1.id],
          ['department.code', '=', 'ENG'],
        ],
        ['id', 'name', 'total_comp', 'company_id', 'department_id'],
        {
          withGraphFetched: '[company, department]',
          limit: 500,
          order: 'id asc',
        }
      );
      latenciesMs.push(performance.now() - t0);
      lastCount = results.length;
    }

    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const p50Ms = sorted[Math.floor(sorted.length * 0.5)]!;
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;

    expect(lastCount).toBe(200);
    expect(p50Ms).toBeGreaterThan(0);
    expect(p50Ms).toBeLessThan(250);
    expect(p95Ms).toBeLessThan(500);
  });
});
