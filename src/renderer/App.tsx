import React, { useEffect } from 'react';
import DanmakuLayer from './components/DanmakuLayer';
import ControlPanel from './components/ControlPanel';
import { useConnectionStore } from './stores/connectionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useDanmakuStore } from './stores/danmakuStore';
import { speakVoiceDanmaku } from './services/ttsService';

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

  // 初始化 P2P 弹幕接收回调
  useEffect(() => {
    const { initCallbacks } = useConnectionStore.getState();
    initCallbacks((danmaku, roomId, isReplay) => {
      const { activeRoomId } = useConnectionStore.getState();
      const { settings } = useSettingsStore.getState();
      
      // 添加调试日志
      console.log(`[App] Received remote danmaku:`, {
        text: danmaku.text.substring(0, 20),
        sender: danmaku.sender,
        roomId: roomId,
        activeRoomId: activeRoomId,
        matches: roomId === activeRoomId
      });
      
      if (roomId === activeRoomId) {
        console.log('[App] ✅ RoomId matches, adding danmaku to display');
        
        // 添加到当前窗口的 store
        useDanmakuStore.getState().addDanmaku(
          danmaku,
          settings.fontSize,
          settings.speed,
          roomId,
          danmaku.position || settings.defaultPosition,
          danmaku.mode || settings.defaultMode,
          settings.stayDuration
        );
        
        // 语音弹幕：在 TTS 所在窗口（控制面板/兼容单窗口）于接收时直接朗读；
        // 房间历史回放（init）不朗读，speakVoiceDanmaku 内部按 ID 去重并按发送者限频
        const urlParams = new URLSearchParams(window.location.search);
        const windowType = urlParams.get('window');
        if (danmaku.isVoice && !isReplay && windowType !== 'danmaku') {
          speakVoiceDanmaku(danmaku, settings);
        }

        // 如果当前是控制面板窗口，转发到弹幕窗口
        if (windowType === 'control') {
          console.log('[App] Forwarding remote danmaku to danmaku window via IPC');
          try {
            window.electronAPI?.forwardDanmakuToWindow({
              message: danmaku,
              fontSize: settings.fontSize,
              speed: settings.speed,
              position: danmaku.position || settings.defaultPosition,
              mode: danmaku.mode || settings.defaultMode,
              stayDuration: settings.stayDuration
            });
            console.log('[App] ✅ Successfully forwarded remote danmaku');
          } catch (error) {
            console.error('[App]  Failed to forward remote danmaku:', error);
          }
        }
      } else {
        console.log('[App] ❌ RoomId mismatch, only adding to history');
        const { addHistory } = useDanmakuStore.getState();
        addHistory({
          id: danmaku.id,
          text: danmaku.text,
          sender: danmaku.sender || '匿名用户',
          color: danmaku.color,
          timestamp: danmaku.timestamp,
          roomId,
          isVoice: danmaku.isVoice,
        });
      }
    });
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