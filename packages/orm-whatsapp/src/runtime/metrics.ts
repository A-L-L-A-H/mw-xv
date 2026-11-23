export interface WhatsAppMetricsHooks {
  startGatewayRequest?: () => () => void;
  recordGatewayRequest?: (
    method: string,
    path: string,
    status: string,
    durationSeconds: number
  ) => void;
  recordMediaTransfer?: (direction: 'inbound' | 'outbound', bytes: number) => void;
}

let activeMetricsHooks: WhatsAppMetricsHooks = {};

export function setWhatsAppMetricsHooks(hooks: WhatsAppMetricsHooks): void {
  activeMetricsHooks = hooks;
}

export function startWhatsAppGatewayRequest(): () => void {
  return activeMetricsHooks.startGatewayRequest?.() ?? (() => undefined);
}

export function recordWhatsAppGatewayRequest(
  method: string,
  path: string,
  status: string,
  durationSeconds: number
): void {
  activeMetricsHooks.recordGatewayRequest?.(method, path, status, durationSeconds);
}

export function recordWhatsAppMediaTransfer(
  direction: 'inbound' | 'outbound',
  bytes: number
): void {
  activeMetricsHooks.recordMediaTransfer?.(direction, bytes);
}
