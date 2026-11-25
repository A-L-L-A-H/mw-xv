import type { AddonHttpPlugin, AddonHttpReply } from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import { ensureAiJobHandlersRegistered, requireAiCompanyContext } from './ai-http-helpers.js';
import {
  createInteractiveSession,
  ensureInteractiveSessionConsumer,
  InteractiveSessionError,
  listInteractiveSessions,
  readInteractiveSession,
  readPendingInteractiveApproval,
  submitInteractiveCommand,
} from './interactive-sessions.js';
import type { InteractiveCommandType } from './models/interactive-sessions.js';

export const INTERACTIVE_SESSION_ROUTE_PREFIXES = ['/api/ai', '/ai'] as const;
const COMMAND_TYPES = new Set<InteractiveCommandType>([
  'prompt',
  'request_approval',
  'approve',
  'deny',
  'cancel',
]);

function sessionId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new InteractiveSessionError('INVALID_INPUT', 'Invalid session ID', 422);
  }
  return id;
}

function commandType(raw: unknown): InteractiveCommandType {
  if (typeof raw !== 'string' || !COMMAND_TYPES.has(raw as InteractiveCommandType)) {
    throw new InteractiveSessionError('INVALID_INPUT', 'Unsupported command type', 422);
  }
  return raw as InteractiveCommandType;
}

export const interactiveSessionsHttpPlugin: AddonHttpPlugin = async (app) => {
  ensureAiJobHandlersRegistered();
  ensureInteractiveSessionConsumer();
  for (const prefix of INTERACTIVE_SESSION_ROUTE_PREFIXES) {
    app.post(`${prefix}/interactive-sessions`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      try {
        const body = isRecord(req.body) ? req.body : {};
        const result = await createInteractiveSession({
          companyId: ctx.companyId,
          userId: ctx.userId,
          agentId: Number(body.agentId),
          workContractId: Number(body.workContractId),
          initialPrompt: body.initialPrompt as string,
          idempotencyKey: body.idempotencyKey as string,
        });
        return reply
          .code(result.replayed ? 200 : 201)
          .send({ success: true, data: result.session, replayed: result.replayed });
      } catch (error) {
        return interactiveError(reply, error);
      }
    });

    app.get(`${prefix}/interactive-sessions`, async (req, reply) => {
      const ctx = await requireAiCompanyContext(req, reply);
      if (!ctx) return;
      try {
        const query = isRecord(req.query) ? req.query : {};
        const result = await listInteractiveSessions(ctx, query.limit, query.cursor);
        return { success: true, data: result.sessions, nextCursor: result.nextCursor };
      } catch (error) {
        return interactiveError(reply, error);
      }
    });

    app.get<{ Params: { id: string } }>(
      `${prefix}/interactive-sessions/:id`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        try {
          const query = isRecord(req.query) ? req.query : {};
          const result = await readInteractiveSession(
            sessionId(req.params.id),
            ctx,
            query.afterSequence
          );
          return { success: true, data: result };
        } catch (error) {
          return interactiveError(reply, error);
        }
      }
    );

    app.get<{ Params: { id: string } }>(
      `${prefix}/interactive-sessions/:id/approval`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        try {
          const result = await readPendingInteractiveApproval(sessionId(req.params.id), ctx);
          return { success: true, data: {
            approvalId: result.approval.id,
            fingerprint: result.approval.fingerprint,
            capability: result.approval.capability,
            expiresAt: result.approval.expiresAt,
            sessionId: result.session.id,
            status: result.session.status,
            ownerId: result.session.ownerId,
            requestedById: result.session.requestedById,
          } };
        } catch (error) {
          return interactiveError(reply, error);
        }
      }
    );

    app.post<{ Params: { id: string } }>(
      `${prefix}/interactive-sessions/:id/commands`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        try {
          const body = isRecord(req.body) ? req.body : {};
          const payload = isRecord(body.payload) ? body.payload : {};
          const result = await submitInteractiveCommand(sessionId(req.params.id), ctx, {
            idempotencyKey: body.idempotencyKey as string,
            type: commandType(body.type),
            payload,
          });
          return { success: true, data: result };
        } catch (error) {
          return interactiveError(reply, error);
        }
      }
    );

    app.get<{ Params: { id: string } }>(
      `${prefix}/interactive-sessions/:id/events`,
      async (req, reply) => {
        const ctx = await requireAiCompanyContext(req, reply);
        if (!ctx) return;
        try {
          const query = isRecord(req.query) ? req.query : {};
          const result = await readInteractiveSession(
            sessionId(req.params.id),
            ctx,
            query.afterSequence
          );
          reply.header('Content-Type', 'text/event-stream');
          reply.header('Cache-Control', 'private, no-store');
          reply.header('X-Accel-Buffering', 'no');
          const envelope = {
            snapshot: result.snapshot,
            replay: result.events,
            events: result.events,
            nextSequence: result.nextSequence,
            gap: result.gap,
            retryAfterMs: result.retryAfterMs,
          };
          return reply.send(
            `retry: ${result.retryAfterMs}\nevent: interactive_snapshot\ndata: ${JSON.stringify(envelope)}\n\n`
          );
        } catch (error) {
          return interactiveError(reply, error);
        }
      }
    );
  }
};

function interactiveError(reply: AddonHttpReply, error: unknown) {
  if (error instanceof InteractiveSessionError) {
    return reply
      .code(error.statusCode)
      .send({ success: false, error: error.message, code: error.code });
  }
  throw error;
}
