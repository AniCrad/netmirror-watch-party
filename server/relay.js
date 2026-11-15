import http from 'node:http';
import { WebSocketServer } from 'ws';
import { send } from './transport.js';
import { isExtensionOrigin } from './protocol.js';
import { createRoomStore } from './rooms.js';

export function createRelay({ graceMs = 45000, heartbeatMs = 15000, maxRooms = 1000, maxMembers = 16, maxConnections = 2000 } = {}) {
  const store = createRoomStore({ send, graceMs, maxRooms, maxMembers });
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', rooms: store.rooms.size }));
    }
    res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.url === '/' ? 'NetMirror Watch Party relay. Connect using the browser extension.\n' : 'Not found.\n');
  });
  // Keep a small HTTP allowance for health probes while WebSockets are at capacity.
  server.maxConnections = maxConnections + 32;
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  let closing;
  server.on('upgrade', (req, socket, head) => {
    const unavailable = closing || wss.clients.size >= maxConnections;
    if (unavailable || req.url !== '/' || !isExtensionOrigin(req.headers.origin)) {
      socket.end(`HTTP/1.1 ${unavailable ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    ws.alive = true;
    let windowStart = Date.now();
    let messageCount = 0;
    const deadline = setTimeout(() => ws.close(1008, 'Join timeout'), 10000);
    ws.on('error', () => {});
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => { clearTimeout(deadline); store.detach(ws); });
    ws.on('message', raw => {
      if (Date.now() - windowStart > 10000) { windowStart = Date.now(); messageCount = 0; }
      if (++messageCount > 100) return ws.close(1008, 'Too many messages');
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { return send(ws, { type: 'error', message: 'Invalid JSON.' }); }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
        return send(ws, { type: 'error', message: 'Invalid message.' });
      }
      if (message.type === 'ping') {
        if (!Number.isSafeInteger(message.sentAt) || message.sentAt < 0) {
          return send(ws, { type: 'error', message: 'Invalid ping timestamp.' });
        }
        return send(ws, { type: 'pong', sentAt: message.sentAt, serverTime: Date.now() });
      }
      store.handle(ws, message);
      if (ws.memberToken) clearTimeout(deadline);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
      // Application traffic also keeps a Chromium MV3 service worker alive.
      send(ws, { type: 'heartbeat', serverTime: Date.now() });
    }
  }, heartbeatMs);
  return {
    server, rooms: store.rooms,
    close() {
      closing ??= (async () => {
        clearInterval(heartbeat);
        store.clear();
        for (const ws of wss.clients) ws.terminate();
        await new Promise(resolve => wss.close(resolve));
        if (server.listening) await new Promise(resolve => server.close(resolve));
      })();
      return closing;
    },
  };
}
