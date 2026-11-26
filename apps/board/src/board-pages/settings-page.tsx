'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CodeIcon,
  ColumnsIcon,
  MoonIcon,
  RefreshIcon,
  SecurityIcon,
  SettingsIcon,
  SignalIcon,
  SunIcon,
} from '@moonwitness/ui/icons';
import { toast } from '@moonwitness/ui/components/toast';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { NotificationPreferences } from '@/components/settings/notification-preferences';
import { DesktopDoctorCard } from '@/components/desktop/desktop-doctor-card';
import { LocalRagSearchPanel } from '@/components/ai/local-rag-search-panel';
import { useDesktopBridge } from '@/lib/desktop-bridge';
import { useDesktopMode } from '@/lib/desktop-mode';
import { Badge } from '@moonwitness/ui/components/badge';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Button } from '@moonwitness/ui/components/button';
import { Label } from '@moonwitness/ui/components/label';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@moonwitness/ui/components/select';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { Switch } from '@moonwitness/ui/components/switch';
import { useAuth } from '@/hooks/use-auth-context';
import { useSkin } from '@/components/providers/skin-context';
import { client } from '@/lib/client';
import {
  getQueryScope,
  isCurrentScopeQueryKey,
  settingsQueryKeys,
  type BoardQueryScope,
} from '@/lib/query-scope';
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  savePreferences,
  type BoardPreferences,
} from '@/lib/preferences';

interface LanguageOption {
  id: number;
  code: string;
  name: string;
}

type ConfigValueType = 'string' | 'integer' | 'boolean' | 'json';

interface ConfigParameterRecord {
  id: number;
  key: string;
  value_type: ConfigValueType;
  value: string | null;
  is_secret: boolean;
  company_id?: number | null;
  description?: string | null;
  write_date?: string;
}

interface FeatureFlagRecord {
  id: number;
  key: string;
  name: string;
  enabled: boolean;
  rollout_pct: number;
  company_id?: number | null;
  expires_at?: string | null;
  description?: string | null;
  write_date?: string;
}

const KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/;

function validateTypedConfigValue(value: string, valueType: ConfigValueType): string | null {
  if (valueType === 'integer') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
      return 'Value must be a valid integer.';
    }
  } else if (valueType === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      return 'Boolean value must be "true" or "false".';
    }
  } else if (valueType === 'json') {
    try {
      JSON.parse(value);
    } catch {
      return 'Value must be valid JSON.';
    }
  }
  return null;
}

interface LocalAiModelEntry {
  id: string;
  providerId: string;
  providerName: string;
  providerKind: 'ollama' | 'lmstudio' | 'vllm';
  endpoint: string;
}

interface LocalAiDiscoveryPayload {
  onlineCount: number;
  models: LocalAiModelEntry[];
  recommendedWorkspaceModel: string | null;
  recommendedDevModel: string | null;
}

interface LocalBackupEntry {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  verified: boolean;
}

interface LocalBackupsPayload {
  sqlitePath: string;
  backupsDir: string | null;
  backups: LocalBackupEntry[];
}

const TIMEZONES = [
  'UTC',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
];

