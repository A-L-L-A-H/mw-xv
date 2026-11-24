import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeVendorTreeDigest } from './check-vendor-tree-integrity.mjs';

test('vendored tree digest is deterministic and content-addressed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mw-vendor-integrity-'));
  try {
    await mkdir(path.join(root, 'server/lib'), { recursive: true });
    await writeFile(path.join(root, 'server/lib/password.ts'), 'export const a = 1;\n');
    await writeFile(path.join(root, 'UPSTREAM.json'), '{"treeSha256":"stale"}\n');
    const first = await computeVendorTreeDigest(root);
    assert.match(first, /^[a-f0-9]{64}$/u);
    assert.equal(await computeVendorTreeDigest(root), first);

    await writeFile(path.join(root, 'server/lib/password.ts'), 'export const a = 2;\n');
    assert.notEqual(await computeVendorTreeDigest(root), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
