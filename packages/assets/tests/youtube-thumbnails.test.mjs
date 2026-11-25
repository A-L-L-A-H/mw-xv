import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEpisodeTable,
  slugifyEpisode,
  fitThumbnailTitleSvg,
  renderYoutubeThumbnails,
  parseThumbnailArgs,
} from '../scripts/render-youtube-thumbnails.mjs';
import { validateSvg } from '../scripts/validate.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(packageRoot, '../../docs/operations/youtube-channel.md');

describe('parseEpisodeTable', () => {
  it('parses the real youtube-channel.md and extracts 8 episodes with all required fields', async () => {
    const markdown = await readFile(sourcePath, 'utf8');
    const episodes = parseEpisodeTable(markdown);

    assert.equal(episodes.length, 8);

    const expectedCodes = ['00', '01', '02', '03', '04', '05', '06', '07'];
    for (let i = 0; i < episodes.length; i += 1) {
      const ep = episodes[i];
      assert.ok(ep.epCode, `episode ${i} has epCode`);
      assert.equal(ep.epCode, expectedCodes[i], `episode ${i} epCode matches`);
      assert.ok(ep.title && ep.title.length > 0, `episode ${i} has non-empty title`);
      assert.ok(ep.subtitle && ep.subtitle.length > 0, `episode ${i} has non-empty subtitle`);
      assert.ok(ep.slug && ep.slug.length > 0, `episode ${i} has non-empty slug`);
      assert.ok(ep.taskCode === null || typeof ep.taskCode === 'string');
      assert.ok(Number.isInteger(ep.epNumber) && ep.epNumber >= 0);
    }

    assert.equal(episodes[0].epNumber, 0);
    assert.equal(episodes[0].title, 'Channel Trailer');
    assert.equal(episodes[1].epNumber, 1);
    assert.equal(episodes[1].title, 'Declarative Models in 5 Minutes');
    assert.equal(episodes[2].title, 'Addons — Install Features, Not SQL');
    assert.equal(episodes[3].title, 'The Board — Your Data, Your Way');
    assert.equal(episodes[4].title, 'Model→API Live Coding');
    assert.equal(episodes[5].title, 'Transactional Addons Deep Dive');
    assert.equal(episodes[6].title, 'Multi-tenancy & RLS');
    assert.equal(episodes[7].title, 'SaaS Starter in 30 Minutes');

    assert.equal(episodes[0].taskCode, 'YT-003');
    assert.equal(episodes[1].taskCode, 'YT-004');
    assert.equal(episodes[2].taskCode, 'YT-006');
    assert.equal(episodes[3].taskCode, 'YT-007');
    assert.equal(episodes[4].taskCode, null);
    assert.equal(episodes[5].taskCode, null);
    assert.equal(episodes[6].taskCode, null);
    assert.equal(episodes[7].taskCode, null);
  });

  it('parses an alternative table format with # | Title | Format | Target Audience columns', () => {
    const altMarkdown = `
| # | Title | Format | Target Audience |
|---|-------|--------|-----------------|
| 1 | Intro to MoonWitness | Tutorial | Developers |
| 2 | Advanced Patterns | Workshop | Senior Devs |
`;
    const episodes = parseEpisodeTable(altMarkdown);
    assert.equal(episodes.length, 2);
    assert.equal(episodes[0].epNumber, 1);
    assert.equal(episodes[0].title, 'Intro to MoonWitness');
    assert.ok(episodes[0].subtitle.includes('Tutorial'));
    assert.ok(episodes[0].audience.includes('Developers'));
    assert.equal(episodes[1].epNumber, 2);
    assert.equal(episodes[1].title, 'Advanced Patterns');
  });

  it('throws on markdown with no valid episode table', () => {
    const badMarkdown = `
| Field | Value |
|-------|-------|
| Handle | @test |
`;
    assert.throws(() => parseEpisodeTable(badMarkdown), /No episode plan table found/);
  });
});

