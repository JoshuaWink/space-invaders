#!/usr/bin/env python3
"""Build step ROM images from assembly into 8KB Space Invaders-compatible binaries."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

from assembler import assemble_file


ROOT = Path(__file__).resolve().parents[1]
ROM_DIR = Path(__file__).resolve().parent
STEPS_DIR = ROM_DIR / "steps"
DEFAULT_OUT_DIR = ROOT / "www" / "roms"
ROM_SIZE = 0x2000  # 8192 bytes


def discover_steps() -> List[Path]:
    return sorted(STEPS_DIR.glob("step_*.asm"))


def resolve_step(step_arg: str | None) -> Path:
    steps = discover_steps()
    if not steps:
        raise SystemExit("No step assembly files found in rom/steps")

    if step_arg is None:
        return steps[-1]

    if step_arg.isdigit():
        n = int(step_arg)
        pattern = f"step_{n:02d}_*.asm"
        matches = sorted(STEPS_DIR.glob(pattern))
        if not matches:
            raise SystemExit(f"No step found for {pattern}")
        return matches[0]

    candidate = Path(step_arg)
    if candidate.exists():
        return candidate

    alt = STEPS_DIR / step_arg
    if alt.exists():
        return alt

    raise SystemExit(f"Could not resolve step: {step_arg}")


def build_step(step_file: Path, output: Path, pad_size: int = ROM_SIZE) -> None:
    image, symbols, used = assemble_file(step_file)

    if len(image) > pad_size:
        raise SystemExit(
            f"Assembled image too large: {len(image)} bytes (max {pad_size})"
        )

    padded = image + bytes([0] * (pad_size - len(image)))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(padded)

    print(f"step={step_file.name}")
    print(f"output={output}")
    print(f"bytes_used={used}")
    print(f"bytes_written={len(padded)}")
    print(f"symbols={len(symbols)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Space Invaders step ROM")
    parser.add_argument(
        "--step",
        default=None,
        help="step number (e.g. 1) or .asm path; default is latest step",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="output ROM path (default: www/roms/<step>.rom)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="list available step files",
    )
    args = parser.parse_args()

    if args.list:
        for path in discover_steps():
            print(path.name)
        return 0

    step_file = resolve_step(args.step)
    output = args.output or (DEFAULT_OUT_DIR / f"{step_file.stem}.rom")

    build_step(step_file, output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
