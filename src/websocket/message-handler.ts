import { randomUUID } from 'node:crypto';
import {
  isRoomId,
  type ClientEvent,
  type ErrorCode,
  type ServerEvent,
} from '../types/protocol.ts';
import { log } from '../utils/logger.ts';
import { ConnectionManager, type Connection } from './connection-manager.ts';
import { RoomManager } from './room-manager.ts';
import { send } from './send.ts';

function userFor(connection: Connection) {
  return { connectionId: connection.id, username: connection.username! };
}

export function broadcastToRoom(
  roomId: import('../types/protocol.ts').RoomId,
  event: ServerEvent,
  connections: ConnectionManager,
  rooms: RoomManager,
  excludedConnectionId?: string,
) {
  for (const id of rooms.members(roomId)) {
    if (id === excludedConnectionId) continue;
    const recipient = connections.get(id);
    if (recipient) send(recipient, event);
  }
}

function currentUsers(
  roomId: import('../types/protocol.ts').RoomId,
  connections: ConnectionManager,
  rooms: RoomManager,
) {
  return [...rooms.members(roomId)]
    .map((id) => connections.get(id))
    .filter((connection): connection is Connection =>
      Boolean(connection?.username),
    )
    .map(userFor)
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function reject(
  connection: Connection,
  code: ErrorCode,
  message: string,
) {
  log('invalid_message', { connectionId: connection.id, code });
  send(connection, { type: 'error', payload: { code, message } });
}
export function handleMessage(
  connection: Connection,
  event: ClientEvent,
  connections: ConnectionManager,
  rooms: RoomManager,
) {
  if (event.type === 'echo') {
    send(connection, {
      type: 'echo',
      payload: { message: event.payload.message },
    });
    return;
  }
  if (event.type === 'set_username') {
    const error = connections.identify(connection, event.payload.username);
    if (error)
      return reject(
        connection,
        error,
        error === 'USERNAME_TAKEN'
          ? 'That username is already connected.'
          : 'Disconnect before changing your username.',
      );
    send(connection, {
      type: 'identified',
      payload: { connectionId: connection.id, username: connection.username! },
    });
    return;
  }
  if (!connection.username)
    return reject(connection, 'USERNAME_REQUIRED', 'Choose a username first.');
  const { roomId } = event.payload;
  if (!isRoomId(roomId))
    return reject(
      connection,
      'INVALID_ROOM',
      'Choose general, developers, or random.',
    );
  if (event.type === 'join_room') {
    const joined = rooms.join(roomId, connection.id);
    send(connection, { type: 'room_joined', payload: { roomId } });
    send(connection, {
      type: 'presence_snapshot',
      payload: { roomId, users: currentUsers(roomId, connections, rooms) },
    });
    if (joined) {
      broadcastToRoom(
        roomId,
        { type: 'user_joined', payload: { roomId, user: userFor(connection) } },
        connections,
        rooms,
        connection.id,
      );
    }
    log('room_joined', { connectionId: connection.id, roomId });
  } else if (event.type === 'leave_room') {
    const left = rooms.leave(roomId, connection.id);
    send(connection, { type: 'room_left', payload: { roomId } });
    if (left) {
      broadcastToRoom(
        roomId,
        { type: 'user_left', payload: { roomId, user: userFor(connection) } },
        connections,
        rooms,
      );
    }
    log('room_left', { connectionId: connection.id, roomId });
  } else {
    if (!rooms.has(roomId, connection.id))
      return reject(
        connection,
        'NOT_IN_ROOM',
        'Join the room before sending a message.',
      );
    const outgoing: ServerEvent = {
      type: 'chat_message',
      payload: {
        id: randomUUID(),
        roomId,
        message: event.payload.message,
        user: { connectionId: connection.id, username: connection.username },
        timestamp: new Date().toISOString(),
      },
    };
    broadcastToRoom(roomId, outgoing, connections, rooms);
    log('message_sent', { connectionId: connection.id, roomId });
  }
}
