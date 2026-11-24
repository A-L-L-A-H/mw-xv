import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAssetQa } from '../scripts/asset-qa.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('checked-in @moonwitness/assets passes duplicate, budget, ownership, and orphan QA gates', async () => {
  const report = await runAssetQa(packageRoot);
  assert.equal(report.ok, true, `Expected zero QA errors, got: ${JSON.stringify(report.errors)}`);
  assert.ok(report.summary.runtimeAssetsChecked > 100);
  assert.ok(report.summary.sourceMastersTracked >= 4);
  assert.equal(report.summary.duplicateGroups, 0);
});

test('asset QA flags duplicates, oversized runtime assets, wrong folders, and orphans while exempting source masters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mw-asset-qa-'));
  try {
    await mkdir(join(dir, 'icons'), { recursive: true });
    await mkdir(join(dir, 'source', 'artwork'), { recursive: true });
    const tinySvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="a"><title>a</title></svg>';
    await writeFile(join(dir, 'icons/dup-a.svg'), tinySvg);
    await writeFile(join(dir, 'icons/dup-b.svg'), tinySvg);
    await writeFile(join(dir, 'icons/oversized.svg'), 'x'.repeat(20 * 1024));
    await writeFile(join(dir, 'icons/orphan.svg'), tinySvg);
    await writeFile(join(dir, 'source/artwork/big-master.png'), Buffer.alloc(600 * 1024, 1));

    const manifest = {
      schemaVersion: 1,
      assets: [
        { path: 'icons/dup-a.svg', kind: 'icon', format: 'svg' },
        { path: 'icons/dup-b.svg', kind: 'icon', format: 'svg' },
        { path: 'icons/oversized.svg', kind: 'icon', format: 'svg' },
        { path: 'source/artwork/big-master.png', kind: 'source', format: 'png' },
      ],
    };
    const report = await runAssetQa(dir, {
      manifest,
      trackedFiles: [
        'icons/dup-a.svg',
        'icons/dup-b.svg',
        'icons/oversized.svg',
        'icons/orphan.svg',
        'source/artwork/big-master.png',
      ],
    });
    assert.equal(report.ok, false);
    const codes = new Set(report.errors.map((error) => error.code));
    assert.ok(codes.has('duplicate_runtime_asset'));
    assert.ok(codes.has('oversized_runtime_asset'));
    assert.ok(codes.has('orphan_file'));
    assert.equal(report.sourceMasters.length, 1);
    assert.equal(report.sourceMasters[0].path, 'source/artwork/big-master.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
