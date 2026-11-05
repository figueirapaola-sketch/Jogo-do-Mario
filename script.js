// =============================================================================
// SUPER MARIO BROS - EDIÇÃO VR & WEB
// Suporte a Óculos VR (Google Cardboard / VR Box), Giroscópio, Toque e Controle
// =============================================================================

const mainCanvas = document.getElementById('gameCanvas');
const mainCtx = mainCanvas.getContext('2d');

// Offscreen canvas para renderização estereoscópica 3D (Side-by-Side)
const offCanvas = document.createElement('canvas');
offCanvas.width = 800;
offCanvas.height = 464;
const offCtx = offCanvas.getContext('2d');

// Contexto de desenho dinâmico (aponta para mainCtx em 2D ou offCtx no VR)
let ctx = mainCtx;

// Resolução nativa do jogo
const GAME_W = 800;
const GAME_H = 464;
mainCanvas.width = GAME_W;
mainCanvas.height = GAME_H;

// --- Configurações e Estado VR ------------------------------------------------
let vrMode = false;
let vrSettings = {
  depth3D: 8,            // Separação estereoscópica em pixels (0, 4, 8, 12)
  gyroSensitivity: 5,    // Deadzone do giroscópio (menor número = mais sensível)
  deadzone: 5,
  nodJumpEnabled: true,  // Pular ao levantar a cabeça (pitch up)
  vignette: true,        // Máscara ótica circular de lentes VR
  ipdOffset: 0           // Ajuste fino de distância interpupilar
};

// Giroscópio e rastreamento de cabeça
let gyroAvailable = false;
let currentRoll = 0;       // Inclinação lateral da cabeça (esq/dir)
let currentPitch = 0;      // Inclinação vertical da cabeça (cima/baixo)
let neutralRoll = 0;       // Posição neutra calibrada
let neutralPitch = 0;
let vrTiltLeft = false;
let vrTiltRight = false;
let pitchJumpCooldown = 0;
let wakeLock = null;

// Entradas de toque para o modo normal
let touchLeft = false;
let touchRight = false;
let touchJumpActive = false;
let touchJumpTimer = null;

// Áudio sintético para Super Jump imediato (Web Audio API)
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
function playSuperJumpSound() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.35);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {}
}

// Gamepad Bluetooth
let gamepadLeft = false;
let gamepadRight = false;
let gamepadJumpPressed = false;

// --- Áudio --------------------------------------------------------------------
const sounds = {
  bgMusic: new Audio("background_music.mp3"),
  stomp: new Audio("Stomp.mp3"),
  coin: new Audio("coin.mp3"),
  death: new Audio("death.mp3"),
  win: new Audio("win.mp3"),
};

sounds.bgMusic.loop = true;
sounds.bgMusic.volume = 0.4;
sounds.bgMusic.preload = "auto";
sounds.stomp.volume = 0.8;
sounds.coin.volume = 0.8;
sounds.death.volume = 0.8;
sounds.win.volume = 0.85;

function playSound(snd) {
  if (!snd) return;
  try {
    const clone = snd.cloneNode();
    clone.volume = snd.volume;
    clone.play().catch(() => {});
  } catch (e) {
    try {
      snd.currentTime = 0;
      snd.play().catch(() => {});
    } catch (e2) {}
  }
}

function startMusic() {
  try {
    sounds.bgMusic.currentTime = 0;
    sounds.bgMusic.play().catch(() => {});
  } catch (e) {}
}

function stopMusic() {
  try {
    sounds.bgMusic.pause();
  } catch (e) {}
}

// --- Elementos HUD e DOM ------------------------------------------------------
const scoreEl       = document.getElementById('score');  
const livesEl       = document.getElementById('lives');
const coinsEl       = document.getElementById('coins');
const timerEl       = document.getElementById('timer');
const overlay       = document.getElementById('overlay');
const overlayTitle  = document.getElementById('overlay-title');
const overlayMsg    = document.getElementById('overlay-msg');
const overlayBtn    = document.getElementById('overlay-btn');
const overlayBtnVR  = document.getElementById('overlay-btn-vr');
const vrHudBar      = document.getElementById('vr-hud-bar');
const vrModal       = document.getElementById('vr-settings-modal');
const vrCountdown   = document.getElementById('vr-countdown-overlay');
const touchControls = document.getElementById('touch-controls');

// --- Constantes do Jogo -------------------------------------------------------
const GRAVITY      = 0.5;
const TILE         = 32;
const GROUND_Y     = GAME_H - TILE;   // 432
const CAM_DEADZONE = 300;

// --- Paleta de Cores ----------------------------------------------------------
const C = {
  sky:      '#5c94fc',
  ground:   '#c84c0c',
  groundTop:'#e86818',
  brick:    '#c84c0c',
  brickTop: '#e86818',
  question: '#e8a000',
  qShine:   '#f8c800',
  coin:     '#f8c800',
  coinRim:  '#c89600',
  mario:    { hat:'#e52521', skin:'#ffa060', overalls:'#0070e0', shoes:'#7b3f00' },
  goomba:   { body:'#c07038', dark:'#7b3000', eye:'#fff', pupil:'#000' },
  pipe:     { body:'#00a800', rim:'#00d800', dark:'#006800' },
  flag:     { pole:'#888', flag:'#e52521' },
  cloud:    '#fff',
  hill:     '#00a800',
};

// --- Mundo --------------------------------------------------------------------
const WORLD_W = 200 * TILE; // 6400 px

const platformDefs = [
  { x:16, y:8, w:1, type:'question', coinVal:1 },
  { x:20, y:8, w:1, type:'question', coinVal:1 },
  { x:21, y:8, w:1, type:'brick' },
  { x:22, y:8, w:1, type:'question', coinVal:1 },
  { x:23, y:8, w:1, type:'brick' },
  { x:28, y:11, w:4, type:'brick' },
  { x:28, y:9,  w:2, type:'question', coinVal:1 },
  { x:37, y:8, w:1, type:'question', coinVal:5 },
  { x:40, y:6, w:3, type:'brick' },
  { x:44, y:8, w:1, type:'question', coinVal:1 },
  { x:46, y:8, w:3, type:'brick' },
  { x:47, y:6, w:1, type:'question', coinVal:1 },
  { x:57, y:6, w:5, type:'brick' },
  { x:60, y:8, w:1, type:'question', coinVal:1 },
  { x:70, y:10, w:3, type:'brick' },
  { x:80, y:8,  w:4, type:'brick' },
  { x:85, y:6,  w:2, type:'question', coinVal:2 },
  { x:95, y:8,  w:5, type:'brick' },
  { x:100,y:6,  w:3, type:'question', coinVal:3 },
  { x:110,y:9,  w:4, type:'brick' },
  { x:120,y:7,  w:3, type:'brick' },
  { x:130,y:8,  w:4, type:'question', coinVal:2 },
  { x:140,y:7,  w:5, type:'brick' },
  { x:150,y:9,  w:3, type:'brick' },
  { x:160,y:6,  w:4, type:'question', coinVal:3 },
  { x:170,y:8,  w:4, type:'brick' },
  { x:180,y:7,  w:3, type:'question', coinVal:2 },
];

