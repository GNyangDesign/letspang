/**
 * Let's Pang! - Realtime AR Paintball Battle Web Game
 * Splatfight / Splatoon Aesthetic with Smartphone Camera + MediaPipe Person Detection + WebSocket
 */

import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

// Fun random nicknames for casual arcade players
const RANDOM_NICKNAMES = [
  '번개팡팡', '무지개퐁퐁', '우주별이', '초코송이', '달콤젤리',
  '신바람팡', '솜사탕구름', '불꽃슛돌이', '포도팡팡', '은하수별',
  '바람돌이', '젤리베어', '슈퍼팡팡', '통통토끼', '날쌘돌이'
];

const AVATARS = ['🐰', '🐱', '🐶', '🦊'];

// DOM Element References - Lobby & Room
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

// DOM References - Splatfight Battle Arena HUD
const scoreBlueEl = document.getElementById('score-blue');
const scoreRedEl = document.getElementById('score-red');
const matchTimerEl = document.getElementById('match-timer');
const ammoFillEl = document.getElementById('ammo-fill');
const btnExitGame = document.getElementById('btn-exit-game');
const hitFeed = document.getElementById('hit-feed');

const arenaContainer = document.getElementById('arena-container');
const cameraVideo = document.getElementById('camera-video');
const gameCanvas = document.getElementById('game-canvas');
const cameraPromptOverlay = document.getElementById('camera-prompt-overlay');
const btnStartCamera = document.getElementById('btn-start-camera');

const lockBadgeTop = document.getElementById('lock-badge-top');
const lockBadgeBottom = document.getElementById('lock-badge-bottom');
const lockBottomText = document.getElementById('lock-bottom-text');

const inkOverlay = document.getElementById('ink-overlay');
const inkShakeGuide = document.getElementById('ink-shake-guide');
const btnFire = document.getElementById('btn-fire');
const btnSwitchCamera = document.getElementById('btn-switch-camera');
const myTeamBadge = document.getElementById('my-team-badge');
const aiStatusPill = document.getElementById('ai-status-pill');
const btnTestSplatter = document.getElementById('btn-test-splatter');
const toastBox = document.getElementById('toast');

// Application State
let socket = null;
let myPlayerId = null;
let currentRoom = null;
let isHost = false;
let pingInterval = null;

// Team & Gameplay State
let myTeam = 'BLUE'; // 'BLUE' or 'RED'
let opponentTeam = 'RED';
let teamScores = { blue: 0, red: 0 };
let currentAmmo = 100; // 0 - 100
const MAX_AMMO = 100;
const AMMO_PER_SHOT = 20;
let matchRemainingSeconds = 150;
let matchTimerInterval = null;

// Camera & Vision State
let objectDetector = null;
let isDetectorLoading = false;
let isDetectorReady = false;
let cameraStream = null;
let facingMode = 'environment';
let isCameraActive = false;

let detectedPeople = [];
let isLockedOn = false;
let lockedDistance = null;
let lastLockTime = 0; // debounce buffer (0.28s)

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

function playShootSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.45, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch (_) {}
}

function playEmptyAmmoSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch (_) {}
}

function playHitSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.09);

    gain.gain.setValueAtTime(0.55, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch (_) {}
}

function playSplatSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.65, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.21);
  } catch (_) {}
}

// WebSocket URL
function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:3001';
  }
  return 'wss://socket.letspang.com';
}
const WS_URL = getWebSocketUrl();

// Haptic & Toast
function triggerHaptic(pattern = 20) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (_) {}
  }
}

let toastTimeout = null;
function showToast(message) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastBox.textContent = message;
  toastBox.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toastBox.classList.add('hidden');
  }, 2600);
}

