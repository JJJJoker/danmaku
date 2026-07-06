// 服务器地址解析：用户自定义（localStorage）> 构建期注入（VITE_DANMAKU_SERVER_URL）> 空
// 开源版本源码不含任何真实服务器地址；官方发版由 CI 注入默认值，自部署用户在「设置」中填写

export const SERVER_URL_KEY = 'funapp-server-url';

// 用户在设置中填写的自定义地址
export function getCustomServerUrl(): string {
  return (localStorage.getItem(SERVER_URL_KEY) || '').trim();
}

export function setCustomServerUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) {
    localStorage.setItem(SERVER_URL_KEY, trimmed);
  } else {
    localStorage.removeItem(SERVER_URL_KEY);
  }
}

// 构建期注入的官方默认地址（CI 通过仓库变量 DANMAKU_SERVER_URL 注入）
export function getDefaultServerUrl(): string {
  return (import.meta.env.VITE_DANMAKU_SERVER_URL || '').trim();
}

// 解析最终生效的 WebSocket 地址；返回 '' 表示未配置
export function resolveServerUrl(): string {
  const url = getCustomServerUrl() || getDefaultServerUrl();
  if (!url) return '';
  // 无 scheme 时自动补 ws://
  if (!/^wss?:\/\//i.test(url)) {
    return `ws://${url}`;
  }
  return url;
}

// 由 WebSocket 地址派生 stats HTTP 接口地址（服务器约定：stats 端口 = 弹幕端口 + 1）
export function deriveStatsUrl(): string | null {
  const url = resolveServerUrl();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.port) return null; // 无显式端口无法按 +1 约定推导
    const httpProtocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    const statsPort = parseInt(parsed.port, 10) + 1;
    return `${httpProtocol}//${parsed.hostname}:${statsPort}/stats`;
  } catch {
    return null;
  }
}
