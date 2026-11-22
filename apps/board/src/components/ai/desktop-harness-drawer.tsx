'use client';

import { type KeyboardEvent, useMemo, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Panel } from '@moonwitness/ui/components/panel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@moonwitness/ui/components/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import {
  CodeIcon,
  DocumentIcon,
  PauseIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
  WarningIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import {
  useDesktopBridge,
  type DesktopPcwArtifactDigest,
  type DesktopWorktreeDiffSummary,
} from '@/lib/desktop-bridge';

interface ParsedDiffHunk {
  readonly id: string;
  readonly header: string;
  readonly lines: readonly string[];
  readonly hasConflict: boolean;
}

function parsePatchHunks(patch: string): readonly ParsedDiffHunk[] {
  if (!patch.trim()) return [];
  const rawLines = patch.split(/\r?\n/u);
  const hunks: ParsedDiffHunk[] = [];
  let currentHeader = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentHeader && currentLines.length === 0) return;
    const hasConflict = currentLines.some(
      (line) =>
        line.startsWith('+<<<<<<<') || line.startsWith('+=======') || line.startsWith('+>>>>>>>')
    );
    hunks.push({
      id: `hunk-${hunks.length + 1}`,
      header: currentHeader || `Hunk #${hunks.length + 1}`,
      lines: currentLines,
      hasConflict,
    });
  };

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      flush();
      currentHeader = line;
      currentLines = [];
    } else if (currentHeader || line.startsWith('diff --git')) {
      if (!currentHeader && line.startsWith('diff --git')) {
        currentHeader = line;
      } else {
        currentLines.push(line);
      }
    }
  }
  flush();
  return hunks;
}

