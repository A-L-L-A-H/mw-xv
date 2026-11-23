export type A2aMeshRegion = 'jakarta' | 'surabaya' | 'medan';

export type A2aMeshTrustTier = 'core' | 'edge' | 'gateway';

export type A2aMeshNodeStatus = 'online' | 'degraded';

export type A2aMeshCalendar = '24x7' | 'jakarta_business_hours';

export type A2aCapabilityStatus = 'active' | 'standby' | 'suspended';

export type A2aSlaRiskClass = 'standard' | 'confidential' | 'regulated';

import { DEFAULT_TIMEZONE, DEFAULT_UTC_OFFSET_MINUTES } from '@moonwitness/orm-base';

export type A2aDelegationStatus = 'active' | 'renewal_due' | 'retired';

export type A2aReputationOutcome = 'fulfilled' | 'breached';

export interface A2aMeshNode {
  readonly nodeId: string;
  readonly region: A2aMeshRegion;
  readonly endpoint: string;
  readonly meshAddress: string;
  readonly trustTier: A2aMeshTrustTier;
  readonly status: A2aMeshNodeStatus;
  readonly securityDomain: string;
}

export interface A2aRegisteredAgent {
  readonly agentId: string;
  readonly nodeId: string;
  readonly code: string;
  readonly displayName: string;
  readonly ownerUnit: string;
  readonly status: 'active' | 'standby';
  readonly serviceClass: string;
}

export interface A2aCapabilityClaimSeed {
  readonly claimId: string;
  readonly nodeId: string;
  readonly agentId: string;
  readonly capabilityCode: string;
  readonly status: A2aCapabilityStatus;
  readonly confidence: number;
  readonly verifiedAt: string;
}

export interface A2aSlaDelegationSeed {
  readonly contractId: string;
  readonly delegatorNodeId: string;
  readonly delegatorAgentId: string;
  readonly executorNodeId: string;
  readonly executorAgentId: string;
  readonly capabilityCode: string;
  readonly responseWindowMinutes: number;
  readonly resolutionWindowMinutes: number;
  readonly calendar: A2aMeshCalendar;
  readonly riskClass: A2aSlaRiskClass;
  readonly status: A2aDelegationStatus;
  readonly maxDelegationDepth: number;
  readonly signedAt: string;
  readonly expiresAt: string;
}