// View Switching
function switchView(viewName) {
  viewLobby.classList.remove('active');
  viewRoom.classList.remove('active');
  viewGame.classList.remove('active');

  if (viewName === 'lobby') {
    viewLobby.classList.add('active');
    stopCamera();
    stopMatchTimer();
  } else if (viewName === 'room') {
    viewRoom.classList.add('active');
    stopCamera();
    stopMatchTimer();
  } else if (viewName === 'game') {
    viewGame.classList.add('active');
    enterBattleArena();
  }
}

// Lobby Nickname Management
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

// WebSocket Setup
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

// Handle Server Messages
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
      // Determine my team from players list
      if (msg.players) {
        const me = msg.players.find(p => p.id === myPlayerId);
        if (me && me.team) {
          myTeam = me.team;
        } else {
          myTeam = 'BLUE';
        }
      }
      opponentTeam = myTeam === 'BLUE' ? 'RED' : 'BLUE';

      teamScores = msg.teamScores || { blue: 0, red: 0 };
      updateScoreboardUI();

      myTeamBadge.textContent = `내 팀: ${myTeam}`;
      myTeamBadge.style.color = myTeam === 'BLUE' ? '#80d8ff' : '#ffab91';
      myTeamBadge.style.borderColor = myTeam === 'BLUE' ? '#0091ea' : '#ff5722';

      lockBottomText.textContent = `TARGET LOCKED (${opponentTeam} TEAM)`;

      triggerHaptic([50, 50, 80]);
      switchView('game');
      startMatchTimer(msg.duration || 150);
      showToast(`🚀 배틀 시작! [${myTeam}] 팀으로 참전합니다!`);
      break;

    case 'GET_HIT':
      triggerHaptic([80, 40, 120]);
      playSplatSound();
      triggerInkSplatter(msg.splatColor || (myTeam === 'BLUE' ? '#ff5722' : '#00e5ff'));
      showToast(`💥 [${msg.shooterTeam || '상대'}] ${msg.shooterNickname || '상대'} 님의 페인트에 피격당했습니다!`);
      break;

    case 'SCORE_UPDATE':
      if (msg.teamScores) {
        teamScores = msg.teamScores;
        updateScoreboardUI();
      }
      if (msg.shooterId === myPlayerId) {
        playHitSound();
        spawnHitBurst('+100');
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

function updateScoreboardUI() {
  scoreBlueEl.textContent = teamScores.blue || 0;
  scoreRedEl.textContent = teamScores.red || 0;
}

function startMatchTimer(durationSeconds) {
  stopMatchTimer();
  matchRemainingSeconds = durationSeconds;
  updateTimerDisplay();

  matchTimerInterval = setInterval(() => {
    matchRemainingSeconds--;
    if (matchRemainingSeconds <= 0) {
      matchRemainingSeconds = 0;
      stopMatchTimer();
      showToast('⏰ 매치 종료! 최종 결과를 집계합니다.');
    }
    updateTimerDisplay();
  }, 1000);
}

function stopMatchTimer() {
  if (matchTimerInterval) {
    clearInterval(matchTimerInterval);
    matchTimerInterval = null;
  }
}

function updateTimerDisplay() {
  const m = Math.floor(matchRemainingSeconds / 60);
  const s = matchRemainingSeconds % 60;
  matchTimerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
      isDetectorLoading = false;
      aiStatusPill.textContent = 'AI 오프라인';
      aiStatusPill.style.color = '#ff5252';
    }
  }
}

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
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    isCameraActive = true;
    cameraPromptOverlay.classList.add('hidden');
    showToast('📷 배틀 카메라 활성화 완료!');

    initVisionDetector();
  } catch (err) {
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
  getAudioContext();
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
  } catch (err) {}
}, 90);

// ==========================================
// 60FPS VIEWPORT RENDER LOOP & RETICLE
// ==========================================

let canvasCtx = null;
let flyingProjectiles = [];
let hitBursts = []; // Cartoon Blue Splats with "HIT! +100"

