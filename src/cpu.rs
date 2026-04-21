//! Intel 8080 CPU Emulator
//!
//! Complete implementation of the Intel 8080 microprocessor (1974).
//! All 256 opcodes, accurate flag handling, cycle counting.
//! Used by the Space Invaders arcade machine (Taito, 1978).

/// Even parity: true if the number of set bits is even.
fn parity(val: u8) -> bool {
    val.count_ones() % 2 == 0
}

/// CPU flag register bits.
#[derive(Debug, Clone, Default)]
pub struct CpuFlags {
    pub sign: bool,      // Bit 7: result is negative
    pub zero: bool,      // Bit 6: result is zero
    pub aux_carry: bool,  // Bit 4: carry from bit 3
    pub parity: bool,    // Bit 2: even parity
    pub carry: bool,     // Bit 0: carry/borrow
}

/// Intel 8080 CPU state.
#[derive(Debug, Clone)]
pub struct Cpu {
    // Main registers
    pub a: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,

    // 16-bit registers
    pub sp: u16,
    pub pc: u16,

    // Flags
    pub flags: CpuFlags,

    // Control
    pub inte: bool,   // Interrupt enable
    pub halted: bool,

    // Memory (64KB address space)
    pub memory: Vec<u8>,

    // Total cycle count
    pub cycles: u64,
}

impl Cpu {
    pub fn new() -> Self {
        Cpu {
            a: 0,
            b: 0, c: 0,
            d: 0, e: 0,
            h: 0, l: 0,
            sp: 0,
            pc: 0,
            flags: CpuFlags::default(),
            inte: false,
            halted: false,
            memory: vec![0u8; 0x10000],
            cycles: 0,
        }
    }

    // ── Register pair accessors ────────────────────────────────────

    pub fn get_bc(&self) -> u16 {
        (self.b as u16) << 8 | self.c as u16
    }
    pub fn get_de(&self) -> u16 {
        (self.d as u16) << 8 | self.e as u16
    }
    pub fn get_hl(&self) -> u16 {
        (self.h as u16) << 8 | self.l as u16
    }

    pub fn set_bc(&mut self, val: u16) {
        self.b = (val >> 8) as u8;
        self.c = val as u8;
    }
    pub fn set_de(&mut self, val: u16) {
        self.d = (val >> 8) as u8;
        self.e = val as u8;
    }
    pub fn set_hl(&mut self, val: u16) {
        self.h = (val >> 8) as u8;
        self.l = val as u8;
    }

    // ── Memory access ──────────────────────────────────────────────

    pub fn read_byte(&self, addr: u16) -> u8 {
        self.memory[addr as usize]
    }

    pub fn write_byte(&mut self, addr: u16, val: u8) {
        self.memory[addr as usize] = val;
    }

    pub fn read_word(&self, addr: u16) -> u16 {
        let lo = self.memory[addr as usize] as u16;
        let hi = self.memory[addr.wrapping_add(1) as usize] as u16;
        hi << 8 | lo
    }

    pub fn write_word(&mut self, addr: u16, val: u16) {
        self.memory[addr as usize] = val as u8;
        self.memory[addr.wrapping_add(1) as usize] = (val >> 8) as u8;
    }

    // ── Instruction fetch ──────────────────────────────────────────

    fn fetch_byte(&mut self) -> u8 {
        let val = self.read_byte(self.pc);
        self.pc = self.pc.wrapping_add(1);
        val
    }

    fn fetch_word(&mut self) -> u16 {
        let lo = self.fetch_byte() as u16;
        let hi = self.fetch_byte() as u16;
        hi << 8 | lo
    }

    // ── Stack ──────────────────────────────────────────────────────

    fn push_word(&mut self, val: u16) {
        self.sp = self.sp.wrapping_sub(2);
        self.write_word(self.sp, val);
    }

    fn pop_word(&mut self) -> u16 {
        let val = self.read_word(self.sp);
        self.sp = self.sp.wrapping_add(2);
        val
    }

    // ── Register decode (3-bit code → register) ───────────────────

