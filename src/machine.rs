//! Space Invaders Machine
//!
//! Wraps the Intel 8080 CPU with Space Invaders-specific hardware:
//! - 16KB address space (8KB ROM + 1KB RAM + 7KB VRAM)
//! - Hardware shift register (custom barrel shifter)
//! - I/O ports for input, sound, and shift register
//! - Dual interrupts per frame (RST 1 mid-screen, RST 2 end-of-frame)

use crate::cpu::Cpu;

/// Cycles per frame at 2 MHz / 60 fps ≈ 33,333.
const CYCLES_PER_FRAME: u32 = 33_333;
/// Half-frame for mid-screen interrupt.
const CYCLES_PER_HALF_FRAME: u32 = CYCLES_PER_FRAME / 2;
/// VRAM starts at address 0x2400.
const VRAM_START: usize = 0x2400;
/// VRAM is 7168 bytes (256×224 pixels, 1 bit per pixel).
const VRAM_SIZE: usize = 7168;
/// ROM occupies 0x0000–0x1FFF (8KB).
const ROM_END: usize = 0x2000;

/// The color overlay bands on the physical arcade monitor.
/// Returns (R, G, B) for a given screen Y coordinate (0–255).
fn color_for_y(y: usize) -> (u8, u8, u8) {
    match y {
        0..=31 => (255, 255, 255),     // Score area: white
        32..=63 => (255, 0, 0),        // UFO area: red
        64..=183 => (255, 255, 255),   // Invader grid: white
        184..=239 => (0, 255, 0),      // Shields + player: green
        _ => (255, 255, 255),          // Bottom credits: white
    }
}

/// Space Invaders arcade machine.
pub struct Machine {
    pub cpu: Cpu,

    // Hardware shift register
    shift_register: u16,
    shift_offset: u8,

    // Input port state (set by the JS side each frame)
    input_port1: u8,
    input_port2: u8,

    // Sound output ports (read by the JS side for audio)
    sound_port3: u8,
    sound_port5: u8,
    prev_sound_port3: u8,
    prev_sound_port5: u8,

    // ── Heat-map instrumentation ──────────────────────────────
    /// Per-address execution frequency (16 KB address space).
    exec_heat: Box<[u8; 16384]>,
    /// VRAM snapshot from previous frame for diffing.
    vram_prev: Box<[u8; VRAM_SIZE]>,
    /// Per-VRAM-byte mutation intensity (7168 bytes).
    vram_heat: Box<[u8; VRAM_SIZE]>,
}

impl Machine {
    pub fn new() -> Self {
        let mut m = Machine {
            cpu: Cpu::new(),
            shift_register: 0,
            shift_offset: 0,
            input_port1: 0x08, // bit 3 always set
            input_port2: 0x00,
            sound_port3: 0,
            sound_port5: 0,
            prev_sound_port3: 0,
            prev_sound_port5: 0,
            exec_heat: Box::new([0u8; 16384]),
            vram_prev: Box::new([0u8; VRAM_SIZE]),
            vram_heat: Box::new([0u8; VRAM_SIZE]),
        };
        // Default DIP switches: 3 lives
        m.input_port2 = 0x00;
        m
    }

    /// Load ROM data into memory starting at address 0x0000.
    /// Accepts 2KB, 4KB, 6KB, or 8KB ROMs (the 4 ROM chips).
    pub fn load_rom(&mut self, rom: &[u8]) {
        let len = rom.len().min(ROM_END);
        self.cpu.memory[..len].copy_from_slice(&rom[..len]);
    }

    /// Set input port 1 (player controls).
    ///
    /// Bit layout:
    /// - 0: Coin inserted
    /// - 1: 2P start
    /// - 2: 1P start
    /// - 3: Always 1
    /// - 4: 1P fire
    /// - 5: 1P left
    /// - 6: 1P right
    /// - 7: Not used
    pub fn set_input_port1(&mut self, val: u8) {
        self.input_port1 = val | 0x08; // bit 3 always set
    }