function SettingsQueryError({
  title,
  description,
  retrying,
  onRetry,
}: {
  title: string;
  description: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      role="alert"
      title={title}
      description={description}
      action={
        <Button variant="outline" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      }
    />
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const activeScope = getQueryScope();
  const scopeKey = `${activeScope.userId ?? ''}:${activeScope.companyId ?? ''}`;
  return (
    <SettingsPageContent key={scopeKey} activeScope={activeScope} user={user} logout={logout} />
  );
}

function SettingsPageContent({
  activeScope,
  user,
  logout,
}: {
  activeScope: BoardQueryScope;
  user: ReturnType<typeof useAuth>['user'];
  logout: ReturnType<typeof useAuth>['logout'];
}) {
  const isAdmin = user?.role === 'superadmin' || user?.role === 'system';
  const { isDesktop } = useDesktopBridge();
  const { mode: desktopMode, setMode: setDesktopMode } = useDesktopMode();
  const { skin, mode, density, skins, setSkin, setMode, setDensity } = useSkin();
  const router = useRouter();
  const [storedPreferences] = useState<BoardPreferences>(readPreferences);
  const [preferenceDraft, setPreferenceDraft] = useState<Partial<BoardPreferences>>({});
  const [saved, setSaved] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [paramDrafts, setParamDrafts] = useState<Record<number, string>>({});
  const [savingParamId, setSavingParamId] = useState<number | null>(null);
  const [newParamKey, setNewParamKey] = useState('');
  const [newParamType, setNewParamType] = useState<ConfigValueType>('string');
  const [newParamValue, setNewParamValue] = useState('');
  const [newParamSecret, setNewParamSecret] = useState(false);
  const [newParamDescription, setNewParamDescription] = useState('');
  const [creatingParam, setCreatingParam] = useState(false);

  const [flagRolloutDrafts, setFlagRolloutDrafts] = useState<Record<number, string>>({});
  const [savingFlagId, setSavingFlagId] = useState<number | null>(null);
  const [newFlagKey, setNewFlagKey] = useState('');
  const [newFlagName, setNewFlagName] = useState('');
  const [newFlagEnabled, setNewFlagEnabled] = useState(false);
  const [newFlagRollout, setNewFlagRollout] = useState('100');
  const [creatingFlag, setCreatingFlag] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);

  const queryClient = useQueryClient();
  const localAiQuery = useQuery({
    queryKey: settingsQueryKeys.desktopAiModels(activeScope),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: LocalAiDiscoveryPayload;
      }>('/api/desktop/ai/models');
      return response.data;
    },
    enabled: isDesktop,
    placeholderData: keepPreviousData,
  });
  const localBackupsQuery = useQuery({
    queryKey: settingsQueryKeys.desktopBackups(activeScope),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: LocalBackupsPayload;
      }>('/api/desktop/backups');
      return response.data;
    },
    enabled: isDesktop,
    placeholderData: keepPreviousData,
  });
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const mutationKey = settingsQueryKeys.desktopBackups();
      const response = await client.request<{
        success: boolean;
        data: LocalBackupEntry;
      }>('/api/desktop/backups', {
        method: 'POST',
        body: {},
      });
      return { entry: response.data, mutationKey };
    },
    onSuccess: async ({ entry, mutationKey }) => {
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      toast.success(`Created local backup: ${entry.fileName}`);
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to create local backup.');
    },
  });
  const userPreferencesQuery = useQuery({
    queryKey: settingsQueryKeys.user(user?.id, activeScope),
    queryFn: () => client.getMe(),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
  });
  const languagesQuery = useQuery({
    queryKey: settingsQueryKeys.languages(activeScope),
    queryFn: async () => {
      const result = await client.model<LanguageOption>('base.language').searchRead({
        limit: 200,
        order: 'name asc',
      });
      return result.records;
    },
    placeholderData: keepPreviousData,
  });
  const configParamsQuery = useQuery({
    queryKey: settingsQueryKeys.configParameters(activeScope),
    queryFn: async () => {
      const result = await client.model<ConfigParameterRecord>('base.config_parameter').searchRead({
        fields: [
          'id',
          'key',
          'value_type',
          'value',
          'is_secret',
          'company_id',
          'description',
          'write_date',
        ],
        limit: 100,
        order: 'key asc',
      });
      return result.records;
    },
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  });
  const featureFlagsQuery = useQuery({
    queryKey: settingsQueryKeys.featureFlags(activeScope),
    queryFn: async () => {
      const result = await client.model<FeatureFlagRecord>('ir.feature_flag').searchRead({
        fields: [
          'id',
          'key',
          'name',
          'enabled',
          'rollout_pct',
          'company_id',
          'expires_at',
          'description',
          'write_date',
        ],
        limit: 100,
        order: 'key asc',
      });
      return result.records;
    },
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  });

  const {
    data: userPreferences,
    isLoading: userLoading,
    isSuccess: userPreferencesLoaded,
  } = userPreferencesQuery;
  const { data: languages = [], isLoading: languagesLoading } = languagesQuery;
  const { data: configParameters = [], isLoading: configParamsLoading } = configParamsQuery;
  const { data: featureFlags = [], isLoading: featureFlagsLoading } = featureFlagsQuery;
  const regionalReadSucceeded = userPreferencesLoaded && languagesQuery.isSuccess;
  const configReadSucceeded = isAdmin && configParamsQuery.isSuccess;
  const featureFlagsReadSucceeded = isAdmin && featureFlagsQuery.isSuccess;

  const saveConfigParam = async (param: ConfigParameterRecord) => {
    if (!configReadSucceeded) return;
    const mutationKey = settingsQueryKeys.configParameters();
    const nextValue = paramDrafts[param.id] ?? param.value ?? '';
    const validationError = validateTypedConfigValue(nextValue, param.value_type);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      setSavingParamId(param.id);
      await client
        .model<ConfigParameterRecord>('base.config_parameter')
        .write(param.id, { value: nextValue }, { writeDate: param.write_date });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      setParamDrafts((current) => {
        const next = { ...current };
        delete next[param.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
      toast.success(`Updated parameter ${param.key}`);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not update parameter');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setSavingParamId(null);
    }
  };

  const createConfigParam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configReadSucceeded) return;
    const mutationKey = settingsQueryKeys.configParameters();
    const trimmedKey = newParamKey.trim();
    if (!KEY_PATTERN.test(trimmedKey)) {
      toast.error('Parameter key must match ^[a-z][a-z0-9_.-]{1,127}$.');
      return;
    }
    const normalizedValue =
      newParamType === 'boolean' ? (newParamValue === 'true' ? 'true' : 'false') : newParamValue;
    const validationError = validateTypedConfigValue(normalizedValue, newParamType);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      setCreatingParam(true);
      await client.model<ConfigParameterRecord>('base.config_parameter').create({
        key: trimmedKey,
        value_type: newParamType,
        value: normalizedValue,
        is_secret: newParamSecret,
        description: newParamDescription.trim() || null,
      });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      setNewParamKey('');
      setNewParamType('string');
      setNewParamValue('');
      setNewParamSecret(false);
      setNewParamDescription('');
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
      toast.success(`Created parameter ${trimmedKey}`);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not create parameter');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setCreatingParam(false);
    }
  };

  const toggleFeatureFlag = async (flag: FeatureFlagRecord, enabled: boolean) => {
    if (!featureFlagsReadSucceeded) return;
    const mutationKey = settingsQueryKeys.featureFlags();
    try {
      setSavingFlagId(flag.id);
      await client
        .model<FeatureFlagRecord>('ir.feature_flag')
        .write(flag.id, { enabled }, { writeDate: flag.write_date });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
      toast.success(`${flag.key} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not update feature flag');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setSavingFlagId(null);
    }
  };

  const saveFeatureFlagRollout = async (flag: FeatureFlagRecord) => {
    if (!featureFlagsReadSucceeded) return;
    const mutationKey = settingsQueryKeys.featureFlags();
    const raw = (flagRolloutDrafts[flag.id] ?? String(flag.rollout_pct)).trim();
    if (!/^\d+$/.test(raw)) {
      toast.error('Rollout percentage must be an integer between 0 and 100.');
      return;
    }
    const pct = Number(raw);
    if (!Number.isSafeInteger(pct) || pct < 0 || pct > 100) {
      toast.error('Rollout percentage must be between 0 and 100.');
      return;
    }
    try {
      setSavingFlagId(flag.id);
      await client
        .model<FeatureFlagRecord>('ir.feature_flag')
        .write(flag.id, { rollout_pct: pct }, { writeDate: flag.write_date });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      setFlagRolloutDrafts((current) => {
        const next = { ...current };
        delete next[flag.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
      toast.success(`Updated rollout for ${flag.key} to ${pct}%`);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not update rollout percentage');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setSavingFlagId(null);
    }
  };

  const createFeatureFlag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!featureFlagsReadSucceeded) return;
    const mutationKey = settingsQueryKeys.featureFlags();
    const trimmedKey = newFlagKey.trim();
    const trimmedName = newFlagName.trim();
    if (!KEY_PATTERN.test(trimmedKey)) {
      toast.error('Flag key must match ^[a-z][a-z0-9_.-]{1,127}$.');
      return;
    }
    if (!trimmedName) {
      toast.error('Flag name is required.');
      return;
    }
    if (!/^\d+$/.test(newFlagRollout.trim())) {
      toast.error('Rollout percentage must be an integer between 0 and 100.');
      return;
    }
    const pct = Number(newFlagRollout.trim());
    if (!Number.isSafeInteger(pct) || pct < 0 || pct > 100) {
      toast.error('Rollout percentage must be between 0 and 100.');
      return;
    }
    try {
      setCreatingFlag(true);
      await client.model<FeatureFlagRecord>('ir.feature_flag').create({
        key: trimmedKey,
        name: trimmedName,
        enabled: newFlagEnabled,
        rollout_pct: pct,
      });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      setNewFlagKey('');
      setNewFlagName('');
      setNewFlagEnabled(false);
      setNewFlagRollout('100');
      await queryClient.invalidateQueries({ queryKey: mutationKey, exact: true });
      toast.success(`Created feature flag ${trimmedKey}`);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not create feature flag');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setCreatingFlag(false);
    }
  };

  const preferences: BoardPreferences = {
    ...storedPreferences,
    theme: mode,
    skin,
    density,
    language:
      languages.find((option) => option.id === userPreferences?.language_id)?.code ??
      storedPreferences.language,
    timezone: userPreferences?.timezone ?? storedPreferences.timezone,
    ...preferenceDraft,
  };

  const save = async () => {
    if (!user || !regionalReadSucceeded || savingPreferences) return;
    const mutationKey = settingsQueryKeys.user(user.id);
    const selectedLanguage = languages.find((language) => language.code === preferences.language);
    try {
      setSavingPreferences(true);
      await client.request('/auth/me/preferences', {
        method: 'PATCH',
        body: { language_id: selectedLanguage?.id ?? null, timezone: preferences.timezone },
      });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      queryClient.setQueryData(mutationKey, {
        ...userPreferences,
        language_id: selectedLanguage?.id ?? null,
        timezone: preferences.timezone,
      });
      savePreferences(preferences);
      setPreferenceDraft({});
      setSaved(true);
      toast.success('Settings saved');
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not save settings');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setSavingPreferences(false);
    }
  };

  const updatePreference = <K extends keyof BoardPreferences>(key: K, value: BoardPreferences[K]) =>
    setPreferenceDraft((current) => ({ ...current, [key]: value }));

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !userPreferencesLoaded || changingPassword) return;
    const mutationKey = settingsQueryKeys.user(user.id);
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('current_password') ?? '');
    const newPassword = String(form.get('new_password') ?? '');
    const confirmPassword = String(form.get('confirm_password') ?? '');
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }
    try {
      setChangingPassword(true);
      await client.request('/auth/me/password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      });
      if (!isCurrentScopeQueryKey(mutationKey)) return;
      await logout();
      toast.success('Password changed. Please sign in again with your new password.');
      router.replace('/login');
    } catch (error) {
      if (isCurrentScopeQueryKey(mutationKey)) {
        toast.error(error instanceof Error ? error.message : 'Could not change password');
      }
    } finally {
      if (isCurrentScopeQueryKey(mutationKey)) setChangingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: 'Settings' }]} />
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">Workspace</p>
          <h1 className="ink-title mt-2 text-4xl sm:text-5xl">Settings</h1>
          <p className="mt-2 text-ink-soft">Personal display and regional preferences.</p>
        </div>
        {(userPreferencesQuery.isFetching || languagesQuery.isFetching) && regionalReadSucceeded ? (
          <span role="status" className="font-mono text-xs text-ink-soft">
            Syncing…
          </span>
        ) : null}
      </header>

      {isDesktop && (
        <section className="ink-panel space-y-5 bg-card p-5 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center border-2 border-ink bg-primary text-primary-foreground shadow-ink-sm">
              {desktopMode === 'workspace' ? (
                <ColumnsIcon className="size-5" />
              ) : (
                <CodeIcon className="size-5" />
              )}
            </span>
            <div>
              <h2 className="font-display text-xl uppercase tracking-wide">
                Desktop Experience Mode
              </h2>
              <p className="text-sm text-ink-soft">
                Switch between clean Workspace productivity and full DX / Developer agent harness.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  id: 'workspace',
                  label: 'Workspace',
                  description:
                    'Tasks & Kanban, Knowledge, Stories, Notes — offline-first, zero technical clutter.',
                  icon: ColumnsIcon,
                },
                {
                  id: 'developer',
                  label: 'DX / Developer',
                  description:
                    'Full AI Mission Control, Git Worktrees, Bounded PTY, MCP Server, and Model Explorer.',
                  icon: CodeIcon,
                },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const selected = desktopMode === option.id;
              return (
                <Button
                  key={option.id}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => {
                    setDesktopMode(option.id);
                    toast.success(`Switched Desktop Experience Mode to ${option.label}.`);
                  }}
                  className={`flex h-auto flex-col items-start gap-2 border-2 p-4 text-left transition-colors ${
                    selected
                      ? 'border-ink bg-primary text-[var(--mw-primary-foreground)] shadow-ink-sm'
                      : 'border-ink/30 hover:border-ink'
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <Icon className="size-5 shrink-0" />
                    <span className="font-display uppercase">{option.label}</span>
                    {selected && <CheckIcon className="ml-auto size-4 shrink-0" />}
                  </div>
                  <span
                    className={`text-xs font-normal normal-case ${
                      selected ? 'text-[var(--mw-primary-foreground)]' : 'text-ink-soft'
                    }`}
                  >
                    {option.description}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
      )}

      {isDesktop && <DesktopDoctorCard />}

      {isDesktop && <LocalRagSearchPanel />}

      {isDesktop && (
        <Panel className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <SecurityIcon className="size-5 text-primary" />
                <h2 className="font-display text-xl uppercase tracking-wide">
                  Local AI &amp; Offline Backup
                </h2>
                <Badge
                  variant={
                    localAiQuery.isError
                      ? 'destructive'
                      : localAiQuery.data && localAiQuery.data.onlineCount > 0
                        ? 'cyan'
                        : 'default'
                  }
                >
                  {localAiQuery.isError
                    ? 'Unavailable'
                    : localAiQuery.data
                      ? `${localAiQuery.data.onlineCount} provider(s) online`
                      : 'Scanning...'}
                </Badge>
              </div>
              <p className="text-sm text-ink-soft">
                Zero-config Ollama / LM Studio discovery and SHA-256 verified local SQLite
                snapshots. Available in both Workspace and DX modes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={localAiQuery.isFetching}
                onClick={() => void localAiQuery.refetch()}
              >
                <RefreshIcon className="mr-2 size-4" />
                {localAiQuery.isFetching ? 'Scanning...' : 'Rescan Local AI'}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={!localBackupsQuery.isSuccess || createBackupMutation.isPending}
                onClick={() => createBackupMutation.mutate()}
              >
                <CheckIcon className="mr-2 size-4" />
                {createBackupMutation.isPending ? 'Backing up...' : 'Create Local Backup'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <MetricTile
              label="Discovered Local Models"
              value={localAiQuery.isSuccess ? String(localAiQuery.data.models.length) : '—'}
              icon={<SignalIcon className="size-4 text-primary" />}
            />
            <MetricTile
              label="Recommended Model"
              value={
                localAiQuery.isSuccess
                  ? ((desktopMode === 'developer'
                      ? localAiQuery.data.recommendedDevModel
                      : localAiQuery.data.recommendedWorkspaceModel) ?? 'None detected')
                  : '—'
              }
              icon={<CodeIcon className="size-4 text-primary" />}
            />
            <MetricTile
              label="Verified Local Backups"
              value={
                localBackupsQuery.isSuccess ? String(localBackupsQuery.data.backups.length) : '—'
              }
              icon={<SecurityIcon className="size-4 text-primary" />}
            />
          </div>

          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              Local AI Models (Ollama / LM Studio / vLLM)
            </p>
            {localAiQuery.isLoading && !localAiQuery.data ? (
              <Skeleton className="h-14 w-full" />
            ) : localAiQuery.isError ? (
              <SettingsQueryError
                title="Local AI discovery unavailable"
                description="Live local models could not be read; no provider health is being inferred."
                retrying={localAiQuery.isFetching}
                onRetry={() => void localAiQuery.refetch()}
              />
            ) : localAiQuery.isSuccess && localAiQuery.data.models.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {localAiQuery.data.models.map((model) => (
                  <Badge key={`${model.providerId}:${model.id}`} variant="cyan">
                    {model.providerName}: {model.id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-soft">
                No local Ollama (127.0.0.1:11434) or LM Studio (127.0.0.1:1234) models detected.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-ink/20 pt-4">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              Offline SQLite Backups
            </p>
            {localBackupsQuery.isLoading && !localBackupsQuery.data ? (
              <Skeleton className="h-16 w-full" />
            ) : localBackupsQuery.isError ? (
              <SettingsQueryError
                title="Local backup inventory unavailable"
                description="The backup list could not be read; backup verification has not been assumed."
                retrying={localBackupsQuery.isFetching}
                onRetry={() => void localBackupsQuery.refetch()}
              />
            ) : localBackupsQuery.isSuccess && localBackupsQuery.data.backups.length > 0 ? (
              <div className="space-y-2">
                {localBackupsQuery.data.backups.slice(0, 5).map((backup) => (
                  <div
                    key={backup.fileName}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-ink/20 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono font-medium">{backup.fileName}</div>
                      <div className="font-mono text-[11px] text-ink-soft">
                        SHA-256: {backup.sha256.slice(0, 16)}... &bull;{' '}
                        {(backup.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <Badge variant={backup.verified ? 'cyan' : 'destructive'}>
                      {backup.verified ? 'Verified' : 'Unverified'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-soft">
                No local backups created yet. Click &ldquo;Create Local Backup&rdquo; to snapshot
                your offline database.
              </p>
            )}
          </div>
        </Panel>
      )}

      <section className="ink-panel space-y-6 bg-card p-5 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center border-2 border-ink bg-primary text-primary-foreground shadow-ink-sm">
            <SettingsIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-xl uppercase tracking-wide">Appearance</h2>
            <p className="text-sm text-ink-soft">Choose a theme for this browser.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(['light', 'dark'] as const).map((theme) => {
              const Icon = theme === 'light' ? SunIcon : MoonIcon;
              const selected = preferences.theme === theme;
              return (
                <Button
                  key={theme}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => {
                    setMode(theme);
                    updatePreference('theme', theme);
                  }}
                  className={`flex items-center gap-3 border-2 p-4 text-left transition-colors ${
                    selected
                      ? 'border-ink bg-primary text-[var(--mw-primary-foreground)] shadow-ink-sm'
                      : 'border-ink/30 hover:border-ink'
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="font-display uppercase">{theme} theme</span>
                  {selected && <CheckIcon className="ml-auto size-4" />}
                </Button>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-ink/20 pt-4">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">Skin</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {skins.map((skinOption) => {
                const selected = preferences.skin === skinOption.id;
                return (
                  <Button
                    key={skinOption.id}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    aria-pressed={selected}
                    onClick={() => {
                      setSkin(skinOption.id);
                      updatePreference('skin', skinOption.id);
                    }}
                    className={`flex h-auto flex-col items-start gap-2 border-2 p-3 text-left transition-colors ${
                      selected
                        ? 'border-ink bg-primary text-[var(--mw-primary-foreground)] shadow-ink-sm'
                        : 'border-ink/30 hover:border-ink'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-display text-sm uppercase">{skinOption.label}</span>
                      {selected && <CheckIcon className="size-4 shrink-0" />}
                    </div>
                    <span
                      className={`text-xs font-normal normal-case ${
                        selected ? 'text-[var(--mw-primary-foreground)]' : 'text-ink-soft'
                      }`}
                    >
                      {skinOption.description}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5" aria-hidden="true">
                      <span
                        className="size-3.5 border border-ink"
                        style={{ backgroundColor: skinOption.swatch.background }}
                      />
                      <span
                        className="size-3.5 border border-ink"
                        style={{ backgroundColor: skinOption.swatch.surface }}
                      />
                      <span
                        className="size-3.5 border border-ink"
                        style={{ backgroundColor: skinOption.swatch.foreground }}
                      />
                      <span
                        className="size-3.5 border border-ink"
                        style={{ backgroundColor: skinOption.swatch.accent }}
                      />
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 border-t border-ink/20 pt-4">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">Density</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['comfortable', 'compact'] as const).map((densityOption) => {
                const selected = preferences.density === densityOption;
                return (
                  <Button
                    key={densityOption}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    aria-pressed={selected}
                    onClick={() => {
                      setDensity(densityOption);
                      updatePreference('density', densityOption);
                    }}
                    className={`flex items-center justify-between gap-3 border-2 p-3 text-left transition-colors ${
                      selected
                        ? 'border-ink bg-primary text-[var(--mw-primary-foreground)] shadow-ink-sm'
                        : 'border-ink/30 hover:border-ink'
                    }`}
                  >
                    <span className="font-display uppercase">{densityOption} density</span>
                    {selected && <CheckIcon className="size-4" />}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <NotificationPreferences />

      <section className="ink-panel space-y-6 bg-card p-5 sm:p-8">
        <div>
          <h2 className="font-display text-xl uppercase tracking-wide">Language & time</h2>
          <p className="text-sm text-ink-soft">
            Regional preferences are saved to your user account.
          </p>
        </div>
        {(userLoading && !userPreferences) || (languagesLoading && !languagesQuery.data) ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : userPreferencesQuery.isError || languagesQuery.isError ? (
          <SettingsQueryError
            title="Regional preferences unavailable"
            description="Required settings reads failed. Language and time zone cannot be changed until they load successfully."
            retrying={userPreferencesQuery.isFetching || languagesQuery.isFetching}
            onRetry={() => {
              void userPreferencesQuery.refetch();
              void languagesQuery.refetch();
            }}
          />
        ) : regionalReadSucceeded ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-language">Language</Label>
              <Select
                value={preferences.language}
                onValueChange={(language) => updatePreference('language', language)}
              >
                <SelectTrigger id="settings-language" className="w-full">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((language) => (
                    <SelectItem key={language.id} value={language.code}>
                      {language.name} ({language.code})
                    </SelectItem>
                  ))}
                  {languages.length === 0 && (
                    <SelectItem value={DEFAULT_PREFERENCES.language}>English (en-US)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-timezone">Time zone</Label>
              <Select
                value={preferences.timezone}
                onValueChange={(timezone) => updatePreference('timezone', timezone)}
              >
                <SelectTrigger id="settings-timezone" className="w-full">
                  <SelectValue placeholder="Select time zone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone}
                    </SelectItem>
                  ))}
                  {!TIMEZONES.includes(preferences.timezone) && (
                    <SelectItem value={preferences.timezone}>{preferences.timezone}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end border-t border-ink/20 pt-5">
          <Button
            onClick={() => void save()}
            disabled={!regionalReadSucceeded || savingPreferences}
            className="gap-2"
          >
            {saved ? <CheckIcon className="size-4" /> : null}
            {saved ? 'Saved' : 'Save settings'}
          </Button>
        </div>
      </section>

      <form
        onSubmit={(event) => void changePassword(event)}
        className="ink-panel space-y-5 bg-card p-5 sm:p-8"
      >
        <div>
          <h2 className="font-display text-xl uppercase tracking-wide">Change password</h2>
          <p className="text-sm text-ink-soft">
            Use at least 12 characters. Saved sign-in sessions are revoked; other access tokens can
            remain valid for up to 15 minutes.
          </p>
        </div>
        {userPreferencesQuery.isError && (
          <SettingsQueryError
            title="Account settings unavailable"
            description="Password changes are blocked because the scoped account settings read failed."
            retrying={userPreferencesQuery.isFetching}
            onRetry={() => void userPreferencesQuery.refetch()}
          />
        )}
        <fieldset
          disabled={!userPreferencesLoaded || userLoading}
          className="grid gap-5 sm:grid-cols-2"
        >
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
            />
          </div>
        </fieldset>
        <div className="flex justify-end border-t border-ink/20 pt-5">
          <Button
            type="submit"
            disabled={!userPreferencesLoaded || userLoading || changingPassword}
            variant="outline"
          >
            {changingPassword ? 'Updating…' : 'Change password'}
          </Button>
        </div>
      </form>

      {isAdmin && !isDesktop && (
        <Panel
          title="Server Instance & Domains"
          description="Manage public domains, TLS, and port 8000 hardening for this server."
          density="compact"
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/board/cloud">Manage Instance &amp; Domains</Link>
          </Button>
        </Panel>
      )}

      {isAdmin && (
        <>
          <section className="ink-panel space-y-6 bg-card p-5 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl uppercase tracking-wide">
                  System &amp; Company Parameters
                </h2>
                <p className="text-sm text-ink-soft">
                  Runtime configuration parameters stored in <code>base.config_parameter</code>.
                </p>
              </div>
              <Badge variant="primary">Admin Only</Badge>
            </div>

            {configParamsLoading && !configParamsQuery.data ? (
              <div className="space-y-3">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : configParamsQuery.isError ? (
              <SettingsQueryError
                title="Configuration parameters unavailable"
                description="The parameter read failed. Existing values are hidden and writes remain disabled."
                retrying={configParamsQuery.isFetching}
                onRetry={() => void configParamsQuery.refetch()}
              />
            ) : configReadSucceeded && configParameters.length === 0 ? (
              <p className="font-mono text-xs text-ink-faint">
                No configuration parameters defined yet.
              </p>
            ) : configReadSucceeded ? (
              <div className="space-y-3">
                {configParameters.map((param) => {
                  const currentValue = paramDrafts[param.id] ?? param.value ?? '';
                  const isDirty = paramDrafts[param.id] !== undefined;
                  const isSaving = savingParamId === param.id;
                  return (
                    <div
                      key={param.id}
                      className="flex flex-col gap-3 border-2 border-ink/25 bg-paper-raised p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold">{param.key}</span>
                          <Badge variant="default">{param.value_type}</Badge>
                          {param.is_secret && <Badge variant="destructive">secret</Badge>}
                          {param.company_id ? (
                            <Badge variant="default">company #{param.company_id}</Badge>
                          ) : (
                            <Badge variant="default">global</Badge>
                          )}
                        </div>
                        {param.description && (
                          <p className="text-xs text-ink-soft">{param.description}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                        {param.value_type === 'boolean' ? (
                          <Switch
                            id={`cfg-param-${param.id}`}
                            aria-label={`Toggle ${param.key}`}
                            checked={currentValue === 'true' || currentValue === '1'}
                            disabled={isSaving}
                            onCheckedChange={(checked) =>
                              setParamDrafts((current) => ({
                                ...current,
                                [param.id]: checked ? 'true' : 'false',
                              }))
                            }
                          />
                        ) : (
                          <Input
                            id={`cfg-param-${param.id}`}
                            aria-label={`Value for ${param.key}`}
                            type={param.is_secret ? 'password' : 'text'}
                            value={currentValue}
                            disabled={isSaving}
                            onChange={(event) =>
                              setParamDrafts((current) => ({
                                ...current,
                                [param.id]: event.target.value,
                              }))
                            }
                            className="w-56 font-mono text-xs"
                          />
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant={isDirty ? 'default' : 'outline'}
                          disabled={!isDirty || isSaving}
                          onClick={() => void saveConfigParam(param)}
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {configReadSucceeded && (
              <form
                onSubmit={(event) => void createConfigParam(event)}
                className="space-y-4 border-t border-ink/20 pt-5"
              >
                <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                  Add Parameter
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-param-key">Key</Label>
                    <Input
                      id="new-param-key"
                      placeholder="e.g. app.max_upload_mb"
                      value={newParamKey}
                      onChange={(event) => setNewParamKey(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-param-type">Value Type</Label>
                    <Select
                      value={newParamType}
                      onValueChange={(value) => {
                        const nextType = value as ConfigValueType;
                        setNewParamType(nextType);
                        if (nextType === 'boolean') {
                          setNewParamValue('false');
                        }
                      }}
                    >
                      <SelectTrigger id="new-param-type" className="w-full">
                        <SelectValue placeholder="Select value type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="integer">integer</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                        <SelectItem value="json">json</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-param-value">Value</Label>
                    {newParamType === 'boolean' ? (
                      <div className="flex h-10 items-center gap-2">
                        <Switch
                          id="new-param-value"
                          checked={newParamValue === 'true'}
                          onCheckedChange={(checked) =>
                            setNewParamValue(checked ? 'true' : 'false')
                          }
                        />
                        <span className="font-mono text-xs">
                          {newParamValue === 'true' ? 'true' : 'false'}
                        </span>
                      </div>
                    ) : (
                      <Input
                        id="new-param-value"
                        type={newParamSecret ? 'password' : 'text'}
                        placeholder={
                          newParamType === 'integer'
                            ? '42'
                            : newParamType === 'json'
                              ? '{"enabled":true}'
                              : 'value'
                        }
                        value={newParamValue}
                        onChange={(event) => setNewParamValue(event.target.value)}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-param-description">Description</Label>
                    <Input
                      id="new-param-description"
                      placeholder="Optional description"
                      value={newParamDescription}
                      onChange={(event) => setNewParamDescription(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="new-param-secret"
                      checked={newParamSecret}
                      onCheckedChange={setNewParamSecret}
                    />
                    <Label htmlFor="new-param-secret">
                      Mark as secret (redacted in audit logs)
                    </Label>
                  </div>
                  <Button type="submit" size="sm" disabled={creatingParam}>
                    {creatingParam ? 'Creating…' : 'Create Parameter'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section className="ink-panel space-y-6 bg-card p-5 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl uppercase tracking-wide">Feature Flags</h2>
                <p className="text-sm text-ink-soft">
                  Tenant- and rollout-aware feature toggles stored in <code>ir.feature_flag</code>.
                </p>
              </div>
              <Badge variant="primary">Admin Only</Badge>
            </div>

            {featureFlagsLoading && !featureFlagsQuery.data ? (
              <div className="space-y-3">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : featureFlagsQuery.isError ? (
              <SettingsQueryError
                title="Feature flags unavailable"
                description="The flag read failed. Current rollout state is hidden and writes remain disabled."
                retrying={featureFlagsQuery.isFetching}
                onRetry={() => void featureFlagsQuery.refetch()}
              />
            ) : featureFlagsReadSucceeded && featureFlags.length === 0 ? (
              <p className="font-mono text-xs text-ink-faint">No feature flags defined yet.</p>
            ) : featureFlagsReadSucceeded ? (
              <div className="space-y-3">
                {featureFlags.map((flag) => {
                  const rolloutDraft = flagRolloutDrafts[flag.id] ?? String(flag.rollout_pct);
                  const isRolloutDirty = flagRolloutDrafts[flag.id] !== undefined;
                  const isSaving = savingFlagId === flag.id;
                  return (
                    <div
                      key={flag.id}
                      className="flex flex-col gap-3 border-2 border-ink/25 bg-paper-raised p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm uppercase">{flag.name}</span>
                          <Badge variant="default">{flag.key}</Badge>
                          <Badge variant={flag.enabled ? 'primary' : 'default'}>
                            {flag.enabled ? 'enabled' : 'disabled'}
                          </Badge>
                          {flag.expires_at && (
                            <Badge variant="default">expires {flag.expires_at.slice(0, 10)}</Badge>
                          )}
                        </div>
                        {flag.description && (
                          <p className="text-xs text-ink-soft">{flag.description}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={`flag-rollout-${flag.id}`} className="font-mono text-xs">
                            Rollout %
                          </Label>
                          <Input
                            id={`flag-rollout-${flag.id}`}
                            aria-label={`Rollout percentage for ${flag.key}`}
                            value={rolloutDraft}
                            disabled={isSaving}
                            onChange={(event) =>
                              setFlagRolloutDrafts((current) => ({
                                ...current,
                                [flag.id]: event.target.value,
                              }))
                            }
                            className="w-20 font-mono text-xs"
                          />
                          {isRolloutDirty && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={isSaving}
                              onClick={() => void saveFeatureFlagRollout(flag)}
                            >
                              Save
                            </Button>
                          )}
                        </div>
                        <Switch
                          id={`flag-enabled-${flag.id}`}
                          aria-label={`Enable ${flag.key}`}
                          checked={flag.enabled}
                          disabled={isSaving}
                          onCheckedChange={(checked) => void toggleFeatureFlag(flag, checked)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {featureFlagsReadSucceeded && (
              <form
                onSubmit={(event) => void createFeatureFlag(event)}
                className="space-y-4 border-t border-ink/20 pt-5"
              >
                <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                  Add Feature Flag
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-flag-key">Key</Label>
                    <Input
                      id="new-flag-key"
                      placeholder="e.g. board.beta_view"
                      value={newFlagKey}
                      onChange={(event) => setNewFlagKey(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-flag-name">Name</Label>
                    <Input
                      id="new-flag-name"
                      placeholder="Beta View"
                      value={newFlagName}
                      onChange={(event) => setNewFlagName(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-flag-rollout">Rollout % (0–100)</Label>
                    <Input
                      id="new-flag-rollout"
                      value={newFlagRollout}
                      onChange={(event) => setNewFlagRollout(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="new-flag-enabled"
                      checked={newFlagEnabled}
                      onCheckedChange={setNewFlagEnabled}
                    />
                    <Label htmlFor="new-flag-enabled">Enabled immediately</Label>
                  </div>
                  <Button type="submit" size="sm" disabled={creatingFlag}>
                    {creatingFlag ? 'Creating…' : 'Create Flag'}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