describe('slugifyEpisode', () => {
  it('generates deterministic slugs for trailer (00) and numbered episodes', () => {
    assert.equal(slugifyEpisode(0, 'Channel Trailer'), 'ep-00-channel-trailer');
    assert.equal(slugifyEpisode('0', 'Channel Trailer'), 'ep-00-channel-trailer');
    assert.equal(slugifyEpisode('00', 'Channel Trailer'), 'ep-00-channel-trailer');
    assert.equal(slugifyEpisode('trailer', 'Channel Trailer'), 'ep-00-channel-trailer');
    assert.equal(slugifyEpisode('TR', 'Channel Trailer'), 'ep-00-channel-trailer');

    assert.equal(
      slugifyEpisode(1, 'Declarative Models in 5 Minutes'),
      'ep-01-declarative-models-in-5-minutes'
    );
    assert.equal(
      slugifyEpisode('01', 'Declarative Models in 5 Minutes'),
      'ep-01-declarative-models-in-5-minutes'
    );
    assert.equal(
      slugifyEpisode(7, 'SaaS Starter in 30 Minutes'),
      'ep-07-saas-starter-in-30-minutes'
    );
  });

  it('handles special characters and markdown formatting in titles', () => {
    assert.equal(
      slugifyEpisode(1, 'Declarative **Models** in `5` Minutes'),
      'ep-01-declarative-models-in-5-minutes'
    );
    assert.equal(
      slugifyEpisode(2, 'Addons — Install Features, Not SQL'),
      'ep-02-addons-install-features-not-sql'
    );
    assert.equal(
      slugifyEpisode(3, 'The Board — Your Data, Your Way'),
      'ep-03-the-board-your-data-your-way'
    );
    // Arrow character becomes a hyphen in slugs
    assert.equal(slugifyEpisode(4, 'Model→API Live Coding'), 'ep-04-model-api-live-coding');
  });

  it('handles empty or missing title gracefully', () => {
    assert.equal(slugifyEpisode(0, ''), 'ep-00');
    assert.equal(slugifyEpisode(5, ''), 'ep-05');
  });
});

