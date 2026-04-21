//! Space Invaders Emulator — WASM + native library
//!
//! Exposes the Machine struct for use from JavaScript (via wasm-bindgen)
//! or as a native Rust library.

pub mod cpu;
pub mod machine;

pub use cpu::Cpu;
pub use machine::Machine;

// ── WASM bindings ──────────────────────────────────────────────────

#[cfg(feature = "wasm")]
mod wasm_api {
    use wasm_bindgen::prelude::*;
    use crate::machine::Machine;

    #[wasm_bindgen]
    pub struct WasmMachine {
        inner: Machine,
    }

    #[wasm_bindgen]
    impl WasmMachine {
        /// Create a new Space Invaders machine.
        #[wasm_bindgen(constructor)]
        pub fn new() -> WasmMachine {
            WasmMachine {
                inner: Machine::new(),
            }
        }

        /// Load ROM bytes into machine memory (up to 8KB).
        #[wasm_bindgen(js_name = "loadRom")]
        pub fn load_rom(&mut self, rom: &[u8]) {
            self.inner.load_rom(rom);
        }

        /// Check if a ROM is loaded.
        #[wasm_bindgen(js_name = "hasRom")]
        pub fn has_rom(&self) -> bool {
            self.inner.has_rom()
        }

        /// Set player input port 1.
        ///
        /// Bit 0: Coin | Bit 1: 2P Start | Bit 2: 1P Start
        /// Bit 4: Fire | Bit 5: Left | Bit 6: Right
        #[wasm_bindgen(js_name = "setInputPort1")]
        pub fn set_input_port1(&mut self, val: u8) {
            self.inner.set_input_port1(val);
        }

        /// Set input port 2 (player 2 + DIP switches).
        #[wasm_bindgen(js_name = "setInputPort2")]
        pub fn set_input_port2(&mut self, val: u8) {
            self.inner.set_input_port2(val);
        }

        /// Execute one full frame (~33,333 CPU cycles, 2 interrupts).
        /// Returns cycles executed.
        #[wasm_bindgen(js_name = "executeFrame")]
        pub fn execute_frame(&mut self) -> u32 {
            self.inner.execute_frame()
        }

        /// Render VRAM into RGBA pixel buffer (224×256×4 bytes).
        /// Ready for Canvas putImageData.
        #[wasm_bindgen(js_name = "renderFrame")]
        pub fn render_frame(&self) -> Vec<u8> {
            self.inner.render_rgba()
        }

        /// Get sound port 3 value (sound effects group 1).
        #[wasm_bindgen(js_name = "getSoundPort3")]
        pub fn get_sound_port3(&self) -> u8 {
            self.inner.get_sound_port3()
        }

        /// Get sound port 5 value (sound effects group 2).
        #[wasm_bindgen(js_name = "getSoundPort5")]
        pub fn get_sound_port5(&self) -> u8 {
            self.inner.get_sound_port5()
        }

        /// Get previous sound port 3 (for edge-triggered sounds).
        #[wasm_bindgen(js_name = "getPrevSoundPort3")]
        pub fn get_prev_sound_port3(&self) -> u8 {
            self.inner.get_prev_sound_port3()
        }

        /// Get previous sound port 5 (for edge-triggered sounds).
        #[wasm_bindgen(js_name = "getPrevSoundPort5")]
        pub fn get_prev_sound_port5(&self) -> u8 {
            self.inner.get_prev_sound_port5()
        }

        /// Acknowledge sound state (call after processing audio).
        #[wasm_bindgen(js_name = "acknowledgeSounds")]
        pub fn acknowledge_sounds(&mut self) {
            self.inner.acknowledge_sounds();
        }

        /// Get total CPU cycles executed.
        #[wasm_bindgen(js_name = "getCycles")]
        pub fn get_cycles(&self) -> f64 {
            self.inner.cpu.cycles as f64
        }

        /// Get current program counter.
        #[wasm_bindgen(js_name = "getPC")]
        pub fn get_pc(&self) -> u16 {
            self.inner.cpu.pc
        }

        /// Read a raw machine memory byte.
        #[wasm_bindgen(js_name = "readByte")]
        pub fn read_byte(&self, addr: u16) -> u8 {
            self.inner.read_byte(addr)
        }

        // ── Heat-map bindings ──────────────────────────────────────

        /// Get execution heat map (16384 bytes — one per ROM/RAM/VRAM address).
        #[wasm_bindgen(js_name = "getExecHeat")]
        pub fn get_exec_heat(&self) -> Vec<u8> {
            self.inner.get_exec_heat().to_vec()
        }

        /// Get VRAM mutation heat map (7168 bytes).
        #[wasm_bindgen(js_name = "getVramHeat")]
        pub fn get_vram_heat(&self) -> Vec<u8> {
            self.inner.get_vram_heat().to_vec()
        }

        /// Decay heat values (call once per frame for glow persistence).
        #[wasm_bindgen(js_name = "decayHeat")]
        pub fn decay_heat(&mut self) {
            self.inner.decay_heat();
        }

        /// Snapshot VRAM and compute mutation heat for this frame.
        #[wasm_bindgen(js_name = "updateVramHeat")]
        pub fn update_vram_heat(&mut self) {
            self.inner.update_vram_heat();
        }

        /// Get CPU registers: [PC, SP, A, Flags, B, C, D, E, H, L].
        #[wasm_bindgen(js_name = "getRegisters")]
        pub fn get_registers(&self) -> Vec<u16> {
            self.inner.get_registers().to_vec()
        }
    }
}
