import { ROOM_IDS, type RoomId } from '../types/protocol.ts';

export class RoomManager {
  private readonly rooms = new Map<RoomId, Set<string>>(
    ROOM_IDS.map((id) => [id, new Set<string>()]),
  );
  members(roomId: RoomId): ReadonlySet<string> {
    return this.rooms.get(roomId)!;
  }
  join(roomId: RoomId, connectionId: string) {
    this.rooms.get(roomId)!.add(connectionId);
  }
  leave(roomId: RoomId, connectionId: string) {
    this.rooms.get(roomId)!.delete(connectionId);
  }
  has(roomId: RoomId, connectionId: string) {
    return this.members(roomId).has(connectionId);
  }
  remove(connectionId: string) {
    // Three fixed rooms make a scan simpler than maintaining a second membership index.
    for (const members of this.rooms.values()) members.delete(connectionId);
  }
}
