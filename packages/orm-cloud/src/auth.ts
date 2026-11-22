import { createHmac } from 'node:crypto';

export const CONTROL_PLANE_INTERNAL_AUTH_DOMAIN = 'moonwitness-control-plane-admin-v1';

export function resolveControlPlaneToken(options?: { adminToken?: string; jwtSecret?: string }): string | undefined {
  const explicit =
    options?.adminToken?.trim() ?? process.env.MW_CONTROL_PLANE_TOKEN?.trim();
  if (explicit && explicit.length > 0) return explicit;

  const secret =
    process.env.MW_INTERNAL_SECRET?.trim() ??
    options?.jwtSecret?.trim() ??
    process.env.JWT_SECRET?.trim();
  if (secret && secret.length > 0) {
    return createHmac('sha256', secret).update(CONTROL_PLANE_INTERNAL_AUTH_DOMAIN).digest('hex');
  }
  return undefined;
}

export function controlPlaneAuthHeaders(
  token: string | undefined,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (extra) Object.assign(headers, extra);
  return headers;
}
