'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ColorMode, SkinDensity, SkinId } from '@moonwitness/types';
import { createSkinInitScript, DEFAULT_SKIN_ID, themeRegistry } from '@moonwitness/ui/themes';
import { SkinContext, type SkinContextValue } from './skin-context';
import { readPreferences, savePreferences } from '@/lib/preferences';

export const SKIN_INIT_SCRIPT = createSkinInitScript();

export function SkinProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ skin: SkinId; mode: ColorMode; density: SkinDensity }>(
    () => {
      const prefs = readPreferences();
      return { skin: prefs.skin, mode: prefs.theme, density: prefs.density };
    }
  );

  useEffect(() => {
    const existing = readPreferences();
    savePreferences({
      ...existing,
      skin: state.skin,
      theme: state.mode,
      density: state.density,
    });
  }, [state.skin, state.mode, state.density]);

  const update = useCallback(
    (patch: Partial<{ skin: SkinId; mode: ColorMode; density: SkinDensity }>) => {
      setState((current) => {
        const normalized = themeRegistry.normalizePreferences({
          skin: patch.skin ?? current.skin,
          theme_mode: patch.mode ?? current.mode,
          density: patch.density ?? current.density,
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
