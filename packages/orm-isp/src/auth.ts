import { createHmac } from 'node:crypto';

export const ISP_INTERNAL_AUTH_DOMAIN = 'moonwitness-isp-admin-v1';

export interface IspAdminTokenOptions {
  readonly adminToken?: string;
  readonly jwtSecret?: string;
}

export function resolveIspAdminToken(options?: IspAdminTokenOptions): string | undefined {
  const explicitToken = options?.adminToken?.trim() || process.env.MW_ISP_ADMIN_TOKEN?.trim();
  if (explicitToken) {
    return explicitToken;
  }

  const secret =
    process.env.MW_INTERNAL_SECRET?.trim() ||
    options?.jwtSecret?.trim() ||
    process.env.JWT_SECRET?.trim();
  if (secret) {
    return createHmac('sha256', secret).update(ISP_INTERNAL_AUTH_DOMAIN).digest('hex');
  }

  return undefined;
}

export function ispAuthHeaders(
  token: string | undefined,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = extra ? { ...extra } : {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
