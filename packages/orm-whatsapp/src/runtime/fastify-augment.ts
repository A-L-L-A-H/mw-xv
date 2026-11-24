import type { Multipart } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';

export interface WhatsappAuthContext {
  userId: number;
  companyId: number;
  role: string;
  groupPermissions: readonly {
    model_name: string;
    read?: boolean;
    create: boolean;
    write: boolean;
    unlink?: boolean;
  }[];
  login?: string;
  groups?: string[];
  companyIds?: number[];
  isSuperadmin?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Knex;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    auth: WhatsappAuthContext | null;
    isMultipart: () => boolean;
    parts: (options?: Record<string, unknown>) => AsyncIterableIterator<Multipart>;
  }

  interface FastifyContextConfig {
    rateLimit?: unknown;
  }
}
