// FunDive 服务器：静态托管 client/dist + /ws 联机通道
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Rooms } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../client/dist');
const PORT = process.env.PORT || 8790;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  // SPA 兜底：无扩展名的路径一律回 index.html（如 /v1 /dive/xxx）
  let file = path.join(DIST, path.normalize(urlPath));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!path.extname(file)) file = path.join(DIST, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Rooms();
wss.on('connection', (ws) => rooms.attach(ws));

server.listen(PORT, () => {
  console.log(`[fundive] server on http://localhost:${PORT}  (ws: /ws)`);
});