const pipeDefs = [
  { x:14, h:2 }, { x:24, h:3 }, { x:31, h:4 }, { x:36, h:4 },
  { x:55, h:2 }, { x:67, h:3 }, { x:90, h:2 }, { x:105, h:3 },
  { x:118, h:2 }, { x:135, h:4 }, { x:148, h:3 }, { x:165, h:2 },
  { x:178, h:3 }, { x:190, h:2 },
];

const stairDefs = [
  { x:187, maxH:4 }, { x:193, maxH:8 },
];

const gapDefs = [
  { x:50, w:3 }, { x:75, w:3 }, { x:115, w:4 }, { x:155, w:3 }, { x:175, w:2 },
];

const enemyDefs = [
  { x:22 },{ x:30 },{ x:38 },{ x:48 },{ x:58 },{ x:65 },
  { x:72 },{ x:83 },{ x:92 },{ x:103 },{ x:112 },{ x:123 },
  { x:133 },{ x:143 },{ x:152 },{ x:162 },{ x:173 },{ x:182 },
];

const coinDefs = [
  { x:17, y:7 },{ x:21, y:7 },{ x:41, y:5 },{ x:47, y:5 },
  { x:57, y:5 },{ x:58, y:5 },{ x:59, y:5 },{ x:70, y:9 },
  { x:80, y:7 },{ x:95, y:7 },{ x:100, y:5 },{ x:120, y:6 },
  { x:130, y:7 },{ x:140, y:6 },{ x:160, y:5 },{ x:180, y:6 },
];

const cloudDefs = [
  { x:5,  y:3 },{ x:18, y:2 },{ x:35, y:4 },{ x:50, y:2 },
  { x:65, y:3 },{ x:80, y:2 },{ x:95, y:4 },{ x:110,y:2 },
  { x:125,y:3 },{ x:140,y:2 },{ x:155,y:4 },{ x:170,y:2 },
  { x:185,y:3 },
];

const hillDefs = [
  { x:2, r:50 },{ x:10, r:40 },{ x:20, r:60 },{ x:35, r:45 },
  { x:55, r:55 },{ x:70, r:40 },{ x:90, r:50 },{ x:110, r:45 },
  { x:130, r:60 },{ x:150, r:40 },{ x:170, r:55 },{ x:185, r:45 },
];

const FLAG_X = 195;

// --- Estado do Jogo -----------------------------------------------------------
let state = 'title'; // title | playing | dead | win | gameover
let score = 0;
let lives = 3;
let coinCount = 0;
let timeLeft = 400;
let timerInterval = null;
let camX = 0;

let mario, platforms, pipes, enemies, coins, particles;

// --- Sistema de Partículas ----------------------------------------------------
function spawnParticles(x, y, color, n = 6) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 5,
      vy: -(Math.random() * 4 + 2),
      life: 40,
      color,
      r: Math.random() * 4 + 2,
    });
  }
}

