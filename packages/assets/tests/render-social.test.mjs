import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  SOCIAL_THEMES,
  listSocialFormats,
} from '../scripts/social-formats.config.mjs';
import {
  DEFAULT_TEMPLATE_VARS,
  buildSocialTemplateSvg,
  getTemplateVirtualPath,
  injectTemplateVars,
} from '../scripts/social-templates.mjs';
import { validateSvg } from '../scripts/validate.mjs';
import {
  buildEmbeddedFontCss,
  formatSocialFormatsList,
  getSocialOutputFilename,
  parseSocialRenderArgs,
} from '../scripts/render-social.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const renderSocialScriptPath = resolve(packageRoot, 'scripts/render-social.mjs');

describe('parseSocialRenderArgs', () => {
  it('enters legacy mode when invoked with no arguments', () => {
    const parsed = parseSocialRenderArgs([]);
    assert.equal(parsed.mode, 'legacy');
    assert.equal(parsed.legacy, true);
    assert.equal(parsed.list, false);
    assert.equal(parsed.help, false);
    assert.deepEqual(parsed.formats, []);
    assert.equal(parsed.theme, 'both');
    assert.deepEqual(parsed.themes, ['light', 'dark']);
    assert.equal(parsed.outDir, resolve(packageRoot, 'brand/rendered'));
    assert.deepEqual(parsed.vars, {});
  });

  it('parses --list and --help modes cleanly', () => {
    const listed = parseSocialRenderArgs(['--list']);
    assert.equal(listed.mode, 'list');
    assert.equal(listed.legacy, false);
    assert.equal(listed.list, true);

    const helped = parseSocialRenderArgs(['--help']);
    assert.equal(helped.mode, 'help');
    assert.equal(helped.help, true);

    const shortHelped = parseSocialRenderArgs(['-h']);
    assert.equal(shortHelped.mode, 'help');
    assert.equal(shortHelped.help, true);
  });

  it('parses single, comma-separated, repeated, and "all" --format values', () => {
    const single = parseSocialRenderArgs(['--format', 'og']);
    assert.equal(single.mode, 'render');
    assert.equal(single.legacy, false);
    assert.deepEqual(single.formats, ['og']);
    assert.equal(single.theme, 'both');
    assert.deepEqual(single.themes, ['light', 'dark']);

    const combined = parseSocialRenderArgs([
      '--format',
      'og,github',
      '--format=youtube-thumbnail',
    ]);
    assert.deepEqual(combined.formats, ['og', 'github', 'youtube-thumbnail']);

    const all = parseSocialRenderArgs(['--format', 'all']);
    assert.equal(all.formats.length, 16);
    assert.deepEqual(
      all.formats,
      listSocialFormats().map(({ id }) => id)
    );
  });

  it('parses --theme and --dark shorthand options', () => {
    const light = parseSocialRenderArgs(['--format', 'og', '--theme', 'light']);
    assert.equal(light.theme, 'light');
    assert.deepEqual(light.themes, ['light']);

    const dark = parseSocialRenderArgs(['--format', 'og', '--theme=dark']);
    assert.equal(dark.theme, 'dark');
    assert.deepEqual(dark.themes, ['dark']);

    const darkFlag = parseSocialRenderArgs(['--format', 'og', '--dark']);
    assert.equal(darkFlag.theme, 'dark');
    assert.deepEqual(darkFlag.themes, ['dark']);

    const both = parseSocialRenderArgs(['--format', 'og', '--dark', '--theme', 'both']);
    assert.equal(both.theme, 'both');
    assert.deepEqual(both.themes, ['light', 'dark']);

    const darkWithoutFormat = parseSocialRenderArgs(['--dark']);
    assert.equal(darkWithoutFormat.legacy, false);
    assert.equal(darkWithoutFormat.mode, 'render');
    assert.equal(darkWithoutFormat.formats.length, 16);
    assert.deepEqual(darkWithoutFormat.themes, ['dark']);
  });

  it('parses template variable flags and --out-dir', () => {
    const fakeCwd = resolve(packageRoot, 'custom-cwd');
    const parsed = parseSocialRenderArgs(
      [
        '--format',
        'youtube-thumbnail,github',
        '--theme',
        'dark',
        '--title',
        'AGENT SWARM LIVE',
        '--subtitle=Real-time build telemetry & audit trails.',
        '--episode',
        'EP.12',
        '--ep',
        '12',
        '--lang',
        'id',
        '--skin',
        'riot',
        '--out-dir',
        'artifacts/social',
      ],
      { cwd: fakeCwd }
    );

    assert.deepEqual(parsed.formats, ['youtube-thumbnail', 'github']);
    assert.deepEqual(parsed.themes, ['dark']);
    assert.equal(parsed.lang, 'id');
    assert.equal(parsed.outDir, resolve(fakeCwd, 'artifacts/social'));
    assert.deepEqual(parsed.vars, {
      TITLE: 'AGENT SWARM LIVE',
      SUBTITLE: 'Real-time build telemetry & audit trails.',
      EPISODE: 'EP.12',
      EP: '12',
      LANG: 'ID',
      SKIN: 'riot',
    });
  });

  it('rejects unknown flags, missing values, and invalid formats/themes/langs', () => {
    assert.throws(() => parseSocialRenderArgs(['--bogus']), /Unknown argument/u);
    assert.throws(() => parseSocialRenderArgs(['og']), /Unknown argument/u);
    assert.throws(() => parseSocialRenderArgs(['--format']), /Missing value for --format/u);
    assert.throws(() => parseSocialRenderArgs(['--theme']), /Missing value for --theme/u);
    assert.throws(() => parseSocialRenderArgs(['--title']), /Missing value for --title/u);
    assert.throws(() => parseSocialRenderArgs(['--subtitle']), /Missing value for --subtitle/u);
    assert.throws(() => parseSocialRenderArgs(['--episode']), /Missing value for --episode/u);
    assert.throws(() => parseSocialRenderArgs(['--ep']), /Missing value for --ep/u);
    assert.throws(() => parseSocialRenderArgs(['--lang']), /Missing value for --lang/u);
    assert.throws(() => parseSocialRenderArgs(['--skin']), /Missing value for --skin/u);
    assert.throws(() => parseSocialRenderArgs(['--out-dir']), /Missing value for --out-dir/u);
    assert.throws(() => parseSocialRenderArgs(['--format=']), /requires a non-empty/u);
    assert.throws(() => parseSocialRenderArgs(['--skin=  ']), /requires a non-empty/u);
    assert.throws(() => parseSocialRenderArgs(['--out-dir=  ']), /requires a non-empty/u);
    assert.throws(() => parseSocialRenderArgs(['--format', 'myspace']), /Unknown social format/u);
    assert.throws(() => parseSocialRenderArgs(['--format', 'og,nope']), /Unknown social format/u);
    assert.throws(() => parseSocialRenderArgs(['--format', 'og', '--theme', 'sepia']), /Unsupported theme/u);
    assert.throws(() => parseSocialRenderArgs(['--format', 'og', '--lang', 'fr']), /Unsupported language/u);
  });
});

