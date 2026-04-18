import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket = require('ws');
import { HEARTBEAT_INTERVAL_MS } from '@game/shared';
import { addToQueue, removeFromQueue } from './matchmaking.js';
import type { Match } from './match.js';

const PORT = Number(process.env.PORT) || 10000;

// ─── HTTP Server (health check) ─────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('ok');
});

// ─── WebSocket Server ────────────────────────────────────────────────

const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

/** Per-connection metadata. */
interface PlayerData {
  id: string;
  isAlive: boolean;
}

const wsData = new Map<WebSocket, PlayerData>();
const playerMatches = new Map<string, Match>();

wss.on('connection', (ws: WebSocket) => {
  const playerId = randomUUID();
  const data: PlayerData = { id: playerId, isAlive: true };
  wsData.set(ws, data);

  console.log(`[connect] ${playerId}`);

  // Try matchmaking
  const match = addToQueue({ id: playerId, ws });
  if (match) {
    for (const pid of match.getPlayerIds()) {
      playerMatches.set(pid, match);
    }
    match.onEnd(() => {
      for (const pid of match.getPlayerIds()) {
        playerMatches.delete(pid);
      }
    });
    match.start();
  }

  // Heartbeat pong
  ws.on('pong', () => {
    data.isAlive = true;
  });

  // Route messages to match
  ws.on('message', (raw) => {
    const m = playerMatches.get(data.id);
    if (m) {
      m.handleMessage(data.id, String(raw));
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log(`[disconnect] ${data.id}`);
    const m = playerMatches.get(data.id);
    if (m) {
      m.handleDisconnect(data.id);
    } else {
      removeFromQueue(data.id);
    }
    wsData.delete(ws);
  });
});

// ─── Heartbeat ───────────────────────────────────────────────────────

const heartbeat = setInterval(() => {
  for (const [ws, data] of [...wsData]) {
    if (!data.isAlive) {
      ws.terminate();
      continue;
    }
    data.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// ─── Start ───────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`incremenTal server listening on port ${PORT}`);
});