    fn get_reg(&self, code: u8) -> u8 {
        match code & 7 {
            0 => self.b,
            1 => self.c,
            2 => self.d,
            3 => self.e,
            4 => self.h,
            5 => self.l,
            6 => self.read_byte(self.get_hl()),
            7 => self.a,
            _ => unreachable!(),
        }
    }

    fn set_reg(&mut self, code: u8, val: u8) {
        match code & 7 {
            0 => self.b = val,
            1 => self.c = val,
            2 => self.d = val,
            3 => self.e = val,
            4 => self.h = val,
            5 => self.l = val,
            6 => {
                let addr = self.get_hl();
                self.write_byte(addr, val);
            }
            7 => self.a = val,
            _ => unreachable!(),
        }
    }

    /// Get register pair by 2-bit code (for LXI/INX/DCX/DAD/PUSH/POP).
    fn get_rp(&self, code: u8) -> u16 {
        match code & 3 {
            0 => self.get_bc(),
            1 => self.get_de(),
            2 => self.get_hl(),
            3 => self.sp,
            _ => unreachable!(),
        }
    }

    fn set_rp(&mut self, code: u8, val: u16) {
        match code & 3 {
            0 => self.set_bc(val),
            1 => self.set_de(val),
            2 => self.set_hl(val),
            3 => self.sp = val,
            _ => unreachable!(),
        }
    }

    // ── PSW (flags ↔ byte) ─────────────────────────────────────────

    /// Pack flags into the PSW byte: S Z 0 AC 0 P 1 CY
    fn get_psw(&self) -> u8 {
        let mut psw = 0x02; // bit 1 is always 1
        if self.flags.sign { psw |= 0x80; }
        if self.flags.zero { psw |= 0x40; }
        if self.flags.aux_carry { psw |= 0x10; }
        if self.flags.parity { psw |= 0x04; }
        if self.flags.carry { psw |= 0x01; }
        psw
    }

    /// Unpack PSW byte into individual flags.
    fn set_psw(&mut self, val: u8) {
        self.flags.sign = val & 0x80 != 0;
        self.flags.zero = val & 0x40 != 0;
        self.flags.aux_carry = val & 0x10 != 0;
        self.flags.parity = val & 0x04 != 0;
        self.flags.carry = val & 0x01 != 0;
    }

    // ── Flag helpers ───────────────────────────────────────────────

    /// Set Zero, Sign, Parity flags from a result value.
    fn set_flags_zsp(&mut self, val: u8) {
        self.flags.zero = val == 0;
        self.flags.sign = val & 0x80 != 0;
        self.flags.parity = parity(val);
    }

    // ── ALU operations ─────────────────────────────────────────────

    /// ADD / ADC: A = A + val [+ carry]
    fn alu_add(&mut self, val: u8, with_carry: bool) {
        let cy = if with_carry && self.flags.carry { 1u16 } else { 0 };
        let result = self.a as u16 + val as u16 + cy;
        self.flags.aux_carry =
            ((self.a & 0x0F) + (val & 0x0F) + cy as u8) > 0x0F;
        self.flags.carry = result > 0xFF;
        self.a = result as u8;
        self.set_flags_zsp(self.a);
    }

    /// SUB / SBB: A = A - val [- borrow]. Returns the result (for CMP).
    fn alu_sub(&mut self, val: u8, with_borrow: bool) -> u8 {
        let bw = if with_borrow && self.flags.carry { 1u16 } else { 0 };
        let result = (self.a as u16).wrapping_sub(val as u16).wrapping_sub(bw);
        // AC: use two's complement addition method
        // A - val - bw = A + (~val) + (1 - bw)
        let complement_add = if bw == 0 { 1u8 } else { 0u8 };
        self.flags.aux_carry =
            ((self.a & 0x0F) + ((!val) & 0x0F) + complement_add) > 0x0F;
        self.flags.carry = result > 0xFF;
        self.a = result as u8;
        self.set_flags_zsp(self.a);
        self.a
    }

