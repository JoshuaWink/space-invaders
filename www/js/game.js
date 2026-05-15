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
let joystick = null;     // Virtual joystick instance (mobile)
let muted = false;
let hapticAudioEnabled = false;
let hapticStrength = 1;
let hapticToneMode = 'arcade';
let paused = false;
let running = false;
let frameId = null;
let lastRom = null;
let lastRomName = 'unknown';
let controllerPanelBound = false;
let refreshControllerPanel = null;
let screenOnlyMode = false;
let settingsModalBound = false;
let deferredInstallPrompt = null;

// FPS tracking
let frameCount = 0;
let lastFpsTime = 0;

const HOME_BREW_SCORE_LO = 0x200E;
const HOME_BREW_SCORE_HI = 0x200F;
const HOME_BREW_LIVES = 0x200C;
const HOME_BREW_STATE = 0x200D;
const HOME_BREW_UFO = 0x2017;
const ORIGINAL_FPS = 60;
const FRAME_MS = 1000 / ORIGINAL_FPS;
const MAX_CATCHUP_STEPS = 5;
const HAPTIC_SETTINGS_STORAGE_KEY = 'si-haptic-settings-v1';
const HAPTIC_MIN_STRENGTH = 0.8;
const HAPTIC_MAX_STRENGTH = 3.0;
const HAPTIC_TONE_MODES = ['arcade', 'high', 'low'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultHapticStrength() {
  if (typeof navigator === 'undefined') return 1;
  return /android/i.test(navigator.userAgent || '') ? 1.6 : 1;
}

function loadHapticSettings() {
  hapticStrength = defaultHapticStrength();
  hapticToneMode = 'arcade';

  try {
    const raw = localStorage.getItem(HAPTIC_SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (typeof parsed.enabled === 'boolean') {
      hapticAudioEnabled = parsed.enabled;
    }
    if (typeof parsed.strength === 'number') {
      hapticStrength = clamp(parsed.strength, HAPTIC_MIN_STRENGTH, HAPTIC_MAX_STRENGTH);
    }
    if (typeof parsed.toneMode === 'string' && HAPTIC_TONE_MODES.includes(parsed.toneMode)) {
      hapticToneMode = parsed.toneMode;
    }
  } catch (_) {
    // Ignore invalid persisted values and continue with defaults.
  }
}

function saveHapticSettings() {
  try {
    localStorage.setItem(HAPTIC_SETTINGS_STORAGE_KEY, JSON.stringify({
      enabled: hapticAudioEnabled,
      strength: hapticStrength,
      toneMode: hapticToneMode,
    }));
  } catch (_) {
    // Ignore private mode/quota failures.
  }
}

function supportsVibration() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function syncHapticAudioButton() {
  const btn = document.getElementById('btn-haptic-audio');
  if (!btn) return;

  const supported = supportsVibration();
  btn.disabled = !supported;
  btn.textContent = hapticAudioEnabled ? '📳' : '📴';
  btn.classList.toggle('is-on', hapticAudioEnabled);
  btn.title = supported
    ? (hapticAudioEnabled ? 'Audio haptics enabled' : 'Audio haptics disabled')
    : 'Vibration not supported on this device/browser';
}

function tryUnlockOrientation() {
  if (typeof screen === 'undefined' || !screen.orientation) return;
  const orientationApi = screen.orientation;
  if (typeof orientationApi.unlock !== 'function') return;

  // Attempt 1: direct unlock (works in some standalone PWA contexts)
  try { orientationApi.unlock(); } catch (_) { /* no-op */ }

  // Attempt 2: enter fullscreen then unlock (Android Chrome requires fullscreen)
  const doc = document.documentElement;
  const requestFs = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
  if (requestFs) {
    const triggerFsUnlock = () => {
      requestFs.call(doc).then(() => {
        try { orientationApi.unlock(); } catch (_) { /* no-op */ }
        // Exit fullscreen after unlocking to keep standalone PWA UX
        const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exitFs) setTimeout(() => exitFs.call(document).catch(() => {}), 120);
      }).catch(() => {});
    };
    // Fullscreen requires user gesture — bind to first interaction if not already interactive
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
      document.addEventListener('pointerdown', triggerFsUnlock, { once: true });
      document.addEventListener('touchstart', triggerFsUnlock, { once: true });
    }
  }
}

