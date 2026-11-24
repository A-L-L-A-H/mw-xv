import { useState } from 'react';
import { BrandMark } from '@moonwitness/ui/components/brand-mark';
import { Breadcrumbs } from '@moonwitness/ui/components/breadcrumbs';
import { Button } from '@moonwitness/ui/components/button';
import { ConfirmDialog } from '@moonwitness/ui/components/confirm-dialog';
import { DatePicker, type DatePickerValue } from '@moonwitness/ui/components/date-picker';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { InboxPopover } from '@moonwitness/ui/components/inbox-popover';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { LogConsole, type LogConsoleEntry } from '@moonwitness/ui/components/log-console';
import { ModePicker, type DesktopExperienceMode } from '@moonwitness/ui/components/mode-picker';
import { NumberInput } from '@moonwitness/ui/components/number-input';
import { SectionRibbon } from '@moonwitness/ui/components/section-ribbon';
import { SmartButtonBox } from '@moonwitness/ui/components/smart-button-box';
import { StatusBar } from '@moonwitness/ui/components/status-bar';
import { TagInput } from '@moonwitness/ui/components/tag-input';
import { UpdateBanner, type UpdateBannerStatus } from '@moonwitness/ui/components/update-banner';

const initialLogEntries: readonly LogConsoleEntry[] = [
  {
    id: 'log-1',
    timestamp: '2026-11-24T10:15:00.000Z',
    level: 'info',
    source: 'webview',
    message: 'Contoh desain: catalog stream connected.',
  },
  {
    id: 'log-2',
    timestamp: '2026-11-24T10:16:12.000Z',
    level: 'warn',
    source: 'sidecar',
    message: 'Contoh desain: sample retry queued.',
    detail: 'Synthetic retry backoff 250ms',
  },
  {
    id: 'log-3',
    timestamp: '2026-11-24T10:17:45.000Z',
    level: 'error',
    source: 'mcp',
    message: 'Contoh desain: sample handshake timeout.',
    detail: 'Illustrative error entry only',
  },
];