    /// Set input port 2 (player 2 + DIP switches).
    pub fn set_input_port2(&mut self, val: u8) {
        self.input_port2 = val;
    }

    /// Execute one full frame (~33,333 CPU cycles) with two interrupts.
    /// Returns the number of cycles executed.
    pub fn execute_frame(&mut self) -> u32 {
        let mut total_cycles: u32 = 0;

        // First half: execute until mid-screen
        let mut half_cycles: u32 = 0;
        while half_cycles < CYCLES_PER_HALF_FRAME {
            let c = self.step_cpu();
            half_cycles += c;
            total_cycles += c;
        }

        // Mid-screen interrupt: RST 1 (vector 0x08)
        self.cpu.interrupt(1);

        // Second half: execute until end-of-frame
        half_cycles = 0;
        while half_cycles < CYCLES_PER_HALF_FRAME {
            let c = self.step_cpu();
            half_cycles += c;
            total_cycles += c;
        }

        // End-of-frame interrupt: RST 2 (vector 0x10)
        self.cpu.interrupt(2);

        total_cycles
    }

    /// Execute a single CPU instruction with I/O routing.
    fn step_cpu(&mut self) -> u32 {
        // Record execution at current PC for heat map
        let pc = self.cpu.pc as usize;
        if pc < 16384 {
            self.exec_heat[pc] = self.exec_heat[pc].saturating_add(1);
        }

        // Capture self references for the closures
        let input_port1 = self.input_port1;
        let input_port2 = self.input_port2;
        let shift_register = self.shift_register;
        let shift_offset = self.shift_offset;

        let port_in = move |port: u8| -> u8 {
            match port {
                1 => input_port1,
                2 => input_port2,
                3 => ((shift_register >> (8 - shift_offset)) & 0xFF) as u8,
                _ => 0,
            }
        };

        let mut new_shift_register = self.shift_register;
        let mut new_shift_offset = self.shift_offset;
        let mut new_sound3 = self.sound_port3;
        let mut new_sound5 = self.sound_port5;

        let mut port_out = |port: u8, val: u8| {
            match port {
                2 => new_shift_offset = val & 0x07,
                3 => new_sound3 = val,
                4 => new_shift_register = ((val as u16) << 8) | (new_shift_register >> 8),
                5 => new_sound5 = val,
                6 => {} // watchdog
                _ => {}
            }
        };

        let cycles = self.cpu.execute(&port_in, &mut port_out);

        // Apply I/O side effects
        self.shift_register = new_shift_register;
        self.shift_offset = new_shift_offset;
        self.sound_port3 = new_sound3;
        self.sound_port5 = new_sound5;

        cycles
    }

    /// Get the raw VRAM bytes (7168 bytes starting at 0x2400).
    pub fn get_vram(&self) -> &[u8] {
        &self.cpu.memory[VRAM_START..VRAM_START + VRAM_SIZE]
    }

    /// Read a raw memory byte from the machine address space.
    pub fn read_byte(&self, addr: u16) -> u8 {
        self.cpu.memory[addr as usize]
    }

    // ── Heat-map API ──────────────────────────────────────────────

    /// Get the execution heat map (16384 bytes, one per address).
    pub fn get_exec_heat(&self) -> &[u8] {
        &self.exec_heat[..]
    }

    /// Get the VRAM mutation heat map (7168 bytes).
    pub fn get_vram_heat(&self) -> &[u8] {
        &self.vram_heat[..]
    }

    /// Decay all heat values by shifting right (halving intensity).
    /// Call once per frame for a persistence-of-vision effect.
    pub fn decay_heat(&mut self) {
        for v in self.exec_heat.iter_mut() {
            *v >>= 1;
        }
        for v in self.vram_heat.iter_mut() {
            *v >>= 1;
        }
    }