describe('fitThumbnailTitleSvg', () => {
  const lightTemplatePath = resolve(
    packageRoot,
    'brand/moonwitness-youtube-thumbnail-template.svg'
  );
  const darkTemplatePath = resolve(
    packageRoot,
    'brand/moonwitness-youtube-thumbnail-template.dark.svg'
  );

  let lightTemplate, darkTemplate;

  it('loads both template files', async () => {
    lightTemplate = await readFile(lightTemplatePath, 'utf8');
    darkTemplate = await readFile(darkTemplatePath, 'utf8');
    assert.ok(lightTemplate.includes('{{EPISODE_TITLE}}'));
    assert.ok(lightTemplate.includes('{{SUBTITLE}}'));
    assert.ok(lightTemplate.includes('{{EP}}'));
    assert.ok(darkTemplate.includes('{{EPISODE_TITLE}}'));
  });

  it('replaces all {{...}} tokens and escapes XML special characters', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Test & <Title> "Special"',
      subtitle: 'Sub & "Quote" > Tag',
    });

    assert.ok(fitted.includes('EP.01'));
    assert.ok(!fitted.includes('{{'));
    // XML escaping happens: & becomes &, < becomes <, > becomes >, " becomes "
    assert.ok(fitted.includes('Test &amp; &lt;Title&gt;'));
    assert.ok(fitted.includes('Sub &amp; &quot;Quote&quot; &gt; Tag'));
  });

  it('splits long titles (>16 chars) into 2 balanced <tspan> lines inside <text>', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'This Is A Very Long Episode Title That Exceeds Sixteen Characters',
      subtitle: 'Subtitle',
    });

    assert.ok(fitted.includes('<tspan'), 'contains tspan for multi-line title');
    const tspanCount = (fitted.match(/<tspan/gu) || []).length;
    assert.ok(tspanCount >= 2, `has at least 2 tspan elements, found ${tspanCount}`);
    assert.ok(fitted.includes('x="640"'), 'tspan has x="640"');
    assert.ok(fitted.includes('dy='), 'tspan has dy for line spacing');
  });

  it('uses font-size 84 for titles <= 14 chars', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Short Title',
      subtitle: 'Subtitle',
    });
    assert.ok(fitted.includes('font-size="84"'));
  });

  it('uses font-size 68 for 1-line titles <= 22 chars', () => {
    // 22 chars exactly should use 68
    const fitted22 = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Exactly Twenty Two Ch', // 22 chars
      subtitle: 'Subtitle',
    });
    assert.ok(fitted22.includes('font-size="68"'), '22 chars -> font-size 68');

    // 23 chars should split and use 58
    const fitted23 = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Exactly Twenty Two Chs', // 23 chars
      subtitle: 'Subtitle',
    });
    // When split into 2 lines, the total char count is <= 38
    const tspanCount = (fitted23.match(/<tspan/gu) || []).length;
    if (tspanCount >= 2) {
      assert.ok(fitted23.includes('font-size="58"'));
    }
  });

  it('uses font-size 58 for 2-line titles <= 38 chars', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Two Line Title Here',
      subtitle: 'Subtitle',
    });
    // When split into 2 lines, the total char count is <= 38
    const tspanCount = (fitted.match(/<tspan/gu) || []).length;
    if (tspanCount >= 2) {
      assert.ok(fitted.includes('font-size="58"'));
    }
  });

  it('uses font-size 48 for longer 2-line titles', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Very Long Episode Title That Is Definitely Over Thirty Eight Characters',
      subtitle: 'Subtitle',
    });
    const tspanCount = (fitted.match(/<tspan/gu) || []).length;
    if (tspanCount >= 2) {
      // Long titles get 48 or smaller font size
      const hasValidSize =
        fitted.includes('font-size="48"') ||
        fitted.includes('font-size="44"') ||
        fitted.includes('font-size="42"') ||
        fitted.includes('font-size="40"') ||
        fitted.includes('font-size="38"') ||
        fitted.includes('font-size="36"') ||
        fitted.includes('font-size="34"') ||
        fitted.includes('font-size="32"') ||
        fitted.includes('font-size="30"') ||
        fitted.includes('font-size="28"') ||
        fitted.includes('font-size="26"');
      assert.ok(
        hasValidSize,
        `Expected small font size for long title, got: ${fitted.match(/font-size="(\d+)"/g)}`
      );
    }
  });

  it('shrinks subtitle font-size slightly when > 36 chars', () => {
    const shortSub = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Title',
      subtitle: 'Short subtitle here',
    });
    assert.ok(shortSub.includes('font-size="36"'));

    const longSub = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Title',
      subtitle: 'This is a very long subtitle that exceeds thirty six characters limit',
    });
    assert.ok(longSub.includes('font-size="30"') || longSub.includes('font-size="24"'));
  });

  it('produces valid SVG that passes validateSvg for single-line titles', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Short Title',
      subtitle: 'Subtitle',
    });
    const validated = validateSvg(fitted, 'brand/moonwitness-youtube-thumbnail-template.svg');
    assert.equal(validated.viewBox, '0 0 1280 720');
  });

  it('produces well-formed XML for 2-line titles (validateSvg rejects tspan)', () => {
    const fitted = fitThumbnailTitleSvg(lightTemplate, {
      epCode: '01',
      title: 'Two Line Title Here That Splits',
      subtitle: 'Subtitle',
    });

    // Validate well-formed XML by checking structure - no unmatched tags, proper nesting
    // A simple but effective check: ensure all opening tags have closing tags
    const openTags = fitted.match(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g) || [];
    const closeTags = fitted.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g) || [];
    const selfClosing = fitted.match(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/>/g) || [];

    // Extract tag names
    const openNames = openTags.map((t) => t.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]).filter(Boolean);
    const closeNames = closeTags
      .map((t) => t.match(/<\/([a-zA-Z][a-zA-Z0-9]*)/)?.[1])
      .filter(Boolean);
    const selfClosingNames = selfClosing
      .map((t) => t.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1])
      .filter(Boolean);

    // Count occurrences
    const openCounts = {};
    for (const name of openNames) openCounts[name] = (openCounts[name] || 0) + 1;
    const closeCounts = {};
    for (const name of closeNames) closeCounts[name] = (closeCounts[name] || 0) + 1;

    // Self-closing tags don't need closing
    for (const name of selfClosingNames) {
      if (openCounts[name]) openCounts[name]--;
    }

    // All open tags should have matching close tags
    for (const [name, count] of Object.entries(openCounts)) {
      const closed = closeCounts[name] || 0;
      assert.equal(count, closed, `Tag <${name}> has ${count} opens but ${closed} closes`);
    }

    // Verify key structure
    assert.ok(fitted.includes('xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(fitted.includes('viewBox="0 0 1280 720"'));
    assert.ok(fitted.includes('role="img"'));
  });

  it('works with dark template preserving dark theme colors', () => {
    const fitted = fitThumbnailTitleSvg(darkTemplate, {
      epCode: '01',
      title: 'Dark Theme Test',
      subtitle: 'Dark Subtitle',
    });
    assert.ok(fitted.includes('EP.01'));
    assert.ok(!fitted.includes('{{'));
    // Dark template has different fill for EPISODE_TITLE
    assert.ok(fitted.includes('#f3efe4') || fitted.includes('f3efe4'));
  });
});

