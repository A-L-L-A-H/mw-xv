import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVERSARIAL_SUITE_MODULE,
  AGI_BENCHMARK_MODULE,
  WORLD_SIM_MODULE,
  checkM18ModuleSource,
} from './check-m18-invariants.mjs';

test('rejects node:fs, child_process, eval, and explicit any in M18 modules', () => {
  const badSource = `
    import { readFileSync } from 'node:fs';
    import { execSync } from 'node:child_process';
    export function run(seed: number, x: any) {
      return eval('1 + 1') + seed + x;
    }
  `;
  const violations = checkM18ModuleSource(WORLD_SIM_MODULE, badSource);
  const codes = new Set(violations.map((v) => v.code));
  assert.ok(codes.has('FORBIDDEN_NODE_FS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_CHILD_PROCESS_IMPORT'));
  assert.ok(codes.has('FORBIDDEN_EVAL_CALL'));
  assert.ok(codes.has('FORBIDDEN_EXPLICIT_ANY'));
});

test('rejects bare Math.random() and missing seed in world-sim', () => {
  const nonDeterministic = `
    export function simulate() {
      return Math.random();
    }
  `;
  const violations = checkM18ModuleSource(WORLD_SIM_MODULE, nonDeterministic);
  const codes = new Set(violations.map((v) => v.code));
  assert.ok(codes.has('FORBIDDEN_MATH_RANDOM'));
  assert.ok(codes.has('MISSING_DETERMINISTIC_SEED'));
});

test('enforces constitutional hard-fail gate in adversarial-suite and agi-benchmark', () => {
  const missingGate = `
    export function run(seed: number) {
      return { seed, passed: true };
    }
  `;
  const v1 = checkM18ModuleSource(ADVERSARIAL_SUITE_MODULE, missingGate);
  assert.ok(v1.some((v) => v.code === 'MISSING_CONSTITUTIONAL_HARD_FAIL'));

  const v2 = checkM18ModuleSource(AGI_BENCHMARK_MODULE, missingGate);
  assert.ok(v2.some((v) => v.code === 'MISSING_CONSTITUTIONAL_HARD_FAIL'));
});

test('accepts compliant deterministic M18 module with constitutional hard-fail', () => {
  const compliantSource = `
    export function runBenchmark(seed: number) {
      const constitutionalPass = true;
      const scoreOk = seed >= 0;
      return {
        seed,
        constitutionalPass,
        passed: constitutionalPass && scoreOk,
      };
    }
  `;
  const violations = checkM18ModuleSource(AGI_BENCHMARK_MODULE, compliantSource);
  assert.equal(violations.length, 0);
});
