import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ghJson } from './lib/gh-cli.mjs';

const GOVERNANCE_CONFIG = '.github/governance/rulesets.json';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Canonical JSON used for both hashing and drift comparison. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value ?? null);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

export function hashConfig(config) {
  return createHash('sha256').update(canonical(config)).digest('hex');
}

export function parseConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error('Governance config is not valid JSON.');
  }
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!isObject(config) || config.schemaVersion !== 1)
    throw new Error('Governance config schemaVersion must be 1.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(config.repository ?? ''))
    throw new Error('Governance config repository must be owner/repo.');
  if (!Array.isArray(config.requiredCheckNames) || config.requiredCheckNames.length === 0)
    throw new Error('Governance config must declare required check names.');
  if (!Array.isArray(config.breakGlassActors) || config.breakGlassActors.length === 0)
    throw new Error('Governance config must declare break-glass actors.');
  if (!Array.isArray(config.rulesets) || config.rulesets.length === 0)
    throw new Error('Governance config must declare rulesets.');

  const names = new Set();
  for (const ruleset of config.rulesets) {
    if (!isObject(ruleset) || typeof ruleset.name !== 'string' || !ruleset.name)
      throw new Error('Every ruleset needs a name.');
    if (names.has(ruleset.name)) throw new Error(`Duplicate ruleset name: ${ruleset.name}.`);
    names.add(ruleset.name);
    if (!['branch', 'tag'].includes(ruleset.target))
      throw new Error(`Ruleset ${ruleset.name} has an invalid target.`);
    if (!['active', 'disabled'].includes(ruleset.enforcement))
      throw new Error(`Ruleset ${ruleset.name} has invalid enforcement.`);
    if (!Array.isArray(ruleset.rules) || ruleset.rules.length === 0)
      throw new Error(`Ruleset ${ruleset.name} has no rules.`);
    if (!isObject(ruleset.bypass_actors) && !Array.isArray(ruleset.bypass_actors))
      throw new Error(`Ruleset ${ruleset.name} has an invalid bypass_actors value.`);
    if (Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length > 0)
      throw new Error(`Ruleset ${ruleset.name} must not declare routine bypass actors.`);
    if (
      !isObject(ruleset.conditions) ||
      !isObject(ruleset.conditions.ref_name) ||
      !Array.isArray(ruleset.conditions.ref_name.include)
    )
      throw new Error(`Ruleset ${ruleset.name} must declare ref_name.include.`);
  }

  const declaredChecks = new Set(config.requiredCheckNames);
  const configuredChecks = config.rulesets
    .flatMap((ruleset) => ruleset.rules)
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context);
  for (const name of config.requiredCheckNames) {
    if (!configuredChecks.includes(name))
      throw new Error(`Required check ${name} is not enforced by any ruleset.`);
  }
  for (const name of configuredChecks) {
    if (!declaredChecks.has(name)) throw new Error(`Undeclared required check: ${name}.`);
  }
  const main = config.rulesets.find(
    (ruleset) =>
      ruleset.target === 'branch' && ruleset.conditions.ref_name.include.includes('refs/heads/main')
  );
  if (!main || !main.rules.some((rule) => rule.type === 'pull_request'))
    throw new Error('The main ruleset must require a pull request.');
  if (!main.rules.some((rule) => rule.type === 'merge_queue'))
    throw new Error('The main ruleset must require the merge queue.');
  const statusRule = main.rules.find((rule) => rule.type === 'required_status_checks');
  if (statusRule?.parameters?.strict_required_status_checks_policy !== true)
    throw new Error('The main ruleset must require strict status checks.');
  const reviewRule = main.rules.find((rule) => rule.type === 'pull_request');
  if ((reviewRule.parameters?.required_approving_review_count ?? 0) !== 0)
    throw new Error('The autonomous main ruleset must not require human approvals.');
  return config;
}

