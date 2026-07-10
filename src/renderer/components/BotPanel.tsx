import React, { useState, useEffect, useCallback } from 'react';
import { useBotStore, getActivePersona, validateRoleName, MIN_INTERVAL_FLOOR_SEC } from '../stores/botStore';
import { useConnectionStore } from '../stores/connectionStore';
import { botService } from '../services/botService';

// 吐槽姬面板：启动/停止 + 手动触发 + API 配置 + 人设管理 + 触发设置 + 弹幕外观。
// 仅房主可启动（客户端判定 isHost），未连接/非房主时按钮禁用并提示原因。

const COLOR_PRESETS = ['#ffb6c1', '#ffffff', '#ffd700', '#7edd9a', '#8baeff', '#ff6b6b', '#c58bff'];

const BotPanel: React.FC = () => {
  const {
    config, personas, running, generating, lastError,
    updateConfig, addPersona, updatePersona, removePersona, setActivePersona, setRuntime,
  } = useBotStore();
  const { status, activeRoomId, rooms } = useConnectionStore();

  const currentRoom = activeRoomId ? rooms[activeRoomId] : null;
  const isHost = currentRoom?.isHost || false;
  const activePersona = getActivePersona({ config, personas });

  // 人设编辑区本地草稿（切换角色时重置）
  const [personaDraft, setPersonaDraft] = useState(activePersona.persona);
  const [styleDraft, setStyleDraft] = useState(activePersona.style);
  const [roleNameDraft, setRoleNameDraft] = useState(activePersona.roleName);
  const [showKey, setShowKey] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setPersonaDraft(activePersona.persona);
    setStyleDraft(activePersona.style);
    setRoleNameDraft(activePersona.roleName);
  }, [config.activePersonaId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 断线/切房时兜底停止（botService.trigger 内也有实时校验，这里让 UI 状态即时复位）
  useEffect(() => {
    if (running && (status !== 'connected' || !isHost)) {
      botService.stop('连接断开或已非房主，吐槽姬已自动停止');
    }
  }, [status, activeRoomId, isHost, running]);

  // 提示信息 5 秒自动清除
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  const canStart = status === 'connected' && isHost && !!config.apiKey.trim();
  const startDisabledReason = !config.apiKey.trim()
    ? '请先填写 AccessKey'
    : status !== 'connected'
      ? '请先连接进入房间'
      : !isHost
        ? '只有房主可以启动吐槽姬'
        : '';

  const handleStart = useCallback(() => {
    botService.start();
  }, []);

  const handleStop = useCallback(() => {
    botService.stop();
  }, []);

  const handleManualTrigger = useCallback(() => {
    void botService.trigger('manual');
  }, []);

  // 保存修改：写回当前角色（含角色名）
  const handleSaveCurrent = useCallback(() => {
    const err = validateRoleName(personas, roleNameDraft, config.activePersonaId);
    if (err) {
      setNotice(err);
      return;
    }
    const newRoleName = roleNameDraft.trim();
    updatePersona(config.activePersonaId, {
      roleName: newRoleName,
      persona: personaDraft.trim(),
      style: styleDraft.trim(),
    });
    setNotice(`已保存到「${newRoleName}」`);
  }, [personas, roleNameDraft, config.activePersonaId, personaDraft, styleDraft, updatePersona]);

  // 存为新角色：填了名字直接用（跳过 LLM 起名），留空才自动起名 → 添加 → 切换
  const handleSaveAsNew = useCallback(async () => {
    const personaText = personaDraft.trim();
    if (!personaText) {
      setNotice('请先填写人设描述');
      return;
    }
    const customName = roleNameDraft.trim();
    if (customName) {
      const err = validateRoleName(personas, customName);
      if (err) {
        setNotice(err);
        return;
      }
    }
    setSavingPersona(true);
    try {
      const roleName = customName || await botService.generateRoleName(personaText);
      const id = `per_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      addPersona({ id, roleName, persona: personaText, style: styleDraft.trim() });
      setActivePersona(id);
      setNotice(`已保存新角色「${roleName}」`);
    } finally {
      setSavingPersona(false);
    }
  }, [personaDraft, styleDraft, roleNameDraft, personas, addPersona, setActivePersona]);

  const handleRemovePersona = useCallback((id: string, roleName: string) => {
    if (confirm(`确定删除角色「${roleName}」吗？`)) {
      removePersona(id);
    }
  }, [removePersona]);

  return (
    <div className="cp-bot-panel">
      {/* ===== 状态与控制 ===== */}
      <div className="cp-section-title">运行状态</div>
      <div className="cp-bot-status-row">
        <span className={`cp-bot-status-pill ${running ? 'cp-bot-running' : 'cp-bot-stopped'}`}>
          <span className={`cp-bot-dot ${running ? 'cp-bot-dot-on' : 'cp-bot-dot-off'}`} />
          {running ? '运行中' : '已停止'}
        </span>
        {!running ? (
          <button
            className="rp-btn rp-btn-primary"
            disabled={!canStart}
            onClick={handleStart}
            title={startDisabledReason}
          >
            ▶ 启动
          </button>
        ) : (
          <button className="rp-btn rp-btn-danger" onClick={handleStop}>
            ■ 停止
          </button>
        )}
        <button
          className="rp-btn rp-btn-secondary"
          disabled={!running || generating}
          onClick={handleManualTrigger}
        >
          {generating ? <span className="rp-spinner cp-bot-btn-spinner" /> : '🔥'} 吐槽一下
        </button>
      </div>
      {!running && startDisabledReason && (
        <div className="cp-bot-hint">{startDisabledReason}</div>
      )}
      {lastError && (
        <div className="cp-bot-error" onClick={() => setRuntime({ lastError: null })} title="点击关闭">
          ⚠ {lastError}
        </div>
      )}
      {notice && <div className="cp-bot-notice">{notice}</div>}

      {/* ===== API 配置 ===== */}
      <div className="cp-section-title">API 配置</div>
      <div className="cp-bot-field">
        <label>接口地址</label>
        <input
          type="text"
          className="rp-join-input"
          value={config.baseURL}
          placeholder="https://api.deepseek.com/v1"
          onChange={e => updateConfig({ baseURL: e.target.value })}
        />
      </div>
      <div className="cp-bot-field">
        <label>模型</label>
        <input
          type="text"
          className="rp-join-input"
          value={config.model}
          placeholder="deepseek-chat"
          onChange={e => updateConfig({ model: e.target.value })}
        />
      </div>
      <div className="cp-bot-field">
        <label>AccessKey</label>
        <div className="cp-bot-key-row">
          <input
            type={showKey ? 'text' : 'password'}
            className="rp-join-input"
            value={config.apiKey}
            placeholder="sk-..."
            onChange={e => updateConfig({ apiKey: e.target.value })}
          />
          <button className="rp-btn rp-btn-secondary rp-btn-sm" onClick={() => setShowKey(v => !v)}>
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>
      <div className="cp-bot-hint">兼容 OpenAI 格式接口（DeepSeek / 通义 / Kimi 等），Key 仅保存在本机</div>

      {/* ===== 角色人设 ===== */}
      <div className="cp-section-title">吐槽人设</div>
      <div className="cp-bot-persona-tags">
        {personas.map(p => (
          <span
            key={p.id}
            className={`cp-bot-persona-tag ${p.id === config.activePersonaId ? 'active' : ''}`}
            onClick={() => setActivePersona(p.id)}
          >
            {p.roleName}
            {p.id !== 'default' && (
              <button
                className="cp-bot-tag-del"
                onClick={e => { e.stopPropagation(); handleRemovePersona(p.id, p.roleName); }}
                title="删除该角色"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="cp-bot-field">
        <label>角色名（@提及触发词，{roleNameDraft.trim().length}/10）</label>
        <input
          type="text"
          className="rp-join-input"
          value={roleNameDraft}
          maxLength={10}
          placeholder="如：吐槽姬"
          onChange={e => setRoleNameDraft(e.target.value)}
        />
      </div>
      <div className="cp-bot-field">
        <label>人设描述（当前：{activePersona.roleName}）</label>
        <textarea
          className="cp-bot-textarea"
          rows={3}
          value={personaDraft}
          placeholder="描述这个角色的性格、身份、说话方式……"
          onChange={e => setPersonaDraft(e.target.value)}
        />
      </div>
      <div className="cp-bot-field">
        <label>语言风格</label>
        <input
          type="text"
          className="rp-join-input"
          value={styleDraft}
          placeholder="如：短句吐槽，犀利幽默带梗"
          onChange={e => setStyleDraft(e.target.value)}
        />
      </div>
      <div className="cp-bot-btn-row">
        <button className="rp-btn rp-btn-secondary" onClick={handleSaveCurrent}>保存修改</button>
        <button className="rp-btn rp-btn-primary" disabled={savingPersona} onClick={handleSaveAsNew}>
          {savingPersona ? <span className="rp-spinner cp-bot-btn-spinner" /> : null}
          存为新角色
        </button>
      </div>

      {/* ===== 触发设置 ===== */}
      <div className="cp-section-title">触发设置</div>
      <div className="cp-bot-field">
        <label>触发关键词（逗号分隔）</label>
        <input
          type="text"
          className="rp-join-input"
          value={config.keywords.join('，')}
          placeholder="如：无聊，好笑，666"
          onChange={e =>
            updateConfig({
              keywords: e.target.value.split(/[,，、;；]/).map(k => k.trim()).filter(Boolean),
            })
          }
        />
      </div>
      <div className="cp-bot-field-row">
        <div className="cp-bot-field">
          <label>随机间隔·最小（秒）</label>
          <input
            type="number"
            className="rp-join-input"
            min={MIN_INTERVAL_FLOOR_SEC}
            value={config.minIntervalSec}
            onChange={e => updateConfig({ minIntervalSec: Number(e.target.value) || MIN_INTERVAL_FLOOR_SEC })}
          />
        </div>
        <div className="cp-bot-field">
          <label>最大（秒）</label>
          <input
            type="number"
            className="rp-join-input"
            min={MIN_INTERVAL_FLOOR_SEC}
            value={config.maxIntervalSec}
            onChange={e => updateConfig({ maxIntervalSec: Number(e.target.value) || config.minIntervalSec })}
          />
        </div>
        <div className="cp-bot-field">
          <label>回应冷却（秒）</label>
          <input
            type="number"
            className="rp-join-input"
            min={0}
            value={config.replyCooldownSec}
            onChange={e => updateConfig({ replyCooldownSec: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </div>
      <div className="cp-bot-hint">弹幕中 @{activePersona.roleName} 必定触发吐槽</div>

      {/* ===== 弹幕外观 ===== */}
      <div className="cp-section-title">弹幕外观</div>
      <div className="cp-bot-field">
        <label>颜色</label>
        <div className="cp-bot-colors">
          {COLOR_PRESETS.map(c => (
            <span
              key={c}
              className={`cp-bot-color ${config.danmakuColor === c ? 'active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => updateConfig({ danmakuColor: c })}
            />
          ))}
        </div>
      </div>
      <div className="cp-bot-field">
        <label>字号：{config.danmakuFontSize}px</label>
        <input
          type="range"
          min={16}
          max={40}
          value={config.danmakuFontSize}
          onChange={e => updateConfig({ danmakuFontSize: Number(e.target.value) })}
        />
      </div>
      <div className="cp-bot-field-row">
        <div className="cp-bot-field">
          <label>位置</label>
          <div className="cp-bot-seg">
            {(['top', 'middle', 'bottom'] as const).map(pos => (
              <button
                key={pos}
                className={`cp-speed-btn ${config.danmakuPosition === pos ? 'active' : ''}`}
                onClick={() => updateConfig({ danmakuPosition: pos })}
              >
                {pos === 'top' ? '顶部' : pos === 'middle' ? '中间' : '底部'}
              </button>
            ))}
          </div>
        </div>
        <div className="cp-bot-field">
          <label>模式</label>
          <div className="cp-bot-seg">
            {(['scroll', 'stay'] as const).map(m => (
              <button
                key={m}
                className={`cp-speed-btn ${config.danmakuMode === m ? 'active' : ''}`}
                onClick={() => updateConfig({ danmakuMode: m })}
              >
                {m === 'scroll' ? '滚动' : '停留'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BotPanel;
