import Peer, { DataConnection } from 'peerjs';
import { PeerMessage, DanmakuMessage, RoomUser } from '../../shared/types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type PeerRole = 'host' | 'client' | 'none';

export interface PeerEventCallbacks {
  // isReplay=true 表示房间历史回放（init），仅用于展示，不触发朗读等副作用
  onDanmaku: (danmaku: DanmakuMessage, isReplay?: boolean) => void;
  onUserListUpdate: (users: RoomUser[]) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onError: (error: string) => void;
  onUserJoin: (user: RoomUser) => void;
  onUserLeave: (userId: string) => void;
  onRoomDeleted?: (reason: string) => void;
}

// 生成随机后缀（小写字母+数字）
export function generateRoomSuffix(length = 4): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 格式化房间ID：danmaku-{sanitized}-{4位随机}
export function formatRoomId(userInput: string): string {
  // 将输入转为安全的ASCII字符（去除非ASCII字符，保留字母数字和连字符下划线）
  const sanitized = userInput
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    || generateRoomSuffix(6); // 如果过滤后为空（如纯中文输入），使用随机字符串代替
  return `danmaku-${sanitized}-${generateRoomSuffix()}`;
}

// 每个房间连接用独立的 RoomConnection 实例
export class RoomConnection {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private usernames: Map<string, string> = new Map();
  private role: PeerRole = 'none';
  roomId: string = '';
  private userId: string = '';
  private username: string = '';
  private callbacks: PeerEventCallbacks | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 15;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hostConnection: DataConnection | null = null;
  // 心跳机制
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: number = 5000; // 5秒
  private heartbeatHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatResponseTime: number = 0;
  private consecutiveFailedHeartbeats: number = 0;
  private maxFailedHeartbeats: number = 3; // 连续3次失败判定为断开
  // 最近弹幕缓存（Host 端维护，用于新用户加入时推送历史）
  private recentDanmakus: DanmakuMessage[] = [];

  private generateId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  private getPeerId(roomId: string, userId: string, isHost: boolean): string {
    return isHost ? `${roomId}_host` : `${roomId}_${userId}`;
  }

  setCallbacks(callbacks: PeerEventCallbacks) {
    this.callbacks = callbacks;
  }

  // 启动Client端心跳(每5秒向Host发送ping)
  private startClientHeartbeat() {
    if (this.role !== 'client' || !this.hostConnection) {
      return;
    }

    // 清除旧的定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    console.log(`[RoomConnection:${this.roomId}] Starting client heartbeat (every ${this.heartbeatInterval / 1000}s)`);

    this.heartbeatTimer = setInterval(() => {
      const pingMessage: PeerMessage = {
        type: 'ping',
        payload: {
          timestamp: Date.now(),
          userId: this.userId,
          roomId: this.roomId
        }
      };

      try {
        if (this.hostConnection && this.hostConnection.open) {
          this.hostConnection.send(pingMessage);
          console.log(`[RoomConnection:${this.roomId}] Client sent heartbeat to host`);
        } else {
          console.warn(`[RoomConnection:${this.roomId}] Host connection not open, skipping heartbeat`);
        }
      } catch (err) {
        console.error(`[RoomConnection:${this.roomId}] Failed to send heartbeat:`, err);
      }
    }, this.heartbeatInterval);
  }

