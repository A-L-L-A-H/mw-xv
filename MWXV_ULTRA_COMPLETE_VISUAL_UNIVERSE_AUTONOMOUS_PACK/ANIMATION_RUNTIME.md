# Animation and Scene Runtime Specification

## Goals

A small, deterministic, resource-safe 2.5D presentation runtime for existing web consumers—not a new game engine. It coordinates artwork layers, camera motion, character clips, scene transitions and optional FX.

## Runtime capabilities

1. Scene load/unload and readiness state.
2. Typed layer composition: image/vector/media, z-order, transform, opacity, blend, clipping and responsive anchors.
3. Camera: bounded pan/zoom and optional parallax input.
4. Character adapter: static pose, sprite sequence and optional rig driver.
5. Timeline: finite entrance/transition sequence with play/pause/reset/complete; no unbounded recursive timeline.
6. Events: named trigger points and app-driven state changes; never execute arbitrary code from asset JSON.
7. Visibility lifecycle: pause when offscreen; release observers, listeners, media and animation frames on unmount.
8. Preferences: full motion, reduced motion, optional low-power mode and static fallback.
9. Diagnostics: missing asset, invalid clip, decode failure, frame timing and resource leak warnings.

## Suggested typed contracts (conceptual)

```ts
 type SceneId = string;
 type AssetId = string;
 type ClipId = string;

 interface SceneDefinition {
   id: SceneId;
   version: number;
   pack: string;
   layers: SceneLayer[];
   camera?: CameraTrack;
   timeline?: TimelineTrack;
   breakpoints: SceneBreakpoint[];
   fallback: StaticSceneFallback;
 }

 interface SceneLayer {
   id: string;
   assetId: AssetId;
   depth: number;
   anchor?: { x: number; y: number };
   transform?: { x?: number; y?: number; scale?: number; rotate?: number };
   parallaxFactor?: number;
   clipId?: ClipId;
   decorative: boolean;
 }
```

The actual implementation must align with existing TS conventions; this excerpt is a contract sketch, not a forced API.

## First implementation strategy

- Use the current Motion dependency from `apps/board` if its current API and bundle cost are verified.
- Use CSS/SVG for existing effect primitives and low-cost atmosphere.
- Use layered images and sprite sequence playback for the pilot character/environment.
- Keep React/browser code in UI/app packages, not `assets` or ORM.
- Keep source scene data in asset package; app-level route orchestration stays in Board.

## Optional specialist engines

| Engine category | Use only if | Required checks |
|---|---|---|
| Rive | Interactive vector character/state machines materially improve a use case | Runtime/license, authored file compatibility, bundle, accessibility and fallback |
| Live2D | Deformable anime character with facial/body rigging is a real requirement | SDK/model licensing, export format, runtime/browser support, bundle and fallback |
| GSAP | Existing Motion is demonstrably insufficient for a timeline feature | API overlap, bundle, cleanup and license verification |
| Pixi/Canvas | Dense sprite/particle scene exceeds DOM/SVG performance | Measured device benchmark, context loss, lifecycle and accessible fallback |
| Three/WebGL | True 3D camera/material/environment is required | Measured need, WebGL device support, bundle/memory and 2D fallback |

Do not add all of these. Select one specialist path only after a small proof and approval.

## Performance policy

- Define actual target device/browser matrix before claiming FPS.
- Measure cold load, transfer size, JS/CSS, memory, GPU/CPU, dropped frames and layout shift.
- Lazy-load noncritical scenes and character clips.
- Reuse decoded textures where possible; dispose on navigation/unmount.
- Use `transform`/`opacity` where possible; avoid animating layout and applying expensive filters across full pages.
- Bound particle counts and active scene count.
- Use a static scene if device capability or motion preference requires it.

## Failure handling

- Asset/clip failure must not blank the page or block CTA.
- Show a valid static fallback.
- Log diagnostics without exposing sensitive user information.
- Never claim an animation is playing when the asset failed to load.