function enterBattleArena() {
  canvasCtx = gameCanvas.getContext('2d');
  resizeArenaCanvas();
  window.addEventListener('resize', resizeArenaCanvas);

  currentAmmo = MAX_AMMO;
  updateAmmoBar();

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

function spawnHitBurst(text = 'HIT! +100') {
  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  hitBursts.push({
    text,
    x: cw / 2 + 50,
    y: ch / 2 + 10,
    size: 42,
    alpha: 1.0,
    vy: -1.8,
    scale: 0.6
  });
}

function renderArenaLoop() {
  if (!viewGame.classList.contains('active')) return;

  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  // Ammo Passive Regeneration (+0.35 per frame => ~21 per sec)
  if (currentAmmo < MAX_AMMO) {
    currentAmmo = Math.min(MAX_AMMO, currentAmmo + 0.35);
    updateAmmoBar();
  }

  // 1. Render Video Feed or Sci-Fi Dark Background
  if (isCameraActive && cameraVideo.readyState >= 2) {
    const vw = cameraVideo.videoWidth;
    const vh = cameraVideo.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = vw * scale;
    const sh = vh * scale;
    const sx = (cw - sw) / 2;
    const sy = (ch - sh) / 2;

    canvasCtx.save();
    if (facingMode === 'user') {
      canvasCtx.translate(cw, 0);
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(cameraVideo, sx, sy, sw, sh);
      canvasCtx.restore();
    } else {
      canvasCtx.drawImage(cameraVideo, sx, sy, sw, sh);
      canvasCtx.restore();
    }

    // Subtle dark vignette
    const grad = canvasCtx.createRadialGradient(cw / 2, ch / 2, cw * 0.28, cw / 2, ch / 2, cw * 0.72);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    canvasCtx.fillStyle = grad;
    canvasCtx.fillRect(0, 0, cw, ch);
  } else {
    canvasCtx.fillStyle = '#0a0518';
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
  const reticleRadius = 38;

  let currentlyOverlapping = false;
  let targetDist = null;
  let lockedBox = null;

  if (isCameraActive && cameraVideo.readyState >= 2 && detectedPeople.length > 0) {
    const vw = cameraVideo.videoWidth;
    const vh = cameraVideo.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const sx = (cw - vw * scale) / 2;
    const sy = (ch - vh * scale) / 2;

    for (const person of detectedPeople) {
      let px = sx + person.x * scale;
      const py = sy + person.y * scale;
      const pw = person.w * scale;
      const ph = person.h * scale;

      if (facingMode === 'user') {
        px = cw - (px + pw);
      }

      // Draw Orange Corner Bracket Box (matching screenshot!)
      drawOrangeTargetBox(canvasCtx, px, py, pw, ph);

      // Draw High-Tech Cyan Wireframe Skeleton Pose lines (matching screenshot!)
      drawWireframeSkeleton(canvasCtx, px, py, pw, ph);

      // Check overlap with center reticle
      if (
        centerX >= px &&
        centerX <= px + pw &&
        centerY >= py &&
        centerY <= py + ph
      ) {
        currentlyOverlapping = true;
        targetDist = person.dist;
        lockedBox = { px, py, pw, ph };
      }
    }
  }

  // Debounce memory (0.28s)
  const now = performance.now();
  if (currentlyOverlapping) {
    lastLockTime = now;
    isLockedOn = true;
    lockedDistance = targetDist;
  } else if (now - lastLockTime < 280) {
    isLockedOn = true;
  } else {
    isLockedOn = false;
    lockedDistance = null;
  }

  // Update Lock Indicator Banners
  if (isLockedOn) {
    lockBadgeTop.classList.remove('hidden');
    lockBadgeBottom.classList.remove('hidden');
    lockBottomText.textContent = `TARGET LOCKED (${opponentTeam} TEAM)`;
  } else {
    lockBadgeTop.classList.add('hidden');
    lockBadgeBottom.classList.add('hidden');
  }

  // 3. Draw Splatfight Cyan Center Reticle (matching screenshot!)
  drawSplatfightCrosshair(canvasCtx, centerX, centerY, reticleRadius, isLockedOn, now);

  // 4. Render Flying Projectiles
  for (let i = flyingProjectiles.length - 1; i >= 0; i--) {
    const proj = flyingProjectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.radius *= 0.94;
    proj.life--;

    canvasCtx.beginPath();
    canvasCtx.arc(proj.x, proj.y, Math.max(4, proj.radius), 0, Math.PI * 2);
    canvasCtx.fillStyle = proj.color;
    canvasCtx.shadowColor = proj.color;
    canvasCtx.shadowBlur = 12;
    canvasCtx.fill();
    canvasCtx.shadowBlur = 0;

    if (proj.life <= 0) {
      flyingProjectiles.splice(i, 1);
    }
  }

  // 5. Render Cartoon Splat Bursts + "HIT! +100" (matching screenshot!)
  for (let i = hitBursts.length - 1; i >= 0; i--) {
    const hb = hitBursts[i];
    hb.y += hb.vy;
    hb.scale = Math.min(1.0, hb.scale + 0.08);
    hb.alpha -= 0.022;

    drawCartoonHitSplat(canvasCtx, hb.x, hb.y, hb.size * hb.scale, hb.text, hb.alpha);

    if (hb.alpha <= 0) {
      hitBursts.splice(i, 1);
    }
  }

  requestAnimationFrame(renderArenaLoop);
}

// Draw Orange Corner Bracket Box around opponent (matching screenshot)
function drawOrangeTargetBox(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 3.5;
  ctx.shadowColor = '#ff6600';
  ctx.shadowBlur = 10;

  const len = Math.min(26, w * 0.28, h * 0.28);

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

  ctx.restore();
}

// Draw High-Tech Cyan Wireframe Skeleton Pose lines (matching screenshot)
function drawWireframeSkeleton(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
  ctx.lineWidth = 1.5;

  const headX = x + w / 2;
  const headY = y + h * 0.18;
  const headR = Math.min(16, w * 0.16);

  // Head circle
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  // Spine & Shoulders
  const neckY = headY + headR;
  const shoulderY = y + h * 0.32;
  const waistY = y + h * 0.58;

  ctx.beginPath();
  ctx.moveTo(headX, neckY);
  ctx.lineTo(headX, waistY);
  // Shoulders
  ctx.moveTo(x + w * 0.25, shoulderY);
  ctx.lineTo(x + w * 0.75, shoulderY);
  // Hips
  ctx.moveTo(x + w * 0.32, waistY);
  ctx.lineTo(x + w * 0.68, waistY);
  ctx.stroke();

  ctx.restore();
}

// Draw Splatfight Cyan Center Crosshair Reticle (matching screenshot)
function drawSplatfightCrosshair(ctx, cx, cy, r, locked, now) {
  ctx.save();
  const pulse = locked ? Math.sin(now * 0.016) * 3 : 0;
  const currentR = r + pulse;

  // Outer Cyan Circle
  ctx.beginPath();
  ctx.arc(cx, cy, currentR, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = locked ? '#ff1744' : '#00e5ff';
  ctx.shadowColor = locked ? '#ff1744' : '#00e5ff';
  ctx.shadowBlur = 12;
  ctx.stroke();

  // 4 Crosshair Tick Lines
  const tickLen = 14;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#00e5ff';

  // Top
  ctx.beginPath();
  ctx.moveTo(cx, cy - currentR + 4);
  ctx.lineTo(cx, cy - currentR - tickLen);
  ctx.stroke();

  // Bottom
  ctx.beginPath();
  ctx.moveTo(cx, cy + currentR - 4);
  ctx.lineTo(cx, cy + currentR + tickLen);
  ctx.stroke();

  // Left
  ctx.beginPath();
  ctx.moveTo(cx - currentR + 4, cy);
  ctx.lineTo(cx - currentR - tickLen, cy);
  ctx.stroke();

  // Right
  ctx.beginPath();
  ctx.moveTo(cx + currentR - 4, cy);
  ctx.lineTo(cx + currentR + tickLen, cy);
  ctx.stroke();

  // Center Target Dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = locked ? '#ff1744' : '#00e5ff';
  ctx.fill();

  ctx.restore();
}

// Draw Cartoon Splat Burst with HIT! +100 (matching screenshot)
function drawCartoonHitSplat(ctx, x, y, size, text, alpha) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);

  // Cartoon Blue Paint Splat Shape
  ctx.fillStyle = '#00a0ff';
  ctx.strokeStyle = '#0044aa';
  ctx.lineWidth = 2.5;

  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 / 8) * i;
    const r = (i % 2 === 0 ? size : size * 0.65);
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // "HIT!" in bold white text
  ctx.font = '900 16px Fredoka, Outfit, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText('HIT!', x, y - 6);

  // "+100" in bright yellow text
  ctx.font = '900 18px Fredoka, Outfit, sans-serif';
  ctx.fillStyle = '#ffd000';
  ctx.fillText('+100', x, y + 10);

  ctx.restore();
}

