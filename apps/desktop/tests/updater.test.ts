import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopHarnessBridge } from '../src/bridge.js';
import type { DesktopBridgeHostSurface } from '../src/types.js';
import {
  DEFAULT_CURRENT_DESKTOP_VERSION,
  DEFAULT_DESKTOP_UPDATE_ENDPOINT,
  checkForDesktopUpdate,
  compareSemver,
  isValidSha256Hex,
  validateUpdateEndpoint,
} from '../src/updater.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const VALID_SHA256 = 'a'.repeat(64);

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('desktop updater', () => {
  describe('validateUpdateEndpoint', () => {
    it('accepts the default GitHub HTTPS release endpoint', () => {
      expect(validateUpdateEndpoint(DEFAULT_DESKTOP_UPDATE_ENDPOINT)).toEqual({ valid: true });
    });

    it('rejects non-HTTPS endpoints', () => {
      const result = validateUpdateEndpoint(
        'http://github.com/A-L-L-A-H/mw-xv/releases/latest/download/latest.json'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/HTTPS/u);
    });

    it('rejects non-github.com hosts', () => {
      const result = validateUpdateEndpoint('https://evil.example.com/latest.json');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not allowed/u);
    });

    it('rejects malformed URLs', () => {
      const result = validateUpdateEndpoint('not-a-url');
      expect(result.valid).toBe(false);
    });
  });

  describe('compareSemver', () => {
    it('orders prerelease and stable versions accurately', () => {
      expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.1')).toBe(1);
      expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(1);
      expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
      expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1);
      expect(compareSemver('0.9.9', '1.0.0-rc.1')).toBe(-1);
    });
  });

  describe('isValidSha256Hex', () => {
    it('validates 64-character hex digests', () => {
      expect(isValidSha256Hex(VALID_SHA256)).toBe(true);
      expect(isValidSha256Hex('deadbeef')).toBe(false);
      expect(isValidSha256Hex('z'.repeat(64))).toBe(false);
      expect(isValidSha256Hex(undefined)).toBe(false);
    });
  });

  describe('checkForDesktopUpdate', () => {
    it('detects an available newer release with valid signature and sha256 metadata', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse({
          version: '1.0.0',
          notes: 'General availability release',
          pub_date: '2026-11-23T00:00:00Z',
          platforms: {
            'windows-x86_64': {
              url: 'https://github.com/A-L-L-A-H/mw-xv/releases/download/v1.0.0/mw-xv.msi.zip',
              signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu',
              sha256: VALID_SHA256,
            },
          },
        })
      );

      const result = await checkForDesktopUpdate({
        currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        platformKey: 'windows-x86_64',
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('available');
      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe('1.0.0');
      expect(result.signaturePresent).toBe(true);
      expect(result.sha256Valid).toBe(true);
      expect(result.releaseUrl).toBe('https://github.com/A-L-L-A-H/mw-xv/releases/tag/v1.0.0');
    });

    it('reports up-to-date when latest version matches current version', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse({
          version: DEFAULT_CURRENT_DESKTOP_VERSION,
          signature: 'minisign-signature',
          sha256: VALID_SHA256,
        })
      );

      const result = await checkForDesktopUpdate({
        currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('up-to-date');
      expect(result.updateAvailable).toBe(false);
    });

    it('returns offline without throwing when network is unreachable', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

      const result = await checkForDesktopUpdate({
        currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('offline');
      expect(result.updateAvailable).toBe(false);
      expect(result.error).toContain('fetch failed');
    });

    it('returns offline without throwing on non-2xx HTTP responses', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

      const result = await checkForDesktopUpdate({
        currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('offline');
      expect(result.updateAvailable).toBe(false);
      expect(result.error).toContain('503');
    });

    it('rejects manifests with malformed SHA-256 or missing signature/checksum metadata', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse({
          version: '1.0.1',
          signature: 'minisign-signature',
          sha256: 'not-a-valid-sha256',
        })
      );

      const result = await checkForDesktopUpdate({
        currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('invalid-manifest');
      expect(result.updateAvailable).toBe(false);
      expect(result.sha256Valid).toBe(false);
    });

    it('rejects non-GitHub endpoints without calling fetch', async () => {
      const fetchMock = vi.fn<typeof fetch>();

      const result = await checkForDesktopUpdate({
        endpoint: 'https://untrusted.example.com/latest.json',
        fetchImpl: fetchMock,
      });

      expect(result.status).toBe('invalid-endpoint');
      expect(result.updateAvailable).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('desktop bridge updater parity', () => {
    it('exposes bounded checkForUpdates() and installUpdate() on window.__MW_DESKTOP__', async () => {
      const repoRoot = mkdtempSync(path.join(tmpdir(), 'mw-desktop-updater-repo-'));
      const homeDir = mkdtempSync(path.join(tmpdir(), 'mw-desktop-updater-home-'));
      tempDirs.push(repoRoot, homeDir);

      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      const surface: DesktopBridgeHostSurface = {};
      const bridge = createDesktopHarnessBridge(
        {
          repoRoot,
          desktopHomeDir: homeDir,
          sqlitePath: ':memory:',
          boardOrigin: 'http://127.0.0.1:5173',
          apiBaseUrl: 'http://127.0.0.1:3000',
        },
        { surface }
      );

      try {
        expect(surface.__MW_DESKTOP__).toBe(bridge);
        await expect(bridge.checkForUpdates?.()).resolves.toEqual({
          status: 'up-to-date',
          currentVersion: DEFAULT_CURRENT_DESKTOP_VERSION,
        });
        await expect(bridge.installUpdate?.()).resolves.toEqual({
          status: 'up-to-date',
        });
      } finally {
        bridge.dispose();
      }
    });
  });
});
