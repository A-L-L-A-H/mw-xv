import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const defaultOutputDir = resolve(repositoryRoot, 'docs/design/assets');

const VISUAL_FORMATS = new Set(['svg', 'png', 'webp', 'avif', 'jpg', 'jpeg']);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function inferContactSheetGroup(asset) {
  const normalized = asset.path.replaceAll('\\', '/');
  if (asset.pack && typeof asset.pack === 'string') return asset.pack;
  if (normalized.startsWith('animation/')) {
    const parts = normalized.split('/');
    return `animation:${parts[1] ?? 'default'}`;
  }
  if (normalized.startsWith('environments/')) return 'environments';
  if (normalized.startsWith('source/world/characters/')) return 'world-characters';
  if (normalized.startsWith('source/world/environments/')) return 'world-environments';
  if (normalized.startsWith('source/artwork/')) return 'source-artwork';
  if (normalized.startsWith('brand/')) return 'brand';
  if (normalized.startsWith('icons/')) return 'icons';
  if (normalized.startsWith('materials/')) return 'materials';
  if (normalized.startsWith('illustrations/')) {
    return asset.kind === 'artwork' ? 'artwork' : 'illustrations';
  }
  return asset.category || asset.kind || 'misc';
}

export function buildContactSheetGroups(manifest) {
  const grouped = new Map();
  for (const asset of manifest.assets) {
    if (!VISUAL_FORMATS.has(asset.format)) continue;
    const groupKey = inferContactSheetGroup(asset);
    const list = grouped.get(groupKey) ?? [];
    list.push({
      id: asset.id ?? asset.path,
      path: asset.path,
      kind: asset.kind,
      category: asset.category ?? asset.kind,
      pack: asset.pack ?? groupKey,
      variant: asset.variant ?? 'default',
      format: asset.format,
      width: asset.width ?? null,
      height: asset.height ?? null,
      status: asset.status ?? 'approved',
    });
    grouped.set(groupKey, list);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, items]) => ({
      name,
      slug: name.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase(),
      count: items.length,
      items: [...items].sort((left, right) => left.id.localeCompare(right.id)),
    }));
}

export async function toInlineDataUrl(assetPath, format, rootDir = packageRoot) {
  const raw = await readFile(resolve(rootDir, assetPath));
  if (format === 'svg') {
    const svg = raw.toString('utf8').replaceAll('currentColor', '#f3efe4');
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  const mime =
    format === 'png'
      ? 'image/png'
      : format === 'webp'
        ? 'image/webp'
        : format === 'avif'
          ? 'image/avif'
          : 'image/jpeg';
  return `data:${mime};base64,${raw.toString('base64')}`;
}

export function buildContactSheetHtml(group, previews) {
  const cards = previews
    .map(
      ({ item, dataUrl }) => `<article data-asset-id="${escapeHtml(item.id)}">
        <div class="meta">
          <h2>${escapeHtml(item.id)}</h2>
          <span>${escapeHtml(item.variant)} · ${escapeHtml(item.format)}${item.width && item.height ? ` · ${item.width}x${item.height}` : ''}</span>
        </div>
        <div class="stage"><img src="${dataUrl}" alt="${escapeHtml(item.id)}"></div>
      </article>`
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:#121318;color:#f3efe4;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
    header{margin:0 0 18px;border-bottom:2px solid #ffe031;padding-bottom:10px}
    h1{margin:0 0 4px;font-size:20px;color:#ffe031}
    p{margin:0;color:#b8b4aa}
    main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    article{border:2px solid #2c2f3a;background:#191b22;padding:10px;display:flex;flex-direction:column;gap:8px}
    .meta h2{margin:0 0 2px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .meta span{font-size:10px;color:#a9a49a}
    .stage{height:160px;display:grid;place-items:center;padding:8px;background:repeating-conic-gradient(#232631 0% 25%,#1b1d26 0% 50%) 50%/16px 16px;border:1px solid #2c2f3a}
    .stage img{max-width:100%;max-height:142px;object-fit:contain;display:block}
  </style></head><body>
    <header>
      <h1>MoonWitness Contact Sheet — ${escapeHtml(group.name)}</h1>
      <p>${group.count} visual asset(s) · stable IDs, variants, and dimensions</p>
    </header>
    <main>${cards}</main>
  </body></html>`;
}

export async function generateContactSheets({
  rootDir = packageRoot,
  outputDir = defaultOutputDir,
  renderPng = true,
  renderGroups = ['moon-city', 'world-characters', 'animation', 'environments'],
} = {}) {
  const manifest = JSON.parse(await readFile(resolve(rootDir, 'manifest.json'), 'utf8'));
  const groups = buildContactSheetGroups(manifest);
  await mkdir(outputDir, { recursive: true });

  const sheetOutputs = [];
  const targetGroups = groups.filter((group) =>
    renderGroups.some((prefix) => group.name === prefix || group.name.startsWith(`${prefix}:`))
  );

  if (renderPng && targetGroups.length > 0) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      for (const group of targetGroups) {
        const previews = await Promise.all(
          group.items.map(async (item) => ({
            item,
            dataUrl: await toInlineDataUrl(item.path, item.format, rootDir),
          }))
        );
        const html = buildContactSheetHtml(group, previews);
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
          deviceScaleFactor: 1,
        });
        await page.setContent(html);
        await page
          .locator('main img')
          .evaluateAll((images) => Promise.all(images.map((image) => image.decode().catch(() => {}))));
        const states = await page.locator('main img').evaluateAll((images) =>
          images.map((image) => ({
            loaded: image.complete && image.naturalWidth > 0,
            alt: image.alt,
          }))
        );
        if (states.some((state) => !state.loaded)) {
          throw new Error(`Contact sheet ${group.name} has unloaded assets: ${JSON.stringify(states)}`);
        }
        const fileName = `pack-${group.slug}-contact-sheet.png`;
        const outPath = resolve(outputDir, fileName);
        await page.screenshot({ path: outPath, fullPage: true, animations: 'disabled' });
        await page.close();
        const metadata = await sharp(outPath).metadata();
        sheetOutputs.push({
          group: group.name,
          file: `docs/design/assets/${fileName}`,
          width: metadata.width,
          height: metadata.height,
          itemCount: group.count,
        });
      }
    } finally {
      await browser.close();
    }
  }

  const index = {
    schemaVersion: 1,
    totalGroups: groups.length,
    totalVisualAssets: groups.reduce((sum, group) => sum + group.count, 0),
    renderedSheets: sheetOutputs,
    groups,
  };
  const indexPath = resolve(outputDir, 'contact-sheets-index.json');
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { index, indexPath, sheetOutputs };
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const renderPng = !argv.includes('--index-only');
  const { index, indexPath, sheetOutputs } = await generateContactSheets({ renderPng });
  stdout.write(
    `Generated contact-sheet index (${index.totalGroups} groups, ${index.totalVisualAssets} visual assets, ${sheetOutputs.length} rendered PNG sheet(s)) at ${indexPath}.\n`
  );
}
