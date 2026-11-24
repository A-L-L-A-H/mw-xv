import { useEffect, useState } from 'react';
import { getActiveSceneHarness } from './scene-test-harness.js';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Subscribe to OS `(prefers-reduced-motion: reduce)` while honoring explicit prop
 * overrides and active deterministic scene harness settings.
 */
export function useReducedMotion(explicit?: boolean): boolean {
  const harness = getActiveSceneHarness();
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    if (!query) return;
    setSystemReduced(Boolean(query.matches));
    const onChange = (event: { matches: boolean }) => setSystemReduced(Boolean(event.matches));
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);

  return Boolean(explicit ?? harness?.reducedMotion ?? systemReduced);
}
