// 网络弹幕接收处理：从 App.tsx 的 initCallbacks 内联闭包抽出。
// 依赖全部注入（DI 工厂），App.tsx 负责接线到各 store/服务，测试直接传 vi.fn()。
import { DanmakuMessage, DanmakuSettings } from '../../shared/types';
import { HistoryItem } from '../stores/danmakuStore';

export interface ForwardDanmakuPayload {
  message: DanmakuMessage;
  fontSize: number;
  speed: string;
  position: 'top' | 'middle' | 'bottom';
  mode: 'scroll' | 'stay';
  stayDuration: number;
}

export interface IncomingDanmakuDeps {
  /** 窗口类型：'danmaku' | 'control' | null（单窗口兼容模式）；窗口生命周期内不变 */
  windowType: string | null;
  /** 事件时刻取值（活跃房间随时会切换，不能注册时快照） */
  getActiveRoomId: () => string;
  /** 事件时刻取值（设置随时会改） */
  getSettings: () => DanmakuSettings;
  addDanmaku: (
    message: DanmakuMessage,
    fontSize: number,
    speed: string,
    roomId?: string,
    position?: 'top' | 'middle' | 'bottom',
    mode?: 'scroll' | 'stay',
    stayDuration?: number
  ) => void;
  addHistory: (item: HistoryItem) => void;
  speakVoice: (
    message: DanmakuMessage,
    settings: Pick<DanmakuSettings, 'voiceEnabled' | 'voiceRate' | 'voiceVolume' | 'voiceURI'>
  ) => void;
  notifyBot: (message: DanmakuMessage, roomId: string, isReplay: boolean) => void;
  /** electronAPI 在纯浏览器环境可能缺失，故可选 */
  forwardToDanmakuWindow?: (payload: ForwardDanmakuPayload) => void;
}

export function createIncomingDanmakuHandler(deps: IncomingDanmakuDeps) {
  const { windowType } = deps;

  return (danmaku: DanmakuMessage, roomId: string, isReplay?: boolean): void => {
    const activeRoomId = deps.getActiveRoomId();
    const settings = deps.getSettings();

    console.log(`[App] Received remote danmaku:`, {
      text: danmaku.text.substring(0, 20),
      sender: danmaku.sender,
      roomId: roomId,
      activeRoomId: activeRoomId,
      matches: roomId === activeRoomId
    });

    if (roomId === activeRoomId) {
      console.log('[App] ✅ RoomId matches, adding danmaku to display');

      // 添加到当前窗口的 store（历史由 addDanmaku 内部一并写入）
      deps.addDanmaku(
        danmaku,
        settings.fontSize,
        settings.speed,
        roomId,
        danmaku.position || settings.defaultPosition,
        danmaku.mode || settings.defaultMode,
        settings.stayDuration
      );

      // 语音弹幕：在 TTS 所在窗口（控制面板/兼容单窗口）于接收时直接朗读；
      // 房间历史回放（init）不朗读，speakVoiceDanmaku 内部按 ID 去重并按发送者限频
      if (danmaku.isVoice && !isReplay && windowType !== 'danmaku') {
        deps.speakVoice(danmaku, settings);
      }

      // 吐槽姬关键词观察：只在控制面板/单窗口运行（botService 内部还有 running/去重/冷却守卫）
      if (windowType !== 'danmaku') {
        deps.notifyBot(danmaku, roomId, !!isReplay);
      }

      // 如果当前是控制面板窗口，转发到弹幕窗口
      if (windowType === 'control') {
        console.log('[App] Forwarding remote danmaku to danmaku window via IPC');
        try {
          deps.forwardToDanmakuWindow?.({
            message: danmaku,
            fontSize: settings.fontSize,
            speed: settings.speed,
            position: danmaku.position || settings.defaultPosition,
            mode: danmaku.mode || settings.defaultMode,
            stayDuration: settings.stayDuration
          });
          console.log('[App] ✅ Successfully forwarded remote danmaku');
        } catch (error) {
          console.error('[App]  Failed to forward remote danmaku:', error);
        }
      }
    } else {
      console.log('[App] ❌ RoomId mismatch, only adding to history');
      deps.addHistory({
        id: danmaku.id,
        text: danmaku.text,
        sender: danmaku.sender || '匿名用户',
        color: danmaku.color,
        timestamp: danmaku.timestamp,
        roomId,
        isVoice: danmaku.isVoice,
      });
    }
  };
}
