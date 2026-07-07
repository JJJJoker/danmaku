import { DanmakuMessage } from '../../shared/types';

export interface DanmakuTrackItem {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  speed: number; // px/s
  trackId: number;
  startTime: number;
  duration: number; // ms
  width: number; // 估算文字宽度
  sender?: string;
  userId?: string;  // 新增: 发送者唯一ID
  mode: 'scroll' | 'stay';
  position: 'top' | 'middle' | 'bottom';
  isVoice?: boolean;  // 是否为语音弹幕
}

// 速度映射（屏幕宽度穿越时间 ms）
const SPEED_DURATION: Record<string, number> = {
  slow: 10000,
  normal: 7000,
  fast: 4000,
};

// 估算文字宽度（中文约 fontSize*1.2 每字，英文约 fontSize*0.6）
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 255) {
      width += fontSize * 1.2;
    } else {
      width += fontSize * 0.6;
    }
  }
  return width + 20; // 加一点 padding
}

export class DanmakuEngine {
  private tracks: Map<number, DanmakuTrackItem[]> = new Map();
  private trackCount: number;
  private screenWidth: number;
  // 停留弹幕槽位跟踪（按位置分组）
  private staySlots: Map<string, DanmakuTrackItem[]> = new Map();

  constructor(trackCount: number = 12, screenWidth: number = 1920) {
    this.trackCount = trackCount;
    this.screenWidth = screenWidth;

    // 初始化轨道
    for (let i = 0; i < trackCount; i++) {
      this.tracks.set(i, []);
    }
  }

  // 分配最佳轨道（选择最少弹幕的轨道，同时避免重叠）
  allocateTrack(position: 'top' | 'middle' | 'bottom' = 'top'): number {
    // 按位置分组轨道
    const tracksPerGroup = Math.floor(this.trackCount / 3);
    let startTrack: number;
    let endTrack: number;
    switch (position) {
      case 'top':
        startTrack = 0;
        endTrack = tracksPerGroup;
        break;
      case 'middle':
        startTrack = tracksPerGroup;
        endTrack = tracksPerGroup * 2;
        break;
      case 'bottom':
        startTrack = tracksPerGroup * 2;
        endTrack = this.trackCount;
        break;
    }

    let bestTrack = startTrack;
    let minScore = Infinity;

    for (let i = startTrack; i < endTrack; i++) {
      const trackItems = this.tracks.get(i) || [];
      const activeItems = trackItems.filter(
        item => Date.now() - item.startTime < item.duration
      );
      
      // 评分：活跃弹幕数量 + 最近弹幕是否有空间
      const score = activeItems.length;
      
      if (score < minScore) {
        minScore = score;
        bestTrack = i;
      }
    }

    return bestTrack;
  }

  // 检查轨道是否有空间（避免弹幕重叠）
  hasSpace(trackId: number, newWidth: number): boolean {
    const trackItems = this.tracks.get(trackId) || [];
    if (trackItems.length === 0) return true;

    const lastItem = trackItems[trackItems.length - 1];
    const elapsed = Date.now() - lastItem.startTime;
    const progress = elapsed / lastItem.duration;
    const lastPosition = this.screenWidth * (1 - progress) - lastItem.width;

    // 如果最后一条弹幕已经完全进入屏幕且有足够间距
    return lastPosition < this.screenWidth - newWidth - 50;
  }

