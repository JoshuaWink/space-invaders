/* joystick.js — Virtual thumb-stick for mobile touch input
 *
 * Left half: horizontal slide zone (left / right)
 * Right half: fire button
 * Top: coin + start
 *
 * Renders via CSS transform (GPU-composited, zero layout thrash).
 * Feeds into InputState the same way keyboard does.
 */

export class VirtualJoystick {
  constructor(inputState) {
    this.input = inputState;
    this._knobX = 0;          // current offset from center, px
    this._baseRadius = 0;     // computed on mount
    this._deadZone = 0.15;    // 15% of radius before we register direction
    this._tracking = null;    // active touch identifier
    this._baseRect = null;    // cached DOMRect of the base circle
    this._knobEl = null;
    this._baseEl = null;
    this._fireEl = null;
    this._fireTracking = null;
    this._mounted = false;
  }

  mount() {
    if (this._mounted) return;
    this._mounted = true;

    const container = document.getElementById('touch-controls');
    if (!container) return;

    // Detect touch support — supplements CSS (hover:none)+(pointer:coarse)
    const isTouch = ('ontouchstart' in window) ||
                    (navigator.maxTouchPoints > 0) ||
                    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouch) return;

    container.innerHTML = '';
    container.className = 'touch-controls joystick-layout';
    container.style.display = 'flex'; // force visible — media query may not fire yet

    // ── Top row: coin + start ──
    const topRow = document.createElement('div');
    topRow.className = 'js-top-row';

    const coinBtn = this._makeBtn('🪙', 'Coin', 'js-coin');
    const startBtn = this._makeBtn('START', 'Start', 'js-start');
    topRow.append(coinBtn, startBtn);

    // ── Bottom row: stick + fire ──
    const bottomRow = document.createElement('div');
    bottomRow.className = 'js-bottom-row';

    // Joystick base
    const base = document.createElement('div');
    base.className = 'js-base';
    base.setAttribute('aria-label', 'Joystick');

    const knob = document.createElement('div');
    knob.className = 'js-knob';
    base.appendChild(knob);

    // Fire button
    const fire = document.createElement('div');
    fire.className = 'js-fire';
    fire.setAttribute('role', 'button');
    fire.setAttribute('aria-label', 'Fire');
    fire.textContent = 'FIRE';

    bottomRow.append(base, fire);

    container.append(topRow, bottomRow);

    this._baseEl = base;
    this._knobEl = knob;
    this._fireEl = fire;

    // Measure (re-measure after first rAF paint in case element was not yet laid out)
    this._measure();
    requestAnimationFrame(() => this._measure());

    // Bind touch events
    this._bindStick();
    this._bindFire();
    this._bindTopButtons(coinBtn, startBtn);

    // Re-measure on resize/orientation change
    const remeasure = () => requestAnimationFrame(() => this._measure());
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', remeasure);
  }

  _makeBtn(label, ariaLabel, className) {
    const btn = document.createElement('button');
    btn.className = `js-btn ${className}`;
    btn.setAttribute('aria-label', ariaLabel);
    btn.textContent = label;
    return btn;
  }

  _measure() {
    if (!this._baseEl) return;
    this._baseRect = this._baseEl.getBoundingClientRect();
    this._baseRadius = this._baseRect.width / 2;
  }

  // ── Stick Input ──

  _bindStick() {
    const el = this._baseEl;

    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._tracking !== null) return; // already tracking a finger
      const touch = e.changedTouches[0];
      this._tracking = touch.identifier;
      this._measure();
      this._updateStick(touch);
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = this._findTouch(e.changedTouches);
      if (touch) this._updateStick(touch);
    }, { passive: false });

    const release = (e) => {
      e.preventDefault();
      if (this._findTouch(e.changedTouches)) {
        this._tracking = null;
        this._resetStick();
      }
    };

    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  }

  _findTouch(touches) {
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === this._tracking) return touches[i];
    }
    return null;
  }

  _updateStick(touch) {
    if (!this._baseRect) return;

    const centerX = this._baseRect.left + this._baseRadius;
    let dx = touch.clientX - centerX;

    // Clamp to base radius
    const maxR = this._baseRadius - 12; // knob inset
    if (dx > maxR) dx = maxR;
    if (dx < -maxR) dx = -maxR;

    this._knobX = dx;

    // Visual: GPU-composited transform
    this._knobEl.style.transform = `translate3d(${dx}px, 0, 0)`;

    // Input: apply dead zone
    const ratio = dx / maxR;
    const deadZone = this._deadZone;

    const prevLeft = this.input.left;
    const prevRight = this.input.right;

    if (ratio < -deadZone) {
      this.input.left = true;
      this.input.right = false;
    } else if (ratio > deadZone) {
      this.input.left = false;
      this.input.right = true;
    } else {
      this.input.left = false;
      this.input.right = false;
    }

    // Haptic on direction change
    if ((this.input.left !== prevLeft || this.input.right !== prevRight) &&
        (this.input.left || this.input.right)) {
      this._haptic();
    }
  }

  _resetStick() {
    this._knobX = 0;
    this._knobEl.style.transition = 'transform 0.12s ease-out';
    this._knobEl.style.transform = 'translate3d(0, 0, 0)';
    this.input.left = false;
    this.input.right = false;

    // Remove transition after snap-back so drag is instant
    setTimeout(() => {
      if (this._knobEl) this._knobEl.style.transition = 'none';
    }, 130);
  }

  // ── Fire ──

  _bindFire() {
    const el = this._fireEl;

    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._fireTracking = e.changedTouches[0].identifier;
      this.input.fire = true;
      el.classList.add('active');
      this._haptic();
    }, { passive: false });

    const fireRelease = (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._fireTracking) {
          this._fireTracking = null;
          this.input.fire = false;
          el.classList.remove('active');
        }
      }
    };

    el.addEventListener('touchend', fireRelease, { passive: false });
    el.addEventListener('touchcancel', fireRelease, { passive: false });
  }

  // ── Top Buttons ──

  _bindTopButtons(coinEl, startEl) {
    this._bindTap(coinEl, () => {
      this.input.coin = true;
      this._haptic();
      setTimeout(() => { this.input.coin = false; }, 100);
    });

    this._bindTap(startEl, () => {
      this.input.start = true;
      this._haptic();
      setTimeout(() => { this.input.start = false; }, 100);
    });
  }

  _bindTap(el, fn) {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      el.classList.add('active');
      fn();
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      el.classList.remove('active');
    }, { passive: false });

    // Also support click for desktop testing
    el.addEventListener('click', (e) => {
      e.preventDefault();
      fn();
    });
  }

  // ── Haptics ──

  _haptic(ms = 10) {
    if (navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }
}
