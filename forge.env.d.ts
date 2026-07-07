export {};

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
  const MAIN_WINDOW_VITE_NAME: string;
  // 由 vite.main.config.ts 的 define 在构建期注入（自建更新服务器地址，空串表示未配置）
  const __DANMAKU_UPDATE_URL__: string;
}
