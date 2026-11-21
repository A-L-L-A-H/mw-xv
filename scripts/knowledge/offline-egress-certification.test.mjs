import assert from 'node:assert/strict';
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const knowledgeEntry = new URL('../../packages/knowledge/dist/src/index.js', import.meta.url);
const corpusEntry = new URL('../../packages/corpus/dist/index.js', import.meta.url);
const researchEntry = new URL('../../packages/research/dist/index.js', import.meta.url);
const localAiEntry = new URL('../../packages/local-ai/dist/index.js', import.meta.url);

describe('K9-004 offline egress-denial certification', () => {
  const egressAttempts = [];
  let originalFetch;
  let originalHttpRequest;
  let originalHttpGet;
  let originalHttpsRequest;
  let originalHttpsGet;
  let originalNetConnect;
  let originalNetCreateConnection;
  let originalDnsLookup;

  function denyEgress(channel, target) {
    const detail = `${channel}:${String(target)}`;
    egressAttempts.push(detail);
    throw new Error(`EGRESS_DENIED:${detail}`);
  }

  beforeEach(() => {
    egressAttempts.length = 0;
    originalFetch = globalThis.fetch;
    originalHttpRequest = http.request;
    originalHttpGet = http.get;
    originalHttpsRequest = https.request;
    originalHttpsGet = https.get;
    originalNetConnect = net.connect;
    originalNetCreateConnection = net.createConnection;
    originalDnsLookup = dns.lookup;

    globalThis.fetch = async (input) => denyEgress('fetch', input);
    http.request = (target) => denyEgress('http.request', target);
    http.get = (target) => denyEgress('http.get', target);
    https.request = (target) => denyEgress('https.request', target);
    https.get = (target) => denyEgress('https.get', target);
    net.connect = (target) => denyEgress('net.connect', JSON.stringify(target));
    net.createConnection = (target) => denyEgress('net.createConnection', JSON.stringify(target));
    dns.lookup = (hostname) => denyEgress('dns.lookup', hostname);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    net.connect = originalNetConnect;
    net.createConnection = originalNetCreateConnection;
    dns.lookup = originalDnsLookup;
  });

  it('proves egress guard is non-vacuous by blocking fetch, http/https, net, and dns attempts', async () => {
    await assert.rejects(() => globalThis.fetch('https://example.invalid'), /EGRESS_DENIED:fetch/u);
    assert.throws(() => http.get('http://example.invalid'), /EGRESS_DENIED:http\.get/u);
    assert.throws(
      () => net.connect({ host: '127.0.0.1', port: 80 }),
      /EGRESS_DENIED:net\.connect/u
    );
    assert.throws(() => dns.lookup('example.invalid', () => {}), /EGRESS_DENIED:dns\.lookup/u);
    assert.equal(egressAttempts.length, 4);
  });

  it('runs knowledge, corpus, research, and local-ai (AI_MODE=disabled) pipelines with zero outbound network attempts', async () => {
    const [knowledge, corpus, research, localAi] = await Promise.all([
      import(knowledgeEntry.href),
      import(corpusEntry.href),
      import(researchEntry.href),
      import(localAiEntry.href),
    ]);

    // 1. @moonwitness/knowledge offline manifest & canonical ID validation
    const quranManifest = JSON.parse(
      await readFile(
        path.join(repositoryRoot, 'corpus/manifests/tanzil-quran-text-v1.1-uthmani-q7-46.json'),
        'utf8'
      )
    );
    assert.equal(knowledge.validateSourceArtifactManifest(quranManifest).valid, true);
    assert.equal(knowledge.validateCanonicalKnowledgeId(quranManifest.edition_id).valid, true);
    assert.match(knowledge.hashCanonicalJson(quranManifest), /^[a-f0-9]{64}$/u);

    // 2. @moonwitness/corpus pinned local passage reads
    const quranPassage = await corpus.readQuranPassage({
      rootDirectory: repositoryRoot,
      editionId: 'mw:edition:tanzil-quran-text-v1.1-uthmani-txt2',
      locator: 'Q7:46',
      use: 'read_analyze',
    });
    assert.equal(
      quranPassage.sha256,
      '6ff83b01099fb7992b5f7fa101cfab3d6556607ca6b1fe69d53cb76f97027760'
    );

    const witnessPassage = await corpus.readTextualWitnessPassage({
      rootDirectory: repositoryRoot,
      expressionId: 'mw:expression:webp-protestant',
      editionId: 'mw:edition:webp-protestant-2020-stable',
      locator: 'Genesis 1:1',
      use: 'read_analyze',
    });
    assert.equal(
      witnessPassage.sha256,
      'ae5c2799fad97b0e65334aa39be6193d487419f0d31713caaac58a47f6b4d8b1'
    );

    // 3. @moonwitness/research benchmark, drift comparison, 33-BUG review, and child-protection gate
    const benchmarkFixtures = JSON.parse(
      await readFile(
        path.join(repositoryRoot, 'docs/knowledge/semantics-benchmark-fixtures.json'),
        'utf8'
      )
    );
    const reportA = await research.runSemanticsBenchmarkSuite(benchmarkFixtures);
    const reportB = await research.runSemanticsBenchmarkSuite(benchmarkFixtures);
    const ledger = research.compareSemanticsBenchmarkReports(reportA, reportB);
    assert.equal(ledger.status, 'zero_drift');

    const bugReport = research.reviewBugRegistryAliases({
      schema_version: 1,
      registry_id: 'mw:bug-registry:offline-cert',
      fixture_classification: 'synthetic',
      legacy_import_authorized: false,
      slots: research.createPlannedBugRegistrySlots(),
      alias_observations: [],
      alias_decisions: [],
    });
    assert.equal(bugReport.total_planned_slots, 33);

    const gateDecision = research.evaluateChildProtectionAndPublicationGate({
      schema_version: 1,
      record_id: 'mw:bug-case:offline-013',
      classification: 'CHILD_SENSITIVE',
      inherited_classifications: [],
      program_slot: 13,
      minor_involved: true,
      synthetic: true,
      requested_channel: 'public_projection',
      safeguarding_process_approved: false,
      candidate_payload: { summary: 'Offline gate check.' },
    });
    assert.equal(gateDecision.allowed, false);

    // 4. @moonwitness/local-ai disabled default + remote URL rejection before network
    const defaultConfig = localAi.readLocalAiConfig({});
    assert.equal(defaultConfig.mode, 'disabled');
    const disabledRuntime = localAi.createLocalAiRuntime(defaultConfig);
    assert.deepEqual(await disabledRuntime.generate({ prompt: 'offline test' }), {
      status: 'disabled',
    });
    assert.throws(
      () =>
        localAi.readLocalAiConfig({
          AI_MODE: 'local',
          LOCAL_AI_ENDPOINT: 'https://remote.example.invalid/v1',
        }),
      /localhost, 127\.0\.0\.1/iu
    );

    assert.deepEqual(egressAttempts, []);
  });
});
