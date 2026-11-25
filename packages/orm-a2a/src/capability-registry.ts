import { assertNonEmpty, MILLISECONDS_PER_MINUTE } from '@moonwitness/types';
import {
  buildA2aCapabilitySeed,
  type A2aCapabilityClaimSeed,
  type A2aCapabilitySeedBundle,
  type A2aMeshCalendar,
  type A2aReputationEventSeed,
  type A2aSlaDelegationSeed,
  type A2aSlaRiskClass,
} from './seed.js';

export type A2aCapabilityRegistry = A2aCapabilitySeedBundle;

export interface A2aCapabilityCandidateFilter {
  readonly nodeIds?: readonly string[];
  readonly excludeNodeIds?: readonly string[];
  readonly includeStandby?: boolean;
}

export interface A2aDelegationRequest {
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
  readonly maxDelegationDepth: number;
  readonly signedAt: string;
  readonly expiresAt: string;
}

export interface A2aReputationEventInput {
  readonly eventId: string;
  readonly agentId: string;
  readonly counterpartyAgentId: string;
  readonly contractId: string;
  readonly outcome: A2aReputationEventSeed['outcome'];
  readonly delta: number;
  readonly reason: string;
  readonly recordedAt: string;
}

export type A2aDelegationState = 'active' | 'renewal_due' | 'expired' | 'retired';

export interface A2aDelegationEvaluation {
  readonly contractId: string;
  readonly status: A2aDelegationState;
  readonly responseDueAt: string;
  readonly resolutionDueAt: string;
  readonly responseOverdue: boolean;
  readonly resolutionOverdue: boolean;
}

