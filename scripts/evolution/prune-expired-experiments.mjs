import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function extractRegistryExperiments(registrySource) {
  const entries = [];
  const pattern =
    /flagKey:\s*['"]([^'"]+)['"][\s\S]*?expiresAt:\s*['"]([^'"]+)['"][\s\S]*?proposalId:\s*['"]([^'"]+)['"]/gu;
  for (const match of registrySource.matchAll(pattern)) {
    entries.push({
      source: 'addons/registry.ts',
      flagKey: match[1],
      expiresAt: match[2],
      proposalId: match[3],
    });
  }
  return entries;
}

/**
 * Inspects registered addon experiment metadata and optional experiments manifest for
 * expired TTL entries that should be promoted cleanly or pruned.
 */
export async function scanExpiredExperiments(options = {}) {
  const repositoryRoot = options.repositoryRoot
    ? path.resolve(options.repositoryRoot)
    : defaultRoot;
  const nowMs = (options.now ?? new Date()).getTime();
  const candidates = [];

  const registryPath = path.join(repositoryRoot, 'apps/api/src/addons/registry.ts');
  if (existsSync(registryPath)) {
    candidates.push(...extractRegistryExperiments(await readFile(registryPath, 'utf8')));
  }

  const experimentsPath =
    options.experimentsFile ?? path.join(repositoryRoot, 'evolution/experiments.json');
  if (existsSync(experimentsPath)) {
    const parsed = JSON.parse(await readFile(experimentsPath, 'utf8'));
    const items = Array.isArray(parsed) ? parsed : (parsed.experiments ?? []);
    for (const entry of items) {
      if (entry && typeof entry.expiresAt === 'string') {
        candidates.push({ source: path.basename(experimentsPath), ...entry });
      }
    }
  }

  const active = [];
  const expired = [];
  for (const entry of candidates) {
    const expiresMs = Date.parse(entry.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      expired.push(entry);
    } else {
      active.push(entry);
    }
  }

  return {
    format: 'moonwitness-experiment-prune/v1',
    checkedAt: new Date(nowMs).toISOString(),
    activeCount: active.length,
    expiredCount: expired.length,
    shouldPrune: expired.length > 0,
    active,
    expired,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const strictCheck = process.argv.includes('--check');
  const outcome = await scanExpiredExperiments();
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  if (strictCheck && outcome.shouldPrune) process.exitCode = 1;
}