/** Strip server-assigned fields so desired and live rulesets compare cleanly. */
export function normalizeRuleset(ruleset) {
  const rules = (ruleset.rules ?? [])
    .map((rule) => {
      if (rule.type !== 'required_status_checks' || !isObject(rule.parameters)) return rule;
      return {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: [...(rule.parameters.required_status_checks ?? [])].sort(
            (left, right) => String(left.context).localeCompare(String(right.context))
          ),
        },
      };
    })
    .sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const conditions = isObject(ruleset.conditions)
    ? {
        ...ruleset.conditions,
        ...(isObject(ruleset.conditions.ref_name)
          ? {
              ref_name: {
                ...ruleset.conditions.ref_name,
                include: [...(ruleset.conditions.ref_name.include ?? [])].sort(),
                exclude: [...(ruleset.conditions.ref_name.exclude ?? [])].sort(),
              },
            }
          : {}),
      }
    : {};
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions,
    rules,
    bypass_actors: Array.isArray(ruleset.bypass_actors) ? ruleset.bypass_actors : [],
  };
}

export function compareRulesets(desired, actual) {
  const drift = [];
  const desiredByName = new Map(desired.rulesets.map((ruleset) => [ruleset.name, ruleset]));
  const actualByName = new Map(actual.map((ruleset) => [ruleset.name, ruleset]));
  for (const [name, ruleset] of desiredByName) {
    if (!actualByName.has(name)) {
      drift.push({ name, kind: 'missing' });
      continue;
    }
    if (
      canonical(normalizeRuleset(ruleset)) !== canonical(normalizeRuleset(actualByName.get(name)))
    )
      drift.push({ name, kind: 'drift', id: actualByName.get(name).id });
  }
  for (const name of actualByName.keys()) {
    if (!desiredByName.has(name)) drift.push({ name, kind: 'unmanaged' });
  }
  return drift;
}

export function buildPlan(desired, actual) {
  const drift = compareRulesets(desired, actual);
  const byName = new Map(actual.map((ruleset) => [ruleset.name, ruleset]));
  return drift.map((entry) => {
    if (entry.kind === 'missing')
      return {
        op: 'create',
        name: entry.name,
        ruleset: normalizeRuleset(desired.rulesets.find((r) => r.name === entry.name)),
      };
    if (entry.kind === 'unmanaged')
      return { op: 'delete', name: entry.name, id: byName.get(entry.name).id };
    return {
      op: 'update',
      name: entry.name,
      id: entry.id,
      ruleset: normalizeRuleset(desired.rulesets.find((r) => r.name === entry.name)),
    };
  });
}

/**
 * Governance is immutable from inside the fleet: apply requires an explicit
 * human break-glass actor and must never run inside an Actions/agent run.
 */
export function assertBreakGlass(env, config) {
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true' || env.AGENT_RUN_ID)
    throw new Error('Governance apply is forbidden inside CI or an agent run.');
  if (env.GOVERNANCE_BREAK_GLASS !== '1')
    throw new Error('Governance apply requires GOVERNANCE_BREAK_GLASS=1.');
  const actor = env.GOVERNANCE_ACTOR;
  if (!actor || !config.breakGlassActors.includes(actor))
    throw new Error('Governance apply requires an allowlisted GOVERNANCE_ACTOR.');
  return actor;
}

/** Default live adapter. Tests inject their own adapter. */
export function createGithubAdapter(repository) {
  const base = `repos/${repository}/rulesets`;
  return {
    async read() {
      const all = [];
      for (let page = 1; ; page += 1) {
        const response = await ghJson([`${base}?per_page=100&page=${page}`]);
        const rulesets = Array.isArray(response) ? response : (response?.rulesets ?? []);
        all.push(...(Array.isArray(rulesets) ? rulesets : [rulesets]));
        if (!Array.isArray(response) || response.length < 100) break;
      }
      return all;
    },
    async create(ruleset) {
      return withBody(base, 'POST', ruleset);
    },
    async update(id, ruleset) {
      return withBody(`${base}/${id}`, 'PUT', ruleset);
    },
    async remove(id) {
      await ghJson([`${base}/${id}`, '-X', 'DELETE']);
    },
  };
}

