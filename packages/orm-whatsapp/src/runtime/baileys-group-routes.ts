import type { BaileysGatewayManager } from './baileys-client.js';
import { parseJsonBody, requireDeviceId, type GatewayRequestOptions } from './gateway-helpers.js';

export async function handleGroupRoute(
  manager: BaileysGatewayManager,
  method: string,
  url: URL,
  options: GatewayRequestOptions
): Promise<unknown> {
  const p = url.pathname;
  if (method === 'POST' && p === '/group') {
    const payload = parseJsonBody(options.body);
    const rawList = Array.isArray(payload.participants) ? payload.participants : [];
    const list = rawList.filter((e): e is string => typeof e === 'string');
    const gid = await manager.createGroup(
      requireDeviceId(options),
      String(payload.title ?? ''),
      list
    );
    return { group_id: gid };
  }
  if (method === 'GET' && p === '/group/info') {
    const gid = url.searchParams.get('group_id') ?? '';
    const m = await manager.getGroupMetadata(requireDeviceId(options), gid);
    return {
      group_id: m.id ?? gid,
      name: m.subject ?? '',
      topic: m.desc ?? null,
      participant_count: m.size ?? m.participants?.length ?? 0,
      is_locked: typeof m.restrict === 'boolean' ? m.restrict : null,
      is_announce: typeof m.announce === 'boolean' ? m.announce : null,
      is_ephemeral: typeof m.ephemeralDuration === 'number' ? m.ephemeralDuration > 0 : null,
    };
  }
  if (method === 'GET' && p === '/group/participants') {
    const gid = url.searchParams.get('group_id') ?? '';
    const m = await manager.getGroupMetadata(requireDeviceId(options), gid);
    return {
      group_id: m.id ?? gid,
      name: m.subject,
      participants: (m.participants ?? []).map((pt) => ({
        jid: pt.id,
        phone_number: pt.phoneNumber ?? (pt.id.endsWith('@s.whatsapp.net') ? pt.id : null),
        display_name: null,
        is_admin: pt.admin === 'admin' || pt.admin === 'superadmin',
        is_super_admin: pt.admin === 'superadmin',
      })),
    };
  }
  return handleGroupMutationRoute(manager, method, url, options);
}

async function handleGroupMutationRoute(
  manager: BaileysGatewayManager,
  method: string,
  url: URL,
  options: GatewayRequestOptions
): Promise<unknown> {
  const p = url.pathname;
  const partMatch = p.match(/^\/group\/participants(?:\/(remove|promote|demote))?$/u);
  if (method === 'POST' && partMatch) {
    const payload = parseJsonBody(options.body);
    const rawList = Array.isArray(payload.participants) ? payload.participants : [];
    const list = rawList.filter((e): e is string => typeof e === 'string');
    const act = (partMatch[1] ?? 'add') as 'add' | 'remove' | 'promote' | 'demote';
    return manager.updateGroupParticipants(
      requireDeviceId(options),
      String(payload.group_id ?? ''),
      list,
      act
    );
  }
  if (method === 'POST' && (p === '/group/locked' || p === '/group/announce')) {
    const setting = p === '/group/locked' ? 'locked' : 'announce';
    const payload = parseJsonBody(options.body);
    await manager.updateGroupSetting(
      requireDeviceId(options),
      String(payload.group_id ?? ''),
      setting,
      payload[setting] === true
    );
    return { ok: true };
  }
  if (method === 'GET' && p === '/group/invite-link') {
    const gid = url.searchParams.get('group_id') ?? '';
    const reset = url.searchParams.get('reset') === 'true';
    const link = await manager.getGroupInviteLink(requireDeviceId(options), gid, reset);
    return { invite_link: link };
  }
  if (method === 'GET' && p === '/group/info-from-link') {
    const link = url.searchParams.get('link') ?? '';
    const m = await manager.getGroupInfoFromLink(requireDeviceId(options), link);
    const count = m.size ?? m.participants?.length ?? 0;
    return {
      group_id: m.id ?? '',
      name: m.subject ?? '',
      topic: m.desc ?? null,
      participant_count: count,
    };
  }
  if (method === 'POST' && p === '/group/join-with-link') {
    const payload = parseJsonBody(options.body);
    const groupId = await manager.joinGroupWithLink(
      requireDeviceId(options),
      String(payload.link ?? '')
    );
    return { group_id: groupId };
  }
  if (method === 'POST' && p === '/group/leave') {
    const payload = parseJsonBody(options.body);
    await manager.leaveGroup(requireDeviceId(options), String(payload.group_id ?? ''));
    return { left: true };
  }
  return undefined;
}