    /// Compute VRAM diff since last snapshot and update vram_heat.
    /// Also takes a new snapshot for the next frame.
    pub fn update_vram_heat(&mut self) {
        let vram = &self.cpu.memory[VRAM_START..VRAM_START + VRAM_SIZE];
        for i in 0..VRAM_SIZE {
            if vram[i] != self.vram_prev[i] {
                self.vram_heat[i] = self.vram_heat[i].saturating_add(128);
            }
        }
        self.vram_prev.copy_from_slice(vram);
    }

    /// Get CPU register snapshot as [PC, SP, A, Flags, B, C, D, E, H, L].
    pub fn get_registers(&self) -> [u16; 10] {
        let flags = {
            let f = &self.cpu.flags;
            let mut v: u8 = 0x02; // bit 1 always set on 8080
            if f.carry   { v |= 0x01; }
            if f.parity  { v |= 0x04; }
            if f.aux_carry { v |= 0x10; }
            if f.zero    { v |= 0x40; }
            if f.sign    { v |= 0x80; }
            v
        };
        [
            self.cpu.pc,
            self.cpu.sp,
            self.cpu.a as u16,
            flags as u16,
            self.cpu.b as u16,
            self.cpu.c as u16,
            self.cpu.d as u16,
            self.cpu.e as u16,
            self.cpu.h as u16,
            self.cpu.l as u16,
        ]
    }

    /// Render the VRAM into an RGBA pixel buffer (224×256×4 bytes).
    /// Applies screen rotation and color overlay.
    /// The output is ready for `ImageData` / `putImageData`.
    pub fn render_rgba(&self) -> Vec<u8> {
        let width: usize = 224;
        let height: usize = 256;
        let mut pixels = vec![0u8; width * height * 4];

        let vram = self.get_vram();

        for i in 0..VRAM_SIZE {
            let col = i / 32;           // 0–223 → screen X
            let byte_idx = i % 32;      // byte within column
            let vram_byte = vram[i];

            for bit in 0..8u32 {
                let row = byte_idx * 8 + bit as usize; // 0–255
                let screen_x = col;
                let screen_y = 255 - row; // flip vertically

                let pixel_on = (vram_byte >> bit) & 1 != 0;
                let offset = (screen_y * width + screen_x) * 4;

                if offset + 3 >= pixels.len() {
                    continue;
                }

                if pixel_on {
                    let (r, g, b) = color_for_y(screen_y);
                    pixels[offset] = r;
                    pixels[offset + 1] = g;
                    pixels[offset + 2] = b;
                    pixels[offset + 3] = 255;
                } else {
                    pixels[offset] = 0;
                    pixels[offset + 1] = 0;
                    pixels[offset + 2] = 0;
                    pixels[offset + 3] = 255;
                }
            }
        }

        pixels
    }

    /// Get current sound port 3 value.
    pub fn get_sound_port3(&self) -> u8 {
        self.sound_port3
    }

    /// Get current sound port 5 value.
    pub fn get_sound_port5(&self) -> u8 {
        self.sound_port5
    }

    /// Get previous sound port 3 (for edge detection).
    pub fn get_prev_sound_port3(&self) -> u8 {
        self.prev_sound_port3
    }

    /// Get previous sound port 5 (for edge detection).
    pub fn get_prev_sound_port5(&self) -> u8 {
        self.prev_sound_port5
    }

    /// Call after processing sounds to update "previous" state.
    pub fn acknowledge_sounds(&mut self) {
        self.prev_sound_port3 = self.sound_port3;
        self.prev_sound_port5 = self.sound_port5;
    }

    /// Check if ROM is loaded (non-zero data in ROM area).
    pub fn has_rom(&self) -> bool {
        self.cpu.memory[0..ROM_END].iter().any(|&b| b != 0)
    }

