import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function removeCrossOrigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), removeCrossOrigin()],
  base: './', // 保持相对路径，但需要配合 electron-builder 的文件包含配置
  build: {
    modulePreload: false,
    outDir: '.vite/renderer', // 明确指定输出目录
  },
});
