import React, { useEffect } from 'react';
import DanmakuLayer from './components/DanmakuLayer';
import ControlPanel from './components/ControlPanel';
import { useConnectionStore } from './stores/connectionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useDanmakuStore } from './stores/danmakuStore';
import { speakVoiceDanmaku } from './services/ttsService';
import { botService } from './services/botService';
import { createIncomingDanmakuHandler } from './services/incomingDanmaku';

const App: React.FC = () => {
  // 获取 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const windowType = urlParams.get('window');

  // 启动日志
  useEffect(() => {
    window.electronAPI?.log(`[App] Component mounted, window type: ${windowType}`);
    window.electronAPI?.log(`[App] Window size: ${window.innerWidth}x${window.innerHeight}`);
    window.electronAPI?.log(`[App] devicePixelRatio: ${window.devicePixelRatio}`);
    window.electronAPI?.log(`[App] document.body size: ${document.body.clientWidth}x${document.body.clientHeight}`);
    window.electronAPI?.log(`[App] UserAgent: ${navigator.userAgent}`);
    
    // 检查关键 CSS 是否加载
    const styles = document.styleSheets;
    window.electronAPI?.log(`[App] Loaded stylesheets count: ${styles.length}`);
    
    // 检查 DOM 中是否有内容渲染
    setTimeout(() => {
      const rootEl = document.getElementById('root');
      window.electronAPI?.log(`[App] #root children count: ${rootEl?.children.length}`);
      window.electronAPI?.log(`[App] #root innerHTML length: ${rootEl?.innerHTML.length}`);
      
      // 检查齿轮按钮是否存在
      const triggerBtn = document.querySelector('.cp-trigger-btn');
      const panel = document.querySelector('.cp-panel');
      window.electronAPI?.log(`[App] .cp-trigger-btn exists: ${!!triggerBtn}`);
      window.electronAPI?.log(`[App] .cp-panel exists: ${!!panel}`);
      
      if (triggerBtn) {
        const rect = triggerBtn.getBoundingClientRect();
        window.electronAPI?.log(`[App] Trigger btn rect: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`);
        const computed = window.getComputedStyle(triggerBtn);
        window.electronAPI?.log(`[App] Trigger btn visibility: ${computed.visibility}, opacity: ${computed.opacity}, display: ${computed.display}`);
      }
      
      // 检查 .app-container
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        const computed = window.getComputedStyle(appContainer);
        window.electronAPI?.log(`[App] .app-container: display=${computed.display}, visibility=${computed.visibility}, pointerEvents=${computed.pointerEvents}`);
      }
    }, 2000);
  }, []);

  // 初始化网络弹幕接收回调（处理逻辑在 services/incomingDanmaku.ts，这里只做依赖接线）
  useEffect(() => {
    const { initCallbacks } = useConnectionStore.getState();
    initCallbacks(createIncomingDanmakuHandler({
      windowType,
      getActiveRoomId: () => useConnectionStore.getState().activeRoomId,
      getSettings: () => useSettingsStore.getState().settings,
      addDanmaku: (message, fontSize, speed, roomId, position, mode, stayDuration) =>
        useDanmakuStore.getState().addDanmaku(message, fontSize, speed, roomId, position, mode, stayDuration),
      addHistory: (item) => useDanmakuStore.getState().addHistory(item),
      speakVoice: speakVoiceDanmaku,
      notifyBot: (message, roomId, isReplay) => botService.onIncomingDanmaku(message, roomId, isReplay),
      forwardToDanmakuWindow: window.electronAPI
        ? (payload) => window.electronAPI.forwardDanmakuToWindow(payload)
        : undefined,
    }));
  }, []);

  // 监听来自控制面板的弹幕消息
  // （effect 返回的 unsubscribe 负责清理，StrictMode 的 mount→cleanup→remount 也能正确重新注册）
  useEffect(() => {
    window.electronAPI?.log('[App] Setting up danmaku forward listener');
    console.log('[App] Setting up danmaku forward listener');
    
    if (!window.electronAPI) {
      window.electronAPI?.log('[App] ERROR: window.electronAPI is undefined!');
      console.error('[App] ERROR: window.electronAPI is undefined!');
      return;
    }
    
    if (!window.electronAPI.onReceiveDanmakuFromControl) {
      window.electronAPI?.log('[App] ERROR: onReceiveDanmakuFromControl is not available!');
      console.error('[App] ERROR: onReceiveDanmakuFromControl is not available!');
      return;
    }
    
    const unsubscribe = window.electronAPI.onReceiveDanmakuFromControl((data) => {
      window.electronAPI?.log(`[App] Received forwarded danmaku from control window: ${JSON.stringify(data.message.text)}`);
      console.log('[App] Received forwarded danmaku from control window:', data);
      useDanmakuStore.getState().addDanmaku(
        data.message,
        data.fontSize,
        data.speed,
        undefined,
        data.position,
        data.mode,
        data.stayDuration
      );
      window.electronAPI?.log('[App] ✅ Danmaku added to store successfully');
      console.log('[App] ✅ Danmaku added to store successfully');
    });
    
    window.electronAPI?.log('[App] ✅ Danmaku forward listener set up complete');
    console.log('[App] ✅ Danmaku forward listener set up complete');

    return () => {
      unsubscribe?.();
    };
  }, []);

  // 窗口关闭前优雅断开连接
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { disconnectAll } = useConnectionStore.getState();
      disconnectAll();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 如果是弹幕窗口，只渲染弹幕层
  if (windowType === 'danmaku') {
    console.log('[App] Rendering DanmakuLayer in danmaku window');
    return <DanmakuLayer />;
  }

  // 如果是控制面板窗口，只渲染控制面板
  if (windowType === 'control') {
    return <ControlPanel standalone={true} />;
  }

  // 默认行为（兼容旧版本）
  return (
    <div className="app-container">
      {/* 弹幕层 */}
      <DanmakuLayer />

      {/* 控制面板 - 自管理定位，无需外层容器 */}
      <ControlPanel />
    </div>
  );
};

export default App;