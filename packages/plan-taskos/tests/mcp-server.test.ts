/**
 * T36b — MCP stdio server E2E: spawn `dist/cli.js mcp` over stdio pipes.
 *
 * Asserts JSON-RPC initialize, tools/list, tools/call (plan_list, plan_recall,
 * plan_impact), and the read-only guard rejecting plan_complete without
 * --allow-write.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(__dirname, "..", "dist", "cli.js");
const PROTOCOL_VERSION = "2024-11-05";

function git(repo: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

interface JsonRpcFrame {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioMcpClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, (frame: JsonRpcFrame) => void>();

  constructor(repoRoot: string, extraArgs: readonly string[] = []) {
    this.proc = spawn(process.execPath, [CLI_PATH, "mcp", ...extraArgs], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            const frame = JSON.parse(line) as JsonRpcFrame;
            if (typeof frame.id === "number") {
              const resolve = this.pending.get(frame.id);
              if (resolve) {
                this.pending.delete(frame.id);
                resolve(frame);
              }
            }
          } catch {
            // ignore non-JSON stdout noise (should never happen)
          }
        }
        newlineIndex = this.buffer.indexOf("\n");
      }
    });
    this.proc.stderr.setEncoding("utf8");
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcFrame> {
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }, 20_000);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.proc.stdin.write(frame);
    });
  }

  notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  async close(): Promise<void> {
    this.notify("shutdown");
    await new Promise<void>((resolve) => {
      if (this.proc.exitCode !== null) {
        resolve();
        return;
      }
      this.proc.once("exit", () => resolve());
      setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 5_000);
    });
  }
}

async function seedRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "plan-taskos-mcp-e2e-"));
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.email", "e2e@test.local");
  git(repo, "config", "user.name", "E2E");
  const planId = "mcp-plan";
  const planDir = join(repo, ".plan", planId);
  await mkdir(join(planDir, "waves"), { recursive: true });
  await mkdir(join(repo, ".plan", ".brain"), { recursive: true });
  await writeFile(
    join(repo, ".gitignore"),
    ".plan/.brain/\n.plan/*/.leases.local.json\n",
    "utf8"
  );

  const manifest = {
    schema_version: "1.0.0",
    plan_id: planId,
    title: "MCP Plan",
    repo: { org: "e2e", name: "repo", target_branch: "main" },
    adr_file: `.plan/${planId}/ADR-001.md`,
    execution_policy: {
      max_attempts_per_task: 2,
      default_model_tier: "flash",
      escalation_chain: ["flash", "neon", "argon", "human"],
      require_clean_scope: true,
      auto_commit: false,
    },
    projections: { github_fold_mode: "wave", taskos_project: planId, orm_project_code: planId },
    waves: [
      { id: "W0", title: "Wave 0", wave_file: `.plan/${planId}/waves/W0.json`, depends_on: [] },
    ],
    documents: [],
  };
  await writeFile(join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const wave = {
    schema_version: "1.0.0",
    plan_id: planId,
    wave_id: "W0",
    title: "Wave 0",
    tasks: [
      {
        urn: `urn:mw:work:e2e/repo:${planId}:W0/T01`,
        code: "T01",
        kind: "task",
        title: "MCP test task",
        lifecycle: { status: "todo", delivery_stage: "local", attempts: 0 },
        governance: { owner_files: ["src/example.ts"], owner_globs: [], invariants: [], do_not: [] },
        graph: { depends_on: [] },
        knowledge: { spec_files: [], adr_files: [], invariant_urns: [], doc_urns: [] },
        verification: {
          commands: [{ cmd: "node --version", expected_exit_code: 0 }],
          acceptance_criteria: ["node exists"],
        },
        projections: { taskos_code: "T01" },
      },
    ],
  };
  await writeFile(join(planDir, "waves", "W0.json"), JSON.stringify(wave, null, 2), "utf8");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "example.ts"), "export const example = 1;\n", "utf8");
  // Commit a clean baseline and reindex the Brain so recall/impact are live.
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "seed baseline");
  const reindex = spawnSync(process.execPath, [CLI_PATH, "reindex", "--json"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (reindex.status !== 0) {
    throw new Error(`reindex failed: ${reindex.stderr ?? reindex.stdout}`);
  }
  return repo;
}

let repo: string;

beforeAll(async () => {
  repo = await seedRepo();
});

afterAll(async () => {
  // cleanup handled by OS temp dir; nothing to do.
});

describe("plan-taskos stdio MCP server (real subprocess)", () => {
  it("responds to initialize, tools/list, and read tool calls", async () => {
    const client = new StdioMcpClient(repo);
    try {
      const init = await client.request("initialize", {});
      expect(init.result).toBeTruthy();
      expect((init.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSION);
      expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe("plan-taskos");

      const ping = await client.request("ping");
      expect(ping.result).toEqual({});

      const tools = await client.request("tools/list");
      const toolNames = (tools.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(toolNames).toContain("plan_list");
      expect(toolNames).toContain("plan_recall");
      expect(toolNames).toContain("plan_impact");
      expect(toolNames).toContain("plan_complete");

      const planList = await client.request("tools/call", { name: "plan_list", arguments: {} });
      expect(planList.error).toBeUndefined();
      const listContent = JSON.parse(
        (planList.result as { content: Array<{ text: string }> }).content[0].text
      ) as Array<{ plan_id: string }>;
      expect(listContent.some((p) => p.plan_id === "mcp-plan")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("plan_recall returns a recall result for a seeded query", async () => {
    const client = new StdioMcpClient(repo);
    try {
      const response = await client.request("tools/call", {
        name: "plan_recall",
        arguments: { query: "MCP test task" },
      });
      expect(response.error).toBeUndefined();
      const payload = JSON.parse(
        (response.result as { content: Array<{ text: string }> }).content[0].text
      ) as { mode?: string; results?: unknown[] };
      expect(payload).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it("plan_impact computes a blast radius for an owned file", async () => {
    const client = new StdioMcpClient(repo);
    try {
      const response = await client.request("tools/call", {
        name: "plan_impact",
        arguments: { target: "src/example.ts" },
      });
      expect(response.error).toBeUndefined();
      const payload = JSON.parse(
        (response.result as { content: Array<{ text: string }> }).content[0].text
      ) as Record<string, unknown>;
      expect(payload).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it("rejects plan_complete when --allow-write is absent (read-only guard)", async () => {
    const client = new StdioMcpClient(repo);
    try {
      const response = await client.request("tools/call", {
        name: "plan_complete",
        arguments: { task_id: "T01", session_id: "e2e" },
      });
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain("--allow-write");
    } finally {
      await client.close();
    }
  });

  it("allows plan_complete when started with --allow-write", async () => {
    const client = new StdioMcpClient(repo, ["--allow-write"]);
    try {
      const response = await client.request("tools/call", {
        name: "plan_complete",
        arguments: { task_id: "T01", session_id: "e2e-writable" },
      });
      expect(response.error).toBeUndefined();
      const payload = JSON.parse(
        (response.result as { content: Array<{ text: string }> }).content[0].text
      ) as { ok?: boolean; error?: string; proofPath?: string };
      // Clean git baseline + passing verify + no deps => the proof seals.
      expect(payload.ok).toBe(true);
      expect(payload.proofPath).toBeTruthy();
    } finally {
      await client.close();
    }
  });
});