function updateParticles() {
  for (let p of particles) {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.2;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
}

function drawParticles(cx) {
  for (let p of particles) {
    ctx.globalAlpha = p.life / 40;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - cx, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// --- Inicialização do Jogo ---------------------------------------------------
function initGame() {
  score     = 0;
  coinCount = 0;
  timeLeft  = 400;
  camX      = 0;
  particles = [];
  pendingSuperJump = false;
  lastJumpTapTime  = 0;
  superFlash       = 0;

  if (scoreEl) scoreEl.textContent = '000000';
  if (coinsEl) coinsEl.textContent = '0';
  if (timerEl) timerEl.textContent = '400';
  if (livesEl) livesEl.textContent = lives;

  mario = {
    x: 3 * TILE,
    y: GROUND_Y - 2 * TILE,
    w: 24,
    h: 32,
    vx: 0,
    vy: 0,
    onGround: false,
    dir: 1,
    walking: false,
    frame: 0,
    frameTimer: 0,
    dead: false,
    deadTimer: 0,
    invincible: 0,
  };

  platforms = platformDefs.map(p => ({
    x: p.x * TILE,
    y: p.y * TILE,
    w: p.w * TILE,
    h: TILE,
    type: p.type,
    coinVal: p.coinVal || 0,
    hit: false,
    bounce: 0,
  }));

  pipes = pipeDefs.map(p => ({
    x: p.x * TILE,
    y: GROUND_Y - p.h * TILE,
    w: 2 * TILE,
    h: p.h * TILE,
  }));

  for (let s of stairDefs) {
    for (let col = 0; col < s.maxH; col++) {
      for (let row = 0; row <= col; row++) {
        platforms.push({
          x: (s.x + col) * TILE,
          y: GROUND_Y - (row + 1) * TILE,
          w: TILE,
          h: TILE,
          type: 'brick',
          coinVal: 0,
          hit: false,
          bounce: 0,
        });
      }
    }
  }

  enemies = enemyDefs.map(e => ({
    x: e.x * TILE,
    y: GROUND_Y - TILE,
    w: TILE - 4,
    h: TILE - 6,
    vx: -1,
    dead: false,
    squished: false,
    squishTimer: 0,
    frame: 0,
    frameTimer: 0,
  }));

  coins = coinDefs.map(c => ({
    x: c.x * TILE + TILE / 2,
    y: c.y * TILE + TILE / 2,
    r: 8,
    collected: false,
    anim: 0,
  }));
}

function isGap(worldX) {
  for (let g of gapDefs) {
    if (worldX >= g.x * TILE && worldX < (g.x + g.w) * TILE) return true;
  }
  return false;
}

// --- Entrada de Comandos (Teclado, VR, Toque, Gamepad) ------------------------
const keys = {};
const JUMP_KEYS = ['Space','ArrowUp','KeyW'];
const SUPER_JUMP_KEYS = ['KeyX','KeyJ','Digit1','Numpad1'];
const DOUBLE_TAP_MS = 450;
let lastJumpTapTime = 0;
let pendingSuperJump = false;
let superFlash = 0;

window.addEventListener('keydown', e => {
  if (SUPER_JUMP_KEYS.includes(e.code) && !e.repeat) {
    pendingSuperJump = true;
    playSuperJumpSound();
  } else if (JUMP_KEYS.includes(e.code) && !e.repeat) {
    const now = performance.now();
    if (now - lastJumpTapTime < DOUBLE_TAP_MS) {
      pendingSuperJump = true;
      playSuperJumpSound();
    }
    if (keys['ShiftLeft'] || keys['ShiftRight']) {
      pendingSuperJump = true;
      playSuperJumpSound();
    }
    lastJumpTapTime = now;
  }
  keys[e.code] = true;

  if (e.code === 'Escape' && vrMode) {
    exitVR();
  }

  if (['Space','ArrowUp','ArrowLeft','ArrowRight','ArrowDown',
       'KeyW','KeyA','KeyD','KeyS','KeyX','KeyJ'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', e => { keys[e.code] = false; });

function triggerJump() {
  const now = performance.now();
  if (now - lastJumpTapTime < DOUBLE_TAP_MS) {
    pendingSuperJump = true;
    playSuperJumpSound();
  }
  lastJumpTapTime = now;
  touchJumpActive = true;
  clearTimeout(touchJumpTimer);
  touchJumpTimer = setTimeout(() => {
    touchJumpActive = false;
  }, 180);
}

function triggerSuperJump() {
  pendingSuperJump = true;
  playSuperJumpSound();
}

function isLeft()  {
  return keys['ArrowLeft'] || keys['KeyA'] || vrTiltLeft || touchLeft || gamepadLeft;
}

function isRight() {
  return keys['ArrowRight'] || keys['KeyD'] || vrTiltRight || touchRight || gamepadRight;
}

function isJump()  {
  return keys['Space'] || keys['ArrowUp'] || keys['KeyW'] || touchJumpActive || gamepadJumpPressed;
}

// --- Rastreamento do Giroscópio (Head Tracking para VR) -----------------------
function handleOrientation(e) {
  if (e.beta === null || e.gamma === null) return;
  gyroAvailable = true;

  let angle = 0;
  if (window.screen && screen.orientation && screen.orientation.angle !== undefined) {
    angle = screen.orientation.angle;
  } else if (typeof window.orientation === 'number') {
    angle = window.orientation;
  }

  let roll = 0;
  let pitch = 0;

  // No modo paisagem (celular na horizontal dentro do óculos VR):
  if (angle === 90) {
    roll = e.beta;
    pitch = -e.gamma;
  } else if (angle === 270 || angle === -90) {
    roll = -e.beta;
    pitch = e.gamma;
  } else {
    roll = e.gamma;
    pitch = e.beta;
  }

  currentRoll = roll;
  currentPitch = pitch;
}

function calibrateGyro() {
  neutralRoll = currentRoll;
  neutralPitch = currentPitch;
}

function updateVRInputs() {
  if (!vrMode || vrSettings.gyroSensitivity === 0) {
    vrTiltLeft = false;
    vrTiltRight = false;
    return;
  }

  const deltaRoll = currentRoll - neutralRoll;
  const deltaPitch = currentPitch - neutralPitch;
  const deadzone = vrSettings.deadzone;

  if (deltaRoll < -deadzone) {
    vrTiltLeft = true;
    vrTiltRight = false;
  } else if (deltaRoll > deadzone) {
    vrTiltRight = true;
    vrTiltLeft = false;
  } else {
    vrTiltLeft = false;
    vrTiltRight = false;
  }

  // Pulo ao inclinar a cabeça para cima
  if (vrSettings.nodJumpEnabled) {
    if (deltaPitch < -22 && pitchJumpCooldown <= 0) {
      // Aceno forte para cima -> Super Pulo direto!
      triggerSuperJump();
      pitchJumpCooldown = 25;
    } else if (deltaPitch < -14 && pitchJumpCooldown <= 0) {
      triggerJump();
      pitchJumpCooldown = 25; // cooldown de ~0.4s
    }
  }
  if (pitchJumpCooldown > 0) {
    pitchJumpCooldown--;
  }
}

// --- Suporte a Gamepad Bluetooth (Controle do VR Box) -------------------------
function pollGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  gamepadLeft = false;
  gamepadRight = false;

  for (const gp of gamepads) {
    if (!gp) continue;

    const axisX = gp.axes[0] || 0;
    const dpadL = gp.buttons[14] && gp.buttons[14].pressed;
    const dpadR = gp.buttons[15] && gp.buttons[15].pressed;

    if (axisX < -0.3 || dpadL) gamepadLeft = true;
    if (axisX > 0.3 || dpadR) gamepadRight = true;

    // Botões de ação do gamepad
    const btnSuper = gp.buttons.some((b, idx) => [2, 3, 5, 7].includes(idx) && b.pressed); // X, Y, RB, RT
    const btnJump = gp.buttons.some((b, idx) => [0, 1, 4, 12].includes(idx) && b.pressed);  // A, B, LB, DpadUp

    if (btnSuper) {
      if (!gamepadJumpPressed) {
        if (state !== 'playing' && vrMode) {
          restartOrStartGame();
        } else {
          triggerSuperJump();
        }
      }
      gamepadJumpPressed = true;
    } else if (btnJump) {
      if (!gamepadJumpPressed) {
        if (state !== 'playing' && vrMode) {
          restartOrStartGame();
        } else {
          triggerJump();
        }
      }
      gamepadJumpPressed = true;
    } else {
      gamepadJumpPressed = false;
    }

    // Botão Start
    const btnStart = gp.buttons[9] && gp.buttons[9].pressed;
    if (btnStart && state !== 'playing') {
      restartOrStartGame();
    }
  }
}

// --- Toques na tela (Gatilho do Cardboard / Toque do VR Box) ------------------
window.addEventListener('touchstart', e => {
  if (vrMode) {
    // 3 dedos na tela = Sair do VR imediatamente
    if (e.touches && e.touches.length >= 3) {
      exitVR();
      return;
    }

    const target = e.target;
    if (target && target.closest && (target.closest('#vr-hud-bar') || target.closest('#vr-settings-modal'))) {
      return;
    }
    e.preventDefault();

    if (state !== 'playing') {
      restartOrStartGame();
      return;
    }

    triggerJump();
  }
}, { passive: false });

// --- Física e Colisões --------------------------------------------------------
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isOverlappingSolid(x, y) {
  for (let p of pipes) {
    if (rectOverlap(x, y, mario.w, mario.h, p.x, p.y, p.w, p.h)) return true;
  }
  for (let p of platforms) {
    if (rectOverlap(x, y, mario.w, mario.h, p.x, p.y, p.w, p.h)) return true;
  }
  return false;
}

function updateMario() {
  if (mario.dead) {
    mario.deadTimer++;
    if (mario.deadTimer < 20) {
      mario.vy = -8;
    }
    mario.vy += GRAVITY;
    mario.y  += mario.vy;
    if (mario.y > GAME_H + 100) {
      lives--;
      if (lives <= 0) {
        endGame('gameover');
      } else {
        if (livesEl) livesEl.textContent = lives;
        initGame();
        state = 'playing';
        startTimer();
      }
    }
    return;
  }

  if (mario.invincible > 0) mario.invincible--;

  const speed = 3.5;
  if (isLeft()) {
    mario.vx = -speed;
    mario.dir = -1;
    mario.walking = true;
  } else if (isRight()) {
    mario.vx = speed;
    mario.dir = 1;
    mario.walking = true;
  } else {
    mario.vx = 0;
    mario.walking = false;
  }

  mario.x += mario.vx;

  if (mario.x < 0) mario.x = 0;
  if (mario.x + mario.w > WORLD_W) mario.x = WORLD_W - mario.w;

  mario.vy += GRAVITY;
  mario.y  += mario.vy;
  mario.onGround = false;

  if (mario.y < 0) {
    mario.y = 0;
    if (mario.vy < 0) mario.vy = 0;
  }

  const mx1 = mario.x, mx2 = mario.x + mario.w;
  const groundTileLeft  = Math.floor(mx1 / TILE);
  const groundTileRight = Math.floor((mx2 - 1) / TILE);

  const feetY = mario.y + mario.h;
  if (mario.vy >= 0) {
    let onGround = false;
    for (let tx = groundTileLeft; tx <= groundTileRight; tx++) {
      if (!isGap(tx * TILE)) {
        onGround = true;
        break;
      }
    }
    if (onGround && feetY >= GROUND_Y && mario.y < GROUND_Y) {
      mario.y = GROUND_Y - mario.h;
      mario.vy = 0;
      mario.onGround = true;
    }
  }

  if (mario.y > GAME_H + 50 && !mario.dead) {
    killMario();
    return;
  }

  for (let p of platforms) {
    if (!rectOverlap(mario.x, mario.y, mario.w, mario.h, p.x, p.y, p.w, p.h)) continue;

    const overlapLeft   = (mario.x + mario.w) - p.x;
    const overlapRight  = (p.x + p.w) - mario.x;
    const overlapTop    = (mario.y + mario.h) - p.y;
    const overlapBottom = (p.y + p.h) - mario.y;

    const minH = Math.min(overlapLeft, overlapRight);
    const minV = Math.min(overlapTop, overlapBottom);

    if (minV < minH) {
      if (overlapTop < overlapBottom) {
        mario.y = p.y - mario.h;
        mario.vy = 0;
        mario.onGround = true;
      } else {
        mario.y = p.y + p.h;
        mario.vy = 0;
        hitBlock(p);
      }
    } else {
      if (overlapLeft < overlapRight) mario.x = p.x - mario.w;
      else mario.x = p.x + p.w;
      mario.vx = 0;
    }
  }

  for (let p of pipes) {
    if (!rectOverlap(mario.x, mario.y, mario.w, mario.h, p.x, p.y, p.w, p.h)) continue;

    const overlapLeft   = (mario.x + mario.w) - p.x;
    const overlapRight  = (p.x + p.w) - mario.x;
    const overlapTop    = (mario.y + mario.h) - p.y;
    const overlapBottom = (p.y + p.h) - mario.y;

    const minH = Math.min(overlapLeft, overlapRight);
    const minV = Math.min(overlapTop, overlapBottom);

    if (minV < minH) {
      if (overlapTop < overlapBottom) {
        mario.y = p.y - mario.h;
        mario.vy = 0;
        mario.onGround = true;
      } else {
        mario.y = p.y + p.h;
        mario.vy = Math.abs(mario.vy) * 0.3;
      }
    } else {
      if (overlapLeft < overlapRight) mario.x = p.x - mario.w;
      else mario.x = p.x + p.w;
      mario.vx = 0;
    }
  }

  // Super Jump ou Pulo Normal
  if (pendingSuperJump) {
    let safety = 0;
    while (safety++ < 8 && isOverlappingSolid(mario.x, mario.y)) {
      mario.y -= 2;
    }
    mario.vy = -18; // Super Pulo com impulso ampliado para Realidade Virtual
    mario.onGround = false;
    pendingSuperJump = false;
    superFlash = 50;
    spawnParticles(mario.x + mario.w / 2, mario.y + mario.h, '#fff', 24);
    spawnParticles(mario.x + mario.w / 2, mario.y + mario.h, C.qShine, 18);
  } else if (isJump() && mario.onGround) {
    mario.vy = -12.5; // Pulo normal calibrado e mais responsivo
    mario.onGround = false;
  }

  // Coleta de moedas
  for (let c of coins) {
    if (c.collected) continue;
    const dx = (mario.x + mario.w / 2) - c.x;
    const dy = (mario.y + mario.h / 2) - c.y;
    if (Math.abs(dx) < mario.w / 2 + c.r && Math.abs(dy) < mario.h / 2 + c.r) {
      c.collected = true;
      coinCount++;
      addScore(200);
      playSound(sounds.coin);
      if (coinsEl) coinsEl.textContent = coinCount;
      spawnParticles(c.x, c.y, C.coin);
    }
  }

  // Colisão com inimigos (Goombas)
  for (let e of enemies) {
    if (e.dead) continue;
    if (!rectOverlap(mario.x, mario.y, mario.w, mario.h, e.x, e.y, e.w, e.h)) continue;

    const mBottom = mario.y + mario.h;
    const eTop    = e.y;

    if (mario.vy > 0 && mBottom - mario.vy <= eTop + 4) {
      playSound(sounds.stomp);
      e.dead = true;
      e.squished = true;
      e.squishTimer = 30;
      mario.vy = -7;
      addScore(100);
      spawnParticles(e.x + e.w / 2, e.y + e.h / 2, C.goomba.body);
    } else {
      if (mario.invincible <= 0) {
        killMario();
        return;
      }
    }
  }

  // Bandeira final
  if (mario.x >= FLAG_X * TILE) {
    endGame('win');
    return;
  }

  // Animação de caminhada
  if (mario.walking && mario.onGround) {
    mario.frameTimer++;
    if (mario.frameTimer > 6) {
      mario.frame = (mario.frame + 1) % 3;
      mario.frameTimer = 0;
    }
  } else if (!mario.walking) {
    mario.frame = 0;
  }

  // Câmera
  const targetCam = mario.x - CAM_DEADZONE;
  if (targetCam > camX) camX = Math.min(targetCam, WORLD_W - GAME_W);
  if (camX < 0) camX = 0;
}

function hitBlock(p) {
  if (p.hit) return;
  if (p.type === 'question') {
    p.hit = true;
    p.bounce = 8;
    coinCount += p.coinVal;
    playSound(sounds.coin);
    addScore(100 * p.coinVal);
    if (coinsEl) coinsEl.textContent = coinCount;
    spawnParticles(p.x + p.w / 2, p.y, C.coin, 8);
  } else if (p.type === 'brick') {
    p.bounce = 6;
    spawnParticles(p.x + p.w / 2, p.y, C.brick, 4);
  }
}

function killMario() {
  if (mario.dead || mario.invincible > 0) return;
  playSound(sounds.death);
  mario.dead = true;
  mario.deadTimer = 0;
  mario.vy = -12;
  stopTimer();

  setTimeout(() => {
    if (state === 'playing') {
      startMusic();
    }
  }, 4000);
}

function addScore(n) {
  score += n;
  if (scoreEl) scoreEl.textContent = String(score).padStart(6, '0');
}

function updateEnemies() {
  for (let e of enemies) {
    if (e.squished) {
      e.squishTimer--;
      if (e.squishTimer <= 0) e.dead = true;
      continue;
    }
    if (e.dead) continue;

    e.x += e.vx;

    const eTileLeft  = Math.floor(e.x / TILE);
    const eTileRight = Math.floor((e.x + e.w - 1) / TILE);
    const aheadTile  = e.vx < 0 ? eTileLeft - 1 : eTileRight + 1;

    if (isGap(aheadTile * TILE) || e.x <= 0 || e.x + e.w >= WORLD_W) {
      e.vx = -e.vx;
    }

    for (let p of pipes) {
      if (rectOverlap(e.x, e.y, e.w, e.h, p.x, p.y, p.w, p.h)) {
        e.vx = -e.vx;
        e.x += e.vx * 2;
        break;
      }
    }

    e.y = GROUND_Y - e.h;

    e.frameTimer++;
    if (e.frameTimer > 10) {
      e.frame = (e.frame + 1) % 2;
      e.frameTimer = 0;
    }
  }
}

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    if (state !== 'playing') return;
    timeLeft--;
    if (timerEl) timerEl.textContent = timeLeft;
    if (timeLeft <= 0) killMario();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function endGame(result) {
  state = result;
  stopTimer();
  if (result === 'win') {
    stopMusic();
    playSound(sounds.win);
    addScore(timeLeft * 50);
    if (!vrMode) {
      showOverlay('VOCÊ VENCEU!', `Pontos: ${score}\nMoedas: ${coinCount}`, 'JOGAR NOVAMENTE');
    }
  } else {
    lives = 3;
    if (!vrMode) {
      showOverlay('GAME OVER', `Pontuação Final: ${score}`, 'TENTAR NOVAMENTE');
    }
  }
}

function showOverlay(title, msg, btn) {
  overlayTitle.textContent = title;
  overlayMsg.innerHTML = msg.replace(/\n/g, '<br>');
  overlayBtn.textContent = btn;
  overlay.classList.remove('hidden');
}

function restartOrStartGame() {
  if (overlay) overlay.classList.add('hidden');
  startMusic();
  lives = 3;
  initGame();
  state = 'playing';
  startTimer();
}

// --- Funções de Renderização dos Sprites e Cenários ---------------------------
function drawBackground(cx) {
  ctx.fillStyle = C.sky;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // Colinas ao fundo
  ctx.fillStyle = C.hill;
  for (let h of hillDefs) {
    const hx = h.x * TILE - cx;
    if (hx < -h.r * 2 || hx > GAME_W + h.r * 2) continue;
    ctx.beginPath();
    ctx.arc(hx, GROUND_Y, h.r, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx - h.r * 0.6, GROUND_Y, h.r * 0.5, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx + h.r * 0.7, GROUND_Y, h.r * 0.45, Math.PI, 0);
    ctx.fill();
  }

  // Nuvens
  ctx.fillStyle = C.cloud;
  for (let cl of cloudDefs) {
    const cldx = cl.x * TILE - cx * 0.5;
    const cldy = cl.y * TILE;
    if (cldx < -120 || cldx > GAME_W + 120) continue;
    drawCloud(cldx, cldy);
  }
}

function drawCloud(x, y) {
  ctx.beginPath();
  ctx.arc(x,       y, 20, Math.PI, 0);
  ctx.arc(x + 20,  y - 12, 26, Math.PI, 0);
  ctx.arc(x + 50,  y, 20, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
}

function drawGround(cx) {
  for (let tx = Math.floor(cx / TILE); tx <= Math.floor((cx + GAME_W) / TILE) + 1; tx++) {
    if (isGap(tx * TILE)) continue;
    const sx = tx * TILE - cx;
    ctx.fillStyle = C.groundTop;
    ctx.fillRect(sx, GROUND_Y, TILE, 6);
    ctx.fillStyle = C.ground;
    ctx.fillRect(sx, GROUND_Y + 6, TILE, TILE - 6);
    ctx.strokeStyle = '#a03808';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, GROUND_Y, TILE, TILE);
  }
}

function drawPlatform(p, cx) {
  const sx = p.x - cx;
  const sy = p.y + p.bounce;
  if (sx + p.w < 0 || sx > GAME_W) return;

  if (p.type === 'brick') {
    ctx.fillStyle = p.hit ? '#888' : C.brick;
    ctx.fillRect(sx, sy, p.w, p.h);
    ctx.fillStyle = p.hit ? '#aaa' : C.brickTop;
    ctx.fillRect(sx, sy, p.w, 4);
    ctx.strokeStyle = '#7b2808';
    ctx.lineWidth = 1;
    for (let i = 0; i < p.w / TILE; i++) {
      ctx.strokeRect(sx + i * TILE, sy, TILE, TILE);
      ctx.fillStyle = '#a03808';
      ctx.fillRect(sx + i * TILE + TILE / 2, sy + TILE / 2, TILE / 2, 4);
    }
  } else if (p.type === 'question') {
    if (p.hit) {
      ctx.fillStyle = '#888';
      ctx.fillRect(sx, sy, p.w, p.h);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(sx, sy, p.w, 4);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, p.w, p.h);
    } else {
      ctx.fillStyle = C.question;
      ctx.fillRect(sx, sy, p.w, p.h);
      ctx.fillStyle = C.qShine;
      ctx.fillRect(sx + 2, sy + 2, p.w - 4, 4);
      ctx.strokeStyle = '#b06000';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, p.w, p.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', sx + p.w / 2, sy + p.h - 7);
    }
  }
  if (p.bounce > 0) p.bounce = Math.max(0, p.bounce - 1.5);
}

function drawPipe(p, cx) {
  const sx = p.x - cx;
  if (sx + p.w < 0 || sx > GAME_W) return;

  ctx.fillStyle = C.pipe.body;
  ctx.fillRect(sx + 4, p.y + TILE, p.w - 8, p.h - TILE);
  ctx.fillStyle = C.pipe.dark;
  ctx.fillRect(sx + 4, p.y + TILE, 6, p.h - TILE);
  ctx.fillStyle = C.pipe.rim;
  ctx.fillRect(sx, p.y, p.w, TILE);
  ctx.fillStyle = C.pipe.body;
  ctx.fillRect(sx + 2, p.y + 2, p.w - 4, TILE - 4);
  ctx.fillStyle = C.pipe.rim;
  ctx.fillRect(sx + 6, p.y + 6, 6, TILE - 8);
}

function drawCoin(c, cx) {
  if (c.collected) return;
  const sx = c.x - cx;
  if (sx < -20 || sx > GAME_W + 20) return;
  c.anim = (c.anim + 0.08) % (Math.PI * 2);
  const scaleX = Math.abs(Math.cos(c.anim));
  ctx.save();
  ctx.translate(sx, c.y);
  ctx.scale(scaleX, 1);
  ctx.fillStyle = C.coin;
  ctx.beginPath();
  ctx.arc(0, 0, c.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.coinRim;
  ctx.beginPath();
  ctx.arc(0, 0, c.r - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.coin;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('$', 0, 3);
  ctx.restore();
}

function drawGoomba(e, cx) {
  if (e.dead && !e.squished) return;
  const sx = e.x - cx;
  if (sx + e.w < -20 || sx > GAME_W + 20) return;

  ctx.save();
  ctx.translate(sx + e.w / 2, e.y + e.h);

  if (e.squished) {
    ctx.fillStyle = C.goomba.body;
    ctx.fillRect(-e.w / 2, -6, e.w, 6);
    ctx.restore();
    return;
  }

  const walk = e.frame === 0 ? 2 : -2;

  ctx.fillStyle = C.goomba.body;
  ctx.beginPath();
  ctx.arc(0, -e.h * 0.55, e.w * 0.45, Math.PI, 0);
  ctx.fillRect(-e.w / 2, -e.h * 0.55, e.w, e.h * 0.55);
  ctx.fill();

  ctx.fillStyle = C.goomba.dark;
  ctx.fillRect(-e.w / 2 + walk, -8, 10, 8);
  ctx.fillRect(e.w / 2 - 10 - walk, -8, 10, 8);

  ctx.fillStyle = C.goomba.eye;
  ctx.fillRect(-10, -e.h * 0.7, 9, 8);
  ctx.fillRect(1, -e.h * 0.7, 9, 8);
  ctx.fillStyle = C.goomba.pupil;
  ctx.fillRect(-8, -e.h * 0.65, 5, 5);
  ctx.fillRect(3, -e.h * 0.65, 5, 5);

  ctx.strokeStyle = C.goomba.dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-12, -e.h * 0.75);
  ctx.lineTo(-1, -e.h * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, -e.h * 0.68);
  ctx.lineTo(12, -e.h * 0.75);
  ctx.stroke();

  ctx.restore();
}

function drawMario(cx) {
  const sx = mario.x - cx;
  const sy = mario.y;
  const dir = mario.dir;

  if (mario.dead) {
    ctx.save();
    ctx.translate(sx + mario.w / 2, sy + mario.h / 2);
    ctx.rotate(mario.deadTimer * 0.15);
    drawMarioSprite(0, 0, 1, 0);
    ctx.restore();
    return;
  }

  if (mario.invincible > 0 && Math.floor(mario.invincible / 3) % 2 === 0) return;

  ctx.save();
  ctx.translate(sx + mario.w / 2, sy + mario.h);
  ctx.scale(dir, 1);
  drawMarioSprite(0, 0, mario.frame, mario.onGround ? 0 : 1);
  ctx.restore();
}

function drawMarioSprite(ox, oy, frame, airborne) {
  ctx.fillStyle = C.mario.hat;
  ctx.fillRect(ox - 10, oy - 32, 20, 6);
  ctx.fillRect(ox - 7,  oy - 38, 16, 8);

  ctx.fillStyle = C.mario.skin;
  ctx.fillRect(ox - 8, oy - 26, 16, 10);

  ctx.fillStyle = '#000';
  ctx.fillRect(ox + 1, oy - 24, 4, 3);

  ctx.fillStyle = C.mario.shoes;
  ctx.fillRect(ox - 8, oy - 18, 6, 3);
  ctx.fillRect(ox,     oy - 18, 6, 3);

  ctx.fillStyle = C.mario.overalls;
  ctx.fillRect(ox - 10, oy - 18, 20, 14);

  ctx.fillStyle = C.mario.skin;
  ctx.fillRect(ox - 6, oy - 16, 4, 4);
  ctx.fillRect(ox + 2, oy - 16, 4, 4);

  const legOff = airborne ? [0, 0] : frame === 1 ? [-4, 4] : frame === 2 ? [4, -4] : [0, 0];
  ctx.fillStyle = C.mario.overalls;
  ctx.fillRect(ox - 10, oy - 4 + legOff[0], 8, 8);
  ctx.fillRect(ox + 2,  oy - 4 + legOff[1], 8, 8);

  ctx.fillStyle = C.mario.shoes;
  ctx.fillRect(ox - 12, oy + 2 + legOff[0], 12, 6);
  ctx.fillRect(ox + 1,  oy + 2 + legOff[1], 12, 6);

  ctx.fillStyle = C.mario.skin;
  const armY = airborne ? -22 : -16;
  ctx.fillRect(ox - 16, oy + armY, 6, 10);
  ctx.fillRect(ox + 10, oy + armY, 6, 10);
}

function drawFlag(cx) {
  const sx = FLAG_X * TILE - cx;
  if (sx < -TILE || sx > GAME_W + TILE) return;

  const poleH = 10 * TILE;
  const poleX = sx + TILE;

  ctx.fillStyle = C.flag.pole;
  ctx.fillRect(poleX, GROUND_Y - poleH, 6, poleH);

  ctx.fillStyle = C.flag.flag;
  ctx.beginPath();
  ctx.moveTo(poleX + 6, GROUND_Y - poleH);
  ctx.lineTo(poleX + 6 + 40, GROUND_Y - poleH + 20);
  ctx.lineTo(poleX + 6, GROUND_Y - poleH + 40);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = C.flag.pole;
  ctx.beginPath();
  ctx.arc(poleX + 3, GROUND_Y - poleH, 6, 0, Math.PI * 2);
  ctx.fill();
}

// --- HUD em Canvas para Óculos VR --------------------------------------------
function drawCanvasHUD(c, viewW, viewH) {
  c.save();
  c.fillStyle = 'rgba(0, 0, 0, 0.75)';
  c.fillRect(0, 0, viewW, 30);

  c.fillStyle = '#ffffff';
  c.font = 'bold 13px "Courier New", monospace';
  c.textAlign = 'left';

  c.fillText('MARIO', 16, 20);
  c.fillText(String(score).padStart(6, '0'), 70, 20);

  c.fillStyle = '#f8c800';
  c.fillText('★', 170, 20);
  c.fillStyle = '#ffffff';
  c.fillText(String(lives), 186, 20);

  c.fillText(`MOEDAS: ${coinCount}`, 240, 20);
  c.fillText('MUNDO 1-1', 430, 20);
  c.fillText(`TEMPO: ${timeLeft}`, 640, 20);

  c.restore();
}

// --- Overlay em Canvas no VR (Início / Game Over / Vitória) -------------------
function drawVROverlay(c, viewW, viewH) {
  c.save();
  c.fillStyle = 'rgba(0, 0, 0, 0.82)';
  c.fillRect(0, 0, viewW, viewH);

  c.textAlign = 'center';
  const midX = viewW / 2;

  if (state === 'title') {
    c.fillStyle = '#e52521';
    c.font = 'bold 32px "Courier New", monospace';
    c.shadowColor = '#000';
    c.shadowOffsetX = 3;
    c.shadowOffsetY = 3;
    c.fillText('SUPER MARIO VR', midX, 130);

    c.shadowColor = 'transparent';
    c.fillStyle = '#ffffff';
    c.font = 'bold 15px "Courier New", monospace';
    c.fillText('Incline a cabeça para andar (Esq / Dir)', midX, 190);
    c.fillText('Toque na tela para pular', midX, 220);
    c.fillText('Toque duplo para SUPER SALTO', midX, 250);

    const blink = Math.floor(Date.now() / 400) % 2 === 0;
    c.fillStyle = blink ? '#f8c800' : '#ffffff';
    c.font = 'bold 18px "Courier New", monospace';
    c.fillText('▶ TOQUE NA TELA PARA INICIAR ◀', midX, 330);
  } else if (state === 'gameover') {
    c.fillStyle = '#e52521';
    c.font = 'bold 36px "Courier New", monospace';
    c.fillText('GAME OVER', midX, 160);

    c.fillStyle = '#ffffff';
    c.font = 'bold 18px "Courier New", monospace';
    c.fillText(`Pontuação Final: ${score}`, midX, 220);

    const blink = Math.floor(Date.now() / 400) % 2 === 0;
    c.fillStyle = blink ? '#f8c800' : '#ffffff';
    c.font = 'bold 17px "Courier New", monospace';
    c.fillText('▶ TOQUE PARA JOGAR NOVAMENTE ◀', midX, 310);
  } else if (state === 'win') {
    c.fillStyle = '#00d800';
    c.font = 'bold 36px "Courier New", monospace';
    c.fillText('VOCÊ VENCEU!', midX, 150);

    c.fillStyle = '#ffffff';
    c.font = 'bold 18px "Courier New", monospace';
    c.fillText(`Pontuação: ${score}  |  Moedas: ${coinCount}`, midX, 220);

    const blink = Math.floor(Date.now() / 400) % 2 === 0;
    c.fillStyle = blink ? '#f8c800' : '#ffffff';
    c.font = 'bold 17px "Courier New", monospace';
    c.fillText('▶ TOQUE PARA JOGAR NOVAMENTE ◀', midX, 320);
  }

  c.restore();
}

// --- Renderização da Cena com Paralaxe Estereoscópica 3D ----------------------
function renderScene(targetCtx, baseCamX, eye) {
  const isLeft = eye === 'left';
  const isRight = eye === 'right';
  const isStereo = isLeft || isRight;
  const stereoSign = isLeft ? -1 : (isRight ? 1 : 0);
  const stereoDepth = (isStereo && vrSettings.depth3D) ? vrSettings.depth3D : 0;

  // Profundidade 3D Estereoscópica:
  // - Céu e nuvens: paralaxe reversa -> profundidade distante atrás da tela
  // - Chão e canos: plano de convergência neutro
  // - Mario, moedas e inimigos: paralaxe para a frente -> efeito 3D pop-out!
  const bgCamX    = baseCamX - stereoSign * (stereoDepth * 0.8);
  const worldCamX = baseCamX;
  const marioCamX = baseCamX + stereoSign * (stereoDepth * 0.9);
  const enemyCamX = baseCamX + stereoSign * (stereoDepth * 0.6);
  const coinCamX  = baseCamX + stereoSign * (stereoDepth * 0.5);
  const partCamX  = baseCamX + stereoSign * (stereoDepth * 0.8);

  targetCtx.clearRect(0, 0, GAME_W, GAME_H);

  drawBackground(bgCamX);
  drawGround(worldCamX);
  for (let p of pipes)     drawPipe(p, worldCamX);
  for (let p of platforms) drawPlatform(p, worldCamX);
  for (let c of coins)     drawCoin(c, coinCamX);
  for (let e of enemies)   drawGoomba(e, enemyCamX);
  drawFlag(worldCamX);
  drawMario(marioCamX);
  drawParticles(partCamX);

  if (vrMode) {
    drawCanvasHUD(targetCtx, GAME_W, GAME_H);
  }

  // Flash "SUPER JUMP!"
  if (superFlash > 0) {
    targetCtx.save();
    targetCtx.globalAlpha = Math.min(1, superFlash / 20);
    targetCtx.fillStyle = '#fff';
    targetCtx.strokeStyle = '#e52521';
    targetCtx.lineWidth = 4;
    targetCtx.font = 'bold 36px monospace';
    targetCtx.textAlign = 'center';
    const fy = GAME_H / 2 - (45 - superFlash) * 2;
    targetCtx.strokeText('SUPER JUMP!', GAME_W / 2, fy);
    targetCtx.fillText('SUPER JUMP!',   GAME_W / 2, fy);
    targetCtx.restore();
  }

  if (vrMode && state !== 'playing') {
    drawVROverlay(targetCtx, GAME_W, GAME_H);
  }
}

// --- Elementos Gráficos Exclusivos do Óculos VR --------------------------------
function drawVRDividers(c, width, height, eyeW) {
  // Divisória central preta física
  c.fillStyle = '#000000';
  c.fillRect(eyeW - 4, 0, 8, height);

  // Marcadores de alinhamento ótico do Cardboard / VR Box
  c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(eyeW, 0);
  c.lineTo(eyeW, 22);
  c.moveTo(eyeW, height);
  c.lineTo(eyeW, height - 22);
  c.stroke();
}

function drawVRVignette(c, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radius = Math.min(w, h) * 0.6;
  const grad = c.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
  c.fillStyle = grad;
  c.fillRect(x, y, w, h);
}

function drawVRGyroIndicator(c, cx, cy) {
  const deltaRoll = currentRoll - neutralRoll;
  const deadzone = vrSettings.deadzone;

  // Linha guia
  c.fillStyle = 'rgba(255, 255, 255, 0.2)';
  c.fillRect(cx - 30, cy - 2, 60, 4);

  // Marcações de zona morta
  c.fillStyle = 'rgba(255, 255, 255, 0.4)';
  c.fillRect(cx - 10, cy - 4, 2, 8);
  c.fillRect(cx + 10, cy - 4, 2, 8);

  // Bolha de inclinação
  const bubbleX = Math.max(-28, Math.min(28, deltaRoll * 2.5));
  const isWalking = Math.abs(deltaRoll) > deadzone;
  c.fillStyle = isWalking ? '#00e521' : '#f8c800';
  c.beginPath();
  c.arc(cx + bubbleX, cy, 4, 0, Math.PI * 2);
  c.fill();
}

// --- Loop Principal -----------------------------------------------------------
let lastTime = 0;
function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  pollGamepad();

  if (vrMode) {
    updateVRInputs();
  }

  if (state === 'playing') {
    updateMario();
    updateEnemies();
    updateParticles();
  }

  if (superFlash > 0 && state === 'playing') {
    superFlash--;
  }

  if (!vrMode) {
    // --- Modo 2D Tradicional ---
    ctx = mainCtx;
    renderScene(mainCtx, camX, 'mono');
  } else {
    // --- Modo Óculos VR: Estereoscopia SBS (Side-by-Side) ---
    if (mainCanvas.width !== window.innerWidth || mainCanvas.height !== window.innerHeight) {
      mainCanvas.width = window.innerWidth;
      mainCanvas.height = window.innerHeight;
    }

    mainCtx.fillStyle = '#000000';
    mainCtx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    const eyeW = mainCanvas.width / 2;
    const eyeH = mainCanvas.height;

    // Escalar 800x464 para caber na metade de cada olho
    const scale = Math.min((eyeW * 0.95) / GAME_W, (eyeH * 0.92) / GAME_H);
    const dw = GAME_W * scale;
    const dh = GAME_H * scale;
    const dy = (eyeH - dh) / 2;

    // Olho Esquerdo (Left Eye)
    ctx = offCtx;
    renderScene(offCtx, camX, 'left');
    const dxLeft = (eyeW - dw) / 2 + vrSettings.ipdOffset;
    mainCtx.drawImage(offCanvas, dxLeft, dy, dw, dh);

    // Olho Direito (Right Eye)
    renderScene(offCtx, camX, 'right');
    const dxRight = eyeW + (eyeW - dw) / 2 - vrSettings.ipdOffset;
    mainCtx.drawImage(offCanvas, dxRight, dy, dw, dh);

    // Divisória central e miras óticas do óculos
    drawVRDividers(mainCtx, mainCanvas.width, mainCanvas.height, eyeW);

    // Efeito de vinheta de lentes VR
    if (vrSettings.vignette) {
      drawVRVignette(mainCtx, 0, 0, eyeW, eyeH);
      drawVRVignette(mainCtx, eyeW, 0, eyeW, eyeH);
    }

    // Guia visual de inclinação da cabeça (bolha de nível)
    if (vrSettings.gyroSensitivity > 0 && gyroAvailable) {
      drawVRGyroIndicator(mainCtx, eyeW / 2, eyeH - 24);
      drawVRGyroIndicator(mainCtx, eyeW + eyeW / 2, eyeH - 24);
    }
  }

  requestAnimationFrame(loop);
}

// --- Funções de Entrada e Saída do Modo VR ------------------------------------
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
        return true;
      }
    } catch (err) {
      console.warn('Erro na permissão de orientação:', err);
    }
    return false;
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
    return true;
  }
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake Lock não suportado:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    try { wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
}

async function enterVR() {
  await requestOrientationPermission();

  // Tela cheia
  const el = document.documentElement;
  const reqFS = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (reqFS) {
    reqFS.call(el).catch(() => {});
  }

  // Trava em paisagem
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }

  await requestWakeLock();

  vrMode = true;
  document.body.classList.add('vr-mode');
  overlay.classList.add('hidden');
  touchControls.classList.add('hidden');
  vrHudBar.classList.remove('hidden');

  // Contagem regressiva para encaixar o celular no óculos
  vrCountdown.classList.remove('hidden');
  let count = 3;
  const leftNum = document.getElementById('countdown-num-left');
  const rightNum = document.getElementById('countdown-num-right');
  leftNum.textContent = count;
  rightNum.textContent = count;

  const countTimer = setInterval(() => {
    count--;
    if (count > 0) {
      leftNum.textContent = count;
      rightNum.textContent = count;
    } else {
      clearInterval(countTimer);
      vrCountdown.classList.add('hidden');
      calibrateGyro();
      restartOrStartGame();
    }
  }, 1000);
}

function exitVR() {
  vrMode = false;
  document.body.classList.remove('vr-mode');
  vrHudBar.classList.add('hidden');
  vrModal.classList.add('hidden');
  vrCountdown.classList.add('hidden');

  releaseWakeLock();

  if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen().catch(() => {});
  }

  if (screen.orientation && screen.orientation.unlock) {
    screen.orientation.unlock();
  }

  mainCanvas.width = GAME_W;
  mainCanvas.height = GAME_H;

  // Restaurar overlay se não estiver jogando
  if (state !== 'playing') {
    overlay.classList.remove('hidden');
  }

  // Ativar controles de toque se for dispositivo móvel
  checkMobileTouchControls();
}

