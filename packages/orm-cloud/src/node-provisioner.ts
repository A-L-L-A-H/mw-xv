import { createHash } from 'node:crypto';

export type VpsOsFamily = 'ubuntu' | 'debian';

export interface ExistingMeshPeer {
  readonly nodeId: string;
  readonly meshIp: string;
  readonly publicEndpoint?: string;
}

export interface VpsProvisionRequest {
  readonly nodeId: string;
  readonly host: string;
  readonly sshPort?: number;
  readonly sshUser?: string;
  readonly osFamily: VpsOsFamily;
  readonly meshIp: string;
  readonly meshNetworkName: string;
  readonly meshNetworkSecret: string;
  readonly existingPeers: readonly ExistingMeshPeer[];
  readonly controlPlanePort?: number;
  readonly controlPlaneToken?: string;
  readonly edgeDomain?: string;
  readonly healthProbeTimeoutSec?: number;
  readonly requestedAt?: string;
}

export type ProvisionStepId =
  | 'preflight-os'
  | 'install-docker'
  | 'join-easytier-mesh'
  | 'configure-control-plane'
  | 'configure-caddy-edge'
  | 'verify-health-probe';

export interface ProvisionStep {
  readonly id: ProvisionStepId;
  readonly title: string;
  readonly idempotent: boolean;
  readonly command: string;
  readonly redactedCommand: string;
  readonly rollbackHint: string;
}

export interface ProvisionValidationError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProvisionReport {
  readonly ok: boolean;
  readonly nodeId: string;
  readonly host: string;
  readonly sshPort: number;
  readonly sshUser: string;
  readonly osFamily: VpsOsFamily;
  readonly meshIp: string;
  readonly meshCidr: string;
  readonly controlPlanePort: number;
  readonly edgeDomain?: string;
  readonly steps: readonly ProvisionStep[];
  readonly systemdUnitPreview: string;
  readonly redactedSummary: string;
  readonly validationErrors: readonly ProvisionValidationError[];
  readonly generatedAt: string;
  readonly planSha256: string;
}

const NODE_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/u;
const HOST_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/u;
const SSH_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/u;
const NETWORK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/u;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const EASYTIER_MESH_IP_RE = /^10\.144\.0\.(\d{1,3})$/u;

const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_USER = 'root';
const DEFAULT_CONTROL_PLANE_PORT = 4100;
const DEFAULT_HEALTH_PROBE_TIMEOUT_SEC = 30;
const MIN_SECRET_LENGTH = 16;

export function isValidEasyTierMeshIp(ip: string): boolean {
  const match = EASYTIER_MESH_IP_RE.exec(ip.trim());
  if (!match) return false;
  const hostOctet = Number(match[1]);
  return Number.isInteger(hostOctet) && hostOctet >= 1 && hostOctet <= 254;
}

