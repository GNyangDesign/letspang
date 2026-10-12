/**
 * Let's Pang! - Mobile-First Realtime Web Casual Shooter
 * Built for smartphones & touch screens
 */

// Fun random nicknames for casual arcade players
const RANDOM_NICKNAMES = [
  '번개팡팡', '무지개퐁퐁', '우주별이', '초코송이', '달콤젤리',
  '신바람팡', '솜사탕구름', '불꽃슛돌이', '포도팡팡', '은하수별',
  '바람돌이', '젤리베어', '슈퍼팡팡', '통통토끼', '날쌘돌이'
];

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
const btnShareRoom = document.getElementById('btn-share-room');
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

// Virtual Joystick DOM
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

// Application State
let socket = null;
let myPlayerId = null;
let currentRoom = null;
let isHost = false;
let pingInterval = null;

// Determine WebSocket URL from environment or default
function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;

  const isHttps = window.location.protocol === 'https:';
  const protocol = isHttps ? 'wss:' : 'ws:';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${protocol}//localhost:3001`;
  }
  // Production: Vultr socket server (or same host fallback)
  return `${protocol}//${window.location.host}`;
}

const WS_URL = getWebSocketUrl();

/**
 * Mobile Haptic Feedback Helper
 */
function triggerHaptic(duration = 20) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch (_) {}
  }
}

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
  }, 2600);
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
 * Setup Nickname Management & URL Room Auto-Fill
 */
function getRandomNickname() {
  return RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
}

function initLobbyInputs() {
  // Check URL query param for room (e.g. ?room=4821)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    roomCodeInput.value = roomParam.trim().slice(0, 5);
  }

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
  triggerHaptic(15);
  const newName = getRandomNickname();
  nicknameInput.value = newName;
  localStorage.setItem('letspang_nickname', newName);
});

/**
 * WebSocket Connection & Event Handling
 */
function connectWebSocket() {
  connectionPill.className = 'status-pill status-disconnected';
  connectionText.textContent = '연결 중...';

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    connectionText.textContent = '오프라인';
    setTimeout(connectWebSocket, 3000);
    return;
  }

  socket.onopen = () => {
    connectionPill.className = 'status-pill status-connected';
    connectionText.textContent = '서버 연결됨';

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
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {};
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
      triggerHaptic(40);
      updateRoomUI();
      switchView('room');
      showToast(`🎉 방이 생성되었습니다! 방 번호: ${msg.roomCode}`);
      break;

    case 'ROOM_JOINED':
      currentRoom = {
        code: msg.roomCode,
        players: msg.players
      };
      isHost = msg.player.isHost;
      triggerHaptic(40);
      updateRoomUI();
      switchView('room');
      showToast(`🔑 방에 입장했습니다! (${msg.roomCode})`);
      break;

    case 'PLAYER_JOINED':
      if (currentRoom) {
        currentRoom.players = msg.players;
        triggerHaptic(30);
        updateRoomUI();
        showToast(`👋 ${msg.player.nickname} 님이 입장했습니다!`);
      }
      break;

    case 'PLAYER_LEFT':
      if (currentRoom) {
        currentRoom.players = msg.players;
        const me = msg.players.find(p => p.id === myPlayerId);
        if (me && me.isHost && !isHost) {
          isHost = true;
          showToast('👑 내가 새로운 방장이 되었습니다!');
        } else {
          showToast(`🚪 ${msg.nickname} 님이 퇴장했습니다.`);
        }
        updateRoomUI();
      }
      break;

    case 'GAME_STARTED':
      gameRoomCode.textContent = msg.roomCode;
      triggerHaptic([50, 50, 80]);
      switchView('game');
      showToast('🚀 게임 시작! Let\'s Pang!');
      break;

    case 'ERROR':
      triggerHaptic(50);
      showToast(`❌ ${msg.message}`);
      break;

    default:
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

  if (isHost) {
    hostControls.classList.remove('hidden');
    guestControls.classList.add('hidden');
    if (count >= 2) {
      btnStartGame.removeAttribute('disabled');
      startHint.textContent = '준비 완료! 시작 버튼을 눌러 게임을 시작하세요.';
      startHint.style.color = '#00e676';
    } else {
      btnStartGame.setAttribute('disabled', 'true');
      startHint.textContent = '최소 2명이 모여야 시작할 수 있어요 (친구 초대 중)';
      startHint.style.color = 'var(--text-muted)';
    }
  } else {
    hostControls.classList.add('hidden');
    guestControls.classList.remove('hidden');
  }

  // Render 4 Player Slots for mobile grid
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
        <div class="slot-avatar" style="opacity: 0.25">➕</div>
        <div class="slot-empty-text">친구 대기</div>
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
  triggerHaptic(20);
  const nickname = nicknameInput.value.trim() || getRandomNickname();
  send('CREATE_ROOM', { nickname });
});

