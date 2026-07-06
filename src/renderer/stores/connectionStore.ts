import { create } from 'zustand';
import { peerService, ServerConnection, ConnectionStatus, PeerRole, RoomConnection } from '../services/peerService';
import { DanmakuMessage, RoomUser } from '../../shared/types';

// ServerConnection单例（同一时间只连接一个房间，切换房间时重新连接）
let serverConnection: ServerConnection | null = null;

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

  // 新增: 连接模式
  connectionMode: 'p2p' | 'server';
  setConnectionMode: (mode: 'p2p' | 'server') => void;

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
  testConnection: () => boolean;
  testServerConnection: () => Promise<boolean>;  // 新增: 测试服务器连接
  addLog: (roomId: string, message: string) => void;
  clearLogs: () => void;
  setUsername: (name: string) => void;
  setPassword: (roomId: string, password: string) => void;  // 新增
  deleteRoom: (roomId: string) => Promise<void>;  // 新增

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
  // 内部：为P2P房间设置回调
  _setupRoomCallbacks: (roomId: string, connection: RoomConnection) => void;
  // 内部：为服务器模式设置回调
  _setupServerCallbacks: (roomId: string, connection: ServerConnection) => void;
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

  // 连接模式配置
  connectionMode: (localStorage.getItem('funapp-connectionMode') as 'p2p' | 'server') || 'server',
  
  setConnectionMode: (mode) => {
    localStorage.setItem('funapp-connectionMode', mode);
    set({ connectionMode: mode });
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
    const { username, rooms, connectionMode } = get();
    console.log(`[Z-ORDER] createRoom START: connectionMode=${connectionMode}`);

    if (connectionMode === 'server') {
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
      
      // 创建成功后同步服务器房间列表
      console.log('[ConnectionStore] Calling syncOwnedRoomsFromServer after createRoom');
      await get().syncOwnedRoomsFromServer();
      
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
        const updatedRooms = { ...state.rooms, [roomId]: newRoom };
        return {
          rooms: updatedRooms,
          activeRoomId: roomId,
          ...getActiveRoomProps(updatedRooms, roomId),
        };
      });
      
      // 创建成功后同步服务器房间列表
      await get().syncOwnedRoomsFromServer();
      
      return roomId;
    } else {
      // 原有的P2P逻辑
      // 重新创建时，先从peerService store 中移除旧房间状态
      if (existingRoomId && rooms[existingRoomId]) {
        set(state => {
          const { [existingRoomId]: _, ...remainingRooms } = state.rooms;
          return { rooms: remainingRooms };
        });
      }

      try {
        const { roomId, connection } = await peerService.createRoom(username || undefined, roomName, existingRoomId);

        const newRoom: RoomState = {
          roomId,
          status: 'connected',
          role: 'host',
          isHost: true,
          connectedUsers: [],
          error: null,
          logs: [`[${new Date().toLocaleTimeString()}] ✅ 房间创建成功: ${roomId}`],
        };

        // 设置回调
        get()._setupRoomCallbacks(roomId, connection);

        set(state => {
          const updatedRooms = { ...state.rooms, [roomId]: newRoom };
          return {
            rooms: updatedRooms,
            activeRoomId: roomId,
            ...getActiveRoomProps(updatedRooms, roomId),
          };
        });

        return roomId;
      } catch (err: any) {
        throw err;
      }
    }
  },
    joinRoom: async (roomId: string, password?: string) => {
    const { username, connectionMode } = get();

    if (connectionMode === 'server') {
      // 使用ServerConnection，先确保没有旧连接
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
        
        // 保存到历史房间列表
        const history = JSON.parse(localStorage.getItem('funapp-room-history') || '[]');
        const existingIndex = history.findIndex((r: any) => r.roomId === roomId);
        
        const historyItem = {
          roomId,
          roomName: roomId,
          password: password || ServerConnection.getRoomPassword(roomId),
          lastJoined: Date.now(),
          role: conn.getIsHost() ? 'host' : 'guest'
        };
        
        if (existingIndex >= 0) {
          history.splice(existingIndex, 1);
        }
        history.unshift(historyItem);
        localStorage.setItem('funapp-room-history', JSON.stringify(history.slice(0, 50)));

        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
                  
          // 从 peerService 获取 isHost 状态
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
          const updatedRooms = { ...state.rooms, [roomId]: updatedRoom };
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
    } else {
      // 原有的P2P逻辑
      // 创建临时状态
      const tempRoom: RoomState = {
        roomId,
        status: 'connecting',
        role: 'client',
        isHost: false,
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
        const connection = await peerService.joinRoom(roomId, username || undefined);

        // 设置回调
        get()._setupRoomCallbacks(roomId, connection);

        set(state => {
          const room = state.rooms[roomId];
          if (!room) return {};
          const updatedRoom: RoomState = {
            ...room,
            status: 'connected',
            logs: [...room.logs, `[${new Date().toLocaleTimeString()}] ✅ 成功加入房间 ${roomId}`],
          };
          const updatedRooms = { ...state.rooms, [roomId]: updatedRoom };
          return {
            rooms: updatedRooms,
            ...getActiveRoomProps(updatedRooms, state.activeRoomId),
          };
        });
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
    }
  },

  disconnectRoom: (roomId: string) => {
    const { connectionMode } = get();
    if (connectionMode === 'server') {
      // 发送离开消息并清理连接
      const conn = serverConnection;
      if (conn) {
        conn.sendLeave(roomId);
        clearServerConnection();
      }
    } else {
      peerService.disconnectRoom(roomId);
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
    const { connectionMode } = get();
    
    // 如果使用服务器模式,断开连接
    if (connectionMode === 'server') {
      clearServerConnection();
    }
    
    // 断开P2P连接
    peerService.disconnectAll();
    
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
    const { rooms, activeRoomId, connectionMode, username } = get();
    if (!rooms[roomId]) return;
    
    // 服务器模式：需要重新加入目标房间
    if (connectionMode === 'server' && activeRoomId !== roomId) {
      const conn = getServerConnection();
      get()._setupServerCallbacks(roomId, conn);
      // 尝试使用缓存密码加入房间
      const cachedPassword = ServerConnection.getRoomPassword(roomId);
      await conn.joinRoom(roomId, username || '匿名用户', cachedPassword);
    }
    
    set({
      activeRoomId: roomId,
      ...getActiveRoomProps(rooms, roomId),
    });
    
    // 切换成功后同步服务器房间列表
    if (connectionMode === 'server') {
      console.log('[ConnectionStore] Calling syncOwnedRoomsFromServer after switchRoom');
      await get().syncOwnedRoomsFromServer();
    }
  },

  sendDanmaku: (danmaku: DanmakuMessage) => {
    const { activeRoomId, connectionMode } = get();
    if (!activeRoomId) return;
    
    if (connectionMode === 'server') {
      // 使用当前连接发送
      const conn = serverConnection;
      if (conn) conn.sendDanmaku(danmaku);
    } else {
      // 使用P2P发送
      peerService.sendDanmaku(activeRoomId, danmaku);
    }
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
    const { rooms, connectionMode } = get();
    
    if (connectionMode === 'server') {
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
    }
  },

  deleteRoom: async (roomId: string) => {
    const { connectionMode } = get();
    
    if (connectionMode === 'server') {
      // 使用当前连接发送删除消息（服务器通过 hostRooms 映射验证权限，不需要在目标房间内）
      const myUserId = localStorage.getItem('funapp-user-id');
      const conn = serverConnection;
      
      if (conn && myUserId) {
        // 发送删除请求，服务器会验证用户是否是房主
        conn.deleteRoom(roomId);
        console.log(`[ConnectionStore] Sent delete request for room: ${roomId}`);
      } else {
        console.warn('[ConnectionStore] No connection or userId, skipping server delete');
      }
      
      // 从我的房间列表中移除
      get().removeOwnedRoom(roomId);
      
      // 清除密码缓存
      ServerConnection.clearRoomPassword(roomId);
      
      get().addLog(roomId, `🗑️ 已删除房间: ${roomId}`);
      
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
      
      // 同步服务器房间列表
      await get().syncOwnedRoomsFromServer();
    }
  },

  testConnection: () => {
    const { activeRoomId } = get();
    if (!activeRoomId) return false;
    return peerService.testConnection(activeRoomId);
  },

  testServerConnection: async () => {
    const { activeRoomId, connectionMode } = get();
    if (!activeRoomId) return false;
    
    const room = get().rooms[activeRoomId];
    if (!room || connectionMode !== 'server') return false;
    
    const conn = serverConnection;
    if (!conn) return false;
    return await conn.testServerConnection();
  },

  initCallbacks: (onDanmaku) => {
    set({ _onDanmaku: onDanmaku });
  },

  // 内部方法：为指定房间设置回调
  _setupRoomCallbacks: (roomId: string, connection: RoomConnection) => {
    const { _onDanmaku } = get();

    connection.setCallbacks({
      onDanmaku: (danmaku, isReplay) => {
        // 弹幕回调始终携带 roomId，由外部决定是否显示
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
        get().addLog(roomId, `✅ 用户加入: ${user.username} (${user.userId})`);
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
    });
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
      onRoomDeleted: (reason) => {
        console.log(`[Store] Room deleted: ${reason}`);
        get().addLog(roomId, `❌ 房间已被删除: ${reason}`);
        
        // 断开连接
        setTimeout(() => {
          get().disconnectRoom(roomId);
        }, 1000);
      },
    });
  },
} as ConnectionState));