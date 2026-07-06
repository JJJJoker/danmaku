import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { createServer } from 'http';
import { Room } from './room';
import { ServerMessage } from './types';
import { isUpdatesRequest, serveUpdateFile } from './updates-static';

const PORT = parseInt(process.env.PORT || '8080', 10);

class DanmakuServer {
  private wss: WebSocketServer;
  private rooms: Map<string, Room> = new Map();
  
  // 新增: 用户会话映射 userId -> { ws, roomId }
  private userSessions: Map<string, { ws: WebSocket; roomId: string }> = new Map();
  
  // 新增: 房主到房间列表的映射 userId -> [roomId1, roomId2, ...]
  private hostRooms: Map<string, string[]> = new Map();
  
  // IP 到 userId 的映射，确保同一 IP 始终同一个用户 ID
  private ipToUserId: Map<string, string> = new Map();
  
  // 房间配置
  private readonly MAX_ROOMS = 100; // 最大房间数
  private readonly MAX_USERS_PER_ROOM = 50; // 每个房间最大用户数
  private readonly ROOM_TTL = 3600000; // 房间存活时间(1小时)
  private readonly EMPTY_ROOM_TTL = 86400000; // 空房间存活时间(24小时) - 房主创建的房间保留更久
  private readonly MAX_ROOMS_PER_HOST = 2; // 每个用户最多创建2个房间

