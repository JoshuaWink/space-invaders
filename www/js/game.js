// game.js — Space Invaders Emulator Orchestrator
// Wires WASM machine + CUP pipeline + game loop + ROM loading.

import { Payload, Pipeline } from './cup-pipe.js';
import { LoadRom, loadCachedRom } from './filters/load_rom.js';
import { ReadInput, InputState } from './filters/read_input.js';
import { ExecuteFrame } from './filters/execute_frame.js';
import { RenderFrame } from './filters/render_frame.js';
import { UpdateAudio } from './filters/update_audio.js';
import { initHeatmap, updateHeatmap, toggleHeatmap } from './heatmap.js';
import { VirtualJoystick } from './joystick.js';

// ── State ──────────────────────────────────────────────────────

let machine = null;      // WasmMachine instance
let audioCtx = null;     // Web Audio context (created on user gesture)
let inputState = null;   // Keyboard/touch tracker
let muted = false;
let paused = false;
let running = false;
let frameId = null;
let lastRom = null;
let lastRomName = 'unknown';

// FPS tracking
let frameCount = 0;
let lastFpsTime = 0;

const HOME_BREW_SCORE_LO = 0x200E;
const HOME_BREW_SCORE_HI = 0x200F;
const HOME_BREW_LIVES = 0x200C;
const HOME_BREW_STATE = 0x200D;
const HOME_BREW_UFO = 0x2017;

// ── Pipelines ──────────────────────────────────────────────────

// Init pipeline: Load ROM → feed into WASM machine
const initPipeline = new Pipeline()
  .addFilter(new LoadRom(), 'load_rom');

// Frame pipeline: ReadInput → Execute → Render → Audio
const framePipeline = new Pipeline()
  .addFilter(new ReadInput(), 'read_input')
  .addFilter(new ExecuteFrame(), 'execute_frame')
  .addFilter(new RenderFrame(), 'render_frame')
  .addFilter(new UpdateAudio(), 'update_audio')
  .observe({ timing: true });

// ── WASM Loading ───────────────────────────────────────────────

async function initWasm() {
  try {
    const wasm = await import('../wasm/space_invaders_emu.js');
    await wasm.default();
    return wasm;
  } catch (err) {
    console.error('WASM load failed:', err);
    showStatus('Failed to load WASM module. Run build.sh first.', true);
    return null;
  }
}

// ── Screen Management ──────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function showStatus(msg, isError = false) {
  const el = document.getElementById('rom-status');
  el.textContent = msg;
  el.className = `rom-status ${isError ? 'error' : 'success'}`;
  el.classList.remove('hidden');
}

function homebrewSpeedMultiplier() {
  return 1;
}

function updateHud(machine, romName) {
  const scoreEl = document.getElementById('hud-score');
  const livesEl = document.getElementById('hud-lives');
  const statusEl = document.getElementById('hud-status');

  if (!scoreEl || !livesEl || !statusEl || !machine?.readByte) {
    return;
  }

  if (!/play game|game\.rom|step\s*\d+|step_/i.test(romName)) {
    scoreEl.textContent = 'SCORE ----';
    livesEl.textContent = 'LIVES --';
    statusEl.textContent = 'CUSTOM ROM';
    return;
  }

  const score = machine.readByte(HOME_BREW_SCORE_LO)
    + (machine.readByte(HOME_BREW_SCORE_HI) << 8);
  const lives = machine.readByte(HOME_BREW_LIVES);
  const state = machine.readByte(HOME_BREW_STATE);
  const ufoActive = machine.readByte(HOME_BREW_UFO) !== 0;

  let status = 'PLAYING';
  if (state === 1) status = 'WAVE CLEAR';
  if (state === 2) status = 'GAME OVER';
  if (state === 0 && ufoActive) status = 'UFO PASS';

  scoreEl.textContent = `SCORE ${String(score).padStart(4, '0')}`;
  livesEl.textContent = `LIVES ${lives}`;
  statusEl.textContent = status;
}

// ── ROM Loading ────────────────────────────────────────────────

async function handleRomFiles(files, wasm) {
  try {
    const result = await initPipeline.run(new Payload({ files }));
    const rom = result.get('rom');
    const romName = result.get('romName');

    showStatus(`Loaded: ${romName} (${rom.length} bytes)`);
    startGame(wasm, rom, romName);
  } catch (err) {
    showStatus(err.message, true);
  }
}

