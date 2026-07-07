// DanmakuServer 集成测试：真实 ws 客户端连临时端口（port 0），不 mock 被测系统内部。
// 时间相关（TTL 清扫）不 sleep，直接调用 sweepRooms(now) 注入时间驱动。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DanmakuServer } from '../src/app';
import { startServer, connect, join, fetchStats, waitUntil, TestClient } from './helpers';

/** 等待某房间人数在服务器端达到期望值（leave/断线是异步生效的） */
async function waitClientCount(roomId: string, count: number) {
  await waitUntil(async () => {
    const stats = await fetchStats(server.getHttpPort());
    const room = stats.rooms.find((r: any) => r.roomId === roomId);
    return (room?.clientCount ?? -1) === count;
  });
}

let server: DanmakuServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer();
  clients = [];
});

afterEach(async () => {
  clients.forEach((c) => c.close());
  await server.close();
});

/** 连接并登记，afterEach 统一关闭 */
async function client(testIp: string): Promise<TestClient> {
  const c = await connect(server.getWsPort(), { testIp });
  clients.push(c);
  return c;
}

function makeDanmaku(text: string, userId: string) {
  return {
    id: `d-${text}`,
    text,
    userId,
    color: '#fff',
    fontSize: 24,
    speed: 'normal',
    timestamp: Date.now(),
  };
}

describe('userId 分配（IP 映射优先级）', () => {
  it('新 IP 且客户端自带 userId 未被占用时采纳该 ID', async () => {
    const a = await client('10.0.0.1');
    const res = await join(a, 'room1', { userId: 'alice', isCreate: true });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.userId).toBe('alice');
  });

  it('同一 IP 再次连接沿用已有 userId，忽略客户端提供的新 ID', async () => {
    // 钉住现状：同一 IP 的所有连接共享同一个用户身份
    const first = await client('10.0.0.1');
    await join(first, 'room1', { userId: 'alice', isCreate: true });

    const second = await client('10.0.0.1');
    const res = await join(second, 'room2', { userId: 'bob', isCreate: true });
    expect(res.payload.userId).toBe('alice');
  });

  it('新 IP 但 userId 已被其他 IP 占用时分配服务器生成的新 ID', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    const b = await client('10.0.0.2');
    const res = await join(b, 'room2', { userId: 'alice', isCreate: true });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.userId).not.toBe('alice');
    expect(res.payload.userId).toMatch(/^u/);
  });
});

describe('创建与加入房间', () => {
  it('isCreate 创建房间成功，创建者为房主', async () => {
    const a = await client('10.0.0.1');
    const res = await join(a, 'room1', { userId: 'alice', isCreate: true });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload).toMatchObject({ roomId: 'room1', isHost: true, hasPassword: false });
  });

  it('isCreate 且房间名已存在时返回 joinError/roomNameExists', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    const b = await client('10.0.0.2');
    const res = await join(b, 'room1', { userId: 'bob', isCreate: true });
    expect(res.type).toBe('joinError');
    expect(res.payload.reason).toBe('roomNameExists');
  });

  it('加入已存在房间成功且 isHost=false', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    const b = await client('10.0.0.2');
    const res = await join(b, 'room1', { userId: 'bob' });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.isHost).toBe(false);
  });

  it('join 不存在的房间会隐式创建且加入者成为房主（钉住现状）', async () => {
    const a = await client('10.0.0.1');
    const res = await join(a, 'ghost-room', { userId: 'alice' }); // 未传 isCreate
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.isHost).toBe(true);
  });

  it('同一用户创建第 3 个房间时返回 joinError/roomLimitPerHost', async () => {
    // 服务器在用户切房时会 close 旧连接（removeClient），真实客户端是每房间一条连接——测试同样每次新建连接
    const c1 = await client('10.0.0.1');
    expect((await join(c1, 'room1', { userId: 'alice', isCreate: true })).type).toBe('joinSuccess');
    const c2 = await client('10.0.0.1');
    expect((await join(c2, 'room2', { userId: 'alice', isCreate: true })).type).toBe('joinSuccess');

    const c3 = await client('10.0.0.1');
    const res = await join(c3, 'room3', { userId: 'alice', isCreate: true });
    expect(res.type).toBe('joinError');
    expect(res.payload.reason).toBe('roomLimitPerHost');
  });

  it('总房间数达上限返回 joinError/roomLimitReached', async () => {
    await server.close();
    server = await startServer({ maxRooms: 1 });

    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    const b = await client('10.0.0.2');
    const res = await join(b, 'room2', { userId: 'bob', isCreate: true });
    expect(res.type).toBe('joinError');
    expect(res.payload.reason).toBe('roomLimitReached');
  });

  it('房间满员返回 joinError/roomFull', async () => {
    await server.close();
    server = await startServer({ maxUsersPerRoom: 1 });

    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    const b = await client('10.0.0.2');
    const res = await join(b, 'room1', { userId: 'bob' });
    expect(res.type).toBe('joinError');
    expect(res.payload.reason).toBe('roomFull');
  });

  it('用户切换房间时从旧房间移除（旧连接被服务器关闭），旧房间保留并标记为空', async () => {
    const c1 = await client('10.0.0.1');
    await join(c1, 'room1', { userId: 'alice', isCreate: true });
    const c2 = await client('10.0.0.1'); // 同一用户的新连接加入新房间
    await join(c2, 'room2', { userId: 'alice', isCreate: true });

    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(2);
    const room1 = stats.rooms.find((r: any) => r.roomId === 'room1');
    expect(room1.clientCount).toBe(0);
  });
});