    /// CMP: compare A with val (SUB without storing result).
    fn alu_cmp(&mut self, val: u8) {
        let saved_a = self.a;
        self.alu_sub(val, false);
        self.a = saved_a;
    }

    /// ANA: A = A & val
    fn alu_and(&mut self, val: u8) {
        // AC is set to the OR of bit 3 of the operands (8080 quirk)
        self.flags.aux_carry = ((self.a | val) & 0x08) != 0;
        self.a &= val;
        self.flags.carry = false;
        self.set_flags_zsp(self.a);
    }

    /// ORA: A = A | val
    fn alu_or(&mut self, val: u8) {
        self.a |= val;
        self.flags.carry = false;
        self.flags.aux_carry = false;
        self.set_flags_zsp(self.a);
    }

    /// XRA: A = A ^ val
    fn alu_xor(&mut self, val: u8) {
        self.a ^= val;
        self.flags.carry = false;
        self.flags.aux_carry = false;
        self.set_flags_zsp(self.a);
    }

    /// INR: increment register (does NOT affect carry).
    fn alu_inr(&mut self, val: u8) -> u8 {
        let result = val.wrapping_add(1);
        self.flags.aux_carry = (val & 0x0F) + 1 > 0x0F;
        self.set_flags_zsp(result);
        result
    }

    /// DCR: decrement register (does NOT affect carry).
    fn alu_dcr(&mut self, val: u8) -> u8 {
        let result = val.wrapping_sub(1);
        // AC = no borrow from bit 4 = low nibble was not 0
        self.flags.aux_carry = (val & 0x0F) != 0;
        self.set_flags_zsp(result);
        result
    }

    /// DAA: Decimal Adjust Accumulator (BCD correction).
    fn alu_daa(&mut self) {
        let mut add = 0u8;
        let mut new_carry = self.flags.carry;

        if (self.a & 0x0F) > 9 || self.flags.aux_carry {
            add += 0x06;
        }

        if (self.a >> 4) > 9 || self.flags.carry
            || ((self.a >> 4) >= 9 && (self.a & 0x0F) > 9)
        {
            add += 0x60;
            new_carry = true;
        }

        self.flags.aux_carry = ((self.a & 0x0F) + (add & 0x0F)) > 0x0F;
        let result = self.a as u16 + add as u16;
        self.a = result as u8;
        self.flags.carry = new_carry;
        self.set_flags_zsp(self.a);
    }

    // ── Condition checking ─────────────────────────────────────────

    /// Check condition code (3-bit, from opcode bits 5-3).
    fn check_condition(&self, cond: u8) -> bool {
        match cond & 7 {
            0 => !self.flags.zero,     // NZ
            1 => self.flags.zero,      // Z
            2 => !self.flags.carry,    // NC
            3 => self.flags.carry,     // C
            4 => !self.flags.parity,   // PO (odd)
            5 => self.flags.parity,    // PE (even)
            6 => !self.flags.sign,     // P  (positive)
            7 => self.flags.sign,      // M  (minus)
            _ => unreachable!(),
        }
    }

    // ── Interrupt ──────────────────────────────────────────────────

    /// Generate an interrupt (RST instruction injected by hardware).
    pub fn interrupt(&mut self, vector: u8) {
        if !self.inte {
            return;
        }
        self.inte = false;
        self.halted = false;
        self.push_word(self.pc);
        self.pc = (vector as u16) * 8;
        self.cycles += 11;
    }

    // ── Execute one instruction ────────────────────────────────────

    /// Execute a single instruction. Calls `port_in` for IN and
    /// `port_out` for OUT instructions. Returns cycles consumed.
    pub fn execute(
        &mut self,
        port_in: &dyn Fn(u8) -> u8,
        port_out: &mut dyn FnMut(u8, u8),
    ) -> u32 {
        if self.halted {
            return 4;
        }

        let opcode = self.fetch_byte();
        let cycles = self.dispatch(opcode, port_in, port_out);
        self.cycles += cycles as u64;
        cycles
    }

