import http from 'node:http';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function startEphemeralHttpServer(kind, mode, options = {}) {
  const calls = [];
  const activeTimers = new Set();
  const activeSockets = new Set();

  const server = http.createServer(async (req, res) => {
    const bodyText = await readRequestBody(req);
    const bodyJson = tryParseJson(bodyText);
    calls.push({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: { ...req.headers },
      bodyText,
      bodyJson,
      timestamp: new Date().toISOString(),
    });

    if (mode === 'timeout') {
      const delayMs = options.timeoutDelayMs ?? 60_000;
      const timer = globalThis.setTimeout(() => {
        activeTimers.delete(timer);
        if (!res.writableEnded) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mock upstream timeout' }));
        }
      }, delayMs);
      timer.unref?.();
      activeTimers.add(timer);
      req.on('close', () => {
        activeTimers.delete(timer);
        globalThis.clearTimeout(timer);
      });
      return;
    }

    if (mode === 'rate_limit') {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '1',
      });
      res.end(
        JSON.stringify({
          error: { message: 'rate limit exceeded', type: 'rate_limit_error', code: '429' },
        })
      );
      return;
    }

    if (mode === 'error_500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `mock ${kind} internal error`, type: 'server_error', code: '500' },
        })
      );
      return;
    }

    if (mode === 'malformed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"malformed": true, "truncated": ');
      return;
    }

    const reqPath = (req.url ?? '/').split('?')[0];

    if (kind === 'ollama') {
      if (reqPath === '/api/tags' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              {
                name: options.model ?? 'qwen2.5:3b-instruct-q4_K_M',
                model: options.model ?? 'qwen2.5:3b-instruct-q4_K_M',
                size: 1024,
              },
            ],
          })
        );
        return;
      }

      if (reqPath === '/api/chat' && req.method === 'POST') {
        const defaultContent = JSON.stringify({
          status: 'ok',
          summary: 'Mock Ollama chat completion',
          findings: [],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: bodyJson?.model ?? options.model ?? 'qwen2.5:3b-instruct-q4_K_M',
            message: {
              role: 'assistant',
              content: options.chatContent ?? defaultContent,
            },
            done: true,
            prompt_eval_count: 14,
            eval_count: 22,
          })
        );
        return;
      }

      if (reqPath === '/api/generate' && req.method === 'POST') {
        const defaultResponse = JSON.stringify({
          status: 'ok',
          summary: 'Mock Ollama generate response',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: bodyJson?.model ?? options.model ?? 'qwen2.5:3b-instruct-q4_K_M',
            response: options.generateContent ?? defaultResponse,
            done: true,
            prompt_eval_count: 14,
            eval_count: 22,
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unsupported mock Ollama route: ${req.method} ${reqPath}` }));
      return;
    }

    if (reqPath === '/health' || reqPath === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          data: [{ id: options.model ?? 'mock-cloud-model', object: 'model' }],
        })
      );
      return;
    }

    if (reqPath === '/v1/chat/completions' && req.method === 'POST') {
      const defaultContent = JSON.stringify({
        status: 'ok',
        summary: 'Mock Cloud OpenAI-compatible completion',
        findings: [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock-001',
          object: 'chat.completion',
          model: bodyJson?.model ?? options.model ?? 'mock-cloud-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: options.chatContent ?? defaultContent,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 24,
            total_tokens: 42,
          },
        })
      );
      return;
    }

    if (reqPath === '/v1/messages' && req.method === 'POST') {
      const defaultText = JSON.stringify({
        status: 'ok',
        summary: 'Mock Cloud Anthropic-compatible completion',
        findings: [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg-mock-001',
          type: 'message',
          role: 'assistant',
          model: bodyJson?.model ?? options.model ?? 'mock-claude-model',
          content: [{ type: 'text', text: options.chatContent ?? defaultText }],
          usage: {
            input_tokens: 18,
            output_tokens: 24,
          },
        })
      );
      return;
    }

    if (reqPath === '/v1/generate' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          text: options.generateContent ?? JSON.stringify({ status: 'ok' }),
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unsupported mock Cloud route: ${req.method} ${reqPath}` }));
  });

  server.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(`Failed to resolve bound port for mock ${kind} server`);
  }
  const url = `http://127.0.0.1:${address.port}`;

  if (mode === 'offline') {
    await new Promise((resolve) => server.close(resolve));
    return {
      url,
      calls,
      close: async () => {},
    };
  }

  return {
    url,
    calls,
    close: async () => {
      for (const timer of activeTimers) {
        globalThis.clearTimeout(timer);
      }
      activeTimers.clear();
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}

export async function startMockOllamaServer(mode = 'ok', options = {}) {
  return startEphemeralHttpServer('ollama', mode, options);
}

export async function startMockCloudServer(mode = 'ok', options = {}) {
  return startEphemeralHttpServer('cloud', mode, options);
}
