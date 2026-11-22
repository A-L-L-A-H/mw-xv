import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findBoardRuntimeImportViolations,
  findDesktopNonOverlapViolations,
} from './check-desktop-non-overlap.mjs';

test('desktop ORM and addon definitions fail with remediation', () => {
  const violations = findDesktopNonOverlapViolations(
    `
      const model = defineModel('desktop.local');
      function defineAddon() {}
    `,
    'apps/desktop/src/local-model.ts'
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /must not call defineModel or defineAddon/u);
});

test('desktop ordinary code and comments pass', () => {
  assert.deepEqual(
    findDesktopNonOverlapViolations(
      'const toolName = "defineModelLookup"; // not an ORM call\nexport const ready = true;',
      'apps/desktop/src/harness.ts'
    ),
    []
  );
});

test('board native runtime imports fail with forbidden import guidance', () => {
  const violations = findBoardRuntimeImportViolations(
    `
      import Database from 'better-sqlite3';
      import { spawn } from 'node:child_process';
      import { readFileSync } from 'node:fs';
      import { readFile } from 'node:fs/promises';
      import { homedir } from 'node:os';
      import process from 'node:process';
      import { invoke } from 'tauri/api';
      import type { WorktreeLease } from '@moonwitness/orm/types';
      const lazy = require('node-pty');
    `,
    'apps/board/src/forbidden.tsx'
  );
  assert.equal(violations.length, 9);
  assert.ok(violations.every((violation) => /forbidden runtime import/u.test(violation)));
  assert.ok(violations.every((violation) => violation.startsWith('apps/board/src/forbidden.tsx:')));
});

test('board renderer imports pass', () => {
  assert.deepEqual(
    findBoardRuntimeImportViolations(
      `
        import { Button } from '@moonwitness/ui/components/button';
        import { client } from '@moonwitness/client';
        import type { DesktopCapabilityBridge } from '@moonwitness/types';
      `,
      'apps/board/src/desktop-bridge.tsx'
    ),
    []
  );
});