    /// Dispatch a single opcode. Returns cycles consumed.
    fn dispatch(
        &mut self,
        opcode: u8,
        port_in: &dyn Fn(u8) -> u8,
        port_out: &mut dyn FnMut(u8, u8),
    ) -> u32 {
        match opcode {
            // ── NOP (+ undocumented aliases) ───────────────────────
            0x00 | 0x08 | 0x10 | 0x18 | 0x20 | 0x28 | 0x30 | 0x38 => 4,

            // ── LXI rp, d16 ───────────────────────────────────────
            0x01 | 0x11 | 0x21 | 0x31 => {
                let val = self.fetch_word();
                let rp = (opcode >> 4) & 3;
                self.set_rp(rp, val);
                10
            }

            // ── STAX B ────────────────────────────────────────────
            0x02 => {
                let addr = self.get_bc();
                self.write_byte(addr, self.a);
                7
            }

            // ── INX rp ────────────────────────────────────────────
            0x03 | 0x13 | 0x23 | 0x33 => {
                let rp = (opcode >> 4) & 3;
                let val = self.get_rp(rp).wrapping_add(1);
                self.set_rp(rp, val);
                5
            }

            // ── INR r ─────────────────────────────────────────────
            0x04 | 0x0C | 0x14 | 0x1C | 0x24 | 0x2C | 0x34 | 0x3C => {
                let reg = (opcode >> 3) & 7;
                let val = self.get_reg(reg);
                let result = self.alu_inr(val);
                self.set_reg(reg, result);
                if reg == 6 { 10 } else { 5 }
            }

            // ── DCR r ─────────────────────────────────────────────
            0x05 | 0x0D | 0x15 | 0x1D | 0x25 | 0x2D | 0x35 | 0x3D => {
                let reg = (opcode >> 3) & 7;
                let val = self.get_reg(reg);
                let result = self.alu_dcr(val);
                self.set_reg(reg, result);
                if reg == 6 { 10 } else { 5 }
            }

            // ── MVI r, d8 ─────────────────────────────────────────
            0x06 | 0x0E | 0x16 | 0x1E | 0x26 | 0x2E | 0x36 | 0x3E => {
                let val = self.fetch_byte();
                let reg = (opcode >> 3) & 7;
                self.set_reg(reg, val);
                if reg == 6 { 10 } else { 7 }
            }

            // ── RLC (rotate A left) ──────────────────────────────
            0x07 => {
                self.flags.carry = self.a & 0x80 != 0;
                self.a = (self.a << 1) | (if self.flags.carry { 1 } else { 0 });
                4
            }

            // ── DAD rp ───────────────────────────────────────────
            0x09 | 0x19 | 0x29 | 0x39 => {
                let rp = (opcode >> 4) & 3;
                let val = self.get_rp(rp) as u32;
                let hl = self.get_hl() as u32;
                let result = hl + val;
                self.flags.carry = result > 0xFFFF;
                self.set_hl(result as u16);
                10
            }

            // ── LDAX B ───────────────────────────────────────────
            0x0A => {
                let addr = self.get_bc();
                self.a = self.read_byte(addr);
                7
            }

            // ── DCX rp ───────────────────────────────────────────
            0x0B | 0x1B | 0x2B | 0x3B => {
                let rp = (opcode >> 4) & 3;
                let val = self.get_rp(rp).wrapping_sub(1);
                self.set_rp(rp, val);
                5
            }

            // ── RRC (rotate A right) ─────────────────────────────
            0x0F => {
                self.flags.carry = self.a & 1 != 0;
                self.a = (self.a >> 1) | (if self.flags.carry { 0x80 } else { 0 });
                4
            }

            // ── STAX D ───────────────────────────────────────────
            0x12 => {
                let addr = self.get_de();
                self.write_byte(addr, self.a);
                7
            }

            // ── RAL (rotate A left through carry) ────────────────
            0x17 => {
                let old_carry = self.flags.carry;
                self.flags.carry = self.a & 0x80 != 0;
                self.a = (self.a << 1) | (if old_carry { 1 } else { 0 });
                4
            }

            // ── LDAX D ───────────────────────────────────────────
            0x1A => {
                let addr = self.get_de();
                self.a = self.read_byte(addr);
                7
            }

            // ── RAR (rotate A right through carry) ───────────────
            0x1F => {
                let old_carry = self.flags.carry;
                self.flags.carry = self.a & 1 != 0;
                self.a = (self.a >> 1) | (if old_carry { 0x80 } else { 0 });
                4
            }

            // ── SHLD a16 ─────────────────────────────────────────
            0x22 => {
                let addr = self.fetch_word();
                self.write_word(addr, self.get_hl());
                16
            }

            // ── DAA ──────────────────────────────────────────────
            0x27 => {
                self.alu_daa();
                4
            }

            // ── LHLD a16 ─────────────────────────────────────────
            0x2A => {
                let addr = self.fetch_word();
                let val = self.read_word(addr);
                self.set_hl(val);
                16
            }

            // ── CMA (complement A) ──────────────────────────────
            0x2F => {
                self.a = !self.a;
                4
            }

            // ── STA a16 ──────────────────────────────────────────
            0x32 => {
                let addr = self.fetch_word();
                self.write_byte(addr, self.a);
                13
            }

            // ── STC (set carry) ──────────────────────────────────
            0x37 => {
                self.flags.carry = true;
                4
            }

            // ── LDA a16 ──────────────────────────────────────────
            0x3A => {
                let addr = self.fetch_word();
                self.a = self.read_byte(addr);
                13
            }

            // ── CMC (complement carry) ───────────────────────────
            0x3F => {
                self.flags.carry = !self.flags.carry;
                4
            }

            // ── MOV family (0x40-0x7F, except HLT=0x76) ─────────
            0x76 => {
                self.halted = true;
                7
            }

            0x40..=0x75 | 0x77..=0x7F => {
                let dst = (opcode >> 3) & 7;
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.set_reg(dst, val);
                if src == 6 || dst == 6 { 7 } else { 5 }
            }

            // ── ADD r ────────────────────────────────────────────
            0x80..=0x87 => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_add(val, false);
                if src == 6 { 7 } else { 4 }
            }

            // ── ADC r ────────────────────────────────────────────
            0x88..=0x8F => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_add(val, true);
                if src == 6 { 7 } else { 4 }
            }

