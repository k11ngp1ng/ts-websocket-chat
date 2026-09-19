export type ClientEvent = { type: 'echo'; payload: { message: string } };

export type ServerEvent =
  | { type: 'welcome'; payload: { connectionId: string } }
  | { type: 'echo'; payload: { message: string } }
  | { type: 'error'; payload: { code: 'INVALID_MESSAGE'; message: string } };

export function isClientEvent(value: unknown): value is ClientEvent {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || value.type !== 'echo') return false;
  if (!('payload' in value)) return false;
  const payload = value.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string' &&
    payload.message.trim().length > 0 &&
    payload.message.length <= 1000
  );
}
