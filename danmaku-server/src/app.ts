import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';
import { Room } from './room';
import { ServerMessage } from './types';
import { isUpdatesRequest, serveUpdateFile } from './updates-static';
import { RoomStore } from './persistence';

// 可测性注入点：写死的常量一律走构造参数（默认值 = 生产行为），详见 docs/TESTING_GUIDELINES.md
export interface DanmakuServerOptions {
  /** WebSocket 端口；默认读环境变量 PORT（缺省 8080），0 = 内核分配临时端口（测试用） */
  port?: number;
  /** 管理 HTTP 端口；默认 弹幕端口 + 1，port 为 0 时同样取 0 */
  httpPort?: number;
  maxRooms?: number;
  maxUsersPerRoom?: number;
  maxRoomsPerHost?: number;
  /** 房间清扫定时器间隔（毫秒） */
  cleanupIntervalMs?: number;
  /** 客户端 IP 解析函数；默认取 socket.remoteAddress，测试可改从自定义 header 读取以模拟多 IP */
  resolveClientIp?: (req: IncomingMessage) => string;
  /**
   * SQLite 持久化文件路径；默认 env DANMAKU_DB_PATH，缺省为 dist 同级的 danmaku.db
   * （部署目录 /opt/danmaku-server/danmaku.db）。测试传 ':memory:'
   */
  dbPath?: string;
}

export class DanmakuServer {
  private wss: WebSocketServer;
  private httpServer: HttpServer;
  private cleanupTimer: NodeJS.Timeout;
  private readyPromise: Promise<void>;
  private resolveClientIp: (req: IncomingMessage) => string;
  private store: RoomStore;
  private rooms: Map<string, Room> = new Map();
  
  // 新增: 用户会话映射 userId -> { ws, roomId }
  private userSessions: Map<string, { ws: WebSocket; roomId: string }> = new Map();
  
  // 新增: 房主到房间列表的映射 userId -> [roomId1, roomId2, ...]
  private hostRooms: Map<string, string[]> = new Map();
  
  // IP 到 userId 的映射，确保同一 IP 始终同一个用户 ID
  private ipToUserId: Map<string, string> = new Map();
  
  // 房间配置（上限类可经构造参数覆盖，默认值即生产值）
  private readonly MAX_ROOMS: number; // 最大房间数，默认100
  private readonly MAX_USERS_PER_ROOM: number; // 每个房间最大用户数，默认50
  private readonly EMPTY_ROOM_TTL = 86400000; // 空房间保留时长(24小时)，到期销毁——孤儿房间的兜底回收
  private readonly MAX_ROOMS_PER_HOST: number; // 每个用户最多创建的房间数，默认2

