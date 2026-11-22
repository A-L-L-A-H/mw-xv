import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { generateBrandFontBuffers } from '../scripts/generate-brand-font.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('MoonWitness Grunge proprietary brand font compiles deterministically with full glyph coverage', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
  const licenses = JSON.parse(await readFile(resolve(packageRoot, 'licenses.json'), 'utf8'));
  const fontsCss = await readFile(resolve(packageRoot, 'fonts.css'), 'utf8');

  assert.match(fontsCss, /font-family:\s*['"]MoonWitness Grunge['"]/u);
  assert.match(fontsCss, /url\(['"]\.\/fonts\/MoonWitnessGrunge-latin\.woff2['"]\)/u);

  const otfBytes = await readFile(
    resolve(packageRoot, 'source/fonts/MoonWitnessGrunge-Regular.otf')
  );
  const woff2Bytes = await readFile(resolve(packageRoot, 'fonts/MoonWitnessGrunge-latin.woff2'));
  assert.equal(woff2Bytes.toString('hex', 0, 4), '774f4632', 'WOFF2 magic header is valid');

  const otfSha = createHash('sha256').update(otfBytes).digest('hex').toUpperCase();
  const woff2Sha = createHash('sha256').update(woff2Bytes).digest('hex').toUpperCase();

  const woff2Entry = manifest.assets.find(
    ({ path }) => path === 'fonts/MoonWitnessGrunge-latin.woff2'
  );
  const sourceEntry = manifest.assets.find(
    ({ path }) => path === 'source/fonts/MoonWitnessGrunge-Regular.otf'
  );
  assert.ok(woff2Entry, 'WOFF2 is registered in manifest.json');
  assert.ok(sourceEntry, 'OTF source is registered in manifest.json');
  assert.equal(woff2Entry.sha256, woff2Sha);
  assert.equal(sourceEntry.sha256, otfSha);
  assert.equal(woff2Entry.license, 'ISC');

  const provenanceEntry = (licenses.originalFonts ?? []).find(
    ({ family }) => family === 'MoonWitness Grunge'
  );
  assert.ok(provenanceEntry, 'MoonWitness Grunge is documented in licenses.json originalFonts');
  assert.equal(provenanceEntry.license, 'ISC');
  assert.equal(provenanceEntry.files[0].sha256, woff2Sha);

  const font = opentype.parse(
    otfBytes.buffer.slice(otfBytes.byteOffset, otfBytes.byteOffset + otfBytes.byteLength)
  );
  assert.equal(font.getEnglishName('fontFamily'), 'MoonWitness Grunge');
  assert.ok(font.glyphs.length >= 150, `expected >= 150 glyphs, found ${font.glyphs.length}`);

  const requiredChars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,:;-+&/()\'"@#$%_*[]~ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ';
  for (const ch of requiredChars) {
    const glyph = font.charToGlyph(ch);
    assert.ok(glyph && glyph.index > 0, `character "${ch}" maps to a dedicated non-.notdef glyph`);
    assert.ok(glyph.advanceWidth > 0, `character "${ch}" has positive advanceWidth`);
    assert.ok(glyph.path.commands.length >= 4, `character "${ch}" has vector contour commands`);
  }

  const regenerated = await generateBrandFontBuffers();
  assert.equal(regenerated.otfSha256, otfSha, 'OTF generation is byte-for-byte deterministic');
  assert.equal(
    regenerated.woff2Sha256,
    woff2Sha,
    'WOFF2 generation is byte-for-byte deterministic'
  );
});
