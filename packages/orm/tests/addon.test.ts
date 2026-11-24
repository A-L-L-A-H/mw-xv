import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAddonDefaultDataPolicy,
  defineAddon,
  installAddons,
  requireAuth,
  seed,
  type AddonHttpReply,
} from '../src/addon.js';
import { defineModel, fields, type BaseModel } from '../src/model-definition.js';
import { Registry } from '../src/registry.js';
import { manifest as documentedManifest } from '../examples/sales/manifest.js';

const Parent = defineModel('test.parent', {
  table: 'test_parents',
  fields: { name: fields.string({ required: true, unique: true }) },
});
const Child = defineModel('test.child', {
  table: 'test_children',
  fields: { name: fields.string({ required: true }), parent: fields.belongsTo(Parent) },
});
const AccessGrant = defineModel('test.access_grant', {
  table: 'test_access_grants',
  unique: [['parent', 'model_name']],
  fields: {
    parent: fields.belongsTo(Parent, { required: true }),
    model_name: fields.string({ required: true }),
  },
});
function relatedChildModel(): typeof BaseModel {
  return RelatedChild;
}
const RelatedParent = defineModel('test.related_parent', {
  table: 'test_related_parents',
  fields: {
    name: fields.string({ required: true }),
    children: fields.hasMany(relatedChildModel, { foreignKey: 'parent_id' }),
  },
});
const RelatedChild = defineModel('test.related_child', {
  table: 'test_related_children',
  fields: {
    name: fields.string({ required: true }),
    parent: fields.belongsTo(RelatedParent),
  },
});
const addon = (version: string, models = [Parent], data = []) =>
  defineAddon({ name: 'test', version, models, data });