  constructor(options: DanmakuServerOptions = {}) {
    const port = options.port ?? parseInt(process.env.PORT || '8080', 10);
    const httpPort = options.httpPort ?? (port > 0 ? port + 1 : 0);
    this.MAX_ROOMS = options.maxRooms ?? 100;
    this.MAX_USERS_PER_ROOM = options.maxUsersPerRoom ?? 50;
    this.MAX_ROOMS_PER_HOST = options.maxRoomsPerHost ?? 2;
    this.resolveClientIp = options.resolveClientIp ??
      ((req) => req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown');

    // SQLite 持久化：房间元数据 + IP→userId 映射跨重启存活，部署重启对用户无感
    const dbPath = options.dbPath ?? process.env.DANMAKU_DB_PATH ??
      (typeof __dirname !== 'undefined' ? path.join(__dirname, '..', 'danmaku.db') : 'danmaku.db');
    this.store = new RoomStore(dbPath);
    this.restoreFromStore();

    this.wss = new WebSocketServer({ port });
    
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
              const clientIp = this.resolveClientIp(req);
              
              if (this.ipToUserId.has(clientIp)) {
                // 同一 IP 返回已有 ID
                userId = this.ipToUserId.get(clientIp)!;
                console.log(`[Server] IP ${clientIp} -> existing userId: ${userId}`);
              } else if (providedUserId && !Array.from(this.ipToUserId.values()).includes(providedUserId)) {
                // 客户端提供的 ID 未被占用，使用它
                userId = providedUserId;
                this.ipToUserId.set(clientIp, userId);
                this.store.upsertIpUser(clientIp, userId);
                console.log(`[Server] IP ${clientIp} -> adopted provided userId: ${userId}`);
              } else {
                // 生成新 ID
                userId = `u${Math.random().toString(36).substring(2, 8)}`;
                this.ipToUserId.set(clientIp, userId);
                this.store.upsertIpUser(clientIp, userId);
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
                      this.store.setRoomEmptySince(existingSession.roomId, oldRoom.getEmptySince());
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

                this.store.upsertRoom({
                  roomId,
                  createdAt: room.createdAt,
                  password: room.getPassword(),
                  hostUserId: userId,
                  emptySince: null,
                });

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
              
              // 添加客户端到房间（emptySince 归零，持久化同步）
              currentRoom.addClient(ws, userId, username);
              this.store.setRoomEmptySince(roomId, null);

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
                  this.store.setRoomEmptySince(roomId, currentRoom.getEmptySince());
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
              
              this.store.setRoomPassword(pwdRoomId, newPassword);

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

            case 'deleteRoom':
              const { roomId: deleteRoomId, userId: deleterId } = message.payload;
              // 删除核心抽到 performDeleteRoom 供 WS / HTTP 复用；WS 信任 payload.userId 作为鉴权候选
              const wsDeleteResult = this.performDeleteRoom(deleteRoomId, [deleterId]);
              ws.send(JSON.stringify({
                type: wsDeleteResult.ok ? 'success' : 'error',
                payload: { message: wsDeleteResult.message }
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
              this.store.setRoomEmptySince(roomId, currentRoom.getEmptySince());
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

    // 定期健康检查（回调主体抽为 sweepRooms，测试可注入时间直接驱动）
    // 每60秒检查一次（减少频率，空房间不需要频繁检查）
    this.cleanupTimer = setInterval(() => this.sweepRooms(), options.cleanupIntervalMs ?? 60000);

    // 创建HTTP服务器用于管理API
    this.httpServer = createServer((req, res) => {
      // 设置CORS头,允许跨域请求
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // 处理OPTIONS预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 客户端自动更新资产分发（/updates/<file>），逻辑独立在 updates-static.ts
      let pathname = '';
      let searchParams = new URLSearchParams();
      try {
        const parsedUrl = new URL(req.url ?? '', 'http://localhost');
        pathname = parsedUrl.pathname;
        searchParams = parsedUrl.searchParams;
      } catch {
        // 畸形 URL 交给下面的 404 分支
      }
      if (isUpdatesRequest(pathname)) {
        void serveUpdateFile(req, res, pathname);
        return;
      }

      // 房间删除端点：DELETE /rooms/:id —— 用 IP 反查房主身份（比 WS 信任 payload 更权威），
      // 未连接（ws 已关闭）时也能删除，另接受 ?userId= 兜底
      if (req.method === 'DELETE' && pathname.startsWith('/rooms/')) {
        const roomId = decodeURIComponent(pathname.slice('/rooms/'.length));
        const ipUserId = this.ipToUserId.get(this.resolveClientIp(req));
        const queryUserId = searchParams.get('userId');
        const authorizedUserIds = [ipUserId, queryUserId].filter(Boolean) as string[];
        const result = this.performDeleteRoom(roomId, authorizedUserIds);
        res.writeHead(result.ok ? 200 : 403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: result.message }));
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

    this.httpServer.listen(httpPort); // HTTP API 端口 = 弹幕端口 + 1（默认 8081）

    // 双端口都进入监听后 ready() 才落定；监听失败会让 ready() 拒绝
    this.readyPromise = Promise.all([
      new Promise<void>((resolve, reject) => {
        this.wss.once('listening', resolve);
        this.wss.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        this.httpServer.once('listening', resolve);
        this.httpServer.once('error', reject);
      }),
    ]).then(() => {
      console.log(`[Server] Danmaku server listening on port ${this.getWsPort()}`);
      console.log(`[Server] Management API listening on port ${this.getHttpPort()}`);
    });
  }

  /** 启动时从 SQLite 恢复房间与身份映射（部署/崩溃重启对用户无感的关键） */
  private restoreFromStore() {
    this.ipToUserId = this.store.loadIpUserMap();
    const persisted = this.store.loadRooms();
    for (const p of persisted) {
      const room = new Room(p.roomId, {
        createdAt: p.createdAt,
        password: p.password,
        hostUserId: p.hostUserId,
        // 重启后房间必然无人：关机前有人的房间（无 emptySince）从现在起算 24h 保留
        emptySince: p.emptySince ?? Date.now(),
      });
      this.rooms.set(p.roomId, room);
      if (p.hostUserId) {
        const list = this.hostRooms.get(p.hostUserId) || [];
        list.push(p.roomId);
        this.hostRooms.set(p.hostUserId, list);
      }
      if (p.emptySince === null) {
        this.store.setRoomEmptySince(p.roomId, room.getEmptySince());
      }
    }
    if (persisted.length > 0 || this.ipToUserId.size > 0) {
      console.log(`[Server] Restored ${persisted.length} room(s), ${this.ipToUserId.size} known IP(s) from SQLite`);
    }
  }

  /** 双端口（弹幕 WS + 管理 HTTP）均进入监听。生产入口不必等待，测试须 await */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** 实际监听的弹幕 WebSocket 端口（配合 port: 0 使用） */
  getWsPort(): number {
    return (this.wss.address() as AddressInfo).port;
  }

  /** 实际监听的管理 HTTP 端口 */
  getHttpPort(): number {
    return (this.httpServer.address() as AddressInfo).port;
  }

  /** 停止服务：清定时器、断开所有客户端、关闭两个监听（测试 teardown 用） */
  async close(): Promise<void> {
    clearInterval(this.cleanupTimer);
    // 主动断开客户端，否则 wss.close 要等客户端自行断开
    this.wss.clients.forEach((client) => client.terminate());
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        this.wss.close((err) => (err ? reject(err) : resolve()))
      ),
      new Promise<void>((resolve, reject) =>
        this.httpServer.close((err) => (err ? reject(err) : resolve()))
      ),
    ]);
    this.store.close();
  }

  /**
   * 房间健康检查与 TTL 清扫（interval 回调主体）。
   * 公开并接受 now 参数是为了测试能直接注入时间驱动，生产路径始终用当前时间。
   */
  sweepRooms(now: number = Date.now()) {
    const toDelete: string[] = [];

    this.rooms.forEach((room, roomId) => {
      // 检查房间健康（断开死连接）
      room.checkHealth();

      const isEmpty = room.getClientCount() === 0;

      if (isEmpty) {
        const emptySince = room.getEmptySince();
        // 经健康检查剔除最后一人的房间没有 emptySince（leave/close/切房路径才会 markEmpty），
        // 补记为从现在起算，下一轮清扫按 24h 规则处理
        if (!emptySince) {
          room.markEmpty();
          this.store.setRoomEmptySince(roomId, room.getEmptySince());
          return;
        }
        // 空房间保留 24 小时后销毁，期间房主可随时回来（房间 ID/密码不变）。
        // 自动销毁是孤儿房间的兜底回收：userId 按 IP 分配，用户 IP 变化后
        // 旧房间无法再从界面手动删除，只能靠这里清理（规则已写入 README 用户说明）
        if (now - emptySince > this.EMPTY_ROOM_TTL) {
          console.log(`[Server] Empty room expired: ${roomId}`);
          toDelete.push(roomId);
          return;
        }
      }
    });

    // 批量删除并清理hostRooms映射（持久化同步）
    toDelete.forEach(roomId => {
      this.removeFromHostRooms(roomId);
      this.rooms.delete(roomId);
      this.store.deleteRoom(roomId);
    });

    // 输出统计信息
    if (toDelete.length > 0) {
      console.log(`[Server] Cleaned up ${toDelete.length} rooms, remaining: ${this.rooms.size}`);
    }
  }

  /**
   * 删除房间的核心逻辑，供 WS `deleteRoom` 与 HTTP `DELETE /rooms/:id` 复用。
   * authorizedUserIds 为鉴权候选 userId 列表（WS 传 payload.userId；HTTP 传 IP 反查 + ?userId 兜底），
   * 任一为房主即放行。返回 { ok, message }，三条文案与历史 WS 行为逐字一致。
   */
  private performDeleteRoom(roomId: string, authorizedUserIds: string[]): { ok: boolean; message: string } {
    if (!this.rooms.has(roomId)) {
      // 房间不存在，也从房主列表中移除（清除记录语义，无需鉴权）
      this.removeFromHostRooms(roomId);
      return { ok: true, message: '房间已不存在，已从记录中清除' };
    }

    const roomToDelete = this.rooms.get(roomId)!;

    // 验证权限: 任一候选 userId 在 hostRooms 映射中或等于房主 userId 即放行
    const isAuthorized = authorizedUserIds.some((uid) => {
      if (!uid) return false;
      const hostRoomList = this.hostRooms.get(uid) || [];
      return hostRoomList.includes(roomId) || uid === roomToDelete.getHostUserId();
    });
    if (!isAuthorized) {
      return { ok: false, message: '只有房主可以删除房间' };
    }

    console.log(`[Server] Room deleted by host: ${roomId}, authorized: ${authorizedUserIds.filter(Boolean).join(',')}`);

    // 通知房间内所有用户房间已被删除
    roomToDelete.broadcast({
      type: 'roomDeleted',
      payload: { roomId, reason: '房主删除了房间' }
    });

    // 清理用户会话
    roomToDelete.getClients().forEach((client, uid) => {
      this.userSessions.delete(uid);
    });

    // 从房主列表中移除
    this.removeFromHostRooms(roomId);

    // 删除房间（持久化同步，重启不复活）
    this.rooms.delete(roomId);
    this.store.deleteRoom(roomId);

    return { ok: true, message: '房间已删除' };
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

// 本模块只导出实现，不自启动——入口在 server.ts（import 即无条件启动）。
// 测试一律 import 本模块（tests/helpers.ts），绝不能 import server.ts，否则抢占真实端口。