const MAX_A2A_DELEGATION_DEPTH = 3;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertIsoUtcTimestamp(value: string, label: string): number {
  assertNonEmpty(value, label);
  if (!ISO_UTC_PATTERN.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp with milliseconds`);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
  return epoch;
}

function assertKnownNode(registry: A2aCapabilityRegistry, nodeId: string, label: string): void {
  assertNonEmpty(nodeId, label);
  if (!registry.nodes.some((node) => node.nodeId === nodeId)) {
    throw new Error(`${label} is not registered in the A2A mesh`);
  }
}

function assertKnownAgent(registry: A2aCapabilityRegistry, agentId: string, label: string): void {
  assertNonEmpty(agentId, label);
  if (!registry.agents.some((agent) => agent.agentId === agentId)) {
    throw new Error(`${label} is not registered in the A2A mesh`);
  }
}

function assertAgentOnNode(registry: A2aCapabilityRegistry, agentId: string, nodeId: string): void {
  const agent = registry.agents.find((candidate) => candidate.agentId === agentId);
  if (!agent || agent.nodeId !== nodeId || agent.status !== 'active') {
    throw new Error(`${agentId} must be an active agent on node ${nodeId}`);
  }
}

function startOfLocalDay(localEpoch: number): number {
  const date = new Date(localEpoch);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isWeekendLocalDay(dayStart: number): boolean {
  const weekday = new Date(dayStart).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function nextBusinessDayStart(dayStart: number): number {
  let candidate = dayStart + MILLISECONDS_PER_DAY;
  while (isWeekendLocalDay(candidate)) {
    candidate += MILLISECONDS_PER_DAY;
  }
  return candidate;
}

function minuteOfLocalDay(dayStart: number, minute: number): number {
  return dayStart + minute * MILLISECONDS_PER_MINUTE;
}

export function addA2aBusinessMinutes(
  utcTimestamp: string,
  minutes: number,
  registry: A2aCapabilityRegistry = buildA2aCapabilitySeed()
): string {
  const sourceEpoch = assertIsoUtcTimestamp(utcTimestamp, 'utcTimestamp');
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error('minutes must be a non-negative safe integer');
  }
  if (registry.workEndMinute <= registry.workStartMinute) {
    throw new Error('business work window must end after it starts');
  }
  if (minutes === 0) return new Date(sourceEpoch).toISOString();

  const offsetMilliseconds = registry.utcOffsetMinutes * MILLISECONDS_PER_MINUTE;
  let localCursor = sourceEpoch + offsetMilliseconds;
  let dayStart = startOfLocalDay(localCursor);
  const minuteOfDay = (localCursor - dayStart) / MILLISECONDS_PER_MINUTE;

  if (isWeekendLocalDay(dayStart)) {
    dayStart = nextBusinessDayStart(dayStart);
    localCursor = minuteOfLocalDay(dayStart, registry.workStartMinute);
  } else if (minuteOfDay < registry.workStartMinute) {
    localCursor = minuteOfLocalDay(dayStart, registry.workStartMinute);
  } else if (minuteOfDay >= registry.workEndMinute) {
    dayStart = nextBusinessDayStart(dayStart);
    localCursor = minuteOfLocalDay(dayStart, registry.workStartMinute);
  }

  let remainingMinutes = minutes;
  while (remainingMinutes > 0) {
    const dayEnd = minuteOfLocalDay(dayStart, registry.workEndMinute);
    const availableMinutes = Math.floor((dayEnd - localCursor) / MILLISECONDS_PER_MINUTE);
    if (remainingMinutes <= availableMinutes) {
      localCursor += remainingMinutes * MILLISECONDS_PER_MINUTE;
      remainingMinutes = 0;
    } else {
      remainingMinutes -= availableMinutes;
      dayStart = nextBusinessDayStart(dayStart);
      localCursor = minuteOfLocalDay(dayStart, registry.workStartMinute);
    }
  }

  return new Date(localCursor - offsetMilliseconds).toISOString();
}

function addA2aCalendarMinutes(
  utcTimestamp: string,
  minutes: number,
  calendar: A2aMeshCalendar,
  registry: A2aCapabilityRegistry
): string {
  if (calendar === 'jakarta_business_hours') {
    return addA2aBusinessMinutes(utcTimestamp, minutes, registry);
  }
  const epoch = assertIsoUtcTimestamp(utcTimestamp, 'utcTimestamp');
  return new Date(epoch + minutes * MILLISECONDS_PER_MINUTE).toISOString();
}

export function createA2aCapabilityRegistry(
  seed: A2aCapabilitySeedBundle = buildA2aCapabilitySeed()
): A2aCapabilityRegistry {
  return {
    version: seed.version,
    generatedAt: seed.generatedAt,
    timezone: seed.timezone,
    utcOffsetMinutes: seed.utcOffsetMinutes,
    workStartMinute: seed.workStartMinute,
    workEndMinute: seed.workEndMinute,
    nodes: seed.nodes.map((node) => ({ ...node })),
    agents: seed.agents.map((agent) => ({ ...agent })),
    capabilityClaims: seed.capabilityClaims.map((claim) => ({ ...claim })),
    slaContracts: seed.slaContracts.map((contract) => ({ ...contract })),
    reputationLedger: seed.reputationLedger.map((entry) => ({ ...entry })),
  };
}

export function registerA2aCapabilityClaim(
  registry: A2aCapabilityRegistry,
  claim: A2aCapabilityClaimSeed
): A2aCapabilityRegistry {
  assertNonEmpty(claim.claimId, 'claimId');
  assertNonEmpty(claim.capabilityCode, 'capabilityCode');
  assertIsoUtcTimestamp(claim.verifiedAt, 'verifiedAt');
  assertKnownNode(registry, claim.nodeId, 'nodeId');
  assertKnownAgent(registry, claim.agentId, 'agentId');
  assertAgentOnNode(registry, claim.agentId, claim.nodeId);
  if (!Number.isSafeInteger(claim.confidence) || claim.confidence < 0 || claim.confidence > 100) {
    throw new Error('confidence must be an integer from 0 to 100');
  }
  if (registry.capabilityClaims.some((existing) => existing.claimId === claim.claimId)) {
    throw new Error(`capability claim ${claim.claimId} is already registered`);
  }
  if (
    registry.capabilityClaims.some(
      (existing) =>
        existing.nodeId === claim.nodeId &&
        existing.agentId === claim.agentId &&
        existing.capabilityCode === claim.capabilityCode
    )
  ) {
    throw new Error(`${claim.agentId} already claims capability ${claim.capabilityCode}`);
  }
  return {
    ...registry,
    capabilityClaims: [...registry.capabilityClaims, { ...claim }],
  };
}

export function findA2aCapabilityCandidates(
  registry: A2aCapabilityRegistry,
  capabilityCode: string,
  filter: A2aCapabilityCandidateFilter = {}
): readonly A2aCapabilityClaimSeed[] {
  assertNonEmpty(capabilityCode, 'capabilityCode');
  const allowedNodeIds = filter.nodeIds === undefined ? null : new Set(filter.nodeIds);
  const excludedNodeIds = new Set(filter.excludeNodeIds ?? []);
  const onlineNodeIds = new Set(
    registry.nodes.filter((node) => node.status === 'online').map((node) => node.nodeId)
  );
  const activeAgentIds = new Set(
    registry.agents.filter((agent) => agent.status === 'active').map((agent) => agent.agentId)
  );

  return registry.capabilityClaims
    .filter((claim) => claim.capabilityCode === capabilityCode)
    .filter(
      (claim) =>
        claim.status === 'active' || (filter.includeStandby === true && claim.status === 'standby')
    )
    .filter((claim) => onlineNodeIds.has(claim.nodeId))
    .filter((claim) => activeAgentIds.has(claim.agentId))
    .filter((claim) => allowedNodeIds === null || allowedNodeIds.has(claim.nodeId))
    .filter((claim) => !excludedNodeIds.has(claim.nodeId))
    .sort(
      (left, right) =>
        right.confidence - left.confidence || left.claimId.localeCompare(right.claimId)
    );
}

export function resolveA2aCapability(
  registry: A2aCapabilityRegistry,
  capabilityCode: string,
  filter: A2aCapabilityCandidateFilter = {}
): A2aCapabilityClaimSeed | null {
  return findA2aCapabilityCandidates(registry, capabilityCode, filter)[0] ?? null;
}

export function delegateA2aCapability(
  registry: A2aCapabilityRegistry,
  request: A2aDelegationRequest
): A2aCapabilityRegistry {
  for (const [label, value] of [
    ['contractId', request.contractId],
    ['delegatorAgentId', request.delegatorAgentId],
    ['executorAgentId', request.executorAgentId],
    ['capabilityCode', request.capabilityCode],
  ] as const) {
    assertNonEmpty(value, label);
  }
  assertKnownNode(registry, request.delegatorNodeId, 'delegatorNodeId');
  assertKnownNode(registry, request.executorNodeId, 'executorNodeId');
  assertAgentOnNode(registry, request.delegatorAgentId, request.delegatorNodeId);
  assertAgentOnNode(registry, request.executorAgentId, request.executorNodeId);
  if (request.delegatorNodeId === request.executorNodeId) {
    throw new Error('A2A delegation must cross a node boundary');
  }
  if (
    !Number.isSafeInteger(request.responseWindowMinutes) ||
    request.responseWindowMinutes < 1 ||
    !Number.isSafeInteger(request.resolutionWindowMinutes) ||
    request.resolutionWindowMinutes <= request.responseWindowMinutes
  ) {
    throw new Error('resolutionWindowMinutes must exceed a positive responseWindowMinutes');
  }
  if (
    !Number.isSafeInteger(request.maxDelegationDepth) ||
    request.maxDelegationDepth < 0 ||
    request.maxDelegationDepth > MAX_A2A_DELEGATION_DEPTH
  ) {
    throw new Error(`maxDelegationDepth must be an integer from 0 to ${MAX_A2A_DELEGATION_DEPTH}`);
  }
  const signedAtEpoch = assertIsoUtcTimestamp(request.signedAt, 'signedAt');
  const expiresAtEpoch = assertIsoUtcTimestamp(request.expiresAt, 'expiresAt');
  if (expiresAtEpoch <= signedAtEpoch) {
    throw new Error('expiresAt must be later than signedAt');
  }
  if (registry.slaContracts.some((contract) => contract.contractId === request.contractId)) {
    throw new Error(`SLA contract ${request.contractId} already exists`);
  }

  const executorClaim = registry.capabilityClaims.find(
    (claim) =>
      claim.agentId === request.executorAgentId &&
      claim.nodeId === request.executorNodeId &&
      claim.capabilityCode === request.capabilityCode &&
      claim.status === 'active'
  );
  if (!executorClaim) {
    throw new Error(`${request.executorAgentId} has no active claim for ${request.capabilityCode}`);
  }

  const contract: A2aSlaDelegationSeed = {
    contractId: request.contractId,
    delegatorNodeId: request.delegatorNodeId,
    delegatorAgentId: request.delegatorAgentId,
    executorNodeId: request.executorNodeId,
    executorAgentId: request.executorAgentId,
    capabilityCode: request.capabilityCode,
    responseWindowMinutes: request.responseWindowMinutes,
    resolutionWindowMinutes: request.resolutionWindowMinutes,
    calendar: request.calendar,
    riskClass: request.riskClass,
    status: 'active',
    maxDelegationDepth: request.maxDelegationDepth,
    signedAt: request.signedAt,
    expiresAt: request.expiresAt,
  };
  return {
    ...registry,
    slaContracts: [...registry.slaContracts, contract],
  };
}

export function evaluateA2aDelegation(
  registry: A2aCapabilityRegistry,
  contractId: string,
  observedAt: string
): A2aDelegationEvaluation {
  assertNonEmpty(contractId, 'contractId');
  const observedEpoch = assertIsoUtcTimestamp(observedAt, 'observedAt');
  const contract = registry.slaContracts.find((candidate) => candidate.contractId === contractId);
  if (!contract) {
    throw new Error(`SLA contract ${contractId} is not registered`);
  }

  const responseDueAt = addA2aCalendarMinutes(
    contract.signedAt,
    contract.responseWindowMinutes,
    contract.calendar,
    registry
  );
  const resolutionDueAt = addA2aCalendarMinutes(
    contract.signedAt,
    contract.resolutionWindowMinutes,
    contract.calendar,
    registry
  );
  const expiresAtEpoch = Date.parse(contract.expiresAt);
  let status: A2aDelegationState;
  if (contract.status === 'retired') {
    status = 'retired';
  } else if (observedEpoch >= expiresAtEpoch) {
    status = 'expired';
  } else if (contract.status === 'renewal_due') {
    status = 'renewal_due';
  } else {
    status = 'active';
  }

  return {
    contractId,
    status,
    responseDueAt,
    resolutionDueAt,
    responseOverdue: observedEpoch > Date.parse(responseDueAt),
    resolutionOverdue: observedEpoch > Date.parse(resolutionDueAt),
  };
}

export function recordA2aReputationEvent(
  registry: A2aCapabilityRegistry,
  event: A2aReputationEventInput
): A2aCapabilityRegistry {
  for (const [label, value] of [
    ['eventId', event.eventId],
    ['counterpartyAgentId', event.counterpartyAgentId],
    ['contractId', event.contractId],
    ['reason', event.reason],
  ] as const) {
    assertNonEmpty(value, label);
  }
  assertKnownAgent(registry, event.agentId, 'agentId');
  assertKnownAgent(registry, event.counterpartyAgentId, 'counterpartyAgentId');
  if (event.agentId === event.counterpartyAgentId) {
    throw new Error('reputation counterparty must be a different agent');
  }
  if (!registry.slaContracts.some((contract) => contract.contractId === event.contractId)) {
    throw new Error(`SLA contract ${event.contractId} is not registered`);
  }
  if (!Number.isSafeInteger(event.delta) || event.delta === 0 || Math.abs(event.delta) > 50) {
    throw new Error('delta must be a non-zero integer between -50 and 50');
  }
  if (event.outcome === 'fulfilled' && event.delta < 0) {
    throw new Error('fulfilled reputation events require a positive delta');
  }
  if (event.outcome === 'breached' && event.delta > 0) {
    throw new Error('breached reputation events require a negative delta');
  }
  assertIsoUtcTimestamp(event.recordedAt, 'recordedAt');
  if (registry.reputationLedger.some((entry) => entry.eventId === event.eventId)) {
    throw new Error(`reputation event ${event.eventId} is already recorded`);
  }

  const ledgerEntry: A2aReputationEventSeed = { ...event };
  return {
    ...registry,
    reputationLedger: [...registry.reputationLedger, ledgerEntry],
  };
}

export function computeA2aReputationScore(
  registry: A2aCapabilityRegistry,
  agentId: string
): number {
  assertKnownAgent(registry, agentId, 'agentId');
  const deltaTotal = registry.reputationLedger
    .filter((entry) => entry.agentId === agentId)
    .reduce((total, entry) => total + entry.delta, 0);
  return Math.max(0, Math.min(200, 100 + deltaTotal));
}
