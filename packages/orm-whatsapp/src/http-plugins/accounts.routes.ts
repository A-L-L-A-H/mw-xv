import type { FastifyInstance } from 'fastify';
import { WhatsappAccount } from '../models.js';
import { GowaError } from '../runtime/gowa-client.js';
import {
  whatsappGatewayBinary,
  whatsappGatewayOriginPath,
  whatsappGatewayRequest,
} from '../runtime/gateway.js';
import {
  recordWhatsAppAudit,
  requireCompany,
  requireWhatsAppAction,
  supportsDirectUploads,
  whatsappPermissions,
  whatsappRateLimit,
} from '../runtime/route-helpers.js';
import type { WhatsappRouteOptions } from '../runtime/route-helpers.js';

export function registerWhatsAppAccountRoutes(
  app: FastifyInstance,
  options: WhatsappRouteOptions
): void {
  app.get('/whatsapp/account', async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    const account = await WhatsappAccount.query().findOne({ company_id: companyId });
    if (!account)
      return {
        success: true,
        data: {
          status: 'disconnected',
          phone_number: null,
          qr_code: null,
          direct_uploads: supportsDirectUploads(options.attachmentStorage),
          webhook_configured: Boolean(
            process.env.WHATSAPP_WEBHOOK_URL && process.env.WHATSAPP_WEBHOOK_SECRET
          ),
          permissions: whatsappPermissions(req.auth!),
        },
      };
    let status: typeof account.status;
    let phoneNumber = account.phone_number;
    let lastError = account.last_error;
    let qrCode: string | null = null;
    let accountReadStep = 'device_status';
    // Account status is also changed by the connect flow. Avoid letting a slow
    // provider status lookup overwrite a newer QR/connection state.
    const patchIfUnchanged = async (values: Record<string, unknown>) => {
      const query = WhatsappAccount.query().where({
        id: account.id,
        company_id: companyId,
        status: account.status,
      });
      if (account.gateway_device_id === null || account.gateway_device_id === undefined)
        query.whereNull('gateway_device_id');
      else query.where('gateway_device_id', account.gateway_device_id);
      if (account.qr_code === null || account.qr_code === undefined) query.whereNull('qr_code');
      else query.where('qr_code', account.qr_code);
      if (account.phone_number === null || account.phone_number === undefined)
        query.whereNull('phone_number');
      else query.where('phone_number', account.phone_number);
      await query.patch({ ...values, write_date: new Date().toISOString() });
    };
    if (!account.gateway_device_id) {
      status = 'disconnected';
      phoneNumber = null;
      lastError =
        account.status === 'disconnected'
          ? account.last_error
          : 'WhatsApp device mapping is missing. Connect again.';
      await patchIfUnchanged({ status, phone_number: null, qr_code: null, last_error: lastError });
    } else {
      try {
        const upstream = await whatsappGatewayRequest<{
          status?: string;
          is_connected?: boolean;
          is_logged_in?: boolean;
          jid?: string;
          qr_link?: string;
        }>(`/devices/${encodeURIComponent(account.gateway_device_id)}/status`);
        status =
          upstream.is_connected && upstream.is_logged_in
            ? 'connected'
            : upstream.is_logged_in
              ? 'reconnecting'
              : upstream.status === 'connecting' && account.status === 'connecting'
                ? 'connecting'
                : 'disconnected';
        phoneNumber =
          upstream.jid?.split('@')[0]?.split(':')[0] ??
          (upstream.is_logged_in ? phoneNumber : null);
        if (status === 'connected') {
          lastError = null;
          await patchIfUnchanged({
            status,
            phone_number: phoneNumber,
            qr_code: null,
            last_error: null,
          });
        } else if (account.qr_code || typeof upstream.qr_link === 'string') {
          const qrPath = account.qr_code ?? whatsappGatewayOriginPath(upstream.qr_link!);
          try {
            accountReadStep = 'qr_image';
            const image = await whatsappGatewayBinary(whatsappGatewayOriginPath(qrPath));
            qrCode = `data:${image.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`;
            status = 'qr';
            if (account.status !== 'qr' || account.qr_code !== qrPath) {
              lastError = null;
              await patchIfUnchanged({ status: 'qr', qr_code: qrPath, last_error: null });
            }
          } catch (error) {
            if (!(error instanceof GowaError && error.statusCode === 404)) throw error;
            status = 'qr_expired';
            lastError = 'QR code expired. Request a new code to continue pairing.';
            await patchIfUnchanged({ status, qr_code: null, last_error: lastError });
          }
        } else {
          const expiredQr =
            status === 'disconnected' && account.status === 'qr_expired' && !upstream.is_logged_in;
          if (expiredQr) {
            status = 'qr_expired';
            lastError = 'QR code expired. Request a new code to continue pairing.';
          } else {
            lastError = null;
          }
          await patchIfUnchanged({
            status,
            phone_number: expiredQr ? null : phoneNumber,
            qr_code: null,
            last_error: lastError,
          });
        }
      } catch (error) {
        if (!(error instanceof GowaError && error.statusCode === 404)) {
          if (
            account.status !== 'error' ||
            account.last_error !== 'WhatsApp gateway is temporarily unavailable'
          ) {
            req.log.warn(
              {
                accountReadStep,
                upstreamStatus: error instanceof GowaError ? error.statusCode : undefined,
                upstreamCode: error instanceof GowaError ? error.upstreamCode : undefined,
              },
              'WhatsApp account refresh failed'
            );
          }
          if (account.qr_code) {
            try {
              // A temporary status endpoint failure should not hide a QR that
              // GoWA can still serve for pairing.
              const image = await whatsappGatewayBinary(whatsappGatewayOriginPath(account.qr_code));
              qrCode = `data:${image.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`;
              status = 'qr';
              phoneNumber = null;
              lastError = null;
              await patchIfUnchanged({ status, phone_number: null, last_error: null });
            } catch (qrError) {
              if (qrError instanceof GowaError && qrError.statusCode === 404) {
                status = 'qr_expired';
                await patchIfUnchanged({
                  status,
                  qr_code: null,
                  last_error: 'QR code expired. Request a new code to continue pairing.',
                });
                lastError = 'QR code expired. Request a new code to continue pairing.';
              } else {
                status = 'error';
                await patchIfUnchanged({
                  status,
                  last_error: 'WhatsApp gateway is temporarily unavailable',
                });
                lastError = 'WhatsApp gateway is temporarily unavailable';
              }
            }
          } else {
            if (account.status === 'qr_expired') {
              status = 'qr_expired';
              phoneNumber = null;
              lastError = 'QR code expired. Request a new code to continue pairing.';
              await patchIfUnchanged({ status, phone_number: null, last_error: lastError });
            } else {
              status = 'error';
              await patchIfUnchanged({
                status,
                last_error: 'WhatsApp gateway is temporarily unavailable',
              });
              lastError = 'WhatsApp gateway is temporarily unavailable';
            }
          }
        } else {
          const expiredQr = account.status === 'qr_expired';
          status = expiredQr ? 'qr_expired' : 'disconnected';
          lastError = expiredQr ? 'QR code expired. Request a new code to continue pairing.' : null;
          await patchIfUnchanged({
            status,
            qr_code: null,
            phone_number: null,
            last_error: lastError,
          });
          phoneNumber = null;
        }
      }
    }
    return {
      success: true,
      data: {
        id: account.id,
        status,
        phone_number: phoneNumber,
        qr_code: qrCode,
        last_error: lastError,
        direct_uploads: supportsDirectUploads(options.attachmentStorage),
        webhook_configured: Boolean(
          process.env.WHATSAPP_WEBHOOK_URL && process.env.WHATSAPP_WEBHOOK_SECRET
        ),
        permissions: whatsappPermissions(req.auth!),
      },
    };
  });

  app.post('/whatsapp/connect', whatsappRateLimit(5), async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    if (!requireWhatsAppAction(req, reply, 'whatsapp.account', 'write')) return;
    const result = await app.db.transaction(async (trx) => {
      if (String(app.db.client.config.client).includes('pg')) {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [
          'moonwitness.whatsapp.connect',
          companyId,
        ]);
      }
      await trx('whatsapp_accounts')
        .insert({ company_id: companyId, status: 'connecting' })
        .onConflict('company_id')
        .ignore();
      const account = await WhatsappAccount.query(trx).findOne({ company_id: companyId });
      if (!account) throw new Error('WhatsApp account could not be created');
      if (account.status === 'qr' && account.qr_code && account.gateway_device_id) {
        try {
          const gatewayStatus = await whatsappGatewayRequest<{
            is_connected?: boolean;
            is_logged_in?: boolean;
            jid?: string;
          }>(`/devices/${encodeURIComponent(account.gateway_device_id ?? '')}/status`);
          if (gatewayStatus.is_connected && gatewayStatus.is_logged_in) {
            const phoneNumber =
              gatewayStatus.jid?.split('@')[0]?.split(':')[0] ?? account.phone_number;
            await WhatsappAccount.query(trx)
              .where({ id: account.id, company_id: companyId })
              .patch({
                status: 'connected',
                phone_number: phoneNumber,
                qr_code: null,
                last_error: null,
              });
            await recordWhatsAppAudit(
              req,
              'whatsapp.account',
              'connect',
              account.id,
              companyId,
              trx
            );
            return {
              statusCode: 200,
              body: {
                success: true,
                data: { id: account.id, status: 'connected', phone_number: phoneNumber },
              },
            };
          }
        } catch {
          // Keep the current QR; the status endpoint will report gateway availability separately.
        }
        await recordWhatsAppAudit(req, 'whatsapp.account', 'connect', account.id, companyId, trx);
        return {
          statusCode: 202,
          body: { success: true, data: { id: account.id, status: 'qr' } },
        };
      }
      const deviceId = account.gateway_device_id || `moonwitness-company-${companyId}`;
      await WhatsappAccount.query(trx).where({ id: account.id, company_id: companyId }).patch({
        gateway_device_id: deviceId,
        status: 'connecting',
        last_error: null,
        write_date: new Date().toISOString(),
      });
      let pairingStep = 'device_lookup';
      try {
        let createDevice = false;
        try {
          await whatsappGatewayRequest(`/devices/${encodeURIComponent(deviceId)}`);
        } catch (error) {
          if (!(error instanceof GowaError)) throw error;
          if (error.statusCode === 404) {
            createDevice = true;
          } else if (error.statusCode === 500) {
            // Some GoWA v9.6 deployments return 500 ("device not found") instead of
            // the documented 404 for a missing device. Consult the authoritative list
            // before deciding to create so an existing device is never duplicated.
            pairingStep = 'device_list';
            const listed = await whatsappGatewayRequest<
              | { device_id?: string }[]
              | { code?: string; results?: { device_id?: string }[] | null }
            >('/devices');
            const devices = Array.isArray(listed)
              ? listed
              : listed.code === 'SUCCESS' && listed.results === null
                ? []
                : Array.isArray(listed.results)
                  ? listed.results
                  : null;
            if (!devices) throw error;
            createDevice = !devices.some((device) => device.device_id === deviceId);
          } else {
            throw error;
          }
        }
        if (createDevice) {
          pairingStep = 'device_create';
          await whatsappGatewayRequest('/devices', {
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify({
              device_id: deviceId,
              display_name: `Moonwitness company ${companyId}`,
            }),
          });
        }
        const webhookOrigin = process.env.WHATSAPP_WEBHOOK_URL;
        const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
        if (Boolean(webhookOrigin) !== Boolean(webhookSecret))
          throw new Error('GoWA webhook URL and secret must be configured together');
        if (webhookOrigin && webhookSecret) {
          pairingStep = 'webhook_configure';
          const origin = new URL(webhookOrigin);
          if (
            webhookSecret.length < 32 ||
            !['http:', 'https:'].includes(origin.protocol) ||
            origin.username ||
            origin.password ||
            origin.pathname !== '/' ||
            origin.search ||
            origin.hash ||
            (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')
          )
            throw new Error('Invalid GoWA webhook configuration');
          const callback = new URL(
            `/whatsapp/gowa/webhook/${encodeURIComponent(deviceId)}`,
            origin
          );
          await whatsappGatewayRequest(`/devices/${encodeURIComponent(deviceId)}/webhook`, {
            method: 'PATCH',
            contentType: 'application/json',
            body: JSON.stringify({
              webhook_url: callback.toString(),
              webhook_secret: webhookSecret,
              webhook_events:
                'message,message.ack,message.edited,message.revoked,message.deleted,group.participants',
            }),
          });
        }
        pairingStep = 'device_status';
        const gatewayStatus = await whatsappGatewayRequest<{
          is_connected?: boolean;
          is_logged_in?: boolean;
          jid?: string;
        }>(`/devices/${encodeURIComponent(deviceId)}/status`);
        if (gatewayStatus.is_connected && gatewayStatus.is_logged_in) {
          const phoneNumber =
            gatewayStatus.jid?.split('@')[0]?.split(':')[0] ?? account.phone_number;
          await WhatsappAccount.query(trx).where({ id: account.id, company_id: companyId }).patch({
            status: 'connected',
            phone_number: phoneNumber,
            qr_code: null,
            last_error: null,
            write_date: new Date().toISOString(),
          });
          return {
            statusCode: 200,
            body: {
              success: true,
              data: { id: account.id, status: 'connected', phone_number: phoneNumber },
            },
          };
        }
        pairingStep = 'qr_login';
        const qr = await whatsappGatewayRequest<{ qr_link?: string }>(
          `/devices/${encodeURIComponent(deviceId)}/login`
        );
        pairingStep = 'qr_link_validate';
        const qrPath =
          typeof qr.qr_link === 'string' ? whatsappGatewayOriginPath(qr.qr_link) : null;
        req.log.info(
          { qrLinkReceived: typeof qr.qr_link === 'string', qrPathAccepted: Boolean(qrPath) },
          'WhatsApp pairing QR response received'
        );
        await WhatsappAccount.query(trx)
          .where({ id: account.id, company_id: companyId })
          .patch({
            status: qrPath ? 'qr' : 'connecting',
            qr_code: qrPath,
            last_error: null,
            write_date: new Date().toISOString(),
          });
        await recordWhatsAppAudit(req, 'whatsapp.account', 'connect', account.id, companyId, trx);
        return {
          statusCode: 202,
          body: { success: true, data: { id: account.id, status: qrPath ? 'qr' : 'connecting' } },
        };
      } catch (error) {
        req.log.warn(
          {
            pairingStep,
            upstreamStatus: error instanceof GowaError ? error.statusCode : undefined,
            upstreamCode: error instanceof GowaError ? error.upstreamCode : undefined,
          },
          'WhatsApp pairing failed'
        );
        await WhatsappAccount.query(trx).where({ id: account.id, company_id: companyId }).patch({
          status: 'error',
          last_error: 'WhatsApp gateway is temporarily unavailable',
        });
        await recordWhatsAppAudit(
          req,
          'whatsapp.account',
          'connect_failed',
          account.id,
          companyId,
          trx
        );
        return {
          statusCode: 502,
          body: { success: false, error: 'Could not start WhatsApp pairing' },
        };
      }
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post('/whatsapp/disconnect', whatsappRateLimit(5), async (req, reply) => {
    const companyId = requireCompany(req, reply);
    if (!companyId) return;
    if (!requireWhatsAppAction(req, reply, 'whatsapp.account', 'write')) return;
    const account = await WhatsappAccount.query().findOne({ company_id: companyId });
    if (account?.gateway_device_id) {
      try {
        await whatsappGatewayRequest(
          `/devices/${encodeURIComponent(account.gateway_device_id)}/logout`,
          {
            method: 'POST',
          }
        );
      } catch (error) {
        if (!(error instanceof GowaError && error.statusCode === 404)) throw error;
      }
    }
    await WhatsappAccount.query().where({ company_id: companyId }).patch({
      status: 'disconnected',
      qr_code: null,
      phone_number: null,
      last_error: null,
      write_date: new Date().toISOString(),
    });
    if (account)
      await recordWhatsAppAudit(req, 'whatsapp.account', 'disconnect', account.id, companyId);
    return { success: true, data: { status: 'disconnected' } };
  });
}
