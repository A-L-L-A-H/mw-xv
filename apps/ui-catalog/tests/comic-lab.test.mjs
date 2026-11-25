import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogSrcDir = path.resolve(__dirname, '../src');

test('ComicLab uses public @moonwitness/ui comic exports and exposes ComicLab', () => {
  const comicLabPath = path.join(catalogSrcDir, 'ComicLab.tsx');
  assert.equal(fs.existsSync(comicLabPath), true, 'ComicLab.tsx should exist');

  const source = fs.readFileSync(comicLabPath, 'utf8');
  assert.match(source, /@moonwitness\/ui\/components\/comic-theater/);
  assert.match(source, /@moonwitness\/ui\/components\/epistemic-branch-panel/);
  assert.match(source, /export function ComicLab\(/);
});