describe('密码流程', () => {
  it('房主 setPassword 成功，房间内广播 passwordChanged', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    a.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'secret', userId: 'alice' } });

    expect((await a.next('success')).payload.message).toBe('密码设置成功');
    const notifyB = await b.next('passwordChanged');
    expect(notifyB.payload).toMatchObject({ roomId: 'room1', hasPassword: true, changedBy: 'alice' });
  });

  it('非房主 setPassword 收到 error', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    b.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'hack', userId: 'bob' } });

    expect((await b.next('error')).payload.message).toBe('只有房主可以修改密码');
  });

  it('对不存在的房间 setPassword 返回 error', async () => {
    const a = await client('10.0.0.1');
    a.send({ type: 'setPassword', payload: { roomId: 'ghost', password: 'x', userId: 'alice' } });
    expect((await a.next('error')).payload.message).toBe('房间不存在');
  });

  it('密码错误加入返回 joinError/wrongPassword，密码正确可加入', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'secret', userId: 'alice' } });
    await a.next('success');

    const b = await client('10.0.0.2');
    const denied = await join(b, 'room1', { userId: 'bob', password: 'bad' });
    expect(denied.type).toBe('joinError');
    expect(denied.payload.reason).toBe('wrongPassword');

    const granted = await join(b, 'room1', { userId: 'bob', password: 'secret' });
    expect(granted.type).toBe('joinSuccess');
  });

  it('房主免密重进自己的房间，joinSuccess 附带明文 password 字段', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'setPassword', payload: { roomId: 'room1', password: 'secret', userId: 'alice' } });
    await a.next('success');
    a.send({ type: 'leave', payload: { userId: 'alice' } });
    await waitClientCount('room1', 0);

    // leave 时服务器会 close 旧连接，重进走新连接（同 IP → 同 userId）
    const a2 = await client('10.0.0.1');
    const res = await join(a2, 'room1', { userId: 'alice' }); // 不带密码
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.isHost).toBe(true);
    expect(res.payload.password).toBe('secret');
  });
});

describe('弹幕转发', () => {
  it('A 发弹幕后 B 收到 danmaku 消息，A 收不到回显', async () => {
    // 钉住：服务器不回显给发送者本人——发送端显示由客户端本地路径负责
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    a.send({ type: 'danmaku', payload: makeDanmaku('大家好', 'alice') });

    const msg = await b.next('danmaku');
    expect(msg.payload.text).toBe('大家好');
    await a.expectSilence('danmaku');
  });

  it('未加入房间时发送弹幕被静默忽略', async () => {
    const a = await client('10.0.0.1');
    a.send({ type: 'danmaku', payload: makeDanmaku('喂', 'nobody') });

    await a.expectSilence();
    expect(a.ws.readyState).toBe(a.ws.OPEN);
  });
});

describe('ping/pong 心跳', () => {
  it('已加入房间的 ping 收到 pong（payload 为服务器时间戳，无 serverTime 字段）', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    a.send({ type: 'ping', payload: { timestamp: 123 } });

    const pong = await a.next('pong');
    expect(typeof pong.payload.timestamp).toBe('number');
    // 曾存在重复的 case 'ping' 死分支（带 serverTime），已删除；钉住现存分支的行为
    expect(pong.payload.serverTime).toBeUndefined();
  });

  it('未加入房间的 ping 得不到任何响应（钉住现状）', async () => {
    const a = await client('10.0.0.1');
    a.send({ type: 'ping', payload: { timestamp: 123 } });
    await a.expectSilence();
  });
});

