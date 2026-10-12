/**
 * Let's Pang! - Main Client Application Logic
 * Real-time WebSocket room matching & casual shooter prototype
 */

// Fun random nicknames for casual arcade players
const RANDOM_NICKNAMES = [
  '번개팡팡', '무지개퐁퐁', '우주별이', '초코송이', '달콤젤리',
  '신바람팡', '솜사탕구름', '불꽃슛돌이', '포도팡팡', '은하수별',
  '바람돌이', '젤리베어', '슈퍼팡팡', '통통토끼', '날쌘돌이'
];

// Fun avatar emoticons for 4 slots
const AVATARS = ['🐰', '🐱', '🐶', '🦊'];

// DOM Element References
const connectionPill = document.getElementById('connection-pill');
const connectionText = document.getElementById('connection-text');
const nicknameInput = document.getElementById('nickname-input');
const btnRandomNickname = document.getElementById('btn-random-nickname');

const viewLobby = document.getElementById('view-lobby');
const viewRoom = document.getElementById('view-room');
const viewGame = document.getElementById('view-game');

const btnCreateRoom = document.getElementById('btn-create-room');
const roomCodeInput = document.getElementById('room-code-input');
const btnJoinRoom = document.getElementById('btn-join-room');

const displayRoomCode = document.getElementById('display-room-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const copyTooltip = document.getElementById('copy-tooltip');
const btnLeaveRoom = document.getElementById('btn-leave-room');
const playerGrid = document.getElementById('player-grid');
const playerCountSpan = document.getElementById('player-count');
const hostControls = document.getElementById('host-controls');
const guestControls = document.getElementById('guest-controls');
const btnStartGame = document.getElementById('btn-start-game');
const startHint = document.getElementById('start-hint');

const gameRoomCode = document.getElementById('game-room-code');
const btnExitGame = document.getElementById('btn-exit-game');
const gameCanvas = document.getElementById('game-canvas');
const inkOverlay = document.getElementById('ink-overlay');
const inkShakeGuide = document.getElementById('ink-shake-guide');
const btnTestSplatter = document.getElementById('btn-test-splatter');
const toastBox = document.getElementById('toast');

// Application State
let socket = null;
let myPlayerId = null;
let currentRoom = null; // { code, hostId, players: [] }
let isHost = false;
let pingInterval = null;
let inkClearTimeout = null;

// Determine WebSocket URL from environment or default
function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;

  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'wss:' : 'ws:';
  // If running locally, default to backend port 3001
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${protocol}//localhost:3001`;
  }
  // Production fallback: same host on wss
  return `${protocol}//${window.location.host}`;
}

const WS_URL = getWebSocketUrl();

/**
 * Toast Notification Helper
 */
let toastTimeout = null;
function showToast(message) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastBox.textContent = message;
  toastBox.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toastBox.classList.add('hidden');
  }, 3000);
}

/**
 * Switch Active Screen View
 */
function switchView(viewName) {
  viewLobby.classList.remove('active');
  viewRoom.classList.remove('active');
  viewGame.classList.remove('active');

  if (viewName === 'lobby') {
    viewLobby.classList.add('active');
  } else if (viewName === 'room') {
    viewRoom.classList.add('active');
  } else if (viewName === 'game') {
    viewGame.classList.add('active');
    initGameCanvas();
  }
}

/**
 * Setup Nickname Management
 */
function getRandomNickname() {
  return RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
}

function initNickname() {
  const saved = localStorage.getItem('letspang_nickname');
  if (saved) {
    nicknameInput.value = saved;
  } else {
    const randomName = getRandomNickname();
    nicknameInput.value = randomName;
    localStorage.setItem('letspang_nickname', randomName);
  }
}

nicknameInput.addEventListener('input', () => {
  localStorage.setItem('letspang_nickname', nicknameInput.value.trim());
});

btnRandomNickname.addEventListener('click', () => {
  const newName = getRandomNickname();
  nicknameInput.value = newName;
  localStorage.setItem('letspang_nickname', newName);
  nicknameInput.classList.add('pulse');
  setTimeout(() => nicknameInput.classList.remove('pulse'), 300);
});

