# Milestone 1: how the connection works

## 1. Establish a connection

The client opens TCP to the server. For `wss://`, TLS is established too. Our local `ws://` demo is unencrypted.

The conventional HTTP/1.1 WebSocket handshake begins as an HTTP GET to `/ws`, with `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Version: 13`, and a randomly generated `Sec-WebSocket-Key`.

Node emits an HTTP `upgrade` event. The `ws` library validates the handshake and requested path, computes `Sec-WebSocket-Accept` from the client key plus the protocol GUID using SHA-1 and Base64, and responds `101 Switching Protocols`. That exchange confirms protocol agreement; it does not authenticate a user or encrypt traffic.

We attach `WebSocketServer` to an explicit Node HTTP server so the boundary is visible. A standalone `WebSocketServer({ port })` would also work, but hides its internal HTTP server. Socket.IO adds useful higher-level facilities, but would obscure some of the protocol details this project is meant to teach.

## 2. Reuse the connection

After Upgrade, the same TCP connection carries WebSocket frames in both directions. The server can push the welcome event without waiting for an application message. One socket can carry many messages without another handshake.

This differs from HTTP request/response semantics. HTTP can also reuse TCP through keep-alive; the distinction is not that every HTTP request necessarily opens a new TCP connection. WebSocket provides a framed, full-duplex application channel after the handshake.

The client reaches `OPEN`; the server's `connection` callback runs. Every subsequent complete message triggers a `message` callback. `ws` handles framing, fragmented messages, client masking, and control frames. Our code handles application JSON only.

## 3. Validate and respond

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Node HTTP + ws
  C->>S: HTTP GET /ws + Upgrade headers
  S-->>C: 101 Switching Protocols
  S->>C: welcome event
  C->>S: echo event (JSON text frame)
  Note over S: Parse as unknown; validate at runtime
  S->>C: typed echo response
  C->>S: another echo on the same connection
  S->>C: another response
  C->>S: Close frame (1000)
  S-->>C: Close frame
```

`JSON.parse` can throw, so that specific boundary has a catch. Successfully parsed JSON is still untrusted: it might be null, an array, a number, or a malformed object. The guard narrows `unknown` into the allowed client event. A response is constructed explicitly so unrecognized fields are not reflected.

A schema library could replace the guard as the protocol grows. One diagnostic event does not justify that extra dependency yet. This echo is not a WebSocket ping frame and does not detect dead connections.

## 4. Understand concurrency

Node waits for network I/O without dedicating a JavaScript thread to each client. The event loop dispatches ready callbacks; JavaScript callbacks in this process run one at a time. While one connection is idle, other connections can be serviced.

Asynchronous does not mean all application work is parallel. Large synchronous computations or giant JSON parsing work can block every client. The input limit bounds per-message parsing size; it does not replace rate limiting. Socket writes are asynchronous and a successful send does not prove the other application processed the event.

## 5. Close and clean up

The transport states are `CONNECTING -> OPEN -> CLOSING -> CLOSED`. Messaging happens within `OPEN`, not in an extra WebSocket state. Send checks `OPEN`; socket errors are handled so an error event from one peer does not become an unhandled process exception. `ws` removes closed sockets from its client set.

SIGINT/SIGTERM initiates server shutdown. The server stops accepting connections and requests graceful closes; a one-second deadline prevents an unresponsive peer from blocking shutdown indefinitely.

A lost network can leave a half-open connection: one endpoint still believes it is connected, but cannot reach its peer. A `close` callback may arrive much later, so normal cleanup alone is insufficient. In the heartbeat milestone, the server will mark clients pending, send protocol ping frames, mark them alive on pong, and terminate clients missing a response at the next check. Browsers answer protocol pings automatically.

## Next concepts

- `Map<connectionId, user>` enables identity lookup; username uniqueness policy must be explicit.
- `Map<roomId, Set<connectionId>>` enables room-scoped broadcast and prevents duplicate membership.
- A per-connection set of rooms makes disconnect cleanup efficient. Both indexes must be updated together; redundant indexes are a consistency tradeoff.
- Presence is per live session initially, not a durable account status.
- Reconnection later uses capped exponential backoff plus jitter. Immediate loops overload an unavailable server; synchronized retries create bursts. A new connection gets new identity and explicitly rejoins rooms. Unsent chat messages should not be replayed automatically without an acknowledgement/deduplication design.

References: [ws documentation](https://github.com/websockets/ws/blob/master/README.md), [Node HTTP Upgrade](https://nodejs.org/docs/latest-v24.x/api/http.html#event-upgrade), and [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455).
