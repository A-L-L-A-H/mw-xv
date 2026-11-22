# W2-002 — Manifest schema validation evidence

- Implemented optional v1 metadata validation for stable IDs, pack/domain/subject tags, approval status, dimensions, focal points, pivots, source paths, and variant references while preserving legacy path-only entries.
- Added positive and negative fixtures covering backward compatibility, duplicate paths/IDs, malformed variants, unresolved references, invalid tags/status/dimensions/normalized points, and file/field context.
- Added Moon City source records to the canonical manifest and provenance entries to the existing `licenses.json`; generated files are explicitly blocked from distribution pending terms review, while hand-authored SVGs have ISC source provenance.
- `pnpm test:assets` — exit 0 (31 tests; manifest validation; docs export check).
- `git diff --check` — pending commit review.
- Generated source sizes: environment master 3,499,690 bytes; opaque skyline source 1,557,740 bytes; derived moon 4,619,858 bytes; derived skyline 1,891,904 bytes; three SVGs 3,334 bytes total. Source assets remain excluded from package exports.
- Visual inspection: existing layer contact review at `evidence/moon-city-layer-contact-review.png`; scene composition can be inspected but clouds/foreground geometry needs a refreshed review before W4 completion.
- Distribution/rights: Magpie reported `workbuddy-ai/hy-image-3.5`; provider/model terms are not verified here. AI-generated masters and derivatives are marked `blocked` and non-distributable. Do not promote them to runtime output.
