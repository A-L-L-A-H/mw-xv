/**
 * Newline-delimited JSON-RPC 2.0 stdio transport for the MoonWitness MCP
 * server, modeled on `serveAiMcpStdio` in `@moonwitness/ai-mcp` (which
 * supports both NDJSON and Content-Length framing — here we implement
 * both for host compatibility).
 */
import { isRecord } from '@moonwitness/types';
import type {
  MoonWitnessMcpServer,
  MoonWitnessMcpRequest,
  MoonWitnessMcpResponse,
} from './server.js';

export interface MoonWitnessStdioStreams {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export interface MoonWitnessStdioHandle {
  readonly done: Promise<void>;
  close(): Promise<void>;
}

export function serveMoonWitnessStdio(
  server: MoonWitnessMcpServer,
  streams: MoonWitnessStdioStreams = {}
): MoonWitnessStdioHandle {
  const input: NodeJS.ReadableStream = streams.input ?? process.stdin;
  const output: NodeJS.WritableStream = streams.output ?? process.stdout;
  let buffer = Buffer.alloc(0);
  let closed = false;
  let pending: Promise<void> = Promise.resolve();

  const writeResponse = (
    response: MoonWitnessMcpResponse,
    framing: 'content-length' | 'ndjson'
  ): void => {
    const payload = JSON.stringify(response);
    if (framing === 'content-length') {
      const byteLen = Buffer.byteLength(payload, 'utf8');
      output.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
    } else {
      output.write(`${payload}\n`);
    }
  };

  const dispatchMessage = async (
    raw: string,
    framing: 'content-length' | 'ndjson'
  ): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      writeResponse(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: invalid JSON' },
        },
        framing
      );
      return;
    }

    if (!isRecord(parsed) || typeof parsed['method'] !== 'string') {
      writeResponse(
        {
          jsonrpc: '2.0',
          id:
            isRecord(parsed) &&
            (typeof parsed['id'] === 'string' || typeof parsed['id'] === 'number')
              ? (parsed['id'] as string | number)
              : null,
          error: { code: -32600, message: 'Invalid Request' },
        },
        framing
      );
      return;
    }

    const response = await server.handleRequest(parsed as unknown as MoonWitnessMcpRequest);
    if (Object.hasOwn(parsed, 'id')) {
      writeResponse(response, framing);
    }
  };

  const processBuffer = (): void => {
    while (buffer.length > 0) {
      let start = 0;
      while (start < buffer.length && (buffer[start] === 0x0d || buffer[start] === 0x0a)) start++;
      if (start > 0) buffer = buffer.subarray(start);
      if (buffer.length === 0) break;

      const headPreview = buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8');
      if (/^content-length\s*:/iu.test(headPreview)) {
        const headerEndCrlf = buffer.indexOf('\r\n\r\n');
        const headerEndLf = buffer.indexOf('\n\n');
        const headerEnd =
          headerEndCrlf !== -1 && (headerEndLf === -1 || headerEndCrlf < headerEndLf)
            ? headerEndCrlf
            : headerEndLf;
        if (headerEnd === -1) break;
        const sepLen = headerEnd === headerEndCrlf ? 4 : 2;

        const headerText = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /content-length\s*:\s*(\d+)/iu.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(headerEnd + sepLen);
          continue;
        }
        const contentLength = Number(match[1]);
        const totalLength = headerEnd + sepLen + contentLength;
        if (buffer.length < totalLength) break;

        const body = buffer.subarray(headerEnd + sepLen, totalLength).toString('utf8');
        buffer = buffer.subarray(totalLength);
        pending = pending.then(() => dispatchMessage(body, 'content-length'));
      } else {
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) break;
        const line = buffer.subarray(0, newlineIdx).toString('utf8');
        buffer = buffer.subarray(newlineIdx + 1);
        pending = pending.then(() => dispatchMessage(line, 'ndjson'));
      }
    }
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const onData = (chunk: Buffer | string): void => {
    if (closed) return;
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    buffer = Buffer.concat([buffer, buf]);
    processBuffer();
  };

  const onEnd = (): void => {
    if (!closed && buffer.length > 0) {
      const remaining = buffer.toString('utf8').trim();
      buffer = Buffer.alloc(0);
      if (remaining) pending = pending.then(() => dispatchMessage(remaining, 'ndjson'));
    }
    void pending.finally(() => resolveDone());
  };

  input.on('data', onData);
  input.on('end', onEnd);

  return {
    done,
    async close() {
      if (closed) return;
      closed = true;
      input.off('data', onData);
      input.off('end', onEnd);
      await pending;
      resolveDone();
    },
  };
}
