// settingsStore 测试：persist 持久化、merge 深合并（旧版 localStorage 兼容）、
// storage 事件跨窗口重水合（多窗口设置同步的关键机制，v1.3.0 曾在这里踩坑）
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

const KEY = 'danmaku-settings';

function seedStorage(settings: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state: { settings }, version: 0 }));
}

/** storage 事件触发的 rehydrate 是异步微任务，等一拍再断言 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().resetSettings();
});

describe('updateSettings / resetSettings 与持久化', () => {
  it('部分更新合并进 settings 并持久化到 localStorage（只含 settings 字段）', () => {
    useSettingsStore.getState().updateSettings({ fontSize: 30, voiceEnabled: true });

    const state = useSettingsStore.getState().settings;
    expect(state.fontSize).toBe(30);
    expect(state.voiceEnabled).toBe(true);
    expect(state.speed).toBe('normal'); // 未更新字段保留

    const persisted = JSON.parse(localStorage.getItem(KEY)!);
    expect(persisted.state.settings.fontSize).toBe(30);
    expect(Object.keys(persisted.state)).toEqual(['settings']); // partialize 只存 settings
  });

  it('resetSettings 恢复全部默认值', () => {
    useSettingsStore.getState().updateSettings({ fontSize: 99, opacity: 0.1 });
    useSettingsStore.getState().resetSettings();

    const state = useSettingsStore.getState().settings;
    expect(state.fontSize).toBe(24);
    expect(state.opacity).toBe(1);
  });
});

describe('merge 深合并（旧版 localStorage 兼容）', () => {
  it('旧数据只有部分字段时，缺失字段回落默认值（新增设置项不因旧存档丢失）', async () => {
    seedStorage({ fontSize: 66 }); // 模拟旧版本只存过 fontSize
    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState().settings;
    expect(state.fontSize).toBe(66);
    expect(state.voiceEnabled).toBe(false); // v1.3.0 新增字段回落默认
    expect(state.overlayBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(state.stayDuration).toBe(5000);
  });

  it('存档缺 settings 字段时不崩溃，得到完整默认设置', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: {}, version: 0 }));
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().settings.fontSize).toBe(24);
    expect(useSettingsStore.getState().settings.trackCount).toBe(12);
  });
});

describe('storage 事件跨窗口重水合', () => {
  it('另一窗口写入 danmaku-settings 后，本窗口经 storage 事件拿到新值', async () => {
    seedStorage({ fontSize: 55 }); // 模拟另一窗口直接写 localStorage

    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    await flush();

    expect(useSettingsStore.getState().settings.fontSize).toBe(55);
  });

  it('其他 key 的 storage 事件不触发重水合', async () => {
    seedStorage({ fontSize: 77 });

    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }));
    await flush();

    expect(useSettingsStore.getState().settings.fontSize).toBe(24); // 保持默认，未重水合
  });
});
