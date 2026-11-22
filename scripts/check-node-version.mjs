import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SUPPORTED_LTS_MAJORS = new Set([24, 26]);

export function parseMajorVersion(versionString) {
  const match = /^v?(\d+)/u.exec(String(versionString ?? '').trim());
  return match ? Number.parseInt(match[1], 10) : null;
}

export function isSupportedLtsMajor(major) {
  return typeof major === 'number' && major % 2 === 0 && SUPPORTED_LTS_MAJORS.has(major);
}

export function checkNodeParity({ currentVersion, expectedRange, nvmrcVersion }) {
  const currentMajor = parseMajorVersion(currentVersion);
  const expectedMajor = parseMajorVersion(expectedRange);
  const nvmrcMajor = parseMajorVersion(nvmrcVersion);
  const warnings = [];

  if (expectedMajor !== null && nvmrcMajor !== null && expectedMajor !== nvmrcMajor) {
    warnings.push(
      `Repo Node parity drift: package.json engines.node (${expectedRange}) != .nvmrc (${nvmrcVersion}).`
    );
  }
  if (
    currentMajor !== null &&
    expectedMajor !== null &&
    currentMajor !== expectedMajor &&
    !isSupportedLtsMajor(currentMajor)
  ) {
    warnings.push(
      `Local Node ${currentVersion} is not an active supported LTS release (pin: "${expectedRange}", supported LTS: 24.x, 26.x). Native modules (better-sqlite3) require an active even-numbered Node LTS line.`
    );
  }
  return {
    ok: warnings.length === 0,
    currentMajor,
    expectedMajor,
    nvmrcMajor,
    warnings,
  };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const nvmrc = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim();
  const result = checkNodeParity({
    currentVersion: process.version,
    expectedRange: pkg.engines?.node ?? '24.x',
    nvmrcVersion: nvmrc,
  });

  if (!result.ok) {
    for (const warning of result.warnings) {
      process.stderr.write(`[node-parity] ${warning}\n`);
    }
    if (strict) process.exitCode = 1;
    return;
  }
  process.stdout.write(`Node ${process.version} matches engines.node (${pkg.engines?.node}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
