import React, { useEffect, useRef, useCallback } from 'react';
import { useDanmakuStore } from '../stores/danmakuStore';
import { useSettingsStore } from '../stores/settingsStore';
import { danmakuEngine } from '../services/danmakuEngine';
import { OverlayBounds } from '../../shared/types';
import DanmakuItem from './DanmakuItem';
import '../styles/danmaku.css';

type HandleDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'move';

const MIN_SIZE = 20; // 最小 20%

const DanmakuLayer: React.FC = () => {
  const danmakus = useDanmakuStore(state => state.danmakus);
  const isEnabled = useSettingsStore(state => state.settings.isEnabled);
  const opacity = useSettingsStore(state => state.settings.opacity);
  const showBorder = useSettingsStore(state => state.settings.showBorder);
  const overlayBounds = useSettingsStore(state => state.settings.overlayBounds) || { x: 0, y: 0, width: 100, height: 100 };
  const updateSettings = useSettingsStore(state => state.updateSettings);

  // 调试日志：监控弹幕列表
  useEffect(() => {
    console.log('[DanmakuLayer] Current danmakus count:', danmakus.length);
    console.log('[DanmakuLayer] isEnabled:', isEnabled);
    console.log('[DanmakuLayer] opacity:', opacity);
    console.log('[DanmakuLayer] overlayBounds:', overlayBounds);
    if (danmakus.length > 0) {
      console.log('[DanmakuLayer] Danmakus detail:', JSON.stringify(danmakus.map(d => ({
        id: d.id,
        text: d.text.substring(0, 20),
        mode: d.mode,
        position: d.position,
        trackId: d.trackId,
        duration: d.duration,
        fontSize: d.fontSize,
        color: d.color,
      }))));
    }
  }, [danmakus, isEnabled, opacity, overlayBounds]);

  const dragRef = useRef<{
    direction: HandleDirection;
    startX: number;
    startY: number;
    startBounds: OverlayBounds;
  } | null>(null);

  // 定期清理过期弹幕
  useEffect(() => {
    const timer = setInterval(() => {
      useDanmakuStore.getState().cleanupExpired();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // 语音弹幕：检测新弹幕并通过 IPC 转发给控制面板朗读
  // （弹幕窗口 focusable=false，speechSynthesis 不可用，需在控制面板窗口朗读）
  const spokenIdsRef = useRef<Set<string>>(new Set());
  const voiceEnabled = useSettingsStore(state => state.settings.voiceEnabled);
  const voiceRate = useSettingsStore(state => state.settings.voiceRate);
  const voiceVolume = useSettingsStore(state => state.settings.voiceVolume);

  // 用 ref 保存最新的语音设置，避免设置变化触发 effect 重新执行导致重复朗读
  const voiceRateRef = useRef(voiceRate);
  const voiceVolumeRef = useRef(voiceVolume);
  voiceRateRef.current = voiceRate;
  voiceVolumeRef.current = voiceVolume;

  useEffect(() => {
    if (!voiceEnabled || danmakus.length === 0) {
      // 诊断日志：记录为什么没有触发语音
      if (voiceEnabled && danmakus.length === 0) {
        window.electronAPI?.log(`[DanmakuLayer] voiceEnabled=true but no danmakus`);
      }
      return;
    }
    window.electronAPI?.log(`[DanmakuLayer] Voice check: voiceEnabled=${voiceEnabled}, danmakus=${danmakus.length}, spokenIds=${spokenIdsRef.current.size}`);

    for (const d of danmakus) {
      if (!spokenIdsRef.current.has(d.id)) {
        spokenIdsRef.current.add(d.id);
        // 只朗读语音弹幕（isVoice=true），普通弹幕不朗读
        if (d.isVoice) {
          const speakText = `用户${d.sender || '匿名'}发来语音弹幕：${d.text}`;
          console.log('[DanmakuLayer] 🗣️ Sending speak IPC for:', speakText.substring(0, 50));
          window.electronAPI?.log(`[DanmakuLayer] Sending speak IPC: ${speakText.substring(0, 50)}`);
          window.electronAPI?.speakDanmaku(speakText, { rate: voiceRateRef.current, volume: voiceVolumeRef.current, timestamp: d.startTime });
        }
      }
    }

    // 清理已移除弹幕的 ID（避免内存泄漏）
    const currentIds = new Set(danmakus.map(d => d.id));
    for (const id of spokenIdsRef.current) {
      if (!currentIds.has(id)) {
        spokenIdsRef.current.delete(id);
      }
    }
  }, [danmakus, voiceEnabled]); // 只依赖 danmakus 和 voiceEnabled，避免语速/音量变化触发重复朗读

  // 语音开关关闭时停止朗读
  useEffect(() => {
    if (!voiceEnabled) {
      window.electronAPI?.stopSpeakDanmaku();
      spokenIdsRef.current.clear();
    }
  }, [voiceEnabled]);

  // overlayBounds 变化时更新引擎的 screenWidth
  useEffect(() => {
    const effectiveWidth = window.innerWidth * overlayBounds.width / 100;
    danmakuEngine.updateConfig(undefined, effectiveWidth);
  }, [overlayBounds.width]);

  const clampBounds = useCallback((bounds: OverlayBounds): OverlayBounds => {
    let { x, y, width, height } = bounds;
    width = Math.max(MIN_SIZE, Math.min(100, width));
    height = Math.max(MIN_SIZE, Math.min(100, height));
    x = Math.max(0, Math.min(100 - width, x));
    y = Math.max(0, Math.min(100 - height, y));
    return { x, y, width, height };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, direction: HandleDirection) => {
    e.preventDefault();
    e.stopPropagation();
    window.electronAPI?.setIgnoreMouseEvents(false);
    dragRef.current = {
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startBounds: { ...overlayBounds },
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const { direction, startX, startY, startBounds } = dragRef.current;
      const dx = ((ev.clientX - startX) / window.innerWidth) * 100;
      const dy = ((ev.clientY - startY) / window.innerHeight) * 100;

      let newBounds = { ...startBounds };

      if (direction === 'move') {
        newBounds.x = startBounds.x + dx;
        newBounds.y = startBounds.y + dy;
      } else {
        if (direction.includes('n')) {
          newBounds.y = startBounds.y + dy;
          newBounds.height = startBounds.height - dy;
        }
        if (direction.includes('s')) {
          newBounds.height = startBounds.height + dy;
        }
        if (direction.includes('w')) {
          newBounds.x = startBounds.x + dx;
          newBounds.width = startBounds.width - dx;
        }
        if (direction.includes('e')) {
          newBounds.width = startBounds.width + dx;
        }
      }

      newBounds = clampBounds(newBounds);
      updateSettings({ overlayBounds: newBounds });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [overlayBounds, updateSettings, clampBounds]);

  if (!isEnabled) {
    console.log('[DanmakuLayer] Danmaku is disabled, returning null');
    return null;
  }

  const layerStyle: React.CSSProperties = {
    left: `${overlayBounds.x}%`,
    top: `${overlayBounds.y}%`,
    width: `${overlayBounds.width}%`,
    height: `${overlayBounds.height}%`,
    opacity,
  };
  
  console.log('[DanmakuLayer] Layer style:', layerStyle);

  return (
    <div
      className={`danmaku-layer${showBorder ? ' show-border' : ''}`}
      style={layerStyle}
    >
      {showBorder && (
        <>
          {/* Move area */}
          <div
            className="overlay-move-area"
            onMouseDown={(e) => handleMouseDown(e, 'move')}
          />
          {/* Edge handles */}
          <div className="overlay-resize-handle overlay-handle-n" onMouseDown={(e) => handleMouseDown(e, 'n')} />
          <div className="overlay-resize-handle overlay-handle-s" onMouseDown={(e) => handleMouseDown(e, 's')} />
          <div className="overlay-resize-handle overlay-handle-e" onMouseDown={(e) => handleMouseDown(e, 'e')} />
          <div className="overlay-resize-handle overlay-handle-w" onMouseDown={(e) => handleMouseDown(e, 'w')} />
          {/* Corner handles */}
          <div className="overlay-resize-handle overlay-handle-nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
          <div className="overlay-resize-handle overlay-handle-ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
          <div className="overlay-resize-handle overlay-handle-sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
          <div className="overlay-resize-handle overlay-handle-se" onMouseDown={(e) => handleMouseDown(e, 'se')} />
        </>
      )}
      {danmakus.length > 0 && (
        <div style={{ display: 'none' }}>
          {(() => {
            const modeCount = danmakus.reduce((acc, d) => {
              acc[d.mode] = (acc[d.mode] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);
            console.log('[DanmakuLayer] Rendering danmakus:', {
              total: danmakus.length,
              modeDistribution: modeCount,
              items: danmakus.map(d => ({
                id: d.id,
                text: d.text.substring(0, 20),
                mode: d.mode,
                position: d.position,
                trackId: d.trackId,
                duration: d.duration,
                fontSize: d.fontSize,
                color: d.color,
              }))
            });
            return null;
          })()}
        </div>
      )}
      {danmakus.map(danmaku => {
        console.log('[DanmakuLayer] Rendering item:', danmaku.id, danmaku.text.substring(0, 30));
        return <DanmakuItem key={danmaku.id} item={danmaku} />;
      })}
    </div>
  );
};

export default DanmakuLayer;