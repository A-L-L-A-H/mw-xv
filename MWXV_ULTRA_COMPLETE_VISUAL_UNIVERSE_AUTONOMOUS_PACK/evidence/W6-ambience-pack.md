# W6 Scene Ambience Pack

## Asset inventory

Four original synthesized WAV loops are registered in `packages/assets/manifest.json` and `packages/assets/licenses.json`:

- `sounds/ambience-moon-city-night.wav` — air bed with distant electrical hum.
- `sounds/ambience-underground-hum.wav` — low ventilation resonance and room tone.
- `sounds/ambience-archive-quiet.wav` — near-silent room tone.
- `sounds/ambience-street-rain.wav` — soft synthesized rain texture.

Each loop is 3 seconds, 8 kHz mono 8-bit PCM, 24,044 bytes, and licensed ISC as original MoonWitness procedural audio. All generated tones are harmonically periodic over the loop duration; measured edge delta is 0, 0, 0, and 1 PCM least-significant bit respectively. RMS levels are 0.0198–0.0498 and peak levels 0.0726–0.1888, preserving headroom. No music, voices, field recordings, or third-party audio are used.

## Controller integration

`packages/ui/src/lib/scene-soundscape.ts` no longer maps scene names onto UI cue files. Consumers supply explicit sources; absent sources safely produce silence. The UI Catalog supplies the four package assets to the controller. It starts muted, creates Audio only after gesture plus opt-in, caps volume at 0.18, loops one source, pauses the previous source on scene changes, stops on mute/None, and catches playback failures.

## Verification

- `pnpm --filter @moonwitness/assets sounds:ambience` — exit 0; generated four assets under budget with continuous loop boundaries.
- `node --test packages/assets/tests/scene-ambience.test.mjs` — exit 0; manifest/provenance/WAV format/duration/size/loop/RMS/peak checks passed.
- `node packages/assets/scripts/validate.mjs` — exit 0; 189 self-contained SVG assets validated, including sound inventory/provenance checks.
- `node packages/assets/scripts/asset-qa.mjs` — exit 0; 199 runtime assets, zero errors/warnings.
- `node --test packages/ui/tests/scene-fx-audio.test.mjs` — exit 0; single-source controller and missing-source silence tests passed.
- `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts --workers=1 --grep "scene ambience loads"` — exit 0; browser verifies no source before consent, source URL and 0.18 volume cap after opt-in, previous source pause on switch, and pause on mute.

Final focused gates:

- `pnpm test:assets` — exit 0; 56 asset tests passed and static docs exports are current.
- `pnpm test:ui` — exit 0; 71 UI tests passed, including the no-fallback and controller lifecycle cases.
- `pnpm --filter @moonwitness/ui-catalog exec tsc -p tsconfig.json --noEmit` — exit 0.
- `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` — exit 0; 12 browser tests passed, including W6 ambience consent/switch/mute behavior, FX frame-time budget, responsive scene inspector and diagnostics.

User requested that this blocker be completed in chat. The related W1-007 motion/audio-consent policy is already implemented and was retained; W2-003 provenance contract is complete.