describe('programmatic addon installer', () => {
  let db: Knex;
  afterEach(async () => {
    if (db) await db.destroy();
  });
  const database = () =>
    (db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }));

  it('rejects fields that collide with inherited ORM instance members', () => {
    expect(() => defineModel('test.colliding', { fields: { update: fields.boolean() } })).toThrow(
      'Invalid or duplicate field: test.colliding.update'
    );
  });

  it('installs dependency-ordered models and idempotent referenced seed data', async () => {
    const connection = database();
    await installAddons(connection, [
      defineAddon({
        name: 'child',
        version: '1.0.0',
        depends: ['parent'],
        models: [Child],
        data: [seed(Child, 'child.one', { name: 'C', parent: { $ref: 'parent.one' } })],
      }),
      defineAddon({
        name: 'parent',
        version: '1.0.0',
        models: [Parent],
        data: [seed(Parent, 'parent.one', { name: 'P' })],
      }),
    ]);
    await installAddons(connection, [
      defineAddon({
        name: 'parent',
        version: '1.0.0',
        models: [Parent],
        data: [seed(Parent, 'parent.one', { name: 'Changed' })],
      }),
      defineAddon({
        name: 'child',
        version: '1.0.0',
        depends: ['parent'],
        models: [Child],
        data: [seed(Child, 'child.one', { name: 'C', parent: { $ref: 'parent.one' } })],
      }),
    ]);
    expect(await connection('test_parents').count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });
    expect(await connection('test_parents').first('name')).toMatchObject({ name: 'P' });
    expect(await connection('test_children').first('parent_id')).toMatchObject({ parent_id: 1 });
    expect(Registry.get('test.parent')).toBe(Parent);
  });

  it('adopts existing rows that match a composite unique seed identity', async () => {
    const connection = database();
    await installAddons(connection, [
      defineAddon({ name: 'composite', version: '1.0.0', models: [Parent, AccessGrant] }),
    ]);
    const parent = await Parent.query(connection).insertAndFetch({ name: 'Existing group' });
    const grant = await AccessGrant.query(connection).insertAndFetch({
      parent_id: parent.id,
      model_name: 'whatsapp.account',
    });
    await connection('_orm_data').insert({
      id: 'legacy.grant',
      model: AccessGrant.modelName,
      record_id: grant.id,
    });

    const seededAddon = defineAddon({
      name: 'composite',
      version: '1.0.0',
      models: [Parent, AccessGrant],
      data: [
        seed(Parent, 'composite.parent', { name: 'Existing group' }),
        seed(AccessGrant, 'composite.grant', {
          parent: { $ref: 'composite.parent' },
          model_name: 'whatsapp.account',
        }),
      ],
    });
    await installAddons(connection, [seededAddon]);
    await installAddons(connection, [seededAddon]);

    expect(await connection('test_access_grants').count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });
    expect(
      await connection('_orm_data').where({ model: AccessGrant.modelName }).select('id')
    ).toEqual([{ id: 'legacy.grant' }]);
  });

  it('orders has-many models by their owning belongs-to foreign key without a cycle', async () => {
    const connection = database();
    await installAddons(connection, [
      defineAddon({
        name: 'relations',
        version: '1.0.0',
        models: [RelatedChild, RelatedParent],
      }),
    ]);

    const parent = await RelatedParent.query().insertAndFetch({ name: 'Parent' });
    await RelatedChild.query().insert({ name: 'Child', parent_id: parent.id });

    await expect(
      RelatedParent.query().findById(parent.id).withGraphFetched('children')
    ).resolves.toMatchObject({ children: [{ name: 'Child', parent_id: parent.id }] });
  });

  it('installs the documented addon example and its stable seed into a test database', async () => {
    const connection = database();
    await installAddons(connection, [
      defineAddon({ name: 'base', version: '1.0.0', models: [] }),
      documentedManifest,
    ]);
    await installAddons(connection, [
      defineAddon({ name: 'base', version: '1.0.0', models: [] }),
      documentedManifest,
    ]);
    expect(await connection('sales_order').count({ count: '*' }).first()).toMatchObject({
      count: 1,
    });
    expect(await connection('sales_order').first('name', 'state')).toMatchObject({
      name: 'Example order',
      state: 'draft',
    });
  });

  it('rejects downgrade and rolls back new schema changes', async () => {
    const connection = database();
    await installAddons(connection, [addon('2.0.0')]);
    const Later = defineModel('test.later', { fields: { name: fields.string() } });
    await expect(installAddons(connection, [addon('1.0.0', [Parent, Later])])).rejects.toThrow(
      'Addon downgrade rejected'
    );
    expect(await connection.schema.hasTable('test_laters')).toBe(false);
  });

  it('runs an explicit prior-version programmatic upgrade once and records the installed version', async () => {
    const connection = database();
    await installAddons(connection, [addon('1.0.0')]);
    await Parent.query(connection).insert({ name: 'pre-upgrade' });
    let upgradeCalls = 0;
    const upgraded = defineAddon({
      name: 'test',
      version: '1.1.0',
      models: [Parent],
      upgrade: {
        '1.0.0': async (transaction) => {
          upgradeCalls += 1;
          await transaction('test_parents').where({ name: 'pre-upgrade' }).update({
            name: 'backfilled',
          });
        },
      },
    });

    await installAddons(connection, [upgraded]);
    await installAddons(connection, [upgraded]);

    expect(upgradeCalls).toBe(1);
    expect(await connection('test_parents').first('name')).toMatchObject({ name: 'backfilled' });
    expect(await connection('_orm_addons').where({ name: 'test' }).first('version')).toMatchObject({
      version: '1.1.0',
    });
  });

  it('rejects unsafe required field additions to populated tables', async () => {
    const connection = database();
    await installAddons(connection, [addon('1.0.0')]);
    await Parent.query(connection).insert({ name: 'existing' });
    const Extended = defineModel('test.parent', {
      table: 'test_parents',
      fields: {
        name: fields.string({ required: true, unique: true }),
        code: fields.string({ required: true }),
      },
    });
    await expect(installAddons(connection, [addon('1.1.0', [Extended])])).rejects.toThrow(
      'backfill explicitly first'
    );
    expect(await connection.schema.hasColumn('test_parents', 'code')).toBe(false);
  });

  it('rejects invalid manifests, dependencies, relations, seeds and constraints', async () => {
    expect(() => defineAddon({ name: 'bad', version: 'v1', models: [Parent] })).toThrow(
      'semantic version'
    );
    expect(() =>
      defineAddon({
        name: 'bad',
        version: '1.0.0',
        models: [Parent],
        menus: [{ model: 'missing', group: 'x' }],
      })
    ).toThrow('not in addon');
    await expect(
      installAddons(database(), [
        defineAddon({ name: 'one', version: '1.0.0', depends: ['missing'], models: [Parent] }),
      ])
    ).rejects.toThrow('Missing dependency');
  });

  it('enforces mandatory default data policy for model-owning addons', () => {
    const emptyAddon = defineAddon({ name: 'orm-empty', version: '1.0.0', models: [Parent] });
    expect(() => assertAddonDefaultDataPolicy([emptyAddon])).toThrow(
      /Addon 'orm-empty' declares 1 model\(s\).*manifest\.data is empty/u
    );

    const foreignOnlyAddon = defineAddon({
      name: 'orm-foreign-only',
      version: '1.0.0',
      models: [Child],
      data: [seed(Parent, 'orm-foreign-only.parent', { name: 'External only' })],
    });
    expect(() => assertAddonDefaultDataPolicy([foreignOnlyAddon])).toThrow(
      /0 records targeting its own models/u
    );

    const compliantAddon = defineAddon({
      name: 'orm-compliant',
      version: '1.0.0',
      models: [Parent],
      data: [seed(Parent, 'orm-compliant.parent', { name: 'Demo Parent' })],
    });
    const providerOnlyAddon = defineAddon({
      name: 'orm-storage',
      version: '1.0.0',
      models: [],
    });
    const authExemptAddon = defineAddon({
      name: 'auth',
      version: '1.0.0',
      models: [Child],
    });

    expect(() =>
      assertAddonDefaultDataPolicy([compliantAddon, providerOnlyAddon, authExemptAddon])
    ).not.toThrow();
  });
});

