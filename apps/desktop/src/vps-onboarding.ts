import { isIP } from 'node:net';
import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import {
  DesktopRiskGate,
  redactSensitiveText,
  redactSensitiveValue,
} from './risk-gate.js';
import type {
  DataClassification,
  DesktopCapabilityGrant,
  HumanApprovalToken,
  RiskEvaluationDecision,
} from './types.js';

export type VpsComposeAction = 'up' | 'restart' | 'rebuild' | 'down';

export type VpsHealthState = 'healthy' | 'degraded' | 'starting' | 'offline' | 'unknown';

export interface VpsOnboardingEndpointConfig {
  readonly nodeId: string;
  readonly controlPlaneUrl: string;
  readonly remoteApiUrl?: string;
  readonly adminToken: string;
}

export interface VpsOnboardingAuthContext {
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

export interface VpsOnboardingStatus {
  readonly nodeId: string;
  readonly meshIp: string;
  readonly apiHealth: VpsHealthState;
  readonly boardHealth: VpsHealthState;
  readonly controlPlaneHealth: VpsHealthState;
  readonly superadminBootstrapped: boolean;
  readonly composeServices: readonly string[];
  readonly redactedSummary?: string;
  readonly decision: RiskEvaluationDecision;
}

export interface VpsSuperadminBootstrapInput {
  readonly login: string;
  readonly password: string;
  readonly displayName?: string;
}

export interface VpsSuperadminBootstrapResult {
  readonly bootstrapped: boolean;
  readonly login: string;
  readonly message: string;
  readonly decision: RiskEvaluationDecision;
}

export interface VpsComposeControlInput {
  readonly action: VpsComposeAction;
  readonly services?: readonly string[];
}

export interface VpsComposeControlResult {
  readonly action: VpsComposeAction;
  readonly services: readonly string[];
  readonly status: string;
  readonly output: string;
  readonly decision: RiskEvaluationDecision;
}

export type VpsOnboardingFetchFn = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

function isAllowedPrivateMeshIPv4(ip: string): boolean {
  if (ip === '127.0.0.1') {
    return true;
  }
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

function isAllowedPrivateMeshIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (isIP(normalized) !== 6) return false;
  const firstGroup = normalized.split(':')[0] ?? '';
  if (firstGroup.length !== 4) return false;
  return firstGroup.startsWith('fd');
}

/**
 * Validates that a host string is a private mesh IP (10.x, 100.64-127.x,
 * 172.16-31.x, 192.168.x, fd00::/8) or 127.0.0.1 for local tests.
 * Fails closed on public IPs and DNS hostnames.
 */
export function isAllowedVpsMeshHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/gu, '').trim();
  const version = isIP(normalized);
  if (version === 4) {
    return isAllowedPrivateMeshIPv4(normalized);
  }
  if (version === 6) {
    return isAllowedPrivateMeshIPv6(normalized);
  }
  return false;
}

/**
 * Validates that a VPS onboarding URL targets an allowed private mesh IP
 * over http: or https: without embedded credentials or fragments.
 */
