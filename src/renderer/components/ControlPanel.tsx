import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useDanmakuStore } from '../stores/danmakuStore';
import { useConnectionStore } from '../stores/connectionStore';
import { DanmakuMessage, UpdateState, UpdateStatus } from '../../shared/types';
import { ServerConnection } from '../services/serverConnection';
import { getDefaultServerUrl, resolveServerUrl } from '../services/serverConfig';
import { ttsService, speakVoiceDanmaku } from '../services/ttsService';
import { botService } from '../services/botService';
import { useBotStore } from '../stores/botStore';
import RoomPanel from './RoomPanel';
import HistoryPanel from './HistoryPanel';
import BotPanel from './BotPanel';

const PRESET_COLORS = [
  { name: '白', value: '#ffffff' },
  { name: '红', value: '#ff4444' },
  { name: '黄', value: '#ffdd00' },
  { name: '绿', value: '#44ff44' },
  { name: '蓝', value: '#4488ff' },
  { name: '粉', value: '#ff88cc' },
];

const SPEED_OPTIONS: Array<{ label: string; value: 'slow' | 'normal' | 'fast' }> = [
  { label: '慢', value: 'slow' },
  { label: '正常', value: 'normal' },
  { label: '快', value: 'fast' },
];

const POSITION_OPTIONS: Array<{ label: string; value: 'top' | 'middle' | 'bottom' }> = [
  { label: '顶部', value: 'top' },
  { label: '中部', value: 'middle' },
  { label: '底部', value: 'bottom' },
];

const MODE_OPTIONS: Array<{ label: string; value: 'scroll' | 'stay' }> = [
  { label: '滚动', value: 'scroll' },
  { label: '停留', value: 'stay' },
];

const DRAG_THRESHOLD = 5;

interface ControlPanelProps {
  standalone?: boolean;  // 是否为独立窗口模式
}

