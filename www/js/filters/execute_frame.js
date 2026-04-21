// ExecuteFrame — CUP Filter
// Runs one full frame of CPU emulation (~33,333 cycles, 2 interrupts).
// Payload in:  { machine: WasmMachine }
// Payload out: { machine: WasmMachine, frameCycles: number }

export class ExecuteFrame {
  call(payload) {
    const machine = payload.get('machine');
    if (!machine) return payload;

    const speedMultiplier = payload.get('speedMultiplier') || 1;
    let cycles = 0;
    for (let index = 0; index < speedMultiplier; index += 1) {
      cycles += machine.executeFrame();
    }
    return payload.insert('frameCycles', cycles);
  }
}
