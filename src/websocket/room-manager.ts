import { ROOM_IDS, type RoomId } from '../types/protocol.ts';

export class RoomManager {
  private readonly rooms = new Map<RoomId, Set<string>>(
    ROOM_IDS.map((id) => [id, new Set<string>()]),
  );
  members(roomId: RoomId): ReadonlySet<string> {
    return this.rooms.get(roomId)!;
  }
  join(roomId: RoomId, connectionId: string) {
    const members = this.rooms.get(roomId)!;
    if (members.has(connectionId)) return false;
    members.add(connectionId);
    return true;
  }
  leave(roomId: RoomId, connectionId: string) {
    return this.rooms.get(roomId)!.delete(connectionId);
  }
  has(roomId: RoomId, connectionId: string) {
    return this.members(roomId).has(connectionId);
  }
  remove(connectionId: string): RoomId[] {
    // Three fixed rooms make a scan simpler than maintaining a second membership index.
    const leftRooms: RoomId[] = [];
    for (const [roomId, members] of this.rooms) {
      if (members.delete(connectionId)) leftRooms.push(roomId);
    }
    return leftRooms;
  }
}
