# W8-D10 — Knowledge domain audit

## Verified contract

- Manifest: `packages/orm-knowledge/src/manifest.ts` registers 18 models: testimony, correction, interpretation, graph release/record/active release/review event, concept profile version, textual alignment candidate version, research suggestion version, story/page versions, actor identity, privacy revocation/projection, bug case/action outcome event and publication snapshot. Views in `views.ts` cover testimony, correction and interpretation; manifest menus for those are `developmentOnly`.
- Access: base user group is explicitly denied read/write to testimony, correction, interpretation and the other 15 protected records. Dedicated witness/privacy steward groups are declared and seeded to superadmin in this manifest. Other research API routes enforce their own caller, visibility, child-protection and release checks.
- API: registry registers corpus, evidence, research explanation/actor identity/duplicate/review/privacy/witness, concept profile, story workbench, local retrieval/suggestion, child protection, publication and bug-case routes.
- Board: existing `/knowledge`, `/board/knowledge`, `/board/stories/workbench` surfaces; their copy/records remain API-authoritative.
- Existing assets: `knowledge`, `book-open`, `archive`, `story`, `document`, `history`, `search`, `security`, `lock`; generic access-denied/offline/empty illustrations. No factual witness portrait or archive entry is generated.

## Real states and boundaries

Visibility and epistemic state must come from real, authorized records. Manifest seed examples are explicitly synthetic and restricted; they are not production stories or evidence. Public graph releases are not equivalent to private testimony visibility. Do not visualize names, identities, maps or conclusions without their API permission and data contract.

Source review covered all manifest model imports/ACLs/menus, knowledge route registration and Board route files. Board typecheck is recorded in the W8-D batch evidence.
