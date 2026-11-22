# Asset manifest extension proposal (schema v1 compatibility)

The sole canonical inventory remains `packages/assets/manifest.json` with `schemaVersion: 1`; `packages/assets/licenses.json` remains the sole package provenance/license register. Existing entries stay valid and readable as-is. This proposal does not add parallel registries or mutate either file.

## Stable identifiers

Use each canonical manifest `path` as the stable asset ID for schema v1. Existing consumers already import path-based package subpaths. A future explicit `id` field may be introduced only in a new compatible schema revision with a deterministic path-derived migration and collision check; do not require it for current records.

## Optional extension fields

Future entries may add:

- `pack`: lowercase stable visual pack identifier.
- `domain`: a declared visual consumer domain, never an ORM/API capability claim.
- `subject`: approved character or scene identifier, only after that registry is approved.
- `source`: existing master/source path or source method; preserve current semantics.
- `variants`: references to other canonical manifest paths, with every reference resolving.
- `status`: `draft`, `review`, `approved`, or `blocked`; only approved outputs are distributable unless current package rules explicitly state otherwise.
- `dimensions`, `focalPoint`, or `pivot`: optional validated visual metadata for media where applicable.

No field is required for historical schema-v1 entries. Source masters remain in the manifest but are excluded from consumer package exports by existing explicit export policy unless deliberately listed. All generated writers must use `scripts/manifest-ownership.mjs` with exact owned paths.

## Compatibility and validation

The validator should accept legacy v1 records and validate any optional extension property when present. A future deterministic converter must derive IDs and reference paths from this manifest only, preserve path order deterministically, detect collisions, and leave licenses untouched. This is a design proposal, not a schema implementation; W2-002 owns implementation and fixtures.
