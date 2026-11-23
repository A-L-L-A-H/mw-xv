import { createHash } from 'node:crypto';
import { computeAddonSchemaDigest, type Addon } from './addon.js';

export interface AddonSchemaSnapshot {
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export interface DesiredSchemaState {
  readonly version: number;
  readonly digest: string;
  readonly addons: readonly AddonSchemaSnapshot[];
}

export function computeDesiredSchemaState(
  addons: readonly Addon[],
  version: number
): DesiredSchemaState {
  const snapshots = addons
    .map((addon) => ({
      name: addon.name,
      version: addon.version,
      digest: computeAddonSchemaDigest(addon),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const digest = createHash('sha256').update(JSON.stringify(snapshots)).digest('hex').slice(0, 16);

  return { version, digest, addons: snapshots };
}

export interface AppliedSchemaState {
  readonly version: number;
  readonly digest: string;
}

export type SchemaComparisonKind = 'current' | 'outdated' | 'drifted' | 'ahead';

export type SchemaComparisonReason =
  'matched' | 'uninitialized' | 'version_behind' | 'digest_mismatch' | 'version_ahead';

export interface SchemaComparisonResult {
  readonly kind: SchemaComparisonKind;
  readonly reason: SchemaComparisonReason;
  readonly requiresMigration: boolean;
  readonly canServeTraffic: boolean;
}

export function compareSchemaStates(
  desired: Pick<DesiredSchemaState, 'version' | 'digest'>,
  applied: AppliedSchemaState | null
): SchemaComparisonResult {
  if (!applied) {
    return {
      kind: 'outdated',
      reason: 'uninitialized',
      requiresMigration: true,
      canServeTraffic: false,
    };
  }
  if (applied.version > desired.version) {
    return {
      kind: 'ahead',
      reason: 'version_ahead',
      requiresMigration: false,
      canServeTraffic: false,
    };
  }
  if (applied.version < desired.version) {
    return {
      kind: 'outdated',
      reason: 'version_behind',
      requiresMigration: true,
      canServeTraffic: false,
    };
  }
  if (applied.digest !== desired.digest) {
    return {
      kind: 'drifted',
      reason: 'digest_mismatch',
      requiresMigration: true,
      canServeTraffic: false,
    };
  }
  return {
    kind: 'current',
    reason: 'matched',
    requiresMigration: false,
    canServeTraffic: true,
  };
}
