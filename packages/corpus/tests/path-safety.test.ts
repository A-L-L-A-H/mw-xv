import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeRelativePath, trySafeRelativePath } from '../src/path-safety.js';

describe('path-safety', () => {
  it('normalizes valid relative POSIX paths', () => {
    expect(safeRelativePath('corpus/manifests/index.json', 'indexPath')).toBe(
      path.join('corpus', 'manifests', 'index.json')
    );
    expect(trySafeRelativePath('snapshots/v1')).toBe(path.join('snapshots', 'v1'));
  });

  it('rejects non-strings, empty strings, drive-relative paths, backslashes, and null bytes', () => {
    for (const candidate of [null, undefined, 42, '', '/etc/passwd', 'C:foo', 'a\\b', 'a\0b']) {
      expect(trySafeRelativePath(candidate)).toBeNull();
      expect(() => safeRelativePath(candidate, 'targetPath')).toThrow(
        'targetPath must be a safe relative POSIX path'
      );
    }
  });

  it('rejects empty, dot, and parent segments', () => {
    for (const candidate of ['a//b', 'a/', './a', 'a/./b', '../a', 'a/../b']) {
      expect(trySafeRelativePath(candidate)).toBeNull();
      expect(() => safeRelativePath(candidate, 'targetPath')).toThrow(
        'targetPath must not contain empty, dot, or parent segments'
      );
    }
  });
});