async function withBody(path, method, ruleset) {
  const dir = await mkdtemp(join(tmpdir(), 'mw-xv-ruleset-'));
  const file = join(dir, 'ruleset.json');
  try {
    await writeFile(file, `${JSON.stringify(ruleset, null, 2)}\n`, 'utf8');
    return await ghJson([path, '-X', method, '--input', file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseFlags(args) {
  const flags = { mode: args[0] ?? 'inspect', paths: [] };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' || arg === '--prune') flags[arg.slice(2)] = true;
    else if (arg === '--snapshot') flags.snapshot = args[++index];
    else if (arg === '--snapshot-before') flags.snapshotBefore = args[++index];
    else if (arg === '--snapshot-after') flags.snapshotAfter = args[++index];
    else if (arg === '--expect-config-sha256') flags.expectConfigSha256 = args[++index];
    else flags.paths.push(arg);
  }
  return flags;
}

export async function main(args = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? ((text) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text) => process.stderr.write(text));
  const flags = parseFlags(args);
  const configText = (await io.readConfig?.()) ?? (await readFile(GOVERNANCE_CONFIG, 'utf8'));
  const config = parseConfig(configText);
  const adapter = io.adapter ?? createGithubAdapter(config.repository);

  if (
    flags.mode === 'apply' &&
    flags.expectConfigSha256 &&
    flags.expectConfigSha256 !== hashConfig(config)
  )
    throw new Error('Governance config hash does not match the break-glass expectation.');
  if (flags.mode === 'apply') assertBreakGlass(env, config);

  const readActual = async () => {
    if (flags.snapshot) {
      const snapshot = JSON.parse(
        await (io.readSnapshot?.(flags.snapshot) ?? readFile(flags.snapshot, 'utf8'))
      );
      if (!Array.isArray(snapshot)) throw new Error('Rule snapshot must be an array.');
      return snapshot;
    }
    return adapter.read();
  };

  let actual = await readActual();
  const plan = buildPlan(config, actual);
  if (flags.mode !== 'apply') {
    const payload =
      flags.mode === 'plan'
        ? { configSha256: hashConfig(config), plan }
        : { configSha256: hashConfig(config), drift: compareRulesets(config, actual) };
    stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return { exitCode: plan.length === 0 ? 0 : 1, plan };
  }

  // Snapshot the live plane before mutating so every change is auditable.
  const before = flags.snapshotBefore ? await adapter.read() : actual;
  if (flags.snapshotBefore)
    await (io.writeSnapshot?.(flags.snapshotBefore, before) ??
      writeFile(flags.snapshotBefore, `${JSON.stringify(before, null, 2)}\n`, 'utf8'));

  for (const operation of plan) {
    if (operation.op === 'delete' && !flags.prune)
      throw new Error(`Unmanaged ruleset ${operation.name} present; pass --prune to remove it.`);
    if (operation.op === 'create') await adapter.create(operation.ruleset);
    else if (operation.op === 'update') await adapter.update(operation.id, operation.ruleset);
    else await adapter.remove(operation.id);
  }

  const after = await adapter.read();
  if (flags.snapshotAfter)
    await (io.writeSnapshot?.(flags.snapshotAfter, after) ??
      writeFile(flags.snapshotAfter, `${JSON.stringify(after, null, 2)}\n`, 'utf8'));
  const remaining = compareRulesets(config, after);
  if (remaining.length > 0) {
    stderr(
      `Governance drift remains after apply: ${remaining.map((entry) => entry.name).join(', ')}\n`
    );
    return { exitCode: 1, plan, remaining };
  }
  stdout(
    `${JSON.stringify({ applied: plan.length, configSha256: hashConfig(config) }, null, 2)}\n`
  );
  return { exitCode: 0, plan, remaining };
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    const { exitCode } = await main();
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
