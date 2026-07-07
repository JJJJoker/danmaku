// 弹幕引擎测试：轨道分配 / 重叠判断 / 停留槽位 / 速度映射，全部时间相关逻辑用假时钟驱动
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DanmakuEngine, DanmakuTrackItem } from './danmakuEngine';
import { DanmakuMessage } from '../../shared/types';

const T0 = 1_000_000_000_000;

let seq = 0;
function msg(overrides: Partial<DanmakuMessage> = {}): DanmakuMessage {
  return {
    id: `m${++seq}`,
    text: '你好',
    userId: 'u1',
    color: '#fff',
    fontSize: 0, // 0 为 falsy，默认落到 settingsFontSize
    speed: 'normal',
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('文字宽度估算（经 processDanmaku 的 width 字段间接断言）', () => {
  it('中文每字 fontSize×1.2、ASCII 每字 fontSize×0.6，总宽加 20 padding', () => {
    const engine = new DanmakuEngine(12, 1920);
    const zh = engine.processDanmaku(msg({ text: '你好', fontSize: 20 }), 24, 'normal');
    expect(zh.width).toBeCloseTo(2 * 20 * 1.2 + 20, 5); // 68

    const ascii = engine.processDanmaku(msg({ text: 'ab', fontSize: 20 }), 24, 'normal');
    expect(ascii.width).toBeCloseTo(2 * 20 * 0.6 + 20, 5); // 44
  });

  it('语音弹幕宽度计入 🔊🔊🔊 前缀并额外加 4px 间距补偿', () => {
    const engine = new DanmakuEngine(12, 1920);
    const item = engine.processDanmaku(msg({ text: '你好', fontSize: 20, isVoice: true }), 24, 'normal');
    // 前缀 3 个 emoji 按宽字符计：(3+2)*20*1.2 + 20 + 4
    expect(item.width).toBeCloseTo(5 * 20 * 1.2 + 20 + 4, 5);
  });

  it('message.fontSize 优先于 settingsFontSize 参与估宽', () => {
    const engine = new DanmakuEngine(12, 1920);
    const item = engine.processDanmaku(msg({ text: '你好', fontSize: 20 }), 40, 'normal');
    expect(item.fontSize).toBe(20);
    expect(item.width).toBeCloseTo(2 * 20 * 1.2 + 20, 5);

    const fallback = engine.processDanmaku(msg({ text: '你好', fontSize: 0 }), 40, 'normal');
    expect(fallback.fontSize).toBe(40);
    expect(fallback.width).toBeCloseTo(2 * 40 * 1.2 + 20, 5);
  });
});

describe('allocateTrack 三段轨道分组（12 轨 → 每组 4）', () => {
  it('top/middle/bottom 分别从 0/4/8 号轨道开始分配', () => {
    const engine = new DanmakuEngine(12, 1920);
    expect(engine.allocateTrack('top')).toBe(0);
    expect(engine.allocateTrack('middle')).toBe(4);
    expect(engine.allocateTrack('bottom')).toBe(8);
  });

  it('选择活跃弹幕最少的轨道', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // → 轨道 0
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // → 轨道 1
    expect(engine.allocateTrack('top')).toBe(2);
  });

  it('弹幕分配不越出位置组：top 占用不影响 bottom 从 8 号轨分配', () => {
    const engine = new DanmakuEngine(12, 1920);
    for (let i = 0; i < 4; i++) engine.processDanmaku(msg(), 24, 'normal', 'top');
    const item = engine.processDanmaku(msg(), 24, 'normal', 'bottom');
    expect(item.trackId).toBe(8);
  });

  it('时间推进使弹幕过期后不再计入评分，轨道被重新选中', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // 轨道 0，duration 7000
    vi.setSystemTime(T0 + 1000);
    expect(engine.allocateTrack('top')).toBe(1); // 轨道 0 仍活跃
    vi.setSystemTime(T0 + 8000);
    expect(engine.allocateTrack('top')).toBe(0); // 已过期，评分归零
  });
});

describe('hasSpace 重叠公式', () => {
  it('空轨道返回 true', () => {
    const engine = new DanmakuEngine(12, 1920);
    expect(engine.hasSpace(0, 500)).toBe(true);
  });

  it('上一条刚发出（elapsed=0）时同宽新弹幕没有空间', () => {
    const engine = new DanmakuEngine(12, 1920);
    const first = engine.processDanmaku(msg(), 24, 'normal', 'top');
    expect(engine.hasSpace(first.trackId, first.width)).toBe(false);
  });

  it('时间推进至上一条充分进入屏幕后返回 true', () => {
    const engine = new DanmakuEngine(12, 1920);
    const first = engine.processDanmaku(msg(), 24, 'normal', 'top'); // duration 7000
    vi.setSystemTime(T0 + 3500); // 已走过半屏
    expect(engine.hasSpace(first.trackId, first.width)).toBe(true);
  });
});

