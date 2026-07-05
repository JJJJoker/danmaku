import React, { useEffect, useRef } from 'react';
import { DanmakuTrackItem } from '../services/danmakuEngine';
import { useSettingsStore } from '../stores/settingsStore';

interface DanmakuItemProps {
  item: DanmakuTrackItem;
}

const TRACK_HEIGHT = 40; // 每轨道高度 px

// 停留弹幕基准位置映射
const STAY_BASE_POSITION: Record<string, number> = {
  top: 15,
  middle: 45,
  bottom: 75,
};

const STAY_SLOT_HEIGHT = 45; // 每个停留槽位的高度 px

const DanmakuItem: React.FC<DanmakuItemProps> = ({ item }) => {
  // 立即记录组件渲染
  console.log('[DanmakuItem] Component rendering:', {
    id: item.id,
    text: item.text.substring(0, 20),
    mode: item.mode,
    position: item.position,
    trackId: item.trackId,
  });
  
  const { settings } = useSettingsStore();

  const isStay = item.mode === 'stay';

  // 滚动弹幕：根据 position 计算垂直位置
  const getScrollTop = (): string => {
    const tracksPerGroup = 4;
    let relativeTrackId: number;
    let positionPercent: string;
    switch (item.position) {
      case 'top':
        relativeTrackId = item.trackId;
        positionPercent = '0%';
        break;
      case 'middle':
        relativeTrackId = item.trackId - tracksPerGroup;
        positionPercent = '33%';
        break;
      case 'bottom':
        relativeTrackId = item.trackId - tracksPerGroup * 2;
        positionPercent = '66%';
        break;
      default:
        relativeTrackId = item.trackId;
        positionPercent = '0%';
    }
    return `calc(${positionPercent} + ${relativeTrackId * TRACK_HEIGHT + 10}px)`;
  };

  const style: React.CSSProperties = isStay
    ? {
        // 停留弹幕：基准位置 + 槽位偏移避免重叠
        top: `calc(${STAY_BASE_POSITION[item.position] || 45}% + ${item.trackId * STAY_SLOT_HEIGHT}px)`,
        color: item.color,
        fontSize: `${item.fontSize}px`,
        animationDuration: `${item.duration}ms`,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8)',
      }
    : {
        top: getScrollTop(),
        color: item.color,
        fontSize: `${item.fontSize}px`,
        animationDuration: `${item.duration}ms`,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8)',
      };

  // 调试日志：显示样式计算结果
  console.log(`[DanmakuItem] ${item.mode} danmaku "${item.text.substring(0, 20)}":`, {
    mode: item.mode,
    position: item.position,
    trackId: item.trackId,
    top: isStay ? `calc(${STAY_BASE_POSITION[item.position] || 45}% + ${item.trackId * STAY_SLOT_HEIGHT}px)` : getScrollTop(),
    left: isStay ? '50%' : undefined,
    transform: isStay ? 'translateX(-50%)' : undefined,
    animationDuration: `${item.duration}ms`,
    fontSize: `${item.fontSize}px`,
    color: item.color,
  });

  // 检查元素是否在可视区域内
  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (elementRef.current) {
      const rect = elementRef.current.getBoundingClientRect();
      const isVisible = (
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight
      );
      console.log(`[DanmakuItem] Visibility check for "${item.text.substring(0, 20)}":`, {
        visible: isVisible,
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        windowSize: {
          width: window.innerWidth,
          height: window.innerHeight,
        }
      });
    }
  }, [item.id, item.text]);

  return (
    <div
      ref={elementRef}
      className={`danmaku-item${isStay ? ' danmaku-stay' : ''}`}
      style={style}
    >
      {settings.showSender && item.sender && (
        <span style={{ fontSize: '0.75em', opacity: 0.6, marginRight: '4px' }}>
          [{item.sender}]
        </span>
      )}
      {/* 显示用户ID */}
      {item.userId && (
        <span className="danmaku-userid" style={{ 
          fontSize: '0.8em', 
          opacity: 0.7,
          marginLeft: '4px',
          marginRight: '8px'
        }}>
          [{item.userId}]
        </span>
      )}
      {item.text}
    </div>
  );
};

// 临时注释掉memo,用于调试
export default DanmakuItem;
// export default React.memo(DanmakuItem);