const ControlPanel: React.FC<ControlPanelProps> = ({ standalone = false }) => {
  // 立即执行，不等待 useEffect - 使用 console.log 确保能看到
  console.log('[ControlPanel RENDER DEBUG] Component rendering, standalone:', standalone);
  console.log('[ControlPanel RENDER DEBUG] typeof window:', typeof window);
  console.log('[ControlPanel RENDER DEBUG] window.electronAPI exists:', !!window.electronAPI);
  console.log('[ControlPanel RENDER DEBUG] window.electronAPI.log exists:', !!(window as any).electronAPI?.log);
  
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.log) {
    try {
      window.electronAPI.log(`[ControlPanel RENDER] Component rendering, standalone: ${standalone}`);
    } catch (e) {
      console.error('[ControlPanel RENDER] Failed to call log:', e);
    }
  } else {
    console.error('[ControlPanel RENDER ERROR] Cannot call electronAPI.log - API not available');
  }

  // 在组件初始化时测试 API 可用性
  useEffect(() => {
    const apiAvailable = !!window.electronAPI;
    const resizeAvailable = !!window.electronAPI?.resizeControlWindow;
    const forwardAvailable = !!window.electronAPI?.forwardDanmakuToWindow;
    
    // 立即写入日志文件，不依赖任何条件
    if (window.electronAPI && window.electronAPI.log) {
      window.electronAPI.log(`[ControlPanel INIT] Component initialized, standalone: ${standalone}`);
      window.electronAPI.log(`[ControlPanel INIT] window.electronAPI available: ${apiAvailable}`);
      window.electronAPI.log(`[ControlPanel INIT] resizeControlWindow available: ${resizeAvailable}`);
      window.electronAPI.log(`[ControlPanel INIT] forwardDanmakuToWindow available: ${forwardAvailable}`);
    } else {
      // 如果 electronAPI 不可用，尝试直接写入文件（调试用）
      console.error('[ControlPanel INIT] CRITICAL: window.electronAPI is UNDEFINED!');
      // 尝试使用 fetch 直接写入文件作为最后手段
      try {
        const logPath = 'C:\\Users\\Administrator\\AppData\\Roaming\\funapp\\app.log';
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [ControlPanel INIT] CRITICAL: window.electronAPI is UNDEFINED!\n`;
        // 注意：这里无法直接写入文件，只能通过 IPC
      } catch (e) {
        console.error('[ControlPanel INIT] Failed to write debug log:', e);
      }
    }
    
    console.log('[ControlPanel] Component initialized, standalone:', standalone);
    console.log('[ControlPanel] window.electronAPI available:', apiAvailable);
    if (window.electronAPI) {
      console.log('[ControlPanel] resizeControlWindow available:', resizeAvailable);
      console.log('[ControlPanel] forwardDanmakuToWindow available:', forwardAvailable);
    } else {
      console.error('[ControlPanel] ERROR: window.electronAPI is undefined!');
    }
  }, []);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isContentCollapsed, setIsContentCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'room' | 'history' | 'bot' | 'about'>('settings');
  const [inputText, setInputText] = useState('');
  const [customColor, setCustomColor] = useState('');
  const [voiceInputText, setVoiceInputText] = useState('');
  const [voiceCooldown, setVoiceCooldown] = useState(0); // 剩余秒数

  // 软件更新状态
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  // 用户主动操作（检查/下载）后才展示 not-available / error 结果，启动自动检查失败保持静默
  const [manualUpdateAction, setManualUpdateAction] = useState(false);

  // 挂载时先订阅推送再拉取快照（cleanup 取消订阅，防监听器泄漏）
  useEffect(() => {
    const unsubscribe = window.electronAPI?.updater?.onStatus((status) => {
      setUpdateStatus(status);
    });
    window.electronAPI?.updater?.getState().then((s) => {
      setUpdateState(s);
      // 快照只作初始值：若实时推送已先到达（如下载进行中重建窗口），不能用旧快照覆盖
      setUpdateStatus((prev) => prev ?? s.status);
    });
    return () => unsubscribe?.();
  }, []);

  // 拖拽位置状态
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('control-panel-position');
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        // 确保保存的位置在当前屏幕范围内
        if (pos.x >= 0 && pos.x < window.innerWidth && pos.y >= 0 && pos.y < window.innerHeight) {
          return pos;
        }
      } catch { }
    }
    // 默认左上角（安全位置，避免因分辨率问题渲染到界面之外）
    return { x: 20, y: 20 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        hasDragged.current = true;
      }
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      setPosition({ x: newX, y: newY });
    };

    const handleUp = () => {
      setIsDragging(false);
      localStorage.setItem('control-panel-position', JSON.stringify(position));
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, position]);

  // 组件卸载时停止朗读
  useEffect(() => {
    window.electronAPI?.log(`[ControlPanel] TTS setup: ttsService.available=${ttsService.isAvailable()}, speechSynthesis=${!!window.speechSynthesis}`);
    return () => {
      ttsService.stop();
    };
  }, []);

  // macOS: 任一文本输入框聚焦时降低控制面板层级，让输入法候选框显示在最上层。
  // 用 document 级监听统一覆盖所有输入框（含 RoomPanel），失焦后恢复置顶
  useEffect(() => {
    if (window.electronAPI?.platform !== 'darwin') return;

    const isTextInput = (el: EventTarget | null): boolean => {
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) {
        return ['text', 'password', 'search', 'url', 'tel', 'email', 'number'].includes(el.type);
      }
      return el instanceof HTMLElement && el.isContentEditable;
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (isTextInput(e.target)) {
        window.electronAPI?.setControlWindowLevel('normal');
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      // 焦点移到另一个文本输入框时保持 normal，避免层级来回抖动
      if (isTextInput(e.target) && !isTextInput(e.relatedTarget)) {
        window.electronAPI?.setControlWindowLevel('high');
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // 确保初始化时弹幕窗口保持穿透
  useEffect(() => {
    window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
  }, []);

  // 在 standalone 模式下，动态调整窗口高度以匹配内容（宽度固定避免振荡）
  useEffect(() => {
    if (!standalone) return;

    // 延迟执行，等待 DOM 更新
    const timer = setTimeout(() => {
      const panelElement = document.querySelector('.cp-panel');
      if (!panelElement) return;

      // 创建 ResizeObserver 并保存到 ref
      resizeObserverRef.current = new ResizeObserver((entries) => {
        if (resizeDebounceRef.current) {
          clearTimeout(resizeDebounceRef.current);
        }

        resizeDebounceRef.current = setTimeout(() => {
          for (const entry of entries) {
            // 宽度固定（面板 CSS width 320px + padding 24px），高度用 offsetHeight（含 padding+border）
            const fixedWidth = 320 + 24;
            // macOS 上需要额外加 10px 避免底部裁切
            const adjustedHeight = (entry.target as HTMLElement).offsetHeight + 10;
            window.electronAPI?.resizeControlWindow(fixedWidth, adjustedHeight);
          }
        }, 50);
      });

      resizeObserverRef.current.observe(panelElement);

      // 立即触发一次大小调整
      const fixedWidth = 320 + 24;
      const rect = panelElement.getBoundingClientRect();
      // macOS 上需要额外加 10px 避免底部裁切
      const adjustedHeight = Math.ceil(rect.height) + 10;
      window.electronAPI?.resizeControlWindow(fixedWidth, adjustedHeight);
    }, 100);

    // 清理函数
    return () => {
      clearTimeout(timer);
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [standalone]); // 只依赖 standalone，不在 isContentCollapsed 变化时重建

  // 如果是独立窗口模式，使用相对定位而不是固定定位
  const panelStyle = standalone 
    ? { position: 'relative' as const, width: '100%', minHeight: isContentCollapsed ? 'auto' : '100%' }
    : { position: 'fixed' as const, left: position.x, top: position.y, zIndex: 9999 };

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true);
    hasDragged.current = false;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };



  // 不再根据鼠标位置切换穿透状态，避免干扰其他应用
  const handleMouseEnter = useCallback(() => {
    // 空操作
  }, []);

  const handleMouseLeave = useCallback(() => {
    // 空操作
  }, []);

  const { settings, updateSettings } = useSettingsStore();
  const { addHistory, clearAll, setMaxCount } = useDanmakuStore();
  const { status, sendDanmaku, username, serverUrl, setServerUrl } = useConnectionStore();
  const botRunning = useBotStore(s => s.running);  // 吐槽姬 tab 的运行中绿点

  // 语音开关关闭时停止朗读并清空队列
  useEffect(() => {
    if (!settings.voiceEnabled) {
      ttsService.stop();
    }
  }, [settings.voiceEnabled]);

  // 系统语音列表（Chromium 下 voices 异步加载，需订阅 voiceschanged 事件刷新）
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => ttsService.getVoices());
  useEffect(() => {
    const refresh = () => setVoices(ttsService.getVoices());
    refresh();
    return ttsService.onVoicesChanged(refresh);
  }, []);
  const zhVoices = voices.filter(v => v.lang.startsWith('zh'));

  // 语音弹幕倒计时
  useEffect(() => {
    if (voiceCooldown <= 0) return;
    const timer = setInterval(() => {
      setVoiceCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [voiceCooldown > 0]);

  // 发送语音弹幕
  const handleSendVoiceDanmaku = useCallback(() => {
    const text = voiceInputText.trim();
    if (!text || voiceCooldown > 0) return;

    const message: DanmakuMessage = {
      id: `dm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      text,
      userId: ServerConnection.getPersistentUserId() || 'local',
      color: settings.color,
      fontSize: settings.fontSize,
      speed: settings.speed,
      timestamp: Date.now(),
      sender: username || '匿名用户',
      position: settings.defaultPosition,
      mode: settings.defaultMode,
      isVoice: true,  // 标记为语音弹幕
    };

    // 本地写入历史（addHistory 按 id 去重，服务器回显不会重复记录）
    const { activeRoomId } = useConnectionStore.getState();
    addHistory({
      id: message.id,
      text: message.text,
      sender: message.sender || '匿名用户',
      color: message.color,
      timestamp: message.timestamp,
      roomId: status === 'connected' && activeRoomId ? activeRoomId : undefined,
      isVoice: message.isVoice,
    });

    // 转发到弹幕窗口显示
    try {
      if (window.electronAPI?.forwardDanmakuToWindow) {
        window.electronAPI.forwardDanmakuToWindow({
          message,
          fontSize: settings.fontSize,
          speed: settings.speed,
          position: settings.defaultPosition,
          mode: settings.defaultMode,
          stayDuration: settings.stayDuration
        });
      }
    } catch (error) {
      console.error('[ControlPanel] Failed to forward voice danmaku:', error);
    }

    // 如果已连接，发送到服务器
    if (status === 'connected') {
      sendDanmaku(message);
    }

    // 本窗口直接朗读（speakVoiceDanmaku 按弹幕 ID 去重，网络回环不会重复朗读）
    speakVoiceDanmaku(message, settings);

    // 房主自己的弹幕不经过网络接收回调，这里喂给吐槽姬做关键词匹配
    botService.onLocalDanmaku(message);

    // 开始 60s 倒计时
    setVoiceCooldown(60);
    setVoiceInputText('');
  }, [voiceInputText, voiceCooldown, settings, status, sendDanmaku, addHistory, username]);

  const handleVoiceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // isComposing: 输入法组合中的 Enter（选字/上屏）不算发送
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSendVoiceDanmaku();
      }
    },
    [handleSendVoiceDanmaku]
  );

  const handleSendDanmaku = useCallback(() => {
    window.electronAPI?.log('[ControlPanel] handleSendDanmaku called');
    window.electronAPI?.log(`[ControlPanel] inputText: ${JSON.stringify(inputText)}`);
    console.log('[ControlPanel] handleSendDanmaku called');
    console.log('[ControlPanel] inputText:', JSON.stringify(inputText));
    
    const text = inputText.trim();
    if (!text) {
      window.electronAPI?.log('[ControlPanel] Input text is empty, returning early');
      console.warn('[ControlPanel] Input text is empty, returning early');
      return;
    }

    window.electronAPI?.log(`[ControlPanel] Sending danmaku: ${text}`);
    console.log('[ControlPanel] Sending danmaku:', text);
    console.log('[ControlPanel] Settings:', { color: settings.color, fontSize: settings.fontSize, speed: settings.speed, defaultPosition: settings.defaultPosition, defaultMode: settings.defaultMode });

    const message: DanmakuMessage = {
      id: `dm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      text,
      userId: ServerConnection.getPersistentUserId() || 'local',
      color: settings.color,
      fontSize: settings.fontSize,
      speed: settings.speed,
      timestamp: Date.now(),
      sender: username || '匿名用户',
      position: settings.defaultPosition,
      mode: settings.defaultMode,
    };

    console.log('[ControlPanel] Danmaku message:', message);

    // 本地写入历史（addHistory 按 id 去重，服务器回显不会重复记录）
    const { activeRoomId } = useConnectionStore.getState();
    addHistory({
      id: message.id,
      text: message.text,
      sender: message.sender || '匿名用户',
      color: message.color,
      timestamp: message.timestamp,
      roomId: status === 'connected' && activeRoomId ? activeRoomId : undefined,
      isVoice: message.isVoice,
    });

    // 始终转发到弹幕窗口（发送者自己也需要看到弹幕）
    try {
      if (window.electronAPI?.forwardDanmakuToWindow) {
        window.electronAPI.forwardDanmakuToWindow({
          message,
          fontSize: settings.fontSize,
          speed: settings.speed,
          position: settings.defaultPosition,
          mode: settings.defaultMode,
          stayDuration: settings.stayDuration
        });
      }
    } catch (error) {
      console.error('[ControlPanel] Failed to forward danmaku to window:', error);
    }

    // 如果已连接，同时发送到服务器/P2P（其他用户会收到）
    if (status === 'connected') {
      console.log('[ControlPanel] Sending via connection');
      sendDanmaku(message);
    }

    // 房主自己的弹幕不经过网络接收回调，这里喂给吐槽姬做关键词匹配
    botService.onLocalDanmaku(message);

    setInputText('');
  }, [inputText, settings, status, sendDanmaku, addHistory, username]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // isComposing: 输入法组合中的 Enter（选字/上屏）不算发送
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSendDanmaku();
      }
    },
    [handleSendDanmaku]
  );

  const handleColorSelect = useCallback(
    (color: string) => {
      updateSettings({ color });
      setCustomColor('');
    },
    [updateSettings]
  );

  const handleCustomColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setCustomColor(val);
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        updateSettings({ color: val });
      }
    },
    [updateSettings]
  );

  const handleMaxCountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      updateSettings({ maxCount: val });
      setMaxCount(val);
    },
    [updateSettings, setMaxCount]
  );

  return (
    <div 
      className={`cp-panel ${isContentCollapsed ? 'collapsed' : ''}`} 
      style={{
        ...panelStyle,
        maxHeight: isContentCollapsed ? '100px' : '520px',
        minHeight: isContentCollapsed ? '60px' : 'auto'
      }}
    >
      {/* 标题栏 - 始终显示（standalone 模式） */}
      {standalone && (
        <div className="cp-drag-region" style={{ WebkitAppRegion: 'drag' }}>
          <span>⚙️ 云弹一下</span>
        </div>
      )}

      {/* 非 standalone 模式的拖拽手柄 - 只在未展开时显示 */}
      {!standalone && !isExpanded && (
        <div
          className="cp-drag-handle"
          onMouseDown={handleDragStart}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <span className="cp-drag-dots">⋮⋮</span>
        </div>
      )}

      {/* 展开后的内容 */}
      {(standalone || isExpanded) && (
        <>
          {/* 输入区域 - 始终显示 */}
          <div className="cp-input-area">
            <input
              className="cp-input"
              type="text"
              placeholder="输入弹幕内容..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={100}
              style={{ position: 'relative', zIndex: 10000 }}
            />
            <button className="cp-send-btn" onClick={handleSendDanmaku} disabled={!inputText.trim()}>
              发送
            </button>
            <button
              className="cp-collapse-content-btn"
              onClick={() => {
                const willCollapse = !isContentCollapsed;
                setIsContentCollapsed(willCollapse);
                // 折叠/展开时立即调整窗口大小
                if (standalone) {
                  const fixedWidth = 344; // 320 + 24
                  if (willCollapse) {
                    // 折叠：只保留输入框高度
                    window.electronAPI?.resizeControlWindow(fixedWidth, 50);
                  } else {
                    // 展开：延迟等 DOM 更新后测量实际高度
                    setTimeout(() => {
                      const panelElement = document.querySelector('.cp-panel');
                      if (!panelElement) return;
                      const rect = panelElement.getBoundingClientRect();
                      // macOS 上需要额外加 10px 避免底部裁切
                      const adjustedHeight = Math.ceil(rect.height) + 10;
                      window.electronAPI?.resizeControlWindow(fixedWidth, adjustedHeight);
                    }, 80);
                  }
                }
              }}
              title={isContentCollapsed ? '展开面板' : '折叠面板'}
            >
              {isContentCollapsed ? '▼' : '▲'}
            </button>
          </div>

          {/* 语音弹幕输入区 - 语音开关开启时显示 */}
          {settings.voiceEnabled && (
            <div className="cp-input-area cp-voice-input-area">
              <input
                className="cp-input"
                type="text"
                placeholder="🔊 输入语音弹幕..."
                value={voiceInputText}
                onChange={(e) => setVoiceInputText(e.target.value)}
                onKeyDown={handleVoiceKeyDown}
                maxLength={100}
                disabled={voiceCooldown > 0}
                style={{ position: 'relative', zIndex: 10000 }}
              />
              <button
                className="cp-send-btn cp-voice-send-btn"
                onClick={handleSendVoiceDanmaku}
                disabled={!voiceInputText.trim() || voiceCooldown > 0}
              >
                {voiceCooldown > 0 ? `${voiceCooldown}s` : '🔊'}
              </button>
            </div>
          )}

          {/* 折叠时才隐藏的内容 */}
          {!isContentCollapsed && (
            <>
              {/* 面板头部 - Tab 标签 */}
              <div className="cp-header">
                <div className="cp-tabs">
                  <button
                    className={`cp-tab ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                  >
                    设置
                  </button>
                  <button
                    className={`cp-tab ${activeTab === 'room' ? 'active' : ''}`}
                    onClick={() => setActiveTab('room')}
                  >
                    房间
                  </button>
                  <button
                    className={`cp-tab ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                  >
                    历史
                  </button>
                  <button
                    className={`cp-tab ${activeTab === 'bot' ? 'active' : ''}`}
                    onClick={() => setActiveTab('bot')}
                  >
                    吐槽姬
                    {botRunning && <span className="cp-tab-badge cp-tab-badge-bot" />}
                  </button>
                  <button
                    className={`cp-tab ${activeTab === 'about' ? 'active' : ''}`}
                    onClick={() => setActiveTab('about')}
                  >
                    说明
                    {(updateStatus?.state === 'available' || updateStatus?.state === 'downloaded') && (
                      <span className="cp-tab-badge" />
                    )}
                  </button>
                </div>
                {!standalone && (
                  <button
                    className="cp-close-btn"
                    onClick={() => setIsExpanded(false)}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* 根据 activeTab 显示不同的内容 */}
              <div className="cp-content">
                {activeTab === 'settings' && (
                  <div className="cp-settings">
                    {/* 字号 */}
                    <div className="cp-setting-row">
                      <label>字号</label>
                      <div className="cp-slider-group">
                        <input
                          type="range"
                          className="cp-slider"
                          min="12"
                          max="48"
                          step="2"
                          value={settings.fontSize}
                          onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                        />
                        <span className="cp-value">{settings.fontSize}px</span>
                      </div>
                    </div>

                    {/* 速度 */}
                    <div className="cp-setting-row">
                      <label>速度</label>
                      <div className="cp-speed-group">
                        {SPEED_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            className={`cp-speed-btn ${settings.speed === opt.value ? 'active' : ''}`}
                            onClick={() => updateSettings({ speed: opt.value })}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 弹幕位置 */}
                    <div className="cp-setting-row">
                      <label>位置</label>
                      <div className="cp-speed-group">
                        {POSITION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            className={`cp-speed-btn ${settings.defaultPosition === opt.value ? 'active' : ''}`}
                            onClick={() => updateSettings({ defaultPosition: opt.value })}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 弹幕模式 */}
                    <div className="cp-setting-row">
                      <label>模式</label>
                      <div className="cp-speed-group">
                        {MODE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            className={`cp-speed-btn ${settings.defaultMode === opt.value ? 'active' : ''}`}
                            onClick={() => updateSettings({ defaultMode: opt.value })}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 停留时长 - 仅在停留模式下显示 */}
                    {settings.defaultMode === 'stay' && (
                      <div className="cp-setting-row">
                        <label>停留时长</label>
                        <div className="cp-slider-group">
                          <input
                            type="range"
                            className="cp-slider"
                            min="1000"
                            max="10000"
                            step="500"
                            value={settings.stayDuration}
                            onChange={(e) => updateSettings({ stayDuration: Number(e.target.value) })}
                          />
                          <span className="cp-value">{(settings.stayDuration / 1000).toFixed(1)}s</span>
                        </div>
                      </div>
                    )}

                    {/* 颜色 */}
                    <div className="cp-setting-row">
                      <label>颜色</label>
                      <div className="cp-color-group">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c.value}
                            className={`cp-color-btn ${settings.color === c.value ? 'active' : ''}`}
                            style={{ backgroundColor: c.value }}
                            onClick={() => handleColorSelect(c.value)}
                            title={c.name}
                          />
                        ))}
                        <input
                          className="cp-color-input"
                          type="text"
                          placeholder="#hex"
                          value={customColor}
                          onChange={handleCustomColorChange}
                          maxLength={7}
                        />
                      </div>
                    </div>

                    {/* 透明度 */}
                    <div className="cp-setting-row">
                      <label>透明度</label>
                      <div className="cp-slider-group">
                        <input
                          type="range"
                          className="cp-slider"
                          min="0.3"
                          max="1"
                          step="0.05"
                          value={settings.opacity}
                          onChange={(e) => updateSettings({ opacity: Number(e.target.value) })}
                        />
                        <span className="cp-value">{Math.round(settings.opacity * 100)}%</span>
                      </div>
                    </div>

                    {/* 最大弹幕数 */}
                    <div className="cp-setting-row">
                      <label>最大弹幕数</label>
                      <div className="cp-slider-group">
                        <input
                          type="range"
                          className="cp-slider"
                          min="50"
                          max="500"
                          step="10"
                          value={settings.maxCount}
                          onChange={(e) => updateSettings({ maxCount: Number(e.target.value) })}
                        />
                        <span className="cp-value">{settings.maxCount}</span>
                      </div>
                    </div>

                    {/* 显示控制 */}
                    <div className="cp-section-title">显示控制</div>
                    <div className="cp-control-row">
                      <label className="cp-switch-label">
                        <span>弹幕开关</span>
                        <input
                          type="checkbox"
                          checked={settings.isEnabled}
                          onChange={(e) => updateSettings({ isEnabled: e.target.checked })}
                        />
                        <span className="cp-switch-track">
                          <span className="cp-switch-thumb" />
                        </span>
                      </label>
                      <button className="cp-clear-btn" onClick={clearAll}>
                        清屏
                      </button>
                    </div>
                    <div className="cp-control-row">
                      <label className="cp-switch-label">
                        <span>显示发送者</span>
                        <input
                          type="checkbox"
                          checked={settings.showSender}
                          onChange={(e) => updateSettings({ showSender: e.target.checked })}
                        />
                        <span className="cp-switch-track">
                          <span className="cp-switch-thumb" />
                        </span>
                      </label>
                    </div>

                    {/* 语音弹幕 */}
                    <div className="cp-section-title">语音弹幕</div>
                    <div className="cp-control-row">
                      <label className="cp-switch-label">
                        <span>语音朗读</span>
                        <input
                          type="checkbox"
                          checked={settings.voiceEnabled}
                          onChange={(e) => updateSettings({ voiceEnabled: e.target.checked })}
                        />
                        <span className="cp-switch-track">
                          <span className="cp-switch-thumb" />
                        </span>
                      </label>
                    </div>
                    {settings.voiceEnabled && (
                      <>
                        <div className="cp-setting-row">
                          <label>语速</label>
                          <div className="cp-slider-group">
                            <input
                              type="range"
                              className="cp-slider"
                              min="0.5"
                              max="2"
                              step="0.1"
                              value={settings.voiceRate}
                              onChange={(e) => updateSettings({ voiceRate: Number(e.target.value) })}
                            />
                            <span className="cp-value">{settings.voiceRate.toFixed(1)}x</span>
                          </div>
                        </div>
                        <div className="cp-setting-row">
                          <label>音量</label>
                          <div className="cp-slider-group">
                            <input
                              type="range"
                              className="cp-slider"
                              min="0"
                              max="1"
                              step="0.05"
                              value={settings.voiceVolume}
                              onChange={(e) => updateSettings({ voiceVolume: Number(e.target.value) })}
                            />
                            <span className="cp-value">{Math.round(settings.voiceVolume * 100)}%</span>
                          </div>
                        </div>
                        <div className="cp-setting-row">
                          <label>音色</label>
                          <select
                            className="cp-select"
                            value={settings.voiceURI}
                            onChange={(e) => updateSettings({ voiceURI: e.target.value })}
                          >
                            <option value="">系统默认</option>
                            {(zhVoices.length > 0 ? zhVoices : voices).map((v) => (
                              <option key={v.voiceURI} value={v.voiceURI}>
                                {v.name}（{v.lang}）
                              </option>
                            ))}
                          </select>
                          {voices.length > 0 && zhVoices.length === 0 && (
                            <div className="cp-server-hint">未检测到中文语音包，已显示全部系统语音</div>
                          )}
                        </div>
                        <div className="cp-setting-row">
                          <div className="cp-speed-group">
                            <button
                              className="cp-speed-btn"
                              onClick={() =>
                                ttsService.speak('这是语音弹幕的试听效果', {
                                  rate: settings.voiceRate,
                                  volume: settings.voiceVolume,
                                  voiceURI: settings.voiceURI,
                                  timestamp: Date.now(),
                                })
                              }
                            >
                              试听
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {/* 服务器 */}
                    <div className="cp-section-title">服务器</div>
                    <div className="cp-setting-row">
                      <label>地址</label>
                      <input
                        type="text"
                        className="cp-server-input"
                        value={serverUrl}
                        placeholder={getDefaultServerUrl() || 'ws://your-host:8080'}
                        onChange={(e) => setServerUrl(e.target.value)}
                      />
                    </div>
                    <div className="cp-server-hint">
                      {resolveServerUrl()
                        ? `当前生效：${resolveServerUrl()}（改动后重新进入房间生效）`
                        : '⚠️ 未配置服务器地址，无法联机'}
                    </div>

                  </div>
                )}
                {activeTab === 'room' && (
                  <div className="cp-room">
                    <RoomPanel />
                  </div>
                )}
                {activeTab === 'history' && (
                  <div className="cp-history">
                    <HistoryPanel />
                  </div>
                )}
                {activeTab === 'bot' && (
                  <div className="cp-bot">
                    <BotPanel />
                  </div>
                )}
                {activeTab === 'about' && (
                  <div className="cp-about">
                    <div className="cp-about-header">
                      <h3>云弹一下{updateState?.currentVersion ? ` v${updateState.currentVersion}` : ''}</h3>
                      <p className="cp-about-author">作者：tth</p>
                    </div>

                    <div className="cp-about-section-block">
                      <h4>🔄 软件更新</h4>
                      <div className="cp-update-area">
                        {updateState?.capability === 'none' ? (
                          <p className="cp-update-hint">开发模式不支持检查更新</p>
                        ) : (
                          <>
                            <button
                              className="cp-update-check-btn"
                              disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
                              onClick={() => {
                                setManualUpdateAction(true);
                                window.electronAPI?.updater?.check();
                              }}
                            >
                              {updateStatus?.state === 'checking' ? '检查中…' : '检查更新'}
                            </button>

                            {updateStatus?.state === 'not-available' && manualUpdateAction && (
                              <p className="cp-update-hint">当前已是最新版本</p>
                            )}
                            {updateStatus?.state === 'error' && manualUpdateAction && (
                              <p className="cp-update-hint cp-update-error">检查更新失败，请检查网络后重试</p>
                            )}

                            {updateStatus?.state === 'available' && (
                              <div className="cp-update-detail">
                                <p className="cp-update-title">发现新版本 v{updateStatus.info.version}</p>
                                {updateStatus.info.releaseNotes && (
                                  <p className="cp-update-notes">{updateStatus.info.releaseNotes}</p>
                                )}
                                {updateState?.capability === 'auto' ? (
                                  <button
                                    className="cp-update-action-btn"
                                    onClick={() => {
                                      setManualUpdateAction(true);
                                      window.electronAPI?.updater?.download();
                                    }}
                                  >
                                    下载更新
                                  </button>
                                ) : (
                                  <>
                                    <p className="cp-update-hint">
                                      {window.electronAPI?.platform === 'darwin'
                                        ? '请前往下载页获取新版本安装包'
                                        : '便携版无法自动更新，请前往下载页获取新版本'}
                                    </p>
                                    <button
                                      className="cp-update-action-btn"
                                      onClick={() => window.electronAPI?.updater?.openDownloadPage()}
                                    >
                                      前往下载页
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {updateStatus?.state === 'downloading' && (
                              <div className="cp-update-detail">
                                <div className="cp-update-progress">
                                  <div
                                    className="cp-update-progress-bar"
                                    style={{ width: `${updateStatus.percent}%` }}
                                  />
                                </div>
                                <p className="cp-update-hint">
                                  {updateStatus.percent.toFixed(0)}% · {(updateStatus.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
                                </p>
                              </div>
                            )}

                            {updateStatus?.state === 'downloaded' && (
                              <div className="cp-update-detail">
                                <p className="cp-update-title">新版本 v{updateStatus.info.version} 下载完成</p>
                                <button
                                  className="cp-update-action-btn"
                                  onClick={() => window.electronAPI?.updater?.install()}
                                >
                                  重启并安装
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="cp-about-section-block">
                      <h4>📖 使用说明</h4>
                      <ul>
                        <li><strong>发送弹幕</strong>：在输入框输入文字，点击发送或按 Enter</li>
                        <li><strong>房间功能</strong>：在「房间」标签中创建或加入房间，与其他用户实时互动</li>
                        <li><strong>弹幕设置</strong>：在「设置」标签中调整字号、速度、颜色、位置等</li>
                        <li><strong>弹幕模式</strong>：滚动弹幕从右向左飘过，停留弹幕居中显示后淡出</li>
                        <li><strong>房间密码</strong>：房主可为房间设置密码，其他用户需输入密码才能加入</li>
                        <li><strong>清屏</strong>：一键清除当前屏幕上的所有弹幕</li>
                      </ul>
                    </div>

                    <div className="cp-about-section-block">
                      <h4>📋 更新日志</h4>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.5.2</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>语音弹幕支持选择音色：「设置」新增音色下拉（本机中文语音优先）与试听按钮，选择会保存</li>
                          <li>吐槽姬角色名可自定义：在「吐槽姬」标签直接改名，弹幕中 @新名字 即可触发；存为新角色时填名直接用、留空仍由 AI 起名</li>
                        </ul>
                        <p><strong>🐛 修复</strong></p>
                        <ul>
                          <li>修复未连接房间时删除"我的房间"无效、刷新后又出现的问题（删除改为服务器确认制）</li>
                          <li>修复切换房间后原房间状态残留、新房间莫名显示断线的问题</li>
                          <li>删除当前房间后立即切换其它房间不再被误踢；操作失败现在会有明确提示</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.5.1</span>
                        <p><strong>🔧 优化</strong></p>
                        <ul>
                          <li>软件更新新增自建服务器下载源，国内下载更快；不可用时自动回退 GitHub，更新更稳定</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.5.0</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>吐槽姬 AI 机器人：房主可在「吐槽姬」标签启动，AI 根据房间弹幕、在线用户和时间自动发送吐槽弹幕</li>
                          <li>支持关键词触发回应，弹幕中 @角色名 必定触发；也可点「吐槽一下」手动触发</li>
                          <li>吐槽人设与语言风格可自定义，可保存多个角色（AI 自动起名）并点击标签切换</li>
                          <li>接口兼容 OpenAI 格式（DeepSeek / 通义 / Kimi 等），由房主自行填写 AccessKey，仅保存在本机</li>
                          <li>服务器地址可自定义：「设置」新增服务器区块，支持连接自部署服务器</li>
                        </ul>
                        <p><strong>🔧 调整</strong></p>
                        <ul>
                          <li>移除 P2P 连接模式，统一走服务器中继，连接更稳定</li>
                          <li>修复有密码房间断线重连失败的问题</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.4.0</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>软件自动更新：启动后自动检查新版本，「说明」标签显示红点提醒</li>
                          <li>Windows 安装版支持一键下载更新并重启安装</li>
                          <li>macOS 与便携版检测到新版本后可一键跳转下载页</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.3.0</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>语音弹幕：只有语音弹幕会被朗读，普通弹幕不朗读</li>
                          <li>语音弹幕朗读格式："用户xxx发来语音弹幕：xxx"</li>
                          <li>语音弹幕文字前显示 🔊🔊🔊 图标标识</li>
                          <li>可调节语音语速和音量</li>
                        </ul>
                        <p><strong>🐛 修复</strong></p>
                        <ul>
                          <li>修复语音弹幕重复朗读的问题</li>
                          <li>修复 IPC 监听器 cleanup 防止内存泄漏</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.2.0</span>
                        <p><strong>🐛 修复</strong></p>
                        <ul>
                          <li>修复 macOS 输入法候选框在加入房间后被遮挡的问题</li>
                          <li>修复 macOS 滚动到底部显示不全的问题</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.0.5</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>新增「说明」标签，包含使用说明和更新日志</li>
                          <li>房间密码功能：房主可设置/修改密码，房主免密进入</li>
                          <li>密码缓存在服务器，房主切换房间后仍可查看密码</li>
                          <li>服务器保留空房间记录（24小时），方便房主随时回来</li>
                          <li>客户端-服务器房间列表双向同步</li>
                        </ul>
                        <p><strong>🐛 修复</strong></p>
                        <ul>
                          <li>修复断开连接后自动重连干扰新连接的问题</li>
                          <li>修复删除房间不生效的问题</li>
                          <li>修复加入房间密码验证失败后无法重试的问题</li>
                          <li>修复停留弹幕无法淡出消失的问题</li>
                          <li>修复弹幕发送者自己看不到弹幕的问题</li>
                          <li>移除进入房间时刷历史弹幕的功能</li>
                        </ul>
                      </div>

                      <div className="cp-changelog-entry">
                        <span className="cp-changelog-version">v1.0.0</span>
                        <p><strong>✨ 新功能</strong></p>
                        <ul>
                          <li>弹幕位置：支持顶部/中部/底部</li>
                          <li>停留模式：居中停留弹幕，可设定时长</li>
                          <li>自定义房间名称</li>
                          <li>历史房间列表：快速重新创建/再次加入</li>
                          <li>用户退出即时更新用户列表</li>
                          <li>在线用户列表最多3行可滚动</li>
                          <li>输入法候选框不再被窗口遮挡</li>
                        </ul>
                        <p><strong>🐛 修复</strong></p>
                        <ul>
                          <li>修复旧版本升级后设置崩溃问题</li>
                          <li>修复滚动弹幕位置偏移</li>
                          <li>修复历史房间重复加入问题</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ControlPanel;