  // 停止心跳
  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log(`[RoomConnection:${this.roomId}] Heartbeat stopped`);
    }
  }

  // 启动心跳健康检查
  private startHeartbeatHealthCheck() {
    // 清除旧的检查定时器
    if (this.heartbeatHealthCheckTimer) {
      clearInterval(this.heartbeatHealthCheckTimer);
    }
    
    console.log(`[RoomConnection:${this.roomId}] Starting heartbeat health check`);
    
    this.heartbeatHealthCheckTimer = setInterval(() => {
      // 只在Client端执行检查
      if (this.role !== 'client') {
        return;
      }
      
      const timeSinceLastResponse = Date.now() - this.lastHeartbeatResponseTime;
      const heartbeatTimeout = this.heartbeatInterval * this.maxFailedHeartbeats; // 15秒
      
      if (timeSinceLastResponse > heartbeatTimeout && this.lastHeartbeatResponseTime > 0) {
        this.consecutiveFailedHeartbeats++;
        console.warn(`[RoomConnection:${this.roomId}] No heartbeat response for ${timeSinceLastResponse}ms (attempt ${this.consecutiveFailedHeartbeats})`);
        
        if (this.consecutiveFailedHeartbeats >= this.maxFailedHeartbeats) {
          console.error(`[RoomConnection:${this.roomId}] Connection unhealthy! Triggering reconnect...`);
          this.handleConnectionFailure();
        }
      }
    }, this.heartbeatInterval); // 每5秒检查一次
  }

  private stopHeartbeatHealthCheck() {
    if (this.heartbeatHealthCheckTimer) {
      clearInterval(this.heartbeatHealthCheckTimer);
      this.heartbeatHealthCheckTimer = null;
    }
  }

  // 处理连接失败
  private handleConnectionFailure() {
    console.log(`[RoomConnection:${this.roomId}] Handling connection failure...`);
    
    // 停止心跳和健康检查
    this.stopHeartbeat();
    this.stopHeartbeatHealthCheck();
    
    // 关闭当前连接
    if (this.hostConnection) {
      try {
        this.hostConnection.close();
      } catch (e) {
        // ignore
      }
      this.hostConnection = null;
    }
    
    // 触发重连
    this.attemptReconnectWithTimeout();
  }

  async createRoom(username?: string, roomName?: string, existingRoomId?: string): Promise<string> {
    this.userId = 'host';
    this.role = 'host';
    this.username = username || '匿名用户';
    this.usernames.set(this.userId, this.username);

    const maxRetries = 3;
    let attempt = 0;

    const tryCreate = (): Promise<string> => {
      return new Promise((resolve, reject) => {
        // 优先使用指定的 roomId（重新创建），否则根据 roomName 生成
        if (existingRoomId) {
          this.roomId = existingRoomId;
        } else if (roomName) {
          this.roomId = formatRoomId(roomName);
        } else {
          this.roomId = `danmaku-${generateRoomSuffix(6)}-${generateRoomSuffix()}`;
        }

        const peerId = this.getPeerId(this.roomId, this.userId, true);
        console.log(`[RoomConnection:${this.roomId}] Creating room, peer ID: ${peerId} (attempt ${attempt + 1})`);

        this.peer = new Peer(peerId, {
          host: '0.peerjs.com',
          port: 443,
          secure: true,
          debug: 1,
          config: {
            iceServers: [
              // STUN 服务器 (用于发现公网IP)
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              // 自建国内TURN服务器(优先使用,低延迟)
              { 
                urls: 'turn:REDACTED_SERVER_IP:3478',
                username: 'root',
                credential: 'REDACTED_CREDENTIAL'
              },
              {
                urls: 'turn:REDACTED_SERVER_IP:3478?transport=tcp',
                username: 'root',
                credential: 'REDACTED_CREDENTIAL'
              },
              // 免费公共 TURN 服务器 (当中继失败时使用)
              { 
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              },
              {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              },
              {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              }
            ],
          },
        });

        this.peer.on('open', (id) => {
          console.log(`[RoomConnection:${this.roomId}] Host started with ID:`, id);
          this.callbacks?.onStatusChange('connected');
          resolve(this.roomId);
        });

        this.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err: any) => {
          console.error(`[RoomConnection:${this.roomId}] Host error:`, err);

          // 处理 unavailable-id 错误
          if (err.type === 'unavailable-id' && attempt < maxRetries - 1) {
            attempt++;
            console.log(`[RoomConnection] Room ID conflict, retrying (attempt ${attempt + 1})...`);
            // 清理当前 peer
            if (this.peer) {
              this.peer.destroy();
              this.peer = null;
            }
            // 等待服务端释放后重试
            setTimeout(() => {
              tryCreate().then(resolve).catch(reject);
            }, 1000);
            return;
          }

          const errorMsg = err.type === 'unavailable-id'
            ? '房间名冲突，请尝试其他名称'
            : (err.message || 'Host connection error');
          this.callbacks?.onError(errorMsg);
          this.callbacks?.onStatusChange('error');
          reject(new Error(errorMsg));
        });

        this.peer.on('disconnected', () => {
          console.warn(`[RoomConnection:${this.roomId}] Host disconnected from signaling server`);
          this.peer?.reconnect();
        });
      });
    };

    return tryCreate();
  }

  async joinRoom(roomId: string, username?: string): Promise<void> {
    this.roomId = roomId;
    this.userId = this.generateId();
    this.role = 'client';
    this.username = username || '匿名用户';
    this.lastHeartbeatResponseTime = Date.now(); // 初始化
    this.consecutiveFailedHeartbeats = 0;

    return new Promise((resolve, reject) => {
      const peerId = this.getPeerId(this.roomId, this.userId, false);

      this.callbacks?.onStatusChange('connecting');

      this.peer = new Peer(peerId, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 2,
        config: {
          iceServers: [
            // STUN 服务器 (用于发现公网IP)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // 自建国内TURN服务器(优先使用,低延迟)
            { 
              urls: 'turn:REDACTED_SERVER_IP:3478',
              username: 'root',
              credential: 'REDACTED_CREDENTIAL'
            },
            {
              urls: 'turn:REDACTED_SERVER_IP:3478?transport=tcp',
              username: 'root',
              credential: 'REDACTED_CREDENTIAL'
            },
            // 免费公共 TURN 服务器 (当中继失败时使用)
            { 
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            }
          ],
        },
      });

      this.peer.on('open', () => {
        console.log(`[RoomConnection:${this.roomId}] Client peer opened with ID:`, peerId);
        this.connectToHost(resolve, reject);
      });

      this.peer.on('error', (err) => {
        console.error(`[RoomConnection:${this.roomId}] Client error:`, err);
        this.callbacks?.onError(err.message || 'Client connection error');
        this.callbacks?.onStatusChange('error');
        reject(err);
      });

      this.peer.on('disconnected', () => {
        console.warn(`[RoomConnection:${this.roomId}] Client disconnected from signaling server`);
        this.peer?.reconnect();
      });
    });
  }

  private connectToHost(resolve: () => void, reject: (err: Error) => void) {
    if (!this.peer) {
      reject(new Error('Peer not initialized'));
      return;
    }

    const hostId = this.getPeerId(this.roomId, 'host', true);
    console.log(`[RoomConnection:${this.roomId}] Attempting to connect to host:`, hostId);

    const conn = this.peer.connect(hostId, {
      reliable: true,
      serialization: 'json',
      metadata: { userId: this.userId, roomId: this.roomId, username: this.username },
    });

    const connectionTimeout = setTimeout(() => {
      console.error(`[RoomConnection:${this.roomId}] Connection timeout after 15s`);
      conn.close();
      this.callbacks?.onError(`连接超时：无法找到房间 ${this.roomId}，请确认房间号正确且对方在线`);
      this.callbacks?.onStatusChange('error');
      reject(new Error('Connection timeout'));
    }, 15000);

    conn.on('open', () => {
      clearTimeout(connectionTimeout);
      console.log(`[RoomConnection:${this.roomId}] Connected to host successfully!`);
      this.hostConnection = conn;
      this.connections.set('host', conn);
      this.reconnectAttempts = 0;
      this.callbacks?.onStatusChange('connected');
      
      // Client连接成功后,启动心跳
      this.startClientHeartbeat();
      
      // 启动健康检查
      this.lastHeartbeatResponseTime = Date.now(); // 初始化
      this.startHeartbeatHealthCheck();
      
      resolve();
    });

    conn.on('data', (data) => {
      this.handleReceivedData(data as PeerMessage);
    });

    conn.on('close', () => {
      clearTimeout(connectionTimeout);
      console.log(`[RoomConnection:${this.roomId}] Connection to host closed`);
      this.hostConnection = null;
      this.connections.delete('host');
      
      // Client与Host断开,停止心跳
      this.stopHeartbeat();
      
      this.callbacks?.onStatusChange('disconnected');
      this.attemptReconnect();
    });

    conn.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.error(`[RoomConnection:${this.roomId}] Connection error:`, err);
      this.callbacks?.onError(`连接失败：${err.message || '无法连接到房间主机'}`);
      this.callbacks?.onStatusChange('error');
      reject(err);
    });
  }

  private handleIncomingConnection(conn: DataConnection) {
    conn.on('open', () => {
      const remoteUserId = conn.metadata?.userId || conn.peer.split('_').pop() || 'unknown';
      const remoteUsername = conn.metadata?.username || '匿名用户';
      console.log(`[RoomConnection:${this.roomId}] Client connection OPENED, peer:`, conn.peer);

      this.connections.set(remoteUserId, conn);
      this.usernames.set(remoteUserId, remoteUsername);
      this.callbacks?.onUserJoin({ userId: remoteUserId, username: remoteUsername });

      // 向新用户推送最近10条历史弹幕
      if (this.recentDanmakus.length > 0) {
        const initMessage: PeerMessage = {
          type: 'init',
          payload: { danmakus: this.recentDanmakus.slice() },
        };
        try { conn.send(initMessage); } catch { }
      }

      this.broadcastUserList();
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      if (message.type === 'danmaku') {
        // Host 端缓存收到的弹幕
        this.recentDanmakus.push(message.payload);
        if (this.recentDanmakus.length > 10) this.recentDanmakus.shift();
        this.callbacks?.onDanmaku(message.payload);
        this.broadcastToOthers(message, conn.peer);
      } else if (message.type === 'leave') {
        // 客户端主动离开通知，立即更新用户列表
        const leavingUserId = message.payload.userId;
        this.connections.delete(leavingUserId);
        this.usernames.delete(leavingUserId);
        this.callbacks?.onUserLeave(leavingUserId);
        this.broadcastUserList();
      } else if (message.type === 'ping') {
        const clientId = message.payload.userId;
        console.log(`[RoomConnection:${this.roomId}] Host received heartbeat from client: ${clientId}`);
        
        // 回复pong确认
        const pongMessage: PeerMessage = {
          type: 'pong',
          payload: {
            timestamp: Date.now(),
            fromUserId: this.userId,
            toUserId: clientId
          }
        };
        
        try {
          conn.send(pongMessage);
          console.log(`[RoomConnection:${this.roomId}] Sent pong to client: ${clientId}`);
        } catch (err) {
          console.error(`[RoomConnection:${this.roomId}] Failed to send pong:`, err);
        }
        
        // 同时广播用户列表
        this.broadcastUserList();
        console.log(`[RoomConnection:${this.roomId}] Broadcasted updated user list after receiving heartbeat`);
      }
    });

    conn.on('close', () => {
      const remoteUserId = conn.metadata?.userId || conn.peer.split('_').pop() || 'unknown';
      console.log(`[RoomConnection:${this.roomId}] Client disconnected: ${remoteUserId}`);
      this.connections.delete(remoteUserId);
      this.callbacks?.onUserLeave(remoteUserId);
      this.broadcastUserList();
    });

    conn.on('error', (err) => {
      console.error(`[RoomConnection:${this.roomId}] Connection error with ${conn.peer}:`, err);
    });
  }

  private handleReceivedData(message: PeerMessage) {
    switch (message.type) {
      case 'danmaku':
        this.callbacks?.onDanmaku(message.payload);
        break;
      case 'user-list':
        this.callbacks?.onUserListUpdate(message.payload.users);
        break;
      case 'init':
        message.payload.danmakus.forEach((d) => {
          this.callbacks?.onDanmaku(d, true);
        });
        break;
      case 'leave':
        // Host 广播的离开通知（其他客户端收到）
        this.callbacks?.onUserLeave(message.payload.userId);
        break;
      case 'ping':
        console.log(`[RoomConnection:${this.roomId}] Received ping!`, message.payload);
        break;
      case 'pong':
        console.log(`[RoomConnection:${this.roomId}] Received pong from host, latency: ${Date.now() - message.payload.timestamp}ms`);
        this.lastHeartbeatResponseTime = Date.now();
        this.consecutiveFailedHeartbeats = 0; // 重置失败计数
        break;
    }
  }

  sendDanmaku(danmaku: DanmakuMessage) {
    const danmakuWithSender = { ...danmaku, sender: danmaku.sender || this.username };

    // Host 端缓存最近10条弹幕
    if (this.role === 'host') {
      this.recentDanmakus.push(danmakuWithSender);
      if (this.recentDanmakus.length > 10) this.recentDanmakus.shift();
    }

    const message: PeerMessage = {
      type: 'danmaku',
      payload: danmakuWithSender,
    };

    if (this.role === 'host') {
      this.broadcastToAll(message);
      this.callbacks?.onDanmaku(danmakuWithSender);
    } else if (this.role === 'client') {
      if (this.hostConnection?.open) {
        this.hostConnection.send(message);
      }
      this.callbacks?.onDanmaku(danmakuWithSender);
    }
  }

  private broadcastToAll(message: PeerMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send(message);
        } catch (err) {
          console.error(`[RoomConnection:${this.roomId}] Broadcast error:`, err);
        }
      }
    });
  }

  private broadcastToOthers(message: PeerMessage, senderId: string) {
    this.connections.forEach((conn) => {
      if (conn.open && conn.peer !== senderId) {
        try {
          conn.send(message);
        } catch (err) {
          console.error(`[RoomConnection:${this.roomId}] Broadcast error:`, err);
        }
      }
    });
  }

  private broadcastUserList() {
    const users: RoomUser[] = Array.from(this.connections.keys()).map(userId => ({
      userId,
      username: this.usernames.get(userId) || '匿名用户',
    }));
    const message: PeerMessage = {
      type: 'user-list',
      payload: { users },
    };
    this.broadcastToAll(message);
    this.callbacks?.onUserListUpdate(users);
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[RoomConnection:${this.roomId}] Max reconnect attempts reached`);
      this.callbacks?.onError('无法重新连接，已超过最大重试次数');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[RoomConnection:${this.roomId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      if (this.role === 'client' && this.peer) {
        this.callbacks?.onStatusChange('connecting');
        this.connectToHost(
          () => console.log(`[RoomConnection:${this.roomId}] Reconnected successfully`),
          () => this.attemptReconnect()
        );
      }
    }, delay);
  }

  testConnection(): boolean {
    if (this.role === 'host') {
      this.connections.forEach((conn, key) => {
        if (conn.open) {
          try {
            const pingMsg: PeerMessage = { type: 'ping', payload: { timestamp: Date.now() } };
            conn.send(pingMsg);
          } catch (e) {
            console.error(`[RoomConnection:${this.roomId}] FAILED to send to ${key}:`, e);
          }
        }
      });
      return this.connections.size > 0;
    } else if (this.role === 'client') {
      if (this.hostConnection?.open) {
        try {
          const pingMsg: PeerMessage = { type: 'ping', payload: { timestamp: Date.now() } };
          this.hostConnection.send(pingMsg);
          return true;
        } catch (e) {
          return false;
        }
      }
      return false;
    }
    return false;
  }

  getRole(): PeerRole {
    return this.role;
  }
  getRoomId(): string {
    return this.roomId;
  }
  getUserId(): string {
    return this.userId;
  }
  getUsername(): string {
    return this.username;
  }
  getConnectedUsers(): RoomUser[] {
    return Array.from(this.connections.keys()).map(userId => ({
      userId,
      username: this.usernames.get(userId) || '匿名用户',
    }));
  }

  // 带超时的重连机制
  private attemptReconnectWithTimeout() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[RoomConnection:${this.roomId}] Max reconnect attempts reached`);
      this.callbacks?.onError('连接已断开,重连失败。请检查网络或重新加入房间。');
      this.callbacks?.onStatusChange('error');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    
    console.log(`[RoomConnection:${this.roomId}] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      if (!this.peer || this.peer.destroyed) {
        // 重新创建Peer
        const peerId = this.getPeerId(this.roomId, this.userId, false);
        this.peer = new Peer(peerId, {
          host: '0.peerjs.com',
          port: 443,
          secure: true,
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { 
                urls: 'turn:REDACTED_SERVER_IP:3478',
                username: 'root',
                credential: 'REDACTED_CREDENTIAL'
              },
              {
                urls: 'turn:REDACTED_SERVER_IP:3478?transport=tcp',
                username: 'root',
                credential: 'REDACTED_CREDENTIAL'
              },
              { 
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              },
              {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              },
              {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
              }
            ],
          },
        });
        
        this.peer.on('open', () => {
          console.log(`[RoomConnection:${this.roomId}] Peer reopened, connecting to host...`);
          this.connectToHostWithTimeout();
        });
      } else {
        this.connectToHostWithTimeout();
      }
    }, delay);
  }

  private connectToHostWithTimeout() {
    if (!this.peer) {
      this.callbacks?.onError('Peer not initialized');
      return;
    }
    
    const hostId = this.getPeerId(this.roomId, 'host', true);
    console.log(`[RoomConnection:${this.roomId}] Connecting to host: ${hostId}`);
    
    const conn = this.peer.connect(hostId, {
      reliable: true,
      serialization: 'json',
      metadata: { userId: this.userId, roomId: this.roomId, username: this.username },
    });
    
    // 设置连接超时(10秒)
    const connectionTimeout = setTimeout(() => {
      console.error(`[RoomConnection:${this.roomId}] Reconnection timeout`);
      conn.close();
      this.callbacks?.onError('重连超时,请检查网络号是否正确且对方在线');
      this.callbacks?.onStatusChange('error');
      this.attemptReconnectWithTimeout(); // 继续重试
    }, 10000);
    
    conn.on('open', () => {
      clearTimeout(connectionTimeout);
      console.log(`[RoomConnection:${this.roomId}] Reconnected successfully!`);
      this.hostConnection = conn;
      this.connections.set('host', conn);
      this.reconnectAttempts = 0; // 重置重连计数
      this.consecutiveFailedHeartbeats = 0;
      this.lastHeartbeatResponseTime = Date.now();
      
      // 重新启动心跳和健康检查
      this.startClientHeartbeat();
      this.startHeartbeatHealthCheck();
      
      this.callbacks?.onStatusChange('connected');
    });
    
    conn.on('close', () => {
      clearTimeout(connectionTimeout);
      console.log(`[RoomConnection:${this.roomId}] Reconnection failed, connection closed`);
      this.attemptReconnectWithTimeout();
    });
    
    conn.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.error(`[RoomConnection:${this.roomId}] Reconnection error:`, err);
      this.attemptReconnectWithTimeout();
    });
    
    conn.on('data', (data) => {
      this.handleReceivedData(data as PeerMessage);
    });
  }

  disconnect() {
    // 停止心跳
    this.stopHeartbeat();
    // 停止健康检查
    this.stopHeartbeatHealthCheck();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 主动发送离开通知，确保对方及时更新用户列表
    const leaveMessage: PeerMessage = { type: 'leave', payload: { userId: this.userId } };
    if (this.role === 'client' && this.hostConnection?.open) {
      try { this.hostConnection.send(leaveMessage); } catch { }
    } else if (this.role === 'host') {
      this.broadcastToAll(leaveMessage);
    }

    this.connections.forEach((conn) => {
      try {
        conn.close();
      } catch (e) {
        // ignore
      }
    });
    this.connections.clear();
    this.hostConnection = null;

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.role = 'none';
    this.roomId = '';
    this.userId = '';
    this.username = '';
    this.usernames.clear();
    this.reconnectAttempts = 0;
    this.callbacks?.onStatusChange('disconnected');
  }
}

// PeerService 管理多个 RoomConnection
class PeerService {
  private rooms: Map<string, RoomConnection> = new Map();

  async createRoom(username?: string, roomName?: string, existingRoomId?: string): Promise<{ roomId: string; connection: RoomConnection }> {
    // 重新创建时，先清理旧连接
    if (existingRoomId && this.rooms.has(existingRoomId)) {
      this.disconnectRoom(existingRoomId);
      // 等待 PeerJS 服务端释放 peer ID
      await new Promise(r => setTimeout(r, 500));
    }
    const connection = new RoomConnection();
    const roomId = await connection.createRoom(username, roomName, existingRoomId);
    this.rooms.set(roomId, connection);
    return { roomId, connection };
  }

  async joinRoom(roomId: string, username?: string): Promise<RoomConnection> {
    const connection = new RoomConnection();
    await connection.joinRoom(roomId, username);
    this.rooms.set(roomId, connection);
    return connection;
  }

  disconnectRoom(roomId: string): void {
    const connection = this.rooms.get(roomId);
    if (connection) {
      connection.disconnect();
      this.rooms.delete(roomId);
    }
  }

  disconnectAll(): void {
    this.rooms.forEach((connection) => {
      connection.disconnect();
    });
    this.rooms.clear();
  }

  sendDanmaku(roomId: string, danmaku: DanmakuMessage): void {
    const connection = this.rooms.get(roomId);
    if (connection) {
      connection.sendDanmaku(danmaku);
    }
  }

  getRoom(roomId: string): RoomConnection | undefined {
    return this.rooms.get(roomId);
  }

  getRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  setCallbacks(roomId: string, callbacks: PeerEventCallbacks): void {
    const connection = this.rooms.get(roomId);
    if (connection) {
      connection.setCallbacks(callbacks);
    }
  }

  testConnection(roomId: string): boolean {
    const connection = this.rooms.get(roomId);
    if (connection) {
      return connection.testConnection();
    }
    return false;
  }
}

// ==================== WebSocket服务器连接 ====================

// 服务器消息类型定义
export type ServerMessage =
  | { type: 'danmaku'; payload: DanmakuMessage }
  | { type: 'user-list'; payload: { users: RoomUser[] } }
  | { type: 'init'; payload: { danmakus: DanmakuMessage[] } }
  | { type: 'ping'; payload: { timestamp: number; userId: string } }
  | { type: 'pong'; payload: { timestamp: number } }
  | { type: 'join'; payload: { roomId: string; userId: string; username: string } }
  | { type: 'leave'; payload: { userId: string } };

export class ServerConnection {
  private ws: WebSocket | null = null;
  private roomId: string = '';
  private userId: string = '';
  private username: string = '';
  private persistentUserId: string = ''; // 持久化userId,重连时复用
  private isHost: boolean = false;  // 新增: 是否是房主
  private callbacks: PeerEventCallbacks | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 15;
  private _intentionalDisconnect: boolean = false; // 标记是否为主动断开
  
  private SERVER_URL = 'ws://REDACTED_SERVER_IP:8080'; // 你的云服务器地址

  setCallbacks(callbacks: PeerEventCallbacks) {
    this.callbacks = callbacks;
  }

  async joinRoom(roomId: string, username: string, password?: string, isCreate?: boolean): Promise<void> {
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
      console.log(`[ServerConnection] Connecting to ${this.SERVER_URL}...`);
      
      this.ws = new WebSocket(this.SERVER_URL);

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
    const isConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
    console.log(`[ServerConnection] Connection status: ${isConnected ? 'connected' : 'disconnected'}`);
    return isConnected;
  }

  // 新增方法: 获取是否是房主
  getIsHost(): boolean {
    return this.isHost;
  }

  // 新增方法: 获取用户唯一ID
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
      this.joinRoom(this.roomId, this.username);
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
    console.log('[ServerConnection] Fetching stats from http://REDACTED_SERVER_IP:8081/stats');
    try {
      const response = await fetch('http://REDACTED_SERVER_IP:8081/stats');
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

// 单例导出
export const peerService = new PeerService();
