// vitest 全局 setup：保持极简，模块专属的 mock 放各自测试文件里
import { afterEach, vi } from 'vitest';

afterEach(() => {
  // serverConfig / connectionStore / settingsStore 都读写 localStorage，用例间必须干净
  localStorage.clear();
  // 防某个用例开了假时钟忘还原，串场污染后续用例
  vi.useRealTimers();
});
