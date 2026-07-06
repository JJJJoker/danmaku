// 语音弹幕服务 - 使用 Web Speech API (SpeechSynthesis)

import { DanmakuMessage, DanmakuSettings } from '../../shared/types';

const MAX_SPEAK_DURATION = 10000; // 每条语音最长 10 秒

interface QueueItem {
  text: string;
  timestamp: number;
  rate: number;
  volume: number;
}

class TTSService {
  private synth: SpeechSynthesis | null = null;
  private queue: QueueItem[] = [];
  private speaking = false;
  private maxQueueSize = 20; // 最多排队 20 条
  private currentTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.synth = window.speechSynthesis;
      console.log('[TTS] ✅ TTSService initialized, speechSynthesis available');
    } else {
      console.warn('[TTS] ❌ TTSService initialized, speechSynthesis NOT available. typeof window:', typeof window);
    }
  }

  /**
   * 朗读文字（按时间戳顺序排队）
   */
  speak(text: string, options?: { rate?: number; volume?: number; lang?: string; timestamp?: number }) {
    console.log('[TTS] speak() called:', { text: text.substring(0, 30), synthAvailable: !!this.synth, queueLength: this.queue.length });
    if (!this.synth) {
      console.warn('[TTS] SpeechSynthesis not available');
      // 尝试重新获取
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        this.synth = window.speechSynthesis;
        console.log('[TTS] ✅ speechSynthesis obtained on retry');
      } else {
        console.warn('[TTS] ❌ speechSynthesis still not available after retry');
        return;
      }
    }

    if (!text || text.trim().length === 0) return;

    const rate = options?.rate ?? 1.0;
    const volume = options?.volume ?? 1.0;
    const timestamp = options?.timestamp ?? Date.now();

    // 如果队列太长，丢弃最早的
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }

    // 插入队列并按时间戳排序
    this.queue.push({ text, timestamp, rate, volume });
    this.queue.sort((a, b) => a.timestamp - b.timestamp);

    this.processQueue();
  }

  private processQueue() {
    if (this.speaking || this.queue.length === 0 || !this.synth) return;

    this.speaking = true;
    const item = this.queue.shift()!;

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = item.rate;
    utterance.volume = item.volume;
    utterance.lang = 'zh-CN';
    this.currentUtterance = utterance;

    // 10 秒超时：强制停止当前语音
    this.currentTimeout = setTimeout(() => {
      console.warn('[TTS] Utterance exceeded 10s, forcing stop');
      this.forceStop();
    }, MAX_SPEAK_DURATION);

    // onend/onerror 可能在被 cancel 后才异步到达；只处理仍属于当前语音的事件，
    // 否则旧事件会清掉下一条语音的 10s 看门狗并重复推进队列
    const finish = () => {
      if (this.currentUtterance !== utterance) return;
      this.clearTimeout();
      this.speaking = false;
      this.currentUtterance = null;
      this.processQueue();
    };

    utterance.onend = finish;

    utterance.onerror = (e) => {
      console.warn('[TTS] Speech error:', e.error);
      finish();
    };

    try {
      console.log('[TTS] Calling synth.speak():', { text: item.text.substring(0, 20), rate: item.rate, volume: item.volume });
      this.synth.speak(utterance);
      console.log('[TTS] ✅ synth.speak() called successfully');
    } catch (e) {
      this.clearTimeout();
      console.warn('[TTS] ❌ Failed to speak:', e);
      this.speaking = false;
      this.currentUtterance = null;
      // 继续播放队列中的下一条，避免队列停摆
      this.processQueue();
    }
  }

  private clearTimeout() {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
  }

  /**
   * 强制停止当前语音（10s 超时触发）
   */
  private forceStop() {
    this.clearTimeout();
    // 先清空 currentUtterance，让被 cancel 的语音随后到达的 onend/onerror 不再推进队列
    this.currentUtterance = null;
    this.speaking = false;
    if (this.synth) {
      this.synth.cancel();
    }
    // 继续播放队列中的下一条
    this.processQueue();
  }

  /**
   * 停止朗读并清空队列
   */
  stop() {
    this.clearTimeout();
    this.queue = [];
    this.speaking = false;
    this.currentUtterance = null;
    if (this.synth) {
      this.synth.cancel();
    }
  }

  /**
   * 检查 TTS 是否可用
   */
  isAvailable(): boolean {
    return this.synth !== null;
  }

  /**
   * 获取可用的语音列表
   */
  getVoices(): SpeechSynthesisVoice[] {
    return this.synth?.getVoices() ?? [];
  }

  /**
   * 获取中文语音列表
   */
  getChineseVoices(): SpeechSynthesisVoice[] {
    return this.getVoices().filter(v => v.lang.startsWith('zh'));
  }
}

export const ttsService = new TTSService();

// ===== 语音弹幕朗读入口（在 TTS 所在窗口直接调用）=====

const MAX_SPOKEN_IDS = 200;        // 记住最近朗读过的弹幕 ID（本地发送与网络回环会重复送达同一条）
const SENDER_MIN_INTERVAL = 50000; // 接收端按发送者限频（发送端限 60s，留余量），防止异常客户端刷语音

const spokenIds = new Set<string>();
const lastSpokenAtBySender = new Map<string, number>();

/**
 * 朗读一条语音弹幕：按弹幕 ID 去重、按发送者限频，格式"用户xxx发来语音弹幕：xxx"
 */
export function speakVoiceDanmaku(
  message: DanmakuMessage,
  settings: Pick<DanmakuSettings, 'voiceEnabled' | 'voiceRate' | 'voiceVolume'>
) {
  if (!message.isVoice || !settings.voiceEnabled) return;

  if (spokenIds.has(message.id)) return;

  const senderKey = message.userId || message.sender || 'unknown';
  const now = Date.now();
  const lastAt = lastSpokenAtBySender.get(senderKey);
  if (lastAt !== undefined && now - lastAt < SENDER_MIN_INTERVAL) {
    console.warn(`[TTS] 发送者 ${senderKey} 语音弹幕过于频繁，跳过朗读`);
    return;
  }

  spokenIds.add(message.id);
  if (spokenIds.size > MAX_SPOKEN_IDS) {
    spokenIds.delete(spokenIds.values().next().value!);
  }
  lastSpokenAtBySender.set(senderKey, now);
  if (lastSpokenAtBySender.size > 500) lastSpokenAtBySender.clear();

  ttsService.speak(`用户${message.sender || '匿名'}发来语音弹幕：${message.text}`, {
    rate: settings.voiceRate,
    volume: settings.voiceVolume,
    timestamp: message.timestamp,
  });
}
