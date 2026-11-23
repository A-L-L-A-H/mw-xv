import { isIP } from 'node:net';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import { DesktopRiskGate, redactSensitiveText } from './risk-gate.js';
import type {
  DataClassification,
  DesktopCapabilityGrant,
  HumanApprovalToken,
  RiskEvaluationDecision,
} from './types.js';

export interface MeshNodeConfig {
  readonly nodeId: string;
  readonly baseUrl: string;
  readonly adminToken: string;
  readonly label?: string;
}

export interface MeshNodeHealth {
  readonly status: string;
  readonly docker?: string;
  readonly database?: {
    readonly status: string;
    readonly error?: string;
  };
}

export interface MeshNodeStatus {
  readonly enabled: boolean;
  readonly backend: string;
  readonly status: string;
  readonly network_name?: string;
  readonly secret_configured: boolean;
  readonly network_secret?: string;
  readonly hostname?: string;
  readonly ipv4?: string;
  readonly peers?: readonly string[];
  readonly container_id?: string;
  readonly container_state?: string;
  readonly error?: string;
}

export interface MeshRemoteService {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
}

export interface MeshDeployPayload {
  readonly name?: string;
  readonly image: string;
  readonly command?: readonly string[];
  readonly env?: readonly string[];
  readonly ports?: readonly string[];
  readonly volumes?: readonly string[];
  readonly restart?: string;
}

export interface MeshDeployResult {
  readonly name: string;
  readonly status?: string;
  readonly container_id?: string;
}

export interface MeshServiceRegistration {
  readonly name: string;
  readonly image: string;
  readonly command?: string;
  readonly env?: string;
  readonly ports?: string;
  readonly volumes?: string;
  readonly restart?: string;
}

export interface MeshFleetAuthContext {
  readonly runId: string;
  readonly companyId: number;
  readonly agentId: number;
  readonly workContractId?: number;
  readonly expectedPolicyVersion: number;
  readonly dataClassification: DataClassification;
  readonly grant: DesktopCapabilityGrant;
  readonly humanApproval?: HumanApprovalToken;
  readonly now?: Date;
}

export type MeshFetchFn = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * Checks whether an IPv4 address belongs to one of the allowed private mesh CIDRs:
 * - 10.0.0.0/8
 * - 100.64.0.0/10
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 */
function isPrivateMeshIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Checks whether an IPv6 address belongs to fd00::/8 (Unique Local Address).
 */
function isPrivateMeshIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (isIP(normalized) !== 6) return false;
  // Reject IPv4-mapped IPv6 addresses unless explicitly checking fd00::/8 prefix
  const firstGroup = normalized.split(':')[0] ?? '';
  if (firstGroup.length !== 4) return false;
  return firstGroup.startsWith('fd');
}

/**
 * Validates that a host string is strictly a private mesh IP address.
 * Fails closed on public IPs, loopback addresses, and DNS hostnames.
 */
export function isPrivateMeshIp(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/gu, '').trim();
  const version = isIP(normalized);
  if (version === 4) {
    return isPrivateMeshIPv4(normalized);
  }
  if (version === 6) {
    return isPrivateMeshIPv6(normalized);
  }
  return false;
}

/**
 * Validates that a remote control-plane endpoint URL targets a private mesh IP
 * over http: or https: without embedded credentials or fragments.
 * Throws AccessDeniedError (fail-closed) on any public IP or invalid URL.
 */
