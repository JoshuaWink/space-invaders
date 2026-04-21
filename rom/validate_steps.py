#!/usr/bin/env python3
"""Fast feedback validator for ROM development steps.

Runs build + probe for each step and enforces simple lit-pixel ranges so we can
iterate with tight feedback loops.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROM_DIR = Path(__file__).resolve().parent
GEN_DIR = ROM_DIR / "generated"


@dataclass(frozen=True)
class StepExpectation:
    step_name: str
    lit_min: int
    lit_max: int


EXPECTATIONS = [
    StepExpectation("step_01_boot_clear", 1, 20),
    StepExpectation("step_02_player_bunkers", 30, 90),
    StepExpectation("step_03_invader_row", 100, 260),
    StepExpectation("step_04_invader_march", 100, 260),
    StepExpectation("step_05_player_move", 100, 260),
    StepExpectation("step_06_shot_hit", 100, 260),
    StepExpectation("step_07_edge_reverse", 180, 320),
]

PROBE_FRAMES = 12


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True, cwd=ROOT)


def parse_lit_pixels(stdout: str) -> int:
    match = re.search(r"lit_pixels=(\d+)", stdout)
    if not match:
        raise ValueError("Could not parse lit_pixels from rom_probe output")
    return int(match.group(1))


def validate_one(exp: StepExpectation) -> bool:
    rom_path = GEN_DIR / f"{exp.step_name}.rom"

    build_cmd = [
        sys.executable,
        str(ROM_DIR / "build.py"),
        "--step",
        f"{exp.step_name}.asm",
        "--output",
        str(rom_path),
    ]
    build = run(build_cmd)
    if build.returncode != 0:
        print(f"[FAIL] {exp.step_name}: build failed")
        print(build.stderr.strip())
        return False

    probe_cmd = [
        "cargo",
        "run",
        "--quiet",
        "--bin",
        "rom_probe",
        "--",
        str(rom_path),
        "--frames",
        str(PROBE_FRAMES),
    ]
    probe = run(probe_cmd)
    if probe.returncode != 0:
        print(f"[FAIL] {exp.step_name}: probe failed")
        print(probe.stderr.strip())
        return False

    try:
        lit = parse_lit_pixels(probe.stdout)
    except ValueError as err:
        print(f"[FAIL] {exp.step_name}: {err}")
        print(probe.stdout.strip())
        return False

    ok = exp.lit_min <= lit <= exp.lit_max
    if ok:
        print(
            f"[PASS] {exp.step_name}: lit_pixels={lit} "
            f"(expected {exp.lit_min}..{exp.lit_max})"
        )
        return True

    print(
        f"[FAIL] {exp.step_name}: lit_pixels={lit} "
        f"(expected {exp.lit_min}..{exp.lit_max})"
    )
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate incremental ROM steps")
    parser.add_argument(
        "--step",
        default=None,
        help="validate one step by stem name (e.g. step_02_player_bunkers)",
    )
    args = parser.parse_args()

    GEN_DIR.mkdir(parents=True, exist_ok=True)

    targets = EXPECTATIONS
    if args.step:
        targets = [exp for exp in EXPECTATIONS if exp.step_name == args.step]
        if not targets:
            raise SystemExit(f"Unknown step: {args.step}")

    ok = True
    for exp in targets:
        if not validate_one(exp):
            ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
