import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CONTROL_PLANE_INTERNAL_AUTH_DOMAIN = 'moonwitness-control-plane-admin-v1';

/** Marker used for every redacted secret. Never contains key material. */
export const CLOUD_SECRET_REDACTION_MARKER = '[REDACTED]';

const MIN_SECRET_LENGTH = 16;
const WEAK_SECRETS = new Set([
  'changeme',
  'password',
  'password123',
  'secret',
  'secretkey',
  'admin',
  'test',
  'testing',
  'development',
  'placeholder',
  'internal-token',
]);

export type SecretQuality = 'missing' | 'malformed' | 'weak' | 'ok';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Classifies secret material without ever returning or logging the value.
 * Used by privileged-operation and startup gates so malformed/weak secrets fail closed.
 */
export function classifySecret(value: string | undefined | null): SecretQuality {
  if (!value || value.trim().length === 0) return 'missing';
  const trimmed = value.trim();
  if (hasControlCharacter(trimmed)) return 'malformed';
  if (
    trimmed.length < MIN_SECRET_LENGTH ||
    WEAK_SECRETS.has(trimmed.toLowerCase()) ||
    /^(.)\1+$/u.test(trimmed)
  ) {
    return 'weak';
  }
  return 'ok';
}

/**
 * Removes known secret values and common secret-bearing syntax from text before
 * it reaches logs, API errors, audit payloads or stored deployment output.
 */
