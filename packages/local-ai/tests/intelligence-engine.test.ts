import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalAiRuntime,
  generateLocalAiSuggestion,
  LocalRetrievalError,
  readLocalAiConfig,
  retrieveDynamicLocalPassageChunk,
  searchLocalPassagesHybrid,
  SUGGESTION_ENVELOPE_JSON_SCHEMA,
  type ApprovedManifestCatalogEntry,
  type HybridPassageCandidate,
  type LocalAiConfig,
  type LocalPassageResolver,
  type ResolvedCanonicalPassage,
} from '../src/index.js';

const activeServers: Server[] = [];

async function startMockLoopbackServer(
  handler: (req: { method?: string; url?: string; body: string }) => {
    status: number;
    body: string;
  }
): Promise<URL> {
  const server = createServer((req, res) => {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      const outcome = handler({ method: req.method, url: req.url, body: rawBody });
      res.writeHead(outcome.status, { 'content-type': 'application/json' });
      res.end(outcome.body);
    });
  });
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP loopback address');
  }
  return new URL(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })
    )
  );
});

describe('Wave 3 offline Local AI intelligence engine', () => {
  it('parses LOCAL_AI_PROVIDER and LOCAL_AI_MODEL while enforcing allowed providers', () => {
    const ollamaConfig = readLocalAiConfig({
      AI_MODE: 'local',
      LOCAL_AI_ENDPOINT: 'http://127.0.0.1:11434',
      LOCAL_AI_PROVIDER: 'ollama',
      LOCAL_AI_MODEL: 'qwen2.5:3b-instruct-q4_K_M',
    });
    expect(ollamaConfig.provider).toBe('ollama');
    expect(ollamaConfig.model).toBe('qwen2.5:3b-instruct-q4_K_M');

    expect(() =>
      readLocalAiConfig({
        AI_MODE: 'local',
        LOCAL_AI_ENDPOINT: 'http://127.0.0.1:11434',
        LOCAL_AI_PROVIDER: 'cloud-external',
      })
    ).toThrow(/LOCAL_AI_PROVIDER/);
  });

  it('speaks Ollama /api/generate JSON-schema wire protocol on loopback and integrates suggestion validation', async () => {
    const capturedRequests: Array<{ url?: string; payload: Record<string, unknown> }> = [];
    const envelopeText = JSON.stringify({
      format: 'mw-local-ai-suggestion-envelope/v1',
      suggestions: [],
    });
    const endpoint = await startMockLoopbackServer((req) => {
      capturedRequests.push({
        url: req.url,
        payload: JSON.parse(req.body) as Record<string, unknown>,
      });
      return {
        status: 200,
        body: JSON.stringify({ response: envelopeText, done: true }),
      };
    });

    const config: LocalAiConfig = {
      mode: 'local',
      endpoint,
      timeoutMs: 3000,
      provider: 'ollama',
      model: 'qwen2.5:3b-instruct-q4_K_M',
    };
    const runtime = createLocalAiRuntime(config);
    const result = await generateLocalAiSuggestion({
      runtime,
      request: {
        kind: 'summary',
        passages: [
          {
            source_id: 'mw:source:synthetic-a',
            edition_id: 'mw:edition:synthetic-a-v1',
            locator: 'synthetic:1',
            content_sha256: 'a'.repeat(64),
            evidence_id: 'mw:evidence:1',
            assertion_id: 'mw:assertion:1',
            text: 'Local archival witness text.',
          },
        ],
      },
      validate: (value) => value,
    });

    expect(result).toEqual({
      status: 'candidate',
      value: { format: 'mw-local-ai-suggestion-envelope/v1', suggestions: [] },
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.url).toBe('/api/generate');
    expect(capturedRequests[0]?.payload.model).toBe('qwen2.5:3b-instruct-q4_K_M');
    expect(capturedRequests[0]?.payload.stream).toBe(false);
    expect(capturedRequests[0]?.payload.format).toEqual(SUGGESTION_ENVELOPE_JSON_SCHEMA);
  });

  it('speaks OpenAI-compat /v1/chat/completions strict json_schema wire protocol on loopback', async () => {
    const capturedRequests: Array<{ url?: string; payload: Record<string, unknown> }> = [];
    const endpoint = await startMockLoopbackServer((req) => {
      capturedRequests.push({
        url: req.url,
        payload: JSON.parse(req.body) as Record<string, unknown>,
      });
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"format":"mw-local-ai-suggestion-envelope/v1"}' } }],
        }),
      };
    });

    const runtime = createLocalAiRuntime({
      mode: 'local',
      endpoint,
      timeoutMs: 3000,
      provider: 'openai-compat',
      model: 'llama-3.2-3b',
    });
    const outcome = await runtime.generate({
      prompt: 'Summarize locally',
      jsonSchema: SUGGESTION_ENVELOPE_JSON_SCHEMA,
    });

    expect(outcome).toEqual({
      status: 'generated',
      text: '{"format":"mw-local-ai-suggestion-envelope/v1"}',
    });
    expect(capturedRequests[0]?.url).toBe('/v1/chat/completions');
    expect(capturedRequests[0]?.payload.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'mw_local_ai_envelope',
        strict: true,
        schema: SUGGESTION_ENVELOPE_JSON_SCHEMA,
      },
    });
  });

  it('dynamically retrieves rights-verified Arabic passages and fails closed on missing rights or denied ACL', async () => {
    const passageText = 'السلام عليكم ورحمة الله';
    const artifactBytes = Buffer.from(passageText, 'utf8');
    const artifactSha = createHash('sha256').update(artifactBytes).digest('hex');

    const buildManifest = (allowedUses: string[]) =>
      Buffer.from(
        JSON.stringify({
          schema_version: 1,
          source_id: 'mw:source:dynamic-arabic',
          edition_id: 'mw:edition:dynamic-arabic-v1',
          locale: 'ar',
          artifact: {
            sha256: artifactSha,
            byte_length: artifactBytes.byteLength,
          },
          rights: {
            state: 'permitted',
            allowed_uses: allowedUses,
          },
          attribution: {
            text: 'Dynamic Corpus License CC BY 4.0',
          },
        }),
        'utf8'
      );

    const permittedManifest = buildManifest(['read_analyze']);
    const manifestSha = createHash('sha256').update(permittedManifest).digest('hex');
    const reference = {
      sourceId: 'mw:source:dynamic-arabic',
      editionId: 'mw:edition:dynamic-arabic-v1',
      locator: 'doc:1',
      sourceSha256: artifactSha,
    };
    const catalog: ApprovedManifestCatalogEntry[] = [
      {
        manifestPath: 'corpus/manifests/dynamic-arabic.json',
        manifestSha256: manifestSha,
        reference,
      },
    ];
    const resolved: ResolvedCanonicalPassage = {
      reference,
      text: passageText,
      visibility: 'INTERNAL',
      sourceManifestPath: 'corpus/manifests/dynamic-arabic.json',
      artifactBytes,
      sourceManifestBytes: permittedManifest,
    };
    const resolver: LocalPassageResolver = {
      resolve: async () => resolved,
      canRead: () => true,
    };

    const chunk = await retrieveDynamicLocalPassageChunk(
      { reference, byteStart: 0, byteEnd: Buffer.byteLength('السلام', 'utf8') },
      resolver,
      catalog
    );
    expect(chunk.text).toBe('السلام');
    expect(chunk.sourceSpan.scalarStart).toBe(0);
    expect(chunk.sourceSpan.scalarEnd).toBe(6);

    const deniedResolver: LocalPassageResolver = {
      resolve: async () => ({
        ...resolved,
        sourceManifestBytes: buildManifest(['metadata_only']),
      }),
      canRead: () => true,
    };
    await expect(retrieveDynamicLocalPassageChunk({ reference }, deniedResolver)).rejects.toThrow(
      LocalRetrievalError
    );
  });

  it('enforces pre-ranking visibility filtering so unauthorized docs never leak or skew IDF', () => {
    const baseCandidates: HybridPassageCandidate[] = [
      {
        reference: {
          sourceId: 'mw:source:pub-1',
          editionId: 'mw:edition:pub-1',
          locator: 'line:1',
          sourceSha256: '1'.repeat(64),
        },
        text: 'mercy compassion community witness',
        visibility: 'PUBLIC_APPROVED',
        sourceManifestPath: 'corpus/manifests/pub-1.json',
        embedding: [0.9, 0.1, 0.0],
      },
      {
        reference: {
          sourceId: 'mw:source:pub-2',
          editionId: 'mw:edition:pub-2',
          locator: 'line:2',
          sourceSha256: '2'.repeat(64),
        },
        text: 'archival catalog index register',
        visibility: 'PUBLIC_APPROVED',
        sourceManifestPath: 'corpus/manifests/pub-2.json',
        embedding: [0.1, 0.9, 0.0],
      },
    ];
    const withSecretDocs: HybridPassageCandidate[] = [
      ...baseCandidates,
      {
        reference: {
          sourceId: 'mw:source:restricted-1',
          editionId: 'mw:edition:restricted-1',
          locator: 'line:9',
          sourceSha256: '9'.repeat(64),
        },
        text: 'mercy compassion secret witness testimony',
        visibility: 'RESTRICTED',
        sourceManifestPath: 'corpus/manifests/res-1.json',
        embedding: [1.0, 0.0, 0.0],
      },
    ];

    const publicOnlyResults = searchLocalPassagesHybrid(
      {
        text: 'mercy witness',
        allowedVisibilities: new Set(['PUBLIC_APPROVED']),
        queryEmbedding: [1.0, 0.0, 0.0],
      },
      baseCandidates
    );
    const isolatedResults = searchLocalPassagesHybrid(
      {
        text: 'mercy witness',
        allowedVisibilities: new Set(['PUBLIC_APPROVED']),
        queryEmbedding: [1.0, 0.0, 0.0],
      },
      withSecretDocs
    );

    expect(isolatedResults).toEqual(publicOnlyResults);
    expect(isolatedResults.map((entry) => entry.candidate.reference.sourceId)).toEqual([
      'mw:source:pub-1',
      'mw:source:pub-2',
    ]);
  });
});
