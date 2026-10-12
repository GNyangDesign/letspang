/**
 * Let's Pang! - Realtime AR Paintball Battle Web Game
 * Uses Smartphone Camera + MediaPipe On-Device Person Detection + WebSocket
 */

import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

// Fun random nicknames for casual arcade players
const RANDOM_NICKNAMES = [
  '번개팡팡', '무지개퐁퐁', '우주별이', '초코송이', '달콤젤리',
  '신바람팡', '솜사탕구름', '불꽃슛돌이', '포도팡팡', '은하수별',
  '바람돌이', '젤리베어', '슈퍼팡팡', '통통토끼', '날쌘돌이'
];

const AVATARS = ['🐰', '🐱', '🐶', '🦊'];
const PAINT_COLORS = ['#ff007f', '#00e5ff', '#ffd000', '#00e676', '#ff5722', '#b388ff'];

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

// In-Game DOM References
const gameRoomCode = document.getElementById('game-room-code');
const myScoreBadge = document.getElementById('my-score-badge');
const aiStatusPill = document.getElementById('ai-status-pill');
const btnExitGame = document.getElementById('btn-exit-game');
const hitFeed = document.getElementById('hit-feed');

const arenaContainer = document.getElementById('arena-container');
const cameraVideo = document.getElementById('camera-video');
const gameCanvas = document.getElementById('game-canvas');
const cameraPromptOverlay = document.getElementById('camera-prompt-overlay');
const btnStartCamera = document.getElementById('btn-start-camera');
const lockBadge = document.getElementById('lock-badge');
const lockText = document.getElementById('lock-text');
const inkOverlay = document.getElementById('ink-overlay');
const inkShakeGuide = document.getElementById('ink-shake-guide');
const btnFire = document.getElementById('btn-fire');
const btnSwitchCamera = document.getElementById('btn-switch-camera');
const leaderboardPreview = document.getElementById('leaderboard-preview');
const btnTestSplatter = document.getElementById('btn-test-splatter');
const toastBox = document.getElementById('toast');

// Application State
let socket = null;
let myPlayerId = null;
let currentRoom = null;
let isHost = false;
let pingInterval = null;
let myScore = 0;
let myColor = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)];

// Camera & Vision State
let objectDetector = null;
let isDetectorLoading = false;
let isDetectorReady = false;
let cameraStream = null;
let facingMode = 'environment'; // default rear camera
let isCameraActive = false;

let detectedPeople = [];
let lastInferenceTime = 0;
let isLockedOn = false;
let lockedDistance = null;
let lastLockTime = 0; // debounce buffer (0.25s)

// Audio Context (Synthesized sound effects)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Sound Synthesizers
function playShootSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(380, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch (_) {}
}

function playHitSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.setValueAtTime(780, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.23);
  } catch (_) {}
}

function playSplatSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.19);
  } catch (_) {}
}

// WebSocket URL Determination
function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:3001';
  }
  return 'wss://socket.letspang.com';
}
const WS_URL = getWebSocketUrl();

// Haptic Feedback
function triggerHaptic(pattern = 20) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (_) {}
  }
}

// Toast
let toastTimeout = null;
function showToast(message) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastBox.textContent = message;
  toastBox.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toastBox.classList.add('hidden');
  }, 2600);
}

// Switch Screens
function switchView(viewName) {
  viewLobby.classList.remove('active');
  viewRoom.classList.remove('active');
  viewGame.classList.remove('active');

  if (viewName === 'lobby') {
    viewLobby.classList.add('active');
    stopCamera();
  } else if (viewName === 'room') {
    viewRoom.classList.add('active');
    stopCamera();
  } else if (viewName === 'game') {
    viewGame.classList.add('active');
    enterBattleArena();
  }
}

// Nickname Helpers
function getRandomNickname() {
  return RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
}

