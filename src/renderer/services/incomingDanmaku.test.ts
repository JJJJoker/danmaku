// 网络弹幕接收处理测试：DI 工厂，全部依赖用 vi.fn()，无模块 mock、无定时器
import { describe, it, expect, vi } from 'vitest';
import { createIncomingDanmakuHandler, IncomingDanmakuDeps } from './incomingDanmaku';
import { DanmakuMessage, DanmakuSettings } from '../../shared/types';

const SETTINGS: DanmakuSettings = {
  fontSize: 24,
  speed: 'normal',
  opacity: 1,
  color: '#ffffff',
  maxCount: 200,
  isEnabled: true,
  trackCount: 12,
  showSender: true,
  showBorder: false,
  overlayBounds: { x: 0, y: 0, width: 100, height: 100 },
  defaultPosition: 'middle',
  defaultMode: 'stay',
  stayDuration: 4000,
  voiceEnabled: true,
  voiceRate: 1,
  voiceVolume: 1,
  voiceURI: '',
};

let seq = 0;
function msg(overrides: Partial<DanmakuMessage> = {}): DanmakuMessage {
  return {
    id: `m${++seq}`,
    text: '你好',
    userId: 'u1',
    color: '#fff',
    fontSize: 24,
    speed: 'normal',
    timestamp: 12345,
    sender: '小A',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IncomingDanmakuDeps> = {}): IncomingDanmakuDeps {
  return {
    windowType: null,
    getActiveRoomId: () => 'room1',
    getSettings: () => SETTINGS,
    addDanmaku: vi.fn(),
    addHistory: vi.fn(),
    speakVoice: vi.fn(),
    notifyBot: vi.fn(),
    forwardToDanmakuWindow: vi.fn(),
    ...overrides,
  };
}

describe('roomId 匹配分支', () => {
  it('匹配 activeRoomId 时调用 addDanmaku，参数取自设置与消息', () => {
    const deps = makeDeps();
    const danmaku = msg();

    createIncomingDanmakuHandler(deps)(danmaku, 'room1');

    expect(deps.addDanmaku).toHaveBeenCalledWith(
      danmaku, 24, 'normal', 'room1', 'middle', 'stay', 4000
    );
    expect(deps.addHistory).not.toHaveBeenCalled();
  });

  it('position/mode 优先取消息字段，缺省回落设置默认值', () => {
    const deps = makeDeps();
    const danmaku = msg({ position: 'bottom', mode: 'scroll' });

    createIncomingDanmakuHandler(deps)(danmaku, 'room1');

    expect(deps.addDanmaku).toHaveBeenCalledWith(
      danmaku, 24, 'normal', 'room1', 'bottom', 'scroll', 4000
    );
  });

  it('activeRoomId 在事件时刻取值（getter），切房后按新房间判定', () => {
    let active = 'room1';
    const deps = makeDeps({ getActiveRoomId: () => active });
    const handler = createIncomingDanmakuHandler(deps);

    handler(msg(), 'room1');
    expect(deps.addDanmaku).toHaveBeenCalledTimes(1);

    active = 'room2'; // 切房
    handler(msg(), 'room1');
    expect(deps.addDanmaku).toHaveBeenCalledTimes(1); // 不再匹配
    expect(deps.addHistory).toHaveBeenCalledTimes(1);
  });

  it('非弹幕窗口通知吐槽姬，isReplay 归一化为 boolean', () => {
    const deps = makeDeps({ windowType: 'control' });
    const danmaku = msg();

    createIncomingDanmakuHandler(deps)(danmaku, 'room1'); // isReplay 缺省

    expect(deps.notifyBot).toHaveBeenCalledWith(danmaku, 'room1', false);
  });
});

describe('语音守卫（isVoice && !isReplay && 非弹幕窗口）', () => {
  it('三条件齐备时朗读并传入设置', () => {
    const deps = makeDeps({ windowType: 'control' });
    const danmaku = msg({ isVoice: true });

    createIncomingDanmakuHandler(deps)(danmaku, 'room1', false);

    expect(deps.speakVoice).toHaveBeenCalledWith(danmaku, SETTINGS);
  });

  it('历史回放（isReplay=true）不朗读', () => {
    const deps = makeDeps({ windowType: 'control' });
    createIncomingDanmakuHandler(deps)(msg({ isVoice: true }), 'room1', true);
    expect(deps.speakVoice).not.toHaveBeenCalled();
  });

  it('弹幕窗口不朗读也不通知吐槽姬', () => {
    const deps = makeDeps({ windowType: 'danmaku' });
    createIncomingDanmakuHandler(deps)(msg({ isVoice: true }), 'room1');
    expect(deps.speakVoice).not.toHaveBeenCalled();
    expect(deps.notifyBot).not.toHaveBeenCalled();
    expect(deps.addDanmaku).toHaveBeenCalled(); // 显示不受影响
  });

  it('非语音弹幕不朗读', () => {
    const deps = makeDeps({ windowType: 'control' });
    createIncomingDanmakuHandler(deps)(msg(), 'room1');
    expect(deps.speakVoice).not.toHaveBeenCalled();
  });
});

describe('控制窗口 IPC 转发', () => {
  it('windowType=control 时转发完整 payload 到弹幕窗口', () => {
    const deps = makeDeps({ windowType: 'control' });
    const danmaku = msg();

    createIncomingDanmakuHandler(deps)(danmaku, 'room1');

    expect(deps.forwardToDanmakuWindow).toHaveBeenCalledWith({
      message: danmaku,
      fontSize: 24,
      speed: 'normal',
      position: 'middle',
      mode: 'stay',
      stayDuration: 4000,
    });
  });

  it('转发抛异常被捕获，不影响已完成的 addDanmaku 也不向外抛', () => {
    const deps = makeDeps({
      windowType: 'control',
      forwardToDanmakuWindow: vi.fn(() => {
        throw new Error('IPC 断了');
      }),
    });

    expect(() => createIncomingDanmakuHandler(deps)(msg(), 'room1')).not.toThrow();
    expect(deps.addDanmaku).toHaveBeenCalled();
  });

  it('forwardToDanmakuWindow 缺失（无 electronAPI）时不报错', () => {
    const deps = makeDeps({ windowType: 'control', forwardToDanmakuWindow: undefined });
    expect(() => createIncomingDanmakuHandler(deps)(msg(), 'room1')).not.toThrow();
  });

  it('单窗口兼容模式（windowType=null）不转发，但朗读与吐槽姬正常', () => {
    const deps = makeDeps({ windowType: null });
    createIncomingDanmakuHandler(deps)(msg({ isVoice: true }), 'room1');

    expect(deps.forwardToDanmakuWindow).not.toHaveBeenCalled();
    expect(deps.speakVoice).toHaveBeenCalled();
    expect(deps.notifyBot).toHaveBeenCalled();
  });
});

describe('roomId 不匹配分支', () => {
  it('仅写入历史（字段映射完整、sender 回退匿名用户），不显示不朗读不转发', () => {
    const deps = makeDeps({ windowType: 'control' });
    const danmaku = msg({ id: 'x1', text: '别处的', sender: undefined, isVoice: true, timestamp: 777 });

    createIncomingDanmakuHandler(deps)(danmaku, 'other-room');

    expect(deps.addHistory).toHaveBeenCalledWith({
      id: 'x1',
      text: '别处的',
      sender: '匿名用户',
      color: '#fff',
      timestamp: 777,
      roomId: 'other-room',
      isVoice: true,
    });
    expect(deps.addDanmaku).not.toHaveBeenCalled();
    expect(deps.speakVoice).not.toHaveBeenCalled();
    expect(deps.notifyBot).not.toHaveBeenCalled();
    expect(deps.forwardToDanmakuWindow).not.toHaveBeenCalled();
  });
});
