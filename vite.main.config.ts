import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/main',
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // 外部化 electron 和 Node.js 内置模块
      external: ['electron', 'path', 'fs'],
      output: {
        // 确保这些模块作为 CommonJS require 引入
        globals: {
          electron: 'electron',
          path: 'path',
          fs: 'fs',
        },
      },
    },
  },
});
