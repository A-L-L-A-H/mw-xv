import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCAL_AI_PROVIDERS,
  discoverLocalAiProviders,
  isLoopbackEndpointUrl,
} from '../src/local-ai-discovery.js';
import {
  computeFileSha256,
  createLocalDbBackup,
  listLocalDbBackups,
  resolveConfinedBackupPath,
  restoreLocalDbBackup,
} from '../src/backup.js';

const serversToClose: Server[] = [];
const tempDirsToRemove: string[] = [];

async function startLoopbackServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  serversToClose.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind ephemeral loopback port');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirsToRemove.push(dir);
  return dir;
}

afterEach(async () => {
  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  while (tempDirsToRemove.length > 0) {
    const dir = tempDirsToRemove.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('local-ai-discovery', () => {
  describe('isLoopbackEndpointUrl', () => {
    it('accepts loopback HTTP/HTTPS URLs', () => {
      expect(isLoopbackEndpointUrl('http://127.0.0.1:11434/api/tags')).toBe(true);
      expect(isLoopbackEndpointUrl('http://localhost:1234/v1/models')).toBe(true);
      expect(isLoopbackEndpointUrl('http://[::1]:8000/v1/models')).toBe(true);
      expect(isLoopbackEndpointUrl('https://127.0.0.2:8443/v1/models')).toBe(true);
    });

    it('rejects non-loopback, wildcard, and non-HTTP URLs', () => {
      expect(isLoopbackEndpointUrl('http://0.0.0.0:8000/v1/models')).toBe(false);
      expect(isLoopbackEndpointUrl('http://192.168.1.25:11434/api/tags')).toBe(false);
      expect(isLoopbackEndpointUrl('https://api.openai.com/v1/models')).toBe(false);
      expect(isLoopbackEndpointUrl('file:///etc/passwd')).toBe(false);
      expect(isLoopbackEndpointUrl('not-a-url')).toBe(false);
      expect(isLoopbackEndpointUrl('')).toBe(false);
    });

    it('defines loopback-only default providers', () => {
      expect(DEFAULT_LOCAL_AI_PROVIDERS.length).toBe(3);
      for (const provider of DEFAULT_LOCAL_AI_PROVIDERS) {
        expect(isLoopbackEndpointUrl(provider.endpoint)).toBe(true);
      }
    });
  });

  describe('discoverLocalAiProviders', () => {
    it('discovers models from loopback mock Ollama and OpenAI-compatible servers', async () => {
      const { baseUrl } = await startLoopbackServer((req, res) => {
        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              models: [
                {
                  name: 'llama3.2:latest',
                  size: 2048,
                  details: { family: 'llama' },
                },
                {
                  name: 'qwen2.5-coder:7b',
                  size: 4096,
                  details: { family: 'qwen2' },
                },
              ],
            })
          );
          return;
        }
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              data: [{ id: 'mistral-7b-instruct' }],
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });

      const result = await discoverLocalAiProviders({
        providers: [
          { id: 'ollama', name: 'Ollama', kind: 'ollama', endpoint: `${baseUrl}/api/tags` },
          { id: 'lmstudio', name: 'LM Studio', kind: 'lmstudio', endpoint: `${baseUrl}/v1/models` },
          { id: 'vllm', name: 'vLLM', kind: 'vllm', endpoint: `${baseUrl}/missing` },
        ],
        timeoutMs: 800,
      });

      expect(result.onlineCount).toBe(2);
      expect(result.models.map((m) => m.id)).toEqual([
        'llama3.2:latest',
        'qwen2.5-coder:7b',
        'mistral-7b-instruct',
      ]);
      expect(result.recommendedWorkspaceModel).toBe('llama3.2:latest');
      expect(result.recommendedDevModel).toBe('qwen2.5-coder:7b');
      expect(result.providers.find((p) => p.id === 'vllm')?.online).toBe(false);
    });

    it('never throws when endpoints are offline or time out', async () => {
      const { baseUrl } = await startLoopbackServer((_req, _res) => {
        // Intentionally never respond to trigger AbortSignal timeout.
      });

      const result = await discoverLocalAiProviders({
        providers: [
          { id: 'slow', name: 'Slow Local', kind: 'vllm', endpoint: `${baseUrl}/v1/models` },
          { id: 'offline', name: 'Offline Local', kind: 'ollama', endpoint: 'http://127.0.0.1:1/api/tags' },
        ],
        timeoutMs: 120,
      });

      expect(result.onlineCount).toBe(0);
      expect(result.models).toEqual([]);
      expect(result.recommendedWorkspaceModel).toBeNull();
      expect(result.recommendedDevModel).toBeNull();
      expect(result.providers.every((p) => !p.online && typeof p.error === 'string')).toBe(true);
    });

    it('refuses to fetch non-loopback provider endpoints', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      const result = await discoverLocalAiProviders({
        providers: [
          {
            id: 'remote',
            name: 'Remote',
            kind: 'vllm',
            endpoint: 'https://example.com/v1/models',
          },
        ],
        fetchImpl: fetchSpy,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.onlineCount).toBe(0);
      expect(result.providers[0]?.error).toMatch(/non-loopback/iu);
    });
  });
});

