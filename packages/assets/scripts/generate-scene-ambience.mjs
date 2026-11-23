import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sampleRate = 8000;
const durationSeconds = 3;
const sampleCount = sampleRate * durationSeconds;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createWav(ambience) {
  const samples = new Float64Array(sampleCount);
  const random = randomGenerator(ambience.seed);
  const binCount = ambience.noiseBins.length;
  const noiseAmplitude = ambience.noiseAmplitude / Math.sqrt(Math.max(1, binCount));

  for (let index = 0; index < binCount; index += 1) {
    const bin = ambience.noiseBins[index];
    const phase = random() * Math.PI * 2;
    const amplitude =
      noiseAmplitude / Math.pow(bin / ambience.noiseBins[0], ambience.spectralSlope);
    const angularFrequency = (Math.PI * 2 * bin) / durationSeconds;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      samples[sample] += Math.sin((angularFrequency * sample) / sampleRate + phase) * amplitude;
    }
  }

  for (const [frequency, amplitude, phaseSeed] of ambience.tones) {
    const phase = (phaseSeed * Math.PI) / 180;
    const angularFrequency = (Math.PI * 2 * frequency) / sampleRate;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      samples[sample] += Math.sin(angularFrequency * sample + phase) * amplitude;
    }
  }

  const pcm = Buffer.alloc(sampleCount);
  let peak = 0;
  let squareSum = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.max(-0.72, Math.min(0.72, samples[sample]));
    peak = Math.max(peak, Math.abs(value));
    squareSum += value * value;
    pcm[sample] = Math.max(0, Math.min(255, Math.round(128 + value * 112)));
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return {
    buffer: Buffer.concat([header, pcm]),
    peak,
    rms: Math.sqrt(squareSum / sampleCount),
    boundaryDelta: Math.abs(pcm[0] - pcm[pcm.length - 1]),
  };
}

const ambiences = [
  {
    id: 'moon-city-night',
    filename: 'ambience-moon-city-night.wav',
    seed: 711,
    noiseBins: Array.from({ length: 170 }, (_, index) => index + 15),
    noiseAmplitude: 0.11,
    spectralSlope: 0.55,
    tones: [
      [55, 0.045, 0],
      [110, 0.022, 37],
      [165, 0.012, 71],
    ],
    description:
      'Original synthesized night-air and distant electrical hum; no field recordings or music.',
  },
  {
    id: 'underground-hum',
    filename: 'ambience-underground-hum.wav',
    seed: 1207,
    noiseBins: Array.from({ length: 95 }, (_, index) => index + 2),
    noiseAmplitude: 0.105,
    spectralSlope: 0.82,
    tones: [
      [36, 0.052, 0],
      [54, 0.036, 61],
      [72, 0.018, 112],
    ],
    description:
      'Original synthesized low ventilation resonance and soft room noise; no field recordings or music.',
  },
  {
    id: 'archive-quiet',
    filename: 'ambience-archive-quiet.wav',
    seed: 1901,
    noiseBins: Array.from({ length: 180 }, (_, index) => index + 70),
    noiseAmplitude: 0.047,
    spectralSlope: 0.9,
    tones: [
      [220, 0.008, 30],
      [330, 0.005, 75],
    ],
    description:
      'Original synthesized near-silent room tone; no clocks, voices, field recordings, or music.',
  },
  {
    id: 'street-rain',
    filename: 'ambience-street-rain.wav',
    seed: 2401,
    noiseBins: Array.from({ length: 390 }, (_, index) => index + 25),
    noiseAmplitude: 0.105,
    spectralSlope: 0.28,
    tones: [
      [120, 0.012, 19],
      [240, 0.007, 86],
    ],
    description:
      'Original synthesized soft rain texture with no thunder, voices, field recordings, or music.',
  },
];

const soundDirectory = resolve(packageRoot, 'sounds');
await mkdir(soundDirectory, { recursive: true });
const generated = [];
for (const ambience of ambiences) {
  const rendered = createWav(ambience);
  if (rendered.buffer.length > 25 * 1024) {
    throw new Error(
      `${ambience.filename}: ${rendered.buffer.length} bytes exceeds the 25 KiB sound budget`
    );
  }
  if (rendered.rms < 0.002 || rendered.peak > 0.72 || rendered.boundaryDelta > 2) {
    throw new Error(`${ambience.filename}: invalid audio envelope ${JSON.stringify(rendered)}`);
  }
  await writeFile(resolve(soundDirectory, ambience.filename), rendered.buffer);
  generated.push({ ambience, rendered });
}

const manifestPath = resolve(packageRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const soundAssets = generated.map(({ ambience }) => ({
  path: `sounds/${ambience.filename}`,
  kind: 'sound',
  variant: 'scene-ambience',
  format: 'wav',
  durationSeconds,
  license: 'ISC',
  source: 'scripts/generate-scene-ambience.mjs',
  pack: 'moon-city',
  domain: 'visual-universe',
  status: 'approved',
}));
manifest.assets = replaceGeneratedAssets(
  manifest.assets,
  soundAssets,
  new Set(soundAssets.map(({ path }) => path))
);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const licensePath = resolve(packageRoot, 'licenses.json');
const licenses = JSON.parse(await readFile(licensePath, 'utf8'));
const soundLicenses = generated.map(({ ambience }) => ({
  path: `sounds/${ambience.filename}`,
  creator: 'MoonWitness contributors',
  source: 'packages/assets/scripts/generate-scene-ambience.mjs',
  license: 'ISC',
  modifications: ambience.description,
}));
licenses.soundEffects = replaceGeneratedAssets(
  licenses.soundEffects,
  soundLicenses,
  new Set(soundLicenses.map(({ path }) => path))
);
await writeFile(licensePath, `${JSON.stringify(licenses, null, 2)}\n`);

for (const { ambience, rendered } of generated) {
  process.stdout.write(
    `${ambience.id}: ${rendered.buffer.length} bytes; RMS ${rendered.rms.toFixed(4)}; peak ${rendered.peak.toFixed(4)}; loop delta ${rendered.boundaryDelta} LSB\n`
  );
}
