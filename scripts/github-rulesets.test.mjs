import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertBreakGlass,
  buildPlan,
  compareRulesets,
  hashConfig,
  main,
  normalizeRuleset,
  parseConfig,
  validateConfig,
} from './github-rulesets.mjs';

const configText = await readFile(new URL('../.github/governance/rulesets.json', import.meta.url), 'utf8');
const config = parseConfig(configText);
const clone = (value) => JSON.parse(JSON.stringify(value));

function adapterFor(rulesets) {
  const live = clone(rulesets);
  const calls = [];
  return {
    calls,
    async read() {
      return clone(live);
    },
    async create(ruleset) {
      calls.push({ op: 'create', name: ruleset.name });
      live.push({ ...clone(ruleset), id: 100 + calls.length });
    },
    async update(id, ruleset) {
      calls.push({ op: 'update', id, name: ruleset.name });
      Object.assign(live.find((rulesetItem) => rulesetItem.id === id), clone(ruleset));
    },
    async remove(id) {
      calls.push({ op: 'delete', id });
      const index = live.findIndex((rulesetItem) => rulesetItem.id === id);
      if (index >= 0) live.splice(index, 1);
    },
  };
}

function ioFor(adapter, overrides = {}) {
  const output = [];
  const errors = [];
  return {
    adapter,
    env: overrides.env ?? {},
    readConfig: async () => configText,
    stdout: (text) => output.push(text),
    stderr: (text) => errors.push(text),
    output,
    errors,
  };
}

test('the checked-in governance config validates and declares both required checks', () => {
  assert.doesNotThrow(() => validateConfig(config));
  assert.deepEqual(config.requiredCheckNames, ['ci-gate', 'policy-gate']);
  assert.equal(config.rulesets.length, 3);
  assert.equal(hashConfig(config).length, 64);
  assert.throws(() => validateConfig({ ...config, schemaVersion: 2 }), /schemaVersion/u);
  assert.throws(
    () => validateConfig({ ...config, rulesets: config.rulesets.map((r) => ({ ...r, bypass_actors: [{ actor_id: 1 }] })) }),
    /bypass actors/u
  );
  assert.throws(
    () => validateConfig({ ...config, requiredCheckNames: ['ci-gate', 'unknown'] }),
    /not enforced by any ruleset/u
  );
});

test('normalization ignores ordering and server fields but not bypass actors or rule content', () => {
  const desired = config.rulesets[1];
  const live = clone(desired);
  live.id = 24436095;
  live.node_id = 'R_123';
  live.rules = [...live.rules].reverse();
  live.conditions.ref_name.include = [...live.conditions.ref_name.include].reverse();
  assert.equal(
    JSON.stringify(normalizeRuleset(live)) === JSON.stringify(normalizeRuleset(desired)),
    true
  );
  live.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole' }];
  assert.notDeepEqual(normalizeRuleset(live), normalizeRuleset(desired));
  live.bypass_actors = [];
  live.rules.find((rule) => rule.type === 'pull_request').parameters.required_approving_review_count = 1;
  assert.notDeepEqual(normalizeRuleset(live), normalizeRuleset(desired));
});

test('compare detects missing, drifted, and unmanaged rulesets', () => {
  const live = config.rulesets.map(clone);
  assert.deepEqual(compareRulesets(config, live), []);
  const missing = live.slice(1);
  assert.deepEqual(compareRulesets(config, missing), [{ name: config.rulesets[0].name, kind: 'missing' }]);
  live[1].enforcement = 'disabled';
  const drift = compareRulesets(config, live);
  assert.equal(drift[0].kind, 'drift');
  assert.equal(drift[0].id, config.rulesets[1].id);
  const extra = [...config.rulesets.map(clone), { name: 'rogue', target: 'branch', rules: [{ type: 'creation' }], conditions: { ref_name: { include: [] } }, bypass_actors: [] }];
  assert.deepEqual(compareRulesets(config, extra), [{ name: 'rogue', kind: 'unmanaged' }]);
});

