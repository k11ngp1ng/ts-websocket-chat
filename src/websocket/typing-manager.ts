import type { RoomId, ServerEvent, User } from '../types/protocol.ts';

export const TYPING_TTL_MS = 5000;
type Publish = (roomId: RoomId, event: ServerEvent, exclude: string) => void;

// Ephemeral state only: repeated starts renew the lease without another broadcast.
export class TypingManager {
  private readonly active = new Map<
    string,
    { roomId: RoomId; user: User; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly publish: Publish;
  constructor(publish: Publish) {
    this.publish = publish;
  }

  start(roomId: RoomId, user: User) {
    const key = `${roomId}:${user.connectionId}`;
    const previous = this.active.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(
      () => this.stop(roomId, user.connectionId),
      TYPING_TTL_MS,
    );
    timer.unref();
    this.active.set(key, { roomId, user, timer });
    if (!previous)
      this.publish(
        roomId,
        { type: 'typing_start', payload: { roomId, user } },
        user.connectionId,
      );
  }
  stop(roomId: RoomId, connectionId: string) {
    const key = `${roomId}:${connectionId}`;
    const state = this.active.get(key);
    if (!state) return;
    clearTimeout(state.timer);
    this.active.delete(key);
    this.publish(
      roomId,
      { type: 'typing_stop', payload: { roomId, user: state.user } },
      connectionId,
    );
  }
  remove(connectionId: string) {
    for (const state of this.active.values()) {
      if (state.user.connectionId === connectionId)
        this.stop(state.roomId, connectionId);
    }
  }
  close() {
    for (const state of this.active.values()) clearTimeout(state.timer);
    this.active.clear();
  }
}
