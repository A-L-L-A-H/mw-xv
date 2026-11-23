'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';

export type ComicTransitionVariant = 'ink-wipe' | 'panel-reveal' | 'cut-impact' | 'soft';
export type ComicTransitionState = 'idle' | 'entering' | 'entered' | 'cancelled';

export interface SceneTransitionProps {
  readonly variant?: ComicTransitionVariant;
  readonly active?: boolean;
  readonly durationMs?: number;
  readonly reducedMotion?: boolean;
  readonly onComplete?: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function ComicSceneTransition({
  variant = 'panel-reveal',
  active = true,
  durationMs = 280,
  reducedMotion = false,
  onComplete,
  children,
  className,
  style,
}: SceneTransitionProps) {
  const [state, setState] = useState<ComicTransitionState>(
    reducedMotion || !active ? 'entered' : 'entering'
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState('entered');
  }, []);

  useEffect(() => {
    if (reducedMotion || !active || durationMs <= 0) {
      setState('entered');
      onCompleteRef.current?.();
      return;
    }
    setState('entering');
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        setState('entered');
        onCompleteRef.current?.();
      },
      Math.min(durationMs, 1500)
    );
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, durationMs, reducedMotion]);

  return (
    <div
      className={cn('mw-ui-comic-transition', className)}
      data-transition-variant={variant}
      data-transition-state={state}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      onPointerDown={state === 'entering' ? cancel : undefined}
      onKeyDown={state === 'entering' ? cancel : undefined}
      style={{
        opacity: 1,
        visibility: 'visible',
        transition: reducedMotion ? 'none' : `transform ${Math.min(durationMs, 1500)}ms ease-out`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