// --- Controles de Toque para Modo Normal (Mobile) -----------------------------
function checkMobileTouchControls() {
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch && !vrMode) {
    touchControls.classList.remove('hidden');
  } else {
    touchControls.classList.add('hidden');
  }
}

// Configuração dos botões de toque na tela (Modo normal celular)
const btnTouchLeft  = document.getElementById('touch-left');
const btnTouchRight = document.getElementById('touch-right');
const btnTouchJump  = document.getElementById('touch-jump');
const btnTouchSuper = document.getElementById('touch-super');

btnTouchLeft.addEventListener('touchstart',  e => { e.preventDefault(); touchLeft = true; });
btnTouchLeft.addEventListener('touchend',    e => { e.preventDefault(); touchLeft = false; });
btnTouchRight.addEventListener('touchstart', e => { e.preventDefault(); touchRight = true; });
btnTouchRight.addEventListener('touchend',   e => { e.preventDefault(); touchRight = false; });

btnTouchJump.addEventListener('touchstart', e => {
  e.preventDefault();
  triggerJump();
});

btnTouchSuper.addEventListener('touchstart', e => {
  e.preventDefault();
  triggerSuperJump();
});

// --- Botões do Menu e Barra VR ------------------------------------------------
overlayBtn.addEventListener('click', () => {
  restartOrStartGame();
  checkMobileTouchControls();
});

