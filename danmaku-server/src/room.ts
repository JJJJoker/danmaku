import { WebSocket } from 'ws';
import { DanmakuMessage, RoomUser } from './types';

interface ClientInfo {
  ws: WebSocket;
  userId: string;
  username: string;
  lastHeartbeat: number;
}

/** 从 SQLite 恢复房间时的初始状态（服务重启后由 DanmakuServer 传入） */
export interface RoomRestoreState {
  createdAt: number;
  password: string;
  hostUserId: string;
  emptySince: number | null;
}

export class Room {
  private clients: Map<string, ClientInfo> = new Map();
  readonly roomId: string;
  readonly createdAt: number = Date.now();
  private password: string = '';  // 房间密码,空字符串表示无密码
  private hostUserId: string = '';  // 房主userId
  private emptySince: number | null = null;  // 房间变空的时间戳

  constructor(roomId: string, restore?: RoomRestoreState) {
    this.roomId = roomId;
    if (restore) {
      this.createdAt = restore.createdAt;
      this.password = restore.password;
      this.hostUserId = restore.hostUserId;
      this.emptySince = restore.emptySince;
    }
  }
  
  setHost(userId: string) {
    this.hostUserId = userId;
  }
  
  getHostUserId(): string {
    return this.hostUserId;
  }
  
  setPassword(password: string, userId: string): boolean {
    // 只有房主可以设置密码
    if (userId !== this.hostUserId) {
      return false;
    }
    this.password = password;
    return true;
  }
  
  hasPassword(): boolean {
    return this.password.length > 0;
  }

  // 获取实际密码（仅发给房主）
  getPassword(): string {
    return this.password;
  }
  
  verifyPassword(password: string): boolean {
    if (!this.hasPassword()) {
      return true;  // 没有密码,任何人都可以加入
    }
    return this.password === password;
  }

  addClient(ws: WebSocket, userId: string, username: string) {
    this.clients.set(userId, { ws, userId, username, lastHeartbeat: Date.now() });
    
    // 有人加入，重置空房间计时
    this.emptySince = null;
    
    // 发送初始化数据给新加入的客户端
    // 广播用户列表更新
    this.broadcastUserList();
    
    console.log(`[Room:${this.roomId}] User joined: ${userId} (${username}), count: ${this.clients.size}`);
  }

  removeClient(userId: string) {
    const client = this.clients.get(userId);
    if (client) {
      this.clients.delete(userId);
      try {
        client.ws.close();
      } catch (e) {
        // ignore
      }
      
      // 广播用户离开
      this.broadcast({
        type: 'leave',
        payload: { userId }
      });
      
      // 广播用户列表更新
      this.broadcastUserList();
      
      console.log(`[Room:${this.roomId}] User left: ${userId}, count: ${this.clients.size}`);
    }
  }

  handleDanmaku(userId: string, danmaku: DanmakuMessage) {
    // 添加到缓存
    // 转发给房间内所有其他客户端
    this.broadcast({
      type: 'danmaku',
      payload: danmaku
    }, userId); // 排除发送者
    
    console.log(`[Room:${this.roomId}] Danmaku from ${userId}: ${danmaku.text}`);
  }

  handleHeartbeat(userId: string) {
    const client = this.clients.get(userId);
    if (client) {
      client.lastHeartbeat = Date.now();
      
      // 回复pong
      try {
        client.ws.send(JSON.stringify({
          type: 'pong',
          payload: { timestamp: Date.now() }
        }));
      } catch (e) {
        console.error(`Failed to send pong to ${userId}`);
      }
    }
  }

  private broadcastUserList() {
    const users: RoomUser[] = Array.from(this.clients.values()).map(c => ({
      userId: c.userId,
      username: c.username
    }));
    
    this.broadcast({
      type: 'user-list',
      payload: { users }
    });
  }

  broadcast(message: any, excludeUserId?: string) {
    const msgStr = JSON.stringify(message);
    this.clients.forEach((client, userId) => {
      if (userId !== excludeUserId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(msgStr);
        } catch (e) {
          console.error(`Failed to send to ${userId}:`, e);
        }
      }
    });
  }

  checkHealth(interval: number = 30000) {
    const now = Date.now();
    const toRemove: string[] = [];
    
    this.clients.forEach((client, userId) => {
      if (now - client.lastHeartbeat > interval) {
        console.log(`[Room:${this.roomId}] Client timeout: ${userId}`);
        toRemove.push(userId);
      }
    });
    
    toRemove.forEach(userId => this.removeClient(userId));
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): Map<string, ClientInfo> {
    return this.clients;
  }

  // 标记房间为空，开始计时
  markEmpty() {
    if (this.emptySince === null) {
      this.emptySince = Date.now();
      console.log(`[Room:${this.roomId}] Marked as empty at ${new Date(this.emptySince).toISOString()}`);
    }
  }

  // 获取房间为空的时间戳，如果不是空的则返回null
  getEmptySince(): number | null {
    return this.emptySince;
  }
}
