'use client';

import { useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { client } from '@/lib/client';
import type { AiWorkContractDto } from '@/components/ai/ai-api';
import {
  decideRunApproval,
  discoverGatewayModels,
  isFreellmProvider,
  maskedReference,
  selectGatewayModel,
  shortFingerprint,
  type CloudProviderDto,
  type CloudRunDto,
  type DiscoveredModelDto,
} from '../_lib/cloud-agent';

interface RunWithCloudFields extends CloudRunDto {
  readonly correlation_id?: string;
  readonly work_contract_id?: number;
}

export function CloudProviderDefaultPanel({
  providers,
  onChanged,
}: {
  readonly providers: readonly CloudProviderDto[];
  readonly onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [models, setModels] = useState<readonly DiscoveredModelDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gateway = providers.find(isFreellmProvider) ?? null;

  const runDiscovery = async (): Promise<void> => {
    if (!gateway || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const discovered = await discoverGatewayModels(gateway.id);
      setModels(discovered);
      setNotice(`Discovered ${discovered.length} real gateway model id(s).`);
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Gateway discovery failed.');
    } finally {
      setBusy(false);
    }
  };

  const selectModel = async (): Promise<void> => {
    const model = models.find((item) => item.id === selectedId);
    if (!gateway || !model || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const selected = await selectGatewayModel(gateway.id, model.modelId);
      setNotice(`Selected gateway model ${selected.modelId} for the coding-agent profile.`);
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Model selection failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="FreeLLMAPI Cloud Coding-Agent Default"
      description="Pinned vendored gateway, cloud egress regardless of private Compose address, and operator-only discovery of real model ids."
    >
      {gateway === null ? (
        <p className="font-mono text-xs text-ink-soft">
          No <code>freellmapi_default</code> provider row is available for this company.
        </p>
      ) : (
        <div className="space-y-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{gateway.name}</span>
            <Badge variant={gateway.enabled ? 'primary' : 'default'}>
              {gateway.enabled ? 'enabled' : 'default-off gate'}
            </Badge>
            <Badge>{gateway.data_classification}</Badge>
            <span className="text-ink-faint">origin-only endpoint: {gateway.endpoint_url ?? 'configured'}</span>
          </div>
          <p aria-label="masked inference key reference">
            Unified inference key reference: {maskedReference(gateway.secret_ref)} — value never leaves the
            gateway volume or Board DOM.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runDiscovery()}>
              Discover real gateway models
            </Button>
            <label className="sr-only" htmlFor="freellm-model-select">
              Discovered gateway model
            </label>
            <SelectField
              id="freellm-model-select"
              value={selectedId === null ? '' : String(selectedId)}
              onChange={(event) => setSelectedId(Number(event.target.value) || null)}
            >
              <option value="">Choose a discovered model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.modelId}
                </option>
              ))}
            </SelectField>
            <Button type="button" size="sm" disabled={busy || selectedId === null} onClick={() => void selectModel()}>
              Set as coding-agent default
            </Button>
          </div>
          {notice !== null ? <p role="status">{notice}</p> : null}
        </div>
      )}
    </Panel>
  );
}