overlayBtnVR.addEventListener('click', () => {
  enterVR();
});

document.getElementById('btn-vr-recenter').addEventListener('click', () => {
  calibrateGyro();
});

document.getElementById('btn-vr-settings').addEventListener('click', () => {
  vrModal.classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  vrModal.classList.add('hidden');
});

document.getElementById('btn-vr-exit').addEventListener('click', () => {
  exitVR();
});

// Configurações do Modal VR
function setupOptionGroup(containerId, callback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const buttons = container.querySelectorAll('.opt-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callback(btn.getAttribute('data-val'));
    });
  });
}

setupOptionGroup('opt-3d-depth', val => {
  vrSettings.depth3D = parseInt(val, 10);
});

setupOptionGroup('opt-gyro-sens', val => {
  const sens = parseInt(val, 10);
  vrSettings.gyroSensitivity = sens;
  vrSettings.deadzone = sens;
});

setupOptionGroup('opt-nod-jump', val => {
  vrSettings.nodJumpEnabled = val === 'true';
});

setupOptionGroup('opt-vignette', val => {
  vrSettings.vignette = val === 'true';
});

// --- Detecção Inicial ---------------------------------------------------------
checkMobileTouchControls();
window.addEventListener('resize', checkMobileTouchControls);

initGame();
requestAnimationFrame(loop);