/**
 * WebSocket Connection & Event Handling
 */
function connectWebSocket() {
  connectionPill.className = 'status-pill status-disconnected';
  connectionText.textContent = '서버 연결 중...';

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.error('Socket init error:', err);
    connectionText.textContent = '연결 실패';
    setTimeout(connectWebSocket, 3000);
    return;
  }

  socket.onopen = () => {
    connectionPill.className = 'status-pill status-connected';
    connectionText.textContent = '서버 연결됨';
    console.log('[Let\'s Pang] Connected to game server:', WS_URL);

    // Heartbeat ping every 20 seconds
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);
  };

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    handleServerMessage(msg);
  };

  socket.onclose = () => {
    connectionPill.className = 'status-pill status-disconnected';
    connectionText.textContent = '연결 끊김';
    if (pingInterval) clearInterval(pingInterval);
    console.warn('[Let\'s Pang] Disconnected from server. Reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('[Let\'s Pang] Socket error:', err);
  };
}

function send(type, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast('⚠️ 서버와 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    return false;
  }
  socket.send(JSON.stringify({ type, ...payload }));
  return true;
}

/**
 * Handle incoming server packets
 */
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'CONNECTED':
      myPlayerId = msg.playerId;
      break;

    case 'ROOM_CREATED':
      currentRoom = {
        code: msg.roomCode,
        players: msg.players
      };
      isHost = true;
      updateRoomUI();
      switchView('room');
      showToast(`🎉 방이 생성되었습니다! 방 코드: ${msg.roomCode}`);
      break;

    case 'ROOM_JOINED':
      currentRoom = {
        code: msg.roomCode,
        players: msg.players
      };
      isHost = msg.player.isHost;
      updateRoomUI();
      switchView('room');
      showToast(`🔑 방에 입장했습니다! (방 코드: ${msg.roomCode})`);
      break;

    case 'PLAYER_JOINED':
      if (currentRoom) {
        currentRoom.players = msg.players;
        updateRoomUI();
        showToast(`👋 ${msg.player.nickname} 님이 입장했습니다!`);
      }
      break;

    case 'PLAYER_LEFT':
      if (currentRoom) {
        currentRoom.players = msg.players;
        // Check if I became the new host
        const me = msg.players.find(p => p.id === myPlayerId);
        if (me && me.isHost && !isHost) {
          isHost = true;
          showToast('👑 방장님이 퇴장하여 새로운 방장이 되었습니다!');
        } else {
          showToast(`🚪 ${msg.nickname} 님이 퇴장했습니다.`);
        }
        updateRoomUI();
      }
      break;

    case 'GAME_STARTED':
      gameRoomCode.textContent = msg.roomCode;
      switchView('game');
      showToast('🚀 게임이 시작되었습니다! Let\'s Pang!');
      break;

    case 'ERROR':
      showToast(`❌ ${msg.message}`);
      break;

    case 'PONG':
      break;

    default:
      console.log('Unhandled packet:', msg);
      break;
  }
}

/**
 * Update Waiting Room UI
 */