async function loadBundledRom(url, romName, wasm) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Could not load ${romName} at ${url}. Run ./build.sh first to generate ROM files.`
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    showStatus(`Loaded: ${romName} (${bytes.length} bytes)`);
    startGame(wasm, bytes, romName);
  } catch (err) {
    showStatus(err.message, true);
  }
}

async function loadCached(wasm) {
  try {
    const cached = await loadCachedRom();
    if (cached) {
      showStatus(`Found cached ROM: ${cached.name}`);
      startGame(wasm, cached.data, cached.name);
      return true;
    }
  } catch (_) {
    // No cached ROM
  }
  return false;
}

// ── Game Loop ──────────────────────────────────────────────────

function startGame(wasm, rom, romName = 'unknown') {
  if (frameId) {
    cancelAnimationFrame(frameId);
  }

  lastRom = rom;
  lastRomName = romName;

  // Create machine and load ROM
  machine = new wasm.WasmMachine();
  machine.loadRom(rom);

  // Init audio on first user gesture
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  // Init input tracking
  if (!inputState) {
    inputState = new InputState();
  }

  // Get canvas context
  const canvas = document.getElementById('game-canvas');
  const ctx2d = canvas.getContext('2d');

  // Switch to game screen
  showScreen('screen-game');
  paused = false;
  running = true;

  // Mount virtual joystick once for the lifetime of the page
  if (!window._joystickMounted) {
    window._joystickMounted = true;
    const joystick = new VirtualJoystick(inputState);
    joystick.mount();
  }

  // Init heat map visualizer
  initHeatmap();

  // Build the frame payload (reused each frame, immutable insert creates new)
  const basePayload = new Payload({
    machine,
    inputState,
    canvas,
    ctx2d,
    audioCtx,
    muted,
    speedMultiplier: homebrewSpeedMultiplier(romName),
  });

  // Start the loop
  lastFpsTime = performance.now();
  frameCount = 0;

  function loop(timestamp) {
    if (!running) return;

    if (!paused) {
      // Update muted state in payload
      const framePayload = basePayload
        .insert('muted', muted)
        .insert('inputState', inputState);

      // Run the CUP frame pipeline synchronously
      // (all filters are sync; Pipeline.run returns a Promise but resolves immediately)
      framePipeline.run(framePayload);
      updateHud(machine, romName);
      updateHeatmap(machine);

      frameCount++;
    }

    // FPS counter
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
      document.getElementById('fps-counter').textContent = `${fps} fps`;
      frameCount = 0;
      lastFpsTime = now;
    }

    frameId = requestAnimationFrame(loop);
  }

  frameId = requestAnimationFrame(loop);
}

function resetGame(wasm) {
  if (frameId) cancelAnimationFrame(frameId);
  running = false;
  if (lastRom) {
    startGame(wasm, lastRom, lastRomName);
    return;
  }

  // Fallback: re-read cached ROM
  loadCachedRom().then(cached => {
    if (cached) startGame(wasm, cached.data, cached.name);
  });
}

// ── HUD Controls ───────────────────────────────────────────────

function bindHud(wasm) {
  document.getElementById('btn-pause')?.addEventListener('click', () => {
    paused = !paused;
    document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
  });

  document.getElementById('btn-mute')?.addEventListener('click', () => {
    muted = !muted;
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    resetGame(wasm);
  });

  document.getElementById('btn-debug')?.addEventListener('click', () => {
    const on = toggleHeatmap();
    document.getElementById('btn-debug').textContent = on ? '🔬' : '🔬';
    document.getElementById('btn-debug').style.borderColor = on ? 'var(--accent)' : '';
  });
}

// ── ROM Drop Zone ──────────────────────────────────────────────

function bindDropZone(wasm) {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('rom-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleRomFiles(e.dataTransfer.files, wasm);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleRomFiles(fileInput.files, wasm);
    }
  });
}

function bindStepButtons(wasm) {
  document.querySelectorAll('[data-step-rom]').forEach((el) => {
    el.addEventListener('click', () => {
      const url = el.getAttribute('data-step-rom');
      if (!url) return;
      loadBundledRom(url, el.textContent?.trim() || 'step-rom', wasm);
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────

async function boot() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Load WASM
  const wasm = await initWasm();
  if (!wasm) return;

  // Bind UI
  bindDropZone(wasm);
  bindHud(wasm);
  bindStepButtons(wasm);

  // Always land on the loader so a freshly built game ROM is visible immediately.
  // If there is a cached ROM, mention it instead of auto-running stale content.
  try {
    const cached = await loadCachedRom();
    if (cached) {
      showStatus(`Ready. Click Play Game or upload a ROM. Cached ROM available: ${cached.name}`);
    } else {
      showStatus('Ready. Click Play Game or upload a ROM.');
    }
  } catch (_) {
    showStatus('Ready. Click Play Game or upload a ROM.');
  }

  showScreen('screen-loader');
}

boot();
