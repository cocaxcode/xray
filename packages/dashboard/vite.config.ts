import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, '../server/dist/dashboard'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3333',
      '/ws': {
        target: 'ws://localhost:3333',
        ws: true,
      },
    },
  },
});
