import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const packageJsonPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('orm-a2a package scripts', () => {
  it('defines a test script', () => {
    expect(packageJson.scripts?.test).toBe('vitest run');
  });
});
