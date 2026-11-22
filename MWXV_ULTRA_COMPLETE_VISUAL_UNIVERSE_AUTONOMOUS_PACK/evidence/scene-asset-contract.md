# MoonWitness scene asset contract v1

The existing `packages/assets/manifest.json` remains the canonical inventory at `schemaVersion: 1`. This document specifies metadata semantics without changing that file or package exports.

- **Stable ID:** current manifest path; do not duplicate inventory with a separate ID catalog.
- **Pack/domain:** optional descriptive tags for future visual asset grouping. Domain tags do not assert that an API route or permission exists.
- **Source/master/generated:** retain source paths in manifest; generated outputs must list their source and be owned by one deterministic writer via the shared ownership helper.
- **Variants:** list only references to other canonical manifest paths; references must resolve. Variants are files/crops, not model-specific behavior.
- **Animation clip:** `packages/assets/scripts/scene-schema.mjs` validates clip IDs, canonical frame references, positive frame durations, playback direction, loop state, and normalized pivot.
- **Scene:** ordered layers use canonical asset paths, normalized position/pivot, bounded parallax, opacity, clip references, and a static fallback. Nested scene composition is acyclic. Unknown fields are rejected so route, permission, secret, or business records cannot be embedded.
- **Approval and license:** source, creator, method, terms, date, modifications and distribution status live in the canonical license/provenance file. Unknown/unreviewed items remain non-distributable.
- **Backward compatibility:** current v1 entries with no extension fields remain valid. New optional properties require validator support before any manifest entry uses them.

No production character, scene, or clip IDs are registered by this contract; pilot identity and reviewed assets remain separate approval/production tasks.
