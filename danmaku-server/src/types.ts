// 弹幕消息类型定义(与客户端共享)
export interface DanmakuMessage {
  id: string;
  text: string;
  userId: string;
  color: string;
  fontSize: number;
  speed: 'slow' | 'normal' | 'fast';
  timestamp: number;
  sender?: string;
  position?: 'top' | 'middle' | 'bottom';
  mode?: 'scroll' | 'stay';
}

// 房间用户
export interface RoomUser {
  userId: string;
  username: string;
}

// 客户端发送的消息
export type ClientMessage =
  | { type: 'join'; payload: { roomId: string; userId: string; username: string; password?: string; isCreate?: boolean } }
  | { type: 'leave'; payload: { userId: string } }
  | { type: 'setPassword'; payload: { roomId: string; password: string; userId: string } }
  | { type: 'deleteRoom'; payload: { roomId: string; userId: string } }
  | { type: 'danmaku'; payload: DanmakuMessage }
  | { type: 'ping'; payload: { timestamp: number } };  // 用于测试服务器连接

// 服务器消息协议
export type ServerMessage =
  | { type: 'danmaku'; payload: DanmakuMessage }
  | { type: 'user-list'; payload: { users: RoomUser[] } }
  | { type: 'init'; payload: { danmakus: DanmakuMessage[] } }
  | { type: 'ping'; payload: { timestamp: number; userId: string } }
  | { type: 'pong'; payload: { timestamp: number } }
  | { type: 'join'; payload: { roomId: string; userId: string; username: string; password?: string; isCreate?: boolean } }
  | { type: 'leave'; payload: { userId: string } }
  | { type: 'setPassword'; payload: { roomId: string; password: string; userId: string } }
  | { type: 'deleteRoom'; payload: { roomId: string; userId: string } }
  | { type: 'joinSuccess'; payload: { roomId: string; userId: string; isHost: boolean } }
  | { type: 'joinError'; payload: { reason: string; message: string } }
  | { type: 'passwordChanged'; payload: { roomId: string; hasPassword: boolean; changedBy: string } }
  | { type: 'roomDeleted'; payload: { roomId: string; reason: string } }
  | { type: 'error'; payload: { message: string } }       // 操作错误反馈（删除/改密码鉴权失败等）
  | { type: 'success'; payload: { message: string } }      // 操作成功反馈
  | { type: 'pong'; payload: { timestamp: number; serverTime: number } };  // 用于测试服务器连接
