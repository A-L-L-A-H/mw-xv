import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  AccessDeniedError,
  NotFoundError,
  ValidationError,
  isJsonValue,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonValue,
} from '@moonwitness/types';
import { DesktopRiskGate, isLoopbackEndpointUrl, redactSensitiveValue } from './risk-gate.js';
import type {
  DesktopActionKind,
  LocalMcpServerConfig,
  LocalMcpToolHandler,
  LocalMcpToolInvocationRequest,
  LocalMcpToolInvocationResult,
  RiskTier,
} from './types.js';

const SERVER_ID_REGEX = /^[a-z][a-z0-9._-]{1,63}$/u;
const TOOL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$/u;
const CAPABILITY_REGEX = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@v[1-9][0-9]*$/u;
const BARE_COMMAND_REGEX = /^[a-zA-Z0-9._-]+$/u;

const RISK_ORDER: Readonly<Record<RiskTier, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

export interface LocalMcpHostOptions {
  readonly riskGate?: DesktopRiskGate;
  readonly knownSecrets?: readonly string[];
  readonly initialServers?: readonly LocalMcpServerConfig[];
}

export class LocalMcpHostRegistry {
  private readonly servers = new Map<string, LocalMcpServerConfig>();
  private readonly handlers = new Map<string, LocalMcpToolHandler>();
  private readonly runQuotas = new Map<string, number>();
  private readonly riskGate: DesktopRiskGate;
  private readonly knownSecrets: readonly string[];

  constructor(options?: LocalMcpHostOptions) {
    this.riskGate = options?.riskGate ?? new DesktopRiskGate();
    this.knownSecrets = options?.knownSecrets ?? [];
    for (const server of options?.initialServers ?? []) {
      this.registerServer(server);
    }
  }

  registerServer(config: LocalMcpServerConfig): LocalMcpServerConfig {
    if (!SERVER_ID_REGEX.test(config.serverId)) {
      throw new ValidationError(`Invalid MCP serverId '${config.serverId}'`);
    }
    if (!config.name.trim()) {
      throw new ValidationError(`MCP server '${config.serverId}' must define a name`);
    }
    if (!CAPABILITY_REGEX.test(config.requiredCapability)) {
      throw new ValidationError(
        `Invalid requiredCapability '${config.requiredCapability}' on MCP server '${config.serverId}'`
      );
    }
    if (!Number.isSafeInteger(config.maxCallsPerRun) || config.maxCallsPerRun < 1) {
      throw new ValidationError(`MCP server '${config.serverId}' maxCallsPerRun must be >= 1`);
    }
    if (config.maxRiskTier === 'R4') {
      throw new AccessDeniedError('MCP server cannot be configured with prohibited risk tier R4');
    }

    if (config.transport === 'stdio') {
      if (!config.command || !BARE_COMMAND_REGEX.test(config.command)) {
        throw new ValidationError(
          `MCP stdio server '${config.serverId}' requires a bare command executable`
        );
      }
      for (const arg of config.args ?? []) {
        if (arg.includes('\0')) {
          throw new ValidationError(`MCP server '${config.serverId}' arg contains NUL byte`);
        }
      }
    } else if (config.transport === 'loopback_http') {
      if (!config.endpointUrl || !isLoopbackEndpointUrl(config.endpointUrl)) {
        throw new AccessDeniedError(
          `MCP loopback_http server '${config.serverId}' endpointUrl must target loopback (127.0.0.1/localhost/::1)`
        );
      }
    } else {
      throw new ValidationError(`Unsupported MCP transport on server '${config.serverId}'`);
    }

    const frozen: LocalMcpServerConfig = Object.freeze({
      ...config,
      ...(config.args ? { args: [...config.args] } : {}),
      allowedDataClassifications: [...config.allowedDataClassifications],
    });
    this.servers.set(config.serverId, frozen);
    return frozen;
  }

  registerHandler(serverId: string, handler: LocalMcpToolHandler): void {
    if (!this.servers.has(serverId)) {
      throw new NotFoundError(`MCP server '${serverId}' is not registered`);
    }
    this.handlers.set(serverId, handler);
  }

  listServers(): readonly LocalMcpServerConfig[] {
    return [...this.servers.values()];
  }