export function assertPrivateMeshEndpoint(endpointUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new ValidationError(`Invalid mesh endpoint URL: ${endpointUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AccessDeniedError(
      `Mesh endpoint protocol '${parsed.protocol}' is not allowed; expected http: or https:`,
      { code: 'access_denied' }
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new AccessDeniedError(
      'Mesh endpoint URL must not contain credentials or URL fragments',
      { code: 'access_denied' }
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (!isPrivateMeshIp(host)) {
    throw new AccessDeniedError(
      `Mesh endpoint host '${host}' is not a private mesh IP (allowed: 10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12, 192.168.0.0/16, fd00::/8)`,
      {
        code: 'access_denied',
        details: { host, reasonCode: 'MESH_NON_PRIVATE_IP' },
      }
    );
  }
  return parsed;
}

/**
 * MeshFleetClient queries and manages remote MoonWitness control-plane nodes
 * strictly over private EasyTier mesh IPs, gating read (R0) vs mutate/deploy (R2/R3)
 * operations through DesktopRiskGate.
 */
export class MeshFleetClient {
  private readonly nodes = new Map<string, MeshNodeConfig>();
  private readonly riskGate: DesktopRiskGate;
  private readonly fetchImpl: MeshFetchFn;
  private readonly timeoutMs: number;

  constructor(options: {
    readonly riskGate: DesktopRiskGate;
    readonly nodes?: readonly MeshNodeConfig[];
    readonly fetchImpl?: MeshFetchFn;
    readonly timeoutMs?: number;
  }) {
    this.riskGate = options.riskGate;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    for (const node of options.nodes ?? []) {
      this.registerNode(node);
    }
  }

  registerNode(node: MeshNodeConfig): void {
    const id = node.nodeId.trim();
    if (!id) {
      throw new ValidationError('nodeId is required');
    }
    if (!node.adminToken.trim()) {
      throw new ValidationError(`adminToken is required for mesh node '${id}'`);
    }
    const parsed = assertPrivateMeshEndpoint(node.baseUrl);
    const normalizedBase = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/u, '')}`;
    this.nodes.set(id, {
      nodeId: id,
      baseUrl: normalizedBase,
      adminToken: node.adminToken.trim(),
      ...(node.label !== undefined ? { label: node.label } : {}),
    });
  }

  listNodes(): readonly Omit<MeshNodeConfig, 'adminToken'>[] {
    return Array.from(this.nodes.values()).map((node) => ({
      nodeId: node.nodeId,
      baseUrl: node.baseUrl,
      ...(node.label !== undefined ? { label: node.label } : {}),
    }));
  }

  private resolveNode(nodeId: string): MeshNodeConfig {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new ValidationError(`Unknown mesh node '${nodeId}'`);
    }
    assertPrivateMeshEndpoint(node.baseUrl);
    return node;
  }

  private gateRead(auth: MeshFleetAuthContext): RiskEvaluationDecision {
    return this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: 'sidecar.read',
      dataClassification: auth.dataClassification,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      grant: auth.grant,
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });
  }

  private gateMutate(auth: MeshFleetAuthContext): RiskEvaluationDecision {
    return this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: 'service.local_start',
      dataClassification: auth.dataClassification,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      grant: auth.grant,
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });
  }

  private gateDeploy(auth: MeshFleetAuthContext, endpointUrl: string): RiskEvaluationDecision {
    return this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: 'network.egress',
      targetEndpointUrl: endpointUrl,
      dataClassification: auth.dataClassification,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      grant: auth.grant,
      ...(auth.humanApproval !== undefined ? { humanApproval: auth.humanApproval } : {}),
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });
  }

  private async requestJson<T>(
    node: MeshNodeConfig,
    path: string,
    init: {
      readonly method: 'GET' | 'POST' | 'DELETE';
      readonly body?: unknown;
      readonly authenticated?: boolean;
    }
  ): Promise<T> {
    const url = `${node.baseUrl}${path}`;
    assertPrivateMeshEndpoint(url);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (init.authenticated !== false) {
      headers['Authorization'] = `Bearer ${node.adminToken}`;
    }
    let bodyStr: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(init.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        headers,
        ...(bodyStr !== undefined ? { body: bodyStr } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const safeErr = redactSensitiveText(text, [node.adminToken]).text;
        throw new Error(`Mesh node '${node.nodeId}' ${init.method} ${path} failed (${response.status}): ${safeErr}`);
      }
      if (!text.trim()) {
        return {} as T;
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** R0 read: check remote node /health */
  async getNodeHealth(
    nodeId: string,
    auth: MeshFleetAuthContext
  ): Promise<{ readonly data: MeshNodeHealth; readonly decision: RiskEvaluationDecision }> {
    const node = this.resolveNode(nodeId);
    const decision = this.gateRead(auth);
    const data = await this.requestJson<MeshNodeHealth>(node, '/health', {
      method: 'GET',
      authenticated: false,
    });
    return { data, decision };
  }

  /** R0 read: query remote node /mesh/status */
  async getNodeMeshStatus(
    nodeId: string,
    auth: MeshFleetAuthContext
  ): Promise<{ readonly data: MeshNodeStatus; readonly decision: RiskEvaluationDecision }> {
    const node = this.resolveNode(nodeId);
    const decision = this.gateRead(auth);
    const data = await this.requestJson<MeshNodeStatus>(node, '/mesh/status', {
      method: 'GET',
    });
    return { data, decision };
  }

  /** R0 read: list remote node Docker containers */
  async listNodeServices(
    nodeId: string,
    auth: MeshFleetAuthContext
  ): Promise<{ readonly data: readonly MeshRemoteService[]; readonly decision: RiskEvaluationDecision }> {
    const node = this.resolveNode(nodeId);
    const decision = this.gateRead(auth);
    const raw = await this.requestJson<readonly MeshRemoteService[] | null>(node, '/services', {
      method: 'GET',
    });
    return { data: raw ?? [], decision };
  }

  /** R2 mutate: register a service definition in remote control-plane SQLite */
  async registerNodeService(
    nodeId: string,
    service: MeshServiceRegistration,
    auth: MeshFleetAuthContext
  ): Promise<{ readonly data: { readonly name: string; readonly status: string }; readonly decision: RiskEvaluationDecision }> {
    const node = this.resolveNode(nodeId);
    const decision = this.gateMutate(auth);
    const data = await this.requestJson<{ readonly name: string; readonly status: string }>(
      node,
      '/api/services',
      {
        method: 'POST',
        body: service,
      }
    );
    return { data, decision };
  }

  /** R3 deploy: deploy/replace a Docker container on a remote mesh node (requires HumanApprovalToken) */
  async deployNodeService(
    nodeId: string,
    payload: MeshDeployPayload,
    auth: MeshFleetAuthContext
  ): Promise<{ readonly data: MeshDeployResult; readonly decision: RiskEvaluationDecision }> {
    const node = this.resolveNode(nodeId);
    const deployUrl = `${node.baseUrl}/api/deploy`;
    const decision = this.gateDeploy(auth, deployUrl);
    const data = await this.requestJson<MeshDeployResult>(node, '/api/deploy', {
      method: 'POST',
      body: payload,
    });
    return { data, decision };
  }
}
