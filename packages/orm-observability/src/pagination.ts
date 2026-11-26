export interface CursorPosition {
  time: number;
  id: string;
  direction: 'asc' | 'desc';
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined, direction: 'asc' | 'desc'): CursorPosition | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.direction !== direction || !Number.isFinite(candidate.time) ||
        typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 512) return undefined;
    return { time: Number(candidate.time), id: candidate.id, direction };
  } catch {
    return undefined;
  }
}

export function pageItems<T>(items: T[], limit: number, position: (item: T) => CursorPosition): Page<T> {
  const selected = items.slice(0, limit);
  const last = selected.at(-1);
  Object.defineProperty(selected, 'items', { value: selected, enumerable: false });
  if (items.length > limit && last) Object.defineProperty(selected, 'nextCursor', { value: encodeCursor(position(last)), enumerable: false });
  return selected as Page<T>;
}

import type { Page } from './types.js';
