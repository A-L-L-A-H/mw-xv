import { sha256Hex } from './canonical-json.js';
import { compareAscii } from './sort-utils.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export type DesignColorMode = 'light' | 'dark';
export type DesignDensity = 'comfortable' | 'compact';
export type MotionPolicy = 'standard' | 'reduced' | 'none';
export type VisualAuditSeverity = 'error' | 'warning' | 'info';

export interface DesignPaletteTokens {
  readonly background: string;
  readonly foreground: string;
  readonly surface: string;
  readonly surfaceForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly error: string;
  readonly onError: string;
  readonly success: string;
  readonly onSuccess: string;
  readonly warning: string;
  readonly onWarning: string;
  readonly info: string;
  readonly onInfo: string;
}

export interface DesignTypographyTokens {
  readonly fontDisplay: string;
  readonly fontSans: string;
  readonly fontMono: string;
  readonly sizeXs: string;
  readonly sizeSm: string;
  readonly sizeMd: string;
  readonly sizeLg: string;
}

export interface DesignSurfaceTokens {
  readonly borderWidth: string;
  readonly radiusSm: string;
  readonly radiusMd: string;
  readonly radiusLg: string;
  readonly shadowSm: string;
  readonly shadowMd: string;
}

export interface DesignMotionTokens {
  readonly policy: MotionPolicy;
  readonly durationFastMs: number;
  readonly durationBaseMs: number;
  readonly durationSlowMs: number;
  readonly respectReducedMotion: boolean;
}

export interface DesignProfileProvenance {
  readonly sourceLabel: string;
  readonly sourceKind: 'moonwitness_ui' | 'external_reference' | 'custom_tokens';
  readonly copyRightsGranted: boolean;
  readonly referencePaths: readonly string[];
}

export interface DesignProfile {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly name: string;
  readonly skinId: string;
  readonly colorMode: DesignColorMode;
  readonly density: DesignDensity;
  readonly palette: DesignPaletteTokens;
  readonly typography: DesignTypographyTokens;
  readonly surfaces: DesignSurfaceTokens;
  readonly motion: DesignMotionTokens;
  readonly customTokens: Readonly<Record<string, string>>;
  readonly provenance: DesignProfileProvenance;
  readonly contentSha256: string;
}

export interface ExtractDesignProfileInput {
  readonly profileId: string;
  readonly name: string;
  readonly skinId?: string;
  readonly colorMode?: DesignColorMode;
  readonly density?: DesignDensity;
  readonly cssText?: string;
  readonly tokenOverrides?: Readonly<Record<string, string>>;
  readonly motionPolicy?: MotionPolicy;
  readonly respectReducedMotion?: boolean;
  readonly provenance?: Partial<DesignProfileProvenance>;
  readonly redactor?: RedactionContext;
}

export interface DesignProfileValidationIssue {
  readonly code: string;
  readonly field: string;
  readonly severity: VisualAuditSeverity;
  readonly message: string;
}

export interface DesignProfileValidationResult {
  readonly valid: boolean;
  readonly issues: readonly DesignProfileValidationIssue[];
}

export interface ContrastCheckResult {
  readonly pairId: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly requiredRatio: number;
  readonly wcagLevel: 'AA' | 'AAA';
  readonly passed: boolean;
}

export interface TokenDriftEntry {
  readonly tokenKey: string;
  readonly baselineValue: string;
  readonly actualValue: string;
}

export interface VisualDnaAuditFinding {
  readonly code: string;
  readonly severity: VisualAuditSeverity;
  readonly message: string;
  readonly field?: string;
}

export interface VisualDnaAuditOptions {
  readonly minNormalTextContrast?: number;
  readonly minUiComponentContrast?: number;
  readonly requireReducedMotionSupport?: boolean;
  readonly allowThirdPartyCopy?: boolean;
}

