import { DanmakuMessage, LLMChatRequest } from '../../shared/types';
import { useBotStore, getActivePersona } from '../stores/botStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useDanmakuStore } from '../stores/danmakuStore';
import { useSettingsStore } from '../stores/settingsStore';
import { ServerConnection } from './peerService';

// 吐槽姬服务：只在控制面板窗口运行（App.tsx 按 windowType 过滤）。
// 三种触发：随机定时 / 关键词（含 @角色名 必触发）/ 房主手动。
// LLM HTTP 调用经主进程代理（window.electronAPI.llm.chat），渲染进程直连会被 CORS 拦。

export type BotTriggerReason = 'random' | 'keyword' | 'manual';

// 每发送者触发冷却（对齐语音弹幕的 60s 口径）
const SENDER_COOLDOWN_MS = 60_000;
// 去重集合上限（淘汰法同 ttsService）
const MAX_REPLIED_IDS = 200;
// 发送者冷却表上限，超出整体清空
const MAX_SENDER_ENTRIES = 500;
// LLM 上下文最多携带的最近弹幕条数（与 danmakuStore 历史内存上限一致）
const MAX_CONTEXT_DANMAKU = 100;

function rand6() {
  return Math.random().toString(36).substr(2, 6);
}

class BotService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;  // 同一时间只允许一次 LLM 调用，后到的直接丢弃（吐槽讲究时效，不排队）
  private repliedIds = new Set<string>();
  private lastReplyAt = 0;  // 关键词回应全局冷却
  private lastTriggerBySender = new Map<string, number>();

  // ========== 生命周期 ==========

  start(): boolean {
    const bot = useBotStore.getState();
    const conn = useConnectionStore.getState();
    const room = conn.activeRoomId ? conn.rooms[conn.activeRoomId] : null;

    if (!bot.config.apiKey.trim()) {
      bot.setRuntime({ lastError: '请先填写 AccessKey' });
      return false;
    }
    if (conn.status !== 'connected' || !conn.activeRoomId) {
      bot.setRuntime({ lastError: '请先连接进入房间' });
      return false;
    }
    if (!room?.isHost) {
      bot.setRuntime({ lastError: '只有房主可以启动吐槽姬' });
      return false;
    }

    bot.setRuntime({ running: true, lastError: null });
    this.scheduleNext();
    return true;
  }

  stop(reason?: string) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    useBotStore.getState().setRuntime({
      running: false,
      generating: false,
      ...(reason !== undefined ? { lastError: reason } : {}),
    });
  }

  private scheduleNext() {
    if (this.timer) clearTimeout(this.timer);
    const { minIntervalSec, maxIntervalSec } = useBotStore.getState().config;
    const delayMs = (minIntervalSec + Math.random() * Math.max(0, maxIntervalSec - minIntervalSec)) * 1000;
    this.timer = setTimeout(() => {
      void this.trigger('random');
    }, delayMs);
  }

  // ========== 弹幕观察（关键词触发） ==========

  // 网络接收（App.tsx 的 initCallbacks 回调转入）与房主本地发送（onLocalDanmaku 转入）共用此管线
  onIncomingDanmaku(danmaku: DanmakuMessage, roomId: string, isReplay: boolean) {
    const bot = useBotStore.getState();
    if (!bot.running || isReplay) return;

    const conn = useConnectionStore.getState();
    if (roomId !== conn.activeRoomId) return;
    // 防自触发死循环（含服务器可能的回显）：bot 弹幕一律跳过
    if (danmaku.userId?.startsWith('bot_')) return;
    if (this.repliedIds.has(danmaku.id)) return;

    const persona = getActivePersona(bot);
    const text = danmaku.text || '';
    const mentioned = text.includes(`@${persona.roleName}`);
    const keywordHit = bot.config.keywords.some(k => k && text.includes(k));
    if (!mentioned && !keywordHit) return;

    const now = Date.now();
    // 全局冷却对 @提及 同样生效，防刷屏
    if (now - this.lastReplyAt < bot.config.replyCooldownSec * 1000) return;
    // 每发送者冷却：@提及可绕过（点名必回应）
    const senderKey = danmaku.userId || danmaku.sender || 'unknown';
    if (!mentioned) {
      const lastAt = this.lastTriggerBySender.get(senderKey) || 0;
      if (now - lastAt < SENDER_COOLDOWN_MS) return;
    }

    // 记录去重与冷却
    this.repliedIds.add(danmaku.id);
    if (this.repliedIds.size > MAX_REPLIED_IDS) {
      this.repliedIds.delete(this.repliedIds.values().next().value!);
    }
    this.lastReplyAt = now;
    this.lastTriggerBySender.set(senderKey, now);
    if (this.lastTriggerBySender.size > MAX_SENDER_ENTRIES) {
      this.lastTriggerBySender.clear();
    }

    void this.trigger('keyword', danmaku);
  }

  // 房主自己发送的弹幕不经过网络回调，由 ControlPanel 发送后喂入
  onLocalDanmaku(danmaku: DanmakuMessage) {
    const { activeRoomId } = useConnectionStore.getState();
    if (!activeRoomId) return;
    this.onIncomingDanmaku(danmaku, activeRoomId, false);
  }

  // ========== 触发与生成 ==========

  async trigger(reason: BotTriggerReason, ctx?: DanmakuMessage): Promise<void> {
    const bot = useBotStore.getState();
    if (!bot.running) return;  // 手动触发同样要求已启动（需求：启动了吐槽姬的房间才能点击触发）
    if (this.busy) {
      // 忙碌时丢弃本次触发；随机 tick 照常排下一轮
      if (reason === 'random') this.scheduleNext();
      return;
    }

    // 运行中实时校验连接与房主身份，失效即自动停止
    const conn = useConnectionStore.getState();
    const room = conn.activeRoomId ? conn.rooms[conn.activeRoomId] : null;
    if (conn.status !== 'connected' || !room?.isHost) {
      this.stop('连接断开或已非房主，吐槽姬已自动停止');
      return;
    }

    this.busy = true;
    bot.setRuntime({ generating: true, lastError: null });
    try {
      const resp = await window.electronAPI.llm.chat(this.buildChatRequest(reason, ctx));
      if (resp.ok) {
        const text = this.postProcess(resp.content);
        if (text) {
          this.sendBotDanmaku(text);
          useBotStore.getState().setRuntime({ lastRoastAt: Date.now() });
        } else {
          useBotStore.getState().setRuntime({ lastError: '模型返回内容为空' });
        }
      } else {
        useBotStore.getState().setRuntime({ lastError: resp.error });
      }
    } catch (err: any) {
      useBotStore.getState().setRuntime({ lastError: String(err?.message || err) });
    } finally {
      this.busy = false;
      useBotStore.getState().setRuntime({ generating: false });
      // 单次失败不终止：下一个随机 tick 自然重试
      if (reason === 'random' && useBotStore.getState().running) {
        this.scheduleNext();
      }
    }
  }

  private buildChatRequest(reason: BotTriggerReason, ctx?: DanmakuMessage): LLMChatRequest {
    const bot = useBotStore.getState();
    const persona = getActivePersona(bot);
    const conn = useConnectionStore.getState();

    const system =
      `你是弹幕房间里的吐槽机器人「${persona.roleName}」。` +
      `人设：${persona.persona}。语言风格：${persona.style}。` +
      `规则：只输出一条吐槽弹幕正文，不要引号、前缀、解释；` +
      `不超过${bot.config.maxLength}字；犀利幽默但禁止人身攻击、脏话和敏感话题。`;

    // 时间（带语义提示，方便模型拿时间做梗）
    const now = new Date();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const hour = now.getHours();
    const daySense =
      hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
    const timeText = `星期${weekdays[now.getDay()]} ${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（${daySense}）`;

    // 房间名：房主必在 ownedRooms 里，找不到就退回房间号
    const roomName = conn.ownedRooms.find(r => r.roomId === conn.activeRoomId)?.roomName || conn.activeRoomId;

    // 在线用户
    const users = conn.connectedUsers;
    const userText = users.length
      ? `${users.length}人在线：${users.map(u => u.username).join('、')}`
      : '暂无其他人在线';

    // 最近弹幕：当前房间、排除 bot 自己（按各人设角色名过滤，历史项没有 userId），
    // 最多取末 100 条（等于 danmakuStore 历史内存上限）
    const botNames = new Set(bot.personas.map(p => p.roleName));
    const recentLines = useDanmakuStore.getState().history
      .filter(h => h.roomId === conn.activeRoomId && !botNames.has(h.sender))
      .slice(-MAX_CONTEXT_DANMAKU)
      .map(h => `${h.sender}: ${h.text}`);
    const recentText = recentLines.length ? recentLines.join('\n') : '暂无弹幕';

    const reasonText =
      reason === 'keyword' && ctx
        ? `针对这条弹幕吐槽：『${ctx.sender || '匿名用户'}: ${ctx.text}』`
        : reason === 'manual'
          ? '房主点名让你吐槽，针对当前状况来一条'
          : '随机找个角度吐个槽';

    const user =
      `当前时间：${timeText}\n` +
      `房间名：${roomName}\n` +
      `在线用户：${userText}\n` +
      `最近弹幕：\n${recentText}\n\n` +
      `${reasonText}`;

    return {
      baseURL: bot.config.baseURL,
      apiKey: bot.config.apiKey,
      model: bot.config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 256,
    };
  }

  // 去首尾引号/换行，超长截断（1.5 倍容忍，避免刚好超一两个字就硬截）
  private postProcess(raw: string): string {
    let text = raw.trim().replace(/\n+/g, ' ');
    text = text.replace(/^["'“”『』「」\s]+/, '').replace(/["'“”『』「」\s]+$/, '');
    const limit = Math.floor(useBotStore.getState().config.maxLength * 1.5);
    if (text.length > limit) text = text.slice(0, limit) + '…';
    return text;
  }

  // ========== 人设角色名自动生成 ==========

  async generateRoleName(personaText: string): Promise<string> {
    const bot = useBotStore.getState();
    const fallback = `吐槽姬${bot.personas.length + 1}号`;
    if (!bot.config.apiKey.trim()) return fallback;
    try {
      const resp = await window.electronAPI.llm.chat({
        baseURL: bot.config.baseURL,
        apiKey: bot.config.apiKey,
        model: bot.config.model,
        messages: [
          { role: 'system', content: '根据给定人设生成一个2~6个字的中文角色名，只输出名字本身，不要引号和解释。' },
          { role: 'user', content: personaText },
        ],
        maxTokens: 32,
      });
      if (!resp.ok) return fallback;
      const name = resp.content.replace(/["'“”『』「」【】\s。，,.!！?？]/g, '').slice(0, 8);
      return name || fallback;
    } catch {
      return fallback;
    }
  }

  // ========== 发送（复刻 ControlPanel 四步发送流） ==========

  private sendBotDanmaku(text: string) {
    const bot = useBotStore.getState();
    const persona = getActivePersona(bot);
    const conn = useConnectionStore.getState();
    const { settings } = useSettingsStore.getState();

    const message: DanmakuMessage = {
      id: `dm_${Date.now()}_${rand6()}`,
      text,
      // bot_ 前缀用于自触发过滤；后缀带房主持久 id 保持可溯源
      userId: `bot_${ServerConnection.getPersistentUserId() || 'local'}`,
      color: bot.config.danmakuColor,
      fontSize: bot.config.danmakuFontSize,
      speed: settings.speed,
      timestamp: Date.now(),
      sender: persona.roleName,
      position: bot.config.danmakuPosition,
      mode: bot.config.danmakuMode,
    };

    // 1. 本地历史（按 id 去重，天然兼容服务器可能的回显）
    useDanmakuStore.getState().addHistory({
      id: message.id,
      text: message.text,
      sender: persona.roleName,
      color: message.color,
      timestamp: message.timestamp,
      roomId: conn.activeRoomId || undefined,
    });

    // 2. 转发到弹幕窗口（房主本机可见——不能依赖服务器回显）
    try {
      window.electronAPI?.forwardDanmakuToWindow?.({
        message,
        fontSize: message.fontSize,
        speed: message.speed,
        position: message.position,
        mode: message.mode,
        stayDuration: settings.stayDuration,
      });
    } catch (err) {
      console.error('[BotService] Failed to forward bot danmaku:', err);
    }

    // 3. 网络广播给房间其他人
    if (conn.status === 'connected') {
      conn.sendDanmaku(message);
    }
  }
}

export const botService = new BotService();
