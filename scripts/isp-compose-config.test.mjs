import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const composeFile = 'apps/isp/docker-compose.yml';
const dockerfile = 'apps/isp/Dockerfile';
const cargoLock = 'apps/isp/Cargo.lock';
const cargoManifest = 'apps/isp/Cargo.toml';

function serviceBlock(source, name) {
  const start = source.search(new RegExp(`^  ${name}:\\s*$`, 'mu'));
  assert.notEqual(start, -1, `Compose must define the ${name} service`);
  const remainder = source.slice(start + 1);
  const nextService = remainder.search(/^ {2}[A-Za-z0-9_-]+:\s*$/mu);
  return source.slice(start, nextService === -1 ? undefined : start + 1 + nextService);
}

test('ISP Cargo.lock is tracked and ignored paths stay out of version control', () => {
  assert.ok(existsSync(`${repoRoot}/${cargoLock}`), 'Cargo.lock must be committed for reproducible builds');
  const gitignore = readFileSync(`${repoRoot}/apps/isp/.gitignore`, 'utf8');
  assert.doesNotMatch(gitignore, /^Cargo\.lock\s*$/mu, '.gitignore must not exclude Cargo.lock');
  assert.match(gitignore, /^\/target\/\s*$/mu, 'target artifacts must stay ignored');
});

test('ISP Dockerfile copies the tracked lockfile and sources from the repo-root context', () => {
  const source = readFileSync(`${repoRoot}/${dockerfile}`, 'utf8');
  assert.match(
    source,
    /COPY\s+apps\/isp\/Cargo\.toml\s+apps\/isp\/Cargo\.lock\s+\.\//u,
    'builder stage must COPY apps/isp/Cargo.toml and apps/isp/Cargo.lock together'
  );
  assert.match(source, /COPY\s+apps\/isp\/src\s+\.\/src/u);
  assert.match(source, /COPY\s+apps\/isp\/migrations\s+\.\/migrations/u);
  assert.match(source, /cargo build --release/u);
  assert.match(source, /target\/release\/moonwitness-isp/u);
  for (const file of [cargoManifest, cargoLock, 'apps/isp/src/main.rs', 'apps/isp/migrations']) {
    assert.ok(existsSync(`${repoRoot}/${file}`), `Docker build input ${file} must exist in the repo`);
  }
});

test('Compose service builds the ISP image and declares only existing paths and services', () => {
  const source = readFileSync(`${repoRoot}/${composeFile}`, 'utf8');
  assert.ok(existsSync(`${repoRoot}/${dockerfile}`), 'compose dockerfile path must exist');
  const isp = serviceBlock(source, 'isp');
  assert.match(isp, /dockerfile:\s*apps\/isp\/Dockerfile/u);
  assert.match(isp, /context:\s*\.\.[/\\]\.\./u);
  assert.match(isp, /1812:1812\/udp/u, 'RADIUS auth port must be published');
  assert.match(isp, /1813:1813\/udp/u, 'RADIUS accounting port must be published');
  assert.match(isp, /3000:3000/u, 'HTTP admin API port must be published');
});

test('Compose uses the SQLite edge runtime with persistent volume and no stale PostgreSQL setup', () => {
  const source = readFileSync(`${repoRoot}/${composeFile}`, 'utf8');
  assert.doesNotMatch(source, /postgres/gi, 'stale PostgreSQL service/config must be removed');
  assert.doesNotMatch(source, /MW_RADIUS_/u, 'obsolete MW_RADIUS_* env vars must be removed');
  assert.doesNotMatch(source, /apps\/radius/u, 'removed apps/radius references must be gone');
  const isp = serviceBlock(source, 'isp');
  assert.match(isp, /MW_ISP_DB_PATH=/u);
  assert.match(isp, /\/data/u, 'database file must live on the persistent volume');
  assert.match(source, /^volumes:\s*\r?\n {2}isp_data:\s*$/mu, 'a named volume must back the SQLite data');
});

test('Compose environment matches the binary configuration surface', () => {
  const main = readFileSync(`${repoRoot}/apps/isp/src/main.rs`, 'utf8');
  const source = readFileSync(`${repoRoot}/${composeFile}`, 'utf8');
  // The binary loads config via the MW_ISP_ env prefix (separator "_"): an env
  // var MW_ISP_<NAME> maps to the snake_case Config field <name>. Every compose
  // MW_ISP_* variable must therefore target a field the Config struct declares.
  assert.match(main, /with_prefix\("MW_ISP"\)/u, 'binary must keep the MW_ISP_ env prefix');
  const configFields = [...main.matchAll(/^struct Config \{([\s\S]*?)^\}/gmu)]
    .flatMap((m) => [...m[1].matchAll(/^\s*(\w+):/gmu)].map((f) => f[1]))
    .filter((f) => f !== 'serde');
  const composeVars = [...source.matchAll(/MW_ISP_([A-Z_]+)/gu)].map((m) =>
    m[1].toLowerCase()
  );
  assert.ok(composeVars.length > 0, 'compose must set at least one MW_ISP_* variable');
  for (const field of composeVars) {
    assert.ok(
      configFields.includes(field),
      `MW_ISP_${field.toUpperCase()} in compose must map to a Config struct field in main.rs`
    );
  }
  assert.match(source, /RUST_LOG=/u, 'tracing env filter must be configurable via RUST_LOG');
});