describe('injectTemplateVars', () => {
  const sampleTemplate = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<text>{{TITLE}}|{{EPISODE_TITLE}}|{{SUBTITLE}}|{{EP}}|{{EPISODE}}|{{LANG}}|{{SKIN}}|{{UNTOUCHED}}</text>',
    '</svg>',
  ].join('');

  it('applies default values and strips leading EP. prefix when needed', () => {
    const renderedLight = injectTemplateVars(sampleTemplate);
    assert.ok(renderedLight.includes(DEFAULT_TEMPLATE_VARS.TITLE));
    assert.ok(renderedLight.includes(DEFAULT_TEMPLATE_VARS.SUBTITLE));
    assert.ok(renderedLight.includes('|01|EP.01|EN|light|{{UNTOUCHED}}'));

    const renderedDark = injectTemplateVars(sampleTemplate, { TITLE: 'CUSTOM', EP: 'EP. 09', LANG: 'ID' }, { theme: 'dark' });
    assert.ok(renderedDark.includes('<text>CUSTOM|CUSTOM|'));
    assert.ok(renderedDark.includes('|09|EP.09|ID|dark|'));

    const renderedFromEp = injectTemplateVars(sampleTemplate, { EP: '05' }, { theme: 'light' });
    assert.ok(renderedFromEp.includes('|05|EP.05|EN|light|'));

    const renderedFromEpisode = injectTemplateVars(sampleTemplate, { EPISODE: 'EP.14' });
    assert.ok(renderedFromEpisode.includes('|14|EP.14|'));
  });

  it('escapes XML special characters in variable values', () => {
    const rendered = injectTemplateVars(sampleTemplate, {
      TITLE: 'Ops & <AI> "Live" \'Now\'',
      EPISODE_TITLE: 'A & B',
      SUBTITLE: '1 < 2 & 3 > 1',
    });
    assert.ok(rendered.includes('Ops &amp; &lt;AI&gt; &quot;Live&quot; &apos;Now&apos;|A &amp; B|1 &lt; 2 &amp; 3 &gt; 1|'));
  });

  it('supports preservePlaceholders option without substituting variables', () => {
    const preservedByOption = injectTemplateVars(
      sampleTemplate,
      { TITLE: 'Ignored' },
      { preservePlaceholders: true }
    );
    assert.equal(preservedByOption, sampleTemplate);

    const preservedByVar = injectTemplateVars(sampleTemplate, {
      TITLE: 'Ignored',
      preservePlaceholders: true,
    });
    assert.equal(preservedByVar, sampleTemplate);
  });
});

