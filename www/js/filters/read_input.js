// ReadInput — CUP Filter
// Reads the current keyboard/touch state and sets machine input ports.
// Payload in:  { machine: WasmMachine, inputState: InputState }
// Payload out: { machine: WasmMachine } (ports updated on machine)

export class ReadInput {
  call(payload) {
    const machine = payload.get('machine');
    const input = payload.get('inputState');

    if (!machine || !input) return payload;

    // Build port 1 value:
    // Bit 0: Coin    | Bit 1: 2P start | Bit 2: 1P start
    // Bit 3: Always 1| Bit 4: Fire     | Bit 5: Left     | Bit 6: Right
    let port1 = 0x08; // bit 3 always set
    if (input.coin)  port1 |= 0x01;
    if (input.start) port1 |= 0x04;
    if (input.fire)  port1 |= 0x10;
    if (input.left)  port1 |= 0x20;
    if (input.right) port1 |= 0x40;

    machine.setInputPort1(port1);

    return payload;
  }
}

const CONTROLLER_STORAGE_KEY = 'si-controller-config-v1';
const CONTROLLER_ACTIONS = ['left', 'right', 'fire', 'start', 'coin'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Keyboard and touch input state tracker.
 * Tracks keyboard/touch inputs plus optional gamepad inputs.
 * Controller mappings and deadzone are persisted in localStorage.
 */
export class InputState {
  constructor() {
    this._manual = {
      left: false,
      right: false,
      fire: false,
      start: false,
      coin: false,
    };
    this._controller = {
      left: false,
      right: false,
      fire: false,
      start: false,
      coin: false,
    };

    this._controllerDeadzone = 0.2;
    this._controllerMapping = this._defaultControllerMapping();
    this._activeGamepadIndex = null;
    this._gamepadConnected = false;
    this._gamepadName = '';
    this._gamepadCoinHeld = false;
    this._bindingCapture = null;

    this._defineActionProperties();

    this.pause = false;

    // Edge detection for coin (only trigger once per press)
    this._coinPressed = false;

    this._loadControllerConfig();
    this._bindGamepadEvents();

    this._bindKeyboard();
    this._bindTouch();
  }

  _defaultControllerMapping() {
    return {
      left: { type: 'axis', index: 0, direction: -1 },
      right: { type: 'axis', index: 0, direction: 1 },
      fire: { type: 'button', index: 0 },
      start: { type: 'button', index: 9 },
      coin: { type: 'button', index: 8 },
    };
  }

  _defineActionProperties() {
    for (const action of CONTROLLER_ACTIONS) {
      Object.defineProperty(this, action, {
        configurable: false,
        enumerable: true,
        get: () => this._manual[action] || this._controller[action],
        set: (value) => {
          this._manual[action] = Boolean(value);
        },
      });
    }
  }

  _bindGamepadEvents() {
    if (typeof window === 'undefined') return;

    window.addEventListener('gamepadconnected', (e) => {
      this._gamepadConnected = true;
      this._activeGamepadIndex = e.gamepad.index;
      this._gamepadName = e.gamepad.id || 'Controller';
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this._activeGamepadIndex === e.gamepad.index) {
        this._activeGamepadIndex = null;
        this._gamepadConnected = false;
        this._gamepadName = '';
      }
    });
  }

  pollControllers() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }

    const pads = navigator.getGamepads();
    let pad = null;

    if (this._activeGamepadIndex !== null) {
      pad = pads[this._activeGamepadIndex] || null;
    }
    if (!pad) {
      pad = Array.from(pads).find(Boolean) || null;
    }

    if (!pad) {
      this._controller.left = false;
      this._controller.right = false;
      this._controller.fire = false;
      this._controller.start = false;
      this._controller.coin = false;
      this._gamepadCoinHeld = false;
      this._gamepadConnected = false;
      this._gamepadName = '';
      this._processBindingCapture(null);
      return;
    }

    this._activeGamepadIndex = pad.index;
    this._gamepadConnected = true;
    this._gamepadName = pad.id || 'Controller';

    this._controller.left = this._bindingPressed(pad, this._controllerMapping.left);
    this._controller.right = this._bindingPressed(pad, this._controllerMapping.right);
    this._controller.fire = this._bindingPressed(pad, this._controllerMapping.fire);
    this._controller.start = this._bindingPressed(pad, this._controllerMapping.start);

    const coinHeld = this._bindingPressed(pad, this._controllerMapping.coin);
    this._controller.coin = coinHeld && !this._gamepadCoinHeld;
    this._gamepadCoinHeld = coinHeld;

    this._processBindingCapture(pad);
  }

  _bindingPressed(pad, binding) {
    if (!binding || !pad) return false;

    if (binding.type === 'button') {
      const button = pad.buttons[binding.index];
      return Boolean(button && (button.pressed || button.value > 0.5));
    }

    if (binding.type === 'axis') {
      const axis = pad.axes[binding.index] || 0;
      if (binding.direction < 0) {
        return axis <= -this._controllerDeadzone;
      }
      return axis >= this._controllerDeadzone;
    }

    return false;
  }

  _detectBindingCandidate(pad) {
    if (!pad) return null;

    for (let i = 0; i < pad.buttons.length; i++) {
      const button = pad.buttons[i];
      if (button && (button.pressed || button.value > 0.75)) {
        return { type: 'button', index: i };
      }
    }

    const axisCaptureThreshold = Math.max(0.35, this._controllerDeadzone + 0.1);
    for (let i = 0; i < pad.axes.length; i++) {
      const value = pad.axes[i];
      if (Math.abs(value) >= axisCaptureThreshold) {
        return {
          type: 'axis',
          index: i,
          direction: value < 0 ? -1 : 1,
        };
      }
    }

    return null;
  }

  _processBindingCapture(pad) {
    if (!this._bindingCapture) return;

    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const elapsed = now - this._bindingCapture.startedAt;

    if (elapsed >= this._bindingCapture.timeoutMs) {
      const reject = this._bindingCapture.reject;
      this._bindingCapture = null;
      reject(new Error('Binding timed out.'));
      return;
    }

    if (!pad) return;

    const candidate = this._detectBindingCandidate(pad);
    if (!candidate) return;

    const action = this._bindingCapture.action;
    const resolve = this._bindingCapture.resolve;
    this._bindingCapture = null;

    this.setControllerBinding(action, candidate);
    resolve({ action, binding: this.getControllerBinding(action) });
  }

  captureNextControllerBinding(action, timeoutMs = 8000) {
    if (!CONTROLLER_ACTIONS.includes(action)) {
      return Promise.reject(new Error(`Unknown action: ${action}`));
    }

    this.cancelControllerBinding('Binding cancelled.');

    const startedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    return new Promise((resolve, reject) => {
      this._bindingCapture = {
        action,
        startedAt,
        timeoutMs,
        resolve,
        reject,
      };
    });
  }

  cancelControllerBinding(reason = 'Binding cancelled.') {
    if (!this._bindingCapture) return;
    const reject = this._bindingCapture.reject;
    this._bindingCapture = null;
    reject(new Error(reason));
  }

  setControllerBinding(action, binding) {
    if (!CONTROLLER_ACTIONS.includes(action)) return;
    if (!binding || typeof binding !== 'object') return;

    if (binding.type === 'button') {
      const index = Math.max(0, Number(binding.index) || 0);
      this._controllerMapping[action] = { type: 'button', index };
    } else if (binding.type === 'axis') {
      const index = Math.max(0, Number(binding.index) || 0);
      const direction = Number(binding.direction) < 0 ? -1 : 1;
      this._controllerMapping[action] = { type: 'axis', index, direction };
    }

    this._saveControllerConfig();
  }

  getControllerBinding(action) {
    const binding = this._controllerMapping[action];
    if (!binding) return null;
    return { ...binding };
  }

  getControllerMapping() {
    const copy = {};
    for (const action of CONTROLLER_ACTIONS) {
      copy[action] = this.getControllerBinding(action);
    }
    return copy;
  }

  resetControllerMapping() {
    this._controllerMapping = this._defaultControllerMapping();
    this._saveControllerConfig();
  }

  setControllerDeadzone(value) {
    this._controllerDeadzone = clamp(Number(value) || 0.2, 0.05, 0.6);
    this._saveControllerConfig();
  }

  getControllerDeadzone() {
    return this._controllerDeadzone;
  }

  getControllerInfo() {
    return {
      connected: this._gamepadConnected,
      name: this._gamepadName,
      index: this._activeGamepadIndex,
    };
  }

  formatControllerBinding(binding) {
    if (!binding) return 'unbound';
    if (binding.type === 'button') {
      return `Button ${binding.index}`;
    }
    if (binding.type === 'axis') {
      return `Axis ${binding.index} ${binding.direction < 0 ? '-' : '+'}`;
    }
    return 'unbound';
  }

  _loadControllerConfig() {
    try {
      const raw = localStorage.getItem(CONTROLLER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.deadzone === 'number') {
        this._controllerDeadzone = clamp(parsed.deadzone, 0.05, 0.6);
      }
      if (parsed.mapping && typeof parsed.mapping === 'object') {
        for (const action of CONTROLLER_ACTIONS) {
          this.setControllerBinding(action, parsed.mapping[action]);
        }
      }
    } catch (_) {
      // Ignore invalid stored config and continue with defaults.
    }
  }

  _saveControllerConfig() {
    try {
      localStorage.setItem(CONTROLLER_STORAGE_KEY, JSON.stringify({
        deadzone: this._controllerDeadzone,
        mapping: this._controllerMapping,
      }));
    } catch (_) {
      // Ignore storage errors (private mode, quota, etc.).
    }
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowLeft':  case 'KeyA': this.left = true; break;
        case 'ArrowRight': case 'KeyD': this.right = true; break;
        case 'Space':      case 'ArrowUp': this.fire = true; break;
        case 'Enter':      this.start = true; break;
        case 'KeyC':
          if (!this._coinPressed) {
            this.coin = true;
            this._coinPressed = true;
          }
          break;
        case 'KeyP':       this.pause = !this.pause; break;
      }
      // Prevent scrolling on arrow keys / space
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowLeft':  case 'KeyA': this.left = false; break;
        case 'ArrowRight': case 'KeyD': this.right = false; break;
        case 'Space':      case 'ArrowUp': this.fire = false; break;
        case 'Enter':      this.start = false; break;
        case 'KeyC':
          this.coin = false;
          this._coinPressed = false;
          break;
      }
    });
  }

  _bindTouch() {
    const bind = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this[prop] = true;
      });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        this[prop] = false;
      });
    };

    bind('touch-left', 'left');
    bind('touch-right', 'right');
    bind('touch-fire', 'fire');
    bind('touch-start', 'start');

    // Coin is edge-triggered for touch too
    const coinEl = document.getElementById('touch-coin');
    if (coinEl) {
      coinEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.coin = true;
      });
      coinEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.coin = false;
      });
    }
  }
}
