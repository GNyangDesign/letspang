/**
 * Let's Pang - Realtime WebSocket Game Server
 * Standalone Node.js server for Vultr VPS deployment
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3001;

// In-memory Room & Player State
// rooms: Map<string, Room>
// Room = { code: string, hostId: string, status: 'LOBBY' | 'PLAYING', players: Map<string, Player> }
// Player = { id: string, nickname: string, isHost: boolean, ws: WebSocket }
const rooms = new Map();
const socketToPlayer = new Map();

/**
 * Generate a unique 4-5 digit room code
 */
function generateRoomCode() {
  let attempts = 0;
  while (attempts < 1000) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
    attempts++;
  }
  // Fallback to 5 digits if 4 digits are congested
  while (true) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    if (!rooms.has(code)) return code;
  }
}

/**
 * Serialize room player list for network transfer (strip ws instance)
 */
function serializePlayers(room) {
  const list = [];
  for (const player of room.players.values()) {
    list.push({
      id: player.id,
      nickname: player.nickname,
      isHost: player.id === room.hostId
    });
  }
  return list;
}

/**
 * Broadcast message to all players in a room
 */
function broadcastToRoom(room, message, excludePlayerId = null) {
  const data = JSON.stringify(message);
  for (const player of room.players.values()) {
    if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

/**
 * Safe send to single socket
 */
function sendToSocket(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Create HTTP server for health checks & WebSocket upgrades
const server = http.createServer((req, res) => {
  // Simple CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'letspang-game-server',
      rooms: rooms.size,
      connectedPlayers: socketToPlayer.size,
      uptime: Math.floor(process.uptime())
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

let nextPlayerCounter = 1;

wss.on('connection', (ws, req) => {
  const playerId = 'p_' + Date.now().toString(36) + '_' + (nextPlayerCounter++);
  let currentRoomCode = null;

  sendToSocket(ws, {
    type: 'CONNECTED',
    playerId,
    serverTime: Date.now()
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      sendToSocket(ws, { type: 'ERROR', message: '올바르지 않은 메시지 형식입니다.' });
      return;
    }

    switch (msg.type) {
      case 'PING':
        sendToSocket(ws, { type: 'PONG', timestamp: Date.now() });
        break;

      case 'CREATE_ROOM': {
        const nickname = (msg.nickname || '참가자').trim().slice(0, 12);
        const roomCode = generateRoomCode();

        const player = {
          id: playerId,
          nickname,
          isHost: true,
          ws
        };

        const room = {
          code: roomCode,
          hostId: playerId,
          status: 'LOBBY',
          players: new Map([[playerId, player]])
        };

        rooms.set(roomCode, room);
        currentRoomCode = roomCode;
        socketToPlayer.set(ws, { playerId, roomCode });

        console.log(`[Server] Room created: ${roomCode} by ${nickname} (${playerId})`);

        sendToSocket(ws, {
          type: 'ROOM_CREATED',
          roomCode,
          player: { id: playerId, nickname, isHost: true },
          players: serializePlayers(room)
        });
        break;
      }

      case 'JOIN_ROOM': {
        const targetCode = String(msg.roomCode || '').trim();
        const nickname = (msg.nickname || '참가자').trim().slice(0, 12);

        const room = rooms.get(targetCode);
        if (!room) {
          sendToSocket(ws, { type: 'ERROR', message: '존재하지 않는 방 번호입니다.' });
          return;
        }

        if (room.status === 'PLAYING') {
          sendToSocket(ws, { type: 'ERROR', message: '이미 게임이 진행 중인 방입니다.' });
          return;
        }

        if (room.players.size >= 4) {
          sendToSocket(ws, { type: 'ERROR', message: '방 인원(최대 4명)이 가득 찼습니다.' });
          return;
        }

        const player = {
          id: playerId,
          nickname,
          isHost: false,
          ws
        };

        room.players.set(playerId, player);
        currentRoomCode = targetCode;
        socketToPlayer.set(ws, { playerId, roomCode: targetCode });

        console.log(`[Server] Player ${nickname} (${playerId}) joined room ${targetCode}`);

        // Notify joiner
        sendToSocket(ws, {
          type: 'ROOM_JOINED',
          roomCode: targetCode,
          player: { id: playerId, nickname, isHost: false },
          players: serializePlayers(room)
        });

        // Broadcast to other players in room
        broadcastToRoom(room, {
          type: 'PLAYER_JOINED',
          player: { id: playerId, nickname, isHost: false },
          players: serializePlayers(room)
        }, playerId);

        break;
      }

      case 'LEAVE_ROOM': {
        handlePlayerLeave(ws);
        currentRoomCode = null;
        break;
      }

      case 'START_GAME': {
        if (!currentRoomCode || !rooms.has(currentRoomCode)) return;
        const room = rooms.get(currentRoomCode);

        if (room.hostId !== playerId) {
          sendToSocket(ws, { type: 'ERROR', message: '방장만 게임을 시작할 수 있습니다.' });
          return;
        }

        room.status = 'PLAYING';
        console.log(`[Server] Game started in room: ${currentRoomCode}`);

        broadcastToRoom(room, {
          type: 'GAME_STARTED',
          roomCode: currentRoomCode,
          players: serializePlayers(room),
          startTime: Date.now()
        });
        break;
      }

      default:
        console.log(`[Server] Unknown message type: ${msg.type}`);
        break;
    }
  });

  ws.on('close', () => {
    handlePlayerLeave(ws);
  });

  ws.on('error', (err) => {
    console.error(`[Server] Socket error on player ${playerId}:`, err.message);
    handlePlayerLeave(ws);
  });
});

/**
 * Handle player disconnecting or leaving room
 */
function handlePlayerLeave(ws) {
  const meta = socketToPlayer.get(ws);
  if (!meta) return;

  const { playerId, roomCode } = meta;
  socketToPlayer.delete(ws);

  const room = rooms.get(roomCode);
  if (!room) return;

  const leavingPlayer = room.players.get(playerId);
  room.players.delete(playerId);

  const nickname = leavingPlayer ? leavingPlayer.nickname : playerId;
  console.log(`[Server] Player left: ${nickname} from room ${roomCode}`);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    console.log(`[Server] Room deleted (empty): ${roomCode}`);
  } else {
    // If host left, delegate host to next available player
    let newHostAssigned = false;
    if (room.hostId === playerId) {
      const nextPlayer = room.players.values().next().value;
      room.hostId = nextPlayer.id;
      nextPlayer.isHost = true;
      newHostAssigned = true;
      console.log(`[Server] New host assigned in room ${roomCode}: ${nextPlayer.nickname} (${nextPlayer.id})`);
    }

    broadcastToRoom(room, {
      type: 'PLAYER_LEFT',
      playerId,
      nickname,
      newHostId: room.hostId,
      players: serializePlayers(room)
    });
  }
}

server.listen(PORT, () => {
  console.log(`[Let's Pang Server] Running on http://localhost:${PORT} (WS on ws://localhost:${PORT})`);
});
