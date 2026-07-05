import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// 渲染进程启动日志
const logApi = (window as any).electronAPI;
logApi?.log('[main.tsx] Script executing...');
logApi?.log(`[main.tsx] document.readyState: ${document.readyState}`);
logApi?.log(`[main.tsx] #root element exists: ${!!document.getElementById('root')}`);

// 全局错误捕获
window.onerror = (msg, source, line, col, error) => {
  logApi?.log(`[ERROR] ${msg} at ${source}:${line}:${col} ${error?.stack || ''}`);
};
window.addEventListener('unhandledrejection', (e) => {
  logApi?.log(`[UNHANDLED REJECTION] ${e.reason}`);
});

try {
  logApi?.log('[main.tsx] Creating React root...');
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    logApi?.log('[main.tsx] FATAL: #root element not found!');
  } else {
    logApi?.log(`[main.tsx] #root innerHTML length: ${rootEl.innerHTML.length}`);
    const root = createRoot(rootEl);
    logApi?.log('[main.tsx] Calling root.render...');
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    logApi?.log('[main.tsx] root.render() called successfully');
  }
} catch (err: any) {
  logApi?.log(`[main.tsx] FATAL ERROR during render: ${err.message}\n${err.stack}`);
}