btnJoinRoom.addEventListener('click', () => {
  triggerHaptic(20);
  const code = roomCodeInput.value.trim();
  if (!code) {
    showToast('⚠️ 입장할 방 번호를 입력해 주세요.');
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
  triggerHaptic(15);
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    copyTooltip.textContent = '복사 완료! ✅';
    showToast(`📋 방 번호 [${currentRoom.code}] 복사 완료!`);
    setTimeout(() => { copyTooltip.textContent = '코드 복사'; }, 2000);
  } catch (err) {
    showToast(`방 번호: ${currentRoom.code}`);
  }
});

// Mobile Web Share API Integration
btnShareRoom.addEventListener('click', async () => {
  if (!currentRoom) return;
  triggerHaptic(20);

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom.code}`;
  const shareData = {
    title: "Let's Pang! 🎈",
    text: `초간단 실시간 대전 게임! 방 번호 [${currentRoom.code}]로 들어와서 같이 팡팡 터뜨리자!`,
    url: shareUrl
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (_) {}
  } else {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('📢 친구 초대 링크가 클립보드에 복사되었습니다!');
    } catch (_) {
      showToast(`초대 링크: ${shareUrl}`);
    }
  }
});

btnLeaveRoom.addEventListener('click', () => {
  triggerHaptic(20);
  send('LEAVE_ROOM');
  currentRoom = null;
  isHost = false;
  switchView('lobby');
});

btnStartGame.addEventListener('click', () => {
  triggerHaptic(30);
  send('START_GAME');
});

btnExitGame.addEventListener('click', () => {
  triggerHaptic(20);
  send('LEAVE_ROOM');
  currentRoom = null;
  isHost = false;
  switchView('lobby');
});

/**
 * Stress-Relief Ink Splatter Hit Effect (모바일 최적화)
 * - 잉크가 시야를 가림 (반격 가능)
 * - 1.8초 페이드아웃 + 폰 흔들기(Shake) 또는 화면 탭으로 잉크 털기
 */
function triggerInkSplatter(xPercent, yPercent) {
  triggerHaptic([40, 30, 60]); // Hit vibration pattern

  const x = xPercent !== undefined ? xPercent : 20 + Math.random() * 60;
  const y = yPercent !== undefined ? yPercent : 20 + Math.random() * 60;
  const size = 110 + Math.random() * 90;

  const splat = document.createElement('div');
  splat.className = 'ink-splat';
  splat.style.left = `${x}%`;
  splat.style.top = `${y}%`;
  splat.style.width = `${size}px`;
  splat.style.height = `${size}px`;

  const r1 = 30 + Math.random() * 40;
  const r2 = 30 + Math.random() * 40;
  const r3 = 30 + Math.random() * 40;
  const r4 = 30 + Math.random() * 40;
  splat.style.borderRadius = `${r1}% ${100 - r1}% ${r2}% ${100 - r2}% / ${r3}% ${r4}% ${100 - r4}% ${100 - r3}%`;

  inkOverlay.appendChild(splat);
  inkShakeGuide.classList.remove('hidden');

  setTimeout(() => {
    splat.remove();
    if (inkOverlay.children.length === 0) {
      inkShakeGuide.classList.add('hidden');
    }
  }, 1800);
}

// Clear ink by tapping on ink overlay
inkOverlay.addEventListener('pointerdown', (e) => {
  if (inkOverlay.children.length > 0) {
    const first = inkOverlay.firstElementChild;
    if (first) {
      triggerHaptic(15);
      first.style.transition = 'all 0.15s ease';
      first.style.opacity = '0';
      first.style.transform = 'translate(-50%, -50%) scale(1.3)';
      setTimeout(() => {
        first.remove();
        if (inkOverlay.children.length === 0) {
          inkShakeGuide.classList.add('hidden');
        }
      }, 150);
    }
  }
});

btnTestSplatter.addEventListener('click', () => {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => { triggerInkSplatter(); }, i * 140);
  }
});

// Physical Shake Detection (DeviceMotionEvent)
let lastShakeTime = 0;
let lastX = null, lastY = null, lastZ = null;

if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
  window.addEventListener('devicemotion', (e) => {
    if (inkOverlay.children.length === 0) return;

    const acc = e.accelerationIncludingGravity;
    if (!acc) return;

    const now = Date.now();
    if (now - lastShakeTime < 180) return;

    if (lastX !== null) {
      const delta = Math.abs(acc.x - lastX) + Math.abs(acc.y - lastY) + Math.abs(acc.z - lastZ);
      if (delta > 22) { // Shake threshold
        lastShakeTime = now;
        triggerHaptic(25);
        const splat = inkOverlay.firstElementChild;
        if (splat) {
          splat.remove();
          if (inkOverlay.children.length === 0) {
            inkShakeGuide.classList.add('hidden');
          }
        }
      }
    }
    lastX = acc.x;
    lastY = acc.y;
    lastZ = acc.z;
  });
}

/**
 * 2D Canvas Interactive Game Engine (Mobile Touch Joystick + Tap-to-Shoot)
 */
let canvasCtx = null;
let playerPos = { x: 200, y: 200 };
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };
let moveVector = { x: 0, y: 0 };
let projectiles = [];

function initGameCanvas() {
  canvasCtx = gameCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Touch controls on canvas container
  const container = gameCanvas.parentElement;

  container.addEventListener('pointerdown', (e) => {
    const rect = container.getBoundingClientRect();
    const touchX = e.clientX - rect.left;
    const touchY = e.clientY - rect.top;

    // Left half: Virtual Joystick for movement
    if (touchX < rect.width * 0.48) {
      joystickActive = true;
      joystickStart = { x: touchX, y: touchY };
      joystickBase.style.left = `${touchX}px`;
      joystickBase.style.top = `${touchY}px`;
      joystickStick.style.transform = 'translate(-50%, -50%)';
      joystickBase.classList.remove('hidden');
      triggerHaptic(10);
    } else {
      // Right half: Aim & Shoot Bubble
      shootProjectile(touchX, touchY, rect.width, rect.height);
    }
  });

  container.addEventListener('pointermove', (e) => {
    if (!joystickActive) return;
    const rect = container.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const dx = currentX - joystickStart.x;
    const dy = currentY - joystickStart.y;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 38;

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);

    const stickX = Math.cos(angle) * clampedDist;
    const stickY = Math.sin(angle) * clampedDist;

    joystickStick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

    moveVector = {
      x: (stickX / maxRadius) * 4.5,
      y: (stickY / maxRadius) * 4.5
    };
  });

  const stopJoystick = () => {
    if (joystickActive) {
      joystickActive = false;
      moveVector = { x: 0, y: 0 };
      joystickBase.classList.add('hidden');
    }
  };

  container.addEventListener('pointerup', stopJoystick);
  container.addEventListener('pointercancel', stopJoystick);

  // Desktop keyboard controls fallback
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') moveVector.y = -4.5;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') moveVector.y = 4.5;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveVector.x = -4.5;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveVector.x = 4.5;
  });

  window.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown', 'w', 's', 'W', 'S'].includes(e.key)) moveVector.y = 0;
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) moveVector.x = 0;
  });

  requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
  const container = gameCanvas.parentElement;
  if (!container) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();

  gameCanvas.width = rect.width * dpr;
  gameCanvas.height = rect.height * dpr;
  if (canvasCtx) {
    canvasCtx.scale(dpr, dpr);
  }
}

function shootProjectile(targetX, targetY, containerW, containerH) {
  triggerHaptic(20);
  const angle = Math.atan2(targetY - playerPos.y, targetX - playerPos.x);

  projectiles.push({
    x: playerPos.x,
    y: playerPos.y,
    vx: Math.cos(angle) * 8,
    vy: Math.sin(angle) * 8,
    radius: 7,
    color: '#ff4785',
    life: 70
  });
}

function gameLoop() {
  if (!viewGame.classList.contains('active')) return;

  const container = gameCanvas.parentElement;
  const w = container ? container.clientWidth : 360;
  const h = container ? container.clientHeight : 400;

  // Move Player
  playerPos.x += moveVector.x;
  playerPos.y += moveVector.y;
  playerPos.x = Math.max(25, Math.min(w - 25, playerPos.x));
  playerPos.y = Math.max(25, Math.min(h - 25, playerPos.y));

  // Render Background
  canvasCtx.fillStyle = '#140c30';
  canvasCtx.fillRect(0, 0, w, h);

  // Subtle Grid
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  canvasCtx.lineWidth = 1;
  for (let x = 0; x < w; x += 36) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, 0);
    canvasCtx.lineTo(x, h);
    canvasCtx.stroke();
  }
  for (let y = 0; y < h; y += 36) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, y);
    canvasCtx.lineTo(w, y);
    canvasCtx.stroke();
  }

  // Render Projectiles
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

    if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
      projectiles.splice(i, 1);
    }
  }

  // Render Player Character (Cute Bubble Character)
  canvasCtx.beginPath();
  canvasCtx.arc(playerPos.x, playerPos.y, 20, 0, Math.PI * 2);
  canvasCtx.fillStyle = '#00e5ff';
  canvasCtx.shadowColor = '#00e5ff';
  canvasCtx.shadowBlur = 14;
  canvasCtx.fill();
  canvasCtx.shadowBlur = 0;
  canvasCtx.lineWidth = 3;
  canvasCtx.strokeStyle = '#fff';
  canvasCtx.stroke();

  // Face Emoticon on player
  canvasCtx.font = '16px Fredoka, sans-serif';
  canvasCtx.textAlign = 'center';
  canvasCtx.textBaseline = 'middle';
  canvasCtx.fillText('🐰', playerPos.x, playerPos.y + 1);

  // Nickname Label
  canvasCtx.font = 'bold 12px Fredoka, Outfit, sans-serif';
  canvasCtx.fillStyle = '#fff';
  canvasCtx.textBaseline = 'bottom';
  const myName = nicknameInput.value.trim() || '나';
  canvasCtx.fillText(myName, playerPos.x, playerPos.y - 26);

  requestAnimationFrame(gameLoop);
}

// Initialize on Load
initLobbyInputs();
connectWebSocket();
