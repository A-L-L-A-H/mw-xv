import { createContext, useContext } from 'react';
import type { ColorMode, SkinDensity, SkinId, SkinMetadata } from '@moonwitness/types';

export interface SkinContextValue {
  skin: SkinId;
  mode: ColorMode;
  density: SkinDensity;
  skins: readonly SkinMetadata[];
  setSkin: (skin: SkinId) => void;
  setMode: (mode: ColorMode) => void;
  setDensity: (density: SkinDensity) => void;
  resetSkin: () => void;
}

export const SkinContext = createContext<SkinContextValue | null>(null);

export function useSkin(): SkinContextValue {
  const context = useContext(SkinContext);
  if (!context) {
    throw new Error('useSkin must be used within a SkinProvider');
  }
  return context;
}