function updateRoomUI() {
  if (!currentRoom) return;

  displayRoomCode.textContent = currentRoom.code;
  const count = currentRoom.players.length;
  playerCountSpan.textContent = count;

  // Toggle Host vs Guest controls
  if (isHost) {
    hostControls.classList.remove('hidden');
    guestControls.classList.add('hidden');
    // Enable start button if at least 2 players
    if (count >= 2) {
      btnStartGame.removeAttribute('disabled');
      startHint.textContent = '준비 완료! 시작 버튼을 눌러 게임을 시작하세요.';
      startHint.style.color = '#00e676';
    } else {
      btnStartGame.setAttribute('disabled', 'true');
      startHint.textContent = '최소 2명이 모여야 게임을 시작할 수 있습니다. (친구 초대 중)';
      startHint.style.color = 'var(--text-muted)';
    }
  } else {
    hostControls.classList.add('hidden');
    guestControls.classList.remove('hidden');
  }

  // Render 4 Player Slots
  playerGrid.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const player = currentRoom.players[i];
    const slot = document.createElement('div');
    slot.className = 'player-slot';

    if (player) {
      const isMe = player.id === myPlayerId;
      slot.classList.add('occupied');
      if (isMe) slot.classList.add('is-me');

      const avatar = AVATARS[i % AVATARS.length];
      const tagHtml = player.isHost
        ? '<span class="slot-tag tag-host">👑 방장</span>'
        : '<span class="slot-tag tag-ready">준비 완료</span>';

      slot.innerHTML = `
        <div class="slot-avatar">${avatar}</div>
        <div class="slot-name">${escapeHtml(player.nickname)}${isMe ? ' (나)' : ''}</div>
        ${tagHtml}
      `;
    } else {
      slot.innerHTML = `
        <div class="slot-avatar" style="opacity: 0.3">➕</div>
        <div class="slot-empty-text">친구 대기 중...</div>
      `;
    }

    playerGrid.appendChild(slot);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

/**
 * Room Actions Event Listeners
 */
btnCreateRoom.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || getRandomNickname();
  send('CREATE_ROOM', { nickname });
});

btnJoinRoom.addEventListener('click', () => {
  const code = roomCodeInput.value.trim();
  if (!code) {
    showToast('⚠️ 입장할 방 코드를 입력해 주세요.');
    roomCodeInput.focus();
    return;
  }
  const nickname = nicknameInput.value.trim() || getRandomNickname();
  send('JOIN_ROOM', { roomCode: code, nickname });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnJoinRoom.click();
  }
});

btnCopyCode.addEventListener('click', async () => {
  if (!currentRoom) return;
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    copyTooltip.textContent = '복사됨! ✅';
    showToast(`📋 방 코드 [${currentRoom.code}]가 클립보드에 복사되었습니다!`);
    setTimeout(() => {
      copyTooltip.textContent = '복사';
    }, 2000);
  } catch (err) {
    showToast(`방 코드: ${currentRoom.code}`);
  }
});

btnLeaveRoom.addEventListener('click', () => {
  send('LEAVE_ROOM');
  currentRoom = null;
  isHost = false;
  switchView('lobby');
});

btnStartGame.addEventListener('click', () => {
  send('START_GAME');
});

btnExitGame.addEventListener('click', () => {
  send('LEAVE_ROOM');
  currentRoom = null;
  isHost = false;
  switchView('lobby');
});

/**
 * Stress-Relief Ink Splatter Hit Effect (핵심 피격 메커니즘)
 * - 잉크 오버레이로 시야를 가리되, 조준선 흔들림 & 반격 여지 보장
 * - 1.5~2초 페이드아웃 또는 흔들기/스페이스바 연타로 빠른 제거
 */
function triggerInkSplatter(xPercent, yPercent) {
  const x = xPercent !== undefined ? xPercent : 20 + Math.random() * 60;
  const y = yPercent !== undefined ? yPercent : 20 + Math.random() * 60;
  const size = 120 + Math.random() * 100;

  const splat = document.createElement('div');
  splat.className = 'ink-splat';
  splat.style.left = `${x}%`;
  splat.style.top = `${y}%`;
  splat.style.width = `${size}px`;
  splat.style.height = `${size}px`;

  // Organic blob border radius
  const r1 = 30 + Math.random() * 40;
  const r2 = 30 + Math.random() * 40;
  const r3 = 30 + Math.random() * 40;
  const r4 = 30 + Math.random() * 40;
  splat.style.borderRadius = `${r1}% ${100 - r1}% ${r2}% ${100 - r2}% / ${r3}% ${r4}% ${100 - r4}% ${100 - r3}%`;

  inkOverlay.appendChild(splat);
  inkShakeGuide.classList.remove('hidden');

  // Fade and clean up after 1.8s
  setTimeout(() => {
    splat.remove();
    if (inkOverlay.children.length === 0) {
      inkShakeGuide.classList.add('hidden');
    }
  }, 1800);
}

// Interactive test button for ink splatter
btnTestSplatter.addEventListener('click', () => {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      triggerInkSplatter();
    }, i * 150);
  }
});

