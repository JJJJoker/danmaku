// WebSocket 服务器中继连接（云端 danmaku-server）
// 由原 peerService.ts 拆分而来；P2P 模式已于 v1.5.0 移除，服务器中继是唯一联机方式
import { DanmakuMessage, RoomUser, ServerMessage } from '../../shared/types';
import { resolveServerUrl, deriveStatsUrl } from './serverConfig';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type PeerRole = 'host' | 'client' | 'none';

export interface PeerEventCallbacks {
  // isReplay=true 表示房间历史回放，仅用于展示，不触发朗读等副作用（当前服务器协议未下发回放，参数保留兼容）
  onDanmaku: (danmaku: DanmakuMessage, isReplay?: boolean) => void;
  onUserListUpdate: (users: RoomUser[]) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onError: (error: string) => void;
  onUserJoin: (user: RoomUser) => void;
  onUserLeave: (userId: string) => void;
  onRoomDeleted?: (reason: string) => void;
}

export class ServerConnection {
  private ws: WebSocket | null = null;
  private roomId: string = '';
  private userId: string = '';
  private username: string = '';
  private persistentUserId: string = ''; // 持久化userId,重连时复用
  private isHost: boolean = false;  // 是否是房主
  private callbacks: PeerEventCallbacks | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 15;
  private _intentionalDisconnect: boolean = false; // 标记是否为主动断开

  setCallbacks(callbacks: PeerEventCallbacks) {
    this.callbacks = callbacks;
  }

  async joinRoom(roomId: string, username: string, password?: string, isCreate?: boolean): Promise<void> {
    // 每次连接时重新解析地址，用户在设置中改地址后重连即生效
    const serverUrl = resolveServerUrl();
    if (!serverUrl) {
      const msg = '未配置服务器地址，请在「设置」中填写（如 ws://your-host:8080）';
      this.callbacks?.onError(msg);
      return Promise.reject(new Error(msg));
    }

    this.roomId = roomId;
    this._intentionalDisconnect = false; // 重置主动断开标志

    // 从 localStorage获取或生成持久化userId
    let persistentUserId = localStorage.getItem('funapp-user-id');
    if (!persistentUserId) {
      persistentUserId = Math.random().toString(36).substring(2, 8);
      localStorage.setItem('funapp-user-id', persistentUserId);
      console.log(`[ServerConnection] Generated new persistent user ID: ${persistentUserId}`);
    } else {
      console.log(`[ServerConnection] Using existing persistent user ID: ${persistentUserId}`);
    }

    this.persistentUserId = persistentUserId;
    this.username = username;
    // 注意: userId将在joinSuccess后由服务器分配

    return new Promise((resolve, reject) => {
      console.log(`[ServerConnection] Connecting to ${serverUrl}...`);

      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        console.log('[ServerConnection] Connected to server');

        // 发送加入房间消息(使用persistentUserId作为建议ID)
        this.send({
          type: 'join',
          payload: {
            roomId,
            userId: this.persistentUserId,  // 客户端提供的ID(可选)
            username,
            password: password || '',
            isCreate  // 是否是创建房间
          }
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);

          // 处理joinSuccess,获取服务器分配的userId
          if (message.type === 'joinSuccess') {
            this.userId = message.payload.userId;  // 保存服务器分配的ID
            this.isHost = message.payload.isHost;

            // 保存服务器分配的userId到本地存储，下次连接时复用
            if (this.userId && this.userId !== this.persistentUserId) {
              localStorage.setItem('funapp-user-id', this.userId);
              this.persistentUserId = this.userId;
              console.log(`[ServerConnection] Saved server-assigned userId: ${this.userId}`);
            }

            // 房主收到密码时保存到本地缓存
            if (message.payload.isHost && message.payload.password) {
              ServerConnection.saveRoomPassword(this.roomId, message.payload.password);
              console.log(`[ServerConnection] Password synced from server for room: ${this.roomId}`);
            } else if (message.payload.isHost && !message.payload.hasPassword) {
              // 房主进入无密码房间，清除本地缓存
              ServerConnection.clearRoomPassword(this.roomId);
            }

            console.log(`[ServerConnection] Joined room successfully, userId: ${this.userId}, isHost: ${this.isHost}, hasPassword: ${message.payload.hasPassword}`);
            this.startHeartbeat();
            resolve();
          } else if (message.type === 'joinError') {
            console.error(`[ServerConnection] Join failed: ${message.payload.message}`);
            this.callbacks?.onError(message.payload.message);
            reject(new Error(message.payload.message));
            return;
          }

          this.handleMessage(message);
        } catch (e) {
          console.error('[ServerConnection] Failed to parse message:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[ServerConnection] WebSocket error:', err);
        this.callbacks?.onError('连接服务器失败');
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[ServerConnection] Connection closed');
        this.stopHeartbeat();
        this.callbacks?.onStatusChange('disconnected');
        // 只在非主动断开时尝试重连
        if (!this._intentionalDisconnect) {
          this.attemptReconnect();
        } else {
          console.log('[ServerConnection] Intentional disconnect, not reconnecting');
        }
      };
    });
  }

  sendDanmaku(danmaku: DanmakuMessage) {
    this.send({
      type: 'danmaku',
      payload: danmaku
    });
  }

