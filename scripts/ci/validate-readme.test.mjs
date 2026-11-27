import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkExternalReadmeLinks,
  extractReadmeLinks,
  findBrokenReadmeLinks,
  findCopyPasteViolations,
  validateReadme,
} from './validate-readme.mjs';

async function scaffold(markdown, docs = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mw-xv-readme-'));
  const readme = path.join(root, 'README.md');
  await writeFile(readme, markdown, 'utf8');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  for (const [name, content] of Object.entries(docs)) {
    await writeFile(path.join(root, 'docs', name), content, 'utf8');
  }
  return { root, readme };
}

test('findCopyPasteViolations blocks executable instructions outside fenced blocks', () => {
  assert.deepEqual(
    findCopyPasteViolations('Set a value:\nexport API_KEY=secret\nbun install\n'),
    [
      'copy-paste shell command; use a fenced code block (e.g. bun install)',
      'copy-paste environment assignment; use a fenced code block (e.g. export API_KEY=value)',
    ]
  );
  assert.deepEqual(
    findCopyPasteViolations('```bash\nexport API_KEY=secret\nbun install\n```\n'),
    []
  );
});

test('findBrokenReadmeLinks rejects external redirects and broken relative links', async () => {
  const { root, readme } = await scaffold(
    [
      '[remote](https://example.com/moved)',
      '[missing](docs/missing.md)',
      '[anchor](docs/target.md#does-not-exist)',
      '[escape](../outside.md)',
    ].join('\n'),
    { 'target.md': '# Target\n' }
  );
  const failures = await findBrokenReadmeLinks(await readFile(readme, 'utf8'), readme, root);
  assert.equal(failures.length, 4);
  assert.match(failures.join('\n'), /external link rejected/);
  assert.match(failures.join('\n'), /missing target/);
  assert.match(failures.join('\n'), /missing anchor/);
  assert.match(failures.join('\n'), /escapes repository/);
});

test('extractReadmeLinks ignores fenced code blocks and parses titles', () => {
  const links = extractReadmeLinks(
    '```md\n[ignored](missing.md)\n```\n\n[guide](docs/guide.md "Guide")\n'
  );
  assert.deepEqual(links, [{ label: 'guide', target: 'docs/guide.md', line: 5 }]);
});

test('checkExternalReadmeLinks fails on redirect responses', async () => {
  const failures = await checkExternalReadmeLinks(
    '[repo](https://example.com/moved)',
    async () => ({ status: 301 })
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unreachable/);
});

test('validateReadme passes when links and copy-paste blocks are valid', async () => {
  const { root } = await scaffold(
    '# Demo\n\n```bash\nexport API_KEY=value\n```\n\n[guide](docs/guide.md)\n',
    { 'guide.md': '# Guide\n' }
  );
  const result = await validateReadme({
    root,
    fetchImpl: async () => {
      throw new Error('unexpected external request');
    },
  });
  assert.deepEqual(result, { links: 1, external: 0 });
});
