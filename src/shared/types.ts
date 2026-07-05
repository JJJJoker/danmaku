// 弹幕数据类型
export interface DanmakuMessage {
  id: string;
  text: string;
  userId: string;
  color: string;
  fontSize: number;
  speed: 'slow' | 'normal' | 'fast';
  timestamp: number;
  sender?: string;
  position?: 'top' | 'middle' | 'bottom';  // 弹幕垂直位置
  mode?: 'scroll' | 'stay';                 // 弹幕模式（滚动/停留）
}

// 房间用户
export interface RoomUser {
  userId: string;
  username: string;
}

// 房间信息
export interface RoomInfo {
  roomId: string;
  hostId: string;
  users: string[];
  createdAt: number;
}

// P2P 消息协议
export type PeerMessage =
  | { type: 'danmaku'; payload: DanmakuMessage }
  | { type: 'user-list'; payload: { users: RoomUser[] } }
  | { type: 'init'; payload: { danmakus: DanmakuMessage[] } }
  | { type: 'ping'; payload: { timestamp: number } }
  | { type: 'leave'; payload: { userId: string } };

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
  | { type: 'roomDeleted'; payload: { roomId: string; reason: string } };

// 设置
export interface OverlayBounds {
  x: number;      // 左偏移 %
  y: number;      // 上偏移 %
  width: number;  // 宽度 %
  height: number; // 高度 %
}

export interface DanmakuSettings {
  fontSize: number;
  speed: 'slow' | 'normal' | 'fast';
  opacity: number;
  color: string;
  maxCount: number;
  isEnabled: boolean;
  trackCount: number;
  showSender: boolean;
  showBorder: boolean;
  overlayBounds: OverlayBounds;
  defaultPosition: 'top' | 'middle' | 'bottom';  // 默认位置
  defaultMode: 'scroll' | 'stay';                  // 默认模式
  stayDuration: number;                            // 停留时长(ms)
}

// IPC API 类型（与 preload.ts 对应）
export interface ElectronAPI {
  platform: string;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
  windowControl: {
    minimize: () => void;
    close: () => void;
    toggleAlwaysOnTop: () => void;
  };
  resizeControlWindow: (width: number, height: number) => void;
  forwardDanmakuToWindow: (danmakuData: any) => void;
  onReceiveDanmakuFromControl: (callback: (danmakuData: any) => void) => void;
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>;
  log: (message: string) => void;
  getLogPath: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}