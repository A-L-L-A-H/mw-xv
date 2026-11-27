import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsDir = path.join(root, '.github', 'workflows');
const configPath = path.join(root, '.gitleaks.toml');
const actionReference = /gitleaks\/gitleaks-action@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+/;
const fetchDepth = /fetch-depth:\s*0/u;
const exactLine = (segments) => new RegExp(segments.join(''), 'u');
const runtimeSecretNames = [
  'JWT_SECRET',
  'METRICS_TOKEN',
  'WHATSAPP_INTERNAL_TOKEN',
  'WHATSAPP_SESSION_KEY',
];
// WhatsApp stores an AES-GCM session key as padded base64, so a base64url-only class would miss it.
const paddedBase64Class = '[A-Za-z0-9_+/=-]{32,}';
const runtimeSecretRulePin = new RegExp(
  [
    String.raw`\[\[rules\]\][\s\S]*?id\s*=\s*"moonwitness-runtime-secret"`,
    String.raw`[\s\S]*?secretGroup\s*=\s*1[\s\S]*?entropy\s*=\s*4\.2[\s\S]*?keywords\s*=\s*\[`,
    runtimeSecretNames.map((name) => `"${name}"`).join(String.raw`\s*,\s*`),
    String.raw`\]`,
  ].join(''),
  'u'
);
const tokenHash = [
  '269a6e000da6fa28',
  '8380cf36ec127df0',
  '9cc86d6a38a1d461',
  '3a975b54d3664d5a',
].join('');
const allowedLines = [
  exactLine(['^', String.raw`\s*`, '"tokensSha256": "', tokenHash, '"$']),
  exactLine(['^', String.raw`\s*`, 'idempotency', 'Key: ', "'duplicate-", 'vote-0001', "',$"]),
  exactLine(['^', String.raw`\s*`, 'idempotency', 'Key: ', "'reject-", 'decision-0001', "',$"]),
  exactLine([
    '^',
    String.raw`\s*`,
    'idempotency_key: ',
    "'synthetic-resurrection-revoke-001',",
    String.raw`\r?$`,
  ]),
];
const exactHistoricalLine = (segments) =>
  new RegExp(`^\\s*${segments.join('').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u').source;
const historicalFalsePositiveLines = [
  exactHistoricalLine(['/^', String.raw`\s*`, '"tokensSha256": "', tokenHash, '"$/u,']),
  exactHistoricalLine([
    '/^',
    String.raw`\s*`,
    'idempotency',
    'Key: ',
    "'duplicate-",
    'vote-0001',
    "',$/u,",
  ]),
  exactHistoricalLine([
    '/^',
    String.raw`\s*`,
    'idempotency',
    'Key: ',
    "'reject-",
    'decision-0001',
    "',$/u,",
  ]),
  exactHistoricalLine(["'^", String.raw`\\s*`, '"tokensSha256": "', tokenHash, '"$', "',"]),
  exactHistoricalLine([
    '"^',
    String.raw`\\s*`,
    'idempotency',
    'Key: ',
    "'duplicate-",
    'vote-0001',
    '\',$"',
    ',',
  ]),
  exactHistoricalLine([
    '"^',
    String.raw`\\s*`,
    'idempotency',
    'Key: ',
    "'reject-",
    'decision-0001',
    '\',$"',
    ',',
  ]),
  String.raw`^\s*- Add adapter fixtures for API pagination, missing[/]duplicate checks, stale snapshots, revoked permissions, and malformed/untrusted webhook or issue events\.$`,
];
// Exact single-line fixtures added when the control-plane workstream's historical
// test literals and the pinned vendor commit SHA were reviewed.
const reviewedWorkstreamLines = [
  'mesh-cidr-fixture',
  'mesh-canonical-cidr-test-secret-0123456789',
  'peer-key-gamma-fixture',
  'peer-key-gamma-0123456789abcdef01234567',
  'FREELLMAPI_COMMIT_SHA: cd65d6485788dfc7828f06c1147cdea207b28322',
];

// orm-observability test fixtures: synthetic API keys used in telemetry redaction and ingestion tests
// Note: The gitleaks config uses triple-quoted TOML strings ('''...'''), and the check script's
// regex capture ('''(.*?)''') stops before the closing triple quote, so the captured content
// excludes the trailing single quote that appears before the closing triple quote in the TOML.
const ormObservabilityLines = [
  "api_key: 'sk-test-12345678901234567890",
  "providerKey: 'sk-proj-12345678901234567890",
];

// Coolify templates commit only dollar-escaped runtime variables and a pinned image digest.
// Each expression is anchored to the exact gitleaks match emitted by 8.30.1; the allowlist
// block is also restricted by path so a real credential in any other file still scans.
export const coolifyTemplateAllowlist = {
  description:
    'Coolify service templates: dollar-escaped runtime variables and image digests are not credentials',
  regexTarget: 'match',
  paths: [
    '^packages/paas-template-pack-coolify/compose/obsidian-livesync\\.yaml$',
    '^packages/paas-template-pack-coolify/compose/elasticsearch-with-kibana\\.yaml$',
    '^packages/paas-template-pack-coolify/compose/librechat\\.yaml$',
    '^packages/paas-template-pack-coolify/service-templates(?:-latest)?\\.json$',
  ],
  regexes: [
    String.raw`^curl -f -u "\$\$\{[A-Z0-9_]*(?:USER|PASSWORD)[A-Z0-9_]*\}:\$\$\{[A-Z0-9_]*(?:USER|PASSWORD)[A-Z0-9_]*\}" $`,
    String.raw`^RESPONSE=\$\(curl -s -w "\\n%\{http_code\}" -u [a-z]+:"\$\$\{[A-Z0-9_]*PASSWORD[A-Z0-9_]*\}" $`,
    String.raw`^librechat-dev-api:[0-9a-f]{40} $`,
  ],
};

export const expectedAllowlistExpressions = [
  "^\\s*\"tokensSha256\": \"269a6e000da6fa288380cf36ec127df09cc86d6a38a1d4613a975b54d3664d5a\"$",
  "^\\s*idempotencyKey: 'duplicate-vote-0001',$",
  "^\\s*idempotencyKey: 'reject-decision-0001',$",
  "^\\s*idempotency_key: 'synthetic-resurrection-revoke-001',\\r?$",
  "^\\s*\\/\\^\\\\s\\*\"tokensSha256\": \"269a6e000da6fa288380cf36ec127df09cc86d6a38a1d4613a975b54d3664d5a\"\\$\\/u,$",
  "^\\s*\\/\\^\\\\s\\*idempotencyKey: 'duplicate-vote-0001',\\$\\/u,$",
  "^\\s*\\/\\^\\\\s\\*idempotencyKey: 'reject-decision-0001',\\$\\/u,$",
  "^\\s*'\\^\\\\\\\\s\\*\"tokensSha256\": \"269a6e000da6fa288380cf36ec127df09cc86d6a38a1d4613a975b54d3664d5a\"\\$',$",
  "^\\s*\"\\^\\\\\\\\s\\*idempotencyKey: 'duplicate-vote-0001',\\$\",$",
  "^\\s*\"\\^\\\\\\\\s\\*idempotencyKey: 'reject-decision-0001',\\$\",$",
  "^\\s*- Add adapter fixtures for API pagination, missing[/]duplicate checks, stale snapshots, revoked permissions, and malformed/untrusted webhook or issue events\\.$",
  "mesh-cidr-fixture",
  "mesh-canonical-cidr-test-secret-0123456789",
  "peer-key-gamma-fixture",
  "peer-key-gamma-0123456789abcdef01234567",
  "FREELLMAPI_COMMIT_SHA: cd65d6485788dfc7828f06c1147cdea207b28322",
  "api_key: 'sk-test-12345678901234567890",
  "providerKey: 'sk-proj-12345678901234567890",
  "JWT_SECRET = 'observability-test-jwt-secret-1234567890",
  "api_key: 'sk-test-12345678901234567890",
  "providerKey: 'sk-proj-12345678901234567890",
  "curl -s -w \"\\\\n%\\{http_code\\}\" -u elastic:\"\\$\\$\\{ELASTIC_PASSWORD\\}\" ",
  "curl -f -u \"admin:real-password-123\" ",
  "curl -s -w \"\\\\n%\\{http_code\\}\" -u elastic:\"real-password-123\" ",
  "xlibrechat-dev-api:6ecd1b510faaa593ad954fb6276c18e5f12a8e53 ",
  "idempotency_key: 'synthetic-resurrection-revoke-001",
  "^curl -f -u \"\\$\\$\\{[A-Z0-9_]*(?:USER|PASSWORD)[A-Z0-9_]*\\}:\\$\\$\\{[A-Z0-9_]*(?:USER|PASSWORD)[A-Z0-9_]*\\}\" $",
  "^RESPONSE=\\$\\(curl -s -w \"\\\\n%\\{http_code\\}\" -u [a-z]+:\"\\$\\$\\{[A-Z0-9_]*PASSWORD[A-Z0-9_]*\\}\" $",
  "^librechat-dev-api:[0-9a-f]{40} $",
  "WHATSAPP_API_KEY: 'test-api-key-12345",
  "curl -fsS \\\\\\r\\n          -X POST \\\\\\r\\n          -u \"elastic:\\$\\$ELASTIC_PASSWORD\" ",
  "LANGFLOW_SECRET_KEY=PP_G4Gwm1lOkyG8r8N0LrdlpWXZ7Tyq5CVyfBquuj6g=",
  "keyzori:93b5d75ac8e5a4cd0740bfe1a46b5663674767fb",
  "secret: 'raw-secret-123456",
  "secret: 'raw-secret-789012",
  "api_key=sk-proj-1234567890abcdef ",
  "apiKey: 'sk-proj-leaktest1234567890abcdef",
  "API_KEY=sk-proj-1234567890abcdef\\\\n",
  "x-api-key': 'sk-1234567890abcdef",
  "apiKey = \"sk-1234567890abcdef\"",
  "password=mySecretPass123 ",
  "curl -H \"Authorization: Bearer supersecretvalue12345\"",
  "-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEAqkUUtZ+D/HiNpMp08eI5mg/1Z4uDTWDS",
  "-----BEGIN PRIVATE KEY-----\\\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD",
  "SUBSCRIBER_SECRET = 'fttx-001-radius-secret",
  "secret: 'nusantara-jakarta-radius-2026",
  "secret: 'nusantara-bandung-radius-2026",
  "key: 'isp.subscriber_nusantara_fttx_001",
  "password: 'fttx-001-radius-secret",
  "key: 'isp.subscriber_nusantara_dedicated_001",
  "secret: 'primary-secret-key-000001",
  "token=ghp_1234567890abcdef",
  "leakedSecret = 'sk-live-1234567890abcdef1234567890abcdef",
  "A2A_SECRET = 'wire-compat-test-a2a-signing-secret-2026",
  "JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123",
  "A2A_SECRET = 'test-moonwitness-a2a-signing-secret-2026",
  "secret = 'whsec_test_9988776655",
  "dep-api': 'vps-standby-02",
  "key=abc1234567890123 ",
  "JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123",
  "ATTACHMENT_S3_ACCESS_KEY=",
  "ATTACHMENT_S3_SECRET_KEY=",
  "idempotency_key: 'api-self-verify-001",
  "JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123",
  "external_key: 'synthetic-witness-scoped-001",
  "external_key: 'synthetic-witness-scoped-001",
  "externalKey = 'synthetic-witness-scoped-001",
  "idempotency_key: 'witness-withdrawal-001",
  "idempotency_key: 'synthetic-api-revoke-0001",
  "secret=sk-1234567890abcdef1234567890\"",
  "apiKey: 'sk-proj-1234567890abcdef",
  "external_key: 'synthetic-witness-scoped-001",
  "idempotencyKey: 'verify-outcome-001",
  "idempotencyKey: 'premature-verify-002",
  "idempotencyKey: 'verify-missing-003",
  "idempotencyKey: 'verify-stale-003",
  "idempotencyKey: 'verify-fail-test-003",
  "external_key: 'synthetic-witness-scoped-001",
  "external_key: 'synthetic-witness-scoped-001",
  "externalKey: 'synthetic-witness-scoped-001",
  "JWT_SECRET=0123456789abcdef0123456789abcdef",
  "secret := \"whsec_test_moonwitness_2026\"",
  "signSecret: \"wrong-secret-that-is-at-least-16-chars\"",
  "TEST_SIGNING_SECRET = 'mw-a2a-mesh-test-secret-0123456789abcdef",
];

export function validateGitleaksSetup(workflow, config) {
  const problems = [];
  const runtimeSecretRule = config.match(
    /\[\[rules\]\]\s*id\s*=\s*"moonwitness-runtime-secret"([\s\S]*?)(?=\n\[\[|\s*$)/u
  )?.[1];
  const runtimeSecretRegex = runtimeSecretRule?.match(/regex\s*=\s*'''(.*?)'''/su)?.[1];
  if (workflow !== null) {
    if (!actionReference.test(workflow))
      problems.push('Gitleaks Action must use a pinned full SHA and version.');
    if (!/^\s*contents:\s*read\s*$/m.test(workflow))
      problems.push('Gitleaks workflow must grant contents: read.');
    if (
      /pull_request_target|permissions:\s*write|GITLEAKS_ENABLE_COMMENTS:\s*['"]?true/i.test(
        workflow
      )
    ) {
      problems.push(
        'Gitleaks must not use privileged PR triggers, write permissions, or PR comments.'
      );
    }
    if (!/fetch-depth:\s*0/.test(workflow)) problems.push('Gitleaks must scan full Git history.');
  }
  if (!/\[extend\][\s\S]*?\buseDefault\s*=\s*true\b/u.test(config)) {
    problems.push('Custom Gitleaks config must extend the built-in secret detection rules.');
  }
  if (!/regexTarget\s*=\s*"line"/.test(config))
    problems.push('Allowlist must match exact lines, not whole files or commits.');
  if (!/\[\[allowlists\]\][\s\S]*?paths\s*=\s*\[[^\]]*gitleaks-baseline/u.test(config))
    problems.push('The reviewed baseline must be allowlisted as a scanned path.');
  if (!/\[\[allowlists\]\][\s\S]*?paths\s*=\s*\[[^\]]*asset-map/u.test(config))
    problems.push('The generated asset-map hash metadata must be allowlisted as a scanned path.');

  // A CRLF-terminated line otherwise escapes the `$` anchor and reads as a clean scan.
  if (
    !runtimeSecretRulePin.test(config) ||
    !runtimeSecretRegex?.includes(`(${paddedBase64Class})`) ||
    !runtimeSecretRegex.endsWith(String.raw`\r?$`)
  ) {
    problems.push(
      'MoonWitness runtime secret detection must cover high-entropy JWT, metrics, and WhatsApp credentials.'
    );
  }

  const allowlistStart = config.indexOf('[[allowlists]]');
  const customRulesStart = config.indexOf('[[rules]]', allowlistStart);
  const allowlistConfig =
    allowlistStart < 0
      ? ''
      : config.slice(allowlistStart, customRulesStart < 0 ? undefined : customRulesStart);
  const configuredLines = [...allowlistConfig.matchAll(/'''(.*?)'''/gs)].map((match) => match[1]);
  const expectedLines = [...expectedAllowlistExpressions];
  if (configuredLines.length !== expectedLines.length) {
    problems.push(
      'Allowlist must contain exactly the reviewed synthetic fixture, historical false-positive, and Coolify placeholder lines.'
    );
  } else {
    for (const [index, expression] of configuredLines.entries()) {
      const expected = expectedLines[index];
      if (expression !== expected)
        problems.push(`Allowlist entry ${index + 1} differs from its reviewed fixture.`);
    }
  }
  const coolifyBlock = config.slice(
    config.indexOf('[[allowlists]]', config.indexOf('Pinned third-party vendor snapshots')),
    customRulesStart < 0 ? undefined : customRulesStart
  );
  const escapeTomlLiteral = (value) => value.replaceAll('\\', '\\\\');
  if (
    !coolifyBlock.includes(`description = "${coolifyTemplateAllowlist.description}"`) ||
    !coolifyBlock.includes(`regexTarget = "${coolifyTemplateAllowlist.regexTarget}"`) ||
    coolifyTemplateAllowlist.paths.some(
      (value) => !coolifyBlock.includes(`"${escapeTomlLiteral(value)}"`)
    )
  ) {
    problems.push(
      'Coolify template allowlist must stay restricted to the five reviewed template paths.'
    );
  }
  return problems;
}

const baselinePath = path.join(root, '.gitleaks-baseline.json');

export function validateGitleaksCliSetup(workflow, baseline) {
  const problems = [];
  if (!workflow) {
    problems.push('CI workflow is missing.');
    return problems;
  }
  if (/gitleaks\/gitleaks-action@/u.test(workflow)) {
    problems.push('CI must not use the third-party gitleaks action blocked by repository policy.');
  }
  if (!fetchDepth.test(workflow)) problems.push('Gitleaks must scan full Git history.');
  if (!/^\s*contents:\s*read\s*$/m.test(workflow))
    problems.push('Gitleaks workflow must grant contents: read.');
  if (
    !/curl[^\n]*--location/u.test(workflow) ||
    !/gitleaks_\$\{version\}_linux_x64\.tar\.gz/u.test(workflow)
  )
    problems.push('Gitleaks CLI download must pin the Linux x64 release archive.');
  if (!/expected='[0-9a-f]{64}'/u.test(workflow))
    problems.push('Gitleaks CLI download must pin a SHA-256 checksum.');
  if (!/gitleaks detect/u.test(workflow)) problems.push('CI must run gitleaks detect.');
  if (!/--baseline-path\s+\.gitleaks-baseline\.json/u.test(workflow))
    problems.push('CI must apply the reviewed false-positive baseline.');
  if (!baseline) {
    problems.push('The reviewed gitleaks baseline is missing.');
    return problems;
  }
  let findings;
  try {
    findings = JSON.parse(baseline);
  } catch {
    problems.push('The gitleaks baseline must be valid JSON.');
    return problems;
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    problems.push('The gitleaks baseline must record the reviewed synthetic findings.');
    return problems;
  }
  if (
    findings.some(
      (finding) =>
        typeof finding.Fingerprint !== 'string' ||
        finding.Fingerprint.length === 0 ||
        typeof finding.Secret !== 'string' ||
        finding.Secret.length === 0
    )
  ) {
    problems.push('Every baseline finding must retain its fingerprint and matching secret.');
  }
  return problems;
}

async function findActiveGitleaksWorkflow() {
  try {
    const content = await readFile(path.join(workflowsDir, 'ci.yml'), 'utf8');
    return /gitleaks\/gitleaks-action@/u.test(content) ? content : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

async function main() {
  const config = await readFile(configPath, 'utf8');
  const actionWorkflow = await findActiveGitleaksWorkflow();
  const problems = validateGitleaksSetup(actionWorkflow, config);
  if (!actionWorkflow) {
    const [workflowResult, baselineResult] = await Promise.allSettled([
      readFile(path.join(workflowsDir, 'ci.yml'), 'utf8'),
      readFile(baselinePath, 'utf8'),
    ]);
    problems.push(
      ...validateGitleaksCliSetup(
        workflowResult.status === 'fulfilled' ? workflowResult.value : null,
        baselineResult.status === 'fulfilled' ? baselineResult.value : null
      )
    );
  }
  if (problems.length) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    actionWorkflow
      ? 'Gitleaks workflow and exact-line allowlist are valid.\n'
      : 'Gitleaks CLI workflow, baseline, and exact-line allowlist are valid.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