function initLobbyInputs() {
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

// WebSocket Connection
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

// Server Message Handler
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'CONNECTED':
      myPlayerId = msg.playerId;
      break;

    case 'ROOM_CREATED':
      currentRoom = { code: msg.roomCode, players: msg.players };
      isHost = true;
      triggerHaptic(40);
      updateRoomUI();
      switchView('room');
      showToast(`🎉 방이 생성되었습니다! 방 번호: ${msg.roomCode}`);
      break;

    case 'ROOM_JOINED':
      currentRoom = { code: msg.roomCode, players: msg.players };
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
      myScore = 0;
      updateScoreUI(0);
      triggerHaptic([50, 50, 80]);
      switchView('game');
      showToast('🚀 배틀 시작! 카메라로 상대를 조준하고 쏘세요!');
      break;

    case 'GET_HIT':
      // The local player was hit by an opponent!
      triggerHaptic([80, 40, 120]);
      playSplatSound();
      triggerInkSplatter(msg.splatColor || '#ff007f');
      showToast(`💥 ${msg.shooterNickname || '상대'} 님의 페인트에 피격당했습니다!`);
      break;

    case 'SCORE_UPDATE':
      if (msg.shooterId === myPlayerId) {
        myScore += 100;
        updateScoreUI(myScore);
        playHitSound();
        spawnFloatingText('+100', '#ffd000');
      }
      if (msg.scores && msg.scores.length > 0) {
        const top = msg.scores[0];
        leaderboardPreview.textContent = `🏆 1위: ${top.nickname} (${top.score}점)`;
      }
      if (msg.hitMessage) {
        showHitFeed(msg.hitMessage);
      }
      break;

    case 'ERROR':
      triggerHaptic(50);
      showToast(`❌ ${msg.message}`);
      break;

    default:
      break;
  }
}

function updateScoreUI(score) {
  myScoreBadge.innerHTML = `내 점수: <b>${score}</b>점`;
}

let feedTimeout = null;
function showHitFeed(text) {
  hitFeed.textContent = text;
  hitFeed.classList.remove('hidden');
  if (feedTimeout) clearTimeout(feedTimeout);
  feedTimeout = setTimeout(() => {
    hitFeed.classList.add('hidden');
  }, 2400);
}

// Room UI
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

// Lobby Event Listeners
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
  if (e.key === 'Enter') btnJoinRoom.click();
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