export function assertVpsMeshEndpoint(endpointUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new ValidationError(`Invalid VPS onboarding URL: ${redactSensitiveText(endpointUrl).text}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AccessDeniedError(
      `VPS onboarding protocol '${parsed.protocol}' is not allowed; expected http: or https:`,
      { code: 'access_denied' }
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new AccessDeniedError(
      'VPS onboarding URL must not contain embedded credentials',
      { code: 'access_denied' }
    );
  }

  if (parsed.hash !== '') {
    throw new AccessDeniedError(
      'VPS onboarding URL must not contain a fragment',
      { code: 'access_denied' }
    );
  }

  if (!isAllowedVpsMeshHost(parsed.hostname)) {
    throw new AccessDeniedError(
      `VPS onboarding host '${parsed.hostname}' is outside allowed private mesh CIDRs`,
      { code: 'access_denied' }
    );
  }

  return parsed;
}

function normalizeHealthState(value: unknown): VpsHealthState {
  if (
    value === 'healthy' ||
    value === 'degraded' ||
    value === 'starting' ||
    value === 'offline' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export class VpsOnboardingClient {
  private readonly riskGate: DesktopRiskGate;
  private readonly fetchFn: VpsOnboardingFetchFn;
  private readonly controlPlaneUrl: URL;
  private readonly remoteApiUrl: URL | null;
  private readonly nodeId: string;
  private readonly adminToken: string;

  constructor(
    config: VpsOnboardingEndpointConfig,
    options: {
      readonly riskGate: DesktopRiskGate;
      readonly fetchFn?: VpsOnboardingFetchFn;
    }
  ) {
    if (config.nodeId.trim() === '') {
      throw new ValidationError('nodeId must be a non-empty string');
    }
    if (config.adminToken.trim() === '') {
      throw new ValidationError('adminToken must be a non-empty string');
    }

    this.nodeId = config.nodeId.trim();
    this.adminToken = config.adminToken;
    this.controlPlaneUrl = assertVpsMeshEndpoint(config.controlPlaneUrl);
    this.remoteApiUrl = config.remoteApiUrl
      ? assertVpsMeshEndpoint(config.remoteApiUrl)
      : null;
    this.riskGate = options.riskGate;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  private buildUrl(base: URL, path: string): string {
    const normalizedBase = base.toString().replace(/\/+$/u, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    knownSecrets: readonly string[]
  ): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.adminToken}`);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.fetchFn(url, {
      ...init,
      headers,
    });

    const rawText = await response.text();
    const redactedText = redactSensitiveText(rawText, [this.adminToken, ...knownSecrets]).text;

    if (!response.ok) {
      throw new Error(
        `VPS onboarding request failed (${response.status}): ${redactedText || response.statusText}`
      );
    }

    if (rawText.trim() === '') {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { raw: redactedText };
    }

    const redacted = redactSensitiveValue(parsed, [this.adminToken, ...knownSecrets]);
    return asRecord(redacted.value);
  }

  /**
   * Reads remote VPS onboarding and stack health status (R0 read).
   */
  async getOnboardingStatus(auth: VpsOnboardingAuthContext): Promise<VpsOnboardingStatus> {
    const decision = this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: 'sidecar.read',
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });

    const url = this.buildUrl(this.controlPlaneUrl, '/api/onboarding/status');
    const payload = await this.requestJson(url, { method: 'GET' }, []);

    const composeServicesRaw = payload['composeServices'];
    const composeServices = Array.isArray(composeServicesRaw)
      ? composeServicesRaw.filter((entry): entry is string => typeof entry === 'string')
      : [];

    const summaryRaw = payload['redactedSummary'];
    const redactedSummary =
      typeof summaryRaw === 'string'
        ? redactSensitiveText(summaryRaw, [this.adminToken]).text
        : undefined;

    return {
      nodeId: this.nodeId,
      meshIp:
        typeof payload['meshIp'] === 'string'
          ? payload['meshIp']
          : this.controlPlaneUrl.hostname.replace(/^\[|\]$/gu, ''),
      apiHealth: normalizeHealthState(payload['apiHealth']),
      boardHealth: normalizeHealthState(payload['boardHealth']),
      controlPlaneHealth: normalizeHealthState(payload['controlPlaneHealth'] ?? 'healthy'),
      superadminBootstrapped: payload['superadminBootstrapped'] === true,
      composeServices,
      redactedSummary,
      decision,
    };
  }

  /**
   * Bootstraps the remote Superadmin account on the VPS (R3 mutation).
   */
  async bootstrapSuperadmin(
    input: VpsSuperadminBootstrapInput,
    auth: VpsOnboardingAuthContext
  ): Promise<VpsSuperadminBootstrapResult> {
    const login = input.login.trim();
    const password = input.password;
    if (login.length < 3) {
      throw new ValidationError('Superadmin login must be at least 3 characters');
    }
    if (password.length < 12) {
      throw new ValidationError('Superadmin password must be at least 12 characters');
    }

    const decision = this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: 'upstream.sync_push',
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      ...(auth.humanApproval !== undefined ? { humanApproval: auth.humanApproval } : {}),
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });

    const targetBase = this.remoteApiUrl ?? this.controlPlaneUrl;
    const url = this.buildUrl(targetBase, '/api/onboarding/superadmin');
    const payload = await this.requestJson(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          login,
          password,
          displayName: input.displayName?.trim() || undefined,
        }),
      },
      [password]
    );

    const rawMessage =
      typeof payload['message'] === 'string'
        ? payload['message']
        : 'Superadmin bootstrap completed.';

    return {
      bootstrapped: payload['bootstrapped'] !== false,
      login,
      message: redactSensitiveText(rawMessage, [this.adminToken, password]).text,
      decision,
    };
  }

  /**
   * Controls the remote Docker Compose stack (R2 for up/restart, R3 for down/rebuild).
   */
  async controlComposeStack(
    input: VpsComposeControlInput,
    auth: VpsOnboardingAuthContext
  ): Promise<VpsComposeControlResult> {
    const isHighImpact = input.action === 'down' || input.action === 'rebuild';
    const actionKind = isHighImpact ? 'upstream.sync_push' : 'service.local_start';

    const decision = this.riskGate.assertAllowed({
      runId: auth.runId,
      companyId: auth.companyId,
      agentId: auth.agentId,
      ...(auth.workContractId !== undefined ? { workContractId: auth.workContractId } : {}),
      action: actionKind,
      expectedPolicyVersion: auth.expectedPolicyVersion,
      dataClassification: auth.dataClassification,
      grant: auth.grant,
      ...(auth.humanApproval !== undefined ? { humanApproval: auth.humanApproval } : {}),
      ...(auth.now !== undefined ? { now: auth.now } : {}),
    });

    const services = (input.services ?? ['postgres', 'api', 'board']).filter(
      (service) => service.trim() !== ''
    );
    const url = this.buildUrl(this.controlPlaneUrl, '/api/onboarding/compose');
    const payload = await this.requestJson(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          action: input.action,
          services,
        }),
      },
      []
    );

    const rawOutput = typeof payload['output'] === 'string' ? payload['output'] : '';

    return {
      action: input.action,
      services,
      status: typeof payload['status'] === 'string' ? payload['status'] : 'ok',
      output: redactSensitiveText(rawOutput, [this.adminToken]).text,
      decision,
    };
  }
}
