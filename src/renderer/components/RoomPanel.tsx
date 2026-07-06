import React, { useState, useCallback, useEffect } from 'react';
import { useConnectionStore } from '../stores/connectionStore';
import { ServerConnection } from '../services/serverConnection';

interface RoomHistoryItem {
  roomId: string;
  roomName: string;
  role: 'host' | 'client';
  timestamp: number;
}

const HISTORY_KEY = 'funapp-room-history';
const MAX_HISTORY = 20;

function loadRoomHistory(): RoomHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRoomHistory(history: RoomHistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function addToHistory(item: Omit<RoomHistoryItem, 'timestamp'>): RoomHistoryItem[] {
  const history = loadRoomHistory();
  const filtered = history.filter(h => h.roomId !== item.roomId);
  const newHistory = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
  saveRoomHistory(newHistory);
  return newHistory;
}

function removeFromHistory(roomId: string): RoomHistoryItem[] {
  const history = loadRoomHistory();
  const newHistory = history.filter(h => h.roomId !== roomId);
  saveRoomHistory(newHistory);
  return newHistory;
}

function updateHistoryName(roomId: string, newName: string): RoomHistoryItem[] {
  const history = loadRoomHistory();
  const newHistory = history.map(h => h.roomId === roomId ? { ...h, roomName: newName } : h);
  saveRoomHistory(newHistory);
  return newHistory;
}

const RoomPanel: React.FC = () => {
  const [joinRoomId, setJoinRoomId] = useState('');
  const [createRoomName, setCreateRoomName] = useState('');
  const [copied, setCopied] = useState(false);
  const [createdRoomId, setCreatedRoomId] = useState('');
  const [roomHistory, setRoomHistory] = useState<RoomHistoryItem[]>(() => {
    const history = loadRoomHistory();
    console.log('[RoomPanel] Loaded room history:', history);
    return history;
  });
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  
  // 密码相关状态
  const [joinPassword, setJoinPassword] = useState('');                  // 加入时的密码
  const [showJoinPassword, setShowJoinPassword] = useState(false);       // 加入时是否显示密码输入
  const [managePassword, setManagePassword] = useState('');              // 管理面板的新密码
  const [inlineError, setInlineError] = useState('');                    // 内联错误消息

  const {
    rooms,
    activeRoomId,
    status,
    role,
    roomId,
    connectedUsers,
    error,
    username,
    logs,
    ownedRooms,  // 新增: 从store获取我的房间列表
    createRoom,
    joinRoom,
    disconnectRoom,
    switchRoom,
    clearError,
    testServerConnection,  // 测试服务器连接
    clearLogs,
    setUsername,
    setPassword,  // 新增
    deleteRoom,   // 新增
    syncOwnedRoomsFromServer,  // 启动时同步房间列表
  } = useConnectionStore();
  
  // 获取当前房间的isHost状态
  const currentRoom = activeRoomId ? rooms[activeRoomId] : null;
  const isHost = currentRoom?.isHost || false;
  
  // 添加调试日志查看ownedRooms的值
  useEffect(() => {
    console.log('[RoomPanel] ownedRooms from store:', ownedRooms);
  }, [ownedRooms]);
  
  // 启动时从服务器同步房间列表
  useEffect(() => {
    console.log('[RoomPanel] Mount: syncing rooms from server');
    syncOwnedRoomsFromServer().catch((e: any) => {
      console.warn('[RoomPanel] Initial sync failed:', e);
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  
  // 自动清除内联错误（5秒后）
  useEffect(() => {
    if (inlineError) {
      const timer = setTimeout(() => setInlineError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [inlineError]);

  // 处理删除房间
  const handleDeleteRoom = useCallback((roomId: string) => {
    if (confirm(`确定要删除房间 "${roomId}" 吗?此操作不可恢复!`)) {
      deleteRoom(roomId);
    }
  }, [deleteRoom]);

  const handleCreateRoom = useCallback(async () => {
    setInlineError('');
    try {
      const roomId = await createRoom(createRoomName || undefined);
      setCreatedRoomId(roomId);
      const updated = addToHistory({ roomId, roomName: createRoomName || roomId, role: 'host' });
      setRoomHistory(updated);
      setCreateRoomName('');
    } catch (err: any) {
      const msg = err?.message || '未知错误';
      console.log(`[RoomPanel] createRoom error: ${msg}`);
      setInlineError('创建失败: ' + msg);
    }
    // 重置弹幕窗口鼠标穿透（防止 alert/操作后卡住）
    window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
  }, [createRoom, createRoomName]);

  const handleJoinRoom = useCallback(async () => {
    const id = joinRoomId.trim();
    if (!id) return;
    // 已连接该房间且连接正常时直接切换
    if (rooms[id] && rooms[id].status === 'connected') {
      switchRoom(id);
      setJoinRoomId('');
      return;
    }
    try {
      // 如果有手动输入的密码则使用，否则尝试缓存密码
      const pwd = showJoinPassword ? joinPassword : ServerConnection.getRoomPassword(id);
      await joinRoom(id, pwd);
      const updated = addToHistory({ roomId: id, roomName: id, role: 'client' });
      setRoomHistory(updated);
      setJoinRoomId('');
      setJoinPassword('');
      setShowJoinPassword(false);
    } catch {
      // error handled by store
    }
  }, [joinRoomId, joinRoom, rooms, switchRoom, showJoinPassword, joinPassword]);

  const handleCopyRoomId = useCallback((idToCopy?: string) => {
    const textToCopy = idToCopy || activeRoomId;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [activeRoomId]);

  // 密码管理处理函数
  const handleChangePassword = useCallback(() => {
    if (activeRoomId && isHost) {
      setPassword(activeRoomId, managePassword);
      setManagePassword('');
    }
  }, [activeRoomId, isHost, setPassword, managePassword]);

  const handleClearPassword = useCallback(() => {
    if (activeRoomId && isHost) {
      setPassword(activeRoomId, '');
      setManagePassword('');
    }
  }, [activeRoomId, isHost, setPassword]);

  const handleJoinKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleJoinRoom();
      }
    },
    [handleJoinRoom]
  );

  const renderLogs = () => (
    <div className="rp-logs">
      <div className="rp-logs-header">
        <span>连接日志</span>
        <button onClick={clearLogs} className="rp-logs-clear">清除</button>
      </div>
      <div className="rp-logs-content">
        {logs.map((log, i) => (
          <div key={i} className="rp-log-line">{log}</div>
        ))}
      </div>
    </div>
  );

  // 渲染当前活跃房间的信息(普通函数,不是组件)
  const renderActiveRoom = () => {
    if (!activeRoomId || !rooms[activeRoomId]) return null;
    const activeRoom = rooms[activeRoomId];

    if (activeRoom.status === 'connecting') {
      return (
        <div className="rp-active-room">
          <div className="rp-loading">
            <div className="rp-spinner" />
            <span>连接中...</span>
          </div>
        </div>
      );
    }

    if (activeRoom.status === 'error') {
      return (
        <div className="rp-active-room">
          <div className="rp-error">
            <div className="rp-error-icon">⚠️</div>
            <p className="rp-error-text">{activeRoom.error || '连接失败'}</p>
            <div className="rp-error-actions">
              <button className="rp-btn rp-btn-primary" onClick={clearError}>
                重试
              </button>
              <button className="rp-btn rp-btn-secondary" onClick={() => disconnectRoom(activeRoomId)}>
                移除
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (activeRoom.status === 'connected') {
      return (
        <div className="rp-active-room">
          <div className="rp-connected">
            <div className="rp-status-badge-row">
              <div className={`rp-status-badge ${activeRoom.role === 'host' ? 'rp-status-host' : 'rp-status-client'}`}>
                {activeRoom.role === 'host' ? 'Host' : 'Client'}
              </div>
              <div className="rp-room-info">
                <code className="rp-room-code">{activeRoomId}</code>
                <button className="rp-copy-btn" onClick={() => handleCopyRoomId()}>
                  {copied ? '✓' : '📋'}
                </button>
              </div>
            </div>
            <div className="rp-users-section">
              <span className="rp-label">在线用户 ({activeRoom.connectedUsers.length})</span>
              <ul className="rp-user-list">
                {activeRoom.connectedUsers.length > 0 ? (
                  activeRoom.connectedUsers.map((user) => (
                    <li key={user.userId} className="rp-user-item">
                      <span className="rp-user-dot" />
                      {user.username || user.userId}
                    </li>
                  ))
                ) : (
                  <li className="rp-user-item rp-user-empty">
                    {activeRoom.role === 'host' ? '等待用户加入...' : '无其他用户'}
                  </li>
                )}
              </ul>
            </div>
            <button className="rp-btn rp-btn-secondary" style={{ marginTop: '8px' }} onClick={async () => {
              const result = await testServerConnection();
              setInlineError(result ? '服务器通信正常 ✓' : '服务器通信失败 ✗');
              // 重置弹幕窗口鼠标穿透
              window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
            }}>
              🔍 测试服务器连接
            </button>
            
            {/* 房主密码管理面板 */}
            {isHost && (
              <div className="rp-room-management">
                <h4 className="rp-management-title">房间密码</h4>
                {/* 当前密码状态 + 显示密码 */}
                <div className="rp-password-status">
                  <span className="rp-password-indicator">
                    {activeRoom?.hasPassword
                      ? <>🔒 已设置密码：<code className="rp-room-code">{ServerConnection.getRoomPassword(activeRoomId || '') || '***'}</code></>
                      : '🔓 无密码（公开房间）'
                    }
                  </span>
                </div>
                {/* 设置新密码 */}
                <div className="rp-password-row">
                  <input
                    type="text"
                    value={managePassword}
                    onChange={(e) => setManagePassword(e.target.value)}
                    placeholder="输入新密码"
                    className="rp-password-input"
                    
                    
                  />
                  <button 
                    className="rp-btn rp-btn-sm" 
                    onClick={handleChangePassword}
                    disabled={!managePassword}
                  >
                    设置密码
                  </button>
                </div>
                {/* 清除密码按钮（仅当有密码时显示）*/}
                {activeRoom?.hasPassword && (
                  <button 
                    className="rp-btn rp-btn-sm rp-btn-danger" 
                    onClick={handleClearPassword}
                    style={{ marginTop: '4px' }}
                  >
                    清除密码
                  </button>
                )}
                <small className="rp-management-tip">
                  房主可以免密进入，其他用户加入时需要输入密码
                </small>
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="rp-container">
      {/* 我的房间列表 */}
      {ownedRooms.length > 0 && (
        <div className="rp-owned-section">
          <div className="rp-owned-header">
            <span>我的房间 ({ownedRooms.length})</span>
          </div>
          <div className="rp-owned-list">
            {ownedRooms.map((room) => (
              <div key={room.roomId} className="rp-owned-item">
                <div className="rp-owned-info">
                  <span className="rp-owned-name">{room.roomName}</span>
                  {room.password && (
                    <span className="rp-owned-badge" title="已设置密码">🔒</span>
                  )}
                  <small className="rp-owned-time">
                    创建于 {new Date(room.createdAt).toLocaleDateString()}
                    {room.lastSynced && (
                      <span className="rp-sync-time">
                        · 同步于 {new Date(room.lastSynced).toLocaleTimeString()}
                      </span>
                    )}
                  </small>
                </div>
                <div className="rp-owned-actions">
                  <button
                    className="rp-btn rp-btn-sm"
                    onClick={() => {
                      // 房主进入自己的房间，不需要密码（服务器已处理豁免）
                      joinRoom(room.roomId);
                    }}
                  >
                    进入
                  </button>
                  <button
                    className="rp-btn rp-btn-sm rp-btn-danger"
                    onClick={() => handleDeleteRoom(room.roomId)}
                    title="删除房间"
                  >
                    ️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 保存的房间列表（过滤掉已在“我的房间”里的房间）*/}
      {(() => {
        const ownedRoomIds = new Set(ownedRooms.map(r => r.roomId));
        const filteredHistory = roomHistory.filter(item => !ownedRoomIds.has(item.roomId));
        if (filteredHistory.length === 0) return null;
        return (
        <div className="rp-history-section">
          <div className="rp-history-header">保存的房间</div>
          <div className="rp-history-list">
            {filteredHistory.map((item) => {
              const isOnline = !!rooms[item.roomId];
              const isEditing = editingRoomId === item.roomId;
              return (
                <div key={item.roomId} className="rp-history-item">
                  <div className="rp-history-info">
                    <span className={`rp-history-dot ${isOnline ? 'rp-dot-online' : 'rp-dot-offline'}`} title={isOnline ? '在线' : '离线'} />
                    <span className={`rp-history-role ${item.role === 'host' ? 'rp-history-host' : 'rp-history-client'}`}>
                      {item.role === 'host' ? 'H' : 'C'}
                    </span>
                    {isEditing ? (
                      <input
                        className="rp-history-edit-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) {
                            const updated = updateHistoryName(item.roomId, editingName.trim());
                            setRoomHistory(updated);
                          }
                          setEditingRoomId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) {
                              const updated = updateHistoryName(item.roomId, editingName.trim());
                              setRoomHistory(updated);
                            }
                            setEditingRoomId(null);
                          } else if (e.key === 'Escape') {
                            setEditingRoomId(null);
                          }
                        }}
                        
                        autoFocus
                        maxLength={30}
                      />
                    ) : (
                      <span
                        className="rp-history-name"
                        title={`${item.roomName}\n${item.roomId}`}
                        onDoubleClick={() => {
                          setEditingRoomId(item.roomId);
                          setEditingName(item.roomName);
                        }}
                      >
                        {item.roomName}
                      </span>
                    )}
                  </div>
                  <div className="rp-history-actions">
                    <button
                      className="rp-btn rp-btn-sm"
                      onClick={() => {
                        if (isOnline) {
                          switchRoom(item.roomId);
                          return;
                        }
                        if (item.role === 'host') {
                          createRoom(undefined, item.roomId).then((newId) => {
                            setCreatedRoomId(newId);
                            const updated = addToHistory({ roomId: newId, roomName: item.roomName, role: 'host' });
                            setRoomHistory(updated);
                          }).catch(() => {});
                        } else {
                          // 尝试使用缓存密码加入
                          const cachedPwd = ServerConnection.getRoomPassword(item.roomId);
                          joinRoom(item.roomId, cachedPwd).then(() => {
                            const updated = addToHistory({ roomId: item.roomId, roomName: item.roomName, role: 'client' });
                            setRoomHistory(updated);
                          }).catch(() => {});
                        }
                      }}
                    >
                      {isOnline ? '切换' : (item.role === 'host' ? '创建' : '加入')}
                    </button>
                    <button
                      className="rp-btn rp-btn-sm rp-btn-danger"
                      onClick={() => {
                        const updated = removeFromHistory(item.roomId);
                        setRoomHistory(updated);
                      }}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rp-history-tip">双击名称可编辑</div>
        </div>
        );
      })()}

      {/* 当前活跃房间信息 */}
      {renderActiveRoom()}

      {/* 创建/加入房间 - 始终可用 */}
      <div className="rp-disconnected">
            <div className="rp-username-row">
              <label className="rp-label">用户名</label>
              <input
                className="rp-join-input"
                type="text"
                placeholder="匿名用户"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                
                
                maxLength={20}
              />
            </div>
            
            {/* 创建房间区域 */}
            <div className="rp-join-row">
              <input
                className="rp-join-input"
                type="text"
                placeholder="输入房间名称"
                value={createRoomName}
                onChange={(e) => setCreateRoomName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateRoom(); } }}
                
                
                maxLength={30}
              />
              <button className="rp-btn rp-btn-primary" onClick={handleCreateRoom}>
                创建房间
              </button>
            </div>
            {createdRoomId && (
              <div className="rp-created-room-info">
                <span className="rp-label">房间ID：</span>
                <code className="rp-room-code">{createdRoomId}</code>
                <button className="rp-copy-btn" onClick={() => handleCopyRoomId(createdRoomId)}>
                  {copied ? '✓ 已复制' : '📋 复制'}
                </button>
              </div>
            )}
            <div className="rp-divider">
              <span>或加入已有房间</span>
            </div>
            {/* 加入房间区域 */}
            <div className="rp-join-row">
              <input
                className="rp-join-input"
                type="text"
                placeholder="输入完整房间ID"
                value={joinRoomId}
                onChange={(e) => {
                  setJoinRoomId(e.target.value);
                  // 输入房间ID时自动检测是否需要密码（如果本地缓存有密码则自动提示）
                  const cached = ServerConnection.getRoomPassword(e.target.value.trim());
                  if (cached) {
                    setJoinPassword(cached);
                    setShowJoinPassword(false); // 缓存密码不需要手动输入
                  }
                }}
                onKeyDown={handleJoinKeyDown}
                
                
                maxLength={50}
              />
              <button
                className="rp-btn rp-btn-primary"
                onClick={handleJoinRoom}
                disabled={!joinRoomId.trim()}
              >
                加入
              </button>
            </div>
            {/* 加入时的密码输入 */}
            <div className="rp-password-option">
              <label className="rp-label rp-checkbox-label">
                <input
                  type="checkbox"
                  checked={showJoinPassword}
                  onChange={(e) => setShowJoinPassword(e.target.checked)}
                  style={{ marginRight: '6px' }}
                />
                此房间有密码
              </label>
              {showJoinPassword && (
                <input
                  className="rp-join-input rp-password-inline"
                  type="text"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="输入房间密码"
                  
                  
                />
              )}
            </div>
          </div>

      {/* 内联错误/提示消息 */}
      {inlineError && (
        <div className="rp-inline-message" onClick={() => setInlineError('')}>
          {inlineError}
          <span className="rp-inline-close">×</span>
        </div>
      )}

      {renderLogs()}
    </div>
  );
};

export default RoomPanel;
