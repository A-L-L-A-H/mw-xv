/**
 * @moonwitness/orm-identity
 *
 * Identity-owned data models for the MoonWitness Identity Provider.
 *
 * This package is data-model-only. Importing it MUST NOT open a database
 * connection, read environment secrets or register models with the
 * business addon registry. Models are added by later Identity tasks (I14-I19).
 */

export const IDENTITY_PACKAGE_NAME = "@moonwitness/orm-identity" as const;

/** A single entry in the Identity model registry. */
export interface IdentityModelEntry {
  /** Stable model name used for lookups (e.g. "identity.account"). */
  readonly name: string;
  /** Database table owned by the Identity database. */
  readonly tableName: string;
}

/**
 * Identity model registry.
 *
 * Intentionally empty at I08. Later Identity tasks append their model entries
 * here. The registry is a plain frozen array; reading it never opens a database
 * connection and never touches the business addon registry.
 */
export const IDENTITY_MODELS: ReadonlyArray<IdentityModelEntry> = Object.freeze([]);

/** Look up an Identity model entry by name without touching a database. */
export function findIdentityModel(name: string): IdentityModelEntry | undefined {
  return IDENTITY_MODELS.find((model) => model.name === name);
}

export {
  hashIdentityPassword,
  verifyIdentityPassword,
  type IdentityPasswordHash,
} from './password-hash.js';
