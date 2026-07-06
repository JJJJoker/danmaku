import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 吐槽姬（AI 吐槽 Bot）配置与人设存储。
// 注意：吐槽姬只运行在控制面板窗口（弹幕窗口不读本 store），
// 因此这里不做 storage 事件跨窗口重水合——与 settingsStore 的多窗口同步机制无关。

export interface BotPersona {
  id: string;        // 'default' 或 `per_${Date.now()}_${rand6}`
  roleName: string;  // 弹幕 sender 显示名，如 '吐槽姬'
  persona: string;   // 人设描述
  style: string;     // 语言风格描述
}

export interface BotConfig {
  baseURL: string;             // OpenAI 兼容接口地址
  apiKey: string;              // 明文存 localStorage（用户已确认），UI 用密码框掩码
  model: string;
  keywords: string[];          // 触发关键词（弹幕中 @角色名 必触发，不在此列表内）
  minIntervalSec: number;      // 随机吐槽最小间隔（秒），下限 30
  maxIntervalSec: number;      // 随机吐槽最大间隔（秒）
  replyCooldownSec: number;    // 关键词回应全局冷却（秒）
  maxLength: number;           // 吐槽最大字数
  activePersonaId: string;
  danmakuColor: string;        // bot 弹幕颜色（与普通弹幕区分）
  danmakuFontSize: number;
  danmakuPosition: 'top' | 'middle' | 'bottom';
  danmakuMode: 'scroll' | 'stay';
}

export const DEFAULT_PERSONA: BotPersona = {
  id: 'default',
  roleName: '吐槽姬',
  persona: '一个常驻直播间的毒舌观众，眼光挑剔但心地不坏，擅长一针见血地点评直播间里发生的一切',
  style: '短句吐槽，犀利幽默带梗，偶尔阴阳怪气，不用敬语',
};

const DEFAULT_CONFIG: BotConfig = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  keywords: [],
  minIntervalSec: 120,
  maxIntervalSec: 300,
  replyCooldownSec: 20,
  maxLength: 40,
  activePersonaId: 'default',
  danmakuColor: '#ffb6c1',
  danmakuFontSize: 24,
  danmakuPosition: 'top',
  danmakuMode: 'scroll',
};

export const MIN_INTERVAL_FLOOR_SEC = 30;

interface BotState {
  config: BotConfig;
  personas: BotPersona[];
  // —— 以下为运行态，不持久化（重启/窗口重载后回到停止态） ——
  running: boolean;
  generating: boolean;     // LLM 调用中（手动触发/起名按钮转圈）
  lastError: string | null;
  lastRoastAt: number | null;

  updateConfig: (partial: Partial<BotConfig>) => void;
  addPersona: (p: BotPersona) => void;
  updatePersona: (id: string, patch: Partial<Omit<BotPersona, 'id'>>) => void;
  removePersona: (id: string) => void;
  setActivePersona: (id: string) => void;
  setRuntime: (partial: Partial<Pick<BotState, 'running' | 'generating' | 'lastError' | 'lastRoastAt'>>) => void;
}

export const useBotStore = create<BotState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      personas: [DEFAULT_PERSONA],
      running: false,
      generating: false,
      lastError: null,
      lastRoastAt: null,

      updateConfig: (partial) => {
        set(state => {
          const next = { ...state.config, ...partial };
          // 间隔钳制：min 不低于下限，max 不低于 min
          if (next.minIntervalSec < MIN_INTERVAL_FLOOR_SEC) next.minIntervalSec = MIN_INTERVAL_FLOOR_SEC;
          if (next.maxIntervalSec < next.minIntervalSec) next.maxIntervalSec = next.minIntervalSec;
          return { config: next };
        });
      },

      addPersona: (p) => {
        set(state => ({ personas: [...state.personas, p] }));
      },

      updatePersona: (id, patch) => {
        set(state => ({
          personas: state.personas.map(p => (p.id === id ? { ...p, ...patch } : p)),
        }));
      },

      removePersona: (id) => {
        if (id === 'default') return;  // 默认人设不可删
        set(state => ({
          personas: state.personas.filter(p => p.id !== id),
          // 删除的是活跃人设时切回默认
          config: state.config.activePersonaId === id
            ? { ...state.config, activePersonaId: 'default' }
            : state.config,
        }));
      },

      setActivePersona: (id) => {
        set(state => (
          state.personas.some(p => p.id === id)
            ? { config: { ...state.config, activePersonaId: id } }
            : state
        ));
      },

      setRuntime: (partial) => {
        set(partial);
      },
    }),
    {
      name: 'danmaku-bot',
      // 只持久化配置与人设，运行态不落盘
      partialize: (state) => ({ config: state.config, personas: state.personas }),
      // 深度合并：新增配置字段不会因旧版 localStorage 而丢失；personas 为空时回填默认人设
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<Pick<BotState, 'config' | 'personas'>>;
        const personas = persisted?.personas?.length ? persisted.personas : [DEFAULT_PERSONA];
        return {
          ...currentState,
          config: { ...DEFAULT_CONFIG, ...(persisted?.config || {}) },
          personas: personas.some(p => p.id === 'default') ? personas : [DEFAULT_PERSONA, ...personas],
        };
      },
    }
  )
);

// 取当前活跃人设（找不到时兜底默认人设）
export function getActivePersona(state?: Pick<BotState, 'config' | 'personas'>): BotPersona {
  const s = state ?? useBotStore.getState();
  return s.personas.find(p => p.id === s.config.activePersonaId)
    ?? s.personas.find(p => p.id === 'default')
    ?? DEFAULT_PERSONA;
}
