import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
const licenses = JSON.parse(await readFile(resolve(packageRoot, 'licenses.json'), 'utf8'));
const ambienceIds = ['moon-city-night', 'underground-hum', 'archive-quiet', 'street-rain'];

test('scene ambience pack is original, provenance-complete, seamless, and inside the audio budget', async () => {
  for (const ambienceId of ambienceIds) {
    const path = `sounds/ambience-${ambienceId}.wav`;
    const asset = manifest.assets.find((entry) => entry.path === path);
    const provenance = licenses.soundEffects.find((entry) => entry.path === path);
    assert.ok(asset, `${path} is registered in the canonical manifest`);
    assert.ok(provenance, `${path} has a license/provenance entry`);
    assert.equal(asset.kind, 'sound');
    assert.equal(asset.variant, 'scene-ambience');
    assert.equal(asset.format, 'wav');
    assert.equal(asset.durationSeconds, 3);
    assert.equal(asset.license, 'ISC');
    assert.equal(asset.status, 'approved');
    assert.equal(asset.pack, 'moon-city');
    assert.equal(provenance.creator, 'MoonWitness contributors');
    assert.equal(provenance.license, 'ISC');
    assert.match(provenance.source, /generate-scene-ambience\.mjs$/u);
    assert.match(provenance.modifications, /Original synthesized/u);

    const wav = await readFile(resolve(packageRoot, path));
    const fileStat = await stat(resolve(packageRoot, path));
    assert.ok(fileStat.size <= 25 * 1024, `${path} fits the 25 KiB sound budget`);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), 8000, '8 kHz ambient sample rate');
    assert.equal(wav.readUInt16LE(34), 8, '8-bit PCM');
    assert.equal(wav.length, 44 + 8000 * 3);
    assert.ok(Math.abs(wav[44] - wav[wav.length - 1]) <= 2, `${path} loop edge is continuous`);

    const samples = wav.subarray(44);
    let squareSum = 0;
    let peak = 0;
    for (const sample of samples) {
      const amplitude = Math.abs(sample - 128) / 127;
      squareSum += amplitude * amplitude;
      peak = Math.max(peak, amplitude);
    }
    const rms = Math.sqrt(squareSum / samples.length);
    assert.ok(rms > 0.015 && rms < 0.12, `${path} has a quiet but audible level`);
    assert.ok(peak < 0.4, `${path} retains headroom`);
  }
});
