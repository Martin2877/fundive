// 开发模式：同时拉起 vite (5173) 与游戏服务器 (8790)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const procs = [
  spawn('npm', ['run', 'dev', '-w', 'client'], { cwd: root, stdio: 'inherit', shell: true }),
  spawn('node', ['server/src/index.js'], { cwd: root, stdio: 'inherit' }),
];
const kill = () => procs.forEach(p => p.kill('SIGINT'));
process.on('SIGINT', () => { kill(); process.exit(0); });
process.on('SIGTERM', kill);