export function DesktopHarnessDrawer() {
  const { isDesktop, bridge, snapshot, auditLog, envelopes, refreshSnapshot } = useDesktopBridge();
  const [open, setOpen] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<DesktopWorktreeDiffSummary | null>(null);
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [ptyStreamLines, setPtyStreamLines] = useState<readonly string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [filePathInput, setFilePathInput] = useState<string>('');
  const [inspectedFileContent, setInspectedFileContent] = useState<string | null>(null);
  const [inspectedFilePath, setInspectedFilePath] = useState<string | null>(null);
  const [citationStartLine, setCitationStartLine] = useState<number>(1);
  const [citationEndLine, setCitationEndLine] = useState<number>(20);

  const activeLeases = snapshot?.activeLeases ?? [];
  const mcpServers = snapshot?.mcpServers ?? [];
  const sidecar = snapshot?.sidecar;
  const effectiveRunId = selectedRunId || activeLeases[0]?.runId || '';

  const parsedHunks = useMemo(
    () => (selectedDiff ? parsePatchHunks(selectedDiff.patch) : []),
    [selectedDiff]
  );

  const hasDiffConflict = useMemo(() => {
    if (!selectedDiff) return false;
    return (
      selectedDiff.files.some((file) => file.status.toUpperCase().includes('U')) ||
      parsedHunks.some((hunk) => hunk.hasConflict)
    );
  }, [parsedHunks, selectedDiff]);

  const artifactDigests = useMemo<readonly DesktopPcwArtifactDigest[]>(() => {
    const items: DesktopPcwArtifactDigest[] = [];
    for (const envelope of envelopes) {
      for (const artifact of envelope.artifacts) {
        items.push(artifact);
      }
    }
    return items;
  }, [envelopes]);

  const matchingArtifact = useMemo(() => {
    if (!inspectedFilePath) return null;
    return (
      artifactDigests.find(
        (artifact) =>
          artifact.relativePath === inspectedFilePath ||
          artifact.storageKey.endsWith(inspectedFilePath)
      ) ?? null
    );
  }, [artifactDigests, inspectedFilePath]);

  const mcpAuditEntries = useMemo(
    () => auditLog.filter((entry) => entry.action.toLowerCase().includes('mcp')),
    [auditLog]
  );

  const ptyAuditSummary = useMemo(() => {
    let allowed = 0;
    let denied = 0;
    let elevated = 0;
    for (const entry of auditLog) {
      if (entry.allowed) allowed += 1;
      else denied += 1;
      if (entry.resolvedTier === 'R3' || entry.resolvedTier === 'R4') elevated += 1;
    }
    return { allowed, denied, elevated };
  }, [auditLog]);

  if (!isDesktop || !bridge) {
    return null;
  }

  const handleInspectDiff = async (runId: string) => {
    try {
      const diff = await bridge.worktree.diff(runId);
      setSelectedRunId(runId);
      setSelectedDiff(diff);
      setActiveHunkIndex(0);
      setStatusMessage(
        `Loaded worktree diff for ${runId} (SHA-256 ${diff.patchSha256.slice(0, 16)}…)`
      );
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to inspect worktree diff');
    }
  };

  const handleReleaseWorktree = async (runId: string) => {
    try {
      await bridge.worktree.release(runId);
      setSelectedDiff(null);
      setActiveHunkIndex(0);
      await refreshSnapshot();
      setStatusMessage(`Released worktree lease for ${runId}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to release worktree lease');
    }
  };

  const handleEmergencyStopPty = async (runId: string) => {
    if (!runId) {
      setStatusMessage('No active run selected for emergency PTY stop');
      return;
    }
    try {
      if (bridge.pty?.stop) {
        await bridge.pty.stop(runId);
      } else {
        await bridge.worktree.release(runId);
      }
      setPtyStreamLines((prev) => [
        ...prev,
        `[${new Date().toISOString()}] EMERGENCY_STOP dispatched for run ${runId}`,
      ]);
      await refreshSnapshot();
      setStatusMessage(`Emergency stop dispatched for bounded PTY run ${runId}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to stop bounded PTY run');
    }
  };

  const handleReadAllowlistedFile = async (runId: string, relativePath: string) => {
    const trimmed = relativePath.trim();
    if (!runId || !trimmed) {
      setStatusMessage('Select an active run and enter an allowlisted relative path');
      return;
    }
    if (!bridge.worktree.readFile) {
      setStatusMessage('Desktop bridge does not expose worktree.readFile in this build');
      return;
    }
    try {
      const content = await bridge.worktree.readFile(runId, trimmed);
      setInspectedFilePath(trimmed);
      setInspectedFileContent(content);
      setCitationStartLine(1);
      setCitationEndLine(Math.min(20, Math.max(1, content.split(/\r?\n/u).length)));
      setStatusMessage(`Loaded allowlisted file ${trimmed} from run ${runId}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to read allowlisted file');
    }
  };

  const handleToggleOffline = async () => {
    if (!sidecar) return;
    try {
      bridge.sidecar.setOfflineMode(!sidecar.offlineMode);
      await refreshSnapshot();
      setStatusMessage(
        !sidecar.offlineMode
          ? 'Local SQLite sidecar switched to offline mode'
          : 'Local SQLite sidecar switched to online sync mode'
      );
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to toggle sidecar mode');
    }
  };

  const handleHunkKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (parsedHunks.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      setActiveHunkIndex((idx) => Math.min(parsedHunks.length - 1, idx + 1));
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      setActiveHunkIndex((idx) => Math.max(0, idx - 1));
    }
  };

  const activeLease =
    activeLeases.find((lease) => lease.runId === effectiveRunId) ?? activeLeases[0];
  const inspectedLines = inspectedFileContent ? inspectedFileContent.split(/\r?\n/u) : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-2 border-ink font-mono text-xs uppercase motion-reduce:transition-none"
          aria-label="Open Desktop Agent Harness Drawer"
        >
          <CodeIcon className="size-3.5" />
          <span>Desktop Harness</span>
          <Badge variant="primary" data-badge="ephemeral">
            {sidecar?.status ?? 'ready'}
          </Badge>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(48rem,96vw)] overflow-y-auto sm:max-w-3xl motion-reduce:transition-none"
        aria-label="Desktop Local-First Agent Harness"
      >
        <SheetHeader className="border-b-2 border-ink pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SheetTitle className="font-display text-xl uppercase">
              Desktop Local-First Agent Harness
            </SheetTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshSnapshot()}
            >
              <RefreshIcon className="size-3.5" />
              Refresh
            </Button>
          </div>
          <SheetDescription className="font-mono text-xs">
            Protocol v{snapshot?.protocolVersion ?? '1.0'} · Surface{' '}
            {snapshot?.hostSurface ?? 'apps/board'} · Sidecar{' '}
            {sidecar?.sqlitePath ?? '~/.moonwitness/local.db'}
          </SheetDescription>
        </SheetHeader>

        {statusMessage ? (
          <div
            role="status"
            className="border-2 border-ink bg-paper-raised px-3 py-2 font-mono text-xs text-ink"
          >
            {statusMessage}
          </div>
        ) : null}

        <Tabs defaultValue="worktrees" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="worktrees">
              <CodeIcon className="size-3.5" />
              Worktree Diff ({activeLeases.length})
            </TabsTrigger>
            <TabsTrigger value="pty-risk">
              <SecurityIcon className="size-3.5" />
              Bounded PTY ({auditLog.length})
            </TabsTrigger>
            <TabsTrigger value="files">
              <DocumentIcon className="size-3.5" />
              File Inspector
            </TabsTrigger>
            <TabsTrigger value="mcp">
              <SignalIcon className="size-3.5" />
              Local MCP ({mcpServers.length})
            </TabsTrigger>
            <TabsTrigger value="sidecar">
              <WorkflowIcon className="size-3.5" />
              PCW Outbox ({envelopes.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="worktrees" className="space-y-4">
            <Panel
              title="Isolated Git Worktree Leases"
              description="Per-run worktrees (.mw-worktrees/run-<id>) with path allowlists and symlink protection."
              density="compact"
            >
              {activeLeases.length === 0 ? (
                <p className="font-mono text-xs text-ink-soft">
                  No active worktree leases currently claimed by local runs.
                </p>
              ) : (
                <Table scrollLabel="Active desktop worktree leases" density="compact">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Run ID</TableHeader>
                      <TableHeader>Branch</TableHeader>
                      <TableHeader>Fencing</TableHeader>
                      <TableHeader>Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeLeases.map((lease) => (
                      <TableRow key={lease.leaseId}>
                        <TableCell className="font-mono text-xs">{lease.runId}</TableCell>
                        <TableCell className="font-mono text-xs">{lease.branchName}</TableCell>
                        <TableCell className="font-mono text-xs">#{lease.fencingToken}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleInspectDiff(lease.runId)}
                            >
                              Inspect Diff
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleReleaseWorktree(lease.runId)}
                            >
                              Release
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>

            {selectedDiff ? (
              <Panel
                title={`Diff Inspector · ${selectedDiff.runId}`}
                description={`HEAD ${selectedDiff.headCommit.slice(0, 12)} · Patch SHA-256 ${selectedDiff.patchSha256}`}
                density="compact"
                actions={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={hasDiffConflict ? 'destructive' : 'primary'}>
                      {hasDiffConflict ? 'CONFLICT' : 'NO CONFLICTS'}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activeHunkIndex <= 0}
                      onClick={() => setActiveHunkIndex((idx) => Math.max(0, idx - 1))}
                    >
                      Prev Hunk
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activeHunkIndex >= parsedHunks.length - 1}
                      onClick={() =>
                        setActiveHunkIndex((idx) => Math.min(parsedHunks.length - 1, idx + 1))
                      }
                    >
                      Next Hunk
                    </Button>
                  </div>
                }
              >
                <div className="space-y-3">
                  <p className="font-mono text-xs">
                    Clean: {selectedDiff.clean ? 'Yes' : 'No'} · Changed files:{' '}
                    {selectedDiff.files.length} · Hunks: {parsedHunks.length} (Use ArrowUp/ArrowDown
                    or j/k)
                  </p>
                  {selectedDiff.files.length > 0 ? (
                    <Table scrollLabel="Worktree changed files" density="compact">
                      <TableHead>
                        <TableRow>
                          <TableHeader>Path</TableHeader>
                          <TableHeader>Status</TableHeader>
                          <TableHeader>+/-</TableHeader>
                          <TableHeader>Inspect</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedDiff.files.map((file) => (
                          <TableRow key={file.path}>
                            <TableCell className="font-mono text-xs">{file.path}</TableCell>
                            <TableCell className="font-mono text-xs">{file.status}</TableCell>
                            <TableCell className="font-mono text-xs">
                              +{file.additions} / -{file.deletions}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setFilePathInput(file.path);
                                  void handleReadAllowlistedFile(selectedDiff.runId, file.path);
                                }}
                              >
                                Read
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}

                  {parsedHunks.length > 0 ? (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Structured diff hunks"
                      onKeyDown={handleHunkKeyDown}
                      className="space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      {parsedHunks.map((hunk, index) => (
                        <div
                          key={hunk.id}
                          className={`border-2 p-2 font-mono text-xs motion-reduce:transition-none ${
                            index === activeHunkIndex
                              ? 'border-ink bg-paper-raised'
                              : 'border-ink/30 bg-paper'
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-bold">{hunk.header}</span>
                            {hunk.hasConflict ? (
                              <Badge variant="destructive">
                                <WarningIcon className="size-3" />
                                Conflict Marker
                              </Badge>
                            ) : null}
                          </div>
                          <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                            {hunk.lines.join('\n')}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}
          </TabsContent>

          <TabsContent value="pty-risk" className="space-y-4">
            <Panel
              title="Bounded PTY Console & Emergency Kill"
              description="Execution-time capability grant checks, environment scrubbing, and deterministic process-tree termination."
              density="compact"
              actions={
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!effectiveRunId}
                  onClick={() => void handleEmergencyStopPty(effectiveRunId)}
                >
                  <PauseIcon className="size-3.5" />
                  Stop
                </Button>
              }
            >
              <div className="space-y-3">
                <dl className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div>
                    <dt className="text-ink-faint">Allowed</dt>
                    <dd className="text-base font-bold">{ptyAuditSummary.allowed}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Denied</dt>
                    <dd className="text-base font-bold">{ptyAuditSummary.denied}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">R3/R4 Escalations</dt>
                    <dd className="text-base font-bold">{ptyAuditSummary.elevated}</dd>
                  </div>
                </dl>

                <div
                  role="log"
                  aria-label="Bounded PTY output stream"
                  className="max-h-40 overflow-y-auto border-2 border-ink bg-paper-raised p-2 font-mono text-[11px]"
                >
                  {ptyStreamLines.length === 0 && auditLog.length === 0 ? (
                    <p className="text-ink-soft">
                      Bounded PTY stream idle. Output and emergency stop events appear here.
                    </p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-all">
                      {[
                        ...auditLog
                          .slice(0, 8)
                          .map(
                            (entry) =>
                              `[${entry.timestamp}] ${entry.runId} ${entry.action} (${entry.resolvedTier}) -> ${entry.allowed ? 'ALLOW' : 'DENY'} [${entry.reasonCode}]`
                          ),
                        ...ptyStreamLines,
                      ].join('\n')}
                    </pre>
                  )}
                </div>

                {auditLog.length > 0 ? (
                  <Table scrollLabel="Desktop risk gate audit log" density="compact">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Run</TableHeader>
                        <TableHeader>Action</TableHeader>
                        <TableHeader>Tier</TableHeader>
                        <TableHeader>Decision</TableHeader>
                        <TableHeader>Reason</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {auditLog.map((entry) => (
                        <TableRow key={entry.auditId}>
                          <TableCell className="font-mono text-xs">{entry.runId}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                          <TableCell>
                            <Badge
                              variant={entry.resolvedTier === 'R4' ? 'destructive' : 'default'}
                            >
                              {entry.resolvedTier}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={entry.allowed ? 'primary' : 'destructive'}>
                              {entry.allowed ? 'ALLOW' : 'DENY'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{entry.reasonCode}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="files" className="space-y-4">
            <Panel
              title="Path-Allowlisted File Inspector"
              description="Inspect worktree files within the active lease allowlist and cite line ranges against PcwArtifactDigest."
              density="compact"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={filePathInput}
                    onChange={(event) => setFilePathInput(event.target.value)}
                    placeholder="Relative path within worktree allowlist (e.g. src/index.ts)"
                    aria-label="Allowlisted relative file path"
                    className="min-w-56 flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!effectiveRunId || !filePathInput.trim()}
                    onClick={() => void handleReadAllowlistedFile(effectiveRunId, filePathInput)}
                  >
                    Read File
                  </Button>
                </div>

                {activeLease && activeLease.allowedPaths.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                    <span className="text-ink-faint">Allowed prefixes:</span>
                    {activeLease.allowedPaths.map((prefix) => (
                      <Badge key={prefix} variant="default">
                        {prefix}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="font-mono text-xs text-ink-soft">
                    No active lease allowlist prefixes detected.
                  </p>
                )}

                {inspectedFilePath && inspectedFileContent !== null ? (
                  <div className="space-y-2 border-2 border-ink bg-paper-raised p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                      <span className="font-bold">
                        {inspectedFilePath}#L{citationStartLine}-L{citationEndLine}
                      </span>
                      {matchingArtifact ? (
                        <Badge variant="primary">
                          PCW {matchingArtifact.sha256.slice(0, 12)} ·{' '}
                          {matchingArtifact.dataClassification}
                        </Badge>
                      ) : (
                        <Badge variant="default">Unlinked Working Copy</Badge>
                      )}
                    </div>
                    <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed">
                      {inspectedLines
                        .slice(0, 120)
                        .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
                        .join('\n')}
                    </pre>
                  </div>
                ) : null}

                {artifactDigests.length > 0 ? (
                  <Table scrollLabel="PCW artifact digests" density="compact">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Artifact</TableHeader>
                        <TableHeader>Kind</TableHeader>
                        <TableHeader>SHA-256</TableHeader>
                        <TableHeader>Classification</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {artifactDigests.slice(0, 10).map((artifact) => (
                        <TableRow key={artifact.storageKey}>
                          <TableCell className="font-mono text-xs">
                            {artifact.relativePath ?? artifact.storageKey}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {artifact.artifactKind}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {artifact.sha256.slice(0, 16)}…
                          </TableCell>
                          <TableCell>
                            <Badge>{artifact.dataClassification}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="mcp" className="space-y-4">
            <Panel
              title="Local MCP Host Inspector"
              description="Connected server health, tool catalog with risk tiers, and redacted call audit trail."
              density="compact"
            >
              {mcpServers.length === 0 ? (
                <p className="font-mono text-xs text-ink-soft">
                  No local MCP servers registered on this desktop bridge.
                </p>
              ) : (
                <Table scrollLabel="Local MCP servers" density="compact">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Server</TableHeader>
                      <TableHeader>Health</TableHeader>
                      <TableHeader>Transport</TableHeader>
                      <TableHeader>Capability</TableHeader>
                      <TableHeader>Risk Tier</TableHeader>
                      <TableHeader>Quota</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mcpServers.map((srv) => (
                      <TableRow key={srv.serverId}>
                        <TableCell className="font-mono text-xs">{srv.serverId}</TableCell>
                        <TableCell>
                          <Badge variant={srv.enabled ? 'primary' : 'destructive'}>
                            {srv.enabled ? 'HEALTHY' : 'DISABLED'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{srv.transport}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {srv.requiredCapability}
                        </TableCell>
                        <TableCell>
                          <Badge variant={srv.maxRiskTier === 'R4' ? 'destructive' : 'default'}>
                            {srv.maxRiskTier}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {srv.maxCallsPerRun}/run
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>

            <Panel
              title="Redacted MCP Call Audit Trail"
              description="Grant-verified local MCP invocations with automatic secret scrubbing."
              density="compact"
            >
              {mcpAuditEntries.length === 0 ? (
                <p className="font-mono text-xs text-ink-soft">
                  No local MCP tool calls recorded in this session yet.
                </p>
              ) : (
                <Table scrollLabel="Redacted MCP call audit trail" density="compact">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Action</TableHeader>
                      <TableHeader>Tier</TableHeader>
                      <TableHeader>Decision</TableHeader>
                      <TableHeader>Reason</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mcpAuditEntries.map((entry) => (
                      <TableRow key={entry.auditId}>
                        <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                        <TableCell>
                          <Badge>{entry.resolvedTier}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.allowed ? 'primary' : 'destructive'}>
                            {entry.allowed ? 'ALLOW' : 'DENY'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{entry.reasonCode}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </TabsContent>

          <TabsContent value="sidecar" className="space-y-4">
            <Panel
              title="Dual-Dialect SQLite Sidecar & PCW Outbox"
              description="Offline-first ~/.moonwitness/local.db syncing SHA-256 Proof-Carrying Work envelopes to apps/api."
              density="compact"
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleToggleOffline()}
                >
                  {sidecar?.offlineMode ? 'Go Online' : 'Simulate Offline'}
                </Button>
              }
            >
              <dl className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-ink-faint">Pending</dt>
                  <dd className="text-base font-bold">{sidecar?.pendingOutboxCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Synced</dt>
                  <dd className="text-base font-bold">{sidecar?.syncedOutboxCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Failed</dt>
                  <dd className="text-base font-bold">{sidecar?.failedOutboxCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Conflicts</dt>
                  <dd className="text-base font-bold">{sidecar?.conflictOutboxCount ?? 0}</dd>
                </div>
              </dl>
            </Panel>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
