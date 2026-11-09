import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 版本注入：根 package.json 是唯一真源；channel 由 VITE_CHANNEL 决定（stable|preview|dev）
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return ''; } })();
const channel = process.env.VITE_CHANNEL === 'preview' ? 'preview'
  : process.env.VITE_CHANNEL === 'stable' ? 'stable'
  : (process.env.GITHUB_REF_TYPE === 'tag' ? 'stable' : 'dev');

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_CHANNEL': JSON.stringify(channel),
    'import.meta.env.VITE_COMMIT': JSON.stringify(sha),
    'import.meta.env.VITE_STABLE_URL': JSON.stringify(process.env.VITE_STABLE_URL || ''),
    'import.meta.env.VITE_PREVIEW_URL': JSON.stringify(process.env.VITE_PREVIEW_URL || ''),
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8790', ws: true },
    },
  },
  optimizeDeps: { exclude: ['three'] },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
