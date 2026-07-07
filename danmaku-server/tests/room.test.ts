// Room 类单元测试：用最小 fake socket（{readyState, send, close}）隔离 ws 依赖
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from '../src/room';

interface FakeWs {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function fakeWs(readyState: number = WebSocket.OPEN): FakeWs {
  return { readyState, send: vi.fn(), close: vi.fn() };
}

function asWs(fake: FakeWs): WebSocket {
  return fake as unknown as WebSocket;
}

/** 取某个 fake socket 收到的全部消息（已解析） */
function received(fake: FakeWs): any[] {
  return fake.send.mock.calls.map(([raw]) => JSON.parse(raw));
}

/** 取某个 fake socket 收到的指定类型消息 */
function receivedOf(fake: FakeWs, type: string): any[] {
  return received(fake).filter((m) => m.type === type);
}

function makeDanmaku(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    text: '你好',
    userId: 'alice',
    color: '#fff',
    fontSize: 24,
    speed: 'normal' as const,
    timestamp: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Room 密码管理', () => {
  it('无密码时 verifyPassword 对任意输入均放行', () => {
    const room = new Room('r1');
    expect(room.hasPassword()).toBe(false);
    expect(room.verifyPassword('')).toBe(true);
    expect(room.verifyPassword('随便什么')).toBe(true);
  });

  it('设置密码后仅正确密码通过校验', () => {
    const room = new Room('r1');
    room.setHost('alice');
    expect(room.setPassword('secret', 'alice')).toBe(true);
    expect(room.hasPassword()).toBe(true);
    expect(room.getPassword()).toBe('secret');
    expect(room.verifyPassword('secret')).toBe(true);
    expect(room.verifyPassword('wrong')).toBe(false);
    expect(room.verifyPassword('')).toBe(false);
  });

  it('非房主 setPassword 返回 false 且密码不生效', () => {
    const room = new Room('r1');
    room.setHost('alice');
    expect(room.setPassword('hacked', 'bob')).toBe(false);
    expect(room.hasPassword()).toBe(false);
  });

  it('房主将密码设为空字符串即取消密码', () => {
    const room = new Room('r1');
    room.setHost('alice');
    room.setPassword('secret', 'alice');
    expect(room.setPassword('', 'alice')).toBe(true);
    expect(room.hasPassword()).toBe(false);
    expect(room.verifyPassword('任意')).toBe(true);
  });
});

describe('Room 成员管理', () => {
  it('addClient 向房间所有成员广播 user-list', () => {
    const room = new Room('r1');
    const a = fakeWs();
    const b = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');
    room.addClient(asWs(b), 'bob', '小B');

    // 第二次 addClient 后双方都收到含两人的 user-list
    const lastListA = receivedOf(a, 'user-list').at(-1);
    const lastListB = receivedOf(b, 'user-list').at(-1);
    expect(lastListA.payload.users).toEqual(
      expect.arrayContaining([
        { userId: 'alice', username: '小A' },
        { userId: 'bob', username: '小B' },
      ])
    );
    expect(lastListB.payload.users).toHaveLength(2);
  });

  it('addClient 将空房计时重置为 null', () => {
    const room = new Room('r1');
    room.markEmpty();
    expect(room.getEmptySince()).not.toBeNull();
    room.addClient(asWs(fakeWs()), 'alice', '小A');
    expect(room.getEmptySince()).toBeNull();
  });

  it('removeClient 关闭对应 socket 并向剩余成员广播 leave 与 user-list', () => {
    const room = new Room('r1');
    const a = fakeWs();
    const b = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');
    room.addClient(asWs(b), 'bob', '小B');

    room.removeClient('alice');

    expect(a.close).toHaveBeenCalled();
    expect(room.getClientCount()).toBe(1);
    const leaves = receivedOf(b, 'leave');
    expect(leaves).toHaveLength(1);
    expect(leaves[0].payload.userId).toBe('alice');
    const lastList = receivedOf(b, 'user-list').at(-1);
    expect(lastList.payload.users).toEqual([{ userId: 'bob', username: '小B' }]);
  });

  it('removeClient 不存在的 userId 不产生任何广播', () => {
    const room = new Room('r1');
    const a = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');
    const before = a.send.mock.calls.length;

    room.removeClient('ghost');

    expect(a.send.mock.calls.length).toBe(before);
    expect(room.getClientCount()).toBe(1);
  });

  it('同一 userId 重复 addClient 覆盖旧连接（钉住现状）', () => {
    const room = new Room('r1');
    const oldWs = fakeWs();
    const newWs = fakeWs();
    room.addClient(asWs(oldWs), 'alice', '小A');
    room.addClient(asWs(newWs), 'alice', '新A');

    expect(room.getClientCount()).toBe(1);
    expect(room.getClients().get('alice')!.ws).toBe(asWs(newWs));
  });
});