  constructor() {
    this.wss = new WebSocketServer({ port: PORT });
    
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      console.log('[Server] New connection from', req.socket.remoteAddress);
      
      let currentRoom: Room | null = null;
      let userId: string = '';
      let roomId: string = '';  // 新增: 保存当前房间ID

      ws.on('message', (data: string) => {
        try {
          const message: ServerMessage = JSON.parse(data.toString());
          
          switch (message.type) {
            case 'join':
              const { roomId: newRoomId, userId: providedUserId, username, password, isCreate } = message.payload;
              
              // 保存当前房间ID
              roomId = newRoomId;
              
              // 基于 IP 分配固定 userId，同一 IP 始终同一个 ID
              const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
              
              if (this.ipToUserId.has(clientIp)) {
                // 同一 IP 返回已有 ID
                userId = this.ipToUserId.get(clientIp)!;
                console.log(`[Server] IP ${clientIp} -> existing userId: ${userId}`);
              } else if (providedUserId && !Array.from(this.ipToUserId.values()).includes(providedUserId)) {
                // 客户端提供的 ID 未被占用，使用它
                userId = providedUserId;
                this.ipToUserId.set(clientIp, userId);
                console.log(`[Server] IP ${clientIp} -> adopted provided userId: ${userId}`);
              } else {
                // 生成新 ID
                userId = `u${Math.random().toString(36).substring(2, 8)}`;
                this.ipToUserId.set(clientIp, userId);
                console.log(`[Server] IP ${clientIp} -> new userId: ${userId}`);
              }
              
              let existingSession = null;
              
              if (this.userSessions.has(userId)) {
                existingSession = this.userSessions.get(userId)!;
                
                // 如果用户在另一个房间,先将其从旧房间移除
                if (existingSession.roomId !== roomId) {
                  const oldRoom = this.rooms.get(existingSession.roomId);
                  if (oldRoom) {
                    console.log(`[Server] User ${userId} switching rooms, removing from ${existingSession.roomId}`);
                    oldRoom.removeClient(userId);
                    
                    // 不清理空房间 - 保留房主的房间记录，让用户可以回来
                    if (oldRoom.getClientCount() === 0) {
                      console.log(`[Server] Room ${existingSession.roomId} is now empty but kept for host ${userId}`);
                      oldRoom.markEmpty(); // 标记为空房间，开始计时
                    }
                  }
                }
              }
              
              // 检查房间是否已存在
              const roomExists = this.rooms.has(roomId);
              
              // 如果用户想创建房间但房间已存在,返回错误
              if (isCreate && roomExists) {
                ws.send(JSON.stringify({
                  type: 'joinError',
                  payload: { 
                    reason: 'roomNameExists',
                    message: '房间名称已存在,请使用其他名称或直接加入'
                  }
                }));
                console.log(`[Server] Room name already exists: ${roomId}`);
                break;
              }
              
              if (!roomExists) {
                // 检查是否是创建房间请求
                if (isCreate) {
                  // 检查该用户已创建的房间数量
                  const userRooms = this.hostRooms.get(userId) || [];
                  
                  // 计算实际活跃房间数(只统计当前存在的房间)
                  const activeRoomCount = userRooms.filter(rId => this.rooms.has(rId)).length;
                  
                  if (activeRoomCount >= this.MAX_ROOMS_PER_HOST) {
                    ws.send(JSON.stringify({
                      type: 'joinError',
                      payload: { 
                        reason: 'roomLimitPerHost',
                        message: `每个用户最多创建${this.MAX_ROOMS_PER_HOST}个房间`
                      }
                    }));
                    console.log(`[Server] User ${userId} reached room creation limit (${activeRoomCount}/${this.MAX_ROOMS_PER_HOST})`);
                    break;
                  }
                }
                
                // 检查总房间数量限制
                if (this.rooms.size >= this.MAX_ROOMS) {
                  ws.send(JSON.stringify({
                    type: 'joinError',
                    payload: { 
                      reason: 'roomLimitReached',
                      message: '服务器房间数量已达上限'
                    }
                  }));
                  console.log(`[Server] Room limit reached: ${this.rooms.size}/${this.MAX_ROOMS}`);
                  break;
                }
                
                // 创建新房间
                const room = new Room(roomId);
                room.setHost(userId);  // 第一个加入的是房主
                this.rooms.set(roomId, room);
                
                // 更新房主房间列表
                if (!this.hostRooms.has(userId)) {
                  this.hostRooms.set(userId, []);
                }
                this.hostRooms.get(userId)!.push(roomId);
                
                console.log(`[Server] Room created: ${roomId} by ${userId} (${this.rooms.size}/${this.MAX_ROOMS}, user rooms: ${this.hostRooms.get(userId)!.length}/${this.MAX_ROOMS_PER_HOST})`);
              }
              
              currentRoom = this.rooms.get(roomId)!;
              
              // 验证密码（房主可以免密进入自己的房间）
              const isHostJoining = userId === currentRoom.getHostUserId();
              if (!isHostJoining && !currentRoom.verifyPassword(password || '')) {
                ws.send(JSON.stringify({
                  type: 'joinError',
                  payload: {
                    reason: 'wrongPassword',
                    message: '密码错误'
                  }
                }));
                console.log(`[Server] Wrong password for room: ${roomId}, user: ${userId}`);
                break;
              }
              
              // 检查房间人数限制
              if (currentRoom.getClientCount() >= this.MAX_USERS_PER_ROOM) {
                ws.send(JSON.stringify({
                  type: 'joinError',
                  payload: {
                    reason: 'roomFull',
                    message: '房间已满'
                  }
                }));
                console.log(`[Server] Room full: ${roomId} (${currentRoom.getClientCount()}/${this.MAX_USERS_PER_ROOM})`);
                break;
              }
              
              // 添加客户端到房间
              currentRoom.addClient(ws, userId, username);
              
              // 更新用户会话
              this.userSessions.set(userId, { ws, roomId });
              
              // 发送加入成功消息
              ws.send(JSON.stringify({
                type: 'joinSuccess',
                payload: {
                  roomId,
                  userId,  // 返回服务器分配的ID
                  isHost: isHostJoining,
                  hasPassword: currentRoom.hasPassword(),
                  // 仅向房主返回实际密码
                  ...(isHostJoining ? { password: currentRoom.getPassword() } : {})
                }
              }));
              
              break;
              
            case 'danmaku':
              if (currentRoom) {
                currentRoom.handleDanmaku(userId, message.payload);
              }
              break;
              
            case 'ping':
              if (currentRoom) {
                currentRoom.handleHeartbeat(userId);
              }
              break;
              
            case 'leave':
              if (currentRoom) {
                currentRoom.removeClient(userId);
                
                // 清理用户会话
                this.userSessions.delete(userId);
                
                // 不清理空房间 - 保留房主的房间记录
                if (currentRoom.getClientCount() === 0) {
                  console.log(`[Server] Room ${roomId} is now empty after leave but kept for host`);
                  currentRoom.markEmpty(); // 标记为空房间
                }
                
                currentRoom = null;
              }
              break;
              
            case 'setPassword':
              const { roomId: pwdRoomId, password: newPassword, userId: setterId } = message.payload;
              
              if (!this.rooms.has(pwdRoomId)) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: '房间不存在' }
                }));
                break;
              }
              