// Spacebar or Shake clears ink faster
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && inkOverlay.children.length > 0) {
    const firstSplat = inkOverlay.firstElementChild;
    if (firstSplat) {
      firstSplat.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      firstSplat.style.opacity = '0';
      firstSplat.style.transform = 'translate(-50%, -50%) scale(1.4)';
      setTimeout(() => {
        firstSplat.remove();
        if (inkOverlay.children.length === 0) {
          inkShakeGuide.classList.add('hidden');
        }
      }, 200);
    }
  }
});

/**
 * 2D Canvas Interactive Game Prototype Loop
 */
let canvasCtx = null;
let playerPos = { x: 400, y: 250, vx: 0, vy: 0 };
let keys = {};
let projectiles = [];

function initGameCanvas() {
  canvasCtx = gameCanvas.getContext('2d');

  window.addEventListener('keydown', (e) => { keys[e.key] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  gameCanvas.addEventListener('click', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    const targetX = (e.clientX - rect.left) * (gameCanvas.width / rect.width);
    const targetY = (e.clientY - rect.top) * (gameCanvas.height / rect.height);

    const angle = Math.atan2(targetY - playerPos.y, targetX - playerPos.x);
    projectiles.push({
      x: playerPos.x,
      y: playerPos.y,
      vx: Math.cos(angle) * 7,
      vy: Math.sin(angle) * 7,
      radius: 8,
      color: '#ff4785',
      life: 80
    });
  });

  requestAnimationFrame(gameLoop);
}

function gameLoop() {
  if (!viewGame.classList.contains('active')) return;

  // Update Movement
  const speed = 4;
  if (keys['ArrowUp'] || keys['w'] || keys['W']) playerPos.y -= speed;
  if (keys['ArrowDown'] || keys['s'] || keys['S']) playerPos.y += speed;
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) playerPos.x -= speed;
  if (keys['ArrowRight'] || keys['d'] || keys['D']) playerPos.x += speed;

  // Boundary clamp
  playerPos.x = Math.max(30, Math.min(gameCanvas.width - 30, playerPos.x));
  playerPos.y = Math.max(30, Math.min(gameCanvas.height - 30, playerPos.y));

  // Render Background
  canvasCtx.fillStyle = '#160e36';
  canvasCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // Grid lines
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  canvasCtx.lineWidth = 1;
  for (let x = 0; x < gameCanvas.width; x += 40) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, 0);
    canvasCtx.lineTo(x, gameCanvas.height);
    canvasCtx.stroke();
  }
  for (let y = 0; y < gameCanvas.height; y += 40) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, y);
    canvasCtx.lineTo(gameCanvas.width, y);
    canvasCtx.stroke();
  }

  // Update & Render Projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    canvasCtx.fillStyle = p.color;
    canvasCtx.shadowColor = p.color;
    canvasCtx.shadowBlur = 10;
    canvasCtx.fill();
    canvasCtx.shadowBlur = 0;

    if (p.life <= 0 || p.x < 0 || p.x > gameCanvas.width || p.y < 0 || p.y > gameCanvas.height) {
      projectiles.splice(i, 1);
    }
  }

  // Render Player Character
  canvasCtx.beginPath();
  canvasCtx.arc(playerPos.x, playerPos.y, 22, 0, Math.PI * 2);
  canvasCtx.fillStyle = '#00e5ff';
  canvasCtx.shadowColor = '#00e5ff';
  canvasCtx.shadowBlur = 16;
  canvasCtx.fill();
  canvasCtx.shadowBlur = 0;
  canvasCtx.lineWidth = 3;
  canvasCtx.strokeStyle = '#fff';
  canvasCtx.stroke();

  // Draw Nickname Label above player
  canvasCtx.font = 'bold 13px Fredoka, Outfit, sans-serif';
  canvasCtx.fillStyle = '#fff';
  canvasCtx.textAlign = 'center';
  const myName = nicknameInput.value.trim() || '나';
  canvasCtx.fillText(myName, playerPos.x, playerPos.y - 32);

  requestAnimationFrame(gameLoop);
}

// Initialize on Load
initNickname();
connectWebSocket();