function handleOrientationChange() {
  // Give the browser a moment to settle the new viewport dimensions
  setTimeout(() => {
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
      // Force layout recalculation by briefly toggling a class
      canvas.classList.add('orientation-adapting');
      requestAnimationFrame(() => canvas.classList.remove('orientation-adapting'));
    }
    // Re-measure joystick if it exists
    if (typeof window.joystickInstance !== 'undefined' && window.joystickInstance) {
      window.joystickInstance.remeasure();
    }
  }, 150);
}

function isStandalonePwa() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
  }
  return typeof navigator !== 'undefined' && Boolean(navigator.standalone);
}

function isSecureInstallContext() {
  if (typeof window === 'undefined') return true;
  if (window.isSecureContext) return true;

  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function maybeRedirectToHttps() {
  if (typeof window === 'undefined') return false;

  const { protocol, hostname, host, pathname, search, hash } = window.location;
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

  if (protocol === 'http:' && !localHost) {
    window.location.replace(`https://${host}${pathname}${search}${hash}`);
    return true;
  }

  return false;
}

function syncInstallButton() {
  const installBtn = document.getElementById('btn-install');
  const installHint = document.getElementById('pwa-install-hint');
  if (!installBtn || !installHint) return;

  if (isStandalonePwa()) {
    installBtn.disabled = true;
    installBtn.classList.add('is-on');
    installBtn.textContent = 'Installed';
    installHint.textContent = 'Running as installed app.';
    return;
  }

  if (!isSecureInstallContext()) {
    installBtn.disabled = true;
    installBtn.classList.remove('is-on');
    installBtn.textContent = 'Install';
    installHint.textContent = 'Open this page with HTTPS to install as a real app.';
    return;
  }

  installBtn.classList.remove('is-on');
  installBtn.textContent = 'Install';

  if (deferredInstallPrompt) {
    installBtn.disabled = false;
    installHint.textContent = 'Install app for full-screen launch and improved Android haptics.';
    return;
  }

  installBtn.disabled = true;
  installHint.textContent = 'Install prompt not ready. Android Chrome: menu -> Add to Home screen.';
}

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

function setSettingsModalOpen(enabled) {
  const modal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('btn-settings');
  if (!modal) return;

  const open = Boolean(enabled);
  modal.classList.toggle('hidden', !open);
  settingsBtn?.classList.toggle('is-on', open);

  if (!open) {
    inputState?.cancelControllerBinding();
    document.querySelectorAll('#controller-panel .map-btn.binding').forEach((el) => {
      el.classList.remove('binding');
    });
  } else {
    if (refreshControllerPanel) refreshControllerPanel();
  }
}

function setScreenOnlyMode(enabled) {
  const screen = document.getElementById('screen-game');
  const btn = document.getElementById('btn-screen-only');

  if (!screen || !btn) return;

  screenOnlyMode = Boolean(enabled);
  screen.classList.toggle('screen-only', screenOnlyMode);
  btn.textContent = screenOnlyMode ? 'Show UI' : 'Hide UI';
  btn.title = screenOnlyMode ? 'Show HUD and controls' : 'Hide HUD and controls';

  if (screenOnlyMode) {
    setSettingsModalOpen(false);
    inputState?.cancelControllerBinding();
  }
}

function syncScreenOnlyButton() {
  const btn = document.getElementById('btn-screen-only');
  if (!btn) return;
  btn.classList.remove('hidden');
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

  if (!joystick) {
    joystick = new VirtualJoystick(inputState, {
      deadZone: inputState.getControllerDeadzone(),
    });
    joystick.mount();
  }

  bindControllerPanel();

  // Get canvas context
  const canvas = document.getElementById('game-canvas');
  const ctx2d = canvas.getContext('2d');

  // Switch to game screen
  showScreen('screen-game');
  paused = false;
  running = true;
  tryUnlockOrientation();
  syncScreenOnlyButton();

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
    hapticAudioEnabled,
    hapticStrength,
    hapticToneMode,
    speedMultiplier: homebrewSpeedMultiplier(romName),
  });

  // Start the loop
  lastFpsTime = performance.now();
  frameCount = 0;
  let lastTickTime = performance.now();
  let accumulatorMs = 0;

  function loop(timestamp) {
    if (!running) return;

    const delta = Math.min(250, timestamp - lastTickTime);
    lastTickTime = timestamp;

    // Keep controller state current regardless of pause state.
    inputState.pollControllers();
    if (refreshControllerPanel) refreshControllerPanel();

    if (!paused) {
      accumulatorMs += delta;
      let simSteps = 0;

      while (accumulatorMs >= FRAME_MS && simSteps < MAX_CATCHUP_STEPS) {
        const framePayload = basePayload
          .insert('muted', muted)
          .insert('hapticAudioEnabled', hapticAudioEnabled)
          .insert('hapticStrength', hapticStrength)
          .insert('hapticToneMode', hapticToneMode)
          .insert('inputState', inputState);

        // Run one authentic machine frame step (60 Hz target)
        framePipeline.run(framePayload);
        updateHud(machine, romName);
        updateHeatmap(machine);

        frameCount++;
        accumulatorMs -= FRAME_MS;
        simSteps++;
      }

      // If the browser was stalled for too long, drop backlog to keep real-time pace.
      if (simSteps === MAX_CATCHUP_STEPS && accumulatorMs >= FRAME_MS) {
        accumulatorMs = 0;
      }
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

function bindControllerPanel() {
  if (controllerPanelBound || !inputState) return;

  const panel = document.getElementById('controller-panel');
  const statusEl = document.getElementById('controller-status');
  const deadzoneRange = document.getElementById('deadzone-range');
  const deadzoneValue = document.getElementById('deadzone-value');
  const hintEl = document.getElementById('controller-bind-hint');
  const resetBtn = document.getElementById('controller-reset');

  if (!panel || !statusEl || !deadzoneRange || !deadzoneValue || !hintEl || !resetBtn) {
    return;
  }

  controllerPanelBound = true;

  const defaultHint = 'Click an action, then press a button or move an axis.';
  const actionButtons = Array.from(panel.querySelectorAll('[data-bind-action]'));

  const setHint = (msg) => {
    hintEl.textContent = msg || defaultHint;
  };

  const renderBindings = () => {
    actionButtons.forEach((btn) => {
      const action = btn.getAttribute('data-bind-action');
      const label = btn.querySelector('.bind-label');
      if (!action || !label) return;
      label.textContent = inputState.formatControllerBinding(inputState.getControllerBinding(action));
    });
  };

  const renderDeadzone = () => {
    const deadzone = inputState.getControllerDeadzone();
    deadzoneRange.value = deadzone.toFixed(2);
    deadzoneValue.textContent = deadzone.toFixed(2);
  };

  const renderStatus = () => {
    const info = inputState.getControllerInfo();
    statusEl.textContent = info.connected
      ? `Connected: ${info.name}`
      : 'No controller';
  };

  const beginBinding = (action, buttonEl) => {
    actionButtons.forEach((btn) => btn.classList.remove('binding'));
    buttonEl.classList.add('binding');
    setHint(`Waiting for ${action} binding...`);

    inputState.captureNextControllerBinding(action, 9000)
      .then(({ binding }) => {
        buttonEl.classList.remove('binding');
        renderBindings();
        setHint(`Bound ${action} to ${inputState.formatControllerBinding(binding)}.`);
      })
      .catch((err) => {
        buttonEl.classList.remove('binding');
        setHint(err?.message || 'Binding cancelled.');
      });
  };

  deadzoneRange.addEventListener('input', () => {
    const next = Number(deadzoneRange.value);
    inputState.setControllerDeadzone(next);
    if (joystick) joystick.setDeadZone(next);
    deadzoneValue.textContent = next.toFixed(2);
  });

  actionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-bind-action');
      if (!action) return;
      beginBinding(action, btn);
    });
  });

  resetBtn.addEventListener('click', () => {
    inputState.cancelControllerBinding();
    actionButtons.forEach((btn) => btn.classList.remove('binding'));
    inputState.resetControllerMapping();
    renderBindings();
    setHint('Controller mapping reset to defaults.');
  });

  renderBindings();
  renderDeadzone();
  renderStatus();
  setHint(defaultHint);

  refreshControllerPanel = () => {
    renderStatus();
    syncScreenOnlyButton();
  };
}

