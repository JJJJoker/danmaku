// SQLite 持久化集成测试：模拟"部署重启"——同一 dbPath 起两代服务器，
// 验证房间/密码/房主/身份映射跨重启存活，用户重连后无感回归
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DanmakuServer } from '../src/app';
import { startServer, connect, join, fetchStats, TestClient } from './helpers';

let tmpDir: string;
let dbPath: string;
let server: DanmakuServer | null;
let clients: TestClient[];

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'danmaku-db-'));
  dbPath = path.join(tmpDir, 'danmaku.db');
  server = null;
  clients = [];
});

afterEach(async () => {
  clients.forEach((c) => c.close());
  if (server) await server.close();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function boot(): Promise<DanmakuServer> {
  server = await startServer({ dbPath });
  return server;
}

/** 模拟部署：关掉当前服务器，同一 dbPath 起新一代 */
async function restart(): Promise<DanmakuServer> {
  clients.forEach((c) => c.close());
  clients = [];
  await server!.close();
  return boot();
}

async function client(testIp: string): Promise<TestClient> {
  const c = await connect(server!.getWsPort(), { testIp });
  clients.push(c);
  return c;
}

describe('SQLite 持久化（部署重启无感）', () => {
  it('房间与密码跨重启保留，房主重连后免密回归', async () => {
    await boot();
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'secret', userId: 'alice' } });
    await a.next('success');

    await restart();

    const stats = await fetchStats(server!.getHttpPort());
    expect(stats.totalRooms).toBe(1);
    expect(stats.rooms[0]).toMatchObject({ roomId: 'room1', hasPassword: true });
    expect(stats.hostRooms).toEqual({ alice: { roomCount: 1, rooms: ['room1'] } });

    // 房主重连（同 IP）免密回归，拿回密码与房主身份
    const a2 = await client('10.0.0.1');
    const res = await join(a2, 'room1', { userId: 'alice' });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload).toMatchObject({ userId: 'alice', isHost: true, password: 'secret' });
  });

  it('非房主重启后加入仍需密码', async () => {
    await boot();
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'secret', userId: 'alice' } });
    await a.next('success');

    await restart();

    const b = await client('10.0.0.2');
    const denied = await join(b, 'room1', { userId: 'bob' });
    expect(denied.type).toBe('joinError');
    expect(denied.payload.reason).toBe('wrongPassword');
    const granted = await join(b, 'room1', { userId: 'bob', password: 'secret' });
    expect(granted.type).toBe('joinSuccess');
  });

  it('IP→userId 身份映射跨重启保留（同 IP 重连拿回同一身份）', async () => {
    await boot();
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    await restart();

    const a2 = await client('10.0.0.1');
    const res = await join(a2, 'room2', { userId: '想换个新ID' });
    expect(res.payload.userId).toBe('alice'); // 提供的新 ID 被忽略，沿用持久化身份
  });

  it('重启后空房间按 24h 规则继续计时清扫', async () => {
    await boot();
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    await restart(); // 关机前有人 → 重启后补记 emptySince ≈ 现在

    server!.sweepRooms(Date.now() + 2 * 3600 * 1000);
    expect((await fetchStats(server!.getHttpPort())).totalRooms).toBe(1); // 2h 内保留

    server!.sweepRooms(Date.now() + 25 * 3600 * 1000);
    expect((await fetchStats(server!.getHttpPort())).totalRooms).toBe(0); // 超 24h 清理

    // 清扫结果持久化：再重启一代也不复活
    await restart();
    expect((await fetchStats(server!.getHttpPort())).totalRooms).toBe(0);
  });

  it('房主删除的房间重启后不复活', async () => {
    await boot();
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'deleteRoom', payload: { roomId: 'room1', userId: 'alice' } });
    await a.next('success');

    await restart();

    expect((await fetchStats(server!.getHttpPort())).totalRooms).toBe(0);
  });
});