// ==========================================
// SHOOTING & AMMO MECHANICS
// ==========================================

function updateAmmoBar() {
  const pct = Math.max(0, Math.min(100, currentAmmo));
  ammoFillEl.style.width = `${pct}%`;
  if (pct < AMMO_PER_SHOT) {
    ammoFillEl.style.background = '#ff3344';
  } else {
    ammoFillEl.style.background = 'linear-gradient(90deg, #ff9100 0%, #ffd000 100%)';
  }
}

let lastShootTime = 0;
const SHOOT_INTERVAL = 320; // ms

function performShoot() {
  const now = performance.now();
  if (now - lastShootTime < SHOOT_INTERVAL) return;

  // Check Ammo
  if (currentAmmo < AMMO_PER_SHOT) {
    playEmptyAmmoSound();
    triggerHaptic(15);
    showToast('⚠️ PAINT AMMO 부족! 충전 중입니다.');
    return;
  }

  currentAmmo -= AMMO_PER_SHOT;
  updateAmmoBar();
  lastShootTime = now;

  triggerHaptic(30);
  playShootSound();

  const container = arenaContainer;
  const cw = container ? container.clientWidth : 360;
  const ch = container ? container.clientHeight : 480;

  // Flying paint droplet animation from bottom right to center
  const fireRect = btnFire.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();
  const startX = fireRect.left - contRect.left + fireRect.width / 2;
  const startY = fireRect.top - contRect.top + fireRect.height / 2;

  const targetX = cw / 2;
  const targetY = ch / 2;

  const frames = 8;
  const bulletColor = myTeam === 'BLUE' ? '#00e5ff' : '#ff5722';

  flyingProjectiles.push({
    x: startX,
    y: startY,
    vx: (targetX - startX) / frames,
    vy: (targetY - startY) / frames,
    radius: 16,
    color: bulletColor,
    life: frames
  });

  // If target locked, report hit to server!
  if (isLockedOn) {
    send('PLAYER_HIT', {
      color: bulletColor
    });
  }
}

btnFire.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  performShoot();
});

// Spacebar shoot support
window.addEventListener('keydown', (e) => {
  if (viewGame.classList.contains('active') && e.code === 'Space') {
    e.preventDefault();
    performShoot();
  }
});

// Stress-Relief Ink Splatter Hit Effect
function triggerInkSplatter(color = '#ff5722') {
  triggerHaptic([60, 40, 90]);

  const splatCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < splatCount; i++) {
    const x = 20 + Math.random() * 60;
    const y = 20 + Math.random() * 60;
    const size = 120 + Math.random() * 110;

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

    splat.style.background = `radial-gradient(circle, ${color} 25%, #79008a 75%, rgba(20, 0, 40, 0.95) 100%)`;

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

// Tap ink to wipe
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
  triggerInkSplatter(myTeam === 'BLUE' ? '#ff5722' : '#00e5ff');
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
