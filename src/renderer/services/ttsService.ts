// 语音弹幕服务 - 使用 Web Speech API (SpeechSynthesis)

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

    utterance.onend = () => {
      this.clearTimeout();
      this.speaking = false;
      this.currentUtterance = null;
      this.processQueue();
    };

    utterance.onerror = (e) => {
      this.clearTimeout();
      console.warn('[TTS] Speech error:', e.error);
      this.speaking = false;
      this.currentUtterance = null;
      this.processQueue();
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
    if (this.synth) {
      this.synth.cancel();
    }
    this.speaking = false;
    this.currentUtterance = null;
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
