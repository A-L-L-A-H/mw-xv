# MoonWitness scene asset contract v1

The existing `packages/assets/manifest.json` remains the canonical inventory at `schemaVersion: 1`. This document specifies metadata semantics without changing that file or package exports.

- **Stable ID:** current manifest path; do not duplicate inventory with a separate ID catalog.
- **Pack/domain:** optional descriptive tags for future visual asset grouping. Domain tags do not assert that an API route or permission exists.
- **Source/master/generated:** retain source paths in manifest; generated outputs must list their source and be owned by one deterministic writer via the shared ownership helper.
- **Variants:** list only references to other canonical manifest paths; references must resolve. Variants are files/crops, not model-specific behavior.
- **Animation clip (future):** a scene-side JSON description may reference canonical asset paths, frame durations, loop flag and normalized pivot. It may not embed business data, routes, secrets, or source media.
- **Scene (future):** ordered layer IDs, normalized position/scale, parallax bounds, safe areas, and a static fallback. Must be acyclic and refer only to declared asset IDs/paths.
- **Approval and license:** source, creator, method, terms, date, modifications and distribution status live in the canonical license/provenance file. Unknown/unreviewed items remain non-distributable.
- **Backward compatibility:** current v1 entries with no extension fields remain valid. New optional properties require validator support before any manifest entry uses them.

No character, scene, or clip IDs are registered by this contract; their assets/identity approval and schema implementation remain separate tasks.
