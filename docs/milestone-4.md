# Milestone 4: typing indicators and frontend refinement

The browser now has clearer connection status, a dedicated room member list, initials, an empty conversation state, and distinct styling for your messages. Presence stays visible on narrow screens. Text is still rendered through `textContent`; there are no new frontend dependencies.

## Ephemeral events

Clients send `typing_start` and `typing_stop`, each with `{ roomId }`. The server requires an identified user and membership in that room. It creates the outgoing user identity and sends updates only to other room members. Typing is never saved in chat history or a database.

The client sends a start immediately and renews it at most once every two seconds while input continues. After 1.2 seconds without input it sends stop. Blank input, blur, hiding the page, changing rooms, sending, leaving, and disconnecting also stop local typing.

The server keeps one five-second lease per connection and room. Repeated starts renew its timer without repeating the broadcast. A lease expires automatically if a stop is lost. Sending chat, leaving a room, or disconnecting also clears the server state; shutdown cancels all timers. Joining an already-active conversation does not replay transient typing state: the new member sees the next typing transition.

Why both sides? Client throttling avoids one network event per keystroke. Server expiration protects peers from stale UI even when a client disappears. This is not a general rate limiter, and typing expiration does not replace transport heartbeat.

## Verification

40 tests pass, including real-socket checks for room isolation, identity enforcement, duplicate suppression, and cleanup on send/leave/disconnect/stop. Fake-clock tests verify renewal, expiration, and timer disposal without waiting five real seconds. Strict types, lint, format, and build are checked. Two browser tabs verified a visible typing indicator followed by message delivery and clearing.

Direct source startup exposed a parameter-property syntax unsupported by Node's type stripping. The constructor now uses ordinary fields, and `erasableSyntaxOnly` prevents that regression during type checking.

Next: protocol ping/pong heartbeat for detecting dead connections.
