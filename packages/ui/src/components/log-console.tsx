import { useMemo, useState, type ComponentProps } from 'react';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Panel } from './panel.js';
import { SelectField } from './select-field.js';
import {
  CheckCircleIcon,
  CodeIcon,
  DeleteIcon,
  DocumentIcon,
  ErrorIcon,
  InfoIcon,
  RefreshIcon,
  SearchIcon,
  SparkleIcon,
  WarningIcon,
} from '../icons/index.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogLevelFilter = 'all' | LogLevel;
export type LogSource = 'rust' | 'sidecar' | 'webview' | 'mcp' | 'mesh';
export type LogSourceFilter = 'all' | LogSource;
export type LogDisplayMode = 'compact' | 'terminal';

export interface LogConsoleEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly message: string;
  readonly detail?: string;
}

export type LogConsoleProps = Omit<ComponentProps<'div'>, 'children'> & {
  readonly entries: readonly LogConsoleEntry[];
  readonly title?: string;
  readonly description?: string;
  readonly defaultLevel?: LogLevelFilter;
  readonly defaultSource?: LogSourceFilter;
  readonly defaultSearch?: string;
  readonly defaultDisplayMode?: LogDisplayMode;
  readonly loading?: boolean;
  readonly copyStatus?: 'idle' | 'copied' | 'error';
  readonly emptyMessage?: string;
  readonly onRefresh?: () => void;
  readonly onClear?: () => void;
  readonly onCopyForAi?: (visibleEntries: readonly LogConsoleEntry[]) => void;
};

const LEVEL_OPTIONS: readonly { readonly value: LogLevelFilter; readonly label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
];

const SOURCE_OPTIONS: readonly { readonly value: LogSourceFilter; readonly label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'rust', label: 'Rust' },
  { value: 'sidecar', label: 'Sidecar' },
  { value: 'webview', label: 'Webview' },
  { value: 'mcp', label: 'MCP' },
  { value: 'mesh', label: 'Mesh' },
];

function getLevelBadgeVariant(level: LogLevel): 'destructive' | 'magenta' | 'cyan' {
  if (level === 'error') return 'destructive';
  if (level === 'warn') return 'magenta';
  return 'cyan';
}

