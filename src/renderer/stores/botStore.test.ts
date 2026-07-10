// botStore 测试：roleName 可修改并持久化、validateRoleName 校验规则
import { describe, it, expect, beforeEach } from 'vitest';
import { useBotStore, validateRoleName, DEFAULT_PERSONA, BotPersona } from './botStore';

const KEY = 'danmaku-bot';

/** 重置 store 到初始态（default 人设 + 默认配置），避免测试间状态串味 */
function resetBotStore() {
  useBotStore.setState({
    config: {
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
    },
    personas: [DEFAULT_PERSONA],
    running: false,
    generating: false,
    lastError: null,
    lastRoastAt: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetBotStore();
});

describe('updatePersona roleName', () => {
  it('roleName 可被修改且其他字段不受影响', () => {
    useBotStore.getState().updatePersona('default', { roleName: '毒舌小美' });

    const persona = useBotStore.getState().personas.find(p => p.id === 'default')!;
    expect(persona.roleName).toBe('毒舌小美');
    expect(persona.persona).toBe(DEFAULT_PERSONA.persona);
    expect(persona.style).toBe(DEFAULT_PERSONA.style);
  });

  it('default 人设同样允许改名', () => {
    useBotStore.getState().updatePersona('default', { roleName: '自定义名字' });

    const persona = useBotStore.getState().personas.find(p => p.id === 'default')!;
    expect(persona.id).toBe('default');
    expect(persona.roleName).toBe('自定义名字');
  });

  it('roleName 变更后持久化到 localStorage', () => {
    useBotStore.getState().updatePersona('default', { roleName: '持久化测试名' });

    const persisted = JSON.parse(localStorage.getItem(KEY)!);
    const persona = persisted.state.personas.find((p: BotPersona) => p.id === 'default');
    expect(persona.roleName).toBe('持久化测试名');
  });
});

describe('validateRoleName', () => {
  const personas: BotPersona[] = [
    DEFAULT_PERSONA,
    { id: 'per_1', roleName: '小杠精', persona: 'x', style: 'y' },
  ];

  it('空字符串报错', () => {
    expect(validateRoleName(personas, '')).toBe('角色名不能为空');
  });

  it('纯空白报错', () => {
    expect(validateRoleName(personas, '   ')).toBe('角色名不能为空');
  });

  it('1 字报错', () => {
    expect(validateRoleName(personas, '姬')).toBe('角色名至少 2 个字（太短容易误触发 @ 提及）');
  });

  it('恰好 2 字通过', () => {
    expect(validateRoleName(personas, '小姬')).toBeNull();
  });

  it('超 10 字报错', () => {
    expect(validateRoleName(personas, '一二三四五六七八九十一')).toBe('角色名最多 10 个字');
  });

  it('与其他人设重名（trim 后相等）报错', () => {
    expect(validateRoleName(personas, '小杠精')).toBe('角色名已被其他人设占用，换一个吧');
    expect(validateRoleName(personas, '  小杠精  ')).toBe('角色名已被其他人设占用，换一个吧');
  });

  it('excludeId 排除自身（同名不算重）', () => {
    expect(validateRoleName(personas, '小杠精', 'per_1')).toBeNull();
  });

  it('合法返回 null', () => {
    expect(validateRoleName(personas, '新角色名')).toBeNull();
  });
});
