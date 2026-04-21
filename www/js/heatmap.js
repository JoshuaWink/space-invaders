// heatmap.js — Real-time 8080 CPU visualization
//
// Three views into the running machine:
//   1. Address-space heat map (128×128 grid = 16384 addresses)
//   2. VRAM mutation overlay (transparent layer on the game canvas)
//   3. Register dashboard (live CPU state)

// ── Color ramp ──────────────────────────────────────────────────
// Classic thermal: black → blue → cyan → green → yellow → red → white
const RAMP = new Uint8Array(256 * 3);
(function buildRamp() {
  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  const stops = [
    [  0,   0,   0,   0],   //   0: black
    [ 40,   0,   0, 180],   //  40: dark blue
    [ 80,   0, 160, 255],   //  80: cyan-blue
    [120,   0, 255, 128],   // 120: green
    [160, 255, 255,   0],   // 160: yellow
    [200, 255,  80,   0],   // 200: orange-red
    [240, 255,   0,   0],   // 240: red
    [255, 255, 255, 255],   // 255: white
  ];
  for (let i = 0; i < 256; i++) {
    let si = 0;
    for (let s = 1; s < stops.length; s++) {
      if (i <= stops[s][0]) { si = s - 1; break; }
    }
    const [i0, r0, g0, b0] = stops[si];
    const [i1, r1, g1, b1] = stops[si + 1] || stops[si];
    const t = i1 === i0 ? 0 : (i - i0) / (i1 - i0);
    const off = i * 3;
    RAMP[off]     = lerp(r0, r1, t);
    RAMP[off + 1] = lerp(g0, g1, t);
    RAMP[off + 2] = lerp(b0, b1, t);
  }
})();

// ── VRAM overlay color (cyan glow) ──────────────────────────────
const VRAM_HUE_R = 0;
const VRAM_HUE_G = 255;
const VRAM_HUE_B = 200;

// ── Address-space heat map renderer ─────────────────────────────
// 128 columns × 128 rows = 16384 pixels = full 16KB address space.
// Row 0-63: ROM | Row 64-71: RAM | Row 72-127: VRAM

const HEAT_W = 128;
const HEAT_H = 128;

let heatCtx = null;
let heatImageData = null;

function initHeatCanvas(canvas) {
  canvas.width = HEAT_W;
  canvas.height = HEAT_H;
  heatCtx = canvas.getContext('2d', { willReadFrequently: true });
  heatImageData = heatCtx.createImageData(HEAT_W, HEAT_H);
  // Fill opaque black
  const d = heatImageData.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
}

function renderExecHeat(execData) {
  if (!heatCtx || !heatImageData) return;
  const d = heatImageData.data;
  const len = Math.min(execData.length, HEAT_W * HEAT_H);

  for (let i = 0; i < len; i++) {
    // Scale intensity: saturating_add(1) per instruction means
    // hot loops will quickly hit 255. Apply a gamma boost for
    // low-activity addresses to make them visible.
    let raw = execData[i];
    // Boost: anything > 0 gets at least 20; hot spots scale up.
    let v = raw === 0 ? 0 : Math.min(255, raw * 4 + 16);

    const off = i * 4;
    const rampOff = v * 3;
    d[off]     = RAMP[rampOff];
    d[off + 1] = RAMP[rampOff + 1];
    d[off + 2] = RAMP[rampOff + 2];
    // alpha stays 255
  }

  heatCtx.putImageData(heatImageData, 0, 0);

  // Draw region labels
  heatCtx.font = '5px monospace';
  heatCtx.fillStyle = 'rgba(255,255,255,0.6)';
  heatCtx.fillText('ROM', 1, 6);
  heatCtx.fillText('RAM', 1, 68);
  heatCtx.fillText('VRAM', 1, 78);

  // Region separator lines
  heatCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  heatCtx.lineWidth = 0.5;
  heatCtx.beginPath();
  heatCtx.moveTo(0, 64); heatCtx.lineTo(128, 64); // ROM/RAM boundary
  heatCtx.moveTo(0, 72); heatCtx.lineTo(128, 72); // RAM/VRAM boundary
  heatCtx.stroke();
}

