'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { DesktopExperienceMode } from '@moonwitness/ui/components/mode-picker';
import { client } from '@/lib/client';

export type { DesktopExperienceMode };

const STORAGE_KEY = 'mw-desktop-mode';
const MODE_CHANGE_EVENT = 'mw-desktop-mode-change';

interface DesktopWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

function isValidMode(value: string | null): value is DesktopExperienceMode {
  return value === 'workspace' || value === 'developer';
}

function readStoredMode(): DesktopExperienceMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function syncSidecarMode(mode: DesktopExperienceMode): void {
  if (typeof window === 'undefined') return;
  const apiUrl = (window as DesktopWindow).__MW_DESKTOP_API_URL__;
  if (!apiUrl || typeof apiUrl !== 'string' || apiUrl.trim().length === 0) return;
  void client
    .request('/api/desktop/mode', {
      method: 'POST',
      body: { mode },
    })
    .catch(() => {
      // Non-blocking best-effort sync with local desktop sidecar.
    });
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      callback();
    }
  };
  const onCustom = () => callback();
  window.addEventListener('storage', onStorage);
  window.addEventListener(MODE_CHANGE_EVENT, onCustom);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(MODE_CHANGE_EVENT, onCustom);
  };
}

function getSnapshot(): DesktopExperienceMode | null {
  return readStoredMode();
}

function getServerSnapshot(): DesktopExperienceMode | null {
  return null;
}

export interface UseDesktopModeResult {
  mode: DesktopExperienceMode;
  isChosen: boolean;
  setMode: (nextMode: DesktopExperienceMode) => void;
  resetMode: () => void;
}

export function useDesktopMode(): UseDesktopModeResult {
  const storedMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isChosen = storedMode !== null;
  const mode: DesktopExperienceMode = storedMode ?? 'workspace';

  const setMode = useCallback((nextMode: DesktopExperienceMode) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, nextMode);
      } catch {
        // Ignore storage quota / privacy mode errors.
      }
      window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
      syncSidecarMode(nextMode);
    }
  }, []);

  const resetMode = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors.
      }
      window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    }
  }, []);

  return { mode, isChosen, setMode, resetMode };
}
