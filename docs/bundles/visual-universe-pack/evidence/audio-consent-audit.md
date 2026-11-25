# Existing audio consent and availability verification

## Existing implementation

`packages/ui/src/components/audio.tsx` provides `SoundProvider`, `useSfx`, and `SoundToggle`. Sound is muted by default, enabled only by an explicit toggle, and playback waits for the first pointer or keyboard interaction. The preference uses local storage with a safe muted fallback. The runtime creates audio lazily, allows one cue at a time, releases playback after end/failure, and catches storage/creation/playback errors. The three existing UI cues are short original PCM assets under `packages/assets/sounds`; current package tests verify duration, mono channel, clipping, the combined 50 KB budget, and provenance.

## Verification

- `pnpm test:assets` — exit 0; all 27 asset tests, validation, tarball inventory, and docs asset sync passed.
- `pnpm test:ui` — exit 0; 59 UI tests and packed consumer verification passed earlier in this run.
- No new sound was generated or enabled. A scene soundscape remains subject to W6-005 and audio consent/approval gates.

This verifies existing UI cue consent behavior; it does not constitute a Moon City ambience pack.
