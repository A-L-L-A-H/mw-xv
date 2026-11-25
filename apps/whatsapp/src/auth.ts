import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WhatsappServiceConfig } from './config.js';

const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/health',
  '/healthz',
  '/readyz',
  '/favicon.ico',
  '/docs',
  '/@react-refresh',
]);

const PUBLIC_PREFIXES = ['/docs/', '/assets/', '/@vite/', '/@id/', '/@fs/', '/node_modules/'];

const PUBLIC_ROOT_ASSET_PATTERN = /^\/[^/]+\.(?:html|js|css|tsx|ts|mjs|svg|ico|map)$/iu;

export function isPublicWhatsappRoute(url: string): boolean {
  const pathname = url.split('?', 1)[0] || '/';
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return PUBLIC_ROOT_ASSET_PATTERN.test(pathname);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return left.length === right.length && timingSafeEqual(leftDigest, rightDigest);
}

function verifyBasicAuth(header: string, config: WhatsappServiceConfig): boolean {
  if (!config.gatewayUsername || !config.gatewayPassword) return false;
  const encoded = header.slice(6).trim();
  if (!encoded) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) return false;
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return (
    constantTimeEqual(username, config.gatewayUsername) &&
    constantTimeEqual(password, config.gatewayPassword)
  );
}

function verifyBearerAuth(header: string, config: WhatsappServiceConfig): boolean {
  if (!config.apiKey) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  return constantTimeEqual(token, config.apiKey);
}

export function isAuthorizedRequest(
  req: Pick<FastifyRequest, 'headers'>,
  config: WhatsappServiceConfig
): boolean {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization) return false;
  const lower = authorization.toLowerCase();
  if (lower.startsWith('basic ')) {
    return verifyBasicAuth(authorization, config);
  }
  if (lower.startsWith('bearer ')) {
    return verifyBearerAuth(authorization, config);
  }
  return false;
}

export function registerAuthGuard(app: FastifyInstance, config: WhatsappServiceConfig): void {
  const challenge = config.apiKey
    ? 'Basic realm="MoonWitness WhatsApp", Bearer'
    : 'Basic realm="MoonWitness WhatsApp"';

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'OPTIONS') return;
    if (isPublicWhatsappRoute(req.url)) return;
    if (isAuthorizedRequest(req, config)) return;

    return reply.code(401).header('WWW-Authenticate', challenge).send({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  });
}
