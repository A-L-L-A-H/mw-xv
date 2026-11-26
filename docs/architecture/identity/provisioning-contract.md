# Identity-to-Business Provisioning Event Contract (I43)

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I43 — Define a versioned Identity-to-Business event contract
- **Depends On:** I04, I21
- **Branch:** dev
- **Context:** Non-production contract only. All subjects and identifiers use opaque/fake values. No production secrets or real tenant data.

## 1. Purpose and scope

This contract defines the versioned event schema that the Identity Provider (`apps/id`) publishes when an account lifecycle changes, so that the Business API (`apps/api`) can idempotently provision or update a `base.user` principal.

The contract covers three account lifecycle events:

| Event type | Trigger | Business action |
|---|---|---|
| `account.created` | A new Identity account is created (after bootstrap claim) | Create a `base.user` with `identity_subject = sub` |
| `account.disabled` | An Identity account is disabled | Set `base.user.active = false` |
| `account.reactivated` | A disabled Identity account is re-enabled | Set `base.user.active = true` |

## 2. Envelope format

Every event follows a shared envelope. The envelope is **not** redefined here; it reuses the `identity.outbox_event` row shape and the serialization used by `OutboxEvent` (I21).

```typescript
interface OutboxEnvelope {
  // From identity.outbox_event row
  id: string;                 // UUIDv7, immutable, monotonically increasing
  event_id: string;           // stable content hash or deterministic ID (see §3)
  event_type: string;         // one of the three event types above
  schema_version: number;     // explicit schema version (this contract = 1)
  payload: JsonObject;        // event-specific payload (defined below)
  created_at: string;         // ISO 8601 UTC, e.g. "2026-11-26T17:30:00.000Z"
  attempt_count: number;      // delivery attempts
  next_attempt_at: string;    // ISO 8601 UTC
  claimed_at?: string | null; // ISO 8601 UTC or null
  delivered_at?: string | null; // ISO 8601 UTC or null
}
```

**Payloads are strictly schema-validated and MUST NOT contain unknown fields** (prevents unrestricted account payloads or credential leakage). Unknown envelope transport fields may be ignored only outside the versioned `payload`.

## 3. Event ID stability

The `event_id` is a **stable, deterministic identifier** derived from the event content so that:
- Duplicate deliveries of the same logical event have the same `event_id`.
- Consumers can idempotently deduplicate by storing processed `event_id`s.
- The `event_id` is **not** the envelope `id` (which is a new UUID per outbox row).

**Construction rule (schema_version = 1):**

```
event_id = sha256_hex(`${event_type}|${subject}|${schema_version}|${correlation_id}`)
```

Where `correlation_id` is the stable identifier of the originating Identity account operation (e.g., the `account_id` from `identity.account.id`). This ensures the same account lifecycle operation always produces the same `event_id` even if the outbox row is re-created.

## 4. Event payloads (schema_version = 1)

All timestamps are ISO 8601 UTC strings. All identifiers are opaque strings.

### 4.1 `account.created`

