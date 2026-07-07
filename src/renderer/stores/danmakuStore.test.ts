// danmakuStore 测试：核心是 addHistory 按 id 去重 +100 条上限（防重复写入的关键防线），
// 引擎经 spyOn 打桩隔离，store 测试不受引擎内部时序影响
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDanmakuStore, HistoryItem } from './danmakuStore';
import { danmakuEngine, DanmakuTrackItem } from '../services/danmakuEngine';
import { DanmakuMessage } from '../../shared/types';

let seq = 0;
function msg(overrides: Partial<DanmakuMessage> = {}): DanmakuMessage {
  return {
    id: `m${++seq}`,
    text: '你好',
    userId: 'u1',
    color: '#fff',
    fontSize: 24,
    speed: 'normal',
    timestamp: Date.now(),
    ...overrides,
  };
}

function trackItem(overrides: Partial<DanmakuTrackItem> = {}): DanmakuTrackItem {
  return {
    id: `t${++seq}`,
    text: '你好',
    color: '#fff',
    fontSize: 24,
    speed: 274,
    trackId: 0,
    startTime: Date.now(),
    duration: 7000,
    width: 100,
    mode: 'scroll',
    position: 'top',
    ...overrides,
  };
}

function historyItem(id: string): HistoryItem {
  return { id, text: '你好', sender: '小A', color: '#fff', timestamp: Date.now() };
}

let processSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useDanmakuStore.setState({ danmakus: [], history: [], maxCount: 200 });
  processSpy = vi.spyOn(danmakuEngine, 'processDanmaku');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addDanmaku', () => {
  it('调用引擎并把返回 item 追加进 danmakus，同时写入历史（sender 缺省为匿名用户）', () => {
    const item = trackItem();
    processSpy.mockReturnValue(item);

    useDanmakuStore.getState().addDanmaku(msg({ id: item.id, sender: undefined }), 24, 'normal', 'room1');

    const state = useDanmakuStore.getState();
    expect(state.danmakus).toEqual([item]);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ id: item.id, sender: '匿名用户', roomId: 'room1' });
  });

  it('position/mode 优先级：message 字段 > 入参 > 默认 top/scroll', () => {
    processSpy.mockReturnValue(trackItem());
    const store = useDanmakuStore.getState();

    store.addDanmaku(msg({ position: 'bottom', mode: 'stay' }), 24, 'normal', undefined, 'middle', 'scroll', 3000);
    expect(processSpy).toHaveBeenLastCalledWith(expect.anything(), 24, 'normal', 'bottom', 'stay', 3000);

    store.addDanmaku(msg(), 24, 'normal', undefined, 'middle', 'scroll', 3000);
    expect(processSpy).toHaveBeenLastCalledWith(expect.anything(), 24, 'normal', 'middle', 'scroll', 3000);

    store.addDanmaku(msg(), 24, 'normal');
    expect(processSpy).toHaveBeenLastCalledWith(expect.anything(), 24, 'normal', 'top', 'scroll', 5000);
  });

  it('达到 maxCount 时丢弃：不进列表、不写历史、不调用引擎', () => {
    useDanmakuStore.getState().setMaxCount(0);

    useDanmakuStore.getState().addDanmaku(msg(), 24, 'normal');

    expect(processSpy).not.toHaveBeenCalled();
    expect(useDanmakuStore.getState().danmakus).toHaveLength(0);
    expect(useDanmakuStore.getState().history).toHaveLength(0);
  });

  it('duration+500ms 后自动移除弹幕', () => {
    vi.useFakeTimers();
    const item = trackItem({ duration: 7000, startTime: Date.now() });
    processSpy.mockReturnValue(item);

    useDanmakuStore.getState().addDanmaku(msg({ id: item.id }), 24, 'normal');
    expect(useDanmakuStore.getState().danmakus).toHaveLength(1);

    vi.advanceTimersByTime(7499);
    expect(useDanmakuStore.getState().danmakus).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useDanmakuStore.getState().danmakus).toHaveLength(0);
  });
});

describe('addHistory 去重与上限（服务器/多路径重复写入的防线）', () => {
  it('相同 id 二次写入被忽略（本地已写入后收到同一条弹幕的场景）', () => {
    const store = useDanmakuStore.getState();
    store.addHistory(historyItem('dup-1'));
    store.addHistory({ ...historyItem('dup-1'), text: '内容变了也不重复记' });

    expect(useDanmakuStore.getState().history).toHaveLength(1);
    expect(useDanmakuStore.getState().history[0].text).toBe('你好');
  });

  it('超 100 条时只保留最新 100 条', () => {
    const store = useDanmakuStore.getState();
    for (let i = 0; i < 105; i++) store.addHistory(historyItem(`h${i}`));

    const history = useDanmakuStore.getState().history;
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe('h5');
    expect(history[99].id).toBe('h104');
  });

  it('不同 id 正常追加且保序', () => {
    const store = useDanmakuStore.getState();
    store.addHistory(historyItem('a'));
    store.addHistory(historyItem('b'));
    expect(useDanmakuStore.getState().history.map(h => h.id)).toEqual(['a', 'b']);
  });
});

describe('removeDanmaku / clearAll / cleanupExpired / clearHistory', () => {
  it('removeDanmaku 按 id 精确移除', () => {
    const a = trackItem({ id: 'a' });
    const b = trackItem({ id: 'b' });
    useDanmakuStore.setState({ danmakus: [a, b] });

    useDanmakuStore.getState().removeDanmaku('a');
    expect(useDanmakuStore.getState().danmakus).toEqual([b]);
  });

  it('clearAll 调用引擎 clear 并清空弹幕列表', () => {
    const clearSpy = vi.spyOn(danmakuEngine, 'clear');
    useDanmakuStore.setState({ danmakus: [trackItem()] });

    useDanmakuStore.getState().clearAll();

    expect(clearSpy).toHaveBeenCalled();
    expect(useDanmakuStore.getState().danmakus).toHaveLength(0);
  });

  it('cleanupExpired 调用引擎 cleanup 并移除超过 duration+500 的弹幕', () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.spyOn(danmakuEngine, 'cleanup').mockImplementation(() => {});
    const now = Date.now();
    const expired = trackItem({ id: 'old', startTime: now - 8000, duration: 7000 });
    const fresh = trackItem({ id: 'new', startTime: now - 1000, duration: 7000 });
    useDanmakuStore.setState({ danmakus: [expired, fresh] });

    useDanmakuStore.getState().cleanupExpired();

    expect(cleanupSpy).toHaveBeenCalled();
    expect(useDanmakuStore.getState().danmakus.map(d => d.id)).toEqual(['new']);
  });

  it('clearHistory 清空历史', () => {
    useDanmakuStore.setState({ history: [historyItem('a')] });
    useDanmakuStore.getState().clearHistory();
    expect(useDanmakuStore.getState().history).toHaveLength(0);
  });
});
