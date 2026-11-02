import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8790', ws: true },
    },
  },
  optimizeDeps: { exclude: ['three'] },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