            // ── SUB r ────────────────────────────────────────────
            0x90..=0x97 => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_sub(val, false);
                if src == 6 { 7 } else { 4 }
            }

            // ── SBB r ────────────────────────────────────────────
            0x98..=0x9F => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_sub(val, true);
                if src == 6 { 7 } else { 4 }
            }

            // ── ANA r ────────────────────────────────────────────
            0xA0..=0xA7 => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_and(val);
                if src == 6 { 7 } else { 4 }
            }

            // ── XRA r ────────────────────────────────────────────
            0xA8..=0xAF => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_xor(val);
                if src == 6 { 7 } else { 4 }
            }

            // ── ORA r ────────────────────────────────────────────
            0xB0..=0xB7 => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_or(val);
                if src == 6 { 7 } else { 4 }
            }

            // ── CMP r ────────────────────────────────────────────
            0xB8..=0xBF => {
                let src = opcode & 7;
                let val = self.get_reg(src);
                self.alu_cmp(val);
                if src == 6 { 7 } else { 4 }
            }

            // ── Conditional RET ──────────────────────────────────
            0xC0 | 0xC8 | 0xD0 | 0xD8 | 0xE0 | 0xE8 | 0xF0 | 0xF8 => {
                let cond = (opcode >> 3) & 7;
                if self.check_condition(cond) {
                    self.pc = self.pop_word();
                    11
                } else {
                    5
                }
            }

            // ── POP rp ──────────────────────────────────────────
            0xC1 => {
                let val = self.pop_word();
                self.set_bc(val);
                10
            }
            0xD1 => {
                let val = self.pop_word();
                self.set_de(val);
                10
            }
            0xE1 => {
                let val = self.pop_word();
                self.set_hl(val);
                10
            }
            0xF1 => {
                // POP PSW: low byte = flags, high byte = A
                let val = self.pop_word();
                self.set_psw(val as u8);
                self.a = (val >> 8) as u8;
                10
            }

            // ── Conditional JMP ─────────────────────────────────
            0xC2 | 0xCA | 0xD2 | 0xDA | 0xE2 | 0xEA | 0xF2 | 0xFA => {
                let addr = self.fetch_word();
                let cond = (opcode >> 3) & 7;
                if self.check_condition(cond) {
                    self.pc = addr;
                }
                10
            }

            // ── JMP a16 (+ undocumented 0xCB) ───────────────────
            0xC3 | 0xCB => {
                self.pc = self.fetch_word();
                10
            }

            // ── Conditional CALL ─────────────────────────────────
            0xC4 | 0xCC | 0xD4 | 0xDC | 0xE4 | 0xEC | 0xF4 | 0xFC => {
                let addr = self.fetch_word();
                let cond = (opcode >> 3) & 7;
                if self.check_condition(cond) {
                    self.push_word(self.pc);
                    self.pc = addr;
                    17
                } else {
                    11
                }
            }

            // ── PUSH rp ─────────────────────────────────────────
            0xC5 => {
                let val = self.get_bc();
                self.push_word(val);
                11
            }
            0xD5 => {
                let val = self.get_de();
                self.push_word(val);
                11
            }
            0xE5 => {
                let val = self.get_hl();
                self.push_word(val);
                11
            }
            0xF5 => {
                // PUSH PSW: high byte = A, low byte = flags
                let val = (self.a as u16) << 8 | self.get_psw() as u16;
                self.push_word(val);
                11
            }

            // ── ADI d8 ──────────────────────────────────────────
            0xC6 => {
                let val = self.fetch_byte();
                self.alu_add(val, false);
                7
            }

            // ── RST n ───────────────────────────────────────────
            0xC7 | 0xCF | 0xD7 | 0xDF | 0xE7 | 0xEF | 0xF7 | 0xFF => {
                let vector = opcode & 0x38; // bits 5-3 shifted to address
                self.push_word(self.pc);
                self.pc = vector as u16;
                11
            }

            // ── RET (+ undocumented 0xD9) ───────────────────────
            0xC9 | 0xD9 => {
                self.pc = self.pop_word();
                10
            }

            // ── CALL a16 (+ undocumented 0xDD, 0xED, 0xFD) ─────
            0xCD | 0xDD | 0xED | 0xFD => {
                let addr = self.fetch_word();
                self.push_word(self.pc);
                self.pc = addr;
                17
            }

            // ── ACI d8 ──────────────────────────────────────────
            0xCE => {
                let val = self.fetch_byte();
                self.alu_add(val, true);
                7
            }

            // ── OUT d8 ──────────────────────────────────────────
            0xD3 => {
                let port = self.fetch_byte();
                port_out(port, self.a);
                10
            }

            // ── SUI d8 ──────────────────────────────────────────
            0xD6 => {
                let val = self.fetch_byte();
                self.alu_sub(val, false);
                7
            }

            // ── IN d8 ───────────────────────────────────────────
            0xDB => {
                let port = self.fetch_byte();
                self.a = port_in(port);
                10
            }

            // ── SBI d8 ──────────────────────────────────────────
            0xDE => {
                let val = self.fetch_byte();
                self.alu_sub(val, true);
                7
            }

            // ── XTHL ────────────────────────────────────────────
            0xE3 => {
                let stack_val = self.read_word(self.sp);
                let hl = self.get_hl();
                self.write_word(self.sp, hl);
                self.set_hl(stack_val);
                18
            }

            // ── ANI d8 ──────────────────────────────────────────
            0xE6 => {
                let val = self.fetch_byte();
                self.alu_and(val);
                7
            }

            // ── PCHL ────────────────────────────────────────────
            0xE9 => {
                self.pc = self.get_hl();
                5
            }

            // ── XCHG ────────────────────────────────────────────
            0xEB => {
                let de = self.get_de();
                let hl = self.get_hl();
                self.set_de(hl);
                self.set_hl(de);
                5
            }

            // ── XRI d8 ──────────────────────────────────────────
            0xEE => {
                let val = self.fetch_byte();
                self.alu_xor(val);
                7
            }

            // ── DI (disable interrupts) ─────────────────────────
            0xF3 => {
                self.inte = false;
                4
            }

            // ── ORI d8 ──────────────────────────────────────────
            0xF6 => {
                let val = self.fetch_byte();
                self.alu_or(val);
                7
            }

            // ── SPHL ────────────────────────────────────────────
            0xF9 => {
                self.sp = self.get_hl();
                5
            }

            // ── EI (enable interrupts) ──────────────────────────
            0xFB => {
                self.inte = true;
                4
            }

            // ── CPI d8 ──────────────────────────────────────────
            0xFE => {
                let val = self.fetch_byte();
                self.alu_cmp(val);
                7
            }

            // All 256 opcodes covered above — this is unreachable.
            // Kept for compiler completeness.
            #[allow(unreachable_patterns)]
            _ => 4,
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn noop_port_in(_port: u8) -> u8 { 0 }

    fn run_program(cpu: &mut Cpu, program: &[u8]) {
        cpu.memory[..program.len()].copy_from_slice(program);
        cpu.pc = 0;
        let port_in = |_: u8| -> u8 { 0 };
        let mut port_out = |_: u8, _: u8| {};
        while (cpu.pc as usize) < program.len() {
            cpu.execute(&port_in, &mut port_out);
        }
    }

    #[test]
    fn test_nop() {
        let mut cpu = Cpu::new();
        cpu.memory[0] = 0x00; // NOP
        let port_in = noop_port_in;
        let mut port_out = |_: u8, _: u8| {};
        let cycles = cpu.execute(&port_in, &mut port_out);
        assert_eq!(cycles, 4);
        assert_eq!(cpu.pc, 1);
    }

    #[test]
    fn test_mvi_and_add() {
        let mut cpu = Cpu::new();
        // MVI A, 0x10; MVI B, 0x20; ADD B
        run_program(&mut cpu, &[0x3E, 0x10, 0x06, 0x20, 0x80]);
        assert_eq!(cpu.a, 0x30);
        assert!(!cpu.flags.zero);
        assert!(!cpu.flags.carry);
    }

    #[test]
    fn test_add_carry() {
        let mut cpu = Cpu::new();
        // MVI A, 0xFF; MVI B, 0x01; ADD B
        run_program(&mut cpu, &[0x3E, 0xFF, 0x06, 0x01, 0x80]);
        assert_eq!(cpu.a, 0x00);
        assert!(cpu.flags.zero);
        assert!(cpu.flags.carry);
    }

    #[test]
    fn test_sub() {
        let mut cpu = Cpu::new();
        // MVI A, 0x10; MVI B, 0x05; SUB B
        run_program(&mut cpu, &[0x3E, 0x10, 0x06, 0x05, 0x90]);
        assert_eq!(cpu.a, 0x0B);
        assert!(!cpu.flags.zero);
        assert!(!cpu.flags.carry);
    }

    #[test]
    fn test_jmp() {
        let mut cpu = Cpu::new();
        // MVI A, 0x42; JMP 0x0006; MVI A, 0xFF; <target> NOP
        cpu.memory[0] = 0x3E; cpu.memory[1] = 0x42; // MVI A, 0x42
        cpu.memory[2] = 0xC3; cpu.memory[3] = 0x06; cpu.memory[4] = 0x00; // JMP 0x0006
        cpu.memory[5] = 0x3E; // MVI A, 0xFF (should be skipped)
        cpu.memory[6] = 0x00; // NOP (target)
        cpu.pc = 0;
        let port_in = noop_port_in;
        let mut port_out = |_: u8, _: u8| {};
        for _ in 0..3 {
            cpu.execute(&port_in, &mut port_out);
        }
        assert_eq!(cpu.a, 0x42); // Should NOT be 0xFF
    }

    #[test]
    fn test_push_pop() {
        let mut cpu = Cpu::new();
        cpu.sp = 0x3000;
        cpu.b = 0x12;
        cpu.c = 0x34;
        // PUSH B; POP D
        run_program(&mut cpu, &[0xC5, 0xD1]);
        assert_eq!(cpu.d, 0x12);
        assert_eq!(cpu.e, 0x34);
    }

    #[test]
    fn test_inr_dcr() {
        let mut cpu = Cpu::new();
        // MVI B, 0xFF; INR B
        run_program(&mut cpu, &[0x06, 0xFF, 0x04]);
        assert_eq!(cpu.b, 0x00);
        assert!(cpu.flags.zero);
    }

    #[test]
    fn test_ana_flags() {
        let mut cpu = Cpu::new();
        // MVI A, 0x0F; ANI 0xF0
        run_program(&mut cpu, &[0x3E, 0x0F, 0xE6, 0xF0]);
        assert_eq!(cpu.a, 0x00);
        assert!(cpu.flags.zero);
        assert!(!cpu.flags.carry);
    }

    #[test]
    fn test_call_ret() {
        let mut cpu = Cpu::new();
        cpu.sp = 0x3000;
        // CALL 0x0005; HLT; <at 0x0005> MVI A, 0x99; RET
        cpu.memory[0] = 0xCD; cpu.memory[1] = 0x05; cpu.memory[2] = 0x00; // CALL 0x0005
        cpu.memory[3] = 0x76; // HLT
        cpu.memory[5] = 0x3E; cpu.memory[6] = 0x99; // MVI A, 0x99
        cpu.memory[7] = 0xC9; // RET
        cpu.pc = 0;
        let port_in = noop_port_in;
        let mut port_out = |_: u8, _: u8| {};
        for _ in 0..4 {
            cpu.execute(&port_in, &mut port_out);
        }
        assert_eq!(cpu.a, 0x99);
        assert!(cpu.halted);
    }

    #[test]
    fn test_parity() {
        assert!(parity(0x00));  // 0 bits set — even
        assert!(!parity(0x01)); // 1 bit set — odd
        assert!(parity(0x03));  // 2 bits set — even
        assert!(!parity(0x07)); // 3 bits set — odd
    }

    #[test]
    fn test_lxi_and_memory() {
        let mut cpu = Cpu::new();
        // LXI H, 0x2400; MVI M, 0xAB
        run_program(&mut cpu, &[0x21, 0x00, 0x24, 0x36, 0xAB]);
        assert_eq!(cpu.h, 0x24);
        assert_eq!(cpu.l, 0x00);
        assert_eq!(cpu.memory[0x2400], 0xAB);
    }

    #[test]
    fn test_xchg() {
        let mut cpu = Cpu::new();
        // LXI D, 0x1234; LXI H, 0x5678; XCHG
        run_program(&mut cpu, &[0x11, 0x34, 0x12, 0x21, 0x78, 0x56, 0xEB]);
        assert_eq!(cpu.get_de(), 0x5678);
        assert_eq!(cpu.get_hl(), 0x1234);
    }

    #[test]
    fn test_rotate_left() {
        let mut cpu = Cpu::new();
        // MVI A, 0x80; RLC
        run_program(&mut cpu, &[0x3E, 0x80, 0x07]);
        assert_eq!(cpu.a, 0x01);
        assert!(cpu.flags.carry);
    }

    #[test]
    fn test_interrupt() {
        let mut cpu = Cpu::new();
        cpu.inte = true;
        cpu.sp = 0x3000;
        cpu.pc = 0x1000;
        cpu.interrupt(1); // RST 1 → jump to 0x0008
        assert_eq!(cpu.pc, 0x0008);
        assert!(!cpu.inte); // Interrupts disabled after handling
    }
}
