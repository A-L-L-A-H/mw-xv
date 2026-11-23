import { createHash } from 'node:crypto';
import type {
  CausalCheckpoint,
  EpistemicPredictionSample,
  MonitorObligationRecord,
  SpeculativeBranchInput,
  StructuredIncidentLog,
  WorldModelObservation,
  WorldModelPrediction,
  WorldStateSnapshot,
} from '@moonwitness/ai-runtime';

export interface WorldSimFaultConfig {
  readonly injectObligationDrift?: boolean;
  readonly injectWorldModelSurprise?: boolean;
  readonly injectCausalDivergence?: boolean;
  readonly injectIncidentFaults?: boolean;
  readonly latencyJitterMs?: number;
  readonly driftProbability?: number;
}

export interface WorldSimScenarioRequest {
  readonly seed: number;
  readonly companyId?: number;
  readonly agentCount?: number;
  readonly faults?: WorldSimFaultConfig;
}

export interface SimulatedAgentProfile {
  readonly agentId: string;
  readonly role: 'planner' | 'builder' | 'verifier' | 'auditor';
  readonly baseLatencyMs: number;
  readonly observedLatencyMs: number;
  readonly calibrationNoise: number;
}

export interface WorldSimScenario {
  readonly seed: number;
  readonly companyId: number;
  readonly agents: readonly SimulatedAgentProfile[];
  readonly obligations: readonly MonitorObligationRecord[];
  readonly worldSnapshot: WorldStateSnapshot;
  readonly speculativeBranches: readonly SpeculativeBranchInput[];
  readonly worldPrediction: WorldModelPrediction;
  readonly worldObservation: WorldModelObservation;
  readonly causalCheckpoints: readonly CausalCheckpoint[];
  readonly calibrationSamples: readonly EpistemicPredictionSample[];
  readonly incidentLogs: readonly StructuredIncidentLog[];
  readonly scenarioSha256: string;
}

export function createSeededPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicHex(rng: () => number, bytes: number): string {
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    const val = Math.floor(rng() * 256);
    out += val.toString(16).padStart(2, '0');
  }
  return out;
}