export function redactProvisionSecrets(
  text: string,
  secrets: readonly (string | undefined)[]
): string {
  let output = text;
  const uniqueSecrets = Array.from(
    new Set(secrets.filter((s): s is string => typeof s === 'string' && s.length > 0))
  ).sort((a, b) => b.length - a.length);

  for (const secret of uniqueSecrets) {
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

export function validateVpsProvisionRequest(
  request: VpsProvisionRequest
): readonly ProvisionValidationError[] {
  const errors: ProvisionValidationError[] = [];

  if (!NODE_ID_RE.test(request.nodeId)) {
    errors.push({
      field: 'nodeId',
      code: 'INVALID_NODE_ID',
      message: 'nodeId must be 2-63 lowercase alphanumeric characters or hyphens',
    });
  }

  if (!HOST_RE.test(request.host.trim())) {
    errors.push({
      field: 'host',
      code: 'INVALID_HOST',
      message: 'host must be a valid IPv4 address or hostname without shell metacharacters',
    });
  }

  const sshPort = request.sshPort ?? DEFAULT_SSH_PORT;
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    errors.push({
      field: 'sshPort',
      code: 'INVALID_SSH_PORT',
      message: 'sshPort must be an integer between 1 and 65535',
    });
  }

  const sshUser = request.sshUser ?? DEFAULT_SSH_USER;
  if (!SSH_USER_RE.test(sshUser)) {
    errors.push({
      field: 'sshUser',
      code: 'INVALID_SSH_USER',
      message: 'sshUser must be a valid POSIX username',
    });
  }

  if (request.osFamily !== 'ubuntu' && request.osFamily !== 'debian') {
    errors.push({
      field: 'osFamily',
      code: 'UNSUPPORTED_OS_FAMILY',
      message: 'osFamily must be "ubuntu" or "debian"',
    });
  }

  const normalizedMeshIp = request.meshIp.trim();
  if (!isValidEasyTierMeshIp(normalizedMeshIp)) {
    errors.push({
      field: 'meshIp',
      code: 'INVALID_MESH_IP_CIDR',
      message: 'meshIp must be a valid host address within 10.144.0.1-10.144.0.254 (10.144.0.0/24)',
    });
  }

  for (const peer of request.existingPeers) {
    if (peer.meshIp.trim() === normalizedMeshIp) {
      errors.push({
        field: 'meshIp',
        code: 'MESH_IP_COLLISION',
        message: `meshIp ${normalizedMeshIp} collides with existing peer "${peer.nodeId}"`,
      });
    }
    if (peer.nodeId.trim() === request.nodeId.trim()) {
      errors.push({
        field: 'nodeId',
        code: 'NODE_ID_COLLISION',
        message: `nodeId "${request.nodeId}" already exists in cluster peers`,
      });
    }
  }

  if (!NETWORK_NAME_RE.test(request.meshNetworkName.trim())) {
    errors.push({
      field: 'meshNetworkName',
      code: 'INVALID_MESH_NETWORK_NAME',
      message: 'meshNetworkName must be 2-64 alphanumeric, dot, underscore, or hyphen characters',
    });
  }

  if (request.meshNetworkSecret.trim().length < MIN_SECRET_LENGTH) {
    errors.push({
      field: 'meshNetworkSecret',
      code: 'WEAK_MESH_SECRET',
      message: `meshNetworkSecret must be at least ${MIN_SECRET_LENGTH} characters`,
    });
  }

  const controlPlanePort = request.controlPlanePort ?? DEFAULT_CONTROL_PLANE_PORT;
  if (!Number.isInteger(controlPlanePort) || controlPlanePort < 1024 || controlPlanePort > 65535) {
    errors.push({
      field: 'controlPlanePort',
      code: 'INVALID_CONTROL_PLANE_PORT',
      message: 'controlPlanePort must be an unprivileged integer port between 1024 and 65535',
    });
  }

  if (request.edgeDomain !== undefined && !DOMAIN_RE.test(request.edgeDomain.trim())) {
    errors.push({
      field: 'edgeDomain',
      code: 'INVALID_EDGE_DOMAIN',
      message: 'edgeDomain must be a valid fully-qualified domain name',
    });
  }

  return errors;
}

function buildControlPlaneSystemdUnit(
  nodeId: string,
  meshIp: string,
  controlPlanePort: number,
  hasToken: boolean
): string {
  const lines = [
    '[Unit]',
    `Description=MoonWitness Control Plane (${nodeId})`,
    'After=network-online.target docker.service easytier.service',
    'Wants=network-online.target docker.service easytier.service',
    '',
    '[Service]',
    'Type=simple',
    'Restart=always',
    'RestartSec=5',
    'Environment=NODE_ENV=production',
    'Environment=MW_CONTROL_PLANE_AUTOSTART_LEGACY=false',
    `Environment=MW_NODE_ID=${nodeId}`,
    `Environment=MW_CONTROL_PLANE_HOST=${meshIp}`,
    `Environment=MW_CONTROL_PLANE_PORT=${controlPlanePort}`,
    ...(hasToken ? ['EnvironmentFile=/etc/moonwitness/control-plane.env'] : []),
    'ExecStart=/usr/local/bin/moonwitness-control-plane',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ];
  return lines.join('\n');
}

export function planVpsNodeProvision(request: VpsProvisionRequest): ProvisionReport {
  const sshPort = request.sshPort ?? DEFAULT_SSH_PORT;
  const sshUser = request.sshUser ?? DEFAULT_SSH_USER;
  const controlPlanePort = request.controlPlanePort ?? DEFAULT_CONTROL_PLANE_PORT;
  const healthProbeTimeoutSec = request.healthProbeTimeoutSec ?? DEFAULT_HEALTH_PROBE_TIMEOUT_SEC;
  const generatedAt = request.requestedAt ?? new Date().toISOString();
  const meshIp = request.meshIp.trim();
  const meshCidr = `${meshIp}/24`;
  const secrets = [request.meshNetworkSecret, request.controlPlaneToken];

  const validationErrors = validateVpsProvisionRequest(request);
  const systemdUnitPreview = buildControlPlaneSystemdUnit(
    request.nodeId,
    meshIp,
    controlPlanePort,
    Boolean(request.controlPlaneToken)
  );

  if (validationErrors.length > 0) {
    const redactedSummary = redactProvisionSecrets(
      `Provision plan rejected for node ${request.nodeId} (${request.host}): ${validationErrors.length} validation error(s)`,
      secrets
    );
    const canonical = {
      ok: false,
      nodeId: request.nodeId,
      host: request.host,
      sshPort,
      sshUser,
      osFamily: request.osFamily,
      meshIp,
      meshCidr,
      controlPlanePort,
      edgeDomain: request.edgeDomain,
      steps: [],
      validationErrors,
    };
    const planSha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

    return {
      ok: false,
      nodeId: request.nodeId,
      host: request.host,
      sshPort,
      sshUser,
      osFamily: request.osFamily,
      meshIp,
      meshCidr,
      controlPlanePort,
      ...(request.edgeDomain !== undefined ? { edgeDomain: request.edgeDomain } : {}),
      steps: [],
      systemdUnitPreview,
      redactedSummary,
      validationErrors,
      generatedAt,
      planSha256,
    };
  }

  const peerFlags = [...request.existingPeers]
    .filter((p) => typeof p.publicEndpoint === 'string' && p.publicEndpoint.trim().length > 0)
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    .map((p) => `--peers ${p.publicEndpoint!.trim()}`)
    .join(' ');

  const rawSteps: Array<Omit<ProvisionStep, 'redactedCommand'>> = [
    {
      id: 'preflight-os',
      title: `Verify ${request.osFamily} OS and update package index`,
      idempotent: true,
      command: `grep -qi "${request.osFamily}" /etc/os-release && apt-get update -qq && apt-get install -y -qq curl ca-certificates gnupg`,
      rollbackHint: 'No persistent state modified during preflight',
    },
    {
      id: 'install-docker',
      title: 'Install and enable Docker Engine',
      idempotent: true,
      command:
        'command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh && systemctl enable --now docker',
      rollbackHint: 'systemctl disable --now docker',
    },
    {
      id: 'join-easytier-mesh',
      title: `Join EasyTier mesh ${request.meshNetworkName} at ${meshCidr}`,
      idempotent: true,
      command: [
        'mkdir -p /etc/easytier',
        `cat <<'EOF' > /etc/easytier/mesh.env`,
        `EASYTIER_NETWORK_NAME=${request.meshNetworkName.trim()}`,
        `EASYTIER_NETWORK_SECRET=${request.meshNetworkSecret}`,
        `EASYTIER_IPV4=${meshCidr}`,
        'EOF',
        'chmod 600 /etc/easytier/mesh.env',
        `easytier-core --network-name "${request.meshNetworkName.trim()}" --network-secret "${request.meshNetworkSecret}" --ipv4 "${meshCidr}" ${peerFlags}`.trim(),
        'systemctl enable --now easytier',
      ].join(' && '),
      rollbackHint: 'systemctl disable --now easytier && rm -f /etc/easytier/mesh.env',
    },
    {
      id: 'configure-control-plane',
      title: 'Configure moonwitness-control-plane systemd unit',
      idempotent: true,
      command: [
        'mkdir -p /etc/moonwitness',
        ...(request.controlPlaneToken
          ? [
              `printf 'MW_CONTROL_PLANE_TOKEN=%s\\n' '${request.controlPlaneToken}' > /etc/moonwitness/control-plane.env`,
              'chmod 600 /etc/moonwitness/control-plane.env',
            ]
          : []),
        `cat <<'EOF' > /etc/systemd/system/moonwitness-control-plane.service\n${systemdUnitPreview}\nEOF`,
        'systemctl daemon-reload && systemctl enable --now moonwitness-control-plane',
      ].join(' && '),
      rollbackHint:
        'systemctl disable --now moonwitness-control-plane && rm -f /etc/systemd/system/moonwitness-control-plane.service && systemctl daemon-reload',
    },
    {
      id: 'configure-caddy-edge',
      title: 'Install and configure Caddy edge reverse proxy',
      idempotent: true,
      command: [
        'command -v caddy >/dev/null 2>&1 || apt-get install -y -qq caddy',
        `printf '%s {\\n  reverse_proxy %s:%d\\n}\\n' '${request.edgeDomain ?? ':80'}' '${meshIp}' ${controlPlanePort} > /etc/caddy/Caddyfile`,
        'caddy validate --config /etc/caddy/Caddyfile && systemctl enable --now caddy && systemctl reload caddy',
      ].join(' && '),
      rollbackHint: 'systemctl reload caddy || systemctl restart caddy',
    },
    {
      id: 'verify-health-probe',
      title: 'Probe MoonWitness control plane health over private mesh IP',
      idempotent: true,
      command: `curl -fsS --max-time ${healthProbeTimeoutSec} http://${meshIp}:${controlPlanePort}/health`,
      rollbackHint: 'Inspect journalctl -u moonwitness-control-plane -n 100',
    },
  ];

  const steps: ProvisionStep[] = rawSteps.map((step) => ({
    ...step,
    redactedCommand: redactProvisionSecrets(step.command, secrets),
  }));

  const redactedSummary = redactProvisionSecrets(
    `Provision plan ready for ${request.nodeId} (${request.osFamily}) at ${request.host}:${sshPort} -> mesh ${meshCidr}, control-plane ${meshIp}:${controlPlanePort}, ${steps.length} idempotent steps`,
    secrets
  );

  const canonical = {
    ok: true,
    nodeId: request.nodeId,
    host: request.host,
    sshPort,
    sshUser,
    osFamily: request.osFamily,
    meshIp,
    meshCidr,
    controlPlanePort,
    edgeDomain: request.edgeDomain,
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      idempotent: s.idempotent,
      redactedCommand: s.redactedCommand,
    })),
    validationErrors: [],
  };

  const planSha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

  return {
    ok: true,
    nodeId: request.nodeId,
    host: request.host,
    sshPort,
    sshUser,
    osFamily: request.osFamily,
    meshIp,
    meshCidr,
    controlPlanePort,
    ...(request.edgeDomain !== undefined ? { edgeDomain: request.edgeDomain } : {}),
    steps,
    systemdUnitPreview,
    redactedSummary,
    validationErrors: [],
    generatedAt,
    planSha256,
  };
}
