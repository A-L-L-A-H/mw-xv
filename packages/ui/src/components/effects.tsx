'use client';

import { useId, useMemo, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { useAnimationVisibility } from '../lib/use-animation-visibility.js';

export function EditorialTexture({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('mw-ui-editorial-texture', className)} {...props} />;
}

export function AccentMarker({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('mw-ui-accent-marker', className)} {...props}>
      {children}
    </span>
  );
}

export function SignalOrbit({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div className={cn('mw-ui-signal-orbit', className)} {...props}>
      <span aria-hidden="true" />
      {children}
    </div>
  );
}

export function LoadingProgress({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  const motion = useAnimationVisibility<HTMLDivElement>();
  return (
    <div
      ref={motion.ref}
      className={cn('mw-ui-loading-progress', motion.visibilityClass, className)}
      role="status"
      aria-label={label}
    >
      <span aria-hidden="true" />
      <span className="mw-ui-sr-only">{label}</span>
    </div>
  );
}

/** Compact inline indicator for buttons while their associated action is pending. */
export function LoadingSpinner({ className }: { className?: string }) {
  const motion = useAnimationVisibility<HTMLSpanElement>();
  return (
    <span
      ref={motion.ref}
      aria-hidden="true"
      className={cn('mw-ui-loading-spinner', motion.visibilityClass, className)}
    />
  );
}

/** Deterministic PRNG so the ink pattern is identical on every render (no layout jitter). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Manga focus lines radiating from an origin. Rendered as tapered wedges (not strokes) so
 * they look hand-inked. Pulses subtly; disabled automatically by prefers-reduced-motion.
 */
export function SpeedLines({
  className,
  count = 72,
  origin = [0.22, 0.5],
  inner = 0.32,
  seed = 7,
  animate = true,
}: {
  className?: string;
  count?: number;
  /** Focus point as fractions of width/height. */
  origin?: [number, number];
  /** Empty radius around the focus point, as a fraction of the diagonal. */
  inner?: number;
  seed?: number;
  animate?: boolean;
}) {
  const motion = useAnimationVisibility<SVGSVGElement>();
  const originX = origin[0];
  const originY = origin[1];
  const paths = useMemo(() => {
    const rand = mulberry32(seed);
    const [ox, oy] = [originX * 1000, originY * 1000];
    const distanceToCanvasEdge = (angle: number) => {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const xDistance = dx > 0 ? (1000 - ox) / dx : dx < 0 ? -ox / dx : Infinity;
      const yDistance = dy > 0 ? (1000 - oy) / dy : dy < 0 ? -oy / dy : Infinity;
      return Math.min(xDistance, yDistance);
    };
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.06;
      const start = 1000 * (inner + rand() * 0.18);
      const width = 0.004 + rand() * 0.012;
      const p = (r: number, a: number) =>
        `${(ox + Math.cos(a) * r).toFixed(1)},${(oy + Math.sin(a) * r).toFixed(1)}`;
      const innerRadius = Math.min(start, distanceToCanvasEdge(angle));
      return `M${p(innerRadius, angle)} L${p(distanceToCanvasEdge(angle - width), angle - width)} L${p(distanceToCanvasEdge(angle + width), angle + width)} Z`;
    });
  }, [count, originX, originY, inner, seed]);

  return (
    <svg
      aria-hidden
      ref={motion.ref}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className={cn('mw-ui-speed-lines', motion.visibilityClass, className)}
    >
      <g fill="currentColor" className={animate ? 'mw-ui-speed-lines-pulse' : undefined}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Hand-drawn scribble underline, drawn in on mount. */
export function InkUnderline({
  className,
  color = 'var(--mw-magenta)',
}: {
  className?: string;
  color?: string;
}) {
  const motion = useAnimationVisibility<SVGSVGElement>();
  return (
    <svg
      aria-hidden
      ref={motion.ref}
      viewBox="0 0 200 16"
      preserveAspectRatio="none"
      className={cn('mw-ui-ink-underline', motion.visibilityClass, className)}
    >
      <path
        className="mw-ui-ink-underline-path"
        pathLength={1}
        d="M2 10 C 40 4, 80 14, 120 7 S 180 5, 198 9 M10 13 C 60 9, 120 15, 190 11"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Tiny ink doodles used as accents (never as information). */
export function Doodle({
  kind,
  className,
  style,
}: {
  kind: 'star' | 'bolt' | 'crown' | 'arrow' | 'sparkle' | 'smiley';
  className?: string;
  style?: CSSProperties;
}) {
  const motion = useAnimationVisibility<SVGSVGElement>();
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const shapes: Record<typeof kind, ReactNode> = {
    star: (
      <path
        {...common}
        d="M12 2.5l2.6 6.1 6.6.5-5 4.3 1.6 6.5L12 16.4l-5.8 3.5 1.6-6.5-5-4.3 6.6-.5z"
      />
    ),
    bolt: <path {...common} fill="var(--mw-yellow)" d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6z" />,
    crown: (
      <g {...common}>
        <path d="M4 17.5 3.5 8.5l5.2 4.5L13.5 5l5.1 7.6 5.4-4.2-1 9.1Z" />
        <path d="M5 20.5c5.5-.8 12.5-.6 18 0" />
        <circle cx="3.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="13.5" cy="3.3" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="24" cy="6.3" r="1.1" fill="currentColor" stroke="none" />
      </g>
    ),
    arrow: <path {...common} d="M3 18c4-1 8-5 10-11m0 0-4 2m4-2 1.5 4.5" />,
    sparkle: (
      <path
        {...common}
        d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"
      />
    ),
    smiley: (
      <g>
        <circle
          cx="12"
          cy="12"
          r="9.2"
          fill="var(--mw-yellow)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="9" cy="10" r="1.2" fill="var(--mw-ink-black)" />
        <circle cx="15" cy="10" r="1.2" fill="var(--mw-ink-black)" />
        <path
          d="M8.5 14.2c1.2 2 5.8 2 7 0"
          fill="none"
          stroke="var(--mw-ink-black)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      ref={motion.ref}
      viewBox={kind === 'crown' ? '0 0 28 24' : '0 0 24 24'}
      className={cn('mw-ui-doodle', motion.visibilityClass, className)}
      style={style}
    >
      {shapes[kind]}
    </svg>
  );
}

export type DecorativeMotifKind =
  'underline' | 'cross-out' | 'orbit' | 'globe-grid' | 'moon-phases' | 'eye-target';

const motifSpecs: Record<DecorativeMotifKind, { viewBox: string; content: ReactNode }> = {
  underline: {
    viewBox: '0 0 200 16',
    content: (
      <path
        d="M2 10C40 4 80 14 120 7s60-2 78 2M10 13c50-4 110 2 180-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    ),
  },
  'cross-out': {
    viewBox: '0 0 120 24',
    content: (
      <path
        d="M4 15c34-6 78-7 112-3M8 9c38 4 72 6 106 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    ),
  },
  orbit: {
    viewBox: '0 0 120 120',
    content: (
      <>
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.6"
          strokeDasharray="6 4"
        />
        <ellipse
          cx="60"
          cy="60"
          rx="52"
          ry="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          transform="rotate(-24 60 60)"
        />
        <circle
          cx="101"
          cy="40"
          r="4.5"
          fill="var(--mw-signal-blue)"
          stroke="var(--mw-ink-black)"
          strokeWidth="1.5"
        />
      </>
    ),
  },
  'globe-grid': {
    viewBox: '0 0 96 96',
    content: (
      <>
        <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="2" />
        <ellipse
          cx="48"
          cy="48"
          rx="19"
          ry="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M10 34h76M10 62h76M48 8v80" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  },
  'moon-phases': {
    viewBox: '0 0 160 32',
    content: (
      <>
        <circle cx="20" cy="16" r="10" fill="currentColor" />
        <path d="M52 6a10 10 0 1 0 0 20 7.5 10 0 0 1 0-20Z" fill="currentColor" />
        <path d="M84 6a10 10 0 1 0 0 20V6Z" fill="currentColor" />
        <circle cx="84" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="116" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M116 6a10 10 0 0 1 0 20 6 10 0 0 0 0-20Z" fill="currentColor" />
        <circle cx="146" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </>
    ),
  },
  'eye-target': {
    viewBox: '0 0 64 40',
    content: (
      <>
        <path
          d="M4 20c8-11 18-15 28-15s20 4 28 15c-8 11-18 15-28 15S12 31 4 20Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="20" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="32" cy="20" r="3" fill="currentColor" />
        <path
          d="M32 3v5M32 32v5M1 20h6M57 20h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
};

/** Non-interactive canonical decorative motif; never steals focus or pointer events. */
export function DecorativeMotif({
  kind,
  className,
  style,
}: {
  kind: DecorativeMotifKind;
  className?: string;
  style?: CSSProperties;
}) {
  const spec = motifSpecs[kind];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={spec.viewBox}
      className={cn('mw-ui-decorative-motif', className)}
      style={style}
    >
      {spec.content}
    </svg>
  );
}

/**
 * Wraps content in a rough, hand-inked border using an SVG displacement filter, so panel
 * edges wobble like brush ink instead of being perfectly straight.
 */
export function InkFrame({ children, className }: { children: ReactNode; className?: string }) {
  const id = useId().replaceAll(':', '');
  return (
    <div className={cn('mw-ui-ink-frame', className)}>
      <svg aria-hidden className="mw-ui-ink-frame-outline">
        <filter id={`rough-${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
        <rect
          width="100%"
          height="100%"
          fill="none"
          stroke="var(--mw-ink)"
          strokeWidth="3"
          filter={`url(#rough-${id})`}
        />
      </svg>
      {children}
    </div>
  );
}

/** Comic speech bubble for playful hints like record counts. */
export function SpeechBubble({ children, className }: { children: ReactNode; className?: string }) {
  const motion = useAnimationVisibility<HTMLDivElement>();
  return (
    <div ref={motion.ref} className={cn('mw-ui-speech-bubble', motion.visibilityClass, className)}>
      {children}
    </div>
  );
}

/** Real-state live status indicator; pulses only while active, visible, and motion-enabled. */
export function LiveIndicator({
  label = 'LIVE',
  active = false,
  variant = 'live',
  className,
}: {
  label?: string;
  active?: boolean;
  variant?: 'live' | 'on-air';
  className?: string;
}) {
  const motion = useAnimationVisibility<HTMLSpanElement>();
  return (
    <span
      ref={motion.ref}
      className={cn('mw-ui-live-indicator', motion.visibilityClass, className)}
      data-active={active ? 'true' : 'false'}
      data-variant={variant}
    >
      <span aria-hidden="true" className="mw-ui-live-indicator-dot" />
      <span>{label}</span>
    </span>
  );
}
