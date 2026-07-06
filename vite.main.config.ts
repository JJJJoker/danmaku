import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/main',
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      // 外部化 electron 和 Node.js 内置模块
      // electron-updater 依赖树含动态 require，不能被 vite 打包，
      // 运行时从 asar 内 node_modules 解析（electron-builder 自动拷贝生产依赖）
      external: ['electron', 'electron-updater', 'path', 'fs'],
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