  async invoke(request: LocalMcpToolInvocationRequest): Promise<LocalMcpToolInvocationResult> {
    const server = this.servers.get(request.serverId);
    if (!server) {
      throw new NotFoundError(`MCP server '${request.serverId}' not found`);
    }
    if (!server.enabled) {
      throw new AccessDeniedError(`MCP server '${request.serverId}' is disabled`);
    }
    if (!TOOL_NAME_REGEX.test(request.toolName)) {
      throw new ValidationError(`Invalid MCP toolName '${request.toolName}'`);
    }
    if (!isJsonValue(request.arguments)) {
      throw new ValidationError('MCP tool arguments must be valid JSON');
    }

    if (!server.allowedDataClassifications.includes(request.auth.dataClassification)) {
      throw new AccessDeniedError(
        `MCP server '${server.serverId}' does not allow data classification '${request.auth.dataClassification}'`
      );
    }
    if (request.auth.grant.capability !== server.requiredCapability) {
      throw new AccessDeniedError(
        `Grant capability '${request.auth.grant.capability}' does not match server requirement '${server.requiredCapability}'`
      );
    }

    const action: DesktopActionKind =
      RISK_ORDER[server.maxRiskTier] >= RISK_ORDER.R1 ? 'mcp.local_write' : 'mcp.read';

    this.riskGate.assertAllowed({
      runId: request.runId,
      action,
      companyId: request.auth.companyId,
      agentId: request.auth.agentId,
      workContractId: request.auth.workContractId,
      expectedPolicyVersion: request.auth.expectedPolicyVersion,
      dataClassification: request.auth.dataClassification,
      grant: request.auth.grant,
      humanApproval: request.auth.humanApproval,
      targetEndpointUrl: server.endpointUrl,
    });

    const quotaKey = `${request.runId}::${server.serverId}`;
    const usedCalls = this.runQuotas.get(quotaKey) ?? 0;
    if (usedCalls >= server.maxCallsPerRun) {
      throw new AccessDeniedError(
        `MCP server '${server.serverId}' quota exceeded for run '${request.runId}' (${server.maxCallsPerRun})`
      );
    }
    this.runQuotas.set(quotaKey, usedCalls + 1);
    const callCountForRun = usedCalls + 1;

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(100, server.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const handler = this.handlers.get(server.serverId);
      const rawOutput = handler
        ? await this.runWithTimeout(
            handler(request.toolName, request.arguments, controller.signal),
            timeoutMs,
            server.serverId
          )
        : server.transport === 'stdio'
          ? await this.invokeStdioJsonRpc(server, request, timeoutMs)
          : await this.invokeLoopbackHttp(server, request, controller.signal);

      const redactedResult = redactSensitiveValue(rawOutput, this.knownSecrets);
      const serialized = JSON.stringify(redactedResult.value ?? null);
      const outputSha256 = createHash('sha256').update(serialized).digest('hex');

      return {
        serverId: server.serverId,
        toolName: request.toolName,
        output: redactedResult.value,
        outputSha256,
        redacted: redactedResult.redacted,
        callCountForRun,
        durationMs: Math.max(0, Date.now() - startTime),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    serverId: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new ValidationError(`MCP server '${serverId}' timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async invokeLoopbackHttp(
    server: LocalMcpServerConfig,
    request: LocalMcpToolInvocationRequest,
    signal: AbortSignal
  ): Promise<JsonValue> {
    if (!server.endpointUrl || !isLoopbackEndpointUrl(server.endpointUrl)) {
      throw new AccessDeniedError('Non-loopback MCP HTTP endpoint blocked');
    }
    const rpcPayload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `${request.runId}:${request.toolName}`,
      method: 'tools/call',
      params: {
        name: request.toolName,
        arguments: request.arguments,
      },
    };
    const response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcPayload),
      signal,
    });
    if (!response.ok) {
      throw new ValidationError(
        `MCP loopback HTTP server '${server.serverId}' returned status ${response.status}`
      );
    }
    const decoded = (await response.json()) as JsonRpcResponse<JsonValue>;
    if (decoded.error) {
      throw new ValidationError(`MCP tool error (${decoded.error.code}): ${decoded.error.message}`);
    }
    return decoded.result ?? null;
  }

  private async invokeStdioJsonRpc(
    server: LocalMcpServerConfig,
    request: LocalMcpToolInvocationRequest,
    timeoutMs: number
  ): Promise<JsonValue> {
    if (!server.command) {
      throw new ValidationError(`MCP stdio server '${server.serverId}' has no command`);
    }
    const executable = server.command === 'node' ? process.execPath : server.command;
    const rpcPayload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `${request.runId}:${request.toolName}`,
      method: 'tools/call',
      params: {
        name: request.toolName,
        arguments: request.arguments,
      },
    };

    return await new Promise<JsonValue>((resolve, reject) => {
      const child = spawn(executable, [...(server.args ?? [])], {
        shell: false,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
        },
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new ValidationError(`MCP stdio server '${server.serverId}' timed out`));
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString('utf8');
          reject(
            new ValidationError(
              `MCP stdio server '${server.serverId}' exited with code ${String(code)}: ${stderrText}`
            )
          );
          return;
        }
        const rawLine =
          Buffer.concat(stdoutChunks).toString('utf8').trim().split(/\r?\n/u).pop() ?? '';
        try {
          const parsed = JSON.parse(rawLine) as JsonRpcResponse<JsonValue>;
          if (parsed.error) {
            reject(
              new ValidationError(`MCP tool error (${parsed.error.code}): ${parsed.error.message}`)
            );
            return;
          }
          resolve(parsed.result ?? null);
        } catch (error) {
          reject(
            new ValidationError(`MCP stdio server '${server.serverId}' returned invalid JSON-RPC`, {
              cause: error,
            })
          );
        }
      });

      child.stdin.write(`${JSON.stringify(rpcPayload)}\n`);
      child.stdin.end();
    });
  }
}