export function redactSecrets(
  input: string | undefined | null,
  secrets: readonly (string | undefined | null)[] = []
): string {
  let output = typeof input === 'string' ? input : '';
  const marker = CLOUD_SECRET_REDACTION_MARKER;

  const known = secrets
    .filter((secret): secret is string => typeof secret === 'string' && secret.trim().length >= 3)
    .map((secret) => secret.trim())
    .sort((a, b) => b.length - a.length);
  for (const secret of known) {
    output = output.split(secret).join(marker);
    output = output.split(encodeURIComponent(secret)).join(marker);
  }

  // URL userinfo (scheme://user:password@host).
  output = output.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/giu, `$1${marker}@`);
  // Authorization schemes.
  output = output.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
    (_match, scheme: string) => `${scheme} ${marker}`
  );
  // key=value / "key": "value" forms for sensitive field names.
  output = output.replace(
    /\b(authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|secret[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|password|passwd|pwd|token|signature)\b["']?(\s*[:=]\s*)(["']?)([^\s"',;}]+)/giu,
    (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}${marker}`
  );

  return output;
}

export interface ControlPlaneTokenOptions {
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  /** Previous key material, accepted during an overlap/rotation window only. */
  readonly previousAdminToken?: string;
  readonly previousJwtSecret?: string;
}

/**
 * Token contract (shared by the cloud HTTP plugin, probe, jobs and mesh provider):
 *   1. explicit admin token (option or MW_CONTROL_PLANE_TOKEN);
 *   2. HMAC-SHA256 of the shared internal secret (MW_INTERNAL_SECRET / JWT_SECRET)
 *      over a fixed domain separator.
 * The returned value is never logged, serialized into records or used as a metric label.
 */
export function resolveControlPlaneToken(
  options: ControlPlaneTokenOptions = {}
): string | undefined {
  const explicit = options?.adminToken?.trim() ?? process.env.MW_CONTROL_PLANE_TOKEN?.trim();
  if (explicit && explicit.length > 0) return explicit;

  const secret =
    process.env.MW_INTERNAL_SECRET?.trim() ??
    options?.jwtSecret?.trim() ??
    process.env.JWT_SECRET?.trim();
  if (secret && secret.length > 0) {
    return createHmac('sha256', secret).update(CONTROL_PLANE_INTERNAL_AUTH_DOMAIN).digest('hex');
  }
  return undefined;
}

/** Current plus previous (rotating) token candidates, de-duplicated. */
export function resolveControlPlaneTokenCandidates(
  options: ControlPlaneTokenOptions = {}
): readonly string[] {
  const candidates: string[] = [];
  for (const token of [
    resolveControlPlaneToken(options),
    resolveControlPlaneToken({
      adminToken: options.previousAdminToken,
      jwtSecret: options.previousJwtSecret,
    }),
  ]) {
    if (token && !candidates.includes(token)) candidates.push(token);
  }
  return candidates;
}

/** Timing-safe verification supporting overlap/revocation during rotation. */
export function verifyControlPlaneToken(
  provided: string | undefined | null,
  options: ControlPlaneTokenOptions = {}
): boolean {
  if (!provided || typeof provided !== 'string') return false;
  const providedDigest = createHash('sha256').update(provided).digest();
  return resolveControlPlaneTokenCandidates(options).some((candidate) =>
    timingSafeEqual(providedDigest, createHash('sha256').update(candidate).digest())
  );
}

/** Safe token metadata for readiness/diagnostics: no key material is returned. */
export function describeControlPlaneToken(
  options: ControlPlaneTokenOptions & { readonly rotationVersion?: string } = {}
): {
  readonly configured: boolean;
  readonly source: 'explicit' | 'derived' | 'none';
  readonly strength: SecretQuality;
  readonly rotationVersion: string;
  readonly overlapEnabled: boolean;
} {
  const explicit = options.adminToken?.trim() ?? process.env.MW_CONTROL_PLANE_TOKEN?.trim();
  const token = resolveControlPlaneToken(options);
  return {
    configured: Boolean(token),
    source: explicit ? 'explicit' : token ? 'derived' : 'none',
    strength: classifySecret(token),
    rotationVersion: options.rotationVersion?.trim() || 'default',
    overlapEnabled: Boolean(options.previousAdminToken || options.previousJwtSecret),
  };
}

export function controlPlaneAuthHeaders(
  token: string | undefined,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (extra) Object.assign(headers, extra);
  return headers;
}

/* -------------------------------------------------------------------------- */
/* Startup configuration validation and readiness                             */
/* -------------------------------------------------------------------------- */

export const CLOUD_FEATURES = [
  'controlPlane',
  'provisioning',
  'providerProbe',
  'terraformExport',
  'meshProvisioning',
  'metrics',
] as const;

export type CloudFeature = (typeof CLOUD_FEATURES)[number];
export type CloudFeatureFlags = Record<CloudFeature, boolean>;

export const CLOUD_CONFIG_REASON_CODES = [
  'CLOUD_FEATURE_DISABLED',
  'CLOUD_CONFIG_INVALID',
  'CLOUD_CP_URL_MISSING',
  'CLOUD_CP_URL_MALFORMED',
  'CLOUD_CP_URL_INSECURE',
  'CLOUD_CP_URL_CREDENTIALS',
  'CLOUD_CP_PORT_INVALID',
  'CLOUD_TOKEN_MISSING',
  'CLOUD_TOKEN_WEAK',
  'CLOUD_TOKEN_MALFORMED',
  'CLOUD_SECRET_REF_MISSING',
  'CLOUD_METRICS_TOKEN_MISSING',
  'CLOUD_PROBE_HOST_INVALID',
  'CLOUD_FEATURE_DEPENDENCY_MISSING',
] as const;

export type CloudConfigReasonCode = (typeof CLOUD_CONFIG_REASON_CODES)[number];

/** The metrics endpoint must be gated by its own configured token; see ops doc. */
export const CLOUD_METRICS_AUTH_REQUIREMENT = Object.freeze({
  header: 'authorization',
  scheme: 'Bearer',
  tokenConfigKeys: ['MW_METRICS_TOKEN', 'metricsToken'] as const,
  failClosedWhenUnconfigured: true,
  labelContract: 'operation,outcome,provider are fixed enums; no tenant/resource/URL values',
});

export interface CloudConfigIssue {
  readonly code: CloudConfigReasonCode;
  /** Field name only; never a value. */
  readonly field: string;
  /** Actionable but non-sensitive guidance. */
  readonly message: string;
}

export interface CloudConfigInput extends ControlPlaneTokenOptions {
  readonly controlPlaneUrl?: string;
  readonly adminTokenRef?: string;
  readonly jwtSecretRef?: string;
  readonly metricsToken?: string;
  readonly features?: Partial<CloudFeatureFlags>;
  readonly allowedProbeHosts?: readonly string[];
  readonly rotationVersion?: string;
}

export interface ValidatedCloudConfig {
  readonly controlPlaneUrl?: string;
  readonly features: CloudFeatureFlags;
  /** Resolved key material, held in memory only; never emitted by diagnostics. */
  readonly adminToken?: string;
  readonly metricsToken?: string;
  readonly allowedProbeHosts: readonly string[];
  readonly rotationVersion: string;
}

export interface CloudConfigValidation {
  readonly ok: boolean;
  readonly value?: ValidatedCloudConfig;
  readonly issues: readonly CloudConfigIssue[];
  readonly reasonCodes: readonly CloudConfigReasonCode[];
}

export interface CloudReadiness {
  readonly ready: boolean;
  readonly reasonCodes: readonly CloudConfigReasonCode[];
  readonly enabledFeatures: readonly CloudFeature[];
}

function disabledFeatures(): CloudFeatureFlags {
  return {
    controlPlane: false,
    provisioning: false,
    providerProbe: false,
    terraformExport: false,
    meshProvisioning: false,
    metrics: false,
  };
}

function resolveFeatures(input: CloudConfigInput, env: NodeJS.ProcessEnv): CloudFeatureFlags {
  const flags = disabledFeatures();
  if (input.features) {
    for (const feature of CLOUD_FEATURES) flags[feature] = input.features[feature] === true;
    return flags;
  }
  // Backwards compatibility: supplying a control-plane URL/token opts into the
  // core cloud features. With no cloud configuration at all, all features stay
  // disabled so unrelated API processes can start normally.
  const hasCloudConfig = Boolean(
    input.controlPlaneUrl ||
    input.adminToken ||
    input.jwtSecret ||
    env.MW_CONTROL_PLANE_URL ||
    env.MW_CONTROL_PLANE_TOKEN ||
    env.MW_INTERNAL_SECRET ||
    env.JWT_SECRET
  );
  if (hasCloudConfig) {
    flags.controlPlane = true;
    flags.provisioning = true;
    flags.providerProbe = true;
    flags.terraformExport = true;
  }
  return flags;
}

function isHostnameLike(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*$/iu.test(host) && !host.includes('..');
}

export function validateCloudConfig(
  input: CloudConfigInput = {},
  env: NodeJS.ProcessEnv = process.env
): CloudConfigValidation {
  const issues: CloudConfigIssue[] = [];
  const add = (code: CloudConfigReasonCode, field: string, message: string) => {
    if (!issues.some((issue) => issue.code === code && issue.field === field)) {
      issues.push({ code, field, message });
    }
  };
  const features = resolveFeatures(input, env);

  let controlPlaneUrl: string | undefined;
  if (features.controlPlane || features.provisioning || features.providerProbe) {
    const raw = input.controlPlaneUrl?.trim() || env.MW_CONTROL_PLANE_URL?.trim();
    if (!raw) {
      add(
        'CLOUD_CP_URL_MISSING',
        'controlPlaneUrl',
        'Configure the control-plane URL (controlPlaneUrl / MW_CONTROL_PLANE_URL) before enabling cloud features.'
      );
    } else {
      const parsed = (() => {
        try {
          return new URL(raw);
        } catch {
          add(
            'CLOUD_CP_URL_MALFORMED',
            'controlPlaneUrl',
            'Control-plane URL must be an absolute http(s) URL.'
          );
          return undefined;
        }
      })();
      if (parsed) {
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          add(
            'CLOUD_CP_URL_INSECURE',
            'controlPlaneUrl',
            'Control-plane URL must use http or https.'
          );
        }
        if (parsed.username || parsed.password) {
          add(
            'CLOUD_CP_URL_CREDENTIALS',
            'controlPlaneUrl',
            'Control-plane URL must not embed credentials; use a secret reference instead.'
          );
        }
        if (parsed.port && !/^\d+$/u.test(parsed.port)) {
          add('CLOUD_CP_PORT_INVALID', 'controlPlaneUrl', 'Control-plane port must be numeric.');
        }
        controlPlaneUrl = parsed.toString().replace(/\/+$/u, '');
      }
    }
  }

  const adminTokenRefValue = input.adminTokenRef ? env[input.adminTokenRef]?.trim() : undefined;
  const jwtSecretRefValue = input.jwtSecretRef ? env[input.jwtSecretRef]?.trim() : undefined;
  if (input.adminTokenRef && !adminTokenRefValue) {
    add(
      'CLOUD_SECRET_REF_MISSING',
      'adminTokenRef',
      'The configured admin token secret reference is not available in the environment.'
    );
  }
  if (input.jwtSecretRef && !jwtSecretRefValue) {
    add(
      'CLOUD_SECRET_REF_MISSING',
      'jwtSecretRef',
      'The configured shared-secret reference is not available in the environment.'
    );
  }

  const adminToken =
    input.adminToken?.trim() || adminTokenRefValue || env.MW_CONTROL_PLANE_TOKEN?.trim();
  const jwtSecret =
    input.jwtSecret?.trim() ||
    jwtSecretRefValue ||
    env.MW_INTERNAL_SECRET?.trim() ||
    env.JWT_SECRET?.trim();
  const token = resolveControlPlaneToken({ adminToken, jwtSecret });
  const needsToken =
    features.controlPlane ||
    features.provisioning ||
    features.providerProbe ||
    features.terraformExport ||
    features.meshProvisioning;
  if (needsToken) {
    const quality = classifySecret(token);
    if (quality === 'missing') {
      add(
        'CLOUD_TOKEN_MISSING',
        'adminToken',
        'Configure a control-plane token or shared secret (secret reference preferred) before enabling cloud features.'
      );
    } else if (quality === 'weak') {
      add(
        'CLOUD_TOKEN_WEAK',
        'adminToken',
        'The resolved control-plane token is too weak; rotate to a high-entropy value.'
      );
    } else if (quality === 'malformed') {
      add(
        'CLOUD_TOKEN_MALFORMED',
        'adminToken',
        'The resolved control-plane token is malformed; rotate to a single-line value.'
      );
    }
  }

  if (features.metrics) {
    const metricsToken = input.metricsToken?.trim() || env.MW_METRICS_TOKEN?.trim();
    if (classifySecret(metricsToken) !== 'ok') {
      add(
        'CLOUD_METRICS_TOKEN_MISSING',
        'metricsToken',
        'The metrics endpoint requires a configured high-entropy bearer token; it fails closed when unset.'
      );
    }
  }

  for (const feature of [
    'provisioning',
    'providerProbe',
    'terraformExport',
    'meshProvisioning',
  ] as const) {
    if (features[feature] && !features.controlPlane) {
      add(
        'CLOUD_FEATURE_DEPENDENCY_MISSING',
        `features.${feature}`,
        'This cloud feature requires the controlPlane feature to be enabled.'
      );
    }
  }

  const allowedProbeHosts: string[] = [];
  for (const host of input.allowedProbeHosts ?? []) {
    const normalized = host.trim().toLowerCase().replace(/\.$/u, '');
    if (!isHostnameLike(normalized)) {
      add(
        'CLOUD_PROBE_HOST_INVALID',
        'allowedProbeHosts',
        'Probe allowlist entries must be hostnames or IP addresses; no values are reported.'
      );
      continue;
    }
    if (!allowedProbeHosts.includes(normalized)) allowedProbeHosts.push(normalized);
  }
  if (controlPlaneUrl) {
    try {
      const host = new URL(controlPlaneUrl).hostname.toLowerCase();
      if (!allowedProbeHosts.includes(host)) allowedProbeHosts.push(host);
    } catch {
      // URL validity already reported above.
    }
  }

  const reasonCodes = issues.map((issue) => issue.code);
  const ok = issues.length === 0;
  return {
    ok,
    issues,
    reasonCodes,
    value: {
      controlPlaneUrl,
      features,
      adminToken: token,
      metricsToken: input.metricsToken?.trim() || env.MW_METRICS_TOKEN?.trim(),
      allowedProbeHosts,
      rotationVersion: input.rotationVersion?.trim() || 'default',
    },
  };
}

export class CloudConfigError extends Error {
  readonly reasonCodes: readonly CloudConfigReasonCode[];
  readonly issues: readonly CloudConfigIssue[];

  constructor(validation: CloudConfigValidation) {
    const summary = [...new Set(validation.reasonCodes)].join(', ') || 'CLOUD_CONFIG_INVALID';
    super(`Cloud configuration invalid: ${summary}`);
    this.name = 'CloudConfigError';
    this.reasonCodes = validation.reasonCodes;
    this.issues = validation.issues;
  }
}

/** Use at process startup to fail fast without printing URLs or key material. */
export function validateCloudConfigOrThrow(
  input: CloudConfigInput = {},
  env: NodeJS.ProcessEnv = process.env
): ValidatedCloudConfig {
  const validation = validateCloudConfig(input, env);
  if (!validation.ok || !validation.value) throw new CloudConfigError(validation);
  return validation.value;
}

export function readCloudReadiness(validation: CloudConfigValidation): CloudReadiness {
  const features = validation.value?.features ?? disabledFeatures();
  return {
    ready: validation.ok,
    reasonCodes: [...new Set(validation.reasonCodes)],
    enabledFeatures: CLOUD_FEATURES.filter((feature) => features[feature]),
  };
}

/* -------------------------------------------------------------------------- */
/* Low-cardinality cloud operations telemetry                                  */
/* -------------------------------------------------------------------------- */

export const CLOUD_OPERATIONS = [
  'app.deploy',
  'app.delete',
  'subscription.enforce',
  'deployment.logs',
  'deployment.logs.stream',
  'target.probe',
  'terraform.export',
  'control_plane.health',
  'control_plane.services',
  'config.readiness',
  'provider.request',
  'provisioning.request',
  'other',
] as const;
export type CloudOperation = (typeof CLOUD_OPERATIONS)[number];

export const CLOUD_OUTCOMES = [
  'success',
  'denied',
  'invalid',
  'conflict',
  'failed',
  'timeout',
  'degraded',
  'offline',
  'other',
] as const;
export type CloudOutcome = (typeof CLOUD_OUTCOMES)[number];

export const CLOUD_PROVIDERS = ['docker_agent', 'coolify', 'mesh', 'none', 'other'] as const;
export type CloudProviderLabel = (typeof CLOUD_PROVIDERS)[number];

export interface CloudMetricsContract {
  readonly counter: string;
  readonly durationCounter: string;
  readonly labels: readonly string[];
  readonly maxSeries: number;
  readonly authentication: typeof CLOUD_METRICS_AUTH_REQUIREMENT;
}

export const CLOUD_METRICS_CONTRACT: CloudMetricsContract = Object.freeze({
  counter: 'moonwitness_cloud_operations_total',
  durationCounter: 'moonwitness_cloud_operation_duration_seconds_sum',
  labels: ['operation', 'outcome', 'provider'],
  maxSeries: 256,
  authentication: CLOUD_METRICS_AUTH_REQUIREMENT,
});

export interface CloudMetricSample {
  readonly operation: CloudOperation;
  readonly outcome: CloudOutcome;
  readonly provider: CloudProviderLabel;
  readonly count: number;
  readonly durationSeconds: number;
}

interface MutableMetric {
  count: number;
  durationSeconds: number;
}

const cloudMetricSeries = new Map<string, MutableMetric>();

export function normalizeCloudOperation(value: string | undefined): CloudOperation {
  return CLOUD_OPERATIONS.find((operation) => operation === value) ?? 'other';
}

export function normalizeCloudOutcome(value: string | number | undefined): CloudOutcome {
  if (typeof value === 'number') {
    if (value >= 200 && value < 300) return 'success';
    if (value >= 300 && value < 500) return 'denied';
    if (value >= 500) return 'failed';
    return 'other';
  }
  const normalized = value?.trim().toLowerCase() ?? '';
  if ((CLOUD_OUTCOMES as readonly string[]).includes(normalized)) return normalized as CloudOutcome;
  if (/^2\d\d$/u.test(normalized)) return 'success';
  if (/^[45]\d\d$/u.test(normalized)) return 'denied';
  return 'other';
}

export function normalizeCloudProvider(value: string | undefined): CloudProviderLabel {
  return CLOUD_PROVIDERS.find((provider) => provider === value) ?? 'other';
}

/** Last line of defence: arbitrary values are never accepted as label values. */
export function sanitizeMetricLabel(value: string | undefined): string {
  if (!value) return 'other';
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, '_')
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : 'other';
}

export interface RecordCloudOperationInput {
  readonly operation: string;
  readonly outcome: string | number;
  readonly provider?: string;
  readonly durationMs?: number;
}

export function recordCloudOperation(input: RecordCloudOperationInput): void {
  const operation = normalizeCloudOperation(input.operation);
  const outcome = normalizeCloudOutcome(input.outcome);
  const provider = normalizeCloudProvider(input.provider);
  const fallbackKey = ['other', 'other', 'other'].join('\u0000');
  let key = [operation, outcome, provider].join('\u0000');
  if (!cloudMetricSeries.has(key) && cloudMetricSeries.size >= CLOUD_METRICS_CONTRACT.maxSeries) {
    key = fallbackKey;
  }
  const metric = cloudMetricSeries.get(key) ?? { count: 0, durationSeconds: 0 };
  metric.count += 1;
  const seconds = Number.isFinite(input.durationMs)
    ? Math.max(0, Number(input.durationMs)) / 1000
    : 0;
  metric.durationSeconds += seconds;
  cloudMetricSeries.set(key, metric);
}

export function readCloudMetricSnapshot(): readonly CloudMetricSample[] {
  return [...cloudMetricSeries.entries()]
    .map(([key, metric]) => {
      const [operation, outcome, provider] = key.split('\u0000');
      return {
        operation: normalizeCloudOperation(operation),
        outcome: normalizeCloudOutcome(outcome),
        provider: normalizeCloudProvider(provider),
        count: metric.count,
        durationSeconds: metric.durationSeconds,
      };
    })
    .sort((a, b) => a.operation.localeCompare(b.operation));
}

function escapePromLabel(value: string): string {
  return sanitizeMetricLabel(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/** Prometheus exposition text with only normalized enum label values. */
export function readCloudMetrics(): string {
  const lines = [
    `# HELP ${CLOUD_METRICS_CONTRACT.counter} Cloud operation outcomes by bounded operation/outcome/provider labels.`,
    `# TYPE ${CLOUD_METRICS_CONTRACT.counter} counter`,
  ];
  for (const sample of readCloudMetricSnapshot()) {
    const labels = `operation="${escapePromLabel(sample.operation)}",outcome="${escapePromLabel(
      sample.outcome
    )}",provider="${escapePromLabel(sample.provider)}"`;
    lines.push(`${CLOUD_METRICS_CONTRACT.counter}{${labels}} ${sample.count}`);
  }
  lines.push(
    `# HELP ${CLOUD_METRICS_CONTRACT.durationCounter} Observed cloud operation duration in seconds.`,
    `# TYPE ${CLOUD_METRICS_CONTRACT.durationCounter} counter`
  );
  for (const sample of readCloudMetricSnapshot()) {
    const labels = `operation="${escapePromLabel(sample.operation)}",outcome="${escapePromLabel(
      sample.outcome
    )}",provider="${escapePromLabel(sample.provider)}"`;
    lines.push(`${CLOUD_METRICS_CONTRACT.durationCounter}{${labels}} ${sample.durationSeconds}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Test-only helper for isolating metric assertions. */
export function resetCloudMetrics(): void {
  cloudMetricSeries.clear();
}
