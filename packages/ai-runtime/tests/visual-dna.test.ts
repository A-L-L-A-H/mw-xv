import { describe, expect, it } from 'vitest';
import {
  auditDesignProfileCompliance,
  computeContrastRatio,
  extractDesignProfileFromTokens,
  formatDesignProfileBrief,
  parseCssCustomProperties,
  validateDesignProfile,
} from '../src/visual-dna.js';

describe('visual-dna (M13.11)', () => {
  it('parses CSS custom properties and resolves var() references deterministically', () => {
    const css = `
      :root {
        --mw-paper: #f3efe4;
        --mw-ink: #0d0d0d;
        --mw-background: var(--mw-paper);
        --mw-foreground: var(--mw-ink);
        --mw-primary: #ffe031;
        --mw-primary-foreground: var(--mw-ink);
      }
    `;
    const parsed = parseCssCustomProperties(css);
    expect(parsed['--mw-background']).toBe('#f3efe4');
    expect(parsed['--mw-foreground']).toBe('#0d0d0d');
    expect(parsed['--mw-primary-foreground']).toBe('#0d0d0d');
  });

  it('extracts a deterministic DesignProfile with stable contentSha256 and passes WCAG AA compliance', () => {
    const css = `
      :root {
        --mw-background: #f3efe4;
        --mw-foreground: #0d0d0d;
        --mw-surface: #fffdf6;
        --mw-surface-foreground: #0d0d0d;
        --mw-primary: #ffe031;
        --mw-primary-foreground: #0d0d0d;
        --mw-muted: #e7e2d4;
        --mw-muted-foreground: #3a3a36;
        --mw-border: #0d0d0d;
        --mw-error: #b42318;
        --mw-on-error: #fffdf6;
        --mw-success: #166534;
        --mw-on-success: #fffdf6;
      }
    `;
    const profileA = extractDesignProfileFromTokens({
      profileId: 'mw-ink-light',
      name: 'MoonWitness Ink Light',
      skinId: 'moonwitness-ink',
      colorMode: 'light',
      density: 'comfortable',
      cssText: css,
    });
    const profileB = extractDesignProfileFromTokens({
      profileId: 'mw-ink-light',
      name: 'MoonWitness Ink Light',
      skinId: 'moonwitness-ink',
      colorMode: 'light',
      density: 'comfortable',
      cssText: css,
    });

    expect(profileA.contentSha256).toBe(profileB.contentSha256);
    expect(profileA.contentSha256).toMatch(/^[a-f0-9]{64}$/u);

    const validation = validateDesignProfile(profileA);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toHaveLength(0);

    const audit = auditDesignProfileCompliance(profileA);
    expect(audit.passed).toBe(true);
    expect(audit.advisoryOnly).toBe(true);
    expect(audit.contrastChecks.every((c) => c.passed)).toBe(true);

    const brief = formatDesignProfileBrief(profileA, audit);
    expect(brief).toContain('# Visual DNA Brief: MoonWitness Ink Light');
    expect(brief).toContain(profileA.contentSha256);
    expect(brief).toContain(audit.reportSha256);
  });

  it('detects low contrast, reduced-motion noncompliance, and token drift against baseline', () => {
    const baseline = extractDesignProfileFromTokens({
      profileId: 'baseline-ink',
      name: 'Baseline Ink',
    });

    const drifted = extractDesignProfileFromTokens({
      profileId: 'drifted-low-contrast',
      name: 'Drifted Low Contrast',
      respectReducedMotion: false,
      tokenOverrides: {
        '--mw-background': '#ffffff',
        '--mw-foreground': '#cccccc',
      },
      provenance: {
        sourceKind: 'external_reference',
        sourceLabel: 'external-site-ref',
        copyRightsGranted: true,
      },
    });

    // External references are forced to copyRightsGranted=false during extraction
    expect(drifted.provenance.copyRightsGranted).toBe(false);

    const contrast = computeContrastRatio('#cccccc', '#ffffff');
    expect(contrast).not.toBeNull();
    expect(contrast!).toBeLessThan(4.5);

    const audit = auditDesignProfileCompliance(drifted, baseline);
    expect(audit.passed).toBe(false);
    expect(audit.findings.some((f) => f.code === 'CONTRAST_BELOW_THRESHOLD')).toBe(true);
    expect(audit.findings.some((f) => f.code === 'REDUCED_MOTION_NOT_RESPECTED')).toBe(true);
    expect(audit.findings.some((f) => f.code === 'THEME_TOKEN_DRIFT_DETECTED')).toBe(true);
    expect(audit.driftedTokens.some((d) => d.tokenKey === 'palette.foreground')).toBe(true);
  });

  it('rejects tampered contentSha256 and invalid hex colors in validateDesignProfile', () => {
    const profile = extractDesignProfileFromTokens({
      profileId: 'tamper-test',
      name: 'Tamper Test',
    });
    const tampered = {
      ...profile,
      palette: {
        ...profile.palette,
        background: 'not-a-hex',
      },
    };
    const result = validateDesignProfile(tampered);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INVALID_PALETTE_HEX')).toBe(true);
    expect(result.issues.some((i) => i.code === 'CONTENT_HASH_MISMATCH')).toBe(true);
  });
});
