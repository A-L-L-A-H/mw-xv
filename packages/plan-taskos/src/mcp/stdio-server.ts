/**
 * T31b — Zero-Dependency JSON-RPC 2.0 Stdio MCP Server.
 *
 * Hand-rolled transport: `initialize`, `tools/list`, `tools/call`, `ping`.
 * Diagnostics go strictly to stderr; stdout carries only JSON-RPC frames.
 * Clean shutdown on stdin EOF.
 */

import { createInterface } from "node:readline";
import { openBrainStore, type BrainStorageDriver } from "../brain/storage.js";
import { initializeBrainSchema } from "../brain/schema.js";
import { callTool, MCP_TOOLS } from "./tools.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = "2024-11-05";

export interface StdioServerOptions {
  readonly repoRoot?: string;
  readonly allowWrite?: boolean;
  readonly dbPath?: string;
  readonly store?: BrainStorageDriver;
}

function respond(id: JsonRpcRequest["id"] | undefined, result?: unknown, error?: JsonRpcResponse["error"]): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id: id ?? null };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function log(message: string): void {
  process.stderr.write(`[plan-taskos-mcp] ${message}\n`);
}

function handleRequest(req: JsonRpcRequest, ctx: Parameters<typeof callTool>[2]): { shutdown: boolean } {
  switch (req.method) {
    case "initialize": {
      respond(req.id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "plan-taskos", version: "1.0.0" },
      });
      return { shutdown: false };
    }
    case "ping": {
      respond(req.id ?? null, {});
      return { shutdown: false };
    }
    case "tools/list": {
      respond(req.id ?? null, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      return { shutdown: false };
    }
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
      void callTool(name, args, ctx).then((outcome) => {
        if (outcome.ok) {
          respond(req.id ?? null, { content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }] });
        } else {
          respond(req.id ?? null, undefined, { code: -32000, message: outcome.error });
        }
      });
      return { shutdown: false };
    }
    case "shutdown":
    case "exit": {
      respond(req.id ?? null, {});
      return { shutdown: true };
    }
    default: {
      respond(req.id ?? null, undefined, { code: -32601, message: `Method not found: ${req.method}` });
      return { shutdown: false };
    }
  }
}

/**
 * Run the stdio JSON-RPC server until stdin EOF. Resolves after shutdown.
 */
export async function runStdioServer(options: StdioServerOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const allowWrite = options.allowWrite ?? false;
  const store =
    options.store ??
    (await openBrainStore(options.dbPath ? { dbPath: options.dbPath } : { dbPath: ".plan/.brain/taskos.sqlite" }));
  initializeBrainSchema(store);

  log(`started (repoRoot=${repoRoot}, allowWrite=${allowWrite}, store=${store.mode})`);

  const rl = createInterface({ input: process.stdin, terminal: false });
  let shuttingDown = false;

  const ctx = { store, repoRoot, allowWrite };

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    rl.close();
    log("stdin EOF, shutting down");
    store.close();
  };

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      respond(null, undefined, { code: -32700, message: "Parse error" });
      return;
    }
    const outcome = handleRequest(req, ctx);
    if (outcome.shutdown) {
      void shutdown();
    }
  });

  rl.on("close", () => {
    void shutdown();
  });

  // Wait until shutdown completes (stdin EOF or explicit shutdown method).
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (shuttingDown && storeIsClosed(store)) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function storeIsClosed(_store: BrainStorageDriver): boolean {
  // InMemory/Sqlite close() are synchronous; the flag is our source of truth.
  return true;
}