function bindSettingsModal() {
  if (settingsModalBound) return;

  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('btn-settings');
  const closeBtn = document.getElementById('btn-settings-close');
  if (!modal || !openBtn || !closeBtn) return;

  settingsModalBound = true;

  openBtn.addEventListener('click', () => {
    const shouldOpen = modal.classList.contains('hidden');
    setSettingsModalOpen(shouldOpen);
  });

  closeBtn.addEventListener('click', () => {
    setSettingsModalOpen(false);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      setSettingsModalOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setSettingsModalOpen(false);
    }
  });
}

// ── HUD Controls ───────────────────────────────────────────────

function bindHud(wasm) {
  syncHapticAudioButton();
  bindSettingsModal();

  const hapticRange = document.getElementById('haptic-strength-range');
  const hapticValue = document.getElementById('haptic-strength-value');
  const hapticToneSelect = document.getElementById('haptic-tone-select');
  const installBtn = document.getElementById('btn-install');

  const syncHapticSettingsUi = () => {
    const supported = supportsVibration();

    if (hapticRange && hapticValue) {
      hapticRange.value = hapticStrength.toFixed(2);
      hapticValue.textContent = `${hapticStrength.toFixed(2)}x`;
      hapticRange.disabled = !supported;
      hapticRange.title = supported
        ? 'Increase vibration intensity'
        : 'Vibration not supported on this device/browser';
    }

    if (hapticToneSelect) {
      hapticToneSelect.value = hapticToneMode;
      hapticToneSelect.disabled = !supported;
      hapticToneSelect.title = supported
        ? 'Choose frequency-like haptic cadence'
        : 'Vibration not supported on this device/browser';
    }
  };

  if (hapticRange) {
    hapticRange.addEventListener('input', () => {
      hapticStrength = clamp(Number(hapticRange.value) || 1, HAPTIC_MIN_STRENGTH, HAPTIC_MAX_STRENGTH);
      if (hapticValue) {
        hapticValue.textContent = `${hapticStrength.toFixed(2)}x`;
      }
      saveHapticSettings();
    });
  }

  if (hapticToneSelect) {
    hapticToneSelect.addEventListener('change', () => {
      const nextMode = hapticToneSelect.value;
      if (!HAPTIC_TONE_MODES.includes(nextMode)) return;
      hapticToneMode = nextMode;
      saveHapticSettings();
    });
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!isSecureInstallContext()) {
        maybeRedirectToHttps();
        syncInstallButton();
        return;
      }

      if (!deferredInstallPrompt) {
        syncInstallButton();
        return;
      }

      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      promptEvent.prompt();
      try {
        await promptEvent.userChoice;
      } catch (_) {
        // Ignore cancelled prompt.
      }

      syncInstallButton();
    });
  }

  syncHapticSettingsUi();
  syncInstallButton();

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    paused = !paused;
    document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
  });

  document.getElementById('btn-mute')?.addEventListener('click', () => {
    muted = !muted;
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  document.getElementById('btn-haptic-audio')?.addEventListener('click', () => {
    if (!supportsVibration()) {
      syncHapticAudioButton();
      syncHapticSettingsUi();
      return;
    }

    hapticAudioEnabled = !hapticAudioEnabled;
    syncHapticAudioButton();
    saveHapticSettings();

    if (hapticAudioEnabled) {
      const pulseMs = Math.round(24 * hapticStrength);
      navigator.vibrate([pulseMs, 18, pulseMs]);
    }

    syncHapticSettingsUi();
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    resetGame(wasm);
  });

  document.getElementById('btn-debug')?.addEventListener('click', () => {
    const on = toggleHeatmap();
    document.getElementById('btn-debug').textContent = on ? '🔬' : '🔬';
    document.getElementById('btn-debug').style.borderColor = on ? 'var(--accent)' : '';
  });

  const screenOnlyBtn = document.getElementById('btn-screen-only');
  screenOnlyBtn?.addEventListener('click', () => {
    setScreenOnlyMode(!screenOnlyMode);
  });

  syncScreenOnlyButton();
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
  if (maybeRedirectToHttps()) {
    return;
  }

  tryUnlockOrientation();

  // Listen for orientation/resize changes
  window.addEventListener('resize', handleOrientationChange);
  if (screen.orientation) {
    screen.orientation.addEventListener('change', handleOrientationChange);
  }
  window.addEventListener('orientationchange', handleOrientationChange);

  loadHapticSettings();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncInstallButton();
  });

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