export interface VisualDnaAuditReport {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly baselineProfileId: string | null;
  readonly passed: boolean;
  readonly advisoryOnly: true;
  readonly contrastChecks: readonly ContrastCheckResult[];
  readonly driftedTokens: readonly TokenDriftEntry[];
  readonly findings: readonly VisualDnaAuditFinding[];
  readonly reportSha256: string;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const CSS_CUSTOM_PROP_PATTERN = /(--[a-z0-9-]+)\s*:\s*([^;]+);/giu;
const CSS_VAR_REF_PATTERN = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/iu;

const DEFAULT_MOONWITNESS_PALETTE: DesignPaletteTokens = Object.freeze({
  background: '#f3efe4',
  foreground: '#0d0d0d',
  surface: '#fffdf6',
  surfaceForeground: '#0d0d0d',
  primary: '#ffe031',
  primaryForeground: '#0d0d0d',
  accent: '#ffe031',
  accentForeground: '#0d0d0d',
  muted: '#e7e2d4',
  mutedForeground: '#3a3a36',
  border: '#0d0d0d',
  error: '#b42318',
  onError: '#fffdf6',
  success: '#166534',
  onSuccess: '#fffdf6',
  warning: '#facc15',
  onWarning: '#0d0d0d',
  info: '#175cd3',
  onInfo: '#fffdf6',
});

const DEFAULT_MOONWITNESS_TYPOGRAPHY: DesignTypographyTokens = Object.freeze({
  fontDisplay: "'MoonWitness Grunge', 'Anton', Impact, 'Arial Narrow', sans-serif",
  fontSans: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  sizeXs: '0.75rem',
  sizeSm: '0.875rem',
  sizeMd: '1rem',
  sizeLg: '1.125rem',
});

const DEFAULT_MOONWITNESS_SURFACES: DesignSurfaceTokens = Object.freeze({
  borderWidth: '2px',
  radiusSm: '0.25rem',
  radiusMd: '0.5rem',
  radiusLg: '0.75rem',
  shadowSm: '2px 2px 0 #0d0d0d',
  shadowMd: '4px 4px 0 #0d0d0d',
});

function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

function hexToRgb(hex: string): readonly [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return [r, g, b] as const;
}

function channelRelativeLuminance(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes WCAG 2.1 contrast ratio between two hex colors (1.0 to 21.0).
 * Returns null if either color is not a valid 3- or 6-digit hex color.
 */
export function computeContrastRatio(foregroundHex: string, backgroundHex: string): number | null {
  const fg = hexToRgb(foregroundHex);
  const bg = hexToRgb(backgroundHex);
  if (!fg || !bg) {
    return null;
  }
  const lFg =
    0.2126 * channelRelativeLuminance(fg[0]) +
    0.7152 * channelRelativeLuminance(fg[1]) +
    0.0722 * channelRelativeLuminance(fg[2]);
  const lBg =
    0.2126 * channelRelativeLuminance(bg[0]) +
    0.7152 * channelRelativeLuminance(bg[1]) +
    0.0722 * channelRelativeLuminance(bg[2]);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function parseCssCustomProperties(cssText: string): Readonly<Record<string, string>> {
  const raw: Record<string, string> = {};
  const matches = cssText.matchAll(CSS_CUSTOM_PROP_PATTERN);
  for (const match of matches) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value) {
      raw[key] = value;
    }
  }
  const resolved: Record<string, string> = {};
  const sortedKeys = Object.keys(raw).sort(compareAscii);
  for (const key of sortedKeys) {
    resolved[key] = resolveCssVarReference(raw[key] ?? '', raw, 0);
  }
  return resolved;
}

function resolveCssVarReference(
  value: string,
  table: Readonly<Record<string, string>>,
  depth: number
): string {
  if (depth >= 8) {
    return value;
  }
  const match = CSS_VAR_REF_PATTERN.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  const refName = match[1];
  const fallback = match[2]?.trim();
  if (refName && table[refName] !== undefined) {
    return resolveCssVarReference(table[refName], table, depth + 1);
  }
  return fallback ?? value.trim();
}

function pickToken(
  tokens: Readonly<Record<string, string>>,
  keys: readonly string[],
  fallback: string
): string {
  for (const key of keys) {
    const value = tokens[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

function parseDurationMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('ms')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
  }
  if (trimmed.endsWith('s')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : fallback;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

/**
 * Deterministically extracts a canonical DesignProfile from CSS custom properties
 * and/or structured token overrides without reading the filesystem or spawning shells.
 */
export function extractDesignProfileFromTokens(input: ExtractDesignProfileInput): DesignProfile {
  const redactor = input.redactor ?? createRedactor();
  const parsedCss = input.cssText ? parseCssCustomProperties(input.cssText) : {};
  const mergedTokens: Record<string, string> = { ...parsedCss };

  if (input.tokenOverrides) {
    for (const key of Object.keys(input.tokenOverrides).sort(compareAscii)) {
      const val = input.tokenOverrides[key];
      if (typeof val === 'string') {
        mergedTokens[key] = redactor.redactString(val.trim());
      }
    }
  }

  const resolvedTokens: Record<string, string> = {};
  for (const key of Object.keys(mergedTokens).sort(compareAscii)) {
    const rawValue = mergedTokens[key] ?? '';
    resolvedTokens[key] = redactor.redactString(resolveCssVarReference(rawValue, mergedTokens, 0));
  }

  const palette: DesignPaletteTokens = {
    background: pickToken(
      resolvedTokens,
      ['--mw-background', '--mw-paper', '--background'],
      DEFAULT_MOONWITNESS_PALETTE.background
    ),
    foreground: pickToken(
      resolvedTokens,
      ['--mw-foreground', '--mw-ink', '--foreground'],
      DEFAULT_MOONWITNESS_PALETTE.foreground
    ),
    surface: pickToken(
      resolvedTokens,
      ['--mw-surface', '--mw-paper-raised', '--surface'],
      DEFAULT_MOONWITNESS_PALETTE.surface
    ),
    surfaceForeground: pickToken(
      resolvedTokens,
      ['--mw-surface-foreground', '--mw-ink', '--surface-foreground'],
      DEFAULT_MOONWITNESS_PALETTE.surfaceForeground
    ),
    primary: pickToken(
      resolvedTokens,
      ['--mw-primary', '--mw-yellow', '--primary'],
      DEFAULT_MOONWITNESS_PALETTE.primary
    ),
    primaryForeground: pickToken(
      resolvedTokens,
      ['--mw-primary-foreground', '--mw-on-accent', '--primary-foreground'],
      DEFAULT_MOONWITNESS_PALETTE.primaryForeground
    ),
    accent: pickToken(
      resolvedTokens,
      ['--mw-accent', '--mw-yellow', '--accent'],
      DEFAULT_MOONWITNESS_PALETTE.accent
    ),
    accentForeground: pickToken(
      resolvedTokens,
      ['--mw-accent-foreground', '--mw-on-accent', '--accent-foreground'],
      DEFAULT_MOONWITNESS_PALETTE.accentForeground
    ),
    muted: pickToken(resolvedTokens, ['--mw-muted', '--muted'], DEFAULT_MOONWITNESS_PALETTE.muted),
    mutedForeground: pickToken(
      resolvedTokens,
      ['--mw-muted-foreground', '--mw-ink-soft', '--muted-foreground'],
      DEFAULT_MOONWITNESS_PALETTE.mutedForeground
    ),
    border: pickToken(
      resolvedTokens,
      ['--mw-border', '--mw-ink', '--border'],
      DEFAULT_MOONWITNESS_PALETTE.border
    ),
    error: pickToken(
      resolvedTokens,
      ['--mw-error', '--mw-destructive', '--error'],
      DEFAULT_MOONWITNESS_PALETTE.error
    ),
    onError: pickToken(
      resolvedTokens,
      ['--mw-on-error', '--mw-destructive-foreground', '--on-error'],
      DEFAULT_MOONWITNESS_PALETTE.onError
    ),
    success: pickToken(
      resolvedTokens,
      ['--mw-success', '--success'],
      DEFAULT_MOONWITNESS_PALETTE.success
    ),
    onSuccess: pickToken(
      resolvedTokens,
      ['--mw-on-success', '--on-success'],
      DEFAULT_MOONWITNESS_PALETTE.onSuccess
    ),
    warning: pickToken(
      resolvedTokens,
      ['--mw-warning', '--warning'],
      DEFAULT_MOONWITNESS_PALETTE.warning
    ),
    onWarning: pickToken(
      resolvedTokens,
      ['--mw-on-warning', '--on-warning'],
      DEFAULT_MOONWITNESS_PALETTE.onWarning
    ),
    info: pickToken(resolvedTokens, ['--mw-info', '--info'], DEFAULT_MOONWITNESS_PALETTE.info),
    onInfo: pickToken(
      resolvedTokens,
      ['--mw-on-info', '--on-info'],
      DEFAULT_MOONWITNESS_PALETTE.onInfo
    ),
  };

  const typography: DesignTypographyTokens = {
    fontDisplay: pickToken(
      resolvedTokens,
      ['--mw-font-display', '--font-display'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.fontDisplay
    ),
    fontSans: pickToken(
      resolvedTokens,
      ['--mw-font-sans', '--font-sans'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.fontSans
    ),
    fontMono: pickToken(
      resolvedTokens,
      ['--mw-font-mono', '--font-mono'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.fontMono
    ),
    sizeXs: pickToken(
      resolvedTokens,
      ['--mw-font-size-xs', '--font-size-xs'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.sizeXs
    ),
    sizeSm: pickToken(
      resolvedTokens,
      ['--mw-font-size-sm', '--font-size-sm'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.sizeSm
    ),
    sizeMd: pickToken(
      resolvedTokens,
      ['--mw-font-size-md', '--font-size-md'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.sizeMd
    ),
    sizeLg: pickToken(
      resolvedTokens,
      ['--mw-font-size-lg', '--font-size-lg'],
      DEFAULT_MOONWITNESS_TYPOGRAPHY.sizeLg
    ),
  };

  const surfaces: DesignSurfaceTokens = {
    borderWidth: pickToken(
      resolvedTokens,
      ['--mw-border-width', '--border-width'],
      DEFAULT_MOONWITNESS_SURFACES.borderWidth
    ),
    radiusSm: pickToken(
      resolvedTokens,
      ['--mw-radius-sm', '--radius-sm'],
      DEFAULT_MOONWITNESS_SURFACES.radiusSm
    ),
    radiusMd: pickToken(
      resolvedTokens,
      ['--mw-radius-md', '--radius-md'],
      DEFAULT_MOONWITNESS_SURFACES.radiusMd
    ),
    radiusLg: pickToken(
      resolvedTokens,
      ['--mw-radius-lg', '--radius-lg'],
      DEFAULT_MOONWITNESS_SURFACES.radiusLg
    ),
    shadowSm: pickToken(
      resolvedTokens,
      ['--mw-shadow-sm', '--shadow-sm'],
      DEFAULT_MOONWITNESS_SURFACES.shadowSm
    ),
    shadowMd: pickToken(
      resolvedTokens,
      ['--mw-shadow-md', '--shadow-md'],
      DEFAULT_MOONWITNESS_SURFACES.shadowMd
    ),
  };

  const motionPolicy: MotionPolicy = input.motionPolicy ?? 'standard';
  const motion: DesignMotionTokens = {
    policy: motionPolicy,
    durationFastMs:
      motionPolicy === 'none' ? 0 : parseDurationMs(resolvedTokens['--mw-duration-fast'], 120),
    durationBaseMs:
      motionPolicy === 'none' ? 0 : parseDurationMs(resolvedTokens['--mw-duration-base'], 200),
    durationSlowMs:
      motionPolicy === 'none' ? 0 : parseDurationMs(resolvedTokens['--mw-duration-slow'], 320),
    respectReducedMotion: input.respectReducedMotion ?? true,
  };

  const sourceKind = input.provenance?.sourceKind ?? 'moonwitness_ui';
  const provenance: DesignProfileProvenance = {
    sourceLabel: redactor.redactString(input.provenance?.sourceLabel ?? 'moonwitness/ui'),
    sourceKind,
    copyRightsGranted:
      sourceKind === 'external_reference' ? false : (input.provenance?.copyRightsGranted ?? true),
    referencePaths: [...(input.provenance?.referencePaths ?? [])]
      .map((path) => redactor.redactString(path.trim()))
      .filter((path) => path.length > 0)
      .sort(compareAscii),
  };

  const canonicalPayload = {
    schemaVersion: 1 as const,
    profileId: redactor.redactString(input.profileId.trim()),
    name: redactor.redactString(input.name.trim()),
    skinId: redactor.redactString((input.skinId ?? 'moonwitness-ink').trim()),
    colorMode: input.colorMode ?? 'light',
    density: input.density ?? 'comfortable',
    palette,
    typography,
    surfaces,
    motion,
    customTokens: resolvedTokens,
    provenance,
  };

  const contentSha256 = sha256Hex(JSON.stringify(canonicalPayload));
  return {
    ...canonicalPayload,
    contentSha256,
  };
}

export function validateDesignProfile(profile: DesignProfile): DesignProfileValidationResult {
  const issues: DesignProfileValidationIssue[] = [];

  if (profile.schemaVersion !== 1) {
    issues.push({
      code: 'INVALID_SCHEMA_VERSION',
      field: 'schemaVersion',
      severity: 'error',
      message: `Unsupported DesignProfile schemaVersion: ${String(profile.schemaVersion)}.`,
    });
  }

  if (profile.profileId.trim().length === 0) {
    issues.push({
      code: 'MISSING_PROFILE_ID',
      field: 'profileId',
      severity: 'error',
      message: 'profileId must be a non-empty string.',
    });
  }

  if (profile.name.trim().length === 0) {
    issues.push({
      code: 'MISSING_PROFILE_NAME',
      field: 'name',
      severity: 'error',
      message: 'name must be a non-empty string.',
    });
  }

  const paletteEntries = Object.entries(profile.palette) as ReadonlyArray<
    readonly [keyof DesignPaletteTokens, string]
  >;
  for (const [key, value] of paletteEntries) {
    if (!normalizeHex(value)) {
      issues.push({
        code: 'INVALID_PALETTE_HEX',
        field: `palette.${key}`,
        severity: 'error',
        message: `Palette token "${key}" must be a valid 3- or 6-digit hex color (received "${value}").`,
      });
    }
  }

  if (
    profile.motion.durationFastMs < 0 ||
    profile.motion.durationBaseMs < 0 ||
    profile.motion.durationSlowMs < 0
  ) {
    issues.push({
      code: 'NEGATIVE_MOTION_DURATION',
      field: 'motion',
      severity: 'error',
      message: 'Motion durations must be non-negative milliseconds.',
    });
  }

  if (
    profile.provenance.sourceKind === 'external_reference' &&
    profile.provenance.copyRightsGranted
  ) {
    issues.push({
      code: 'EXTERNAL_COPY_RIGHTS_FORBIDDEN',
      field: 'provenance.copyRightsGranted',
      severity: 'error',
      message: 'External visual references must not assert copyRightsGranted=true.',
    });
  }

  const { contentSha256: _ignored, ...withoutHash } = profile;
  const expectedSha = sha256Hex(JSON.stringify(withoutHash));
  if (profile.contentSha256 !== expectedSha) {
    issues.push({
      code: 'CONTENT_HASH_MISMATCH',
      field: 'contentSha256',
      severity: 'error',
      message: 'DesignProfile contentSha256 does not match canonical payload.',
    });
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}

/**
 * Audits a DesignProfile for WCAG 2.1 contrast compliance, reduced-motion support,
 * provenance safety, and optional token drift against a canonical baseline profile.
 */
export function auditDesignProfileCompliance(
  profile: DesignProfile,
  baseline?: DesignProfile,
  options?: VisualDnaAuditOptions
): VisualDnaAuditReport {
  const minNormalTextContrast = options?.minNormalTextContrast ?? 4.5;
  const minUiComponentContrast = options?.minUiComponentContrast ?? 3.0;
  const requireReducedMotionSupport = options?.requireReducedMotionSupport ?? true;
  const allowThirdPartyCopy = options?.allowThirdPartyCopy ?? false;

  const findings: VisualDnaAuditFinding[] = [];
  const validation = validateDesignProfile(profile);
  for (const issue of validation.issues) {
    findings.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      field: issue.field,
    });
  }

  if (requireReducedMotionSupport && !profile.motion.respectReducedMotion) {
    findings.push({
      code: 'REDUCED_MOTION_NOT_RESPECTED',
      severity: 'error',
      field: 'motion.respectReducedMotion',
      message: 'Profile must respect prefers-reduced-motion for WCAG accessibility compliance.',
    });
  }

  if (
    !allowThirdPartyCopy &&
    profile.provenance.sourceKind === 'external_reference' &&
    profile.provenance.copyRightsGranted
  ) {
    findings.push({
      code: 'THIRD_PARTY_ASSET_COPY_BLOCKED',
      severity: 'error',
      field: 'provenance.copyRightsGranted',
      message: 'Copying third-party visual assets or branding from external references is blocked.',
    });
  }

  const pairs: ReadonlyArray<{
    readonly pairId: string;
    readonly fg: string;
    readonly bg: string;
    readonly requiredRatio: number;
    readonly wcagLevel: 'AA' | 'AAA';
  }> = [
    {
      pairId: 'foreground/background',
      fg: profile.palette.foreground,
      bg: profile.palette.background,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'surfaceForeground/surface',
      fg: profile.palette.surfaceForeground,
      bg: profile.palette.surface,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'primaryForeground/primary',
      fg: profile.palette.primaryForeground,
      bg: profile.palette.primary,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'mutedForeground/muted',
      fg: profile.palette.mutedForeground,
      bg: profile.palette.muted,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'onError/error',
      fg: profile.palette.onError,
      bg: profile.palette.error,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'onSuccess/success',
      fg: profile.palette.onSuccess,
      bg: profile.palette.success,
      requiredRatio: minNormalTextContrast,
      wcagLevel: minNormalTextContrast >= 7 ? 'AAA' : 'AA',
    },
    {
      pairId: 'border/background',
      fg: profile.palette.border,
      bg: profile.palette.background,
      requiredRatio: minUiComponentContrast,
      wcagLevel: 'AA',
    },
  ];

  const contrastChecks: ContrastCheckResult[] = [];
  for (const pair of pairs) {
    const ratio = computeContrastRatio(pair.fg, pair.bg);
    if (ratio === null) {
      findings.push({
        code: 'UNCOMPUTABLE_CONTRAST',
        severity: 'error',
        field: `palette.${pair.pairId}`,
        message: `Unable to compute WCAG contrast for ${pair.pairId}.`,
      });
      continue;
    }
    const passed = ratio >= pair.requiredRatio;
    contrastChecks.push({
      pairId: pair.pairId,
      foreground: pair.fg,
      background: pair.bg,
      ratio,
      requiredRatio: pair.requiredRatio,
      wcagLevel: pair.wcagLevel,
      passed,
    });
    if (!passed) {
      findings.push({
        code: 'CONTRAST_BELOW_THRESHOLD',
        severity: 'error',
        field: `palette.${pair.pairId}`,
        message: `Contrast ratio ${ratio}:1 for ${pair.pairId} is below required ${pair.requiredRatio}:1 (${pair.wcagLevel}).`,
      });
    }
  }

  const driftedTokens: TokenDriftEntry[] = [];
  if (baseline) {
    const paletteKeys = Object.keys(baseline.palette).sort(compareAscii) as Array<
      keyof DesignPaletteTokens
    >;
    for (const key of paletteKeys) {
      const baseVal = baseline.palette[key];
      const actualVal = profile.palette[key];
      if (baseVal.toLowerCase() !== actualVal.toLowerCase()) {
        driftedTokens.push({
          tokenKey: `palette.${key}`,
          baselineValue: baseVal,
          actualValue: actualVal,
        });
      }
    }
    const typoKeys = Object.keys(baseline.typography).sort(compareAscii) as Array<
      keyof DesignTypographyTokens
    >;
    for (const key of typoKeys) {
      const baseVal = baseline.typography[key];
      const actualVal = profile.typography[key];
      if (baseVal !== actualVal) {
        driftedTokens.push({
          tokenKey: `typography.${key}`,
          baselineValue: baseVal,
          actualValue: actualVal,
        });
      }
    }
    if (driftedTokens.length > 0) {
      findings.push({
        code: 'THEME_TOKEN_DRIFT_DETECTED',
        severity: 'warning',
        message: `Detected ${driftedTokens.length} token drift(s) relative to baseline "${baseline.profileId}".`,
      });
    }
  }

  const passed = findings.every((finding) => finding.severity !== 'error');
  const payload = {
    schemaVersion: 1 as const,
    profileId: profile.profileId,
    baselineProfileId: baseline?.profileId ?? null,
    passed,
    advisoryOnly: true as const,
    contrastChecks,
    driftedTokens,
    findings,
  };

  return {
    ...payload,
    reportSha256: sha256Hex(JSON.stringify(payload)),
  };
}

/**
 * Formats a deterministic, redacted Markdown Visual DNA brief suitable for
 * Desktop coding tasks and Prompt Forge packets.
 */
export function formatDesignProfileBrief(
  profile: DesignProfile,
  audit?: VisualDnaAuditReport
): string {
  const lines: string[] = [
    `# Visual DNA Brief: ${profile.name}`,
    '',
    `- **Profile ID:** \`${profile.profileId}\``,
    `- **Skin:** \`${profile.skinId}\` (\`${profile.colorMode}\` / \`${profile.density}\`)`,
    `- **Provenance:** \`${profile.provenance.sourceLabel}\` (\`${profile.provenance.sourceKind}\`, copyRightsGranted=\`${String(profile.provenance.copyRightsGranted)}\`)`,
    `- **Content SHA-256:** \`${profile.contentSha256}\``,
    '',
    '## Palette',
    '',
    `| Role | Hex |`,
    `| --- | --- |`,
    `| background / foreground | \`${profile.palette.background}\` / \`${profile.palette.foreground}\` |`,
    `| surface / surfaceForeground | \`${profile.palette.surface}\` / \`${profile.palette.surfaceForeground}\` |`,
    `| primary / primaryForeground | \`${profile.palette.primary}\` / \`${profile.palette.primaryForeground}\` |`,
    `| muted / mutedForeground | \`${profile.palette.muted}\` / \`${profile.palette.mutedForeground}\` |`,
    `| border | \`${profile.palette.border}\` |`,
    `| error / onError | \`${profile.palette.error}\` / \`${profile.palette.onError}\` |`,
    `| success / onSuccess | \`${profile.palette.success}\` / \`${profile.palette.onSuccess}\` |`,
    '',
    '## Typography & Motion',
    '',
    `- **Display:** ${profile.typography.fontDisplay}`,
    `- **Sans:** ${profile.typography.fontSans}`,
    `- **Mono:** ${profile.typography.fontMono}`,
    `- **Motion:** policy=\`${profile.motion.policy}\`, respectReducedMotion=\`${String(profile.motion.respectReducedMotion)}\` (${profile.motion.durationFastMs}ms / ${profile.motion.durationBaseMs}ms / ${profile.motion.durationSlowMs}ms)`,
  ];

  if (audit) {
    lines.push(
      '',
      '## Compliance Audit',
      '',
      `- **Passed:** \`${String(audit.passed)}\` (advisoryOnly=\`true\`, findings=\`${audit.findings.length}\`, driftedTokens=\`${audit.driftedTokens.length}\`)`,
      `- **Report SHA-256:** \`${audit.reportSha256}\``
    );
  }

  return lines.join('\n');
}