test('plan is deterministic and never weakens an existing ruleset', () => {
  const plan = buildPlan(config, []);
  assert.deepEqual(plan.map((entry) => entry.op), ['create', 'create', 'create']);
  assert.equal(plan[0].ruleset.bypass_actors.length, 0);
  const live = config.rulesets.map(clone);
  live[2].enforcement = 'disabled';
  const update = buildPlan(config, live);
  assert.deepEqual(update.map((entry) => entry.op), ['update']);
  assert.equal(update[0].id, config.rulesets[2].id);
});

test('apply requires an allowlisted human outside CI', () => {
  assert.throws(() => assertBreakGlass({}, config), /GOVERNANCE_BREAK_GLASS/u);
  assert.throws(
    () => assertBreakGlass({ GOVERNANCE_BREAK_GLASS: '1', GOVERNANCE_ACTOR: 'agent' }, config),
    /allowlisted/u
  );
  assert.throws(
    () => assertBreakGlass({ CI: 'true', GOVERNANCE_BREAK_GLASS: '1', GOVERNANCE_ACTOR: 'bjo163' }, config),
    /forbidden inside CI/u
  );
  assert.equal(
    assertBreakGlass({ GOVERNANCE_BREAK_GLASS: '1', GOVERNANCE_ACTOR: 'bjo163' }, config),
    'bjo163'
  );
});

test('inspect and plan are read-only and fail closed on drift', async () => {
  const adapter = adapterFor([]);
  const io = ioFor(adapter);
  const inspect = await main(['inspect', '--json'], io);
  assert.equal(inspect.exitCode, 1);
  assert.match(io.output[0], /missing/u);
  assert.deepEqual(adapter.calls, []);

  const planIo = ioFor(adapterFor(config.rulesets.map(clone)));
  const clean = await main(['plan', '--json'], planIo);
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(JSON.parse(planIo.output[0]).plan, []);
  assert.deepEqual(planIo.adapter.calls, []);
});

test('inspect can run offline against a committed API snapshot', async () => {
  const snapshot = JSON.stringify(config.rulesets.map(clone), null, 2);
  const io = ioFor(adapterFor([]), {});
  io.readSnapshot = async () => snapshot;
  const result = await main(['inspect', '--snapshot', 'snapshot.json'], io);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(io.adapter.calls, []);
});

test('apply snapshots before and after, and refuses unmanaged rulesets without pruning', async () => {
  const actorEnv = { GOVERNANCE_BREAK_GLASS: '1', GOVERNANCE_ACTOR: 'bjo163' };
  const writes = {};
  const io = ioFor(adapterFor([]), { env: actorEnv });
  io.writeSnapshot = async (path, value) => {
    writes[path] = clone(value);
  };
  const result = await main(['apply', '--snapshot-before', 'before.json', '--snapshot-after', 'after.json'], io);
  assert.equal(result.exitCode, 0);
  assert.equal(io.adapter.calls.length, 3);
  assert.ok(Array.isArray(writes['before.json']));
  assert.deepEqual(writes['after.json'].map((r) => r.name).sort(), config.rulesets.map((r) => r.name).sort());

  const rogue = [...config.rulesets.map(clone), { name: 'rogue', target: 'branch', rules: [{ type: 'creation' }], conditions: { ref_name: { include: [] } }, bypass_actors: [] }];
  const rogueIo = ioFor(adapterFor(rogue), { env: actorEnv });
  await assert.rejects(() => main(['apply'], rogueIo), /--prune/u);
  assert.deepEqual(rogueIo.adapter.calls, []);
});

test('apply fails when drift remains after reconciliation', async () => {
  const adapter = adapterFor([]);
  adapter.create = async () => {};
  const io = ioFor(adapter, { env: { GOVERNANCE_BREAK_GLASS: '1', GOVERNANCE_ACTOR: 'bjo163' } });
  const result = await main(['apply'], io);
  assert.equal(result.exitCode, 1);
  assert.match(io.errors[0], /drift remains/u);
});