export function generateWorldSimScenario(request: WorldSimScenarioRequest): WorldSimScenario {
  const seed = request.seed >>> 0;
  const rng = createSeededPrng(seed);
  const companyId = request.companyId ?? 1;
  const agentCount = Math.max(2, Math.min(12, request.agentCount ?? 4));
  const faults = request.faults ?? {};
  const latencyJitterMs = Math.max(0, faults.latencyJitterMs ?? 45);
  const driftProb = Math.max(0, Math.min(1, faults.driftProbability ?? 0.35));

  const roles: readonly SimulatedAgentProfile['role'][] = [
    'planner',
    'builder',
    'verifier',
    'auditor',
  ];

  const agents: SimulatedAgentProfile[] = [];
  for (let i = 0; i < agentCount; i += 1) {
    const baseLatencyMs = 80 + Math.floor(rng() * 90);
    const jitter = Math.floor(rng() * (latencyJitterMs + 1));
    agents.push({
      agentId: `sim-agent-${i + 1}`,
      role: roles[i % roles.length] ?? 'builder',
      baseLatencyMs,
      observedLatencyMs: baseLatencyMs + jitter,
      calibrationNoise: Number((rng() * 0.08).toFixed(4)),
    });
  }

  const expectedSha = deterministicHex(rng, 8);
  const trackedFileHash = deterministicHex(rng, 16);
  const driftedSha = faults.injectObligationDrift ? deterministicHex(rng, 8) : expectedSha;

  const obligations: readonly MonitorObligationRecord[] = [
    {
      id: `ob-sim-${seed}-1`,
      companyId,
      title: 'Primary mesh and repository integrity obligation',
      severity: 'high',
      expectedRepoGitSha: expectedSha,
      expectedTrackedFiles: {
        'packages/ai-runtime/src/index.ts': trackedFileHash,
      },
      expectedPaasNodeIds: ['node-alpha'],
      expectedPaasAppIds: ['app-gateway'],
    },
  ];

  const worldSnapshot: WorldStateSnapshot = {
    companyId,
    observedAt: '2026-11-23T00:00:00.000Z',
    repoGitSha: driftedSha,
    trackedFilesSha256: {
      'packages/ai-runtime/src/index.ts': trackedFileHash,
    },
    paasNodes: [
      {
        nodeId: 'node-alpha',
        hostname: 'alpha.mesh.internal',
        dockerStatus: 'healthy',
        easyTierMeshOnline: !faults.injectObligationDrift,
        apps: [
          {
            appId: 'app-gateway',
            name: 'gateway',
            healthy: !faults.injectObligationDrift,
            status: faults.injectObligationDrift ? 'degraded' : 'healthy',
          },
        ],
      },
    ],
  };

  const speculativeBranches: readonly SpeculativeBranchInput[] = [
    {
      branchId: `br-sim-${seed}-a`,
      worktreeRef: 'wt-a',
      proofGatePassed: true,
      scopeClean: true,
      testsPassed: 18,
      testsTotal: 18,
      latencyMs: agents[0]?.observedLatencyMs ?? 110,
      costUsd: 0.012,
      qualityScoreBps: 9400,
    },
    {
      branchId: `br-sim-${seed}-b`,
      worktreeRef: 'wt-b',
      proofGatePassed: true,
      scopeClean: true,
      testsPassed: 16,
      testsTotal: 18,
      latencyMs: (agents[1]?.observedLatencyMs ?? 140) + 30,
      costUsd: 0.019,
      qualityScoreBps: 8100,
    },
    {
      branchId: `br-sim-${seed}-c`,
      worktreeRef: 'wt-c',
      proofGatePassed: false,
      scopeClean: false,
      testsPassed: 10,
      testsTotal: 18,
      latencyMs: 250,
      costUsd: 0.031,
      qualityScoreBps: 5000,
    },
  ];

  const worldPrediction: WorldModelPrediction = {
    predictionId: `pred-sim-${seed}`,
    companyId,
    runId: `run-sim-${seed}`,
    actionSummary: 'Apply bounded evaluation patch',
    expectedChangedFiles: ['packages/ai-evaluation/src/world-sim.ts'],
    expectedHttpHealth: [{ endpoint: '/healthz', expectedHealthy: true, expectedStatusCode: 200 }],
    expectedInvariants: [{ id: 'inv-zero-secrets', expectedPass: true }],
  };

  const triggerSurprise = Boolean(faults.injectWorldModelSurprise);
  const worldObservation: WorldModelObservation = {
    observedAt: '2026-11-23T00:01:00.000Z',
    observedChangedFiles: triggerSurprise
      ? ['packages/ai-evaluation/src/world-sim.ts', 'unexpected/side-effect.ts']
      : ['packages/ai-evaluation/src/world-sim.ts'],
    observedHttpHealth: [
      {
        endpoint: '/healthz',
        healthy: !triggerSurprise,
        statusCode: triggerSurprise ? 503 : 200,
      },
    ],
    observedInvariants: [{ id: 'inv-zero-secrets', passed: true }],
  };

  const injectDivergence = faults.injectCausalDivergence ?? true;
  const causalCheckpoints: readonly CausalCheckpoint[] = [
    {
      stepIndex: 0,
      checkpointId: `cp-${seed}-0`,
      commitSha: expectedSha,
      proofGatePassed: true,
      worldModelSurpriseBps: 200,
      summary: 'Initial clean baseline',
    },
    {
      stepIndex: 1,
      checkpointId: `cp-${seed}-1`,
      commitSha: deterministicHex(rng, 8),
      proofGatePassed: !injectDivergence,
      worldModelSurpriseBps: injectDivergence ? 7800 : 350,
      summary: injectDivergence ? 'Environment drift triggered proof gate failure' : 'Clean step',
      environmentDriftSignals: injectDivergence
        ? ['mesh_latency_spike', 'node_alpha_degraded']
        : [],
    },
  ];

  const calibrationSamples: EpistemicPredictionSample[] = [];
  for (let i = 0; i < 10; i += 1) {
    const p = Number((0.15 + i * 0.08).toFixed(2));
    const clampedP = Math.min(0.95, p);
    const outcome: 0 | 1 = rng() < clampedP ? 1 : 0;
    calibrationSamples.push({
      predictionId: `cal-${seed}-${i}`,
      predictedProbability: clampedP,
      outcome,
      domain: i % 2 === 0 ? 'mesh' : 'repo',
    });
  }

  const incidentLogs: readonly StructuredIncidentLog[] =
    faults.injectIncidentFaults === false
      ? [
          {
            timestamp: '2026-11-23T00:02:00.000Z',
            service: 'gateway',
            level: 'info',
            message: 'All synthetic probes nominal',
          },
        ]
      : [
          {
            timestamp: '2026-11-23T00:02:00.000Z',
            service: 'gateway',
            level: 'error',
            errorCode: 'MESH_TIMEOUT',
            message: `Mesh timeout after ${Math.round(driftProb * 1000)}ms with token sk-secret-99887766554433221100`,
          },
          {
            timestamp: '2026-11-23T00:02:05.000Z',
            service: 'gateway',
            level: 'error',
            errorCode: 'MESH_TIMEOUT',
            message: 'Mesh timeout on peer relay node-alpha',
          },
        ];

  const basePayload = {
    seed,
    companyId,
    agents,
    obligations,
    worldSnapshot,
    speculativeBranches,
    worldPrediction,
    worldObservation,
    causalCheckpoints,
    calibrationSamples,
    incidentLogs,
  };

  const scenarioSha256 = createHash('sha256').update(JSON.stringify(basePayload)).digest('hex');

  return {
    ...basePayload,
    scenarioSha256,
  };
}
