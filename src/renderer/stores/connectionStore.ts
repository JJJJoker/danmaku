import { create } from 'zustand';
import { ServerConnection, ConnectionStatus, PeerRole } from '../services/serverConnection';
import { getCustomServerUrl, setCustomServerUrl } from '../services/serverConfig';
import { DanmakuMessage, RoomUser } from '../../shared/types';

// ServerConnection单例（同一时间只连接一个房间，切换房间时重新连接）
let serverConnection: ServerConnection | null = null;

// P2P 模式已移除（v1.5.0），清理旧的模式配置键
localStorage.removeItem('funapp-connectionMode');

function getServerConnection(): ServerConnection {
  if (!serverConnection) {
    serverConnection = new ServerConnection();
  }
  return serverConnection;
}

function clearServerConnection() {
  if (serverConnection) {
    serverConnection.disconnect();
    serverConnection = null;
  }
}

// 同步服务器房间列表到本地缓存
export interface RoomState {
  roomId: string;
  status: ConnectionStatus;
  role: PeerRole;
  isHost: boolean;  // 新增: 是否是房主
  hasPassword?: boolean;  // 房间是否设置了密码
  connectedUsers: RoomUser[];
  error: string | null;
  logs: string[];
}

interface ConnectionState {
  // 多房间状态
  rooms: Record<string, RoomState>;
  activeRoomId: string;
  username: string;

  // 自定义服务器地址（空字符串表示使用构建期注入的默认地址）
  serverUrl: string;
  setServerUrl: (url: string) => void;

  // 新增: 我的房间列表(从localStorage初始化)
  ownedRooms: Array<{
    roomId: string;
    roomName: string;
    role: string;
    createdAt: number;
    password?: string;
    isActive?: boolean;
    lastSynced?: number;
  }>;
  
  // 新增: 设置房间列表
  setOwnedRooms: (rooms: Array<any>) => void;
  
  // 新增: 添加房间
  addOwnedRoom: (room: any) => void;
  
  // 新增: 移除房间
  removeOwnedRoom: (roomId: string) => void;
  
  // 新增: 同步服务器房间列表
  syncOwnedRoomsFromServer: () => Promise<void>;

  // 操作
  createRoom: (roomName?: string, existingRoomId?: string, password?: string) => Promise<string>;
  joinRoom: (roomId: string, password?: string) => Promise<void>;
  disconnectRoom: (roomId: string) => void;
  disconnectAll: () => void;
  switchRoom: (roomId: string) => Promise<void>;
  sendDanmaku: (danmaku: DanmakuMessage) => void;
  clearError: () => void;
  testServerConnection: () => Promise<boolean>;  // 测试服务器连接
  addLog: (roomId: string, message: string) => void;
  clearLogs: () => void;
  setUsername: (name: string) => void;
  setPassword: (roomId: string, password: string) => void;  // 新增
  deleteRoom: (roomId: string) => Promise<void>;  // 新增

  // 服务器操作反馈（error/success），供 UI 镜像到 toast 提示；用后 clearNotice
  notice: { kind: 'error' | 'success'; message: string } | null;
  setNotice: (notice: { kind: 'error' | 'success'; message: string }) => void;
  clearNotice: () => void;

  // 便捷属性（来自当前活跃房间）
  status: ConnectionStatus;
  role: PeerRole;
  roomId: string;
  connectedUsers: RoomUser[];
  error: string | null;
  logs: string[];

  // 内部：注册弹幕回调（isReplay=true 表示房间历史回放，不触发朗读等副作用）
  initCallbacks: (onDanmaku: (danmaku: DanmakuMessage, roomId: string, isReplay?: boolean) => void) => void;

  // 内部：用于存储全局弹幕回调
  _onDanmaku: ((danmaku: DanmakuMessage, roomId: string, isReplay?: boolean) => void) | null;
  // 内部：为服务器模式设置回调
  _setupServerCallbacks: (roomId: string, connection: ServerConnection) => void;
}

