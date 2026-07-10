// 语音服务测试：speakVoiceDanmaku 的按 ID 去重 + 按发送者限频（模块级状态经重置钩子清理），
// TTSService 类的队列 / 10s 看门狗 / stale onend 防护（mock Web Speech API）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TTSService,
  ttsService,
  speakVoiceDanmaku,
  __resetVoiceDanmakuStateForTests,
} from './ttsService';
import { DanmakuMessage } from '../../shared/types';

const T0 = 1_700_000_000_000;

let seq = 0;
function voiceMsg(overrides: Partial<DanmakuMessage> = {}): DanmakuMessage {
  return {
    id: `v${++seq}`,
    text: '测试语音',
    userId: 'u1',
    color: '#fff',
    fontSize: 24,
    speed: 'normal',
    timestamp: Date.now(),
    sender: '小A',
    isVoice: true,
    ...overrides,
  };
}

const SETTINGS = { voiceEnabled: true, voiceRate: 1.2, voiceVolume: 0.8, voiceURI: '' };

afterEach(() => {
  vi.useRealTimers();
});

describe('speakVoiceDanmaku 去重与限频', () => {
  let speakSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetVoiceDanmakuStateForTests();
    speakSpy = vi.spyOn(ttsService, 'speak').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it('非语音消息不朗读', () => {
    speakVoiceDanmaku(voiceMsg({ isVoice: false }), SETTINGS);
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('voiceEnabled=false 不朗读', () => {
    speakVoiceDanmaku(voiceMsg(), { ...SETTINGS, voiceEnabled: false });
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('朗读文案为"用户X发来语音弹幕：文本"，携带 rate/volume/timestamp', () => {
    const message = voiceMsg({ text: '大家好', sender: '小A', timestamp: 12345 });
    speakVoiceDanmaku(message, SETTINGS);

    expect(speakSpy).toHaveBeenCalledWith('用户小A发来语音弹幕：大家好', {
      rate: 1.2,
      volume: 0.8,
      voiceURI: '',
      timestamp: 12345,
    });
  });

  it('sender 缺省时文案用"匿名"', () => {
    speakVoiceDanmaku(voiceMsg({ sender: undefined, text: '喂' }), SETTINGS);
    expect(speakSpy).toHaveBeenCalledWith('用户匿名发来语音弹幕：喂', expect.anything());
  });

  it('相同 id 重复送达只朗读一次', () => {
    const message = voiceMsg();
    speakVoiceDanmaku(message, SETTINGS);
    speakVoiceDanmaku(message, SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it('同一发送者 50s 内第二条被限频，50s 后放行', () => {
    speakVoiceDanmaku(voiceMsg({ userId: 'u1' }), SETTINGS);
    vi.setSystemTime(T0 + 10_000);
    speakVoiceDanmaku(voiceMsg({ userId: 'u1' }), SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 50_001);
    speakVoiceDanmaku(voiceMsg({ userId: 'u1' }), SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(2);
  });

  it('限频键取 userId、缺失回退 sender；不同 userId 互不限频', () => {
    speakVoiceDanmaku(voiceMsg({ userId: 'u1' }), SETTINGS);
    speakVoiceDanmaku(voiceMsg({ userId: 'u2' }), SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(2);

    // 无 userId 时按 sender 限频
    speakVoiceDanmaku(voiceMsg({ userId: '', sender: '张三' }), SETTINGS);
    speakVoiceDanmaku(voiceMsg({ userId: '', sender: '张三' }), SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(3);
  });

  it('去重集合超 200 条时 LRU 淘汰最早的 id，可再次朗读', () => {
    const first = voiceMsg({ userId: 'u0' });
    speakVoiceDanmaku(first, SETTINGS);
    // 再灌 200 条不同发送者的语音，把 first.id 挤出去重集合
    for (let i = 1; i <= 200; i++) {
      speakVoiceDanmaku(voiceMsg({ userId: `filler-${i}` }), SETTINGS);
    }
    expect(speakSpy).toHaveBeenCalledTimes(201);

    // 同一条弹幕换个发送者身份绕开限频（只验证 id 已被淘汰）
    vi.setSystemTime(T0 + 60_000);
    speakVoiceDanmaku({ ...first, userId: 'u0' }, SETTINGS);
    expect(speakSpy).toHaveBeenCalledTimes(202);
  });
});

describe('TTSService 队列与看门狗', () => {
  class FakeUtterance {
    text: string;
    rate = 1;
    volume = 1;
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  let synth: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  /** synth.speak 收到的第 n 个 utterance */
  function utteranceAt(n: number): FakeUtterance {
    return synth.speak.mock.calls[n][0] as FakeUtterance;
  }

  function spokenTexts(): string[] {
    return synth.speak.mock.calls.map(([u]) => (u as FakeUtterance).text);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    synth = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', synth);
  });

  it('空文本或纯空白直接忽略', () => {
    const svc = new TTSService();
    svc.speak('');
    svc.speak('   ');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('入队即朗读，onend 后推进下一条', () => {
    const svc = new TTSService();
    svc.speak('第一条', { timestamp: 1 });
    expect(spokenTexts()).toEqual(['第一条']);

    svc.speak('第二条', { timestamp: 2 });
    expect(synth.speak).toHaveBeenCalledTimes(1); // 上一条未结束，先排队

    utteranceAt(0).onend!();
    expect(spokenTexts()).toEqual(['第一条', '第二条']);
  });

  it('队列按 timestamp 升序播放', () => {
    const svc = new TTSService();
    svc.speak('先到先说', { timestamp: 100 }); // 立即开播
    svc.speak('晚的', { timestamp: 300 });
    svc.speak('早的', { timestamp: 200 });

    utteranceAt(0).onend!();
    utteranceAt(1).onend!();
    expect(spokenTexts()).toEqual(['先到先说', '早的', '晚的']);
  });

  it('队列达 20 条上限时丢弃最早一条', () => {
    const svc = new TTSService();
    svc.speak('s0', { timestamp: 0 }); // 出队开播，队列空
    for (let i = 1; i <= 21; i++) {
      svc.speak(`s${i}`, { timestamp: i }); // s1..s20 入队后满，s21 挤掉 s1
    }
    utteranceAt(0).onend!();
    expect(spokenTexts()[1]).toBe('s2'); // s1 已被丢弃
  });

  it('10s 无 onend 触发看门狗：cancel 当前并继续下一条', () => {
    const svc = new TTSService();
    svc.speak('卡住的', { timestamp: 1 });
    svc.speak('下一条', { timestamp: 2 });

    vi.advanceTimersByTime(10_000);

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(['卡住的', '下一条']);
  });

  it('stale onend 防护：看门狗强停后，旧 utterance 迟到的 onend 不重复推进队列', () => {
    const svc = new TTSService();
    svc.speak('卡住的', { timestamp: 1 });
    svc.speak('第二条', { timestamp: 2 });
    svc.speak('第三条', { timestamp: 3 });

    vi.advanceTimersByTime(10_000); // 看门狗强停第一条，开播第二条
    expect(spokenTexts()).toEqual(['卡住的', '第二条']);

    utteranceAt(0).onend!(); // 被 cancel 的第一条迟到的 onend
    // 未被防护的话这里会立即推进第三条并清掉第二条的看门狗
    expect(spokenTexts()).toEqual(['卡住的', '第二条']);

    vi.advanceTimersByTime(10_000); // 第二条自己的看门狗仍然生效
    expect(spokenTexts()).toEqual(['卡住的', '第二条', '第三条']);
  });

  it('onerror 与 onend 等价推进队列', () => {
    const svc = new TTSService();
    svc.speak('出错的', { timestamp: 1 });
    svc.speak('下一条', { timestamp: 2 });

    utteranceAt(0).onerror!({ error: 'synthesis-failed' });
    expect(spokenTexts()).toEqual(['出错的', '下一条']);
  });

  it('synth.speak 抛异常时不停摆，后续仍可朗读', () => {
    const svc = new TTSService();
    synth.speak.mockImplementationOnce(() => {
      throw new Error('底层炸了');
    });
    expect(() => svc.speak('炸掉的', { timestamp: 1 })).not.toThrow();

    svc.speak('恢复的', { timestamp: 2 });
    expect(spokenTexts()).toEqual(['炸掉的', '恢复的']);
  });

  it('stop 清空队列并 cancel 当前朗读', () => {
    const svc = new TTSService();
    svc.speak('播放中', { timestamp: 1 });
    svc.speak('排队中', { timestamp: 2 });

    svc.stop();

    expect(synth.cancel).toHaveBeenCalled();
    svc.speak('新的', { timestamp: 3 });
    expect(spokenTexts()).toEqual(['播放中', '新的']); // 排队中的已被清掉
  });

  it('构造时 speechSynthesis 缺失则静默忽略，可用后重试获取成功', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const svc = new TTSService();
    expect(svc.isAvailable()).toBe(false);
    expect(() => svc.speak('没人听见', { timestamp: 1 })).not.toThrow();

    vi.stubGlobal('speechSynthesis', synth);
    svc.speak('听见了', { timestamp: 2 });
    expect(spokenTexts()).toEqual(['听见了']);
  });

  describe('音色选择 voiceURI', () => {
    const VOICES = [
      { name: '普通话女声', lang: 'zh-CN', voiceURI: 'zh-CN-female', default: false, localService: true } as SpeechSynthesisVoice,
      { name: '普通话男声', lang: 'zh-CN', voiceURI: 'zh-CN-male', default: false, localService: true } as SpeechSynthesisVoice,
      { name: 'English', lang: 'en-US', voiceURI: 'en-US-female', default: true, localService: true } as SpeechSynthesisVoice,
    ];

    beforeEach(() => {
      synth.getVoices.mockReturnValue(VOICES);
    });

    it('传入存在的 voiceURI 时命中对应 voice', () => {
      const svc = new TTSService();
      svc.speak('文本', { timestamp: 1, voiceURI: 'zh-CN-male' });
      expect(utteranceAt(0).voice).toEqual(VOICES[1]);
    });

    it('传入不存在的 voiceURI 时静默回落，不抛错、voice 保持 null', () => {
      const svc = new TTSService();
      expect(() => svc.speak('文本', { timestamp: 1, voiceURI: 'not-exist' })).not.toThrow();
      expect(utteranceAt(0).voice).toBeNull();
    });

    it('不传 voiceURI 时 voice 保持未设置', () => {
      const svc = new TTSService();
      svc.speak('文本', { timestamp: 1 });
      expect(utteranceAt(0).voice).toBeNull();
    });

    it('getChineseVoices 按 lang 前缀 zh 过滤', () => {
      const svc = new TTSService();
      expect(svc.getChineseVoices()).toEqual([VOICES[0], VOICES[1]]);
    });

    it('onVoicesChanged 注册并可取消订阅（同一回调）', () => {
      const svc = new TTSService();
      const callback = vi.fn();
      const unsubscribe = svc.onVoicesChanged(callback);

      expect(synth.addEventListener).toHaveBeenCalledWith('voiceschanged', callback);

      unsubscribe();
      expect(synth.removeEventListener).toHaveBeenCalledWith('voiceschanged', callback);
    });

    it('speechSynthesis 不可用时 onVoicesChanged 返回空操作，不抛错', () => {
      vi.stubGlobal('speechSynthesis', undefined);
      const svc = new TTSService();
      const unsubscribe = svc.onVoicesChanged(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });
  });
});
