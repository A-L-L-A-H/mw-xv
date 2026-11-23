import { describe, expect, it } from 'vitest';
import {
  buildEphemeralSandboxManifest,
  verifySandboxExecutionOutput,
} from '../src/sandbox-runner.js';

describe('M17.03 sandbox-runner', () => {
  it('builds a zero-network, read-only, secret-free Docker sandbox manifest with --cap-drop=ALL', () => {
    const manifest = buildEphemeralSandboxManifest({
      runId: 'run-001',
      engine: 'docker',
      imageRef: 'node:22-alpine',
      command: ['node', '-v'],
      cpuCores: 16,
      memoryMb: 16384,
      timeoutMs: 999_999,
      env: {
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'sk-should-be-dropped-from-env-keys',
        DB_SECRET: 'top-secret',
      },
    });

    expect(manifest.networkDisabled).toBe(true);
    expect(manifest.readOnlyRootFs).toBe(true);
    expect(manifest.secretsInjected).toBe(false);
    expect(manifest.droppedCapabilities).toEqual(['ALL']);
    expect(manifest.cliArgs).toContain('--network=none');
    expect(manifest.cliArgs).toContain('--read-only');
    expect(manifest.cliArgs).toContain('--cap-drop=ALL');
    expect(manifest.cpuCores).toBeLessThanOrEqual(4);
    expect(manifest.memoryMb).toBeLessThanOrEqual(4096);
    expect(manifest.timeoutMs).toBeLessThanOrEqual(120_000);
    expect(manifest.sanitizedEnvKeys).toEqual(['NODE_ENV']);
    expect(manifest.automatedPromotionAllowed).toBe(false);
    expect(manifest.automatedSelfMerge).toBe(false);
  });

  it('verifies clean execution output and fails on secret leaks or timeouts', () => {
    const manifest = buildEphemeralSandboxManifest({
      runId: 'run-002',
      engine: 'microvm',
      imageRef: 'mw-sandbox:latest',
      command: ['pnpm', 'test'],
      timeoutMs: 5000,
    });

    const cleanResult = verifySandboxExecutionOutput(
      manifest,
      {
        runId: 'run-002',
        exitCode: 0,
        durationMs: 1200,
        stdout: 'all tests passed',
        stderr: '',
        unifiedDiff: '+const ok = true;\n-const ok = false;',
      },
      7000,
      7500
    );
    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.ablationGateCompatible).toBe(true);
    expect(cleanResult.ablationDeltaBps).toBe(500);
    expect(cleanResult.automatedSelfMerge).toBe(false);

    const leakedResult = verifySandboxExecutionOutput(manifest, {
      runId: 'run-002',
      exitCode: 0,
      durationMs: 1000,
      stdout: 'Authorization: Bearer supersecretvalue12345',
      stderr: '',
      unifiedDiff: '',
    });
    expect(leakedResult.passed).toBe(false);
    expect(leakedResult.secretLeakDetected).toBe(true);
    expect(leakedResult.redactedStdout).not.toContain('supersecretvalue12345');
  });
});