// 辅助：全局只有一条物理连接，切换/新建房间成功后把除 exceptId 外仍非 disconnected 的房间置为
// disconnected，避免"旧房间永远显示在线"（Bug 3）。返回新 map，不修改入参。
function markOthersDisconnected(
  rooms: Record<string, RoomState>,
  exceptId: string
): Record<string, RoomState> {
  const next: Record<string, RoomState> = {};
  for (const [id, room] of Object.entries(rooms)) {
    next[id] = (id !== exceptId && room.status !== 'disconnected')
      ? { ...room, status: 'disconnected' }
      : room;
  }
  return next;
}

// 辅助：从 rooms 中获取活跃房间的便捷属性
function getActiveRoomProps(rooms: Record<string, RoomState>, activeRoomId: string) {
  const activeRoom = rooms[activeRoomId];
  if (activeRoom) {
    return {
      status: activeRoom.status,
      role: activeRoom.role,
      roomId: activeRoom.roomId,
      connectedUsers: activeRoom.connectedUsers,
      error: activeRoom.error,
      logs: activeRoom.logs,
    };
  }
  return {
    status: 'disconnected' as ConnectionStatus,
    role: 'none' as PeerRole,
    roomId: '',
    connectedUsers: [] as RoomUser[],
    error: null,
    logs: [] as string[],
  };
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  rooms: {},
  activeRoomId: '',
  username: localStorage.getItem('funapp-username') || '',
  _onDanmaku: null,

  // 自定义服务器地址（localStorage 持久化，连接时由 serverConfig 解析生效值）
  serverUrl: getCustomServerUrl(),

  setServerUrl: (url) => {
    setCustomServerUrl(url);
    set({ serverUrl: url.trim() });
  },

  // 从localStorage初始化ownedRooms
  ownedRooms: (() => {
    try {
      return JSON.parse(localStorage.getItem('funapp-owned-rooms') || '[]');
    } catch {
      return [];
    }
  })(),
  
  // 设置房间列表
  setOwnedRooms: (rooms) => {
    localStorage.setItem('funapp-owned-rooms', JSON.stringify(rooms));
    set({ ownedRooms: rooms });
  },
  
  // 添加房间
  addOwnedRoom: (room) => {
    const { ownedRooms } = get();
    const updated = [room, ...ownedRooms].slice(0, 50); // 最多50个
    localStorage.setItem('funapp-owned-rooms', JSON.stringify(updated));
    set({ ownedRooms: updated });
  },
  
  // 移除房间
  removeOwnedRoom: (roomId) => {
    const { ownedRooms } = get();
    const updated = ownedRooms.filter(r => r.roomId !== roomId);
    localStorage.setItem('funapp-owned-rooms', JSON.stringify(updated));
    set({ ownedRooms: updated });
  },
  
  // 同步服务器房间列表
  syncOwnedRoomsFromServer: async () => {
    console.log('[ConnectionStore] syncOwnedRoomsFromServer called');
    
    const serverConn = getServerConnection();
    
    console.log('[ConnectionStore] Fetching server stats...');
    const stats = await serverConn.fetchServerStats();
    if (!stats) {
      console.warn('[ConnectionStore] Failed to fetch server stats');
      return;
    }
    
    console.log('[ConnectionStore] Server stats:', stats);
    
    try {
      const { ownedRooms } = get();
      console.log('[ConnectionStore] Current owned rooms:', ownedRooms);
      
      // 获取当前用户的persistentUserId，从服务器的hostRooms中匹配自己的房间
      const myUserId = localStorage.getItem('funapp-user-id');
      let myServerRoomIds: string[] = [];
      
      if (myUserId && stats.hostRooms[myUserId]) {
        myServerRoomIds = stats.hostRooms[myUserId].rooms;
        console.log(`[ConnectionStore] My server rooms (userId=${myUserId}):`, myServerRoomIds);
      } else {
        // 如果没有匹配到，回退到使用所有服务器房间ID
        const allServerRoomIds = new Set<string>();
        Object.values(stats.hostRooms).forEach((hostData) => {
          hostData.rooms.forEach((roomId) => allServerRoomIds.add(roomId));
        });
        myServerRoomIds = Array.from(allServerRoomIds);
        console.log('[ConnectionStore] No user match, using all server rooms:', myServerRoomIds);
      }
      
      const serverRoomSet = new Set(myServerRoomIds);
      
      // 1. 保留本地已有的且服务器上仍然存在的房间
      const keptRooms = ownedRooms.filter(room => {
        const keep = serverRoomSet.has(room.roomId);
        console.log(`[ConnectionStore] Local room ${room.roomId}: ${keep ? 'keep' : 'remove'}`);
        return keep;
      });
      
      // 2. 添加服务器上有但本地没有的房间
      const localRoomIds = new Set(keptRooms.map(r => r.roomId));
      const newRooms = myServerRoomIds
        .filter(roomId => !localRoomIds.has(roomId))
        .map(roomId => ({
          roomId,
          roomName: roomId,
          role: 'host',
          createdAt: Date.now(),
          lastSynced: Date.now(),
          isActive: true,
        }));
      
      if (newRooms.length > 0) {
        console.log('[ConnectionStore] Adding new rooms from server:', newRooms.map(r => r.roomId));
      }
      
      // 3. 合并并更新状态
      const updatedRooms = [...keptRooms, ...newRooms].map(room => ({
        ...room,
        isActive: true,
        lastSynced: Date.now()
      }));
      
      console.log(`[ConnectionStore] Sync complete: ${keptRooms.length} kept, ${newRooms.length} added, ${ownedRooms.length - keptRooms.length} removed`);
      
      // 保存到localStorage和store
      localStorage.setItem('funapp-owned-rooms', JSON.stringify(updatedRooms));
      set({ ownedRooms: updatedRooms });
    } catch (e) {
      console.error('[ConnectionStore] Failed to sync owned rooms:', e);
    }
  },

  // 便捷属性初始值
  status: 'disconnected',
  role: 'none',
  roomId: '',
  connectedUsers: [],
  error: null,
  logs: [],

  // 服务器操作反馈
  notice: null,
  setNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),

  addLog: (roomId: string, message: string) => {
    const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
    set(state => {
      const room = state.rooms[roomId];
      if (!room) return {};
      const updatedRooms = {
        ...state.rooms,
        [roomId]: {
          ...room,
          logs: [...room.logs.slice(-50), logEntry],
        },
      };
      const props = state.activeRoomId === roomId
        ? { logs: updatedRooms[roomId].logs }
        : {};
      return { rooms: updatedRooms, ...props };
    });
  },

  clearLogs: () => {
    const { activeRoomId } = get();
    if (!activeRoomId) return;
    set(state => {
      const room = state.rooms[activeRoomId];
      if (!room) return {};
      const updatedRooms = {
        ...state.rooms,
        [activeRoomId]: { ...room, logs: [] },
      };
      return { rooms: updatedRooms, logs: [] };
    });
  },

  createRoom: async (roomName?: string, existingRoomId?: string, password?: string) => {
    const { username } = get();
    console.log(`[Z-ORDER] createRoom START`);

    const roomId = existingRoomId || roomName || 'default';

    // 如果已有连接，先断开
    if (serverConnection) {
      console.log(`[Z-ORDER] createRoom: disconnecting existing connection`);
      serverConnection.disconnect();
      serverConnection = null;
    }

    const conn = getServerConnection();

    // 设置回调
    get()._setupServerCallbacks(roomId, conn);

    // 传递密码参数和isCreate标志
    console.log(`[Z-ORDER] createRoom: calling joinRoom...`);
    await conn.joinRoom(roomId, username || '匿名用户', password, true);  // isCreate=true
    console.log(`[Z-ORDER] createRoom: joinRoom SUCCESS`);

    // 保存到我的房间列表(使用store方法)
    get().addOwnedRoom({
      roomId,
      roomName: roomName || roomId,
      password: password || undefined,
      createdAt: Date.now()
    });

    // 创建房间状态
    const newRoom: RoomState = {
      roomId,
      status: 'connected',
      role: 'host',
      isHost: true,  // 创建者是房主
      hasPassword: !!password,  // 是否设置了密码
      connectedUsers: [],
      error: null,
      logs: [`[${new Date().toLocaleTimeString()}] ✅ 通过服务器创建房间: ${roomId}${password ? ' (已设置密码)' : ''}`],
    };

    set(state => {
      // 新房间为唯一活跃连接，其它房间置离线
      const updatedRooms = { ...markOthersDisconnected(state.rooms, roomId), [roomId]: newRoom };
      return {
        rooms: updatedRooms,
        activeRoomId: roomId,
        ...getActiveRoomProps(updatedRooms, roomId),
      };
    });

    // 创建成功后同步服务器房间列表
    console.log('[ConnectionStore] Calling syncOwnedRoomsFromServer after createRoom');
    await get().syncOwnedRoomsFromServer();

    return roomId;
  },

  joinRoom: async (roomId: string, password?: string) => {
    const { username } = get();

    // 先确保没有旧连接
    if (serverConnection) {
      serverConnection.disconnect();
      serverConnection = null;
    }
    const conn = getServerConnection();

    // 设置临时状态
    const tempRoom: RoomState = {
      roomId,
      status: 'connecting',
      role: 'client',
      isHost: false,  // 暂时设为false,等待服务器响应
      connectedUsers: [],
      error: null,
      logs: [`[${new Date().toLocaleTimeString()}] 正在加入房间 ${roomId}...`],
    };

    set(state => {
      const updatedRooms = { ...state.rooms, [roomId]: tempRoom };
      return {
        rooms: updatedRooms,
        activeRoomId: roomId,
        ...getActiveRoomProps(updatedRooms, roomId),
      };
    });

    try {
      // 设置回调
      get()._setupServerCallbacks(roomId, conn);

      // 传递密码参数
      await conn.joinRoom(roomId, username || '匿名用户', password);

      // 如果提供了密码,缓存到localStorage
      if (password) {
        ServerConnection.saveRoomPassword(roomId, password);
      }

      // 注：房间历史（funapp-room-history）写入已下放到 RoomPanel（Bug 5：两套不兼容 schema 合一），
      // 此处不再写，避免格式冲突

      set(state => {
        const room = state.rooms[roomId];
        if (!room) return {};

        // 从连接获取 isHost 状态
        const isHost = conn.getIsHost();
        // 房主的密码状态从本地缓存读取（joinSuccess 时已同步）
        const hasPassword = isHost
          ? !!ServerConnection.getRoomPassword(roomId)
          : room.hasPassword;  // 非房主保持原值

        const updatedRoom: RoomState = {
          ...room,
          status: 'connected',
          isHost,
          hasPassword,
          role: isHost ? 'host' : 'client',
          logs: [...room.logs, `[${new Date().toLocaleTimeString()}] ✅ 成功加入房间 ${roomId}`],
        };
        // 该房间为唯一活跃连接，其它房间置离线
        const updatedRooms = { ...markOthersDisconnected(state.rooms, roomId), [roomId]: updatedRoom };
        return {
          rooms: updatedRooms,
          ...getActiveRoomProps(updatedRooms, state.activeRoomId),
        };
      });

      // 加入成功后同步服务器房间列表
      console.log('[ConnectionStore] Calling syncOwnedRoomsFromServer after joinRoom');
      await get().syncOwnedRoomsFromServer();
    } catch (err: any) {
      set(state => {
        const room = state.rooms[roomId];
        if (!room) return {};
        const updatedRoom: RoomState = {
          ...room,
          status: 'error',
          error: err.message || '加入房间失败',
          logs: [...room.logs, `[${new Date().toLocaleTimeString()}] ❌ 加入失败: ${err.message}`],
        };
        const updatedRooms = { ...state.rooms, [roomId]: updatedRoom };
        return {
          rooms: updatedRooms,
          ...getActiveRoomProps(updatedRooms, state.activeRoomId),
        };
      });
      throw err;
    }
  },

  disconnectRoom: (roomId: string) => {
    // 发送离开消息并清理连接
    const conn = serverConnection;
    if (conn) {
      conn.sendLeave(roomId);
      clearServerConnection();
    }
    set(state => {
      const { [roomId]: _, ...remainingRooms } = state.rooms;
      const roomIds = Object.keys(remainingRooms);
      const newActiveRoomId = state.activeRoomId === roomId
        ? (roomIds.length > 0 ? roomIds[0] : '')
        : state.activeRoomId;
      return {
        rooms: remainingRooms,
        activeRoomId: newActiveRoomId,
        ...getActiveRoomProps(remainingRooms, newActiveRoomId),
      };
    });
  },

  disconnectAll: () => {
    clearServerConnection();

    set({
      rooms: {},
      activeRoomId: '',
      status: 'disconnected',
      role: 'none',
      roomId: '',
      connectedUsers: [],
      error: null,
      logs: [],
    });
  },

  switchRoom: async (roomId: string) => {
    const { rooms, activeRoomId, username } = get();
    // 已是活跃房间或目标不存在：直接早退（现有语义）
    if (activeRoomId === roomId || !rooms[roomId]) return;

    // Bug 2：与 joinRoom action 一致——先断开旧单例连接并置空，再新建，
    // 避免复用旧连接时孤儿 socket 的 onclose 污染新房间状态并触发错位重连
    if (serverConnection) {
      serverConnection.disconnect();
      serverConnection = null;
    }
    const conn = getServerConnection();
    get()._setupServerCallbacks(roomId, conn);

    // 目标房间置 connecting 并切为活跃，其它房间置离线
    set(state => {
      const room = state.rooms[roomId];
      if (!room) return {};
      const switching: RoomState = { ...room, status: 'connecting', error: null };
      const updatedRooms = { ...markOthersDisconnected(state.rooms, roomId), [roomId]: switching };
      return {
        rooms: updatedRooms,
        activeRoomId: roomId,
        ...getActiveRoomProps(updatedRooms, roomId),
      };
    });

    try {
      // 尝试使用缓存密码加入房间
      const cachedPassword = ServerConnection.getRoomPassword(roomId);
      await conn.joinRoom(roomId, username || '匿名用户', cachedPassword);

      set(state => {
        const room = state.rooms[roomId];
        if (!room) return {};
        const isHost = conn.getIsHost();
        const updatedRoom: RoomState = {
          ...room,
          status: 'connected',
          isHost,
          role: isHost ? 'host' : 'client',
          logs: [...room.logs, `[${new Date().toLocaleTimeString()}] ✅ 已切换到房间 ${roomId}`],
        };
        const updatedRooms = { ...markOthersDisconnected(state.rooms, roomId), [roomId]: updatedRoom };
        return {
          rooms: updatedRooms,
          ...getActiveRoomProps(updatedRooms, roomId),
        };
      });
    } catch (err: any) {
      set(state => {
        const room = state.rooms[roomId];
        if (!room) return {};
        const updatedRoom: RoomState = {
          ...room,
          status: 'error',
          error: err.message || '切换房间失败',
          logs: [...room.logs, `[${new Date().toLocaleTimeString()}] ❌ 切换失败: ${err.message}`],
        };
        const updatedRooms = { ...state.rooms, [roomId]: updatedRoom };
        return {
          rooms: updatedRooms,
          ...getActiveRoomProps(updatedRooms, state.activeRoomId),
        };
      });
      throw err;
    }

    // 切换成功后同步服务器房间列表
    console.log('[ConnectionStore] Calling syncOwnedRoomsFromServer after switchRoom');
    await get().syncOwnedRoomsFromServer();
  },

  sendDanmaku: (danmaku: DanmakuMessage) => {
    const { activeRoomId } = get();
    if (!activeRoomId) return;

    // 使用当前连接发送
    const conn = serverConnection;
    if (conn) conn.sendDanmaku(danmaku);
  },
    clearError: () => {
    const { activeRoomId } = get();
    if (!activeRoomId) return;
    set(state => {
      const room = state.rooms[activeRoomId];
      if (!room) return {};
      const updatedRooms = {
        ...state.rooms,
        [activeRoomId]: { ...room, error: null, status: 'disconnected' as ConnectionStatus },
      };
      return { rooms: updatedRooms, error: null, status: 'disconnected' };
    });
  },

  setUsername: (name: string) => {
    localStorage.setItem('funapp-username', name);
    set({ username: name });
  },

  setPassword: (roomId: string, password: string) => {
    const { rooms } = get();

    const room = rooms[roomId];
    if (!room || !room.isHost) {
      console.warn('Only host can set password');
      return;
    }

    const conn = serverConnection;
    if (conn) conn.setPassword(password);

    // 保存到本地缓存（房主可以查看）
    if (password) {
      ServerConnection.saveRoomPassword(roomId, password);
    } else {
      ServerConnection.clearRoomPassword(roomId);
    }

    // 乐观更新本地状态
    set(state => ({
      rooms: {
        ...state.rooms,
        [roomId]: { ...state.rooms[roomId], hasPassword: !!password }
      }
    }));

    get().addLog(roomId,
      password ? `🔒 已设置房间密码` : '🔓 已清除房间密码'
    );
  },

  deleteRoom: async (roomId: string) => {
    // Bug 1：经 HTTP DELETE 等服务器确认，成功才移除本地，失败保留并弹提示——根除"删了又回来"
    const myUserId = localStorage.getItem('funapp-user-id') || undefined;
    const result = await ServerConnection.deleteRoomOnServer(roomId, myUserId);

    if (!result.ok) {
      // 删除失败：保留本地房间与 ownedRooms，弹出可见错误提示
      get().setNotice({ kind: 'error', message: result.message });
      get().addLog(roomId, `❌ 删除房间失败: ${result.message}`);
      return;
    }

    // 删除成功：先记日志（此时房间可能仍在 rooms 中），再清理本地状态
    get().addLog(roomId, `🗑️ 已删除房间: ${roomId}`);
    get().removeOwnedRoom(roomId);
    ServerConnection.clearRoomPassword(roomId);

    // 删的是当前活跃房间时，断开物理连接（避免孤儿连接的重连/回调）
    if (get().activeRoomId === roomId) {
      clearServerConnection();
    }

    // 从rooms状态中移除该房间
    set(state => {
      const { [roomId]: _, ...remainingRooms } = state.rooms;
      const newActiveRoomId = state.activeRoomId === roomId
        ? (Object.keys(remainingRooms)[0] || '')
        : state.activeRoomId;
      return {
        rooms: remainingRooms,
        activeRoomId: newActiveRoomId,
        ...getActiveRoomProps(remainingRooms, newActiveRoomId),
      };
    });

    get().setNotice({ kind: 'success', message: result.message });

    // 同步服务器房间列表
    await get().syncOwnedRoomsFromServer();
  },

  testServerConnection: async () => {
    const { activeRoomId } = get();
    if (!activeRoomId) return false;

    const room = get().rooms[activeRoomId];
    if (!room) return false;
    
    const conn = serverConnection;
    if (!conn) return false;
    return await conn.testServerConnection();
  },

  initCallbacks: (onDanmaku) => {
    set({ _onDanmaku: onDanmaku });
  },

  // 内部方法：为服务器模式设置回调
  _setupServerCallbacks: (roomId: string, connection: ServerConnection) => {
    const { _onDanmaku } = get();
    
    connection.setCallbacks({
      onDanmaku: (danmaku, isReplay) => {
        _onDanmaku?.(danmaku, roomId, isReplay);
      },
      onUserListUpdate: (users) => {
        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
          const updatedRooms = {
            ...state.rooms,
            [roomId]: { ...room, connectedUsers: users },
          };
          const props = state.activeRoomId === roomId
            ? { connectedUsers: users }
            : {};
          return { rooms: updatedRooms, ...props };
        });
        get().addLog(roomId, `在线用户更新: ${users.length} 人`);
      },
      onStatusChange: (status) => {
        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
          const updatedRooms = {
            ...state.rooms,
            [roomId]: { ...room, status },
          };
          const props = state.activeRoomId === roomId
            ? { status }
            : {};
          return { rooms: updatedRooms, ...props };
        });
        get().addLog(roomId, `连接状态: ${status}`);
      },
      onError: (error) => {
        set(state => {
          const room = state.rooms[roomId];
          if (!room) {
            return { error };
          }
          const updatedRooms = {
            ...state.rooms,
            [roomId]: { ...room, error },
          };
          const props = state.activeRoomId === roomId
            ? { error }
            : {};
          return { rooms: updatedRooms, ...props };
        });
        get().addLog(roomId, `❌ 错误: ${error}`);
      },
      onUserJoin: (user) => {
        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
          const updatedUsers = [...room.connectedUsers, user];
          const updatedRooms = {
            ...state.rooms,
            [roomId]: { ...room, connectedUsers: updatedUsers },
          };
          const props = state.activeRoomId === roomId
            ? { connectedUsers: updatedUsers }
            : {};
          return { rooms: updatedRooms, ...props };
        });
        get().addLog(roomId, `✅ 用户加入: ${user.username}`);
      },
      onUserLeave: (userId) => {
        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
          const updatedUsers = room.connectedUsers.filter(u => u.userId !== userId);
          const updatedRooms = {
            ...state.rooms,
            [roomId]: { ...room, connectedUsers: updatedUsers },
          };
          const props = state.activeRoomId === roomId
            ? { connectedUsers: updatedUsers }
            : {};
          return { rooms: updatedRooms, ...props };
        });
        get().addLog(roomId, `👋 用户离开: ${userId}`);
      },
      onServerNotice: (notice) => {
        // 服务器操作反馈镜像到 store，供 UI 弹提示
        get().setNotice(notice);
        get().addLog(roomId, notice.kind === 'error' ? `❌ ${notice.message}` : `✅ ${notice.message}`);
      },
      onRoomDeleted: (reason) => {
        console.log(`[Store] Room deleted: ${reason}`);
        // Bug 4：同步处理 + 幂等守卫（房间已被移除则直接返回，防与 HTTP 自删重复）
        if (!get().rooms[roomId]) return;

        get().addLog(roomId, `❌ 房间已被删除: ${reason}`);

        // 判断是否需要断开物理连接：仅当被删房间是当前活跃房间、且全局连接仍是本回调
        // 捕获的连接实例时才断开——防止竞态下（删除回调迟到）误断已切换到的新房间连接。
        const shouldClear = get().activeRoomId === roomId && serverConnection === connection;

        // 移除该房间并重算 activeRoomId / 便捷属性（不再调用会误发 leave 的 disconnectRoom）
        set(state => {
          const { [roomId]: _, ...remainingRooms } = state.rooms;
          const newActiveRoomId = state.activeRoomId === roomId
            ? (Object.keys(remainingRooms)[0] || '')
            : state.activeRoomId;
          return {
            rooms: remainingRooms,
            activeRoomId: newActiveRoomId,
            ...getActiveRoomProps(remainingRooms, newActiveRoomId),
          };
        });

        if (shouldClear) {
          clearServerConnection();
        }
      },
    });
  },
} as ConnectionState));