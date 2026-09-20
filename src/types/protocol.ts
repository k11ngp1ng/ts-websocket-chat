export const ROOM_IDS = ['general', 'developers', 'random'] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export type User = { connectionId: string; username: string };

export type ClientEvent =
  | { type: 'echo'; payload: { message: string } }
  | { type: 'set_username'; payload: { username: string } }
  | { type: 'join_room'; payload: { roomId: string } }
  | { type: 'leave_room'; payload: { roomId: string } }
  | { type: 'typing_start'; payload: { roomId: string } }
  | { type: 'typing_stop'; payload: { roomId: string } }
  | { type: 'chat_message'; payload: { roomId: string; message: string } };

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'USERNAME_TAKEN'
  | 'ALREADY_IDENTIFIED'
  | 'USERNAME_REQUIRED'
  | 'INVALID_ROOM'
  | 'NOT_IN_ROOM';

export type ServerEvent =
  | {
      type: 'welcome';
      payload: { connectionId: string; rooms: readonly RoomId[] };
    }
  | { type: 'echo'; payload: { message: string } }
  | { type: 'identified'; payload: User }
  | { type: 'room_joined' | 'room_left'; payload: { roomId: RoomId } }
  | { type: 'presence_snapshot'; payload: { roomId: RoomId; users: User[] } }
  | {
      type: 'user_joined' | 'user_left' | 'typing_start' | 'typing_stop';
      payload: { roomId: RoomId; user: User };
    }
  | {
      type: 'chat_message';
      payload: {
        id: string;
        roomId: RoomId;
        user: User;
        message: string;
        timestamp: string;
      };
    }
  | { type: 'error'; payload: { code: ErrorCode; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validMessage(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 1000
  );
}
export function isRoomId(value: string): value is RoomId {
  return ROOM_IDS.some((room) => room === value);
}
export function isClientEvent(value: unknown): value is ClientEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  const { type, payload } = value;
  const validRoom =
    typeof payload.roomId === 'string' &&
    /^[a-z][a-z0-9-]{0,31}$/.test(payload.roomId);
  switch (type) {
    case 'echo':
      return validMessage(payload.message);
    case 'set_username':
      return (
        typeof payload.username === 'string' &&
        /^[A-Za-z0-9_]{3,20}$/.test(payload.username)
      );
    case 'join_room':
    case 'leave_room':
    case 'typing_start':
    case 'typing_stop':
      return validRoom;
    case 'chat_message':
      return validRoom && validMessage(payload.message);
    default:
      return false;
  }
}
