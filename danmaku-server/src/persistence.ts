import DatabaseConstructor, { Database } from 'better-sqlite3';

/**
 * SQLite 持久化：让房间状态跨进程重启存活（部署/崩溃重启对用户无感）。
 *
 * 只持久化"慢变"的房间元数据与身份映射，写入频率 = 建房/删房/改密码/空房计时/新 IP，
 * 均为低频事件；弹幕消息与在线连接**不**持久化（历史本就设计为不保存，连接重启必然断开，
 * 客户端有自动重连逻辑，重连后凭这里恢复的房间/房主/密码原样回归）。
 *
 * better-sqlite3 为同步 API，每次写入是一条微事务，服务器消息处理本身是单线程同步的，
 * 无需额外排队。测试用 ':memory:' 路径（见 tests/helpers.ts）。
 */

export interface PersistedRoom {
  roomId: string;
  createdAt: number;
  password: string;
  hostUserId: string;
  emptySince: number | null;
}

export class RoomStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new DatabaseConstructor(dbPath);
    // WAL 提升并发读写下的稳健性；:memory: 下该 pragma 无效但无害
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id      TEXT PRIMARY KEY,
        created_at   INTEGER NOT NULL,
        password     TEXT NOT NULL DEFAULT '',
        host_user_id TEXT NOT NULL DEFAULT '',
        empty_since  INTEGER
      );
      CREATE TABLE IF NOT EXISTS ip_user (
        ip      TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
    `);
  }

  loadRooms(): PersistedRoom[] {
    return (this.db.prepare(
      'SELECT room_id, created_at, password, host_user_id, empty_since FROM rooms'
    ).all() as Array<Record<string, unknown>>).map((r) => ({
      roomId: r.room_id as string,
      createdAt: r.created_at as number,
      password: r.password as string,
      hostUserId: r.host_user_id as string,
      emptySince: (r.empty_since as number | null) ?? null,
    }));
  }

  loadIpUserMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of this.db.prepare('SELECT ip, user_id FROM ip_user').all() as Array<Record<string, unknown>>) {
      map.set(row.ip as string, row.user_id as string);
    }
    return map;
  }

  // 写方法统一守卫：close() 后迟到的 ws close 事件仍会触发持久化调用（进程即将退出），
  // 此时静默忽略而不是在事件回调里抛异常
  upsertRoom(room: PersistedRoom): void {
    if (!this.db.open) return;
    this.db.prepare(`
      INSERT INTO rooms (room_id, created_at, password, host_user_id, empty_since)
      VALUES (@roomId, @createdAt, @password, @hostUserId, @emptySince)
      ON CONFLICT(room_id) DO UPDATE SET
        created_at = excluded.created_at,
        password = excluded.password,
        host_user_id = excluded.host_user_id,
        empty_since = excluded.empty_since
    `).run(room);
  }

  setRoomPassword(roomId: string, password: string): void {
    if (!this.db.open) return;
    this.db.prepare('UPDATE rooms SET password = ? WHERE room_id = ?').run(password, roomId);
  }

  setRoomEmptySince(roomId: string, emptySince: number | null): void {
    if (!this.db.open) return;
    this.db.prepare('UPDATE rooms SET empty_since = ? WHERE room_id = ?').run(emptySince, roomId);
  }

  deleteRoom(roomId: string): void {
    if (!this.db.open) return;
    this.db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
  }

  upsertIpUser(ip: string, userId: string): void {
    if (!this.db.open) return;
    this.db.prepare(`
      INSERT INTO ip_user (ip, user_id) VALUES (?, ?)
      ON CONFLICT(ip) DO UPDATE SET user_id = excluded.user_id
    `).run(ip, userId);
  }

  close(): void {
    this.db.close();
  }
}
