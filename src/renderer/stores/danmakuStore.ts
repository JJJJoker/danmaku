import { create } from 'zustand';
import { DanmakuTrackItem, danmakuEngine } from '../services/danmakuEngine';
import { DanmakuMessage } from '../../shared/types';

export interface HistoryItem {
  id: string;
  text: string;
  sender: string;
  color: string;
  timestamp: number;
  roomId?: string;
  isVoice?: boolean;
}

interface DanmakuState {
  // 当前显示的弹幕列表
  danmakus: DanmakuTrackItem[];
  // 最大同屏弹幕数
  maxCount: number;
  // 弹幕历史记录
  history: HistoryItem[];

  // 添加弹幕
  addDanmaku: (message: DanmakuMessage, fontSize: number, speed: string, roomId?: string, position?: 'top' | 'middle' | 'bottom', mode?: 'scroll' | 'stay', stayDuration?: number) => void;
  // 移除弹幕（动画结束后）
  removeDanmaku: (id: string) => void;
  // 清空所有弹幕
  clearAll: () => void;
  // 清理过期弹幕
  cleanupExpired: () => void;
  // 设置最大数量
  setMaxCount: (count: number) => void;
  // 添加历史记录
  addHistory: (item: HistoryItem) => void;
  // 清空历史记录
  clearHistory: () => void;
}

export const useDanmakuStore = create<DanmakuState>((set, get) => ({
  danmakus: [],
  maxCount: 200,
  history: [],

  addDanmaku: (message, fontSize, speed, roomId?, position?, mode?, stayDuration?) => {
    const state = get();

    console.log('[DanmakuStore] addDanmaku called:', {
      message,
      fontSize,
      speed,
      roomId,
      position,
      mode,
      stayDuration
    });

    // 超过最大数量时丢弃
    if (state.danmakus.length >= state.maxCount) {
      console.warn('[DanmakuStore] Max count reached, dropping danmaku');
      return;
    }

    // 从消息中取出 position/mode，或使用传入参数，或默认值
    const effectivePosition = message.position || position || 'top';
    const effectiveMode = message.mode || mode || 'scroll';
    const effectiveStayDuration = stayDuration || 5000;

    console.log('[DanmakuStore] Processing danmaku with:', { effectivePosition, effectiveMode, effectiveStayDuration });

    const item = danmakuEngine.processDanmaku(message, fontSize, speed, effectivePosition, effectiveMode, effectiveStayDuration);
    
    console.log('[DanmakuStore] Processed danmaku item:', {
      id: item.id,
      text: item.text,
      duration: item.duration,
      trackIndex: item.trackIndex
    });

    set({ danmakus: [...state.danmakus, item] });
    console.log('[DanmakuStore] Updated danmakus count:', get().danmakus.length);

    // 同时记录到历史
    const historyItem: HistoryItem = {
      id: message.id,
      text: message.text,
      sender: message.sender || '匿名用户',
      color: message.color,
      timestamp: message.timestamp,
      roomId,
      isVoice: message.isVoice,
    };
    get().addHistory(historyItem);

    // 自动清理：动画结束后移除
    setTimeout(() => {
      get().removeDanmaku(item.id);
    }, item.duration + 500);
  },

  removeDanmaku: (id) => {
    set(state => ({
      danmakus: state.danmakus.filter(d => d.id !== id),
    }));
  },

  clearAll: () => {
    danmakuEngine.clear();
    set({ danmakus: [] });
  },

  cleanupExpired: () => {
    danmakuEngine.cleanup();
    const now = Date.now();
    set(state => ({
      danmakus: state.danmakus.filter(
        d => now - d.startTime < d.duration + 500
      ),
    }));
  },

  setMaxCount: (count) => {
    set({ maxCount: count });
  },

  addHistory: (item) => {
    // 按 id 去重：本地发送已写入历史后，服务器回显同一条弹幕时不再重复记录
    set(state => state.history.some(h => h.id === item.id)
      ? state
      : { history: [...state.history, item].slice(-100) });
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));