describe('buildSocialTemplateSvg', () => {
  it('generates valid SVG passing validateSvg with matching dimensions for all 16 formats x 2 themes', () => {
    const formats = listSocialFormats();
    assert.equal(formats.length, 16);

    for (const spec of formats) {
      for (const theme of SOCIAL_THEMES) {
        const virtualPath = getTemplateVirtualPath(spec.id, theme);
        const svg = buildSocialTemplateSvg(spec, {
          theme,
          vars: {
            TITLE: 'BUILD & SHIP <FAST>',
            SUBTITLE: 'Composable "MoonWitness" social pipeline',
            EP: '03',
            LANG: 'ID',
          },
        });
        const validated = validateSvg(svg, virtualPath);
        assert.equal(validated.viewBox, `0 0 ${spec.width} ${spec.height}`, `${spec.id} ${theme} viewBox`);
        assert.equal(Number(validated.width), spec.width, `${spec.id} ${theme} width`);
        assert.equal(Number(validated.height), spec.height, `${spec.id} ${theme} height`);
        assert.doesNotMatch(svg, /\{\{(?:TITLE|SUBTITLE|EP|EPISODE|LANG|SKIN)\}\}/u);
      }
    }
  });

  it('preserves placeholders when preservePlaceholders is true and still passes validateSvg', () => {
    const svg = buildSocialTemplateSvg('github', { theme: 'dark', preservePlaceholders: true });
    const validated = validateSvg(svg, getTemplateVirtualPath('github', 'dark'));
    assert.equal(validated.viewBox, '0 0 1280 640');
    assert.match(svg, /\{\{TITLE\}\}/u);
    assert.match(svg, /\{\{EPISODE\}\}/u);
    assert.match(svg, /\{\{SUBTITLE\}\}/u);
  });
});

describe('buildEmbeddedFontCss', () => {
  it('embeds local WOFF2 files as base64 @font-face rules for Anton, Space Grotesk, and JetBrains Mono', async () => {
    const css = await buildEmbeddedFontCss(packageRoot);
    assert.ok(css.length > 0);
    assert.match(css, /font-family:\s*'Anton'/u);
    assert.match(css, /font-family:\s*'Space Grotesk'/u);
    assert.match(css, /font-family:\s*'JetBrains Mono'/u);
    assert.match(css, /data:font\/woff2;base64,[A-Za-z0-9+/=]+/u);
    assert.doesNotMatch(css, /https?:\/\//iu);

    const base64Match = css.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/u);
    assert.ok(base64Match, 'contains base64 font payload');
    const decoded = Buffer.from(base64Match[1], 'base64');
    assert.equal(decoded.subarray(0, 4).toString('ascii'), 'wOF2');
  });

  it('gracefully handles missing font files and missing fonts directory without throwing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mw-fonts-test-'));
    try {
      const emptyCss = await buildEmbeddedFontCss(tempDir);
      assert.equal(emptyCss, '');

      await mkdir(join(tempDir, 'fonts'), { recursive: true });
      const fakeWoff2 = Buffer.from('wOF2testfontpayload');
      await writeFile(join(tempDir, 'fonts/Anton-latin.woff2'), fakeWoff2);

      const partialCss = await buildEmbeddedFontCss(tempDir);
      assert.match(partialCss, /font-family:\s*'Anton'/u);
      assert.ok(partialCss.includes(`data:font/woff2;base64,${fakeWoff2.toString('base64')}`));
      assert.doesNotMatch(partialCss, /Space Grotesk/u);
      assert.doesNotMatch(partialCss, /JetBrains Mono/u);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('CLI --list and output naming helpers', () => {
  it('formats output filenames matching social-card convention', () => {
    assert.equal(getSocialOutputFilename('og', 'light'), 'og.png');
    assert.equal(getSocialOutputFilename('og', 'dark'), 'og.dark.png');
    assert.equal(getSocialOutputFilename('youtube-thumbnail', 'dark'), 'youtube-thumbnail.dark.png');
    assert.throws(() => getSocialOutputFilename('og', 'sepia'), /Unsupported social theme/u);
  });

  it('prints supported formats and dimensions with --list and exits 0 without launching Chromium', async () => {
    const { stdout } = await execFileAsync(process.execPath, [renderSocialScriptPath, '--list']);
    assert.equal(stdout.trim(), formatSocialFormatsList().trim());
    for (const spec of listSocialFormats()) {
      assert.ok(stdout.includes(spec.id), `lists format ${spec.id}`);
      assert.ok(stdout.includes(`${spec.width}x${spec.height}`), `lists dimensions for ${spec.id}`);
    }
  });
});
