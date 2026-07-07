// connectionStore 测试：只测纯逻辑切片（日志、房间列表对账、服务器回调 reducer、断开与失败分支），
// ServerConnection 经模块 mock 隔离；createRoom/joinRoom/switchRoom 的完整网络编排流有意不测（性价比低）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConnectionStore, RoomState } from './connectionStore';
import { DanmakuMessage } from '../../shared/types';

const h = vi.hoisted(() => {
  const joinRoom = vi.fn();
  const setCallbacks = vi.fn();
  const fetchServerStats = vi.fn();
  const disconnect = vi.fn();
  const sendLeave = vi.fn();
  const sendDanmaku = vi.fn();
  const getIsHost = vi.fn();
  const deleteRoom = vi.fn();
  const setPassword = vi.fn();
  const saveRoomPassword = vi.fn();
  const getRoomPassword = vi.fn();
  const clearRoomPassword = vi.fn();

  class MockServerConnection {
    joinRoom = joinRoom;
    setCallbacks = setCallbacks;
    fetchServerStats = fetchServerStats;
    disconnect = disconnect;
    sendLeave = sendLeave;
    sendDanmaku = sendDanmaku;
    getIsHost = getIsHost;
    deleteRoom = deleteRoom;
    setPassword = setPassword;
    testServerConnection = vi.fn();
    static saveRoomPassword = saveRoomPassword;
    static getRoomPassword = getRoomPassword;
    static clearRoomPassword = clearRoomPassword;
  }

  return {
    MockServerConnection, joinRoom, setCallbacks, fetchServerStats, disconnect,
    sendLeave, sendDanmaku, getIsHost, deleteRoom, setPassword,
    saveRoomPassword, getRoomPassword, clearRoomPassword,
  };
});

vi.mock('../services/serverConnection', () => ({
  ServerConnection: h.MockServerConnection,
}));

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'r1',
    status: 'connected',
    role: 'host',
    isHost: true,
    connectedUsers: [],
    error: null,
    logs: [],
    ...overrides,
  };
}

function danmaku(): DanmakuMessage {
  return {
    id: 'd1', text: '你好', userId: 'u1', color: '#fff',
    fontSize: 24, speed: 'normal', timestamp: 1,
  };
}

