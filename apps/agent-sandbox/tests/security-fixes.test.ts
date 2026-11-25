import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisabledSandboxExecutor } from '../src/executor.js';
import { SandboxError } from '../src/errors.js';
import {
  buildSafeResponseHeaders,
  createSandboxServer,
  normalizeHttpStatusCode,
} from '../src/server.js';
import { copyBoundedTree } from '../src/workspace-fs.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CodeQL #400: server header & status sanitization', () => {
  it('accepts allowlisted RFC header names and normalizes to lowercase', () => {
    const headers = buildSafeResponseHeaders([
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Content-Length', 42],
      ['Cache-Control', 'no-store'],
      ['X-Content-Type-Options', 'nosniff'],
    ]);
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(headers.get('content-length')).toBe('42');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects prototype-pollution keys, invalid RFC tokens, non-allowlisted headers, and CRLF values', () => {
    for (const forbiddenName of [
      '__proto__',
      'constructor',
      'Constructor',
      'prototype',
      'PROTOTYPE',
    ]) {
      expect(() => buildSafeResponseHeaders([[forbiddenName, '1']])).toThrowError(SandboxError);
    }
    for (const invalidName of ['', 'bad header', 'x:name', 'content-type\r\n']) {
      expect(() => buildSafeResponseHeaders([[invalidName, '1']])).toThrowError(SandboxError);
    }
    for (const disallowedName of ['access-control-allow-origin', 'set-cookie', 'x-custom']) {
      expect(() => buildSafeResponseHeaders([[disallowedName, '1']])).toThrowError(SandboxError);
    }
    expect(() =>
      buildSafeResponseHeaders([['content-type', 'application/json\r\nx-injected: 1']])
    ).toThrowError(SandboxError);
    expect(() => buildSafeResponseHeaders([['content-type', 'application/json\0']])).toThrowError(
      SandboxError
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('normalizes status codes to the fixed allowlist and defaults untrusted values to 500', () => {
    for (const code of [200, 400, 401, 403, 404, 408, 409, 413, 500, 503]) {
      expect(normalizeHttpStatusCode(code)).toBe(code);
    }
    for (const invalidCode of [
      199,
      302,
      599,
      999,
      -1,
      200.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(normalizeHttpStatusCode(invalidCode)).toBe(500);
    }
  });

  it('serves JSON security headers, rejects forbidden prototype keys, and maps executor errors safely', async () => {
    const dataDir = await makeTempDir('mw-sandbox-srv-');
    const snapshotsDir = path.join(dataDir, 'snapshots', 'snap-1');
    await mkdir(path.join(snapshotsDir, 'src'), { recursive: true });
    await writeFile(path.join(snapshotsDir, 'src', 'index.ts'), 'export const ok = true;\n');
    await writeFile(
      path.join(snapshotsDir, 'snapshot.json'),
      JSON.stringify({
        snapshotId: 'snap-1',
        baseCommit: 'a'.repeat(40),
        files: 1,
        sizeBytes: 24,
        treeSha256: 'b'.repeat(64),
        createdAt: new Date().toISOString(),
      })
    );

    const token = 't'.repeat(48);
    const server = createSandboxServer({
      token,
      dataDir,
      executor: new DisabledSandboxExecutor(),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const health = await fetch(`${baseUrl}/healthz`);
      expect(health.status).toBe(200);
      expect(health.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(health.headers.get('cache-control')).toBe('no-store');
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');

      const polluted = await fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{"id":"1","method":"workspace.get","params":{"runId":"run-1"},"__proto__":{"admin":true}}',
      });
      expect(polluted.status).toBe(400);

      const unavailable = await fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: '2',
          method: 'workspace.create',
          params: {
            runId: 'run-1',
            snapshotId: 'snap-1',
            imageRef: `registry.example.com/mw/sandbox@sha256:${'c'.repeat(64)}`,
            baseCommit: 'a'.repeat(40),
            allowedPaths: ['src'],
            cpuCores: 1,
            memoryMb: 512,
            pidsLimit: 64,
            timeoutMs: 10_000,
            maxOutputBytes: 65_536,
          },
        }),
      });
      expect(unavailable.status).toBe(503);
      const unavailableBody = (await unavailable.json()) as {
        ok: boolean;
        error: { code: string };
      };
      expect(unavailableBody.ok).toBe(false);
      expect(unavailableBody.error.code).toBe('EXECUTOR_UNAVAILABLE');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

describe('CodeQL #394: race-free workspace-fs tree copy', () => {
  it('copies nested files atomically and computes deterministic treeSha256', async () => {
    const root = await makeTempDir('mw-sandbox-fs-');
    const src = path.join(root, 'src');
    const dst = path.join(root, 'dst');
    await mkdir(path.join(src, 'nested'), { recursive: true });
    await mkdir(path.join(src, '.mw-sandbox'), { recursive: true });
    await writeFile(path.join(src, 'a.txt'), 'hello\n', 'utf8');
    await writeFile(path.join(src, 'nested', 'b.txt'), 'world\n', 'utf8');
    await writeFile(path.join(src, 'snapshot.json'), '{"ignored":true}\n', 'utf8');
    await writeFile(path.join(src, '.mw-sandbox', 'scratch.txt'), 'tmp\n', 'utf8');

    const result = await copyBoundedTree(src, dst, {
      rejectSensitive: true,
      excludeScratch: true,
      excludeRootMetadata: true,
    });

    expect(result.files).toBe(2);
    expect(result.sizeBytes).toBe(12);
    expect(result.treeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readFile(path.join(dst, 'a.txt'), 'utf8')).toBe('hello\n');
    expect(await readFile(path.join(dst, 'nested', 'b.txt'), 'utf8')).toBe('world\n');
    await expect(readFile(path.join(dst, 'snapshot.json'), 'utf8')).rejects.toThrow();
  });

  it('rejects EEXIST cleanly when destination file or directory already exists', async () => {
    const root = await makeTempDir('mw-sandbox-eexist-');
    const src = path.join(root, 'src');
    const dst = path.join(root, 'dst');
    await mkdir(src, { recursive: true });
    await mkdir(dst, { recursive: true });
    await writeFile(path.join(src, 'file.txt'), 'fresh\n', 'utf8');
    await writeFile(path.join(dst, 'file.txt'), 'existing\n', 'utf8');

    await expect(copyBoundedTree(src, dst)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const srcDir = path.join(root, 'src-dir');
    const dstDir = path.join(root, 'dst-dir');
    await mkdir(path.join(srcDir, 'sub'), { recursive: true });
    await mkdir(path.join(dstDir, 'sub'), { recursive: true });
    await expect(copyBoundedTree(srcDir, dstDir)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects symbolic links in source tree without following them', async () => {
    const root = await makeTempDir('mw-sandbox-symlink-');
    const src = path.join(root, 'src');
    const dst = path.join(root, 'dst');
    const outside = path.join(root, 'outside.txt');
    await mkdir(src, { recursive: true });
    await writeFile(outside, 'secret\n', 'utf8');

    let symlinkCreated = false;
    try {
      await symlink(outside, path.join(src, 'link.txt'));
      symlinkCreated = true;
    } catch {
      // Unprivileged Windows environments without Developer Mode cannot create file symlinks.
    }

    if (symlinkCreated) {
      await expect(copyBoundedTree(src, dst)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });
});
