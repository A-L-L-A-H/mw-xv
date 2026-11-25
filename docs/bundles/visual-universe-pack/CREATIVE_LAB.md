# Creative Lab — Extend the Existing UI Catalog

## Product boundary

Implement these capabilities inside the existing `apps/ui-catalog` unless source audit proves a separate app is necessary. Do not create a second UI catalog or a new asset manager service for local build-time assets.

## Workspaces

### 1. Asset Browser

- Search/filter by pack, kind, domain, character, environment, tag, format, source/generated and license status.
- Preview variants and source-to-generated relationships.
- Display stable ID, path, dimensions, byte size, focal point, provenance and license.

### 2. Character Studio

- Character identity sheet and turnaround.
- Outfit/prop/pose/expression variant preview.
- Layer visibility and pivots.
- Clip state selection, play/pause/reset.
- Consistency checklist and warnings.

### 3. Environment Composer

- Load scene fixture by ID.
- Toggle layers and inspect depth order, anchors, pivots and bounds.
- Responsive scene preview.
- Static and reduced-motion comparison.

### 4. Timeline / FX Preview

- Discrete deterministic timeline states.
- Animation clip timing, loop and pause controls.
- FX intensity/duration controls with safe bounds.
- No auto-playing sound.

### 5. Asset QA Inspector

- Manifest parse/validation result.
- Missing refs, orphan files, duplicate IDs/path, invalid dimensions, missing provenance/license.
- Sprite bounds/timing and scene graph diagnostics.
- Size/performance classification and export presence.

## Data and safety

- Use clearly labelled fixtures; never show them as production users/metrics.
- Preview tools do not mutate canonical asset source automatically.
- Editing/export authoring operations must write to approved source paths and be reversible.
- Do not expose secrets, storage credentials or user attachment bytes in the lab.
- Respect bundle budget and lazy-load heavy preview modules.

## Acceptance

A reviewer can select one asset pack, inspect a character, toggle environment layers, preview an animation, switch desktop/mobile and reduced-motion, run QA, and identify exactly which source/provenance record backs each generated asset.
