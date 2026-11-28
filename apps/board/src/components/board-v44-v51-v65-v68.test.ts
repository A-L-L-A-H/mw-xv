import { describe, expect, it } from 'bun:test';
import { appendRocksoulEvent, parseRocksoulSseEvent } from './ai/rocksoul-sse';
import {
  applyMwEchoStatusEvent,
  parseMwEchoStatusFrame,
  resolveMwEchoWsUrl,
  type MwEchoStatusRecord,
} from './whatsapp/mw-echo-stream';
import { normalizeEpistemicAnswer, parseEpistemicQuery } from './layout/epistemic-omnibar';

describe('V44 Rocksoul Core SSE telemetry helpers', () => {
  it('parses Rocksoul SSE telemetry frames and deduplicates ring buffer', () => {
    const evt = parseRocksoulSseEvent(
      JSON.stringify({
        id: 'rs-1',
        kind: 'artifact.verified',
        node_id: 'rocksoul-node-a',
        summary: 'Verified SHA-256 manifest',
        latency_ms: 42,
      })
    );
    expect(evt).not.toBeNull();
    expect(evt?.kind).toBe('artifact.verified');
    expect(evt?.nodeId).toBe('rocksoul-node-a');
    expect(evt?.latencyMs).toBe(42);

    const list1 = appendRocksoulEvent([], evt!, 2);
    const list2 = appendRocksoulEvent(list1, evt!, 2);
    expect(list2).toHaveLength(1);
    expect(parseRocksoulSseEvent('not-json')).toBeNull();
  });
});

describe('V51 mw-echo WhatsApp Status WebSocket helpers', () => {
  it('resolves ws/wss URLs and merges live status updates in place', () => {
    expect(resolveMwEchoWsUrl('https://board.moonwitness.dev/')).toBe(
      'wss://board.moonwitness.dev/ws/mw-echo/statuses'
    );
    expect(resolveMwEchoWsUrl('http://localhost:8000')).toBe(
      'ws://localhost:8000/ws/mw-echo/statuses'
    );

    const frame = parseMwEchoStatusFrame(
      JSON.stringify({
        type: 'status.sent',
        item: {
          id: 10,
          status_type: 'text',
          content: 'Live update',
          media_file_name: null,
          allow_reshare: false,
          status: 'sent',
          attempt_count: 1,
          last_error: null,
          published_at: '2026-11-27T10:00:00Z',
          create_date: '2026-11-27T09:59:00Z',
        },
      })
    );
    expect(frame?.type).toBe('status.update');

    const initial: MwEchoStatusRecord[] = [
      {
        id: 10,
        status_type: 'text',
        content: 'Live update',
        media_file_name: null,
        allow_reshare: false,
        status: 'queued',
        attempt_count: 0,
        last_error: null,
        published_at: null,
        create_date: '2026-11-27T09:59:00Z',
      },
    ];
    const merged = applyMwEchoStatusEvent(initial, frame!);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe('sent');
    expect(merged[0]?.attempt_count).toBe(1);
  });
});

describe('V65 Ask Epistemic Empire omnibar helpers', () => {
  it('classifies epistemic questions and normalizes citations', () => {
    const parsed = parseEpistemicQuery('? why did invoice 42 fail');
    expect(parsed.isExplicitQuestion).toBe(true);
    expect(parsed.normalizedQuery).toBe('why did invoice 42 fail');

    const answer = normalizeEpistemicAnswer(parsed.normalizedQuery, {
      data: {
        answer: 'Invoice 42 failed due to expired VA token.',
        confidence: 'high',
        citations: [{ title: 'Mizan Ledger #42', source: 'mizan', href: '/board/m/account.move/42' }],
      },
    });
    expect(answer.confidence).toBe('high');
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]?.href).toBe('/board/m/account.move/42');
  });
});
