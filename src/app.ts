import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isClientEvent, type ServerEvent } from './types/protocol.ts';

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({ time: new Date().toISOString(), event, ...fields }),
  );
}

export function createChatServer() {
  const http = createServer((_request, response) => {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Connect using WebSocket at /ws' }));
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
    const send = (event: ServerEvent) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(event), (error) => {
        if (error) {
          log('send_error', { connectionId, message: error.message });
          socket.terminate();
        }
      });
    };
    const reject = () => {
      log('invalid_message', { connectionId });
      send({
        type: 'error',
        payload: {
          code: 'INVALID_MESSAGE',
          message: 'Expected an echo event with 1–1000 nonblank characters.',
        },
      });
    };

    socket.on('error', (error) =>
      log('client_error', { connectionId, message: error.message }),
    );
    socket.on('close', (code) =>
      log('client_disconnected', { connectionId, code }),
    );
    socket.on('message', (data, isBinary) => {
      if (isBinary) return reject();
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return reject();
      }
      if (!isClientEvent(value)) return reject();
      send({ type: 'echo', payload: { message: value.payload.message } });
    });

    log('client_connected', { connectionId });
    send({ type: 'welcome', payload: { connectionId } });
  });

  async function close(): Promise<void> {
    // Give the close handshake time to finish, then release unresponsive peers.
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

  return { http, wss, close };
}