export function ExtendedControlsLab() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [desktopMode, setDesktopMode] = useState<DesktopExperienceMode>('workspace');
  const [dateValue, setDateValue] = useState<DatePickerValue | null>({
    date: '2026-11-24',
    time: '09:30',
  });
  const [quotaValue, setQuotaValue] = useState<number | null>(12);
  const [tags, setTags] = useState<string[]>(['contoh-desain', 'editorial']);
  const [updateStatus, setUpdateStatus] = useState<UpdateBannerStatus>('available');
  const [retryCount, setRetryCount] = useState(0);
  const [smartActionNote, setSmartActionNote] = useState('No sample action triggered');
  const [logEntries, setLogEntries] = useState<readonly LogConsoleEntry[]>(initialLogEntries);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  return (
    <div className="catalog-examples" data-testid="extended-controls-lab">
      <article className="catalog-example">
        <div className="catalog-example-copy">
          <h3>BrandMark &amp; Breadcrumbs</h3>
          <p>
            Contoh desain: canonical vector brand marks and router-agnostic navigation breadcrumbs.
          </p>
        </div>
        <div className="catalog-example-stage">
          <Breadcrumbs
            aria-label="Contoh desain breadcrumb trail"
            items={[
              { label: 'Contoh desain', href: '#extended-controls' },
              { label: 'Library', href: '#foundations' },
              { label: 'Extended controls', current: true },
            ]}
          />
          <div className="catalog-inline">
            <BrandMark variant="symbol" tone="dark" basePath={import.meta.env.BASE_URL} />
            <BrandMark variant="lockup" tone="dark" basePath={import.meta.env.BASE_URL} />
          </div>
          <SectionRibbon title="Contoh desain · Small ribbon" size="sm" number="01" accent="cyan" />
          <SectionRibbon
            title="Contoh desain · Large ribbon"
            size="lg"
            number="02"
            accent="magenta"
          />
        </div>
      </article>

      <article className="catalog-example">
        <div className="catalog-example-copy">
          <h3>DatePicker, NumberInput, TagInput &amp; Label</h3>
          <p>
            Contoh desain: structured form primitives with accessible labels, constraints, and tag
            management.
          </p>
        </div>
        <div className="catalog-example-stage">
          <div className="catalog-form-grid">
            <DatePicker
              label="Contoh desain · Publish window"
              includeTime
              value={dateValue}
              onValueChange={setDateValue}
              description="Sample date and time selection."
            />
            <NumberInput
              label="Contoh desain · Batch quota"
              value={quotaValue}
              onValueChange={setQuotaValue}
              min={1}
              max={100}
              integer
              description="Sample integer input between 1 and 100."
            />
            <TagInput
              label="Contoh desain · Story tags"
              value={tags}
              onValueChange={setTags}
              maxTags={5}
              placeholder="Add sample tag"
              description="Press Enter or comma to add a sample tag."
            />
            <div className="catalog-field">
              <Label htmlFor="extended-label-input">Contoh desain · Standalone label</Label>
              <Input id="extended-label-input" defaultValue="Sample labeled field" />
            </div>
          </div>
        </div>
      </article>

      <article className="catalog-example">
        <div className="catalog-example-copy">
          <h3>ConfirmDialog, InboxPopover, ModePicker &amp; SmartButtonBox</h3>
          <p>
            Contoh desain: interactive confirmation modals, header notification popovers, workspace
            mode picker, and split smart actions.
          </p>
        </div>
        <div className="catalog-example-stage">
          <div className="catalog-inline">
            <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              Open confirm dialog
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModePickerOpen(true)}>
              Open mode picker ({desktopMode})
            </Button>
            <InboxPopover
              title="Contoh desain · Inbox"
              subtitle="Sample workspace notifications"
              triggerLabel="Open sample inbox"
              unreadCount={2}
              isEmpty={false}
            >
              <p>Contoh desain: 2 synthetic review items pending.</p>
            </InboxPopover>
          </div>
          <SmartButtonBox
            aria-label="Contoh desain smart actions"
            primaryActions={[
              {
                id: 'run',
                label: 'Run sample check',
                count: 2,
                primary: true,
                onClick: () => setSmartActionNote('Triggered: Run sample check'),
              },
              {
                id: 'export',
                label: 'Export sample',
                onClick: () => setSmartActionNote('Triggered: Export sample'),
              },
            ]}
            secondaryActions={[
              {
                id: 'archive',
                label: 'Archive sample',
                onClick: () => setSmartActionNote('Triggered: Archive sample'),
              },
            ]}
          />
          <small role="status">{smartActionNote}</small>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Contoh desain · Confirm archive"
            description="Sample destructive confirmation dialog."
            warningBanner="Contoh desain: illustrative warning banner."
            consequence="Sample draft stays intact in catalog mode."
            confirmLabel="Confirm sample"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => setConfirmOpen(false)}
          />
          {modePickerOpen ? (
            <ModePicker
              currentMode={desktopMode}
              onSelect={(mode) => {
                setDesktopMode(mode);
                setModePickerOpen(false);
              }}
              onDismiss={() => setModePickerOpen(false)}
            />
          ) : null}
        </div>
      </article>

      <article className="catalog-example">
        <div className="catalog-example-copy">
          <h3>StatusBar, UpdateBanner &amp; ErrorState</h3>
          <p>
            Contoh desain: workflow progression steps, desktop update notices, and illustrated error
            recovery surfaces.
          </p>
        </div>
        <div className="catalog-example-stage">
          <StatusBar
            steps={[
              { id: 'draft', label: 'Draft', state: 'done', count: 3 },
              { id: 'review', label: 'In review', state: 'active', count: 1 },
              { id: 'published', label: 'Published', state: 'disabled', count: 0 },
            ]}
          />
          <UpdateBanner
            currentVersion="1.0.0-rc.1"
            availableVersion="1.0.0"
            status={updateStatus}
            onCheck={() => setUpdateStatus('available')}
            onInstall={() => setUpdateStatus('ready')}
            onDismiss={() => setUpdateStatus('idle')}
          />
          <ErrorState
            code="SAMPLE-503"
            title="Contoh desain · Sample error recovery"
            description="Illustrative error state with retry action and canonical artwork."
            headingLevel={3}
            basePath={import.meta.env.BASE_URL}
            onRetry={() => setRetryCount((count) => count + 1)}
            retryLabel={retryCount > 0 ? `Retry (${retryCount})` : 'Try again'}
          />
        </div>
      </article>

      <article className="catalog-example catalog-example-wide">
        <div className="catalog-example-copy">
          <h3>LogConsole</h3>
          <p>
            Contoh desain: filterable diagnostic log stream with compact/terminal toggle and sample
            copy-for-AI action.
          </p>
        </div>
        <div className="catalog-example-stage">
          <LogConsole
            title="Contoh desain · Diagnostic Log Console"
            description="Illustrative log stream across webview, sidecar, and MCP."
            entries={logEntries}
            copyStatus={copyStatus}
            onRefresh={() => setLogEntries([...initialLogEntries])}
            onClear={() => setLogEntries([])}
            onCopyForAi={() => setCopyStatus('copied')}
          />
        </div>
      </article>
    </div>
  );
}