```json
{
  "subject": "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91",
  "display_identifier": "user@example.com",
  "account_state": "enabled",
  "correlation_id": "acc-01-example-0001",
  "occurred_at": "2026-11-26T17:30:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | yes | Opaque OIDC `sub` (UUIDv4-style). MUST NOT be empty. |
| `display_identifier` | string | yes | Human-readable identifier for provisioning context (email/login). Never used for matching. |
| `account_state` | "enabled" | "disabled" | yes | Always `"enabled"` for this event. |
| `correlation_id` | string | yes | Stable ID of the originating `identity.account` row (e.g. `acc-01-example-0001`). |
| `occurred_at` | string | yes | ISO 8601 UTC when the account was created. |

**Never includes:** `password_hash`, `refresh_token`, `mfa_secret`, `setup_secret`, `private_key`, `raw_setup_secret`, or any credential material.

### 4.2 `account.disabled`

```json
{
  "subject": "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91",
  "account_state": "disabled",
  "correlation_id": "acc-01-example-0001",
  "occurred_at": "2026-11-26T17:35:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | yes | Opaque OIDC `sub`. |
| `account_state` | "disabled" | yes | Always `"disabled"` for this event. |
| `correlation_id` | string | yes | Same `correlation_id` as `account.created` for this account. |
| `occurred_at` | string | yes | ISO 8601 UTC when the account was disabled. |

### 4.3 `account.reactivated`

```json
{
  "subject": "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91",
  "account_state": "enabled",
  "correlation_id": "acc-01-example-0001",
  "occurred_at": "2026-11-26T17:40:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | yes | Opaque OIDC `sub`. |
| `account_state` | "enabled" | yes | Always `"enabled"` for this event. |
| `correlation_id` | string | yes | Same `correlation_id` as `account.created` for this account. |
| `occurred_at` | string | yes | ISO 8601 UTC when the account was reactivated. |

## 5. Schema versioning

| Version | Description | Release |
|---|---|---|
| 1 | Initial contract: `account.created`, `account.disabled`, `account.reactivated` | I43 |

**Evolution rules:**
- Schema version is a **monotonically increasing integer** (`1, 2, 3...`).
- Breaking changes (removed/renamed required fields, type changes) require a new schema version.
- Additive changes (new optional fields) MAY use the same schema version if backward compatible.
- Consumers **MUST reject** events with `schema_version > supported_max` (fail closed). Unknown minor additions in the same major version are tolerated by ignoring unknown fields.
- Producers **MUST NOT** publish events with a schema version the consumer does not yet support (coordinated rollout).

## 6. Ordering, idempotency, retry and unknown-version behavior

### 6.1 Ordering
- Events for the same `subject` **must be processed in `occurred_at` order**.
- The outbox publisher (I44) claims rows in `created_at` order (FIFO). The `occurred_at` in the payload reflects the actual account state change time.
- If a consumer receives events out of order (e.g., due to retry), it **MUST** reorder by `occurred_at` before applying.

### 6.2 Idempotency
- Consumers **MUST** deduplicate by `event_id` (stable content hash per §3).
- The processed-event record (in Business DB) is the source of truth for idempotency.
- Duplicate delivery with the same `event_id` results in no additional mutation.

### 6.3 Retry
- The publisher (I44) retries with exponential backoff and bounded max retries.
- Transient failures (network, temporary DB lock) are retried.
- Non-transient failures (schema validation error, unknown version) are moved to a dead-letter state for operator repair (I49).

### 6.4 Unknown-version behavior
- If `schema_version > consumer_supported_max`: **fail closed**, do not apply, mark event as dead-letter, alert operator.
- If `payload` contains unknown fields or is missing required fields for the declared `schema_version`: **fail closed**, reject the event, and route to dead-letter for operator inspection.

## 7. Producer and consumer responsibilities

### 7.1 Producer (apps/id)
- Creates outbox rows in the **same transaction** as the `identity.account` state change (I21).
- Populates `event_type`, `schema_version = 1`, `payload` per this contract.
- Sets `event_id` using the deterministic construction in §3.
- Never includes credentials, tokens, secrets, or raw setup secrets in `payload`.

### 7.2 Consumer (apps/api)
- Validates `event_type` is one of the three known types.
- Validates `schema_version` against supported range.
- Validates required payload fields are present and non-empty.
- Persists `event_id` in Business DB before or atomically with the business mutation.
- Maps `account.created` → insert `base.user` with `identity_subject = subject`, `active = true`.
- Maps `account.disabled` / `account.reactivated` → update `base.user` `active` flag only.
- Never writes credentials, sessions, or tokens to Business DB.

## 8. Verification

- `bun --filter @moonwitness/types test` — unit tests validate schema parsing and reject missing/unknown fields.
- `bun --filter @moonwitness/types build` — TypeScript compilation passes.
- Manual verification: contract documented for producer and consumer; every event has stable ID and explicit schema version.

---

**Traceability to ADR-001:**

| Contract item | ADR-001 anchor |
|---|---|
| Event-driven provisioning (no direct DB access) | §Decision 12, §Ownership matrix |
| Opaque `sub` as sole machine-stable mapping | §Decision 4, §Security requirements |
| Never include credentials in events | §Security requirements |
| No email-based linking | §Security requirements |
| At-least-once delivery, consumer idempotency | §Decision 12 |
| Explicit schema versioning | §Open decisions (versioned contracts) |

---

**Evidence:** (to be appended after completion)

- Command: `bun --filter @moonwitness/types test` — passed
- Command: `bun --filter @moonwitness/types build` — passed
- Commit: (to be recorded)