function LevelIcon({ level }: { readonly level: LogLevel }) {
  if (level === 'error') {
    return <ErrorIcon className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  if (level === 'warn') {
    return <WarningIcon className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  return <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />;
}

function formatTimeShort(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return timestamp;
  return new Date(parsed).toISOString().slice(11, 23);
}

export function LogConsole({
  entries,
  title = 'Desktop Log Console',
  description = 'Live local diagnostics across Rust, Sidecar, Webview, MCP, and Mesh.',
  defaultLevel = 'all',
  defaultSource = 'all',
  defaultSearch = '',
  defaultDisplayMode = 'compact',
  loading = false,
  copyStatus = 'idle',
  emptyMessage = 'No log entries match the active filters.',
  onRefresh,
  onClear,
  onCopyForAi,
  className,
  ...props
}: LogConsoleProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>(defaultLevel);
  const [sourceFilter, setSourceFilter] = useState<LogSourceFilter>(defaultSource);
  const [searchQuery, setSearchQuery] = useState<string>(defaultSearch);
  const [displayMode, setDisplayMode] = useState<LogDisplayMode>(defaultDisplayMode);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      if (normalizedQuery.length > 0) {
        const haystack =
          `${entry.message} ${entry.detail ?? ''} ${entry.source} ${entry.level}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [entries, levelFilter, sourceFilter, searchQuery]);

  const errorCount = useMemo(
    () => entries.filter((entry) => entry.level === 'error').length,
    [entries]
  );
  const warnCount = useMemo(
    () => entries.filter((entry) => entry.level === 'warn').length,
    [entries]
  );

  const rootClasses = ['mw-ui-log-console flex flex-col gap-3', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div data-slot="log-console" data-display-mode={displayMode} className={rootClasses} {...props}>
      <Panel
        title={title}
        description={description}
        density="compact"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={errorCount > 0 ? 'destructive' : 'default'}>{errorCount} err</Badge>
            <Badge variant={warnCount > 0 ? 'magenta' : 'default'}>{warnCount} warn</Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setDisplayMode((prev) => (prev === 'compact' ? 'terminal' : 'compact'))
              }
              aria-label={`Switch to ${displayMode === 'compact' ? 'terminal' : 'compact'} view`}
            >
              <CodeIcon className="size-3.5" aria-hidden="true" />
              <span>{displayMode === 'compact' ? 'Terminal' : 'Compact'}</span>
            </Button>
            {onRefresh ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={loading}
                aria-label="Refresh logs"
              >
                <RefreshIcon className="size-3.5" aria-hidden="true" />
                <span>Refresh</span>
              </Button>
            ) : null}
            {onClear ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClear}
                aria-label="Clear logs"
              >
                <DeleteIcon className="size-3.5" aria-hidden="true" />
                <span>Clear</span>
              </Button>
            ) : null}
            {onCopyForAi ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => onCopyForAi(filteredEntries)}
                data-action="copy-for-ai"
              >
                {copyStatus === 'copied' ? (
                  <CheckCircleIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <SparkleIcon className="size-3.5" aria-hidden="true" />
                )}
                <span>
                  {copyStatus === 'copied'
                    ? 'Copied for AI'
                    : copyStatus === 'error'
                      ? 'Copy failed'
                      : 'Copy for AI'}
                </span>
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
            <div className="relative sm:col-span-6">
              <SearchIcon
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filter logs by message, detail, or source..."
                aria-label="Search logs"
                className="pl-8"
              />
            </div>
            <div className="sm:col-span-3">
              <SelectField
                aria-label="Filter by log level"
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value as LogLevelFilter)}
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="sm:col-span-3">
              <SelectField
                aria-label="Filter by log source"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value as LogSourceFilter)}
              >
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <div
            data-slot="log-console-summary"
            role="status"
            aria-live="polite"
            className="mw-ui-visually-hidden"
          >
            {filteredEntries.length} log entries
          </div>
          <div
            data-slot="log-console-entries"
            role="log"
            aria-live="off"
            className={
              displayMode === 'terminal'
                ? 'max-h-[26rem] overflow-y-auto border-2 border-ink bg-night p-3 font-mono text-xs text-paper'
                : 'max-h-[26rem] divide-y divide-ink/15 overflow-y-auto border-2 border-ink bg-paper text-ink'
            }
          >
            {filteredEntries.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-xs opacity-75">
                <DocumentIcon className="size-4 shrink-0" aria-hidden="true" />
                <span>{emptyMessage}</span>
              </div>
            ) : (
              filteredEntries.map((entry) =>
                displayMode === 'terminal' ? (
                  <div
                    key={entry.id}
                    data-log-entry-id={entry.id}
                    data-log-level={entry.level}
                    data-log-source={entry.source}
                    className="whitespace-pre-wrap break-words py-0.5 leading-relaxed"
                  >
                    <span className="opacity-60">[{formatTimeShort(entry.timestamp)}]</span>{' '}
                    <span className="uppercase font-bold">[{entry.level}]</span>{' '}
                    <span className="opacity-80">[{entry.source}]</span>{' '}
                    <span>{entry.message}</span>
                    {entry.detail ? (
                      <div className="pl-4 text-[11px] opacity-75">{entry.detail}</div>
                    ) : null}
                  </div>
                ) : (
                  <div
                    key={entry.id}
                    data-log-entry-id={entry.id}
                    data-log-level={entry.level}
                    data-log-source={entry.source}
                    className="flex flex-col gap-1 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getLevelBadgeVariant(entry.level)}>
                        <LevelIcon level={entry.level} />
                        <span className="ml-1 uppercase">{entry.level}</span>
                      </Badge>
                      <Badge variant="default">{entry.source}</Badge>
                      <span className="font-mono text-[11px] text-ink-faint">
                        {formatTimeShort(entry.timestamp)}
                      </span>
                    </div>
                    <p className="break-words font-medium text-ink">{entry.message}</p>
                    {entry.detail ? (
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-ink/5 p-2 font-mono text-[11px] text-ink-soft">
                        {entry.detail}
                      </pre>
                    ) : null}
                  </div>
                )
              )
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
