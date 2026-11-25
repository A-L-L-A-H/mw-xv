/**
 * CF-020 (issue #74) — DESIGN ONLY. Feature-flagged plan for a gated
 * inbox-to-work-contract bridge. This module intentionally exports no dispatch
 * function: the durable inbox remains a receipt boundary. No `ai.work_contract`
 * or `ai.agent_run` row is created, no `base.job` is enqueued, no remote command
 * runs and no artifact is verified here. PCW remains the only acceptance
 * authority; live mesh delegation is not enabled by this issue.
 *
 * Mapping sketch (to be implemented only after the enablement checklist):
 *
 *   receipt (companyId, messageId, keyId, sourceAgentId, targetAgentId,
 *            payloadSha256, delegationDepth, dataClassification)
 *     -> deterministic idempotency key
 *        `sha256(companyId | messageId | keyId | payloadSha256)`
 *     -> server-side authorization re-check (company, agent, capability grant,
 *        classification, delegation depth, key identity, transport identity)
 *     -> server-side Proof-Carrying Work verification of submitted evidence
 *     -> only then: one company-scoped `ai.work_contract` + canonical
 *        `@moonwitness/jobs` lease with fencing token; the lease, not the
 *        envelope, governs execution
 *
 * A remote peer never sets `accepted`; any peer-claimed accepted state is
 * rejected at the protocol boundary. The mapping is pure/idempotent: replaying
 * the same receipt resolves to the same idempotency key and cannot create a
 * second contract or lease. Failures, cancellation, credential revocation and
 * timeout are terminal for that idempotency key until an operator explicitly
 * resets it; a stale fencing token cannot resume a superseded run.
 */

export interface A2aDispatchBridgeGate {
  readonly id: string;
  readonly enforcedAt: 'dispatch_time';
  readonly description: string;
  readonly failClosed: true;
}

export interface A2aDispatchBridgeDesign {
  readonly issue: 74;
  readonly stableTaskId: 'CF-020';
  readonly status: 'design_only';
  readonly featureFlag: string;
  readonly enabledByDefault: false;
  readonly disabledBehavior: string;
  readonly acceptanceAuthority: 'pcw';
  readonly targetModels: readonly string[];
  readonly canonicalQueue: string;
  readonly idempotencyKeyExpression: string;
  readonly gates: readonly A2aDispatchBridgeGate[];
  readonly lifecycle: Readonly<Record<string, string>>;
  readonly enablementChecklist: readonly string[];
}

export const A2A_DISPATCH_BRIDGE_DESIGN: Readonly<A2aDispatchBridgeDesign> = Object.freeze({
  issue: 74,
  stableTaskId: 'CF-020',
  status: 'design_only',
  featureFlag: 'MW_A2A_INBOX_DISPATCH_BRIDGE_ENABLED',
  enabledByDefault: false,
  disabledBehavior:
    'Return the durable queued receipt only; never create ai.work_contract/ai.agent_run, never enqueue base.job, never execute or accept remote work.',
  acceptanceAuthority: 'pcw',
  targetModels: Object.freeze(['ai.work_contract', 'ai.agent_run']),
  canonicalQueue: '@moonwitness/jobs',
  idempotencyKeyExpression: 'sha256(companyId | messageId | keyId | payloadSha256)',
  gates: Object.freeze([
    {
      id: 'peer_identity',
      enforcedAt: 'dispatch_time',
      description:
        'Receipt keyId must still resolve to its registered, non-revoked agent/company key (CF-017).',
      failClosed: true,
    },
    {
      id: 'transport_identity',
      enforcedAt: 'dispatch_time',
      description:
        'Verified mesh certificate identity must still allowlist the same company/agent (CF-018).',
      failClosed: true,
    },
    {
      id: 'company_scope',
      enforcedAt: 'dispatch_time',
      description:
        'Company is revalidated server-side against the authenticated context; cross-company dispatch is rejected.',
      failClosed: true,
    },
    {
      id: 'agent_binding',
      enforcedAt: 'dispatch_time',
      description:
        'Source/target agents must be active, non-emergency-stopped and bound to the registered key identity.',
      failClosed: true,
    },
    {
      id: 'capability_grant',
      enforcedAt: 'dispatch_time',
      description:
        'A live, unrevoked, unexpired capability grant must cover the requested capability and policy version.',
      failClosed: true,
    },
    {
      id: 'classification',
      enforcedAt: 'dispatch_time',
      description:
        'Data classification is rechecked against the private-mesh boundary and receiver allowlist.',
      failClosed: true,
    },
    {
      id: 'delegation_depth',
      enforcedAt: 'dispatch_time',
      description:
        'Delegation depth is recomputed locally and capped; a peer-supplied depth is never trusted.',
      failClosed: true,
    },
    {
      id: 'pcw_verification',
      enforcedAt: 'dispatch_time',
      description:
        'Server-side Proof-Carrying Work verification must pass before any work contract is created or accepted.',
      failClosed: true,
    },
    {
      id: 'jobs_lease_fencing',
      enforcedAt: 'dispatch_time',
      description:
        'Canonical @moonwitness/jobs leases and monotonically increasing fencing tokens govern execution; no second queue.',
      failClosed: true,
    },
    {
      id: 'server_only_accepted',
      enforcedAt: 'dispatch_time',
      description:
        'Remote peers cannot set accepted state; only the server PCW workflow may transition to accepted.',
      failClosed: true,
    },
  ]),
  lifecycle: Object.freeze({
    failure:
      'Record failure against the idempotency key; retry only under a fresh job lease and re-run all gates.',
    cancellation: 'Cancel the canonical job lease; the work contract is never marked accepted.',
    revocation:
      'Key/certificate/grant revocation invalidates pending dispatch immediately and blocks re-dispatch.',
    timeout:
      'Lease expiry fences the old run; a new run requires a strictly higher fencing token and full revalidation.',
  }),
  enablementChecklist: Object.freeze([
    'Human approval from the security owner and the company administrator, recorded with approver identity and timestamp.',
    'ADR covering PCW acceptance authority, jobs lease/fencing semantics and the absence of a second queue.',
    'Security evidence: CF-017/018/019 test reports, threat model, revocation drill and audit-log retention review.',
    'Default-off flag verified by negative tests proving no contract, run, job or execution when disabled.',
    'Replay/idempotency tests proving a repeated receipt cannot create a second work contract or lease.',
    'Load tests proving inbox pagination, backpressure and payload retention hold under burst traffic.',
    'No production rollout or public listener until all of the above are reviewed and signed off.',
  ]),
} satisfies A2aDispatchBridgeDesign);
