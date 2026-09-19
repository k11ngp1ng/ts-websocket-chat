import type { WebSocket } from 'ws';
import type { ErrorCode } from '../types/protocol.ts';

export type Connection = { id: string; socket: WebSocket; username?: string };

export class ConnectionManager {
  private readonly connections = new Map<string, Connection>();
  private readonly usernames = new Map<string, string>();
  add(id: string, socket: WebSocket): Connection {
    const connection = { id, socket };
    this.connections.set(id, connection);
    return connection;
  }
  get(id: string) {
    return this.connections.get(id);
  }
  identify(connection: Connection, username: string): ErrorCode | undefined {
    if (connection.username === username) return;
    if (connection.username) return 'ALREADY_IDENTIFIED';
    const key = username.toLowerCase();
    if (this.usernames.has(key)) return 'USERNAME_TAKEN';
    connection.username = username;
    this.usernames.set(key, connection.id);
  }
  remove(id: string) {
    const connection = this.connections.get(id);
    if (connection?.username)
      this.usernames.delete(connection.username.toLowerCase());
    this.connections.delete(id);
  }
}
