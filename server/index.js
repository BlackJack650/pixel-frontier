import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms/roomManager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readMap = file => JSON.parse(fs.readFileSync(path.join(root, 'shared/map', file), 'utf8'));
const manager = new RoomManager({
  maps: { standard: readMap('map.json'), large: readMap('map-large.json') },
  profilePath: path.join(root, 'data/profile.json')
});
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get('/api/rooms', (_req, res) => res.json({ rooms: manager.listRooms() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size, uptime: Math.floor(process.uptime()) }));
app.get('/api/profile', (_req, res) => res.json(manager.profile));
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: '1h', immutable: false }));
app.use('/config', express.static(path.join(root, 'config'), { maxAge: '1h' }));
app.use(express.static(path.join(root, 'client'), { maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'client/index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return ws.send(JSON.stringify({ t: 'ERR', code: 'BAD_JSON', message: 'Malformed message.' })); }
    if (message?.t === 'HELLO') manager.hello(ws, message);
    else manager.message(ws, message);
  });
  ws.on('close', () => manager.disconnect(ws));
  ws.on('error', () => manager.disconnect(ws));
});

// Fixed 20 Hz simulation with elapsed-time compensation and a bounded catch-up budget.
const STEP = 1000 / 20;
let previous = performance.now(), accumulator = 0;
const loop = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(250, now - previous); previous = now;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) { manager.tick(); accumulator -= STEP; steps++; }
}, 25);
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`PIXEL FRONTIER → http://0.0.0.0:${port}`));
function shutdown() {
  clearInterval(loop); clearInterval(heartbeat); manager.shutdown();
  for (const ws of wss.clients) ws.close(1012, 'Server shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
