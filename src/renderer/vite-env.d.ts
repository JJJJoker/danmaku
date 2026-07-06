/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 构建期注入的默认弹幕服务器地址（如 ws://your-host:8080），CI 由仓库变量 DANMAKU_SERVER_URL 提供
  readonly VITE_DANMAKU_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
