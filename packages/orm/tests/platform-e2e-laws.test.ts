import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyConflictError,
  Environment,
  Registry,
  ValidationError,
  applyDomain,
  defineAddon,
  defineModel,
  defineView,
  describeFields,
  disableAddon,
  discoverWorkspaceAddons,
  enableAddon,
  extendModel,
  extendView,
  fields,
  getModelMenuInfo,
  installAddons,
  introspectDatabaseSchema,
  planAddonsSchemaSync,
  ref,
  registerAddons,
  resolveDomainContext,
  resolveViews,
  seed,
  uninstallAddon,
  validateDomain,
  type Addon,
} from '../src/index.js';

describe('MW-E2E-001..MW-E2E-016: End-to-End Platform Law Conformance Suite', () => {
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

  it('MW-E2E-001: Addon Discovery — discovers workspace addons deterministically with compatibility checks', () => {
    const BaseEntity = defineModel('e2e.base_entity', {
      fields: {
        name: fields.string({ required: true }),
      },
    });
    const baseAddon = defineAddon({
      name: 'base',
      version: '1.2.0',
      displayName: 'Core Base',
      category: 'Core',
      models: [BaseEntity],
    });
    const crmAddon = defineAddon({
      name: 'crm',
      version: '1.0.0',
      depends: ['base'],
      compatibility: { base: '>=1.0.0' },
      models: [],
    });
    const billingAddon = defineAddon({
      name: 'billing',
      version: '1.0.0',
      depends: ['base', 'crm'],
      compatibility: { base: '^1.1.0', crm: '1.0.0' },
      models: [],
    });

    const discovered = discoverWorkspaceAddons([billingAddon, crmAddon, baseAddon]);
    expect(discovered.map((addon) => addon.name)).toEqual(['base', 'crm', 'billing']);

    const incompatibleAddon = defineAddon({
      name: 'incompatible_leaf',
      version: '1.0.0',
      depends: ['base'],
      compatibility: { base: '>=2.0.0' },
      models: [],
    });
    expect(() => discoverWorkspaceAddons([baseAddon, incompatibleAddon])).toThrow(
      /incompatible with 'base@1\.2\.0'/i
    );
  });

  it('MW-E2E-002: Manifest Validation — validates addon manifest fail-closed before database mutation', async () => {
    const ValidModel = defineModel('e2e.valid_item', {
      fields: {
        title: fields.string({ required: true }),
      },
    });

    expect(() =>
      defineAddon({
        name: 'bad_semver',
        version: 'v1.0',
        models: [ValidModel],
      })
    ).toThrow(/semantic version/i);

    expect(() =>
      defineAddon({
        name: 'bad_menu_target',
        version: '1.0.0',
        models: [ValidModel],
        menus: [{ model: 'e2e.non_existent', group: 'Sales' }],
      })
    ).toThrow(/not in addon/i);

    const UninstalledModel = defineModel('e2e.uninstalled_seed', {
      fields: { code: fields.string({ required: true }) },
    });
    const badSeedAddon = defineAddon({
      name: 'bad_seed',
      version: '1.0.0',
      models: [ValidModel],
      data: [seed(UninstalledModel, 'bad_seed.rec_1', { code: 'A1' })],
    });

    await expect(installAddons(db, [badSeedAddon])).rejects.toThrow(/Seed model not installed/i);
    expect(await db.schema.hasTable('e2e_valid_item')).toBe(false);
  });

  it('MW-E2E-003: Dependency Resolution — topologically orders addon dependency chains and FK tables regardless of input order', async () => {
    const Company = defineModel('e2e.company', {
      fields: { name: fields.string({ required: true }) },
    });
    const Job = defineModel('e2e.job', {
      fields: {
        queue: fields.string({ required: true }),
        company: fields.belongsTo(Company),
      },
    });
    const Notification = defineModel('e2e.notification', {
      fields: {
        subject: fields.string({ required: true }),
        job: fields.belongsTo(Job),
      },
    });
    const Workflow = defineModel('e2e.workflow', {
      fields: {
        code: fields.string({ required: true }),
        notification: fields.belongsTo(Notification),
      },
    });
    const Request = defineModel('e2e.request', {
      fields: {
        title: fields.string({ required: true }),
        workflow: fields.belongsTo(Workflow),
      },
    });

    const addonBase = defineAddon({ name: 'base', version: '1.0.0', models: [Company] });
    const addonJobs = defineAddon({
      name: 'jobs',
      version: '1.0.0',
      depends: ['base'],
      models: [Job],
    });
    const addonNotification = defineAddon({
      name: 'notification',
      version: '1.0.0',
      depends: ['jobs'],
      models: [Notification],
    });
    const addonWorkflow = defineAddon({
      name: 'workflow',
      version: '1.0.0',
      depends: ['notification'],
      models: [Workflow],
    });
    const addonRequest = defineAddon({
      name: 'request',
      version: '1.0.0',
      depends: ['workflow'],
      models: [Request],
    });

    const reversedInput: readonly Addon[] = [
      addonRequest,
      addonWorkflow,
      addonNotification,
      addonJobs,
      addonBase,
    ];
    const shuffledInput: readonly Addon[] = [
      addonWorkflow,
      addonBase,
      addonRequest,
      addonJobs,
      addonNotification,
    ];

    expect(discoverWorkspaceAddons(reversedInput).map((a) => a.name)).toEqual([
      'base',
      'jobs',
      'notification',
      'workflow',
      'request',
    ]);
    expect(discoverWorkspaceAddons(shuffledInput).map((a) => a.name)).toEqual([
      'base',
      'jobs',
      'notification',
      'workflow',
      'request',
    ]);

    await installAddons(db, reversedInput);
    expect(await db.schema.hasTable('e2e_request')).toBe(true);
  });

  it('MW-E2E-004: Model & Extension Registration — merges extendModel into Registry in both installAddons and registerAddons modes', async () => {
    const Partner = defineModel('e2e.partner', {
      fields: {
        name: fields.string({ required: true }),
      },
    });
    const baseAddon = defineAddon({
      name: 'base',
      version: '1.0.0',
      models: [Partner],
    });
    const taxExtensionAddon = defineAddon({
      name: 'tax_ext',
      version: '1.0.0',
      depends: ['base'],
      models: [],
      extensions: [
        extendModel('e2e.partner', {
          fields: {
            tax_id: fields.string({ unique: true }),
            credit_limit: fields.float({ default: 5000 }),
          },
          exposedActions: ['action_recheck_credit'],
        }),
      ],
    });

    // Simulate SKIP_BOOT_MIGRATIONS=true in-memory registration first
    await registerAddons(db, [taxExtensionAddon, baseAddon]);
    expect(Registry.has('e2e.partner')).toBe(true);
    expect(Partner.knex()).toBe(db);
    const fieldMeta = describeFields(Partner);
    expect(fieldMeta.map((f) => f.name)).toEqual(
      expect.arrayContaining(['name', 'tax_id', 'credit_limit'])
    );
    expect(Partner.exposedActions).toContain('action_recheck_credit');

    // Synchronize schema and verify extended fields persist
    await installAddons(db, [baseAddon, taxExtensionAddon]);
    const rec = (await Partner.create({
      name: 'Nusantara Corp',
      tax_id: 'NPWP-001',
    })) as InstanceType<typeof Partner> & { tax_id: string; credit_limit: number };
    expect(rec.tax_id).toBe('NPWP-001');
    expect(rec.credit_limit).toBe(5000);
  });

  it('MW-E2E-005: ORM Schema Sync — synchronizes tables, columns, enums, indexes, and FKs with zero dry-run diff post-sync', async () => {
    const Category = defineModel('e2e.category', {
      fields: {
        code: fields.string({ required: true, unique: true }),
      },
    });
    const Ticket = defineModel('e2e.ticket', {
      unique: [['code', 'category']],
      fields: {
        code: fields.string({ required: true, index: true }),
        priority: fields.enum(['low', 'medium', 'high'] as const, { default: 'medium' }),
        category: fields.belongsTo(Category, { required: true, onDelete: 'cascade' }),
      },
    });

    const addon = defineAddon({
      name: 'ticketing',
      version: '1.0.0',
      models: [Category, Ticket],
    });

    const prePlan = await planAddonsSchemaSync(db, [addon]);
    expect(prePlan.hasDestructive).toBe(false);
    expect(prePlan.items.length).toBeGreaterThan(0);

    await installAddons(db, [addon]);

    const postPlan = await planAddonsSchemaSync(db, [addon]);
    expect(postPlan.items).toEqual([]);
    expect(postPlan.hasDestructive).toBe(false);

    const snaps = await introspectDatabaseSchema(db, ['e2e_ticket']);
    const ticketSnap = snaps.get('e2e_ticket')!;
    expect(ticketSnap.exists).toBe(true);
    expect(ticketSnap.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'code', 'priority', 'category_id'])
    );
    expect(ticketSnap.foreignKeys.some((fk) => fk.column === 'category_id')).toBe(true);
    expect(
      ticketSnap.checkConstraints.some(
        (chk) => chk.column === 'priority' && chk.enumValues?.includes('high')
      )
    ).toBe(true);
  });

  it('MW-E2E-006: Access Permission Registration — registers security metadata and idempotently seeds model access grants while preserving admin edits', async () => {
    const AccessGroup = defineModel('e2e.access_group', {
      fields: {
        code: fields.string({ required: true, unique: true }),
        name: fields.string({ required: true }),
      },
    });
    const ModelAccess = defineModel('e2e.model_access', {
      unique: [['group', 'model_name']],
      fields: {
        group: fields.belongsTo(AccessGroup, { required: true }),
        model_name: fields.string({ required: true }),
        read: fields.boolean({ default: true }),
        create: fields.boolean({ default: false }),
        write: fields.boolean({ default: false }),
        unlink: fields.boolean({ default: false }),
      },
    });

    const securityAddon = defineAddon({
      name: 'base',
      version: '1.0.0',
      models: [AccessGroup, ModelAccess],
      security: {
        defaultPolicy: 'default-deny',
        policies: {
          'e2e.access_group': 'adminOnly',
          'e2e.model_access': 'adminOnly',
        },
      },
      data: [
        seed(AccessGroup, 'base.group_member', { code: 'member', name: 'Workspace Member' }),
        seed(ModelAccess, 'base.access_member_ticket', {
          group: ref('base.group_member'),
          model_name: 'e2e.ticket',
          read: true,
          create: false,
          write: false,
          unlink: false,
        }),
      ],
    });

    await installAddons(db, [securityAddon]);
    const initialGrant = (
      await ModelAccess.search([['model_name', '=', 'e2e.ticket']])
    )[0] as InstanceType<typeof ModelAccess>;
    expect(initialGrant.read).toBe(true);
    expect(initialGrant.write).toBe(false);

    // Administrator manually grants write permission
    await ModelAccess.write([initialGrant.id], { write: true });

    // Re-running installAddons must preserve the administrator's manual modification
    await installAddons(db, [securityAddon]);
    const afterReinstall = (await ModelAccess.browse(initialGrant.id)) as InstanceType<
      typeof ModelAccess
    >;
    expect(afterReinstall.write).toBe(true);
  });

  it('MW-E2E-007: View Registration & Inheritance — merges base defineView and ordered extendView patches into ResolvedViews and bumps generation', async () => {
    const Project = defineModel('e2e.project', {
      displayField: 'name',
      fields: {
        name: fields.string({ required: true }),
        stage: fields.enum(['planning', 'active', 'closed'] as const, { default: 'planning' }),
        budget: fields.decimal({ precision: 14, scale: 2, default: 0 }),
        start_date: fields.date(),
        notes: fields.text(),
      },
    });

    const baseView = defineView(Project, {
      title: 'Projects',
      list: { columns: ['name', 'stage'] },
      form: {
        header: {
          statusField: 'stage',
          buttons: [{ label: 'Activate', action: 'action_activate', variant: 'primary' }],
        },
        sections: [{ title: 'Overview', fields: ['name', 'stage'] }],
      },
      kanban: { groupBy: 'stage', stageOrder: ['planning', 'active', 'closed'] },
      calendar: { dateStart: 'start_date', titleField: 'name' },
    });

    const financePatch = extendView(
      'e2e.project',
      [
        {
          target: 'list',
          position: 'after',
          anchor: 'stage',
          fields: [{ name: 'budget', aggregate: 'sum' }],
        },
        {
          target: 'form',
          position: 'insertSection',
          section: { title: 'Financials & Notes', fields: ['budget', 'notes'] },
        },
        {
          target: 'search',
          position: 'addFilter',
          filter: { label: 'Active Projects', domain: [['stage', '=', 'active']] },
        },
      ],
      { priority: 20, addonName: 'project_finance' }
    );

    const genBefore = Registry.getGeneration();
    await registerAddons(db, [
      defineAddon({
        name: 'project_core',
        version: '1.0.0',
        models: [Project],
        views: [baseView],
        viewExtensions: [financePatch],
      }),
    ]);

    expect(Registry.getGeneration()).toBeGreaterThan(genBefore);
    const resolved = resolveViews(Project);
    expect(resolved.title).toBe('Projects');
    expect(resolved.list.columns).toEqual(['name', 'stage', { name: 'budget', aggregate: 'sum' }]);
    expect(resolved.form.sections.map((s) => s.title)).toEqual(['Overview', 'Financials & Notes']);
    expect(resolved.kanban?.groupBy).toBe('stage');
    expect(resolved.calendar?.dateStart).toBe('start_date');
    expect(resolved.search.filters.some((f) => f.label === 'Active Projects')).toBe(true);
  });

  it('MW-E2E-008: Action Registration — registers declarative actions and executes exposed recordset actions transactionally', async () => {
    class ApprovalDoc extends defineModel('e2e.approval_doc', {
      fields: {
        title: fields.string({ required: true }),
        state: fields.enum(['draft', 'approved'] as const, { default: 'draft' }),
      },
      exposedActions: ['action_archive', 'action_unarchive', 'action_approve'],
    }) {
      async action_approve() {
        await this.update({ state: 'approved' });
        return { type: 'notify', level: 'success', message: `Approved #${this.id}` };
      }
    }

    const addon = defineAddon({
      name: 'approvals',
      version: '1.0.0',
      models: [ApprovalDoc],
      actions: [
        {
          id: 'approvals.action_approve_doc',
          name: 'Approve Document',
          type: 'record',
          model: 'e2e.approval_doc',
          handler: 'action_approve',
        },
      ],
    });

    await installAddons(db, [addon]);
    const doc = (await ApprovalDoc.create({ title: 'RFC-001' })) as InstanceType<
      typeof ApprovalDoc
    >;
    const env = new Environment({ userId: 7 });
    const rs = await env.browse<InstanceType<typeof ApprovalDoc>>('e2e.approval_doc', [doc.id]);

    const actionResults = await rs.executeAction('action_approve');
    expect(actionResults).toEqual([
      { type: 'notify', level: 'success', message: `Approved #${doc.id}` },
    ]);

    const updated = (await ApprovalDoc.browse(doc.id)) as InstanceType<typeof ApprovalDoc>;
    expect(updated.state).toBe('approved');
    expect(updated.write_uid).toBe(7);

    await expect(rs.executeAction('action_unexposed_hack')).rejects.toThrow(ValidationError);
  });

  it('MW-E2E-009: Menu Registration — registers addon menus with group, sequence, and developmentOnly flags', async () => {
    const PublicReport = defineModel('e2e.public_report', {
      fields: { name: fields.string({ required: true }) },
    });
    const TechDiag = defineModel('e2e.tech_diag', {
      fields: { name: fields.string({ required: true }) },
    });

    const addon = defineAddon({
      name: 'reporting',
      version: '1.0.0',
      models: [PublicReport, TechDiag],
      menus: [
        {
          model: 'e2e.public_report',
          label: 'Executive Reports',
          group: 'Analytics',
          sequence: 15,
          developmentOnly: false,
        },
        {
          model: 'e2e.tech_diag',
          label: 'System Diagnostics',
          group: 'Technical',
          sequence: 900,
          developmentOnly: true,
        },
      ],
    });

    await registerAddons(db, [addon]);
    expect(getModelMenuInfo('e2e.public_report')).toEqual({
      label: 'Executive Reports',
      group: 'Analytics',
      sequence: 15,
      developmentOnly: false,
    });
    expect(getModelMenuInfo('e2e.tech_diag')).toEqual({
      label: 'System Diagnostics',
      group: 'Technical',
      sequence: 900,
      developmentOnly: true,
    });
  });

  it('MW-E2E-010: Metadata Delivery — delivers resolved field metadata, selection options, computed flags, and write-only exclusions without hardcoded schemas', async () => {
    const Partner = defineModel('e2e.meta_partner', {
      displayField: 'display_alias',
      fields: {
        display_alias: fields.string({ required: true, label: 'Partner Alias' }),
        tier: fields.enum(['bronze', 'silver', 'gold'] as const, { default: 'bronze' }),
        is_vip: fields.boolean({
          compute: (rec) => rec.tier === 'gold',
          depends: ['tier'],
        }),
        password_hash: fields.password(),
      },
      onchange: {
        tier: (vals) => ({
          values: { is_vip: vals.tier === 'gold' },
        }),
      },
    });

    await registerAddons(db, [
      defineAddon({
        name: 'meta_delivery',
        version: '1.0.0',
        models: [Partner],
      }),
    ]);

    const resolved = resolveViews(Partner);
    const serialized = JSON.parse(JSON.stringify(resolved)) as typeof resolved;

    expect(serialized.model).toBe('e2e.meta_partner');
    expect(serialized.displayField).toBe('display_alias');
    expect(serialized.list.columns).not.toContain('password_hash');

    const tierMeta = serialized.fields.find((f) => f.name === 'tier');
    expect(tierMeta?.type).toBe('selection');
    expect(tierMeta?.hasOnchange).toBe(true);
    expect(tierMeta?.selection?.map((s) => s.value)).toEqual(['bronze', 'silver', 'gold']);

    const vipMeta = serialized.fields.find((f) => f.name === 'is_vip');
    expect(vipMeta?.computed).toBe(true);
    expect(vipMeta?.readonly).toBe(true);
  });

  it('MW-E2E-011: Dynamic Model View Resolution — resolves list, form (header/tabs/smartButtons), kanban, calendar, graph, pivot, and search views dynamically', async () => {
    const Opportunity = defineModel('e2e.opportunity', {
      displayField: 'title',
      fields: {
        title: fields.string({ required: true }),
        stage: fields.enum(['new', 'qualified', 'won'] as const, { default: 'new' }),
        expected_revenue: fields.decimal({ precision: 14, scale: 2, default: 0 }),
        close_date: fields.date(),
      },
    });

    const oppView = defineView(Opportunity, {
      title: 'Opportunities',
      list: {
        columns: ['title', 'stage', { name: 'expected_revenue', aggregate: 'sum' }],
        decorations: [{ color: 'success', domain: [['stage', '=', 'won']] }],
      },
      form: {
        header: {
          statusField: 'stage',
          buttons: [{ label: 'Mark Won', action: 'action_mark_won', variant: 'primary' }],
        },
        smartButtons: [
          {
            label: 'Activities',
            icon: 'Calendar',
            targetModel: 'base.activity',
            countField: 'id',
          },
        ],
        sections: [{ title: 'Core', fields: ['title', 'stage', 'expected_revenue', 'close_date'] }],
        tabs: [
          {
            title: 'Forecast',
            sections: [{ title: 'Revenue', fields: ['expected_revenue', 'close_date'] }],
          },
        ],
      },
      kanban: { groupBy: 'stage', stageOrder: ['new', 'qualified', 'won'], quickCreate: true },
      calendar: { dateStart: 'close_date', titleField: 'title', mode: 'month' },
      graph: { dimension: 'stage', measure: 'expected_revenue', aggregation: 'sum', type: 'bar' },
      pivot: { rows: ['stage'], measures: ['expected_revenue'] },
    });

    await registerAddons(db, [
      defineAddon({
        name: 'crm_opp',
        version: '1.0.0',
        models: [Opportunity],
        views: [oppView],
      }),
    ]);

    const resolved = resolveViews(Opportunity);
    expect(resolved.list.decorations).toHaveLength(1);
    expect(resolved.form.header?.statusField).toBe('stage');
    expect(resolved.form.smartButtons).toHaveLength(1);
    expect(resolved.form.tabs).toHaveLength(1);
    expect(resolved.kanban?.stageOrder).toEqual(['new', 'qualified', 'won']);
    expect(resolved.calendar?.mode).toBe('month');
    expect(resolved.graph?.type).toBe('bar');
    expect(resolved.pivot?.rows).toEqual(['stage']);
  });

  it('MW-E2E-012: Full CRUD Lifecycle — executes defaultGet, onchange, create, read, write with expectedWriteDate 409 conflict, archive, unarchive, and hard delete', async () => {
    const Invoice = defineModel('e2e.invoice', {
      fields: {
        number: fields.string({ required: true, default: () => 'INV-DRAFT' }),
        units: fields.integer({ required: true, default: 2 }),
        unit_price: fields.float({ required: true, default: 50 }),
        total: fields.float({
          store: true,
          depends: ['units', 'unit_price'],
          compute: (r) => Number(r.units ?? 0) * Number(r.unit_price ?? 0),
        }),
      },
      onchange: {
        units: (vals) => ({
          values: { total: Number(vals.units ?? 0) * Number(vals.unit_price ?? 0) },
        }),
      },
    });

    await installAddons(db, [
      defineAddon({ name: 'invoicing', version: '1.0.0', models: [Invoice] }),
    ]);

    const defaults = await Invoice.defaultGet(['number', 'units', 'unit_price'], {
      default_number: 'INV-2026-001',
    });
    expect(defaults).toEqual({
      number: 'INV-2026-001',
      units: 2,
      unit_price: 50,
    });

    const onchangeRes = await Invoice.onchange({ ...defaults, units: 4 }, 'units');
    expect(onchangeRes.values?.total).toBe(200);

    const created = (await Invoice.create({
      number: 'INV-2026-001',
      units: 4,
      unit_price: 50,
    })) as InstanceType<typeof Invoice>;
    expect(created.total).toBe(200);
    expect(created.write_date).toBeDefined();

    // Update with matching expectedWriteDate succeeds
    await Invoice.write([created.id], { units: 5 }, { expectedWriteDate: created.write_date });
    const afterUpdate = (await Invoice.browse(created.id)) as InstanceType<typeof Invoice>;
    expect(afterUpdate.total).toBe(250);

    // Concurrent update with stale expectedWriteDate throws ConcurrencyConflictError (409)
    await expect(
      Invoice.write([created.id], { units: 10 }, { expectedWriteDate: '1999-01-01T00:00:00.000Z' })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Archive (soft unlink) & Unarchive
    await Invoice.unlink([created.id], false);
    expect(await Invoice.search([['id', '=', created.id]])).toHaveLength(0);
    expect(await Invoice.search([['id', '=', created.id]], { activeTest: false })).toHaveLength(1);

    await afterUpdate.action_unarchive();
    expect(await Invoice.search([['id', '=', created.id]])).toHaveLength(1);

    // Hard delete
    await Invoice.unlink([created.id], true);
    expect(await Invoice.search([['id', '=', created.id]], { activeTest: false })).toHaveLength(0);
  });

  it('MW-E2E-013: Search & Relational Fields — evaluates Polish notation domains, context tokens, 2-hop dotted relational queries, and M2M links', async () => {
    const Region = defineModel('e2e.region', {
      fields: { code: fields.string({ required: true }) },
    });
    const Country = defineModel('e2e.country', {
      fields: {
        name: fields.string({ required: true }),
        region: fields.belongsTo(Region, { required: true }),
      },
    });
    const Skill = defineModel('e2e.skill', {
      fields: { label: fields.string({ required: true }) },
    });
    const Consultant = defineModel('e2e.consultant', {
      fields: {
        name: fields.string({ required: true }),
        company_id: fields.integer({ required: true }),
        country: fields.belongsTo(Country, { required: true }),
        skills: fields.manyToMany(Skill),
      },
    });

    await installAddons(db, [
      defineAddon({
        name: 'consulting',
        version: '1.0.0',
        models: [Region, Country, Skill, Consultant],
      }),
    ]);

    const apac = (await Region.create({ code: 'APAC' })) as InstanceType<typeof Region>;
    const emea = (await Region.create({ code: 'EMEA' })) as InstanceType<typeof Region>;
    const indonesia = (await Country.create({
      name: 'Indonesia',
      region_id: apac.id,
    })) as InstanceType<typeof Country>;
    const germany = (await Country.create({
      name: 'Germany',
      region_id: emea.id,
    })) as InstanceType<typeof Country>;

    const tsSkill = (await Skill.create({ label: 'TypeScript' })) as InstanceType<typeof Skill>;
    const pgSkill = (await Skill.create({ label: 'PostgreSQL' })) as InstanceType<typeof Skill>;

    const c1 = (await Consultant.create({
      name: 'Budi',
      company_id: 10,
      country_id: indonesia.id,
      skills: [tsSkill.id, pgSkill.id],
    })) as InstanceType<typeof Consultant>;
    await Consultant.create({
      name: 'Hans',
      company_id: 20,
      country_id: germany.id,
      skills: [pgSkill.id],
    });

    // 2-hop dotted relational domain + context token resolution
    const rawDomain = [
      '&',
      ['company_id', '=', '$company_id'],
      ['country.region.code', '=', 'APAC'],
    ];
    const resolvedDomain = resolveDomainContext(rawDomain, { companyId: 10 });
    const matches = (await Consultant.search(resolvedDomain, {
      withGraphFetched: 'skills',
    })) as Array<InstanceType<typeof Consultant> & { skills: Array<{ label: string }> }>;

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(c1.id);
    expect(matches[0]?.skills.map((s) => s.label).sort()).toEqual(['PostgreSQL', 'TypeScript']);

    // Exceeding 2 relational hops fails closed
    await expect(Consultant.search([['country.region.parent.code', '=', 'WORLD']])).rejects.toThrow(
      /exceeds max depth of 2 hops/i
    );
  });

  it('MW-E2E-014: Access Rule Enforcement — enforces tenant isolation domain rules and blocks hidden/private field leaks', async () => {
    const VaultEntry = defineModel('e2e.vault_entry', {
      fields: {
        title: fields.string({ required: true }),
        company_id: fields.integer({ required: true }),
        api_token: fields.string({ hidden: true }),
        audit_note: fields.string({ sensitive: true }),
      },
    });

    await installAddons(db, [
      defineAddon({ name: 'vault', version: '1.0.0', models: [VaultEntry] }),
    ]);

    await VaultEntry.create({
      title: 'Tenant 1 Secret',
      company_id: 1,
      api_token: 'tok_1',
      audit_note: 'private_1',
    });
    await VaultEntry.create({
      title: 'Tenant 2 Secret',
      company_id: 2,
      api_token: 'tok_2',
      audit_note: 'private_2',
    });

    // Apply tenant record rule domain + malicious OR attempt
    const clientDomain = validateDomain(['|', ['company_id', '=', 1], ['company_id', '=', 2]]);
    const recordRuleScope = [['company_id', '=', 1]] as const;
    const rows = await applyDomain(
      VaultEntry.query(),
      [...clientDomain, ...recordRuleScope],
      VaultEntry
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Tenant 1 Secret');
    // Hidden field stripped from JSON serialization
    expect((rows[0]?.toJSON() as Record<string, unknown>).api_token).toBeUndefined();

    // Redaction strips hidden and masks sensitive fields
    const redacted = VaultEntry.redactSensitive({
      title: 'Tenant 1 Secret',
      api_token: 'tok_1',
      audit_note: 'private_1',
    });
    expect(redacted.api_token).toBeUndefined();
    expect(redacted.audit_note).toBe('[REDACTED]');

    // Selecting hidden field in search_read is rejected
    await expect(VaultEntry.search_read([], { fields: ['id', 'api_token'] })).rejects.toThrow(
      /Invalid or private field selection/i
    );
  });

  it('MW-E2E-015: Addon Upgrade & Data Preservation — upgrades addon schema and runs versioned upgrade hooks while preserving 100% of user data and rolling back on failure', async () => {
    const ContractV1 = defineModel('e2e.contract', {
      fields: {
        title: fields.string({ required: true }),
        status: fields.enum(['draft', 'active'] as const, { default: 'draft' }),
      },
    });

    const addonV1 = defineAddon({
      name: 'contracts',
      version: '1.0.0',
      models: [ContractV1],
    });

    await installAddons(db, [addonV1]);
    const existing = (await ContractV1.create({
      title: 'Master MSA',
      status: 'active',
    })) as InstanceType<typeof ContractV1>;

    // V2 adds a column and runs an upgrade hook to backfill existing rows
    const ContractV2 = defineModel('e2e.contract', {
      fields: {
        title: fields.string({ required: true }),
        status: fields.enum(['draft', 'active', 'renewed'] as const, { default: 'draft' }),
        tier_code: fields.string({ default: 'STANDARD' }),
      },
    });

    const addonV2 = defineAddon({
      name: 'contracts',
      version: '1.1.0',
      models: [ContractV2],
      upgrade: {
        '1.0.0': async (trx) => {
          await trx('e2e_contract').where({ status: 'active' }).update({ tier_code: 'ENTERPRISE' });
        },
      },
    });

    await installAddons(db, [addonV2]);

    const upgradedRow = (await ContractV2.browse(existing.id)) as InstanceType<
      typeof ContractV2
    > & { tier_code: string };
    expect(upgradedRow.title).toBe('Master MSA');
    expect(upgradedRow.tier_code).toBe('ENTERPRISE');

    // Downgrade is rejected
    await expect(installAddons(db, [addonV1])).rejects.toThrow(/Addon downgrade rejected/i);

    // Failed upgrade hook rolls back transaction and preserves V2 state
    const addonV3Failing = defineAddon({
      name: 'contracts',
      version: '1.2.0',
      models: [ContractV2],
      upgrade: {
        '1.1.0': async (trx) => {
          await trx('e2e_contract').update({ tier_code: 'CORRUPTED' });
          throw new Error('Upgrade step failed mid-transaction');
        },
      },
    });

    await expect(installAddons(db, [addonV3Failing])).rejects.toThrow(
      /Upgrade step failed mid-transaction/
    );
    const afterFailedUpgrade = (await ContractV2.browse(existing.id)) as InstanceType<
      typeof ContractV2
    > & { tier_code: string };
    expect(afterFailedUpgrade.tier_code).toBe('ENTERPRISE');
    const addonMeta = (await db('_orm_addons').where({ name: 'contracts' }).first()) as {
      version: string;
    };
    expect(addonMeta.version).toBe('1.1.0');
  });

  it('MW-E2E-016: Safe Addon Disable & Uninstall — blocks core/dependent removal (409), cleanly detaches leaf addon runtime metadata, and supports clean reinstall', async () => {
    const CoreModel = defineModel('e2e.core_cfg', {
      fields: { key: fields.string({ required: true }) },
    });
    const LeafModel = defineModel('e2e.leaf_feature', {
      fields: { name: fields.string({ required: true }) },
    });

    const baseAddon = defineAddon({
      name: 'base',
      version: '1.0.0',
      models: [CoreModel],
    });
    const leafAddon = defineAddon({
      name: 'leaf_addon',
      version: '1.0.0',
      depends: ['base'],
      models: [LeafModel],
      views: [defineView(LeafModel, { title: 'Leaf Features', list: { columns: ['name'] } })],
      menus: [{ model: 'e2e.leaf_feature', label: 'Leaf Menu', group: 'Addons', sequence: 50 }],
      data: [seed(LeafModel, 'leaf_addon.default_item', { name: 'Initial Feature' })],
    });

    await installAddons(db, [baseAddon, leafAddon]);
    expect(Registry.has('e2e.leaf_feature')).toBe(true);

    // Core addon cannot be disabled or uninstalled
    await expect(disableAddon(db, 'base')).rejects.toThrow(ConcurrencyConflictError);
    await expect(uninstallAddon(db, 'base')).rejects.toThrow(ConcurrencyConflictError);

    // Addon with active dependent cannot be uninstalled
    const subLeafAddon = defineAddon({
      name: 'sub_leaf',
      version: '1.0.0',
      depends: ['leaf_addon'],
      models: [],
    });
    await installAddons(db, [baseAddon, leafAddon, subLeafAddon]);
    await expect(disableAddon(db, 'leaf_addon')).rejects.toThrow(ConcurrencyConflictError);
    await expect(uninstallAddon(db, 'leaf_addon')).rejects.toThrow(ConcurrencyConflictError);

    // Uninstall sub_leaf first, then disable/enable/uninstall leaf_addon
    await uninstallAddon(db, 'sub_leaf');
    await disableAddon(db, 'leaf_addon');
    await enableAddon(db, 'leaf_addon');
    await uninstallAddon(db, 'leaf_addon', { purgeData: true });

    expect(Registry.has('e2e.leaf_feature')).toBe(false);
    expect(await db.schema.hasTable('e2e_leaf_feature')).toBe(false);
    expect(await db('_orm_addons').where({ name: 'leaf_addon' }).first()).toBeUndefined();

    // Clean reinstall restores model, table, view, and seed without duplicate _orm_data conflicts
    await installAddons(db, [baseAddon, leafAddon]);
    expect(Registry.has('e2e.leaf_feature')).toBe(true);
    const items = await LeafModel.search([]);
    expect(items).toHaveLength(1);
  });
});