describe('Room 弹幕广播', () => {
  it('handleDanmaku 广播给其他成员，不回发给发送者本人', () => {
    // 钉住：服务器不回显弹幕给发送者（发送端本机显示走客户端本地路径）
    const room = new Room('r1');
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');
    room.addClient(asWs(b), 'bob', '小B');
    room.addClient(asWs(c), 'carol', '小C');

    room.handleDanmaku('alice', makeDanmaku() as any);

    expect(receivedOf(a, 'danmaku')).toHaveLength(0);
    expect(receivedOf(b, 'danmaku')).toHaveLength(1);
    expect(receivedOf(c, 'danmaku')).toHaveLength(1);
    expect(receivedOf(b, 'danmaku')[0].payload.text).toBe('你好');
  });

  it('broadcast 跳过 readyState 非 OPEN 的连接', () => {
    const room = new Room('r1');
    const open = fakeWs();
    const closing = fakeWs(WebSocket.CLOSING);
    room.addClient(asWs(open), 'alice', '小A');
    room.addClient(asWs(closing), 'bob', '小B');
    open.send.mockClear();
    closing.send.mockClear();

    room.broadcast({ type: 'danmaku', payload: makeDanmaku() });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closing.send).not.toHaveBeenCalled();
  });

  it('某成员 send 抛异常不影响其余成员收到消息', () => {
    const room = new Room('r1');
    const broken = fakeWs();
    broken.send.mockImplementation(() => {
      throw new Error('socket 已损坏');
    });
    const ok = fakeWs();
    room.addClient(asWs(broken), 'alice', '小A');
    room.addClient(asWs(ok), 'bob', '小B');
    ok.send.mockClear();

    expect(() => room.broadcast({ type: 'danmaku', payload: makeDanmaku() })).not.toThrow();
    expect(ok.send).toHaveBeenCalledTimes(1);
  });
});

describe('Room 心跳与健康检查', () => {
  it('handleHeartbeat 更新 lastHeartbeat 并回复 pong', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const room = new Room('r1');
    const a = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');

    vi.setSystemTime(1_020_000);
    room.handleHeartbeat('alice');

    expect(room.getClients().get('alice')!.lastHeartbeat).toBe(1_020_000);
    const pongs = receivedOf(a, 'pong');
    expect(pongs).toHaveLength(1);
    expect(pongs[0].payload.timestamp).toBe(1_020_000);
  });

  it('未知 userId 的心跳被忽略且不回 pong', () => {
    const room = new Room('r1');
    const a = fakeWs();
    room.addClient(asWs(a), 'alice', '小A');
    a.send.mockClear();

    expect(() => room.handleHeartbeat('ghost')).not.toThrow();
    expect(receivedOf(a, 'pong')).toHaveLength(0);
  });

  it('checkHealth 剔除超过 30s 未心跳的客户端并广播 leave', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const room = new Room('r1');
    const stale = fakeWs();
    const fresh = fakeWs();
    room.addClient(asWs(stale), 'alice', '小A');
    room.addClient(asWs(fresh), 'bob', '小B');

    // bob 在 25s 时心跳过，alice 一直没有
    vi.setSystemTime(1_025_000);
    room.handleHeartbeat('bob');
    vi.setSystemTime(1_031_000); // alice 已 31s 未心跳
    room.checkHealth();

    expect(room.getClientCount()).toBe(1);
    expect(room.getClients().has('bob')).toBe(true);
    expect(stale.close).toHaveBeenCalled();
    expect(receivedOf(fresh, 'leave').map((m) => m.payload.userId)).toEqual(['alice']);
  });

  it('checkHealth 保留心跳未超时的客户端', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const room = new Room('r1');
    room.addClient(asWs(fakeWs()), 'alice', '小A');

    vi.setSystemTime(1_029_000); // 29s < 30s
    room.checkHealth();

    expect(room.getClientCount()).toBe(1);
  });
});

describe('Room 空房计时', () => {
  it('markEmpty 记录时间且重复调用不覆盖首次时间戳', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const room = new Room('r1');

    room.markEmpty();
    vi.setSystemTime(2_500_000);
    room.markEmpty();

    expect(room.getEmptySince()).toBe(2_000_000);
  });
});
