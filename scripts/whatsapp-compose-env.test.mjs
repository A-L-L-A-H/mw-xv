import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localServiceScripts } from './local-service-scripts.mjs';

const canonicalComposeFile = 'deploy/compose/docker-compose.production.yml';
const compatibilityComposeFile = 'deploy/compose/docker-compose.prd.yml';

function serviceBlock(source, name) {
  const start = source.search(new RegExp(`^  ${name}:\\s*$`, 'mu'));
  assert.notEqual(start, -1, `Compose must define ${name}`);
  const remainder = source.slice(start + 1);
  const nextService = remainder.search(/^ {2}[A-Za-z0-9_-]+:\s*$/mu);
  return source.slice(start, nextService === -1 ? undefined : start + 1 + nextService);
}

function environmentMergePattern(...anchors) {
  const escaped = anchors.map((anchor) => anchor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return new RegExp(`^ {6}<<:\\s*\\[\\s*${escaped.join(',\\s*')},?\\s*\\]$`, 'mu');
}

test('development Compose runs WhatsApp outbox and attachment cleanup jobs with scoped secrets', () => {
  const source = readFileSync('deploy/compose/docker-compose.development.yml', 'utf8');
  assert.match(serviceBlock(source, 'outbox-worker'), /WHATSAPP_GATEWAY_USERNAME:/u);
  assert.match(serviceBlock(source, 'outbox-worker'), /WHATSAPP_GATEWAY_PASSWORD:/u);
  for (const name of ['jobs-worker', 'jobs-scheduler']) {
    const block = serviceBlock(source, name);
    assert.doesNotMatch(block, /WHATSAPP_GATEWAY_(?:USERNAME|PASSWORD)|WHATSAPP_WEBHOOK_SECRET/u);
    assert.match(block, /whatsapp_dev_attachments:\/var\/lib\/moonwitness\/attachments/u);
  }
});

test('local dev and start commands include the API, Board, outbox, jobs worker, and scheduler', () => {
  const expectedByMode = {
    dev: ['dev', 'jobs:outbox', 'jobs:worker', 'jobs:scheduler', 'dev'],
    start: ['start', 'jobs:outbox', 'jobs:worker', 'jobs:scheduler', 'start'],
    'start:built': [
      'start:built',
      'jobs:outbox',
      'jobs:worker:built',
      'jobs:scheduler:built',
      'start:built',
    ],
  };
  for (const [mode, expectedScripts] of Object.entries(expectedByMode)) {
    assert.deepEqual(
      localServiceScripts[mode].map(([, script]) => script),
      expectedScripts,
      `${mode} must start the WhatsApp outbox and attachment reconciliation scheduler`
    );
    assert.deepEqual(
      localServiceScripts[mode].map(([packageName]) => packageName),
      [
        '@moonwitness/api',
        '@moonwitness/api',
        '@moonwitness/api',
        '@moonwitness/api',
        '@moonwitness/board',
      ]
    );
  }
});

test('production WhatsApp gateway validation runs only in API and outbox processes', () => {
  const source = (file) => readFileSync(file, 'utf8');
  assert.doesNotMatch(source('apps/api/src/config/env.ts'), /validateWhatsAppProductionConfig/u);
  assert.match(
    source('apps/api/src/server.ts'),
    /validateWhatsAppProductionConfig\(process\.env\)/u
  );
  assert.match(
    source('apps/api/src/commands/outbox-worker.ts'),
    /validateWhatsAppProductionConfig\(process\.env\)/u
  );
  for (const file of ['jobs-worker.ts', 'jobs-scheduler.ts']) {
    assert.doesNotMatch(
      source(`apps/api/src/commands/${file}`),
      /validateWhatsAppProductionConfig/u
    );
  }
});

test('canonical production Compose scopes WhatsApp gateway and webhook secrets to required services', () => {
  const source = readFileSync(canonicalComposeFile, 'utf8');
  const commonEnvironment = source.match(
    /^ {4}x-app-environment:\s*&[^\r\n]+\r?\n([\s\S]*?)(?=^ {4}x-whatsapp-gateway-credentials:)/mu
  );
  const credentials = source.match(
    /^ {4}x-whatsapp-gateway-credentials:\s*&[^\r\n]+\r?\n([\s\S]*?)(?=^ {4}x-whatsapp-webhook-environment:)/mu
  );
  const webhookEnvironment = source.match(
    /^ {4}x-whatsapp-webhook-environment:\s*&[^\r\n]+\r?\n([\s\S]*?)(?=^ {4}build:)/mu
  );
  assert.ok(commonEnvironment, 'Compose must define a shared non-provider environment');
  assert.ok(credentials, 'Compose must define a dedicated GoWA credentials environment');
  assert.ok(webhookEnvironment, 'Compose must define a dedicated webhook environment');
  assert.match(credentials[1], /^ {6}WHATSAPP_GATEWAY_USERNAME:/mu);
  assert.match(credentials[1], /^ {6}WHATSAPP_GATEWAY_PASSWORD:/mu);
  assert.match(webhookEnvironment[1], /^ {6}WHATSAPP_WEBHOOK_URL:/mu);
  assert.match(webhookEnvironment[1], /^ {6}WHATSAPP_WEBHOOK_SECRET:/mu);
  assert.doesNotMatch(
    commonEnvironment[1],
    /WHATSAPP_GATEWAY_(?:USERNAME|PASSWORD)|WHATSAPP_WEBHOOK_SECRET/u
  );

  const expectedApiEnvironmentMerge = environmentMergePattern(
    '*app_environment',
    '*ai_environment',
    '*whatsapp_gateway_credentials',
    '*whatsapp_webhook_environment'
  );
  const expectedOutboxEnvironmentMerge = environmentMergePattern(
    '*app_environment',
    '*whatsapp_gateway_credentials'
  );
  assert.match(serviceBlock(source, 'api'), expectedApiEnvironmentMerge);
  assert.match(serviceBlock(source, 'outbox-worker'), expectedOutboxEnvironmentMerge);
  assert.doesNotMatch(serviceBlock(source, 'outbox-worker'), /WHATSAPP_WEBHOOK_SECRET/u);
  for (const name of ['jobs-worker', 'jobs-scheduler']) {
    const block = serviceBlock(source, name);
    assert.doesNotMatch(block, /WHATSAPP_GATEWAY_(?:USERNAME|PASSWORD)|WHATSAPP_WEBHOOK_SECRET/u);
    assert.doesNotMatch(block, /\*whatsapp_gateway_credentials/u);
    assert.match(
      block,
      /attachments:\/var\/lib\/moonwitness\/attachments/u,
      `${name} must share the attachment store so scheduled cleanup sees the same objects`
    );
  }
  // Anchors are declared inside the first service for YAML validity; only the
  // Board's own environment block must stay free of WhatsApp credentials.
  const boardEnvironment = serviceBlock(source, 'board').match(
    /^ {4}environment:\s*\r?\n([\s\S]*?)(?=^ {4}\S)/mu
  );
  assert.ok(boardEnvironment, 'Board service must declare an environment block');
  assert.doesNotMatch(boardEnvironment[1], /WHATSAPP_/u);
});

test('prd Compose entrypoint delegates to the canonical hardened stack', () => {
  const source = readFileSync(compatibilityComposeFile, 'utf8');
  assert.match(source, /^include:\r?\n {2}- docker-compose\.production\.yml$/mu);
  assert.doesNotMatch(source, /^services:/mu);
  assert.doesNotMatch(source, /docker\.sock/u);
});
