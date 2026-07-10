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
  isVoice?: boolean;                        // 是否为语音弹幕
}

// 房间用户
export interface RoomUser {
  userId: string;
  username: string;
}

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
  | { type: 'joinSuccess'; payload: { roomId: string; userId: string; isHost: boolean; password?: string; hasPassword?: boolean } }
  | { type: 'joinError'; payload: { reason: string; message: string } }
  | { type: 'passwordChanged'; payload: { roomId: string; hasPassword: boolean; changedBy: string } }
  | { type: 'roomDeleted'; payload: { roomId: string; reason: string } }
  | { type: 'error'; payload: { message: string } }       // 服务器操作错误反馈（删除/改密码鉴权失败等）
  | { type: 'success'; payload: { message: string } };     // 服务器操作成功反馈

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
  voiceEnabled: boolean;                           // 语音弹幕开关
  voiceRate: number;                               // 语速 (0.5-2.0)
  voiceVolume: number;                             // 音量 (0-1)
  voiceURI: string;                                 // 语音音色 voiceURI，'' = 系统默认
}

// ========== 软件更新 ==========

// 更新能力：auto = NSIS 安装版可全自动更新 | download-page = macOS 与 zip 便携版仅提示跳转下载页 | none = 开发环境
export type UpdateCapability = 'auto' | 'download-page' | 'none';

export interface UpdateInfoLite {
  version: string;        // 如 "1.4.0"
  releaseNotes?: string;  // 主进程已剥 HTML 标签并截断的纯文本摘要
  releaseDate?: string;
}

// 更新状态（主进程经 update:status 推送给控制面板窗口）
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfoLite }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: 'downloaded'; info: UpdateInfoLite }
  | { state: 'error'; message: string };

// update:get-state 的返回值，UI 挂载时一次拉全（窗口重建后恢复状态）
export interface UpdateState {
  capability: UpdateCapability;
  currentVersion: string;
  status: UpdateStatus | null;
}

// ========== 吐槽姬 LLM 调用（主进程代理，OpenAI 兼容接口） ==========

// llm:chat 请求（renderer → main）。渲染进程持有 key，按次传给主进程发起 HTTP
export interface LLMChatRequest {
  baseURL: string;   // 如 'https://api.deepseek.com/v1'
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  maxTokens?: number;      // 缺省 256
  temperature?: number;    // 缺省不传给上游（兼容性最大化）
}

// llm:chat 响应。错误以值返回而不 throw，避免 IPC 包装错误信息
export type LLMChatResponse =
  | { ok: true; content: string }
  | { ok: false; error: string };

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
  setControlWindowLevel: (level: 'normal' | 'high') => void;
  forwardDanmakuToWindow: (danmakuData: any) => void;
  onReceiveDanmakuFromControl: (callback: (danmakuData: any) => void) => (() => void);
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>;
  log: (message: string) => void;
  getLogPath: () => Promise<string>;
  updater: {
    getState: () => Promise<UpdateState>;
    check: () => Promise<void>;      // 结果一律经 onStatus 推送
    download: () => Promise<void>;
    install: () => void;
    openDownloadPage: () => void;
    onStatus: (callback: (status: UpdateStatus) => void) => (() => void);
  };
  llm: {
    chat: (req: LLMChatRequest) => Promise<LLMChatResponse>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}