  sendLeave(roomId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'leave',
        payload: { roomId }
      }));
      console.log('[ServerConnection] Sent leave message for room:', roomId);
    }
  }

  setPassword(password: string): void {
    this.send({
      type: 'setPassword',
      payload: {
        roomId: this.roomId,
        password,
        userId: this.userId
      }
    });
    console.log(`[ServerConnection] Set password for room: ${this.roomId}`);
  }

  // 测试与服务器的通信
  async testServerConnection(): Promise<boolean> {
    // 简化为只检查WebSocket连接状态
    const isConnected = !!(this.ws && this.ws.readyState === WebSocket.OPEN);
    console.log(`[ServerConnection] Connection status: ${isConnected ? 'connected' : 'disconnected'}`);
    return isConnected;
  }

  // 获取是否是房主
  getIsHost(): boolean {
    return this.isHost;
  }

  // 获取用户唯一ID
  getUserId(): string {
    return this.userId;
  }

  private handleMessage(message: ServerMessage) {
    switch (message.type) {
      case 'danmaku':
        this.callbacks?.onDanmaku(message.payload);
        break;

      case 'user-list':
        console.log(`[ServerConnection] User list update: ${message.payload.users.length} users`);
        this.callbacks?.onUserListUpdate(message.payload.users);
        break;

      case 'pong':
        console.log(`[ServerConnection] Received pong, latency: ${Date.now() - message.payload.timestamp}ms`);
        break;

      case 'leave':
        this.callbacks?.onUserLeave(message.payload.userId);
        break;

      case 'roomDeleted':
        console.log(`[ServerConnection] Room deleted: ${message.payload.reason}`);
        this.callbacks?.onRoomDeleted?.(message.payload.reason);
        break;
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    console.log('[ServerConnection] Starting heartbeat (every 5s)');

    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'ping',
        payload: { timestamp: Date.now(), userId: this.userId }
      });
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('[ServerConnection] Heartbeat stopped');
    }
  }

  private send(message: ServerMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[ServerConnection] WebSocket not open, cannot send message');
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ServerConnection] Max reconnect attempts reached');
      this.callbacks?.onError('重连失败,请重新加入房间');
      this.callbacks?.onStatusChange('error');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;

    console.log(`[ServerConnection] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      // 重连时带上缓存的房间密码（避免有密码房间重连失败）；未配置地址时 joinRoom 会 reject，错误已经 onError 呈现
      this.joinRoom(this.roomId, this.username, ServerConnection.getRoomPassword(this.roomId)).catch(() => {});
    }, delay);
  }

  disconnect() {
    console.log('[ServerConnection] Disconnecting...');
    this._intentionalDisconnect = true; // 标记为主动断开，防止 onclose 触发重连
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // 先清除所有事件处理器，避免关闭时触发 onclose/attemptReconnect
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
  }

  deleteRoom(roomId: string): void {
    this.send({
      type: 'deleteRoom',
      payload: {
        roomId,
        userId: this.persistentUserId || this.userId // 优先使用持久化ID，服务器通过 hostRooms 验证权限
      }
    });
    console.log(`[ServerConnection] Requested to delete room: ${roomId}`);
  }

  // 从服务器获取房间统计信息
  async fetchServerStats(): Promise<{
    totalRooms: number;
    totalHosts: number;
    hostRooms: Record<string, { roomCount: number; rooms: string[] }>;
    rooms: Array<{ roomId: string; clientCount: number; hasPassword: boolean; age: number }>;
  } | null> {
    const statsUrl = deriveStatsUrl();
    if (!statsUrl) {
      console.warn('[ServerConnection] Server URL not configured, skip fetching stats');
      return null;
    }
    console.log(`[ServerConnection] Fetching stats from ${statsUrl}`);
    try {
      const response = await fetch(statsUrl);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const stats = await response.json();
      console.log('[ServerConnection] Stats received:', stats);
      return stats;
    } catch (e) {
      console.error('[ServerConnection] Failed to fetch server stats:', e);
      return null;
    }
  }

  // 保存房间密码到localStorage
  static saveRoomPassword(roomId: string, password: string): void {
    try {
      const passwords = JSON.parse(localStorage.getItem('funapp-room-passwords') || '{}');
      passwords[roomId] = password;
      localStorage.setItem('funapp-room-passwords', JSON.stringify(passwords));
      console.log(`[ServerConnection] Password saved for room: ${roomId}`);
    } catch (e) {
      console.error('Failed to save room password:', e);
    }
  }

  // 获取房间密码
  static getRoomPassword(roomId: string): string | undefined {
    try {
      const passwords = JSON.parse(localStorage.getItem('funapp-room-passwords') || '{}');
      return passwords[roomId];
    } catch (e) {
      console.error('Failed to get room password:', e);
      return undefined;
    }
  }

  // 清除房间密码
  static clearRoomPassword(roomId: string): void {
    try {
      const passwords = JSON.parse(localStorage.getItem('funapp-room-passwords') || '{}');
      delete passwords[roomId];
      localStorage.setItem('funapp-room-passwords', JSON.stringify(passwords));
    } catch (e) {
      console.error('Failed to clear room password:', e);
    }
  }

  // 获取持久化用户ID（服务器分配的唯一ID）
  static getPersistentUserId(): string | undefined {
    return localStorage.getItem('funapp-user-id') || undefined;
  }
}