beforeEach(() => {
  // 模块 mock 的 vi.fn 不受 restoreMocks 管理，手动重置并设默认行为
  h.joinRoom.mockReset().mockResolvedValue(undefined);
  h.setCallbacks.mockReset();
  h.fetchServerStats.mockReset().mockResolvedValue(null);
  h.disconnect.mockReset();
  h.sendLeave.mockReset();
  h.sendDanmaku.mockReset();
  h.getIsHost.mockReset().mockReturnValue(false);
  h.deleteRoom.mockReset();
  h.setPassword.mockReset();
  h.saveRoomPassword.mockReset();
  h.getRoomPassword.mockReset().mockReturnValue(undefined);
  h.clearRoomPassword.mockReset();

  useConnectionStore.setState({
    rooms: {}, activeRoomId: '', username: '', serverUrl: '', ownedRooms: [],
    status: 'disconnected', role: 'none', roomId: '', connectedUsers: [],
    error: null, logs: [], _onDanmaku: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('模块加载副作用与初始化', () => {
  it('模块加载时清理 P2P 时代遗留的 funapp-connectionMode 键', async () => {
    localStorage.setItem('funapp-connectionMode', 'p2p');
    vi.resetModules();
    await import('./connectionStore');
    expect(localStorage.getItem('funapp-connectionMode')).toBeNull();
  });

  it('创建 store 时从 localStorage 初始化 username 与 ownedRooms', async () => {
    localStorage.setItem('funapp-username', '老王');
    localStorage.setItem('funapp-owned-rooms', JSON.stringify([
      { roomId: 'a', roomName: '房间A', role: 'host', createdAt: 1 },
    ]));
    vi.resetModules();
    const mod = await import('./connectionStore');
    expect(mod.useConnectionStore.getState().username).toBe('老王');
    expect(mod.useConnectionStore.getState().ownedRooms).toEqual([
      { roomId: 'a', roomName: '房间A', role: 'host', createdAt: 1 },
    ]);
  });

  it('funapp-owned-rooms 存档损坏时回落为空列表而不崩溃', async () => {
    localStorage.setItem('funapp-owned-rooms', '不是JSON{');
    vi.resetModules();
    const mod = await import('./connectionStore');
    expect(mod.useConnectionStore.getState().ownedRooms).toEqual([]);
  });
});

describe('addLog / clearLogs', () => {
  it('向指定房间追加带时间戳日志；活跃房间同步顶层便捷属性 logs', () => {
    useConnectionStore.setState({ rooms: { r1: roomState() }, activeRoomId: 'r1' });

    useConnectionStore.getState().addLog('r1', '连接成功');

    const state = useConnectionStore.getState();
    expect(state.rooms.r1.logs).toHaveLength(1);
    expect(state.rooms.r1.logs[0]).toMatch(/^\[.+\] 连接成功$/);
    expect(state.logs).toEqual(state.rooms.r1.logs);
  });

  it('非活跃房间的日志不影响顶层 logs', () => {
    useConnectionStore.setState({
      rooms: { r1: roomState(), r2: roomState({ roomId: 'r2' }) },
      activeRoomId: 'r1',
      logs: [],
    });

    useConnectionStore.getState().addLog('r2', '别处的日志');

    expect(useConnectionStore.getState().rooms.r2.logs).toHaveLength(1);
    expect(useConnectionStore.getState().logs).toHaveLength(0);
  });

  it('日志上限封顶 51 条（slice(-50) 后再追加 1 条，2026-07 已确认保持此行为）', () => {
    const logs = Array.from({ length: 60 }, (_, i) => `旧日志${i}`);
    useConnectionStore.setState({ rooms: { r1: roomState({ logs }) }, activeRoomId: 'r1' });

    useConnectionStore.getState().addLog('r1', '新日志');

    const result = useConnectionStore.getState().rooms.r1.logs;
    expect(result).toHaveLength(51);
    expect(result[0]).toBe('旧日志10'); // 保留最后 50 条旧日志
    expect(result[50]).toContain('新日志');
  });

  it('房间不存在时不产生任何状态变化', () => {
    const before = useConnectionStore.getState().rooms;
    useConnectionStore.getState().addLog('ghost', '无处安放');
    expect(useConnectionStore.getState().rooms).toBe(before);
  });

  it('clearLogs 清空活跃房间日志与顶层 logs', () => {
    useConnectionStore.setState({
      rooms: { r1: roomState({ logs: ['a', 'b'] }) },
      activeRoomId: 'r1',
      logs: ['a', 'b'],
    });

    useConnectionStore.getState().clearLogs();

    expect(useConnectionStore.getState().rooms.r1.logs).toHaveLength(0);
    expect(useConnectionStore.getState().logs).toHaveLength(0);
  });
});

describe('syncOwnedRoomsFromServer 对账', () => {
  it('stats 拉取失败（null）时 ownedRooms 保持不变', async () => {
    const rooms = [{ roomId: 'a', roomName: 'a', role: 'host', createdAt: 1 }];
    useConnectionStore.setState({ ownedRooms: rooms });

    await useConnectionStore.getState().syncOwnedRoomsFromServer();

    expect(useConnectionStore.getState().ownedRooms).toBe(rooms);
  });

  it('命中本机 userId 时：保留服务器仍有的、剔除已消失的、补充服务器独有的', async () => {
    localStorage.setItem('funapp-user-id', 'me');
    h.fetchServerStats.mockResolvedValue({
      totalRooms: 2, totalHosts: 1, totalClients: 0,
      hostRooms: { me: { roomCount: 2, rooms: ['a', 'c'] } },
      rooms: [],
    });
    useConnectionStore.setState({
      ownedRooms: [
        { roomId: 'a', roomName: '房间A', role: 'host', createdAt: 1 },
        { roomId: 'b', roomName: '已消失', role: 'host', createdAt: 2 },
      ],
    });

    await useConnectionStore.getState().syncOwnedRoomsFromServer();

    const owned = useConnectionStore.getState().ownedRooms;
    expect(owned.map(r => r.roomId).sort()).toEqual(['a', 'c']);
    const kept = owned.find(r => r.roomId === 'a')!;
    expect(kept.roomName).toBe('房间A'); // 本地信息保留
    expect(kept.isActive).toBe(true);
    expect(kept.lastSynced).toBeTypeOf('number');
    const added = owned.find(r => r.roomId === 'c')!;
    expect(added).toMatchObject({ roomName: 'c', role: 'host', isActive: true });
    // 对账结果落盘
    expect(JSON.parse(localStorage.getItem('funapp-owned-rooms')!)).toHaveLength(2);
  });

  it('未命中 userId 时回退聚合全部 hostRooms 的房间', async () => {
    h.fetchServerStats.mockResolvedValue({
      totalRooms: 2, totalHosts: 2, totalClients: 0,
      hostRooms: {
        other1: { roomCount: 1, rooms: ['x'] },
        other2: { roomCount: 1, rooms: ['y'] },
      },
      rooms: [],
    });

    await useConnectionStore.getState().syncOwnedRoomsFromServer();

    const owned = useConnectionStore.getState().ownedRooms;
    expect(owned.map(r => r.roomId).sort()).toEqual(['x', 'y']);
  });
});

describe('ownedRooms 增删', () => {
  it('addOwnedRoom 头插且上限 50 条，同步写 localStorage', () => {
    const seed = Array.from({ length: 50 }, (_, i) => ({
      roomId: `r${i}`, roomName: `r${i}`, role: 'host', createdAt: i,
    }));
    useConnectionStore.setState({ ownedRooms: seed });

    useConnectionStore.getState().addOwnedRoom({
      roomId: 'newest', roomName: 'newest', role: 'host', createdAt: 999,
    });

    const owned = useConnectionStore.getState().ownedRooms;
    expect(owned).toHaveLength(50);
    expect(owned[0].roomId).toBe('newest');
    expect(owned.at(-1)!.roomId).toBe('r48'); // r49 被挤出
    expect(JSON.parse(localStorage.getItem('funapp-owned-rooms')!)[0].roomId).toBe('newest');
  });

  it('removeOwnedRoom 按 roomId 过滤并同步 localStorage', () => {
    useConnectionStore.setState({
      ownedRooms: [
        { roomId: 'a', roomName: 'a', role: 'host', createdAt: 1 },
        { roomId: 'b', roomName: 'b', role: 'host', createdAt: 2 },
      ],
    });

    useConnectionStore.getState().removeOwnedRoom('a');

    expect(useConnectionStore.getState().ownedRooms.map(r => r.roomId)).toEqual(['b']);
    expect(JSON.parse(localStorage.getItem('funapp-owned-rooms')!)).toHaveLength(1);
  });
});

describe('_setupServerCallbacks 纯 reducer（经捕获的回调对象手动触发）', () => {
  /** 注册回调并返回捕获的回调对象 */
  function setup(roomId = 'r1') {
    useConnectionStore.getState()._setupServerCallbacks(roomId, new h.MockServerConnection() as any);
    return h.setCallbacks.mock.calls.at(-1)![0];
  }

  it('onDanmaku 透传给 initCallbacks 注册的回调，附带 roomId 与 isReplay', () => {
    const onDanmaku = vi.fn();
    useConnectionStore.getState().initCallbacks(onDanmaku);
    const cbs = setup('r1');

    const d = danmaku();
    cbs.onDanmaku(d, true);

    expect(onDanmaku).toHaveBeenCalledWith(d, 'r1', true);
  });

  it('onStatusChange 更新房间状态；活跃房间同步便捷属性并记日志', () => {
    useConnectionStore.setState({ rooms: { r1: roomState({ status: 'connecting' }) }, activeRoomId: 'r1' });
    const cbs = setup('r1');

    cbs.onStatusChange('connected');

    const state = useConnectionStore.getState();
    expect(state.rooms.r1.status).toBe('connected');
    expect(state.status).toBe('connected');
    expect(state.rooms.r1.logs.at(-1)).toContain('连接状态: connected');
  });

  it('onUserJoin / onUserLeave 增删在线用户', () => {
    useConnectionStore.setState({ rooms: { r1: roomState() }, activeRoomId: 'r1' });
    const cbs = setup('r1');

    cbs.onUserJoin({ userId: 'u1', username: '小A' });
    cbs.onUserJoin({ userId: 'u2', username: '小B' });
    expect(useConnectionStore.getState().connectedUsers).toHaveLength(2);

    cbs.onUserLeave('u1');
    expect(useConnectionStore.getState().connectedUsers).toEqual([{ userId: 'u2', username: '小B' }]);
  });

  it('onUserListUpdate 整体替换用户列表', () => {
    useConnectionStore.setState({
      rooms: { r1: roomState({ connectedUsers: [{ userId: 'old', username: '旧人' }] }) },
      activeRoomId: 'r1',
    });
    const cbs = setup('r1');

    cbs.onUserListUpdate([{ userId: 'u1', username: '小A' }]);

    expect(useConnectionStore.getState().rooms.r1.connectedUsers).toEqual([{ userId: 'u1', username: '小A' }]);
  });

  it('onError：房间存在时写入房间 error 并同步便捷属性，房间不存在时只写顶层 error', () => {
    useConnectionStore.setState({ rooms: { r1: roomState() }, activeRoomId: 'r1' });
    const cbs = setup('r1');
    cbs.onError('服务器拒绝');
    expect(useConnectionStore.getState().rooms.r1.error).toBe('服务器拒绝');
    expect(useConnectionStore.getState().error).toBe('服务器拒绝');

    useConnectionStore.setState({ rooms: {}, activeRoomId: '', error: null });
    const cbs2 = setup('ghost');
    cbs2.onError('房间没了');
    expect(useConnectionStore.getState().error).toBe('房间没了');
  });

  it('onRoomDeleted 记日志并在 1s 后断开该房间', () => {
    vi.useFakeTimers();
    useConnectionStore.setState({ rooms: { r1: roomState() }, activeRoomId: 'r1' });
    const cbs = setup('r1');

    cbs.onRoomDeleted('房主删除了房间');

    expect(useConnectionStore.getState().rooms.r1.logs.at(-1)).toContain('房间已被删除');
    expect(useConnectionStore.getState().rooms.r1).toBeDefined();

    vi.advanceTimersByTime(1000);
    expect(useConnectionStore.getState().rooms.r1).toBeUndefined();
    expect(useConnectionStore.getState().activeRoomId).toBe('');
  });
});

describe('joinRoom 失败与断开', () => {
  it('joinRoom 失败：房间置 error 状态、记失败日志、异常向外抛', async () => {
    h.joinRoom.mockRejectedValue(new Error('密码错误'));

    await expect(useConnectionStore.getState().joinRoom('r1', 'bad')).rejects.toThrow('密码错误');

    const room = useConnectionStore.getState().rooms.r1;
    expect(room.status).toBe('error');
    expect(room.error).toBe('密码错误');
    expect(room.logs.at(-1)).toContain('❌ 加入失败');
  });

  it('joinRoom 成功：状态 connected、按 getIsHost 定角色、缓存密码并写入历史房间', async () => {
    h.getIsHost.mockReturnValue(true);
    h.getRoomPassword.mockReturnValue('pw123');

    await useConnectionStore.getState().joinRoom('r1', 'pw123');

    const room = useConnectionStore.getState().rooms.r1;
    expect(room.status).toBe('connected');
    expect(room.role).toBe('host');
    expect(room.isHost).toBe(true);
    expect(h.saveRoomPassword).toHaveBeenCalledWith('r1', 'pw123');
    const history = JSON.parse(localStorage.getItem('funapp-room-history')!);
    expect(history[0]).toMatchObject({ roomId: 'r1', role: 'host' });
  });

  it('disconnectRoom 移除房间并把 activeRoomId 落到剩余首个', async () => {
    // 先经 joinRoom 建立连接，验证断开时发送 leave
    await useConnectionStore.getState().joinRoom('r1');
    useConnectionStore.setState(state => ({
      rooms: { ...state.rooms, r2: roomState({ roomId: 'r2' }) },
    }));

    useConnectionStore.getState().disconnectRoom('r1');

    expect(h.sendLeave).toHaveBeenCalledWith('r1');
    expect(h.disconnect).toHaveBeenCalled();
    const state = useConnectionStore.getState();
    expect(state.rooms.r1).toBeUndefined();
    expect(state.activeRoomId).toBe('r2');
    expect(state.roomId).toBe('r2'); // 便捷属性跟随新活跃房间
  });

  it('断开最后一个房间后便捷属性回落默认值', () => {
    useConnectionStore.setState({ rooms: { r1: roomState() }, activeRoomId: 'r1', status: 'connected' });

    useConnectionStore.getState().disconnectRoom('r1');

    const state = useConnectionStore.getState();
    expect(state.activeRoomId).toBe('');
    expect(state.status).toBe('disconnected');
    expect(state.role).toBe('none');
    expect(state.connectedUsers).toEqual([]);
  });

  it('disconnectAll 重置全部连接状态', () => {
    useConnectionStore.setState({
      rooms: { r1: roomState(), r2: roomState({ roomId: 'r2' }) },
      activeRoomId: 'r1',
      status: 'connected',
    });

    useConnectionStore.getState().disconnectAll();

    const state = useConnectionStore.getState();
    expect(state.rooms).toEqual({});
    expect(state.activeRoomId).toBe('');
    expect(state.status).toBe('disconnected');
  });
});

describe('setServerUrl / setUsername', () => {
  it('setServerUrl 经 serverConfig 写 localStorage 并 trim 更新 state', () => {
    useConnectionStore.getState().setServerUrl('  ws://my.server:8080  ');

    expect(localStorage.getItem('funapp-server-url')).toBe('ws://my.server:8080');
    expect(useConnectionStore.getState().serverUrl).toBe('ws://my.server:8080');
  });

  it('setUsername 持久化到 funapp-username', () => {
    useConnectionStore.getState().setUsername('老王');

    expect(localStorage.getItem('funapp-username')).toBe('老王');
    expect(useConnectionStore.getState().username).toBe('老王');
  });
});
