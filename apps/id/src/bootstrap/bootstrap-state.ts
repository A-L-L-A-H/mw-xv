export interface BootstrapDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface BootstrapStatePorts {
  readonly bootstrapDatabase?: BootstrapDatabasePort;
  readonly hasPlatformOwner?: () => Promise<boolean>;
  readonly now?: () => Date;
  readonly installationScope?: string;
}

export interface BootstrapSetupState {
  readonly setupRequired: boolean;
}

export const PUBLIC_SETUP_STATE: Readonly<BootstrapSetupState> = Object.freeze({
  setupRequired: false,
});

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

export async function validBootstrapTokenExists(
  ports: BootstrapStatePorts
): Promise<boolean> {
  const now = (ports.now ?? (() => new Date()))().toISOString();
  try {
    const rows = rowsFrom(
      await ports.bootstrapDatabase?.raw(
        `SELECT 1 AS present
         FROM identity.bootstrap_token
         WHERE installation_scope = ?
           AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?
         LIMIT 1`,
        [ports.installationScope ?? 'installation', now]
      )
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function platformOwnerExists(ports: BootstrapStatePorts): Promise<boolean> {
  if (!ports.hasPlatformOwner) return false;
  try {
    return await ports.hasPlatformOwner();
  } catch {
    return true;
  }
}

export async function getBootstrapSetupState(
  ports: BootstrapStatePorts
): Promise<BootstrapSetupState> {
  if (await platformOwnerExists(ports)) return { ...PUBLIC_SETUP_STATE };
  const tokenAvailable = await validBootstrapTokenExists(ports);
  return Object.freeze({ setupRequired: tokenAvailable });
}