export function RunScopePanel({ contract }: { readonly contract: AiWorkContractDto | null }) {
  let scopePaths: string[] = [];
  if (contract?.scope_json) {
    try {
      const parsed = JSON.parse(contract.scope_json) as { allowedPaths?: unknown; paths?: unknown };
      const candidate = parsed.allowedPaths ?? parsed.paths;
      if (Array.isArray(candidate)) {
        scopePaths = candidate.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      scopePaths = [];
    }
  }
  return (
    <Panel
      title="Cloud Run Scope Boundary"
      description="Classification, risk tier and curated paths are validated before any run is dispatched."
    >
      {contract === null ? (
        <p className="font-mono text-xs text-ink-soft">Select a work contract to inspect its scope.</p>
      ) : (
        <div className="space-y-2 font-mono text-xs">
          <p>
            Contract <span className="font-bold">{contract.code}</span> · classification{' '}
            <Badge>{contract.data_classification}</Badge> · risk <Badge>{contract.risk_tier}</Badge>
          </p>
          <p>
            {contract.data_classification === 'cloud_eligible'
              ? 'Eligible for the vetted cloud coding-agent profile with human approval for R3.'
              : 'Local-only/restricted: FreeLLMAPI and the coding sandbox are unreachable by policy.'}
          </p>
          <ul className="list-disc pl-5">
            {scopePaths.length === 0 ? (
              <li className="text-ink-faint">No curated allowedPaths recorded on this contract.</li>
            ) : (
              scopePaths.map((path) => <li key={path}>{path}</li>)
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function RunApprovalPanel({
  runs,
  onChanged,
}: {
  readonly runs: readonly RunWithCloudFields[];
  readonly onChanged: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const pending = runs.filter(
    (run) => run.approval_workflow_id !== null && run.approval_workflow_id !== undefined && run.status === 'pending'
  );

  const decide = async (run: RunWithCloudFields, action: 'approve' | 'reject'): Promise<void> => {
    if (run.approval_workflow_id === null || run.approval_workflow_id === undefined) return;
    setBusyId(run.id);
    setNotice(null);
    try {
      await decideRunApproval(run.approval_workflow_id, action, run.execution_fingerprint);
      setNotice(`${action === 'approve' ? 'Approved' : 'Rejected'} run ${run.id}.`);
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Approval decision failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel
      title="Pending Cloud Run Approvals"
      description="A different active human reviewer must approve the exact immutable fingerprint before dispatch."
    >
      {pending.length === 0 ? (
        <p className="font-mono text-xs text-ink-soft">No cloud egress runs are awaiting approval.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((run) => (
            <li key={run.id} className="space-y-2 border border-ink/20 p-3 font-mono text-xs">
              <p>
                Run #{run.id} · fingerprint {shortFingerprint(run.execution_fingerprint)} · workflow{' '}
                {run.approval_workflow_id}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === run.id}
                  onClick={() => void decide(run, 'approve')}
                >
                  Approve &amp; dispatch
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === run.id}
                  onClick={() => void decide(run, 'reject')}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice !== null ? <p role="status" className="mt-2 font-mono text-xs">{notice}</p> : null}
    </Panel>
  );
}

export function RunEvidencePanel({
  runs,
  onChanged,
}: {
  readonly runs: readonly RunWithCloudFields[];
  readonly onChanged: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const cloudRuns = runs.filter(
    (run) => run.execution_fingerprint !== null && run.execution_fingerprint !== undefined
  );

  const cancel = async (run: RunWithCloudFields): Promise<void> => {
    setNotice(null);
    try {
      await client.request(`/api/ai/runs/${run.id}/cancel`, { method: 'POST', body: {} });
      setNotice(`Cancellation requested for run ${run.id}.`);
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Cancellation failed.');
    }
  };

  return (
    <Panel
      title="Coding-Run Evidence & Control"
      description="Immutable fingerprint, job lease, terminal error and operator cancellation. Diffs and PCW evidence remain redacted artifacts."
    >
      {cloudRuns.length === 0 ? (
        <p className="font-mono text-xs text-ink-soft">No executed cloud coding runs for this company.</p>
      ) : (
        <ul className="space-y-2 font-mono text-xs">
          {cloudRuns.slice(0, 20).map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-2 border border-ink/20 p-2">
              <span className="font-bold">#{run.id}</span>
              <Badge>{run.status}</Badge>
              <span>fingerprint {shortFingerprint(run.execution_fingerprint)}</span>
              <span>job {run.job_id ?? 'not dispatched'}</span>
              <span>fence {run.fencing_token ?? 0}</span>
              {run.error_code !== null && run.error_code !== undefined ? (
                <span className="text-red-700">{run.error_code}</span>
              ) : null}
              {run.status === 'pending' || run.status === 'running' ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void cancel(run)}>
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {notice !== null ? <p role="status" className="mt-2 font-mono text-xs">{notice}</p> : null}
    </Panel>
  );
}
