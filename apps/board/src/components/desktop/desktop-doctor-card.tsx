'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { CheckIcon, RefreshIcon, SecurityIcon } from '@moonwitness/ui/icons';
import { client } from '@/lib/client';

type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

interface DoctorCheckResult {
  id:
    | 'sqlite_integrity'
    | 'logs_dir_writable'
    | 'dist_board_present'
    | 'api_port_health'
    | 'easytier_binary';
  status: DoctorCheckStatus;
  message: string;
  detail?: string;
}

interface DesktopDoctorReport {
  healthy: boolean;
  generatedAt: string;
  platform: string;
  checks: DoctorCheckResult[];
  supportReportMarkdown: string;
}

interface DesktopDoctorRepairResult {
  repaired: boolean;
  actionsTaken: string[];
  prunedTempFiles: number;
  report: DesktopDoctorReport;
}

const CHECK_LABELS: Record<DoctorCheckResult['id'], string> = {
  sqlite_integrity: 'SQLite Integrity',
  logs_dir_writable: 'Logs Directory',
  dist_board_present: 'Dist-Board Assets',
  api_port_health: 'Local API Port',
  easytier_binary: 'EasyTier Sidecar',
};

function badgeVariantForStatus(
  status: DoctorCheckStatus
): 'cyan' | 'primary' | 'destructive' {
  if (status === 'ok') return 'cyan';
  if (status === 'warn') return 'primary';
  return 'destructive';
}

export function DesktopDoctorCard() {
  const queryClient = useQueryClient();

  const doctorQuery = useQuery({
    queryKey: ['desktop', 'doctor'],
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: DesktopDoctorReport;
      }>('/api/desktop/doctor');
      return response.data;
    },
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: DesktopDoctorRepairResult;
      }>('/api/desktop/doctor/repair', {
        method: 'POST',
        body: {},
      });
      return response.data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['desktop', 'doctor'], result.report);
      toast.success(
        `Auto-repair complete (${result.actionsTaken.length} action(s), ${result.prunedTempFiles} temp file(s) pruned).`
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Desktop auto-repair failed.');
    },
  });

  const handleCopySupportReport = async () => {
    const markdown = doctorQuery.data?.supportReportMarkdown;
    if (!markdown) {
      toast.error('No diagnostic report available to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success('Redacted support report copied to clipboard.');
    } catch {
      toast.error('Could not copy support report to clipboard.');
    }
  };

  const report = doctorQuery.data;

  return (
    <Panel className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SecurityIcon className="size-5 text-primary" />
            <h2 className="font-display text-xl uppercase tracking-wide">
              Desktop Self-Repair Doctor
            </h2>
            {report ? (
              <Badge variant={report.healthy ? 'cyan' : 'destructive'}>
                {report.healthy ? 'All Checks Healthy' : 'Attention Needed'}
              </Badge>
            ) : (
              <Badge variant="default">Checking...</Badge>
            )}
          </div>
          <p className="text-sm text-ink-soft">
            5-point local runtime diagnostics with 1-click self-repair and redacted support export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={doctorQuery.isFetching}
            onClick={() => void doctorQuery.refetch()}
          >
            <RefreshIcon className="mr-2 size-4" />
            {doctorQuery.isFetching ? 'Checking...' : 'Re-Check'}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={repairMutation.isPending}
            onClick={() => repairMutation.mutate()}
          >
            <CheckIcon className="mr-2 size-4" />
            {repairMutation.isPending ? 'Repairing...' : 'Run Auto-Repair'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!report?.supportReportMarkdown}
            onClick={() => void handleCopySupportReport()}
          >
            Copy Redacted Support Report
          </Button>
        </div>
      </div>

      {doctorQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : doctorQuery.isError ? (
        <p className="font-mono text-xs text-destructive">
          Failed to load desktop diagnostics. Ensure the local desktop API sidecar is running.
        </p>
      ) : (
        <div className="space-y-2">
          {(report?.checks ?? []).map((check) => (
            <div
              key={check.id}
              className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/25 bg-paper px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                    {CHECK_LABELS[check.id] ?? check.id}
                  </span>
                  <Badge variant={badgeVariantForStatus(check.status)}>
                    {check.status.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-xs text-ink-soft">{check.message}</p>
                {check.detail && (
                  <p className="truncate font-mono text-[11px] text-ink-faint">{check.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-ink/20 pt-3 font-mono text-[11px] text-ink-faint">
          <span>Platform: {report.platform}</span>
          <span>Checked: {new Date(report.generatedAt).toLocaleTimeString()}</span>
        </div>
      )}
    </Panel>
  );
}
