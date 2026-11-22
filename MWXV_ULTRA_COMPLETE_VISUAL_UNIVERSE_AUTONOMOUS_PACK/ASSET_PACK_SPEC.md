# Ultra-Complete Asset Pack Specification

## Pack family

All categories belong to one MoonWitness visual identity, not separate competing brands. Use canonical `manifest.json` and `licenses.json` ownership.

### Pack A — Brand & identity

- Canonical logo/wordmark/crown variants; brand marks, lockups, favicon/app icons and social art.
- Editorial stamps, labels and approved decorative wordmark derivatives.
- Font families/subsets and typography usage metadata.

### Pack B — Character production

- Character registry and identity sheets.
- Turnarounds, silhouettes, front/side/back views.
- Expression/face sheets only where appropriate.
- Poses, gestures, outfits, props and accessories.
- Layered masters with pivots/anchors.
- Idle, blink, hair, walk, turn, gesture and scene-specific clips.
- Sprite atlases/frame sequences and optional rig source.
- Character thumbnails/contact sheets and provenance.

### Pack C — Environments/worlds

- Moon City: sky, moon, clouds, stars, distant skyline, midground buildings, rooftop, rails, cables, signage, rain, haze and foreground.
- Rooftop, night street, underground corridor, archive/library, observatory, interior and digital/knowledge space as required by existing product routes.
- Modular foreground/midground/background planes, alternate crops, weather/time variants only when authored.
- Environment color grade, camera and depth metadata.

### Pack D — Props/object library

- Radio/signal device, phone, notebook, camera, headphones, bag, screens, papers, stamps, urban props, office/productivity props and generic scene objects.
- Reusable object states, alpha-safe exports and consistent perspective.

### Pack E — Animation production

- Sprite sheets, image sequences, clip metadata, timeline descriptors and preview renders.
- Frame sizes, anchors, duration, fps or per-frame timing, loop mode, direction, tags, fallback frame.
- Rig assets only with documented source format, runtime adapter and license.
- No unsupported proprietary runtime file is shipped without the consumer runtime.

### Pack F — Scene compositions

- Scene IDs, layer references, breakpoints, focal points, camera keyframes, clip triggers, transitions and static fallback.
- Production scene vs preview specimen flag.
- Scenes are source descriptors; asset binaries remain canonical manifest assets.

### Pack G — Anime/grunge FX

- Impact, spark, slash, speed lines, freeze frame, smear, ink wipe, panel reveal, camera jolt, dust, rain, stars, glow and controlled color flash.
- Existing `packages/ui` FX are reused and extended; avoid duplicate `Manga*` APIs.
- Each preset includes intensity, duration, reduced-motion fallback and intended use.

### Pack H — Editorial/comic materials

- Panel frames, speech bubbles, captions, ripped edges, tape, halftone, xerox grain, ink splatter, scratches, stickers, hand arrows and stamps.
- Materials remain separable from text and controls.

### Pack I — Domain illustrations

- Reusable illustration family by domain (base/auth/jobs/integration/WhatsApp/request/notification/organization/workflow/knowledge/storage/AI).
- Empty, loading, no-results, access denied, offline, success, warning, error, stale, unavailable and retry where real product state exists.
- Domain symbols and data visualization motifs.

### Pack J — Soundscape

- Existing UI cues plus optional atmosphere/weather/city/footstep/transition/impact clips.
- User-initiated enable, global mute and fade/stop on scene change.
- No unlicensed songs/music or automatic sound on hover/scroll.

## Minimum first vertical slice: Moon City

The first production slice must include, at minimum by coverage rather than arbitrary file count:
- One approved scene descriptor.
- Sky, moon, cloud/atmosphere, distant city, midground city, foreground rooftop/props as separable layers.
- One consistent pilot character or approved silhouette, with static pose and at least one loopable idle clip.
- At least one environment motion channel (cloud drift or another subtle effect).
- One camera/parallax recipe with reduced-motion alternative.
- One transition/FX preset.
- Desktop and mobile composition strategy with reviewed focal points.
- Provenance, license, manifest and contact sheet evidence.

## Asset metadata checklist

Every registered asset should carry relevant fields for:

- Stable ID, path, kind/category, pack, tags and domain(s).
- Source/master relation, creator, method, source URL/reference, license/terms, generation/modified date.
- Format, dimensions, alpha, color profile when relevant, byte size and intended delivery target.
- Variant/breakpoint, focal point, safe area, alt/decorative classification.
- Character/subject identity, environment, scene, prop relation.
- Layer ID/order/depth/pivot/anchor where relevant.
- Clip/frame count/timing/loop/state mapping where relevant.
- Build owner/generator and source-control ownership.

Avoid making every field mandatory for every category: validate by asset kind with a typed schema.

## Generation pipeline

1. Brief and art direction reference.
2. Original master/source creation.
3. Human/agent quality review for anatomy, consistency, composition and artifacts.
4. Layer/frame separation where required.
5. Metadata and provenance registration.
6. Deterministic optimized export.
7. Contact sheet and responsive preview.
8. Asset/scene validation.
9. Package export and consumer smoke test.
10. Evidence and commit.
