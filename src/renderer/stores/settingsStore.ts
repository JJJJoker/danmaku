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