describe('local sqlite backup', () => {
  it('creates, lists, and restores a backup with SHA-256 verification', async () => {
    const workDir = await createTempDir('mw-backup-roundtrip-');
    const sqlitePath = path.join(workDir, 'desktop.sqlite');
    const backupsDir = path.join(workDir, 'backups');

    const originalBytes = Buffer.from('SQLite format 3\0original-state-v1', 'utf8');
    await fs.writeFile(sqlitePath, originalBytes);

    const created = await createLocalDbBackup(sqlitePath, backupsDir);
    expect(created.verified).toBe(true);
    expect(created.sizeBytes).toBe(originalBytes.length);
    expect(created.sha256).toBe(await computeFileSha256(sqlitePath));

    const listed = await listLocalDbBackups(backupsDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fileName).toBe(created.fileName);
    expect(listed[0]?.verified).toBe(true);

    // Mutate the live database, then restore from backup.
    await fs.writeFile(sqlitePath, Buffer.from('SQLite format 3\0mutated-state-v2', 'utf8'));
    const restored = await restoreLocalDbBackup(created.filePath, sqlitePath, backupsDir);
    expect(restored.sha256).toBe(created.sha256);

    const restoredBytes = await fs.readFile(sqlitePath);
    expect(restoredBytes.equals(originalBytes)).toBe(true);
  });

  it('returns empty list when backupsDir does not exist', async () => {
    const workDir = await createTempDir('mw-backup-empty-');
    const missingDir = path.join(workDir, 'does-not-exist');
    await expect(listLocalDbBackups(missingDir)).resolves.toEqual([]);
  });

  it('detects tampered backups during list and rejects restore on SHA-256 mismatch', async () => {
    const workDir = await createTempDir('mw-backup-tamper-');
    const sqlitePath = path.join(workDir, 'desktop.sqlite');
    const backupsDir = path.join(workDir, 'backups');
    await fs.writeFile(sqlitePath, 'SQLite format 3\0clean-db', 'utf8');

    const created = await createLocalDbBackup(sqlitePath, backupsDir);
    await fs.writeFile(created.filePath, 'SQLite format 3\0tampered-db', 'utf8');

    const listed = await listLocalDbBackups(backupsDir);
    expect(listed[0]?.verified).toBe(false);

    await expect(restoreLocalDbBackup(created.filePath, sqlitePath, backupsDir)).rejects.toThrow(
      /checksum mismatch/iu
    );
  });

  it('rejects path traversal and escapes outside backupsDir', async () => {
    const workDir = await createTempDir('mw-backup-traversal-');
    const backupsDir = path.join(workDir, 'backups');
    const outsideFile = path.join(workDir, 'outside.sqlite');
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(outsideFile, 'outside', 'utf8');

    expect(() => resolveConfinedBackupPath(backupsDir, '../outside.sqlite')).toThrow(
      /escapes backupsDir/iu
    );
    expect(() => resolveConfinedBackupPath(backupsDir, outsideFile)).toThrow(
      /escapes backupsDir/iu
    );

    await expect(
      restoreLocalDbBackup('../outside.sqlite', path.join(workDir, 'target.sqlite'), backupsDir)
    ).rejects.toThrow(/traversal/iu);

    await expect(
      restoreLocalDbBackup(outsideFile, path.join(workDir, 'target.sqlite'), backupsDir)
    ).rejects.toThrow(/escapes backupsDir/iu);
  });
});
