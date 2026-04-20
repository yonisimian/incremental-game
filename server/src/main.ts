import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { HEARTBEAT_INTERVAL_MS } from '@game/shared';
import type { ClientMessage } from '@game/shared';
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

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/** Per-connection metadata. */
interface PlayerData {
  id: string;
  isAlive: boolean;
}

const wsData = new Map<WebSocket, PlayerData>();
const playerMatches = new Map<string, Match>();
const queuedPlayers = new Set<string>();

wss.on('connection', (ws: WebSocket) => {
  const playerId = randomUUID();
  const data: PlayerData = { id: playerId, isAlive: true };
  wsData.set(ws, data);

  console.log(`[connect] ${playerId}`);

  // Heartbeat pong
  ws.on('pong', () => {
    data.isAlive = true;
  });

  // Route messages
  ws.on('message', (raw) => {
    const m = playerMatches.get(data.id);
    if (m) {
      // Already in a match — forward to match handler
      m.handleMessage(data.id, String(raw));
      return;
    }

    // Not in a match — check for MODE_SELECT
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'QUIT') {
      removeFromQueue(data.id);
      queuedPlayers.delete(data.id);
      return;
    }

    if (msg.type === 'MODE_SELECT') {
      if (msg.mode !== 'clicker' && msg.mode !== 'idler') return;
      if (queuedPlayers.has(data.id)) return;

      queuedPlayers.add(data.id);
      const match = addToQueue({ id: data.id, ws }, msg.mode);
      if (match) {
        for (const pid of match.getPlayerIds()) {
          queuedPlayers.delete(pid);
          playerMatches.set(pid, match);
        }
        match.onEnd(() => {
          for (const pid of match.getPlayerIds()) {
            playerMatches.delete(pid);
          }
        });
        match.start();
      }
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
    queuedPlayers.delete(data.id);
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
