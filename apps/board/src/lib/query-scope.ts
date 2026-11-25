import type { QueryKey } from '@tanstack/react-query';
import { client } from '@/lib/client';
import {
  isCurrentScopeQueryKey as isScopedKey,
  profileContactKey,
  scopedQueryKey as appendScope,
  settingsConfigParametersKey,
  settingsDesktopAiModelsKey,
  settingsDesktopBackupsKey,
  settingsFeatureFlagsKey,
  settingsLanguagesKey,
  settingsUserKey,
  type BoardQueryScope,
} from './query-scope-keys';

export type { BoardQueryScope } from './query-scope-keys';

/** Capture the scope before starting a request so its cache writes remain tenant-bound. */
export function getQueryScope(): BoardQueryScope {
  return {
    userId: client.currentUser?.id ?? null,
    companyId: client.getCompanyId() ?? null,
    metadataGeneration: client.metadataGeneration ?? null,
  };
}

export function scopedQueryKey<TKey extends QueryKey>(
  queryKey: TKey,
  scope: BoardQueryScope = getQueryScope()
) {
  return appendScope(queryKey, scope);
}

export function isCurrentScopeQueryKey(
  queryKey: QueryKey,
  scope: BoardQueryScope = getQueryScope()
): boolean {
  return isScopedKey(queryKey, scope);
}

export const settingsQueryKeys = {
  user: (userId: number | undefined, scope?: BoardQueryScope) =>
    settingsUserKey(userId, scope ?? getQueryScope()),
  languages: (scope?: BoardQueryScope) => settingsLanguagesKey(scope ?? getQueryScope()),
  configParameters: (scope?: BoardQueryScope) =>
    settingsConfigParametersKey(scope ?? getQueryScope()),
  featureFlags: (scope?: BoardQueryScope) => settingsFeatureFlagsKey(scope ?? getQueryScope()),
  desktopAiModels: (scope?: BoardQueryScope) =>
    settingsDesktopAiModelsKey(scope ?? getQueryScope()),
  desktopBackups: (scope?: BoardQueryScope) => settingsDesktopBackupsKey(scope ?? getQueryScope()),
} as const;

export const profileQueryKeys = {
  contact: (userId: number | undefined, scope?: BoardQueryScope) =>
    profileContactKey(userId, scope ?? getQueryScope()),
} as const;
