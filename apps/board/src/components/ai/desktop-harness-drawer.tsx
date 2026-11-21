'use client';

import { useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
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
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import { useDesktopBridge, type DesktopWorktreeDiffSummary } from '@/lib/desktop-bridge';

export function DesktopHarnessDrawer() {
  const { isDesktop, bridge, snapshot, auditLog, envelopes, refreshSnapshot } = useDesktopBridge();
  const [open, setOpen] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<DesktopWorktreeDiffSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isDesktop || !bridge) {
    return null;
  }

  const sidecar = snapshot?.sidecar;
  const activeLeases = snapshot?.activeLeases ?? [];
  const mcpServers = snapshot?.mcpServers ?? [];

  const handleInspectDiff = async (runId: string) => {
    try {
      const diff = await bridge.worktree.diff(runId);
      setSelectedDiff(diff);
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
      await refreshSnapshot();
      setStatusMessage(`Released worktree lease for ${runId}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Unable to release worktree lease');
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-2 border-ink font-mono text-xs uppercase"
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
        className="w-[min(42rem,94vw)] overflow-y-auto sm:max-w-2xl"
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
              Bounded PTY &amp; Risk ({auditLog.length})
            </TabsTrigger>
            <TabsTrigger value="sidecar">
              <WorkflowIcon className="size-3.5" />
              SQLite &amp; PCW Outbox ({envelopes.length})
            </TabsTrigger>
            <TabsTrigger value="mcp">
              <SignalIcon className="size-3.5" />
              Local MCP ({mcpServers.length})
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
                title={`Diff Summary · ${selectedDiff.runId}`}
                description={`HEAD ${selectedDiff.headCommit.slice(0, 12)} · Patch SHA-256 ${selectedDiff.patchSha256}`}
                density="compact"
              >
                <div className="space-y-2">
                  <p className="font-mono text-xs">
                    Clean: {selectedDiff.clean ? 'Yes' : 'No'} · Changed files:{' '}
                    {selectedDiff.files.length}
                  </p>
                  {selectedDiff.files.length > 0 ? (
                    <Table scrollLabel="Worktree changed files" density="compact">
                      <TableHead>
                        <TableRow>
                          <TableHeader>Path</TableHeader>
                          <TableHeader>Status</TableHeader>
                          <TableHeader>+/-</TableHeader>
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </div>
              </Panel>
            ) : null}
          </TabsContent>

          <TabsContent value="pty-risk" className="space-y-4">
            <Panel
              title="Bounded PTY & DesktopRiskGate (R0–R4) Audit Trail"
              description="Execution-time capability grant checks, environment scrubbing, and SHA-256 output digests."
              density="compact"
            >
              {auditLog.length === 0 ? (
                <p className="font-mono text-xs text-ink-soft">
                  No local PTY or risk evaluations recorded in this session yet.
                </p>
              ) : (
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
                          <Badge variant={entry.resolvedTier === 'R4' ? 'destructive' : 'default'}>
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

          <TabsContent value="mcp" className="space-y-4">
            <Panel
              title="Local Stdio & Loopback MCP Host Registry"
              description="Grant-gated local MCP servers with per-run quotas and output redaction."
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
                      <TableHeader>Server ID</TableHeader>
                      <TableHeader>Transport</TableHeader>
                      <TableHeader>Capability</TableHeader>
                      <TableHeader>Max Tier</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mcpServers.map((srv) => (
                      <TableRow key={srv.serverId}>
                        <TableCell className="font-mono text-xs">{srv.serverId}</TableCell>
                        <TableCell className="font-mono text-xs">{srv.transport}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {srv.requiredCapability}
                        </TableCell>
                        <TableCell>
                          <Badge>{srv.maxRiskTier}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