btnShareRoom.addEventListener('click', async () => {
  if (!currentRoom) return;
  triggerHaptic(20);

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom.code}`;
  const shareData = {
    title: "Let's Pang! 🎈",
    text: `폰 카메라로 즐기는 AR 페인트볼 대전! 방 번호 [${currentRoom.code}]로 들어와서 같이 팡팡 터뜨리자!`,
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

// ==========================================
// AR CAMERA & MEDIAPIPE VISION SYSTEM
// ==========================================

async function initVisionDetector() {
  if (objectDetector || isDetectorLoading) return;
  isDetectorLoading = true;
  aiStatusPill.textContent = 'AI 로딩 중...';

  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
        delegate: 'GPU'
      },
      scoreThreshold: 0.35,
      runningMode: 'VIDEO',
      maxResults: 3
    });

    isDetectorReady = true;
    isDetectorLoading = false;
    aiStatusPill.textContent = 'AI 준비 완료 ✅';
    aiStatusPill.style.color = '#00e676';
  } catch (err) {
    console.warn('[Vision] GPU delegate failed, falling back to CPU:', err);
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      objectDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
          delegate: 'CPU'
        },
        scoreThreshold: 0.35,
        runningMode: 'VIDEO',
        maxResults: 3
      });
      isDetectorReady = true;
      isDetectorLoading = false;
      aiStatusPill.textContent = 'AI 준비 완료 (CPU) ✅';
      aiStatusPill.style.color = '#00e676';
    } catch (fallbackErr) {
      console.error('[Vision] Failed to load MediaPipe detector:', fallbackErr);
      isDetectorLoading = false;
      aiStatusPill.textContent = 'AI 오프라인';
      aiStatusPill.style.color = '#ff5252';
    }
  }
}

// Start Camera Stream
async function startCamera() {
  if (isCameraActive) return;

  try {
    cameraPromptOverlay.classList.remove('hidden');
    cameraPromptOverlay.querySelector('.prompt-desc').textContent = '카메라 연결 중...';

    const constraints = {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (idealErr) {
      // Fallback without facingMode constraint (e.g. desktop webcam)
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    isCameraActive = true;
    cameraPromptOverlay.classList.add('hidden');
    showToast('📷 배틀 카메라 활성화 완료!');

    // Initialize detector in background
    initVisionDetector();
  } catch (err) {
    console.error('[Camera] Access error:', err);
    cameraPromptOverlay.classList.remove('hidden');
    cameraPromptOverlay.querySelector('.prompt-desc').textContent =
      '카메라 접근 권한이 필요합니다. 브라우저 주소창 왼쪽의 권한 설정에서 카메라를 허용해 주세요.';
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  isCameraActive = false;
}

btnStartCamera.addEventListener('click', () => {
  getAudioContext(); // initialize audio on user touch
  startCamera();
});

btnSwitchCamera.addEventListener('click', async () => {
  triggerHaptic(20);
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
  showToast(facingMode === 'environment' ? '📷 후면 카메라 전환' : '🤳 전면 카메라 전환');
});

// Decoupled Background AI Inference Loop (10~12 FPS)
setInterval(() => {
  if (!isCameraActive || !isDetectorReady || !objectDetector) return;
  if (cameraVideo.readyState < 2) return;

  try {
    const now = performance.now();
    const detections = objectDetector.detectForVideo(cameraVideo, now).detections;
    const people = [];

    const vw = cameraVideo.videoWidth || 640;
    const vh = cameraVideo.videoHeight || 480;

    for (const det of detections) {
      const category = det.categories[0];
      if (category && (category.categoryName === 'person' || category.categoryName === 'Person')) {
        const { originX, originY, width, height } = det.boundingBox;
        const heightRatio = height / vh;
        const dist = (1.7 / (heightRatio * 1.3)).toFixed(1);

        people.push({
          x: originX,
          y: originY,
          w: width,
          h: height,
          score: category.score,
          dist: Math.max(1.0, Math.min(25.0, parseFloat(dist)))
        });
      }
    }

    detectedPeople = people;
    lastInferenceTime = now;
  } catch (err) {
    // skip single frame inference error
  }
}, 90);

// ==========================================
// 60FPS VIEWPORT RENDER LOOP & RETICLE
// ==========================================

let canvasCtx = null;
let flyingProjectiles = [];
let floatingTexts = [];

function enterBattleArena() {
  canvasCtx = gameCanvas.getContext('2d');
  resizeArenaCanvas();
  window.addEventListener('resize', resizeArenaCanvas);

  startCamera();
  requestAnimationFrame(renderArenaLoop);
}

function resizeArenaCanvas() {
  if (!arenaContainer) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = arenaContainer.getBoundingClientRect();

  gameCanvas.width = rect.width * dpr;
  gameCanvas.height = rect.height * dpr;
  if (canvasCtx) {
    canvasCtx.scale(dpr, dpr);
  }
}

function spawnFloatingText(text, color = '#ffd000') {
  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  floatingTexts.push({
    text,
    color,
    x: cw / 2,
    y: ch / 2 - 20,
    alpha: 1.0,
    vy: -2.2
  });
}

function renderArenaLoop() {
  if (!viewGame.classList.contains('active')) return;

  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  // 1. Render Video Feed or Sci-Fi Scanner Background
  if (isCameraActive && cameraVideo.readyState >= 2) {
    const vw = cameraVideo.videoWidth;
    const vh = cameraVideo.videoHeight;

    // Cover scale algorithm
    const scale = Math.max(cw / vw, ch / vh);
    const sw = vw * scale;
    const sh = vh * scale;
    const sx = (cw - sw) / 2;
    const sy = (ch - sh) / 2;

    canvasCtx.save();
    // Mirror horizontally if user front camera
    if (facingMode === 'user') {
      canvasCtx.translate(cw, 0);
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(cameraVideo, sx, sy, sw, sh);
      canvasCtx.restore();
    } else {
      canvasCtx.drawImage(cameraVideo, sx, sy, sw, sh);
      canvasCtx.restore();
    }

    // Semi-transparent vignette overlay for focus
    const grad = canvasCtx.createRadialGradient(cw / 2, ch / 2, cw * 0.25, cw / 2, ch / 2, cw * 0.7);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    canvasCtx.fillStyle = grad;
    canvasCtx.fillRect(0, 0, cw, ch);
  } else {
    // Standby Grid Background
    canvasCtx.fillStyle = '#0f0822';
    canvasCtx.fillRect(0, 0, cw, ch);

    canvasCtx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    canvasCtx.lineWidth = 1;
    for (let x = 0; x < cw; x += 36) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x, ch);
      canvasCtx.stroke();
    }
    for (let y = 0; y < ch; y += 36) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, y);
      canvasCtx.lineTo(cw, y);
      canvasCtx.stroke();
    }
  }

  // 2. Check Center Crosshair Lock-on with Debounce Buffer
  const centerX = cw / 2;
  const centerY = ch / 2;
  const reticleRadius = 34;

  let currentlyOverlapping = false;
  let targetDist = null;

  if (isCameraActive && cameraVideo.readyState >= 2 && detectedPeople.length > 0) {
    const vw = cameraVideo.videoWidth;
    const vh = cameraVideo.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const sx = (cw - vw * scale) / 2;
    const sy = (ch - vh * scale) / 2;

    for (const person of detectedPeople) {
      // Map video coordinate to canvas coordinate
      let px = sx + person.x * scale;
      const py = sy + person.y * scale;
      const pw = person.w * scale;
      const ph = person.h * scale;

      if (facingMode === 'user') {
        px = cw - (px + pw);
      }

      // Draw subtle neon corner brackets around detected person
      drawTargetCorners(canvasCtx, px, py, pw, ph, isLockedOn ? '#ff0055' : '#00e5ff');

      // Distance tag
      canvasCtx.fillStyle = isLockedOn ? '#ff0055' : '#00e5ff';
      canvasCtx.font = 'bold 12px Fredoka, sans-serif';
      canvasCtx.fillText(`상대 ~${person.dist}m`, px, Math.max(22, py - 6));

      // Overlap with Center Reticle
      if (
        centerX >= px &&
        centerX <= px + pw &&
        centerY >= py &&
        centerY <= py + ph
      ) {
        currentlyOverlapping = true;
        targetDist = person.dist;
      }
    }
  }

  // Debounce memory (0.25s) so lock-on doesn't flicker when phone moves
  const now = performance.now();
  if (currentlyOverlapping) {
    lastLockTime = now;
    isLockedOn = true;
    lockedDistance = targetDist;
  } else if (now - lastLockTime < 260) {
    isLockedOn = true;
  } else {
    isLockedOn = false;
    lockedDistance = null;
  }

  // Update Lock Indicator UI
  if (isLockedOn) {
    lockBadge.classList.remove('hidden');
    lockText.textContent = `🎯 상대 포착! (~${lockedDistance || '3.0'}m) PANG!`;
    btnFire.classList.add('locked-on');
  } else {
    lockBadge.classList.add('hidden');
    btnFire.classList.remove('locked-on');
  }

  // 3. Draw Paintball Reticle
  drawPaintballReticle(canvasCtx, centerX, centerY, reticleRadius, isLockedOn, now);

  // 4. Render Flying Paint Projectiles
  for (let i = flyingProjectiles.length - 1; i >= 0; i--) {
    const proj = flyingProjectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.radius *= 0.95;
    proj.life--;

    canvasCtx.beginPath();
    canvasCtx.arc(proj.x, proj.y, Math.max(3, proj.radius), 0, Math.PI * 2);
    canvasCtx.fillStyle = proj.color;
    canvasCtx.shadowColor = proj.color;
    canvasCtx.shadowBlur = 12;
    canvasCtx.fill();
    canvasCtx.shadowBlur = 0;

    if (proj.life <= 0) {
      // Paint splash at target center
      drawSplatterBurst(canvasCtx, proj.x, proj.y, proj.color);
      flyingProjectiles.splice(i, 1);
    }
  }

  // 5. Render Floating Scores (+100)
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy;
    ft.alpha -= 0.024;

    canvasCtx.font = '900 24px Fredoka, Outfit, sans-serif';
    canvasCtx.fillStyle = `rgba(255, 208, 0, ${Math.max(0, ft.alpha)})`;
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(ft.text, ft.x, ft.y);

    if (ft.alpha <= 0) {
      floatingTexts.splice(i, 1);
    }
  }

  requestAnimationFrame(renderArenaLoop);
}

// Reticle Graphics
function drawPaintballReticle(ctx, cx, cy, r, locked, now) {
  ctx.save();
  const pulse = locked ? Math.sin(now * 0.015) * 4 : 0;
  const currentR = r + pulse;

  // Outer Circle
  ctx.beginPath();
  ctx.arc(cx, cy, currentR, 0, Math.PI * 2);
  ctx.lineWidth = locked ? 3.5 : 2;
  ctx.strokeStyle = locked ? '#ff0055' : 'rgba(255, 255, 255, 0.75)';
  if (locked) {
    ctx.fillStyle = 'rgba(255, 0, 85, 0.22)';
    ctx.fill();
  }
  ctx.stroke();

  // 4 Crosshair Notches
  const notchLen = 10;
  ctx.lineWidth = 3;
  ctx.strokeStyle = locked ? '#ff0055' : '#00e5ff';

  // Top
  ctx.beginPath();
  ctx.moveTo(cx, cy - currentR - 3);
  ctx.lineTo(cx, cy - currentR - 3 - notchLen);
  ctx.stroke();

  // Bottom
  ctx.beginPath();
  ctx.moveTo(cx, cy + currentR + 3);
  ctx.lineTo(cx, cy + currentR + 3 + notchLen);
  ctx.stroke();

  // Left
  ctx.beginPath();
  ctx.moveTo(cx - currentR - 3, cy);
  ctx.lineTo(cx - currentR - 3 - notchLen, cy);
  ctx.stroke();

  // Right
  ctx.beginPath();
  ctx.moveTo(cx + currentR + 3, cy);
  ctx.lineTo(cx + currentR + 3 + notchLen, cy);
  ctx.stroke();

  // Center Dot
  ctx.beginPath();
  ctx.arc(cx, cy, locked ? 5 : 3, 0, Math.PI * 2);
  ctx.fillStyle = locked ? '#ff0055' : '#00e5ff';
  ctx.fill();

  ctx.restore();
}

function drawTargetCorners(ctx, x, y, w, h, color) {
  const len = Math.min(22, w * 0.25, h * 0.25);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;

  // Top-Left
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  // Top-Right
  ctx.beginPath();
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.stroke();

  // Bottom-Left
  ctx.beginPath();
  ctx.moveTo(x, y + h - len);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + len, y + h);
  ctx.stroke();

  // Bottom-Right
  ctx.beginPath();
  ctx.moveTo(x + w - len, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
}

function drawSplatterBurst(ctx, x, y, color) {
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 / 6) * i + Math.random() * 0.4;
    const dist = 12 + Math.random() * 16;
    const bx = x + Math.cos(angle) * dist;
    const by = y + Math.sin(angle) * dist;

    ctx.beginPath();
    ctx.arc(bx, by, 3 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

// ==========================================
// SHOOTING & INK HIT MECHANICS
// ==========================================

let lastShootTime = 0;
const SHOOT_COOLDOWN = 380; // ms

function performShoot() {
  const now = performance.now();
  if (now - lastShootTime < SHOOT_COOLDOWN) return;
  lastShootTime = now;

  triggerHaptic(30);
  playShootSound();

  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  // Projectile starts from fire button position and flies to center reticle
  const fireRect = btnFire.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();
  const startX = fireRect.left - contRect.left + fireRect.width / 2;
  const startY = fireRect.top - contRect.top + fireRect.height / 2;

  const targetX = cw / 2;
  const targetY = ch / 2;

  const frames = 9;
  flyingProjectiles.push({
    x: startX,
    y: startY,
    vx: (targetX - startX) / frames,
    vy: (targetY - startY) / frames,
    radius: 14,
    color: myColor,
    life: frames
  });

  // If locked-on, report HIT to server!
  if (isLockedOn) {
    send('PLAYER_HIT', {
      color: myColor
    });
  }
}

btnFire.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  performShoot();
});

// Spacebar or Click-to-shoot on canvas
window.addEventListener('keydown', (e) => {
  if (viewGame.classList.contains('active') && e.code === 'Space') {
    e.preventDefault();
    performShoot();
  }
});

// Stress-Relief Ink Splatter Hit Effect
function triggerInkSplatter(color = '#ff007f') {
  triggerHaptic([60, 40, 90]);

  const splatCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < splatCount; i++) {
    const x = 20 + Math.random() * 60;
    const y = 20 + Math.random() * 60;
    const size = 110 + Math.random() * 110;

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

    splat.style.background = `radial-gradient(circle, ${color} 20%, #79008a 75%, rgba(25, 0, 45, 0.95) 100%)`;

    inkOverlay.appendChild(splat);
    inkShakeGuide.classList.remove('hidden');

    setTimeout(() => {
      splat.remove();
      if (inkOverlay.children.length === 0) {
        inkShakeGuide.classList.add('hidden');
      }
    }, 1900);
  }
}

// Clear ink by tapping on screen
inkOverlay.addEventListener('pointerdown', () => {
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
  triggerInkSplatter(PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)]);
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
      if (delta > 22) {
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

// Initialize on Load
initLobbyInputs();
connectWebSocket();