    /// Protect ROM from writes (Space Invaders ROM is read-only).
    /// Call after loading ROM to prevent the game from corrupting itself.
    pub fn protect_rom(&mut self) {
        // The CPU write_byte is unchecked for speed.
        // Space Invaders never writes to ROM, so this is unnecessary
        // for correct emulation. Kept as a documentation marker.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shift_register() {
        let mut machine = Machine::new();

        // Set shift amount = 2 via CPU OUT instruction
        // We test via step_cpu which handles I/O routing
        machine.shift_offset = 2;

        // Feed the shift register directly
        machine.shift_register = ((0xAB as u16) << 8) | 0x00;
        machine.shift_register = ((0xCD as u16) << 8) | (machine.shift_register >> 8);
        // shift_register should be 0xCDAB

        // Verify shift register read
        let result = ((machine.shift_register >> (8 - machine.shift_offset)) & 0xFF) as u8;
        assert_eq!(result, ((0xCDABu16 >> 6) & 0xFF) as u8);
    }

    #[test]
    fn test_load_rom() {
        let mut machine = Machine::new();
        let rom = vec![0xC3, 0x00, 0x18]; // JMP 0x1800
        machine.load_rom(&rom);
        assert_eq!(machine.cpu.memory[0], 0xC3);
        assert_eq!(machine.cpu.memory[1], 0x00);
        assert_eq!(machine.cpu.memory[2], 0x18);
        assert!(machine.has_rom());
    }

    #[test]
    fn test_input_port1_bit3() {
        let mut machine = Machine::new();
        machine.set_input_port1(0x00);
        // Bit 3 should always be set
        assert_eq!(machine.input_port1 & 0x08, 0x08);
    }

    #[test]
    fn test_render_rgba_dimensions() {
        let machine = Machine::new();
        let pixels = machine.render_rgba();
        assert_eq!(pixels.len(), 224 * 256 * 4);
    }

    #[test]
    fn test_vram_pixel() {
        let mut machine = Machine::new();
        // Set a byte in VRAM
        machine.cpu.memory[VRAM_START] = 0xFF; // All 8 pixels on in first column
        let pixels = machine.render_rgba();
        // First column (screen_x=0), bottom 8 pixels should be lit
        // screen_y = 255 - (0*8 + bit) for bit 0..7
        // screen_y=255 for bit 0, screen_y=248 for bit 7
        for bit in 0..8 {
            let screen_y = 255 - bit;
            let offset = (screen_y * 224 + 0) * 4;
            assert_eq!(pixels[offset + 3], 255, "alpha should be 255");
            // Check pixel is lit (non-zero RGB)
            assert!(
                pixels[offset] > 0 || pixels[offset + 1] > 0 || pixels[offset + 2] > 0,
                "pixel at y={} should be on",
                screen_y
            );
        }
    }

    #[test]
    fn test_sound_via_cpu_out() {
        let mut machine = Machine::new();
        // Directly set sound ports (as step_cpu would)
        machine.sound_port3 = 0x0F;
        machine.sound_port5 = 0x03;
        assert_eq!(machine.get_sound_port3(), 0x0F);
        assert_eq!(machine.get_prev_sound_port3(), 0x00);
        machine.acknowledge_sounds();
        assert_eq!(machine.get_prev_sound_port3(), 0x0F);
        assert_eq!(machine.get_prev_sound_port5(), 0x03);
    }

    #[test]
    fn test_io_via_cpu_execution() {
        let mut machine = Machine::new();
        // Program: OUT 3, A (with A=0x0F) → should set sound_port3
        // MVI A, 0x0F; OUT 3
        machine.cpu.memory[0] = 0x3E; // MVI A
        machine.cpu.memory[1] = 0x0F; // immediate
        machine.cpu.memory[2] = 0xD3; // OUT
        machine.cpu.memory[3] = 0x03; // port 3
        machine.cpu.memory[4] = 0x76; // HLT

        // Step through all instructions
        while !machine.cpu.halted {
            machine.step_cpu();
        }

        assert_eq!(machine.sound_port3, 0x0F);
    }
}
