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

/**
 * Keyboard and touch input state tracker.
 * Tracks which keys are currently held, with coin as edge-triggered.
 */
export class InputState {
  constructor() {
    this.left = false;
    this.right = false;
    this.fire = false;
    this.start = false;
    this.coin = false;
    this.pause = false;

    // Edge detection for coin (only trigger once per press)
    this._coinPressed = false;

    this._bindKeyboard();
    this._bindTouch();
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