describe('processDanmaku · scroll 模式与 SPEED_DURATION 优先级', () => {
  it('settingsSpeed 命中映射时优先于 message.speed', () => {
    const engine = new DanmakuEngine(12, 1920);
    const item = engine.processDanmaku(msg({ speed: 'fast' }), 24, 'slow');
    expect(item.duration).toBe(10000);
  });

  it('settingsSpeed 非法时回退 message.speed 映射，再回退默认 7000', () => {
    const engine = new DanmakuEngine(12, 1920);
    const byMessage = engine.processDanmaku(msg({ speed: 'fast' }), 24, '未知档位');
    expect(byMessage.duration).toBe(4000);

    const byDefault = engine.processDanmaku(
      msg({ speed: '未知档位' as unknown as DanmakuMessage['speed'] }), 24, '未知档位'
    );
    expect(byDefault.duration).toBe(7000);
  });

  it('speed 字段 = 屏幕宽度 ÷ 穿越秒数', () => {
    const engine = new DanmakuEngine(12, 1920);
    const item = engine.processDanmaku(msg(), 24, 'slow'); // 10000ms
    expect(item.speed).toBeCloseTo(1920 / 10, 5);
  });

  it('最佳轨道无空间时，顺延到同组内第一条有空间的轨道', () => {
    const engine = new DanmakuEngine(6, 1920); // 每组 2 轨，便于构造场景
    // 白盒预置轨道内容：轨道 0 一条刚发出的弹幕（评分低但无空间），
    // 轨道 1 两条早已走远的弹幕（评分高但有空间）——公开 API 难以构造此错位场景
    const base: DanmakuTrackItem = {
      id: 'seed', text: '你好', color: '#fff', fontSize: 24, speed: 274,
      trackId: 0, startTime: T0, duration: 7000, width: 100, mode: 'scroll', position: 'top',
    };
    (engine as any).tracks.set(0, [{ ...base }]);
    (engine as any).tracks.set(1, [
      { ...base, trackId: 1, startTime: T0 - 6500 },
      { ...base, trackId: 1, startTime: T0 - 6000 },
    ]);

    const item = engine.processDanmaku(msg(), 24, 'normal', 'top');
    expect(item.trackId).toBe(1);
  });

  it('全组都无空间时保持 allocateTrack 结果（允许重叠，不越出位置组）', () => {
    const engine = new DanmakuEngine(6, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // 轨道 0，刚发出
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // 轨道 1，刚发出
    const item = engine.processDanmaku(msg(), 24, 'normal', 'top');
    expect([0, 1]).toContain(item.trackId); // 不落到 middle/bottom 组
    expect(item.trackId).toBe(0); // 平分时取组内第一条
  });
});

describe('processDanmaku · stay 模式槽位（每位置 5 槽）', () => {
  it('依次占用槽位 0-4，item 的 speed=0、duration=stayDuration', () => {
    const engine = new DanmakuEngine(12, 1920);
    const slots = Array.from({ length: 5 }, () =>
      engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 3000)
    );
    expect(slots.map(s => s.trackId)).toEqual([0, 1, 2, 3, 4]);
    expect(slots[0].speed).toBe(0);
    expect(slots[0].duration).toBe(3000);
  });

  it('5 槽占满后按活跃数取模循环复用（允许重叠）', () => {
    const engine = new DanmakuEngine(12, 1920);
    for (let i = 0; i < 5; i++) engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000);
    const sixth = engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000);
    expect(sixth.trackId).toBe(0); // 5 % 5 = 0
  });

  it('槽内弹幕过期后，最小空闲槽位被回收复用', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000); // 槽 0
    engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 2000); // 槽 1，短寿命
    engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000); // 槽 2

    vi.setSystemTime(T0 + 3000); // 槽 1 过期，0/2 仍活跃
    const item = engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000);
    expect(item.trackId).toBe(1);
  });

  it('top/bottom 槽位相互独立', () => {
    const engine = new DanmakuEngine(12, 1920);
    for (let i = 0; i < 3; i++) engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000);
    const bottom = engine.processDanmaku(msg(), 24, 'normal', 'bottom', 'stay', 5000);
    expect(bottom.trackId).toBe(0);
  });
});

describe('cleanup / updateConfig / clear', () => {
  it('cleanup 移除超过 duration+1000 的弹幕、保留未过期的', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // 轨道 0，7000ms
    vi.setSystemTime(T0 + 5000);
    engine.processDanmaku(msg(), 24, 'normal', 'top'); // 轨道 1，仍新鲜

    vi.setSystemTime(T0 + 8100); // 第一条超过 7000+1000
    engine.cleanup();

    // 轨道内容无公开读取接口，白盒断言私有 tracks
    expect((engine as any).tracks.get(0)).toHaveLength(0);
    expect((engine as any).tracks.get(1)).toHaveLength(1);
  });

  it('updateConfig 增大轨道数时新增空轨且保留旧轨内容', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top');
    engine.updateConfig(15);
    expect((engine as any).tracks.size).toBe(15);
    expect((engine as any).tracks.get(0)).toHaveLength(1);
    expect(engine.allocateTrack('bottom')).toBe(10); // 15/3=5，bottom 组从 10 开始
  });

  it('updateConfig 修改屏幕宽度影响后续弹幕速度', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.updateConfig(undefined, 960);
    const item = engine.processDanmaku(msg(), 24, 'normal');
    expect(item.speed).toBeCloseTo(960 / 7, 5);
  });

  it('clear 清空滚动轨道与停留槽位，清屏后停留弹幕从槽 0 重新分配', () => {
    const engine = new DanmakuEngine(12, 1920);
    engine.processDanmaku(msg(), 24, 'normal', 'top');
    for (let i = 0; i < 3; i++) engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000); // 占到槽 2

    engine.clear();

    expect((engine as any).tracks.get(0)).toHaveLength(0);
    const next = engine.processDanmaku(msg(), 24, 'normal', 'top', 'stay', 5000);
    expect(next.trackId).toBe(0); // 槽位记录已清，不再跳过"被占"的旧槽
  });
});
