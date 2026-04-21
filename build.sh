#!/usr/bin/env bash
# Build the Space Invaders WASM emulator and copy output to www/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building Space Invaders WASM Emulator ==="

# Check for wasm-pack
if ! command -v wasm-pack &>/dev/null; then
  echo "ERROR: wasm-pack not found. Install with:"
  echo "  cargo install wasm-pack"
  echo "  # or: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
  exit 1
fi

# Build WASM
echo "→ Building Rust → WASM (release)..."
wasm-pack build --target web --features wasm

# Copy WASM output to www/
echo "→ Copying WASM artifacts to www/wasm/..."
mkdir -p www/wasm
cp pkg/space_invaders_emu_bg.wasm www/wasm/
cp pkg/space_invaders_emu.js www/wasm/

# Build quick-feedback step ROMs for the loader buttons.
echo "→ Building step ROM milestones to www/roms/..."
python3 rom/build.py --step 1 >/dev/null
python3 rom/build.py --step 2 >/dev/null
python3 rom/build.py --step 3 >/dev/null
python3 rom/build.py --step 4 >/dev/null
python3 rom/build.py --step 5 >/dev/null
python3 rom/build.py --step 6 >/dev/null
python3 rom/build.py --step 7 >/dev/null

# Build the canonical playable game ROM (Step 7 = complete game).
echo "→ Building game.rom (playable homebrew)..."
python3 rom/build.py --step 7 --output www/roms/game.rom >/dev/null

echo ""
echo "=== Build complete ==="
echo ""
echo "To run:"
echo "  cd www && python3 -m http.server 8080"
echo "  # Open http://localhost:8080"
echo ""
echo "Then either:"
echo "  1) click 'Play Game' to start the homebrew ROM"
echo "  2) expand the dev steps to load individual milestones"
echo "  3) or load your own ROM file (invaders.rom or the 4 chip files)"
