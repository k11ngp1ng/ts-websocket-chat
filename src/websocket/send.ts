import { WebSocket } from 'ws';
import type { ServerEvent } from '../types/protocol.ts';
import type { Connection } from './connection-manager.ts';
import { log } from '../utils/logger.ts';

export function send(connection: Connection, event: ServerEvent) {
  const { socket, id: connectionId } = connection;
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 64 * 1024) {
    log('slow_client', { connectionId });
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(event), (error) => {
    if (!error) return;
    log('send_error', { connectionId, message: error.message });
    socket.terminate();
  });
}