  // 处理收到的弹幕消息，返回轨道分配结果
  processDanmaku(
    message: DanmakuMessage,
    settingsFontSize: number,
    settingsSpeed: string,
    position: 'top' | 'middle' | 'bottom' = 'top',
    mode: 'scroll' | 'stay' = 'scroll',
    stayDuration: number = 5000
  ): DanmakuTrackItem {
    const fontSize = message.fontSize || settingsFontSize;
    // 语音弹幕渲染时会在文字前加 🔊🔊🔊 前缀（含 4px 间距），需计入宽度避免轨道间距判断偏小导致重叠
    const width = estimateTextWidth((message.isVoice ? '🔊🔊🔊' : '') + message.text, fontSize)
      + (message.isVoice ? 4 : 0);

    // 停留弹幕：分配槽位避免重叠，槽位不够时允许重叠
    if (mode === 'stay') {
      const MAX_STAY_SLOTS = 5; // 每个位置最多5个槽位，超出循环使用
      const slotKey = position;
      const slots = this.staySlots.get(slotKey) || [];
      // 清理已过期的停留弹幕
      const now = Date.now();
      const activeSlots = slots.filter(s => now - s.startTime < s.duration);
      // 找到第一个可用槽位，超出上限则循环使用
      const usedIndices = new Set(activeSlots.map(s => s.trackId));
      let slotIndex = 0;
      while (usedIndices.has(slotIndex) && slotIndex < MAX_STAY_SLOTS) slotIndex++;
      // 如果所有槽位都占用，循环回第一个（允许重叠）
      if (slotIndex >= MAX_STAY_SLOTS) {
        slotIndex = activeSlots.length % MAX_STAY_SLOTS;
      }

      const item: DanmakuTrackItem = {
        id: message.id,
        text: message.text,
        color: message.color,
        fontSize,
        speed: 0,
        trackId: slotIndex,  // 用 trackId 存储槽位索引
        startTime: Date.now(),
        duration: stayDuration,
        width,
        sender: message.sender,
        userId: message.userId,  // 新增: 保存用户ID
        mode,
        position,
        isVoice: message.isVoice,  // 保存语音弹幕标记
      };
      activeSlots.push(item);
      this.staySlots.set(slotKey, activeSlots);
      return item;
    }

    const duration = SPEED_DURATION[settingsSpeed] || SPEED_DURATION[message.speed] || 7000;

       
    // 分配轨道
    let trackId = this.allocateTrack(position);
    
    // 如果最佳轨道没空间，尝试对应位置的其他轨道
    if (!this.hasSpace(trackId, width)) {
      const tracksPerGroup = Math.floor(this.trackCount / 3);
      let startTrack: number;
      let endTrack: number;
      switch (position) {
        case 'top':
          startTrack = 0;
          endTrack = tracksPerGroup;
          break;
        case 'middle':
          startTrack = tracksPerGroup;
          endTrack = tracksPerGroup * 2;
          break;
        case 'bottom':
          startTrack = tracksPerGroup * 2;
          endTrack = this.trackCount;
          break;
      }
      for (let i = startTrack; i < endTrack; i++) {
        if (this.hasSpace(i, width)) {
          trackId = i;
          break;
        }
      }
    }

    const item: DanmakuTrackItem = {
      id: message.id,
      text: message.text,
      color: message.color,
      fontSize,
      speed: this.screenWidth / (duration / 1000),
      trackId,
      startTime: Date.now(),
      duration,
      width,
      sender: message.sender,
      userId: message.userId,  // 新增: 保存用户ID
      mode,
      position,
      isVoice: message.isVoice,  // 保存语音弹幕标记
    };

    // 添加到轨道
    const track = this.tracks.get(trackId) || [];
    track.push(item);
    this.tracks.set(trackId, track);

    return item;
  }

  // 清理过期弹幕
  cleanup() {
    const now = Date.now();
    for (let i = 0; i < this.trackCount; i++) {
      const items = this.tracks.get(i) || [];
      this.tracks.set(
        i,
        items.filter(item => now - item.startTime < item.duration + 1000)
      );
    }
  }

  // 更新配置
  updateConfig(trackCount?: number, screenWidth?: number) {
    if (screenWidth) this.screenWidth = screenWidth;
    if (trackCount && trackCount !== this.trackCount) {
      this.trackCount = trackCount;
      // 重新初始化轨道
      for (let i = 0; i < trackCount; i++) {
        if (!this.tracks.has(i)) {
          this.tracks.set(i, []);
        }
      }
    }
  }

  // 清空所有（滚动轨道 + 停留槽位，清屏后槽位从 0 重新分配）
  clear() {
    for (let i = 0; i < this.trackCount; i++) {
      this.tracks.set(i, []);
    }
    this.staySlots.clear();
  }
}

// 单例
export const danmakuEngine = new DanmakuEngine();