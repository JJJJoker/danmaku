import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 独立于三个构建用 vite config（renderer/main/preload），仅供 vitest 使用。
// 测试只覆盖 renderer 纯逻辑（services/stores），不做组件渲染测试。
export default defineConfig({
  resolve: {
    // 与 tsconfig.json 的 paths 保持一致
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'], // 天然排除 danmaku-server/（独立 npm 项目，各测各的）
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true, // 每用例后还原 spyOn（danmakuEngine/ttsService 等单例上的 spy 不串测）
    unstubEnvs: true, // vi.stubEnv 自动还原（serverConfig 测试 stub VITE_DANMAKU_SERVER_URL）
    unstubGlobals: true, // vi.stubGlobal 自动还原（TTS 测试 stub SpeechSynthesisUtterance）
  },
});
