import { ipcMain } from 'electron';
import type { LLMChatRequest, LLMChatResponse } from '../shared/types';

// 吐槽姬的 LLM 调用代理：渲染进程直连外部 API 会被 CORS 拦
// （webSecurity 默认开、生产环境 origin 为 file://），因此 HTTP 请求统一在主进程发起。
// key 由渲染进程按次随请求传入，不在主进程持久化。

// 单次请求超时（LLM 生成短吐槽通常几秒内返回，30s 足够覆盖慢网络）
const REQUEST_TIMEOUT_MS = 30_000;

// 上游错误 body 截断长度（避免日志/UI 被超长 HTML 错误页刷爆）
const ERROR_BODY_MAX_LEN = 300;

export function setupLLM(opts: { log: (msg: string) => void }) {
  const { log } = opts;

  ipcMain.handle('llm:chat', async (_event, req: LLMChatRequest): Promise<LLMChatResponse> => {
    // 错误一律以值返回（不 throw），避免 Electron IPC 把错误信息包装/截断
    if (!req || !req.baseURL || !req.apiKey || !req.model || !Array.isArray(req.messages)) {
      return { ok: false, error: '请求参数不完整（需要 baseURL/apiKey/model/messages）' };
    }

    const url = `${req.baseURL.replace(/\/+$/, '')}/chat/completions`;
    // 日志只记 baseURL/model，绝不打印 apiKey
    log(`[LLM] chat -> ${url} model=${req.model} messages=${req.messages.length}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 256,
        stream: false,
      };
      if (typeof req.temperature === 'number') {
        body.temperature = req.temperature;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, ERROR_BODY_MAX_LEN);
        } catch {
          // body 读取失败就只报状态码
        }
        log(`[LLM] HTTP ${response.status}: ${detail}`);
        return { ok: false, error: `HTTP ${response.status}: ${detail || response.statusText}` };
      }

      const data: any = await response.json();
      const content: unknown = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        log('[LLM] 响应中没有有效的 content');
        return { ok: false, error: '接口返回内容为空（请确认模型名与接口格式）' };
      }
      return { ok: true, content: content.trim() };
    } catch (err: any) {
      const message = err?.name === 'AbortError' ? `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）` : String(err?.message || err);
      log(`[LLM] 请求失败: ${message}`);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  });
}
