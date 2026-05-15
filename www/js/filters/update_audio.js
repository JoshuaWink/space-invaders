// UpdateAudio — CUP Filter
// Detects sound port changes and triggers Web Audio effects.
// Payload in:  { machine: WasmMachine, audioCtx: AudioContext, muted: boolean, hapticAudioEnabled: boolean }
// Payload out: { machine: WasmMachine } (sounds are acknowledged)
//
// Space Invaders sound ports:
// Port 3 bits: 0=UFO, 1=Shot, 2=PlayerDie, 3=InvaderDie, 4=ExtendedPlay
// Port 5 bits: 0=Fleet1, 1=Fleet2, 2=Fleet3, 3=Fleet4, 4=UFOHit

export class UpdateAudio {
  constructor() {
    this._oscillators = new Map(); // For looping sounds (UFO)
    this._lastHapticMs = 0;
  }

  call(payload) {
    const machine = payload.get('machine');
    const audioCtx = payload.get('audioCtx');
    const muted = payload.get('muted', false);
    const hapticAudioEnabled = payload.get('hapticAudioEnabled', false);
    const hapticStrength = payload.get('hapticStrength', 1);
    const hapticToneMode = payload.get('hapticToneMode', 'arcade');

    if (!machine || !audioCtx || muted) {
      if (machine) machine.acknowledgeSounds();
      return payload;
    }

    const port3 = machine.getSoundPort3();
    const port5 = machine.getSoundPort5();
    const prev3 = machine.getPrevSoundPort3();
    const prev5 = machine.getPrevSoundPort5();

    // Detect rising edges (bit went from 0 to 1)
    const rising3 = port3 & ~prev3;
    const rising5 = port5 & ~prev5;
    const falling3 = ~port3 & prev3;

    // Port 3 sounds
    if (rising3 & 0x01) {
      this._startUfo(audioCtx);
      this._haptic(12, hapticAudioEnabled, hapticStrength, hapticToneMode, 'low');
    }
    if (falling3 & 0x01) this._stopUfo();
    if (rising3 & 0x02) {
      this._playShot(audioCtx);
      this._haptic(18, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }
    if (rising3 & 0x04) {
      this._playExplosion(audioCtx);
      this._haptic([28, 22, 24], hapticAudioEnabled, hapticStrength, hapticToneMode, 'low');
    }
    if (rising3 & 0x08) {
      this._playInvaderDie(audioCtx);
      this._haptic(14, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }

    // Port 5 sounds — fleet movement (4 tones cycling)
    if (rising5 & 0x01) {
      this._playFleet(audioCtx, 55);   // Bass note
      this._haptic(8, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }
    if (rising5 & 0x02) {
      this._playFleet(audioCtx, 49);
      this._haptic(8, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }
    if (rising5 & 0x04) {
      this._playFleet(audioCtx, 46);
      this._haptic(8, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }
    if (rising5 & 0x08) {
      this._playFleet(audioCtx, 43);
      this._haptic(8, hapticAudioEnabled, hapticStrength, hapticToneMode, 'high');
    }
    if (rising5 & 0x10) {
      this._playUfoHit(audioCtx);
      this._haptic([36, 22, 36], hapticAudioEnabled, hapticStrength, hapticToneMode, 'low');
    }

    machine.acknowledgeSounds();
    return payload;
  }

  _haptic(pattern, enabled, strength = 1, toneMode = 'arcade', eventTone = 'high') {
    if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }

    const intensity = Math.max(0.8, Math.min(3, Number(strength) || 1));

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const minGapMs = Math.max(12, Math.round(24 / intensity));
    if (now - this._lastHapticMs < minGapMs) {
      return;
    }

    this._lastHapticMs = now;

    const tone = this._resolveTone(toneMode, eventTone);
    const tonedPattern = this._applyToneToPattern(pattern, tone);

    const scaleMs = (ms) => Math.max(6, Math.min(220, Math.round(ms * intensity)));
    const scaledPattern = tonedPattern.map((ms) => scaleMs(ms));

    const vibratePattern = scaledPattern.length === 1
      ? scaledPattern[0]
      : scaledPattern;

    navigator.vibrate(vibratePattern);
  }

  _resolveTone(toneMode, eventTone) {
    if (toneMode === 'high' || toneMode === 'low') {
      return toneMode;
    }
    return eventTone === 'low' ? 'low' : 'high';
  }

  _applyToneToPattern(pattern, tone) {
    const normalized = Array.isArray(pattern)
      ? pattern.map((ms) => Math.max(1, Number(ms) || 0))
      : [Math.max(1, Number(pattern) || 0)];

    if (tone === 'low') {
      return normalized.map((ms, i) => (i % 2 === 0 ? Math.round(ms * 1.65) : Math.round(ms * 1.2)));
    }

    const out = [];
    for (let i = 0; i < normalized.length; i++) {
      const ms = normalized[i];
      const isBuzz = i % 2 === 0;

      if (!isBuzz) {
        out.push(Math.max(4, Math.round(ms * 0.5)));
        continue;
      }

      const burst = Math.max(5, Math.round(ms * 0.34));
      out.push(burst, 8, burst, 8, burst);
    }

    return out;
  }

  // ── Sound generators (synthesized, no samples needed) ──────

  _startUfo(ctx) {
    if (this._oscillators.has('ufo')) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, ctx.currentTime);
    // Wobble the pitch for the classic UFO sound
    osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 1.0);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this._oscillators.set('ufo', { osc, gain });
  }

  _stopUfo() {
    const entry = this._oscillators.get('ufo');
    if (entry) {
      entry.osc.stop();
      this._oscillators.delete('ufo');
    }
  }

  _playShot(ctx) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

  _playExplosion(ctx) {
    // White noise burst for player death
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  _playInvaderDie(ctx) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  _playFleet(ctx, freq) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  _playUfoHit(ctx) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }
}
