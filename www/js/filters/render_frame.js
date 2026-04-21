// RenderFrame — CUP Filter
// Reads VRAM from the WASM machine and draws to the canvas.
// Payload in:  { machine: WasmMachine, canvas: HTMLCanvasElement, ctx2d: CanvasRenderingContext2D }
// Payload out: { machine: WasmMachine } (canvas is updated as side effect)

export class RenderFrame {
  constructor() {
    // Reuse ImageData across frames to avoid GC pressure
    this._imageData = null;
  }

  call(payload) {
    const machine = payload.get('machine');
    const ctx = payload.get('ctx2d');
    if (!machine || !ctx) return payload;

    // Get the pre-rendered RGBA buffer from WASM (224×256×4 bytes)
    const rgba = machine.renderFrame();

    if (!this._imageData) {
      this._imageData = new ImageData(224, 256);
    }

    // Copy WASM output into ImageData
    this._imageData.data.set(rgba);

    // Blit to canvas
    ctx.putImageData(this._imageData, 0, 0);

    return payload;
  }
}
