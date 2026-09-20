import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { isClientEvent, ROOM_IDS } from './types/protocol.ts';
import { log } from './utils/logger.ts';
import { ConnectionManager } from './websocket/connection-manager.ts';
import { RoomManager } from './websocket/room-manager.ts';
import {
  broadcastToRoom,
  handleMessage,
  reject,
} from './websocket/message-handler.ts';
import { send } from './websocket/send.ts';

const assets = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

export function createChatServer() {
  const connections = new ConnectionManager();
  const rooms = new RoomManager();
  const http = createServer((request, response) => {
    const asset = assets.get((request.url ?? '').split('?')[0]!);
    if (!asset || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    void readFile(new URL(`../public/${asset.file}`, import.meta.url))
      .then((content) => {
        response.writeHead(200, {
          'Content-Type': asset.type,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      })
      .catch((error: unknown) => {
        log('server_error', {
          message: error instanceof Error ? error.message : 'Asset read failed',
        });
        response.writeHead(500);
        response.end('Unable to load application');
      });
  });
  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  wss.on('error', (error) => log('server_error', { message: error.message }));
  wss.on('connection', (socket) => {
    const connectionId = randomUUID();
    const connection = connections.add(connectionId, socket);
    socket.on('error', (error) =>
      log('client_error', { connectionId, message: error.message }),
    );
    socket.on('close', (code) => {
      const leftRooms = rooms.remove(connectionId);
      if (connection.username) {
        const user = { connectionId, username: connection.username };
        for (const roomId of leftRooms) {
          broadcastToRoom(
            roomId,
            { type: 'user_left', payload: { roomId, user } },
            connections,
            rooms,
          );
        }
      }
      connections.remove(connectionId);
      log('client_disconnected', { connectionId, code });
    });
    socket.on('message', (data, isBinary) => {
      const invalid = () =>
        reject(
          connection,
          'INVALID_MESSAGE',
          'Invalid event or payload. Check the message protocol.',
        );
      if (isBinary) return invalid();
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return invalid();
      }
      if (!isClientEvent(value)) return invalid();
      handleMessage(connection, value, connections, rooms);
    });
    log('client_connected', { connectionId });
    send(connection, {
      type: 'welcome',
      payload: { connectionId, rooms: ROOM_IDS },
    });
  });

  async function close(): Promise<void> {
    const deadline = setTimeout(() => {
      for (const socket of wss.clients) socket.terminate();
    }, 1000);
    deadline.unref();
    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          wss.close((error) => (error ? reject(error) : resolve()));
          for (const socket of wss.clients)
            socket.close(1001, 'Server shutting down');
        }),
        new Promise<void>((resolve, reject) => {
          http.close((error) => (error ? reject(error) : resolve()));
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
  return { http, wss, connections, rooms, close };
}
