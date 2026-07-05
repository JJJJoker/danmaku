import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: 'src/main/preload.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
