# Child protection and publication risk gates

- Related task: `K6-004`
- Governing policy: [Knowledge privacy and safeguarding](knowledge-privacy-and-safeguarding.md)
- Runtime contract: [`packages/research/src/child-protection-gate.ts`](../../packages/research/src/child-protection-gate.ts) and [`packages/research/src/child-protection-gate.schema.json`](../../packages/research/src/child-protection-gate.schema.json)
- API enforcement route: [`apps/api/src/routes/child-protection.routes.ts`](../../apps/api/src/routes/child-protection.routes.ts)

## Core fail-closed controls

1. **Classification ceiling and inheritance**:
   - Sensitivity ranks `PUBLIC_APPROVED < INTERNAL < CONFIDENTIAL < RESTRICTED < CHILD_SENSITIVE`.
   - Inherited source/attachment classifications never downgrade sensitivity.
   - Any record with `minor_involved: true` or BUG program slot `#013` (`SAFE FROM DAY ONE`) is forced to `CHILD_SENSITIVE`.
2. **Default-deny public projection**:
   - `public_projection` and `public_url` deny by default for all records unless `effective_classification === "PUBLIC_APPROVED"`, zero minor identifiers are detected, and a separate, minimized `publication_approval` (`reviewer_id !== requester_id`, matching SHA-256 digests, non-empty `decision_ref`) is verified.
3. **Zero child identifiers in public, search, analytics, AI, or log channels**:
   - `CHILD_SENSITIVE` and `minor_involved` records are unconditionally forbidden from `public_projection`, `public_url`, `search_index`, `ai_prompt`, `analytics`, and `log_output`.
   - `containsProhibitedMinorIdentifiers` deep-scans candidate payloads for minor-identifying field names (`child_name`, `minor_name`, `dob`, `school_name`, `home_address`, `raw_allegation`, `national_id`, etc.) and email/phone patterns.
   - Audit summaries emit only `record_id_sha256` and denial reason codes without leaking plaintext or minor identifiers.
4. **Human-reviewed safeguarding escalation procedure**:
   - Internal/escalation access to minor-related synthetic records fails closed unless `safeguarding_process_approved === true` AND an independent `escalation_approval` (`safeguarding_owner_id`, `reviewer_id !== requester_id`, `decision_ref`, `approved_at`) is recorded.
   - Real (non-synthetic) minor records remain blocked until an authorized safeguarding owner process is formally approved and operationalized.