// ── VRAM mutation overlay ───────────────────────────────────────
// Renders onto a transparent canvas overlaid on the game canvas.
// Shows which screen pixels are being actively redrawn.
// VRAM layout: 224 columns of 32 bytes each. Each byte = 8 vertical pixels.
// Display: 224 wide × 256 tall (after 90° CCW rotation).

let overlayCtx = null;
let overlayImageData = null;

function initOverlayCanvas(canvas) {
  canvas.width = 224;
  canvas.height = 256;
  overlayCtx = canvas.getContext('2d', { willReadFrequently: true });
  overlayImageData = overlayCtx.createImageData(224, 256);
}

function renderVramOverlay(vramHeat) {
  if (!overlayCtx || !overlayImageData) return;
  const d = overlayImageData.data;
  // Clear to transparent
  d.fill(0);

  for (let i = 0; i < vramHeat.length; i++) {
    const intensity = vramHeat[i];
    if (intensity === 0) continue;

    // Map VRAM byte index to screen coordinates
    // Same rotation as render_rgba in machine.rs
    const col = Math.floor(i / 32);   // 0–223 → screen X
    const byteIdx = i % 32;

    for (let bit = 0; bit < 8; bit++) {
      const row = byteIdx * 8 + bit;  // 0–255
      const screenX = col;
      const screenY = 255 - row;

      const off = (screenY * 224 + screenX) * 4;
      if (off + 3 >= d.length) continue;

      // Alpha scales with intensity
      const alpha = Math.min(255, intensity * 2);
      d[off]     = VRAM_HUE_R;
      d[off + 1] = VRAM_HUE_G;
      d[off + 2] = VRAM_HUE_B;
      d[off + 3] = alpha;
    }
  }

  overlayCtx.putImageData(overlayImageData, 0, 0);
}

// ── Register dashboard ──────────────────────────────────────────

function renderRegisters(regs, el) {
  if (!el || !regs || regs.length < 10) return;

  const pc = regs[0];
  const sp = regs[1];
  const a  = regs[2];
  const f  = regs[3];
  const b  = regs[4];
  const c  = regs[5];
  const d  = regs[6];
  const e  = regs[7];
  const h  = regs[8];
  const l  = regs[9];

  const hex4 = v => v.toString(16).toUpperCase().padStart(4, '0');
  const hex2 = v => v.toString(16).toUpperCase().padStart(2, '0');
  const bit = (v, n) => (v >> n) & 1;

  const flags = `${bit(f,7)?'S':'·'}${bit(f,6)?'Z':'·'}·${bit(f,4)?'A':'·'}·${bit(f,2)?'P':'·'}·${bit(f,0)?'C':'·'}`;

  el.textContent =
    `PC ${hex4(pc)}  SP ${hex4(sp)}\n` +
    `A  ${hex2(a)}    F  ${flags}\n` +
    `B  ${hex2(b)}  C  ${hex2(c)}\n` +
    `D  ${hex2(d)}  E  ${hex2(e)}\n` +
    `H  ${hex2(h)}  L  ${hex2(l)}`;
}

// ── Public API ──────────────────────────────────────────────────

let enabled = false;

export function isHeatmapEnabled() {
  return enabled;
}

export function toggleHeatmap() {
  enabled = !enabled;
  const panel = document.getElementById('debug-panel');
  if (panel) panel.classList.toggle('hidden', !enabled);
  const overlay = document.getElementById('vram-overlay');
  if (overlay) overlay.classList.toggle('hidden', !enabled);
  return enabled;
}

export function initHeatmap() {
  const heatCanvas = document.getElementById('heat-canvas');
  const overlayCanvas = document.getElementById('vram-overlay');
  if (heatCanvas) initHeatCanvas(heatCanvas);
  if (overlayCanvas) initOverlayCanvas(overlayCanvas);
}

export function updateHeatmap(machine) {
  if (!enabled || !machine) return;

  // Tell machine to compute VRAM diff + decay
  machine.updateVramHeat();
  machine.decayHeat();

  // Render execution heat map
  const execData = machine.getExecHeat();
  renderExecHeat(execData);

  // Render VRAM overlay
  const vramData = machine.getVramHeat();
  renderVramOverlay(vramData);

  // Render register dashboard
  const regs = machine.getRegisters();
  renderRegisters(regs, document.getElementById('reg-display'));
}
