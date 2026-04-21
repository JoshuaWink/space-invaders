// UpdateAudio — CUP Filter
// Detects sound port changes and triggers Web Audio effects.
// Payload in:  { machine: WasmMachine, audioCtx: AudioContext, muted: boolean }
// Payload out: { machine: WasmMachine } (sounds are acknowledged)
//
// Space Invaders sound ports:
// Port 3 bits: 0=UFO, 1=Shot, 2=PlayerDie, 3=InvaderDie, 4=ExtendedPlay
// Port 5 bits: 0=Fleet1, 1=Fleet2, 2=Fleet3, 3=Fleet4, 4=UFOHit

export class UpdateAudio {
  constructor() {
    this._oscillators = new Map(); // For looping sounds (UFO)
  }

  call(payload) {
    const machine = payload.get('machine');
    const audioCtx = payload.get('audioCtx');
    const muted = payload.get('muted', false);

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
    if (rising3 & 0x01) this._startUfo(audioCtx);
    if (falling3 & 0x01) this._stopUfo();
    if (rising3 & 0x02) this._playShot(audioCtx);
    if (rising3 & 0x04) this._playExplosion(audioCtx);
    if (rising3 & 0x08) this._playInvaderDie(audioCtx);

    // Port 5 sounds — fleet movement (4 tones cycling)
    if (rising5 & 0x01) this._playFleet(audioCtx, 55);   // Bass note
    if (rising5 & 0x02) this._playFleet(audioCtx, 49);
    if (rising5 & 0x04) this._playFleet(audioCtx, 46);
    if (rising5 & 0x08) this._playFleet(audioCtx, 43);
    if (rising5 & 0x10) this._playUfoHit(audioCtx);

    machine.acknowledgeSounds();
    return payload;
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
