# Space Invaders — CUP WASM Emulator

A Progressive Web App that emulates the **Space Invaders arcade machine** (Taito, 1978) using codeupipe's polyglot architecture.

## Architecture

```
┌─────────────────────────────────────────┐
│              PWA Shell                  │
│  (manifest.json, sw.js, index.html)     │
├─────────────────────────────────────────┤
│       CUP JS Pipeline (cup-pipe.js)    │
│  ReadInput → Execute → Render → Audio   │
├─────────────────────────────────────────┤
│        WASM Bridge (wasm-bindgen)       │
├─────────────────────────────────────────┤
│   Rust Intel 8080 CPU Emulator Core    │
│  (cpu.rs — all 256 opcodes)             │
│  (machine.rs — memory map, I/O, shift) │
└─────────────────────────────────────────┘
```

### Why This Architecture

- **Rust/WASM**: The Intel 8080 CPU executes ~33,333 cycles per frame at 60fps — pure computation with zero DOM access. WASM gives near-native speed for the tight decode-execute loop.
- **CUP JS Pipeline**: Frame processing is a clean pipeline: `ReadInput → ExecuteFrame → RenderFrame → UpdateAudio`. Each filter is a single-responsibility CUP filter.
- **PWA**: Once the ROM is cached, the game works completely offline. Install it to your home screen.

## Hardware Emulated

| Component | Original | Emulation |
|-----------|----------|-----------|
| CPU | Intel 8080 @ 2 MHz | Rust → WASM (all 256 opcodes) |
| Display | 256×224 mono CRT, rotated 90° CCW | Canvas 224×256, color overlay |
| Sound | Discrete analog circuits | Web Audio API (synthesized) |
| Input | Coin + joystick + fire | Keyboard + touch controls |
| Shift Register | Custom barrel shifter IC | Emulated in machine.rs |

## Prerequisites

- [Rust](https://rustup.rs/) toolchain
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
```

## Build

```bash
./build.sh
```

## Run

```bash
cd www
python3 -m http.server 8080
# Open http://localhost:8080
```

## ROM Files

This emulator does not include any ROM files. You must provide your own Space Invaders ROM. The emulator accepts:

- A single `invaders.rom` (8KB combined binary)
- The 4 individual ROM chip files: `invaders.h`, `invaders.g`, `invaders.f`, `invaders.e`

Drop the file(s) onto the loader screen or use the file picker.

This project also includes a **homebrew playable ROM** (`game.rom`) that imitates the original game feel while staying clean-room. Click **▶ Play Game** on the loader screen to start.

For developers, 7 incremental step ROMs are available under the "Developer step ROMs" toggle:

- `step_01_boot_clear.rom` – `step_07_edge_reverse.rom`

All ROMs are generated from assembly in `rom/steps/` via `./build.sh`.

## Incremental ROM Workflow (Fast Feedback)

The ROM workflow is intentionally split into tiny milestones so each step validates in seconds.

```bash
# 1) Validate all current ROM milestones (build + probe + pass/fail ranges)
python3 rom/validate_steps.py

# 2) Validate a single step while iterating
python3 rom/validate_steps.py --step step_02_player_bunkers

# 3) Build one step ROM into the web app output
python3 rom/build.py --step 3

# 4) Probe one ROM directly for hard numbers
cargo run --quiet --bin rom_probe -- rom/generated/step_03_invader_row.rom --frames 12
```

Validation currently checks lit-pixel ranges per step:

- Step 01: boot + clear + tiny player marker
- Step 02: player + bunker layout
- Step 03: static invader row formation
- Step 04: invader row marching loop
- Step 05: player input-driven movement loop
- Step 06: fire + bullet travel + byte-level hit clearing
- Step 07: edge detection + direction reversal + descend behavior

Next steps to imitate more of the arcade behavior:

1. Score and lives memory map compatible with original flow
2. Distinct invader classes and multi-row fleet behavior
3. Enemy projectile loop and bunker erosion logic
4. Start/coin state transitions and round reset behavior

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Insert Coin | `C` | 🪙 button |
| 1P Start | `Enter` | ▶️ button |
| Move Left | `←` or `A` | ◀ button |
| Move Right | `→` or `D` | ▶ button |
| Fire | `Space` or `↑` | ● button |
| Pause | `P` | ⏸ button |

## Project Structure

```
examples/space-invaders/
├── Cargo.toml           # Rust crate manifest
├── build.sh             # WASM build script
├── rom/
│   ├── assembler.py      # Minimal Intel 8080 assembler
│   ├── build.py          # Build one step ROM into 8KB image
│   ├── validate_steps.py # Fast milestone validator
│   └── steps/
│       ├── step_01_boot_clear.asm
│       ├── step_02_player_bunkers.asm
│       ├── step_03_invader_row.asm
│       ├── step_04_invader_march.asm
│       ├── step_05_player_move.asm
│       ├── step_06_shot_hit.asm
│       └── step_07_edge_reverse.asm
├── src/
│   ├── lib.rs           # WASM bindings (wasm-bindgen)
│   ├── cpu.rs           # Intel 8080 CPU (all 256 opcodes + tests)
│   ├── machine.rs       # Space Invaders machine (memory, I/O, shift register)
│   └── bin/rom_probe.rs # CLI probe for lit pixels, bbox, cycle counts
└── www/                 # PWA static files
    ├── index.html       # App shell
    ├── manifest.json    # PWA manifest
    ├── sw.js            # Service worker (offline caching)
    ├── css/game.css     # Dark theme styling
    └── js/
        ├── cup-pipe.js  # CUP JS pipeline runtime
        ├── game.js      # Main orchestrator (boot, game loop, WASM init)
        └── filters/
            ├── load_rom.js       # ROM file loading + IndexedDB caching
            ├── read_input.js     # Keyboard/touch → machine input ports
            ├── execute_frame.js  # Run ~33,333 CPU cycles
            ├── render_frame.js   # VRAM → Canvas (putImageData)
            └── update_audio.js   # Sound port → Web Audio synthesis
```

## CUP Pipeline

Two pipelines orchestrate the emulator:

### Init Pipeline
```
LoadRom → (ROM bytes loaded into WASM machine)
```

### Frame Pipeline (runs at 60fps via requestAnimationFrame)
```
ReadInput → ExecuteFrame → RenderFrame → UpdateAudio
```

Each filter follows the CUP contract: `call(payload) → payload`. The pipeline handles timing instrumentation automatically.

## Testing

```bash
# Run Rust unit tests (CPU opcodes, machine I/O, shift register)
cargo test

# Run WASM tests (requires wasm-pack)
wasm-pack test --headless --chrome
```