              const targetRoom = this.rooms.get(pwdRoomId)!;
              
              // 验证权限
              if (!targetRoom.setPassword(newPassword, setterId)) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: '只有房主可以修改密码' }
                }));
                break;
              }
              
              console.log(`[Server] Password changed for room: ${pwdRoomId}, hasPassword: ${targetRoom.hasPassword()}`);
              
              // 广播密码变更通知
              targetRoom.broadcast({
                type: 'passwordChanged',
                payload: {
                  roomId: pwdRoomId,
                  hasPassword: targetRoom.hasPassword(),
                  changedBy: setterId
                }
              });
              
              ws.send(JSON.stringify({
                type: 'success',
                payload: { message: '密码设置成功' }
              }));
              
              break;
            
            // 用于测试服务器连接的ping消息
            case 'ping':
              const { timestamp } = message.payload;
              ws.send(JSON.stringify({
                type: 'pong',
                payload: {
                  timestamp,
                  serverTime: Date.now()
                }
              }));
              break;
            
            case 'deleteRoom':
              const { roomId: deleteRoomId, userId: deleterId } = message.payload;
              
              if (!this.rooms.has(deleteRoomId)) {
                // 房间不存在，也从房主列表中移除
                this.removeFromHostRooms(deleteRoomId);
                ws.send(JSON.stringify({
                  type: 'success',
                  payload: { message: '房间已不存在，已从记录中清除' }
                }));
                break;
              }
              
              const roomToDelete = this.rooms.get(deleteRoomId)!;
              
              // 验证权限: 通过 hostRooms 映射确认用户是否是房主
              const hostRoomList = this.hostRooms.get(deleterId) || [];
              if (!hostRoomList.includes(deleteRoomId) && deleterId !== roomToDelete.getHostUserId()) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: '只有房主可以删除房间' }
                }));
                break;
              }
              
              console.log(`[Server] Room deleted by host: ${deleteRoomId}, user: ${deleterId}`);
              
              // 通知房间内所有用户房间已被删除
              roomToDelete.broadcast({
                type: 'roomDeleted',
                payload: {
                  roomId: deleteRoomId,
                  reason: '房主删除了房间'
                }
              });
              
              // 清理用户会话
              roomToDelete.getClients().forEach((client, uid) => {
                this.userSessions.delete(uid);
              });
              
              // 从房主列表中移除
              this.removeFromHostRooms(deleteRoomId);
              
              // 删除房间
              this.rooms.delete(deleteRoomId);
              
              ws.send(JSON.stringify({
                type: 'success',
                payload: { message: '房间已删除' }
              }));
              
              break;
              
            default:
              console.warn('[Server] Unknown message type:', message.type);
          }
        } catch (e) {
          console.error('[Server] Invalid message:', e);
        }
      });

      // WebSocket连接关闭时的清理逻辑
      ws.on('close', () => {
        console.log(`[Server] Connection closed for user ${userId} in room ${roomId}`);
        
        // 清理用户会话
        if (userId && this.userSessions.has(userId)) {
          // 从房间中移除用户
          if (currentRoom) {
            currentRoom.removeClient(userId);
            
            // 不清理空房间 - 保留房主的房间记录
            if (currentRoom.getClientCount() === 0) {
              console.log(`[Server] Room ${roomId} is now empty after close but kept for host`);
              currentRoom.markEmpty(); // 标记为空房间
            }
          }
          
          // 删除用户会话
          this.userSessions.delete(userId);
        }
      });

      ws.on('error', (err) => {
        console.error('[Server] WebSocket error:', err);
      });
    });

    // 定期健康检查
    setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];
      
      this.rooms.forEach((room, roomId) => {
        // 检查房间健康（断开死连接）
        room.checkHealth();
        
        const isEmpty = room.getClientCount() === 0;
        
        if (isEmpty) {
          // 空房间使用更长的TTL，让房主有时间回来
          const emptySince = room.getEmptySince();
          if (emptySince && (now - emptySince > this.EMPTY_ROOM_TTL)) {
            console.log(`[Server] Empty room expired: ${roomId}`);
            toDelete.push(roomId);
            return;
          }
          // 非host创建的房间或超时过长的房间
          if (now - room.createdAt > this.ROOM_TTL) {
            console.log(`[Server] Room expired by age: ${roomId}`);
            toDelete.push(roomId);
            return;
          }
        }
      });
      
      // 批量删除并清理hostRooms映射
      toDelete.forEach(roomId => {
        this.removeFromHostRooms(roomId);
        this.rooms.delete(roomId);
      });
      
      // 输出统计信息
      if (toDelete.length > 0) {
        console.log(`[Server] Cleaned up ${toDelete.length} rooms, remaining: ${this.rooms.size}`);
      }
    }, 60000); // 每60秒检查一次（减少频率，空房间不需要频繁检查）

    // 创建HTTP服务器用于管理API
    const httpServer = createServer((req, res) => {
      // 设置CORS头,允许跨域请求
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // 处理OPTIONS预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 客户端自动更新资产分发（/updates/<file>），逻辑独立在 updates-static.ts
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '', 'http://localhost').pathname;
      } catch {
        // 畸形 URL 交给下面的 404 分支
      }
      if (isUpdatesRequest(pathname)) {
        void serveUpdateFile(req, res, pathname);
        return;
      }

      if (req.url === '/stats') {
        // 构建房主统计信息
        const hostStats: Record<string, { roomCount: number; rooms: string[] }> = {};
        this.hostRooms.forEach((rooms, userId) => {
          // 只统计当前存在的房间
          const activeRooms = rooms.filter(rId => this.rooms.has(rId));
          if (activeRooms.length > 0) {
            hostStats[userId] = {
              roomCount: activeRooms.length,
              rooms: activeRooms
            };
          }
        });
        
        const stats = {
          totalRooms: this.rooms.size,
          totalHosts: Object.keys(hostStats).length,
          totalClients: Array.from(this.rooms.values())
            .reduce((sum, room) => sum + room.getClientCount(), 0),
          hostRooms: hostStats,  // 新增: 房主房间统计
          rooms: Array.from(this.rooms.entries()).map(([id, room]) => ({
            roomId: id,
            clientCount: room.getClientCount(),
            hasPassword: room.hasPassword(),  // 新增: 是否有密码
            age: Date.now() - room.createdAt
          }))
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    httpServer.listen(PORT + 1); // HTTP API监听8081端口
    console.log(`[Server] Management API listening on port ${PORT + 1}`);

    console.log(`[Server] Danmaku server listening on port ${PORT}`);
  }
  
  // 辅助方法: 从房主列表中移除房间
  private removeFromHostRooms(roomId: string) {
    // 查找哪个用户拥有这个房间
    this.hostRooms.forEach((rooms, userId) => {
      const index = rooms.indexOf(roomId);
      if (index > -1) {
        rooms.splice(index, 1);
        console.log(`[Server] Removed room ${roomId} from user ${userId}'s list`);
        
        // 如果用户没有房间了,删除该用户的条目
        if (rooms.length === 0) {
          this.hostRooms.delete(userId);
        }
      }
    });
  }
}

// 启动服务器
new DanmakuServer();
