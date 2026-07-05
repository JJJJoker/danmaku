import React, { useRef, useEffect } from 'react';
import { useDanmakuStore, HistoryItem } from '../stores/danmakuStore';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

const HistoryPanel: React.FC = () => {
  const { history, clearHistory } = useDanmakuStore();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [history.length]);

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="history-empty">暂无弹幕记录</div>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-list" ref={listRef}>
        {history.map((item: HistoryItem) => (
          <div className="history-item" key={item.id}>
            <span className="history-time">{formatTime(item.timestamp)}</span>
            {item.roomId && <span className="history-room">[{item.roomId}]</span>}
            <span className="history-sender" style={{ color: item.color }}>
              {item.sender}
            </span>
            <span className="history-content">{item.text}</span>
          </div>
        ))}
      </div>
      <button className="history-clear-btn" onClick={clearHistory}>
        清除历史
      </button>
    </div>
  );
};

export default HistoryPanel;