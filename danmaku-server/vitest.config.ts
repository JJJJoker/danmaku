import { defineConfig } from 'vitest/config';

// 测试目录 tests/ 与 src/ 平级，不在 tsconfig include 内，不会混进 npm run build 的产物
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 集成测试起真实 WebSocket 服务器（port 0 临时端口），给足超时余量
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
