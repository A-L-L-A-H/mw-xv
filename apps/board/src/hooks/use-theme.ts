'use client';

import { useCallback } from 'react';
import { useSkin } from '@/components/providers/skin-context';

export function useTheme() {
  const { mode, setMode } = useSkin();
  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);
  return { theme: mode, toggle };
}