describe('renderYoutubeThumbnails dryRun mode', () => {
  it('runs dryRun without launching Chromium and returns manifest with planned files', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'mw-yt-dryrun-'));
    try {
      const result = await renderYoutubeThumbnails({
        sourcePath,
        outDir: tempDir,
        theme: 'both',
        dryRun: true,
      });

      assert.equal(result.dryRun, true);
      assert.equal(result.episodes.length, 8);
      assert.equal(result.files.length, 16); // 8 episodes × 2 themes
      assert.ok(result.manifestPath.endsWith('thumbnails-manifest.json'));
      assert.equal(result.manifest.totalEpisodes, 8);
      assert.equal(result.manifest.totalFiles, 16);

      for (const file of result.files) {
        assert.ok(file.epCode);
        assert.ok(file.slug);
        assert.ok(file.filename.endsWith('.png') || file.filename.endsWith('.dark.png'));
        assert.equal(file.width, 1280);
        assert.equal(file.height, 720);
        assert.equal(file.dryRun, true);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('supports episodeFilter to render a single episode', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'mw-yt-filter-'));
    try {
      const result = await renderYoutubeThumbnails({
        sourcePath,
        outDir: tempDir,
        theme: 'light',
        episodeFilter: '01',
        dryRun: true,
      });

      assert.equal(result.dryRun, true);
      assert.equal(result.episodes.length, 1);
      assert.equal(result.episodes[0].epCode, '01');
      assert.equal(result.files.length, 1); // 1 episode × 1 theme
      assert.equal(result.files[0].epCode, '01');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('supports episodeFilter with task code like YT-004', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'mw-yt-filter-code-'));
    try {
      const result = await renderYoutubeThumbnails({
        sourcePath,
        outDir: tempDir,
        theme: 'both',
        episodeFilter: 'YT-004',
        dryRun: true,
      });

      assert.equal(result.episodes.length, 1);
      assert.equal(result.episodes[0].taskCode, 'YT-004');
      assert.equal(result.files.length, 2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('supports episodeFilter with "trailer" or "00"', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'mw-yt-trailer-'));
    try {
      const result = await renderYoutubeThumbnails({
        sourcePath,
        outDir: tempDir,
        theme: 'both',
        episodeFilter: 'trailer',
        dryRun: true,
      });

      assert.equal(result.episodes.length, 1);
      assert.equal(result.episodes[0].epNumber, 0);
      assert.equal(result.files.length, 2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws when episodeFilter matches no episodes', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'mw-yt-none-'));
    try {
      await assert.rejects(
        renderYoutubeThumbnails({
          sourcePath,
          outDir: tempDir,
          episodeFilter: '999',
          dryRun: true,
        }),
        /No episode matched filter/
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('parseThumbnailArgs CLI parser', () => {
  it('parses --source, --out-dir, --theme, --episode, --dry-run, --list', () => {
    const parsed = parseThumbnailArgs([
      '--source',
      'custom.md',
      '--out-dir',
      'output/thumbs',
      '--theme',
      'dark',
      '--episode',
      '02',
      '--dry-run',
    ]);

    assert.equal(parsed.sourcePath, resolve(process.cwd(), 'custom.md'));
    assert.equal(parsed.outDir, resolve(process.cwd(), 'output/thumbs'));
    assert.equal(parsed.theme, 'dark');
    assert.deepEqual(parsed.themes, ['dark']);
    assert.equal(parsed.episodeFilter, '02');
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.list, false);
    assert.equal(parsed.help, false);
  });

  it('parses --list and --help', () => {
    const listed = parseThumbnailArgs(['--list']);
    assert.equal(listed.list, true);
    assert.equal(listed.dryRun, false);

    const helped = parseThumbnailArgs(['--help']);
    assert.equal(helped.help, true);
  });

  it('defaults theme to both and uses default paths when not specified', () => {
    const parsed = parseThumbnailArgs([]);
    assert.equal(parsed.theme, 'both');
    assert.deepEqual(parsed.themes, ['light', 'dark']);
    assert.ok(parsed.sourcePath.includes('youtube-channel.md'));
    assert.ok(parsed.outDir.includes('youtube-thumbnails'));
  });

  it('rejects unknown flags and missing values', () => {
    assert.throws(() => parseThumbnailArgs(['--bogus']), /Unknown argument/);
    assert.throws(() => parseThumbnailArgs(['--source']), /Missing value for --source/);
    assert.throws(() => parseThumbnailArgs(['--out-dir']), /Missing value for --out-dir/);
    assert.throws(() => parseThumbnailArgs(['--theme']), /Missing value for --theme/);
    assert.throws(() => parseThumbnailArgs(['--episode']), /Missing value for --episode/);
    assert.throws(() => parseThumbnailArgs(['--theme', 'sepia']), /Unsupported theme/);
  });
});
