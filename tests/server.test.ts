import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { createChatServer } from '../src/app.ts';

describe('WebSocket server', () => {
  let app: ReturnType<typeof createChatServer>;
  let url: string;

  beforeEach(async () => {
    app = createChatServer();
    app.http.listen(0, '127.0.0.1');
    await once(app.http, 'listening');
    url = `ws://127.0.0.1:${(app.http.address() as AddressInfo).port}/ws`;
  });
  afterEach(async () => {
    await app.close();
  });

  async function connect() {
    const socket = new WebSocket(url);
    const welcome = await receive(socket);
    return { socket, welcome };
  }
  async function receive(socket: WebSocket): Promise<unknown> {
    const [data] = (await once(socket, 'message')) as [RawData];
    return JSON.parse(data.toString()) as unknown;
  }
  async function exchange(socket: WebSocket, data: string | Buffer) {
    const response = receive(socket);
    socket.send(data);
    return response;
  }

  it('accepts simultaneous clients and assigns distinct IDs', async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    expect(a.welcome).toEqual({
      type: 'welcome',
      payload: { connectionId: expect.any(String) },
    });
    expect(b.welcome).not.toEqual(a.welcome);
    expect(app.wss.clients.size).toBe(2);
  });

  it('exchanges multiple events on one persistent connection', async () => {
    const { socket } = await connect();
    for (const message of ['Hello', 'Still connected']) {
      const event = { type: 'echo', payload: { message } };
      expect(await exchange(socket, JSON.stringify(event))).toEqual(event);
    }
  });

  it.each([
    '{',
    'null',
    '[]',
    '{"type":"unknown"}',
    '{"type":"echo","payload":{"message":42}}',
    '{"type":"echo","payload":{"message":" "}}',
    JSON.stringify({ type: 'echo', payload: { message: 'a'.repeat(1001) } }),
  ])(
    'rejects malformed input and keeps the connection usable: %s',
    async (input) => {
      const { socket } = await connect();
      expect(await exchange(socket, input)).toMatchObject({
        type: 'error',
        payload: { code: 'INVALID_MESSAGE' },
      });
      expect(
        await exchange(socket, '{"type":"echo","payload":{"message":"ok"}}'),
      ).toMatchObject({ type: 'echo' });
    },
  );

  it('rejects binary messages', async () => {
    const { socket } = await connect();
    expect(await exchange(socket, Buffer.from('test'))).toMatchObject({
      type: 'error',
    });
  });

  it('closes an oversized sender without affecting another client', async () => {
    const bad = await connect();
    const good = await connect();
    const closed = once(bad.socket, 'close');
    bad.socket.send('x'.repeat(4097));
    expect((await closed)[0]).toBe(1009);
    expect(
      await exchange(good.socket, '{"type":"echo","payload":{"message":"ok"}}'),
    ).toMatchObject({ type: 'echo' });
  });

  it('removes a disconnected client', async () => {
    const { socket } = await connect();
    const peer = [...app.wss.clients][0]!;
    const closed = once(peer, 'close');
    socket.close(1000);
    await closed;
    expect(app.wss.clients.size).toBe(0);
  });

  it('rejects upgrades on other paths', async () => {
    const socket = new WebSocket(url.replace('/ws', '/other'));
    const [error] = (await once(socket, 'error')) as [Error];
    expect(error.message).toContain('400');
  });

  it('serves ordinary HTTP independently', async () => {
    const response = await fetch(url.replace('ws:', 'http:'));
    expect(response.status).toBe(404);
  });
});