describe('requireAuth addon HTTP guard', () => {
  const createMockReply = () => {
    let statusCode = 200;
    let payload: unknown = undefined;
    const reply: AddonHttpReply = {
      code(code: number) {
        statusCode = code;
        return reply;
      },
      header() {
        return reply;
      },
      send(data?: unknown) {
        payload = data;
        return payload;
      },
    };
    return {
      reply,
      getStatus: () => statusCode,
      getPayload: () => payload,
    };
  };

  it('rejects unauthenticated requests with 401', () => {
    const mock = createMockReply();
    const result = requireAuth({}, mock.reply);
    expect(result).toBeNull();
    expect(mock.getStatus()).toBe(401);
    expect(mock.getPayload()).toEqual({ success: false, error: 'Authentication required' });
  });

  it('rejects requests with missing or invalid companyId with 403', () => {
    for (const invalidCompanyId of [undefined, null, '1', 0, -1, 1.5, NaN]) {
      const mock = createMockReply();
      const result = requireAuth(
        { auth: { userId: 1, companyId: invalidCompanyId as unknown as number } },
        mock.reply
      );
      expect(result).toBeNull();
      expect(mock.getStatus()).toBe(403);
      expect(mock.getPayload()).toEqual({ success: false, error: 'Active company is required' });
    }
  });

  it('returns authenticated context with defaults when valid', () => {
    const mock = createMockReply();
    const result = requireAuth({ auth: { userId: 42, companyId: 7 } }, mock.reply);
    expect(result).toEqual({
      userId: 42,
      role: 'user',
      companyId: 7,
    });
  });

  it('preserves explicitly assigned role', () => {
    const mock = createMockReply();
    const result = requireAuth(
      { auth: { userId: 10, companyId: 3, role: 'superadmin' } },
      mock.reply
    );
    expect(result).toEqual({
      userId: 10,
      role: 'superadmin',
      companyId: 3,
    });
  });
});
