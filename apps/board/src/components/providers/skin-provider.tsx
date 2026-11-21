'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ColorMode, SkinDensity, SkinId, SkinMetadata } from '@moonwitness/types';
import { DEFAULT_SKIN_ID, themeRegistry } from '@moonwitness/ui/themes';
import {
  applySkinToDocument,
  readPreferences,
  savePreferences,
} from '@/lib/preferences';

export const SKIN_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('mw-board-preferences');var p=s?JSON.parse(s):null;var k=p&&typeof p.skin==='string'?p.skin:'${DEFAULT_SKIN_ID}';var allowed=['moonwitness-ink','moonwitness-compact','moonwitness-high-contrast'];if(allowed.indexOf(k)===-1)k='${DEFAULT_SKIN_ID}';var d=p&&p.density==='compact'?'compact':'comfortable';var m=(p&&(p.theme==='dark'||p.theme==='light'))?p.theme:(localStorage.getItem('mw-theme')==='dark'?'dark':'light');var r=document.documentElement;r.dataset.skin=k;r.dataset.density=d;r.classList.toggle('dark',m==='dark');}catch(e){}})();`;

interface SkinContextValue {
  skin: SkinId;
  mode: ColorMode;
  density: SkinDensity;
  skins: readonly SkinMetadata[];
  setSkin: (skin: SkinId) => void;
  setMode: (mode: ColorMode) => void;
  setDensity: (density: SkinDensity) => void;
  resetSkin: () => void;
}

const SkinContext = createContext<SkinContextValue | null>(null);

export function SkinProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ skin: SkinId; mode: ColorMode; density: SkinDensity }>(
    () => {
      const prefs = readPreferences();
      return { skin: prefs.skin, mode: prefs.theme, density: prefs.density };
    }
  );

  useEffect(() => {
    applySkinToDocument(state.skin, state.mode, state.density);
  }, [state.skin, state.mode, state.density]);

  const update = useCallback(
    (patch: Partial<{ skin: SkinId; mode: ColorMode; density: SkinDensity }>) => {
      setState((current) => {
        const normalized = themeRegistry.normalizePreferences({
          skin: patch.skin ?? current.skin,
          theme_mode: patch.mode ?? current.mode,
          density: patch.density ?? current.density,
        });
        const existing = readPreferences();
        savePreferences({
          ...existing,
          skin: normalized.skin,
          theme: normalized.theme_mode,
          density: normalized.density,
        });
        return {
          skin: normalized.skin,
          mode: normalized.theme_mode,
          density: normalized.density,
        };
      });
    },
    []
  );

  const setSkin = useCallback((skin: SkinId) => update({ skin }), [update]);
  const setMode = useCallback((mode: ColorMode) => update({ mode }), [update]);
  const setDensity = useCallback((density: SkinDensity) => update({ density }), [update]);
  const resetSkin = useCallback(
    () => update({ skin: DEFAULT_SKIN_ID, mode: 'light', density: 'comfortable' }),
    [update]
  );

  const value = useMemo<SkinContextValue>(
    () => ({
      skin: state.skin,
      mode: state.mode,
      density: state.density,
      skins: themeRegistry.list(),
      setSkin,
      setMode,
      setDensity,
      resetSkin,
    }),
    [state.skin, state.mode, state.density, setSkin, setMode, setDensity, resetSkin]
  );

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export function useSkin(): SkinContextValue {
  const context = useContext(SkinContext);
  if (!context) {
    throw new Error('useSkin must be used within a SkinProvider');
  }
  return context;
}
