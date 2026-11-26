export interface ObservatoryCanvasPalette {
  readonly night: string;
  readonly nightSoft: string;
  readonly nightRaised: string;
  readonly nightBlue: string;
  readonly nightMagenta: string;
  readonly paper: string;
  readonly ink: string;
  readonly inkFaint: string;
  readonly yellow: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly violet: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
  readonly moon: string;
  readonly chart1: string;
  readonly chart4: string;
  readonly fontMono: string;
  readonly fontDisplay: string;
}

function readToken(styles: CSSStyleDeclaration, tokenName: string, fallbackToken?: string): string {
  const value = styles.getPropertyValue(tokenName).trim();
  if (value.length > 0) return value;
  if (fallbackToken) {
    const fallbackVal = styles.getPropertyValue(fallbackToken).trim();
    if (fallbackVal.length > 0) return fallbackVal;
  }
  return 'currentColor';
}

export function readObservatoryCanvasPalette(): ObservatoryCanvasPalette {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      night: 'Canvas',
      nightSoft: 'Canvas',
      nightRaised: 'Canvas',
      nightBlue: 'Canvas',
      nightMagenta: 'Canvas',
      paper: 'CanvasText',
      ink: 'Canvas',
      inkFaint: 'GrayText',
      yellow: 'Highlight',
      magenta: 'Highlight',
      cyan: 'Highlight',
      violet: 'Highlight',
      success: 'Highlight',
      warning: 'Highlight',
      error: 'Mark',
      info: 'LinkText',
      moon: 'GrayText',
      chart1: 'Highlight',
      chart4: 'Highlight',
      fontMono: 'monospace',
      fontDisplay: 'sans-serif',
    };
  }
  const styles = window.getComputedStyle(document.documentElement);
  return {
    night: readToken(styles, '--mw-night', '--mw-ink'),
    nightSoft: readToken(styles, '--mw-night-soft', '--mw-night'),
    nightRaised: readToken(styles, '--mw-night-raised', '--mw-ink-panel'),
    nightBlue: readToken(styles, '--mw-night-blue', '--mw-night'),
    nightMagenta: readToken(styles, '--mw-night-magenta', '--mw-night'),
    paper: readToken(styles, '--mw-paper-cream', '--mw-paper'),
    ink: readToken(styles, '--mw-ink'),
    inkFaint: readToken(styles, '--mw-ink-faint'),
    yellow: readToken(styles, '--mw-yellow'),
    magenta: readToken(styles, '--mw-magenta'),
    cyan: readToken(styles, '--mw-cyan', '--mw-signal-blue'),
    violet: readToken(styles, '--mw-violet'),
    success: readToken(styles, '--mw-chart-1', '--mw-success'),
    warning: readToken(styles, '--mw-warning', '--mw-yellow'),
    error: readToken(styles, '--mw-error'),
    info: readToken(styles, '--mw-info', '--mw-cyan'),
    moon: readToken(styles, '--mw-moon'),
    chart1: readToken(styles, '--mw-chart-1'),
    chart4: readToken(styles, '--mw-chart-4'),
    fontMono: readToken(styles, '--mw-font-mono') || 'monospace',
    fontDisplay: readToken(styles, '--mw-font-display') || 'sans-serif',
  };
}

export function runtimeAccentColor(
  runtime: string,
  status: string,
  palette: ObservatoryCanvasPalette
): string {
  if (status === 'error') return palette.error;
  switch (runtime) {
    case 'hub':
    case 'claude':
    case 'plan':
      return palette.yellow;
    case 'antigravity':
      return palette.cyan;
    case 'codex':
    case 'infra':
      return palette.chart1;
    case 'opencode':
    case 'git':
      return palette.chart4;
    case 'magpie':
    case 'visual-swarm':
      return palette.magenta;
    case 'qoder':
    case 'desktop-worktree':
      return palette.violet;
    case 'gemini-cli':
      return palette.info;
    default:
      return palette.moon;
  }
}

export function portraitUrlForSession(runtime: string, status: string): string {
  const base = '/observatory-art/characters';
  if (status === 'error') return `${base}/kuro-signal-expression-angry.webp`;
  if (runtime === 'opencode') {
    return status === 'running'
      ? `${base}/kuro-signal-expression-determined.webp`
      : `${base}/kuro-signal-expression-victory.webp`;
  }
  if (runtime === 'magpie') return '/observatory-art/game/avatar-vesper.png';
  if (runtime === 'claude') return `${base}/vesper-ink-portrait.webp`;
  if (runtime === 'codex') return `${base}/kuro-signal-expression-victory.webp`;
  if (runtime === 'qoder') return `${base}/kuro-signal-expression-laughing.webp`;
  if (runtime === 'gemini-cli') return `${base}/kuro-signal-expression-curious.webp`;
  if (runtime === 'desktop-worktree') return `${base}/kuro-signal-expression-celebrating.webp`;
  if (status === 'running') return `${base}/kuro-signal-expression-excited.webp`;
  if (status === 'recent') return `${base}/kuro-signal-expression-determined.webp`;
  return `${base}/kuro-signal-expression-sleepy.webp`;
}

export const STAGE_BACKDROP_URLS: Readonly<Record<'alley' | 'arcade' | 'grid', string | null>> =
  Object.freeze({
    alley: '/observatory-art/backgrounds/bg-riot-street-alley.webp',
    arcade: '/observatory-art/backgrounds/bg-riot-arcade-workbench.webp',
    grid: null,
  });
