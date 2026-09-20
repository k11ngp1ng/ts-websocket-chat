import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { createChatServer } from '../src/app.ts';
import type { ServerEvent } from '../src/types/protocol.ts';

describe('room chat', () => {
  let app: ReturnType<typeof createChatServer>;
  let url: string;
  const queuedEvents = new WeakMap<WebSocket, ServerEvent[]>();
  const waitingReceivers = new WeakMap<
    WebSocket,
    Array<(event: ServerEvent) => void>
  >();
  beforeEach(async () => {
    app = createChatServer();
    app.http.listen(0, '127.0.0.1');
    await once(app.http, 'listening');
    url = `ws://127.0.0.1:${(app.http.address() as AddressInfo).port}/ws`;
  });
  afterEach(async () => {
    await app.close();
  });

  function watch(socket: WebSocket) {
    queuedEvents.set(socket, []);
    waitingReceivers.set(socket, []);
    socket.on('message', (data: RawData) => {
      const event = JSON.parse(data.toString()) as ServerEvent;
      const receiver = waitingReceivers.get(socket)!.shift();
      if (receiver) receiver(event);
      else queuedEvents.get(socket)!.push(event);
    });
  }
  async function receive(socket: WebSocket): Promise<ServerEvent> {
    const queued = queuedEvents.get(socket)!;
    const event = queued.shift();
    if (event) return event;
    return new Promise((resolve) =>
      waitingReceivers.get(socket)!.push(resolve),
    );
  }
  async function request(socket: WebSocket, type: string, payload: unknown) {
    const response = receive(socket);
    socket.send(JSON.stringify({ type, payload }));
    return response;
  }
  async function connect(username?: string) {
    const socket = new WebSocket(url);
    watch(socket);
    const welcome = await receive(socket);
    if (welcome.type !== 'welcome') throw new Error('Missing welcome');
    if (username)
      expect(await request(socket, 'set_username', { username })).toMatchObject(
        { type: 'identified' },
      );
    return { socket, id: welcome.payload.connectionId };
  }
  async function join(socket: WebSocket, roomId = 'developers') {
    expect(await request(socket, 'join_room', { roomId })).toEqual({
      type: 'room_joined',
      payload: { roomId },
    });
    expect(await receive(socket)).toMatchObject({
      type: 'presence_snapshot',
      payload: { roomId, users: expect.any(Array) },
    });
  }
  function record(socket: WebSocket) {
    const events: ServerEvent[] = [];
    socket.on('message', (data: RawData) =>
      events.push(JSON.parse(data.toString()) as ServerEvent),
    );
    return events;
  }
  async function fence(socket: WebSocket) {
    // Server replies are ordered on this socket: all earlier broadcasts precede this echo.
    expect(await request(socket, 'echo', { message: 'fence' })).toEqual({
      type: 'echo',
      payload: { message: 'fence' },
    });
  }

  it('broadcasts once to each member, including sender, and isolates unrelated rooms', async () => {
    const a = await connect('Nathan');
    const b = await connect('Grace');
    const c = await connect('Linus');
    await join(a.socket);
    const aSeesGrace = receive(a.socket);
    await join(b.socket);
    expect(await aSeesGrace).toMatchObject({
      type: 'user_joined',
      payload: { roomId: 'developers', user: { connectionId: b.id } },
    });
    await join(b.socket);
    await join(c.socket, 'random');
    const bEvents = record(b.socket);
    const cEvents = record(c.socket);
    const received = receive(b.socket);
    const sent = await request(a.socket, 'chat_message', {
      roomId: 'developers',
      message: 'Hello',
      user: { username: 'Imposter' },
      id: 'fake',
      timestamp: 'fake',
    });
    expect(sent).toMatchObject({
      type: 'chat_message',
      payload: {
        id: expect.any(String),
        roomId: 'developers',
        message: 'Hello',
        user: { connectionId: a.id, username: 'Nathan' },
        timestamp: expect.any(String),
      },
    });
    expect(await received).toEqual(sent);
    if (sent.type !== 'chat_message') throw new Error('Missing chat');
    expect(sent.payload.id).not.toBe('fake');
    expect(Number.isNaN(Date.parse(sent.payload.timestamp))).toBe(false);
    await fence(b.socket);
    await fence(c.socket);
    expect(bEvents.filter((e) => e.type === 'chat_message')).toHaveLength(1);
    expect(cEvents.filter((e) => e.type === 'chat_message')).toHaveLength(0);
  });

  it('requires a username and membership and rejects unavailable rooms', async () => {
    const { socket } = await connect();
    expect(
      await request(socket, 'join_room', { roomId: 'general' }),
    ).toMatchObject({ payload: { code: 'USERNAME_REQUIRED' } });
    await request(socket, 'set_username', { username: 'Nathan' });
    expect(
      await request(socket, 'join_room', { roomId: 'missing' }),
    ).toMatchObject({ payload: { code: 'INVALID_ROOM' } });
    expect(
      await request(socket, 'chat_message', {
        roomId: 'general',
        message: 'Hello',
      }),
    ).toMatchObject({ payload: { code: 'NOT_IN_ROOM' } });
  });

  it('prevents case-insensitive duplicate names and allows retry after rejection', async () => {
    await connect('Nathan');
    const b = await connect();
    expect(
      await request(b.socket, 'set_username', { username: 'nATHAN' }),
    ).toMatchObject({ payload: { code: 'USERNAME_TAKEN' } });
    expect(
      await request(b.socket, 'set_username', { username: 'Grace' }),
    ).toMatchObject({ type: 'identified' });
    expect(
      await request(b.socket, 'set_username', { username: 'Grace' }),
    ).toMatchObject({ type: 'identified' });
    expect(
      await request(b.socket, 'set_username', { username: 'Other' }),
    ).toMatchObject({ payload: { code: 'ALREADY_IDENTIFIED' } });
  });

  it('supports multiple rooms and stops delivery after an idempotent leave', async () => {
    const a = await connect('Nathan');
    const b = await connect('Grace');
    await join(a.socket);
    await join(a.socket, 'general');
    const aSeesGraceInDevelopers = receive(a.socket);
    await join(b.socket);
    expect(await aSeesGraceInDevelopers).toMatchObject({ type: 'user_joined' });
    const aSeesGraceInGeneral = receive(a.socket);
    await join(b.socket, 'general');
    expect(await aSeesGraceInGeneral).toMatchObject({ type: 'user_joined' });
    const aSeesGraceLeave = receive(a.socket);
    await request(b.socket, 'leave_room', { roomId: 'developers' });
    expect(await aSeesGraceLeave).toMatchObject({ type: 'user_left' });
    await request(b.socket, 'leave_room', { roomId: 'developers' });
    const events = record(b.socket);
    await request(a.socket, 'chat_message', {
      roomId: 'developers',
      message: 'private to members',
    });
    await fence(b.socket);
    expect(events.filter((e) => e.type === 'chat_message')).toHaveLength(0);
    const incoming = receive(b.socket);
    await request(a.socket, 'chat_message', {
      roomId: 'general',
      message: 'still joined',
    });
    expect(await incoming).toMatchObject({
      type: 'chat_message',
      payload: { roomId: 'general' },
    });
    expect(
      await request(b.socket, 'chat_message', {
        roomId: 'developers',
        message: 'not allowed',
      }),
    ).toMatchObject({ payload: { code: 'NOT_IN_ROOM' } });
  });

  it.each(['normal', 'abnormal'])(
    'cleans memberships and frees username after %s disconnect',
    async (kind) => {
      const a = await connect('Nathan');
      await join(a.socket);
      await join(a.socket, 'general');
      const serverSocket = app.connections.get(a.id)!.socket;
      const closed = once(serverSocket, 'close');
      if (kind === 'normal') a.socket.close(1000);
      else a.socket.terminate();
      await closed;
      expect(app.connections.get(a.id)).toBeUndefined();
      expect(app.rooms.has('developers', a.id)).toBe(false);
      expect(app.rooms.has('general', a.id)).toBe(false);
      const fresh = await connect('nathan');
      expect(
        await request(fresh.socket, 'chat_message', {
          roomId: 'general',
          message: 'new session',
        }),
      ).toMatchObject({ payload: { code: 'NOT_IN_ROOM' } });
    },
  );

  it('sends a room snapshot and room-scoped join/leave presence updates', async () => {
    const a = await connect('Nathan');
    const b = await connect('Grace');
    const c = await connect('Linus');
    await join(a.socket, 'developers');
    const aSeesGrace = receive(a.socket);
    await join(b.socket, 'developers');
    expect(await aSeesGrace).toEqual({
      type: 'user_joined',
      payload: {
        roomId: 'developers',
        user: { connectionId: b.id, username: 'Grace' },
      },
    });
    await join(c.socket, 'random');
    await fence(a.socket);
    const aSeesGraceLeave = receive(a.socket);
    expect(
      await request(b.socket, 'leave_room', { roomId: 'developers' }),
    ).toEqual({
      type: 'room_left',
      payload: { roomId: 'developers' },
    });
    expect(await aSeesGraceLeave).toEqual({
      type: 'user_left',
      payload: {
        roomId: 'developers',
        user: { connectionId: b.id, username: 'Grace' },
      },
    });
  });

  it('notifies remaining room members when a connection drops', async () => {
    const a = await connect('Nathan');
    const b = await connect('Grace');
    await join(a.socket, 'general');
    const aSeesGrace = receive(a.socket);
    await join(b.socket, 'general');
    await aSeesGrace;
    const aSeesDeparture = receive(a.socket);
    b.socket.terminate();
    expect(await aSeesDeparture).toEqual({
      type: 'user_left',
      payload: {
        roomId: 'general',
        user: { connectionId: b.id, username: 'Grace' },
      },
    });
  });

  it.each([
    ['set_username', { username: 'ab' }],
    ['set_username', { username: 'a'.repeat(21) }],
    ['set_username', { username: '<script>' }],
    ['set_username', { username: 42 }],
    ['join_room', { roomId: '../secret' }],
    ['join_room', {}],
    ['leave_room', null],
    ['chat_message', { roomId: 'general', message: '' }],
    ['chat_message', { roomId: 'general', message: ' '.repeat(4) }],
    ['chat_message', { roomId: 'general', message: 'a'.repeat(1001) }],
  ])('rejects malformed %s payload %j', async (type, payload) => {
    const { socket } = await connect();
    expect(await request(socket, type as string, payload)).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE' },
    });
    await fence(socket);
  });

  it.each(['send', 'leave', 'disconnect', 'stop'])(
    'scopes typing to peers and clears it on %s',
    async (action) => {
      const a = await connect('Nathan');
      const b = await connect('Grace');
      const c = await connect('Linus');
      await join(a.socket);
      const arrival = receive(a.socket);
      await join(b.socket);
      await arrival;
      await join(c.socket, 'random');
      a.socket.send(
        JSON.stringify({
          type: 'typing_start',
          payload: { roomId: 'developers', user: { username: 'Fake' } },
        }),
      );
      expect(await receive(b.socket)).toEqual({
        type: 'typing_start',
        payload: {
          roomId: 'developers',
          user: { connectionId: a.id, username: 'Nathan' },
        },
      });
      a.socket.send(
        JSON.stringify({
          type: 'typing_start',
          payload: { roomId: 'developers' },
        }),
      );
      await fence(a.socket);
      await fence(b.socket);
      await fence(c.socket);
      if (action === 'disconnect') a.socket.terminate();
      else if (action === 'send')
        await request(a.socket, 'chat_message', {
          roomId: 'developers',
          message: 'done',
        });
      else if (action === 'leave')
        await request(a.socket, 'leave_room', { roomId: 'developers' });
      else
        a.socket.send(
          JSON.stringify({
            type: 'typing_stop',
            payload: { roomId: 'developers' },
          }),
        );
      expect(await receive(b.socket)).toMatchObject({
        type: 'typing_stop',
        payload: { user: { connectionId: a.id } },
      });
    },
  );

  it('rejects typing before identification, outside membership, and in invalid rooms', async () => {
    const { socket } = await connect();
    expect(
      await request(socket, 'typing_start', { roomId: 'general' }),
    ).toMatchObject({ payload: { code: 'USERNAME_REQUIRED' } });
    await request(socket, 'set_username', { username: 'Nathan' });
    expect(
      await request(socket, 'typing_start', { roomId: 'general' }),
    ).toMatchObject({ payload: { code: 'NOT_IN_ROOM' } });
    expect(
      await request(socket, 'typing_stop', { roomId: 'unknown' }),
    ).toMatchObject({ payload: { code: 'INVALID_ROOM' } });
    expect(await request(socket, 'typing_start', { roomId: 5 })).toMatchObject({
      payload: { code: 'INVALID_MESSAGE' },
    });
  });

  it('serves the browser demo and only explicitly allowed assets', async () => {
    const base = url.replace('ws:', 'http:').replace('/ws', '');
    for (const [path, contentType] of [
      ['/', 'text/html'],
      ['/app.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
    ]) {
      const response = await fetch(base + path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(contentType);
      expect(response.headers.get('content-security-policy')).toContain(
        "default-src 'self'",
      );
      expect((await response.text()).length).toBeGreaterThan(0);
    }
    expect((await fetch(base + '/package.json')).status).toBe(404);
    expect((await fetch(base + '/src/server.ts')).status).toBe(404);
  });
});