export interface A2aReputationEventSeed {
  readonly eventId: string;
  readonly agentId: string;
  readonly counterpartyAgentId: string;
  readonly contractId: string;
  readonly outcome: A2aReputationOutcome;
  readonly delta: number;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface A2aCapabilitySeedBundle {
  readonly version: '2026.11.1';
  readonly generatedAt: '2026-11-22T00:00:00.000Z';
  readonly timezone: typeof DEFAULT_TIMEZONE;
  readonly utcOffsetMinutes: typeof DEFAULT_UTC_OFFSET_MINUTES;
  readonly workStartMinute: 540;
  readonly workEndMinute: 1020;
  readonly nodes: readonly A2aMeshNode[];
  readonly agents: readonly A2aRegisteredAgent[];
  readonly capabilityClaims: readonly A2aCapabilityClaimSeed[];
  readonly slaContracts: readonly A2aSlaDelegationSeed[];
  readonly reputationLedger: readonly A2aReputationEventSeed[];
}

const NODES: readonly A2aMeshNode[] = [
  {
    nodeId: 'idn-jkt-core-01',
    region: 'jakarta',
    endpoint: 'https://a2a.jkt.moonwitness.internal',
    meshAddress: '100.64.12.10',
    trustTier: 'core',
    status: 'online',
    securityDomain: 'nusantara-core',
  },
  {
    nodeId: 'idn-sby-edge-02',
    region: 'surabaya',
    endpoint: 'https://a2a.sby.moonwitness.internal',
    meshAddress: '100.64.12.11',
    trustTier: 'edge',
    status: 'online',
    securityDomain: 'nusantara-regional',
  },
  {
    nodeId: 'idn-mdn-gateway-03',
    region: 'medan',
    endpoint: 'https://a2a.mdn.moonwitness.internal',
    meshAddress: '100.64.12.12',
    trustTier: 'gateway',
    status: 'online',
    securityDomain: 'nusantara-governance',
  },
];

const AGENTS: readonly A2aRegisteredAgent[] = [
  {
    agentId: 'jkt-orchestrator',
    nodeId: 'idn-jkt-core-01',
    code: 'agent.jkt.orchestrator',
    displayName: 'Nusantara Orchestration Desk',
    ownerUnit: 'Enterprise Coordination',
    status: 'active',
    serviceClass: 'orchestration',
  },
  {
    agentId: 'jkt-notifier',
    nodeId: 'idn-jkt-core-01',
    code: 'agent.jkt.notifier',
    displayName: 'Jakarta Notification Steward',
    ownerUnit: 'Customer Communications',
    status: 'active',
    serviceClass: 'notification',
  },
  {
    agentId: 'sby-triage',
    nodeId: 'idn-sby-edge-02',
    code: 'agent.sby.triage',
    displayName: 'Surabaya WhatsApp Triage',
    ownerUnit: 'Regional Service Desk',
    status: 'active',
    serviceClass: 'support',
  },
  {
    agentId: 'sby-knowledge',
    nodeId: 'idn-sby-edge-02',
    code: 'agent.sby.knowledge',
    displayName: 'Surabaya Knowledge Indexer',
    ownerUnit: 'Knowledge Operations',
    status: 'active',
    serviceClass: 'knowledge',
  },
  {
    agentId: 'mdn-sharia',
    nodeId: 'idn-mdn-gateway-03',
    code: 'agent.mdn.sharia',
    displayName: 'Medan Sharia Review Agent',
    ownerUnit: 'Sharia Governance',
    status: 'active',
    serviceClass: 'compliance',
  },
  {
    agentId: 'mdn-archive',
    nodeId: 'idn-mdn-gateway-03',
    code: 'agent.mdn.archive',
    displayName: 'Medan Records Archivist',
    ownerUnit: 'Records Governance',
    status: 'active',
    serviceClass: 'storage',
  },
];

const CAPABILITY_CLAIMS: readonly A2aCapabilityClaimSeed[] = [
  {
    claimId: 'a2a-claim-001',
    nodeId: 'idn-jkt-core-01',
    agentId: 'jkt-orchestrator',
    capabilityCode: 'a2a.coordination.dispatch',
    status: 'active',
    confidence: 98,
    verifiedAt: '2026-11-21T01:10:00.000Z',
  },
  {
    claimId: 'a2a-claim-002',
    nodeId: 'idn-jkt-core-01',
    agentId: 'jkt-orchestrator',
    capabilityCode: 'knowledge.query',
    status: 'standby',
    confidence: 91,
    verifiedAt: '2026-11-21T01:12:00.000Z',
  },
  {
    claimId: 'a2a-claim-003',
    nodeId: 'idn-jkt-core-01',
    agentId: 'jkt-notifier',
    capabilityCode: 'notification.dispatch',
    status: 'active',
    confidence: 96,
    verifiedAt: '2026-11-21T01:18:00.000Z',
  },
  {
    claimId: 'a2a-claim-004',
    nodeId: 'idn-sby-edge-02',
    agentId: 'sby-triage',
    capabilityCode: 'whatsapp.triage',
    status: 'active',
    confidence: 97,
    verifiedAt: '2026-11-21T01:25:00.000Z',
  },
  {
    claimId: 'a2a-claim-005',
    nodeId: 'idn-sby-edge-02',
    agentId: 'sby-triage',
    capabilityCode: 'knowledge.query',
    status: 'active',
    confidence: 89,
    verifiedAt: '2026-11-21T01:28:00.000Z',
  },
  {
    claimId: 'a2a-claim-006',
    nodeId: 'idn-sby-edge-02',
    agentId: 'sby-knowledge',
    capabilityCode: 'knowledge.query',
    status: 'active',
    confidence: 94,
    verifiedAt: '2026-11-21T01:32:00.000Z',
  },
  {
    claimId: 'a2a-claim-007',
    nodeId: 'idn-mdn-gateway-03',
    agentId: 'mdn-sharia',
    capabilityCode: 'sharia.verdict',
    status: 'active',
    confidence: 99,
    verifiedAt: '2026-11-21T01:40:00.000Z',
  },
  {
    claimId: 'a2a-claim-008',
    nodeId: 'idn-mdn-gateway-03',
    agentId: 'mdn-sharia',
    capabilityCode: 'a2a.coordination.dispatch',
    status: 'standby',
    confidence: 86,
    verifiedAt: '2026-11-21T01:44:00.000Z',
  },
  {
    claimId: 'a2a-claim-009',
    nodeId: 'idn-mdn-gateway-03',
    agentId: 'mdn-archive',
    capabilityCode: 'storage.archive',
    status: 'active',
    confidence: 92,
    verifiedAt: '2026-11-21T01:50:00.000Z',
  },
  {
    claimId: 'a2a-claim-010',
    nodeId: 'idn-jkt-core-01',
    agentId: 'jkt-notifier',
    capabilityCode: 'storage.archive',
    status: 'suspended',
    confidence: 70,
    verifiedAt: '2026-11-20T23:50:00.000Z',
  },
];

const SLA_CONTRACTS: readonly A2aSlaDelegationSeed[] = [
  {
    contractId: 'a2a-sla-001',
    delegatorNodeId: 'idn-jkt-core-01',
    delegatorAgentId: 'jkt-orchestrator',
    executorNodeId: 'idn-sby-edge-02',
    executorAgentId: 'sby-triage',
    capabilityCode: 'whatsapp.triage',
    responseWindowMinutes: 5,
    resolutionWindowMinutes: 30,
    calendar: '24x7',
    riskClass: 'confidential',
    status: 'active',
    maxDelegationDepth: 2,
    signedAt: '2026-11-21T02:00:00.000Z',
    expiresAt: '2026-12-21T02:00:00.000Z',
  },
  {
    contractId: 'a2a-sla-002',
    delegatorNodeId: 'idn-jkt-core-01',
    delegatorAgentId: 'jkt-orchestrator',
    executorNodeId: 'idn-sby-edge-02',
    executorAgentId: 'sby-knowledge',
    capabilityCode: 'knowledge.query',
    responseWindowMinutes: 10,
    resolutionWindowMinutes: 60,
    calendar: 'jakarta_business_hours',
    riskClass: 'standard',
    status: 'active',
    maxDelegationDepth: 1,
    signedAt: '2026-11-21T02:10:00.000Z',
    expiresAt: '2026-12-21T02:10:00.000Z',
  },
  {
    contractId: 'a2a-sla-003',
    delegatorNodeId: 'idn-jkt-core-01',
    delegatorAgentId: 'jkt-orchestrator',
    executorNodeId: 'idn-mdn-gateway-03',
    executorAgentId: 'mdn-sharia',
    capabilityCode: 'sharia.verdict',
    responseWindowMinutes: 15,
    resolutionWindowMinutes: 120,
    calendar: 'jakarta_business_hours',
    riskClass: 'regulated',
    status: 'active',
    maxDelegationDepth: 1,
    signedAt: '2026-11-21T02:20:00.000Z',
    expiresAt: '2027-02-21T02:20:00.000Z',
  },
  {
    contractId: 'a2a-sla-004',
    delegatorNodeId: 'idn-sby-edge-02',
    delegatorAgentId: 'sby-triage',
    executorNodeId: 'idn-mdn-gateway-03',
    executorAgentId: 'mdn-archive',
    capabilityCode: 'storage.archive',
    responseWindowMinutes: 20,
    resolutionWindowMinutes: 180,
    calendar: '24x7',
    riskClass: 'confidential',
    status: 'active',
    maxDelegationDepth: 1,
    signedAt: '2026-11-21T03:00:00.000Z',
    expiresAt: '2026-12-21T03:00:00.000Z',
  },
  {
    contractId: 'a2a-sla-005',
    delegatorNodeId: 'idn-jkt-core-01',
    delegatorAgentId: 'jkt-notifier',
    executorNodeId: 'idn-sby-edge-02',
    executorAgentId: 'sby-triage',
    capabilityCode: 'whatsapp.triage',
    responseWindowMinutes: 5,
    resolutionWindowMinutes: 45,
    calendar: '24x7',
    riskClass: 'standard',
    status: 'renewal_due',
    maxDelegationDepth: 1,
    signedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-30T00:00:00.000Z',
  },
];

const REPUTATION_LEDGER: readonly A2aReputationEventSeed[] = [
  {
    eventId: 'a2a-rep-001',
    agentId: 'sby-triage',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-001',
    outcome: 'fulfilled',
    delta: 12,
    reason: 'Triage response met the five-minute acknowledgement window',
    recordedAt: '2026-11-21T02:04:00.000Z',
  },
  {
    eventId: 'a2a-rep-002',
    agentId: 'sby-triage',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-001',
    outcome: 'breached',
    delta: -18,
    reason: 'Escalation exceeded the thirty-minute resolution window',
    recordedAt: '2026-11-21T05:40:00.000Z',
  },
  {
    eventId: 'a2a-rep-003',
    agentId: 'sby-knowledge',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-002',
    outcome: 'fulfilled',
    delta: 9,
    reason: 'Knowledge result passed the jurisdiction source filter',
    recordedAt: '2026-11-21T03:12:00.000Z',
  },
  {
    eventId: 'a2a-rep-004',
    agentId: 'mdn-sharia',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-003',
    outcome: 'fulfilled',
    delta: 15,
    reason: 'Sharia verdict delivered with traceable source citations',
    recordedAt: '2026-11-21T04:05:00.000Z',
  },
  {
    eventId: 'a2a-rep-005',
    agentId: 'mdn-archive',
    counterpartyAgentId: 'sby-triage',
    contractId: 'a2a-sla-004',
    outcome: 'fulfilled',
    delta: 8,
    reason: 'Archive receipt confirmed within the retention policy',
    recordedAt: '2026-11-21T06:02:00.000Z',
  },
  {
    eventId: 'a2a-rep-006',
    agentId: 'sby-triage',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-005',
    outcome: 'fulfilled',
    delta: 6,
    reason: 'Escalation handover completed before the deadline',
    recordedAt: '2026-11-22T01:30:00.000Z',
  },
  {
    eventId: 'a2a-rep-007',
    agentId: 'mdn-sharia',
    counterpartyAgentId: 'jkt-orchestrator',
    contractId: 'a2a-sla-003',
    outcome: 'breached',
    delta: -11,
    reason: 'Verdict revision required after a source conflict was detected',
    recordedAt: '2026-11-22T02:45:00.000Z',
  },
  {
    eventId: 'a2a-rep-008',
    agentId: 'jkt-notifier',
    counterpartyAgentId: 'sby-triage',
    contractId: 'a2a-sla-005',
    outcome: 'fulfilled',
    delta: 7,
    reason: 'Dispatch acknowledgement received from the regional desk',
    recordedAt: '2026-11-22T03:10:00.000Z',
  },
];

export function buildA2aCapabilitySeed(): A2aCapabilitySeedBundle {
  return {
    version: '2026.11.1',
    generatedAt: '2026-11-22T00:00:00.000Z',
    timezone: DEFAULT_TIMEZONE,
    utcOffsetMinutes: DEFAULT_UTC_OFFSET_MINUTES,
    workStartMinute: 540,
    workEndMinute: 1020,
    nodes: NODES.map((node) => ({ ...node })),
    agents: AGENTS.map((agent) => ({ ...agent })),
    capabilityClaims: CAPABILITY_CLAIMS.map((claim) => ({ ...claim })),
    slaContracts: SLA_CONTRACTS.map((contract) => ({ ...contract })),
    reputationLedger: REPUTATION_LEDGER.map((entry) => ({ ...entry })),
  };
}

export const buildA2aInitialSeed = buildA2aCapabilitySeed;
