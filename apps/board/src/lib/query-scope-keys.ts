import type { QueryKey } from '@tanstack/react-query';

export const scopeMarker = 'board-scope';

export interface BoardQueryScope {
  readonly userId: number | null;
  readonly companyId: number | null;
  readonly metadataGeneration: number | null;
}

/** Append an explicit tenant/identity scope to a query key. */
export function scopedQueryKey<TKey extends QueryKey>(queryKey: TKey, scope: BoardQueryScope) {
  return [
    ...queryKey,
    scopeMarker,
    scope.userId,
    scope.companyId,
    scope.metadataGeneration,
  ] as const;
}

/** True when a key was written under the supplied scope, never a stale scope. */
export function isCurrentScopeQueryKey(queryKey: QueryKey, scope: BoardQueryScope): boolean {
  const scopeIndex = queryKey.length - 4;
  return (
    queryKey[scopeIndex] === scopeMarker &&
    queryKey[scopeIndex + 1] === scope.userId &&
    queryKey[scopeIndex + 2] === scope.companyId &&
    queryKey[scopeIndex + 3] === scope.metadataGeneration
  );
}

export function settingsUserKey(userId: number | undefined, scope: BoardQueryScope) {
  return scopedQueryKey(['settings', 'user', userId ?? null], scope);
}

export function settingsLanguagesKey(scope: BoardQueryScope) {
  return scopedQueryKey(['settings', 'languages'], scope);
}

export function settingsConfigParametersKey(scope: BoardQueryScope) {
  return scopedQueryKey(['settings', 'config_parameters'], scope);
}

export function settingsFeatureFlagsKey(scope: BoardQueryScope) {
  return scopedQueryKey(['settings', 'feature_flags'], scope);
}

export function settingsDesktopAiModelsKey(scope: BoardQueryScope) {
  return scopedQueryKey(['desktop', 'ai', 'models'], scope);
}

export function settingsDesktopBackupsKey(scope: BoardQueryScope) {
  return scopedQueryKey(['desktop', 'backups'], scope);
}

export function profileContactKey(userId: number | undefined, scope: BoardQueryScope) {
  return scopedQueryKey(['profile', userId ?? null], scope);
}
