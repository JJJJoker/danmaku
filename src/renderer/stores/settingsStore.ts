import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DanmakuSettings } from '../../shared/types';

interface SettingsState {
  settings: DanmakuSettings;
  updateSettings: (partial: Partial<DanmakuSettings>) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: DanmakuSettings = {
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
  defaultPosition: 'top',
  defaultMode: 'scroll',
  stayDuration: 5000,
  voiceEnabled: false,
  voiceRate: 1.0,
  voiceVolume: 1.0,
  voiceURI: '',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,

      updateSettings: (partial) => {
        set(state => ({
          settings: { ...state.settings, ...partial },
        }));
      },

      resetSettings: () => {
        set({ settings: DEFAULT_SETTINGS });
      },
    }),
    {
      name: 'danmaku-settings',
      // 只持久化 settings
      partialize: (state) => ({ settings: state.settings }),
      // 深度合并：确保新增字段（如 overlayBounds）不会因旧版 localStorage 而丢失
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SettingsState>;
        return {
          ...currentState,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings || {}),
          },
        };
      },
    }
  )
);

// 多窗口同步：控制面板窗口和弹幕窗口各持有独立的 store 实例，
// 另一窗口写入 localStorage 时重新水合，保证设置（语音开关、透明度等）实时一致
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'danmaku-settings') {
      useSettingsStore.persist.rehydrate();
    }
  });
}