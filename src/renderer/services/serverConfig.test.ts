// 服务器地址解析测试：三级优先级（设置自定义 > 构建期注入 > 空）与 stats 端口 +1 派生
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SERVER_URL_KEY,
  getCustomServerUrl,
  setCustomServerUrl,
  resolveServerUrl,
  deriveStatsUrl,
} from './serverConfig';

beforeEach(() => {
  // 显式建立"未注入"基线：vitest 走 vite 的 env 管线，开发者本机 .env.local 里的
  // VITE_DANMAKU_SERVER_URL 会泄漏进来，不能依赖变量缺席
  vi.stubEnv('VITE_DANMAKU_SERVER_URL', '');
});

describe('自定义地址读写（localStorage）', () => {
  it('setCustomServerUrl 写入 trim 后的值，getCustomServerUrl 读回', () => {
    setCustomServerUrl('  ws://my.server:8080  ');
    expect(localStorage.getItem(SERVER_URL_KEY)).toBe('ws://my.server:8080');
    expect(getCustomServerUrl()).toBe('ws://my.server:8080');
  });

  it('传空串或纯空白时删除 localStorage 键', () => {
    setCustomServerUrl('ws://my.server:8080');
    setCustomServerUrl('   ');
    expect(localStorage.getItem(SERVER_URL_KEY)).toBeNull();
    expect(getCustomServerUrl()).toBe('');
  });
});

describe('resolveServerUrl 三级优先级', () => {
  it('localStorage 自定义地址优先于构建期注入值', () => {
    vi.stubEnv('VITE_DANMAKU_SERVER_URL', 'ws://official.server:8080');
    setCustomServerUrl('ws://custom.server:9090');
    expect(resolveServerUrl()).toBe('ws://custom.server:9090');
  });

  it('无自定义时取构建期注入的 VITE_DANMAKU_SERVER_URL', () => {
    vi.stubEnv('VITE_DANMAKU_SERVER_URL', 'wss://official.server:8443');
    expect(resolveServerUrl()).toBe('wss://official.server:8443');
  });

  it('两者皆空返回空字符串（由调用方报"未配置"）', () => {
    expect(resolveServerUrl()).toBe('');
  });

  it('无 scheme 时自动补 ws://', () => {
    setCustomServerUrl('1.2.3.4:8080');
    expect(resolveServerUrl()).toBe('ws://1.2.3.4:8080');
  });

  it('已带 ws:// wss://（含大写）时不重复补 scheme', () => {
    setCustomServerUrl('wss://a.b:8443');
    expect(resolveServerUrl()).toBe('wss://a.b:8443');
    setCustomServerUrl('WSS://a.b:8443');
    expect(resolveServerUrl()).toBe('WSS://a.b:8443');
  });
});

describe('deriveStatsUrl 端口 +1 派生', () => {
  it('ws://host:8080 派生 http://host:8081/stats', () => {
    setCustomServerUrl('ws://my.server:8080');
    expect(deriveStatsUrl()).toBe('http://my.server:8081/stats');
  });

  it('wss 映射为 https', () => {
    setCustomServerUrl('wss://my.server:8443');
    expect(deriveStatsUrl()).toBe('https://my.server:8444/stats');
  });

  it('无显式端口无法按 +1 推导，返回 null', () => {
    setCustomServerUrl('wss://my.server');
    expect(deriveStatsUrl()).toBeNull();
  });

  it('非法 URL 返回 null 而不抛异常', () => {
    setCustomServerUrl('ws://[');
    expect(deriveStatsUrl()).toBeNull();
  });

  it('完全未配置时返回 null', () => {
    expect(deriveStatsUrl()).toBeNull();
  });
});