describe('leave 与断线清理', () => {
  it('leave 后其他成员收到 leave 与 user-list 更新', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    b.clear(); // 清掉自己 join 时残留的 user-list 广播，确保拿到 leave 之后的那份
    a.send({ type: 'leave', payload: { userId: 'alice' } });

    const left = await b.next('leave');
    expect(left.payload.userId).toBe('alice');
    const list = await b.next('user-list');
    expect(list.payload.users).toEqual([{ userId: 'bob', username: 'tester' }]);
  });

  it('最后一人 leave 后房间保留并标记为空，可重新加入', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'leave', payload: { userId: 'alice' } });
    await waitClientCount('room1', 0);

    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(1);
    expect(stats.rooms[0].clientCount).toBe(0);

    // leave 时服务器会 close 旧连接，重进走新连接
    const a2 = await client('10.0.0.1');
    const res = await join(a2, 'room1', { userId: 'alice' });
    expect(res.type).toBe('joinSuccess');
  });

  it('连接直接断开后成员被移出房间', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    a.ws.terminate();

    const left = await b.next('leave');
    expect(left.payload.userId).toBe('alice');
    const stats = await fetchStats(server.getHttpPort());
    expect(stats.rooms[0].clientCount).toBe(1);
  });
});

describe('deleteRoom 授权', () => {
  it('房主删除房间：全员收到 roomDeleted，房间被清理', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    a.send({ type: 'deleteRoom', payload: { roomId: 'room1', userId: 'alice' } });

    expect((await b.next('roomDeleted')).payload.roomId).toBe('room1');
    expect((await a.next('success')).payload.message).toBe('房间已删除');
    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(0);
    expect(stats.hostRooms).toEqual({});
  });

  it('非房主删除返回 error', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'room1', { userId: 'bob' });

    b.send({ type: 'deleteRoom', payload: { roomId: 'room1', userId: 'bob' } });

    expect((await b.next('error')).payload.message).toBe('只有房主可以删除房间');
    expect((await fetchStats(server.getHttpPort())).totalRooms).toBe(1);
  });

  it('删除不存在的房间返回 success（清除记录语义）', async () => {
    const a = await client('10.0.0.1');
    a.send({ type: 'deleteRoom', payload: { roomId: 'ghost', userId: 'alice' } });
    expect((await a.next('success')).payload.message).toBe('房间已不存在，已从记录中清除');
  });
});

describe('/stats 管理接口', () => {
  it('返回 JSON 且各统计字段数值正确', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'roomA', { userId: 'alice', isCreate: true });
    const b = await client('10.0.0.2');
    await join(b, 'roomA', { userId: 'bob' });

    const stats = await fetchStats(server.getHttpPort());

    expect(stats.totalRooms).toBe(1);
    expect(stats.totalHosts).toBe(1);
    expect(stats.totalClients).toBe(2);
    expect(stats.hostRooms).toEqual({ alice: { roomCount: 1, rooms: ['roomA'] } });
  });

  it('rooms 条目形状为 { roomId, clientCount, hasPassword, age }', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'roomA', { userId: 'alice', isCreate: true });

    const stats = await fetchStats(server.getHttpPort());
    const room = stats.rooms[0];
    expect(room.roomId).toBe('roomA');
    expect(room.clientCount).toBe(1);
    expect(room.hasPassword).toBe(false);
    expect(typeof room.age).toBe('number');
    expect(room.age).toBeGreaterThanOrEqual(0);
  });

  it('未知路径返回 404，OPTIONS 预检返回 204 并带 CORS 头', async () => {
    const base = `http://127.0.0.1:${server.getHttpPort()}`;
    const notFound = await fetch(`${base}/unknown`);
    expect(notFound.status).toBe(404);

    const preflight = await fetch(`${base}/stats`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('房间 TTL 清扫（sweepRooms 注入时间驱动）', () => {
  it('空房间超过 24h 被清理，hostRooms 映射同步移除', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'leave', payload: { userId: 'alice' } });
    await waitClientCount('room1', 0); // 等 leave 在服务器端生效

    server.sweepRooms(Date.now() + 25 * 3600 * 1000);

    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(0);
    expect(stats.hostRooms).toEqual({});
  });

  it('空房间在 24h 内保留（房龄超 1h 也不删，房主可回来）', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });
    a.send({ type: 'leave', payload: { userId: 'alice' } });
    await waitClientCount('room1', 0);

    server.sweepRooms(Date.now() + 2 * 3600 * 1000); // 空置 2h（< 24h），不清理

    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(1);

    // 且房主仍可免密回到自己的房间
    const a2 = await client('10.0.0.1');
    const res = await join(a2, 'room1', { userId: 'alice' });
    expect(res.type).toBe('joinSuccess');
    expect(res.payload.isHost).toBe(true);
  });

  it('有成员的房间即使超龄也不清理', async () => {
    const a = await client('10.0.0.1');
    await join(a, 'room1', { userId: 'alice', isCreate: true });

    server.sweepRooms(Date.now() + 25 * 3600 * 1000);

    const stats = await fetchStats(server.getHttpPort());
    expect(stats.totalRooms).toBe(1);
  });
});
