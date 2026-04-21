#!/usr/bin/env python3
"""Minimal Intel 8080 assembler for the Space Invaders homebrew ROM steps.

Supported features:
- Labels: label:
- Directives: .org, .byte, .word, .fill
- Numeric formats: 123, 0x7B, $7B, 7Bh, 'A'
- Expressions: +, -, |, &, <<, >>, unary +/-/~
- Common 8080 mnemonics used by the step ROMs
"""

from __future__ import annotations

import argparse
import ast
import operator
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


REG_CODES = {
    "B": 0,
    "C": 1,
    "D": 2,
    "E": 3,
    "H": 4,
    "L": 5,
    "M": 6,
    "A": 7,
}

RP_CODES = {
    "B": 0,
    "BC": 0,
    "D": 1,
    "DE": 1,
    "H": 2,
    "HL": 2,
    "SP": 3,
}

PUSH_POP_CODES = {
    "B": 0,
    "BC": 0,
    "D": 1,
    "DE": 1,
    "H": 2,
    "HL": 2,
    "PSW": 3,
    "A": 3,
}

JCC_CODES = {
    "JNZ": 0xC2,
    "JZ": 0xCA,
    "JNC": 0xD2,
    "JC": 0xDA,
    "JPO": 0xE2,
    "JPE": 0xEA,
    "JP": 0xF2,
    "JM": 0xFA,
}

CALLCC_CODES = {
    "CNZ": 0xC4,
    "CZ": 0xCC,
    "CNC": 0xD4,
    "CC": 0xDC,
    "CPO": 0xE4,
    "CPE": 0xEC,
    "CP": 0xF4,
    "CM": 0xFC,
}

RETCC_CODES = {
    "RNZ": 0xC0,
    "RZ": 0xC8,
    "RNC": 0xD0,
    "RC": 0xD8,
    "RPO": 0xE0,
    "RPE": 0xE8,
    "RP": 0xF0,
    "RM": 0xF8,
}

ALU_OP_BASE = {
    "ADD": 0x80,
    "ADC": 0x88,
    "SUB": 0x90,
    "SBB": 0x98,
    "ANA": 0xA0,
    "XRA": 0xA8,
    "ORA": 0xB0,
    "CMP": 0xB8,
}

IMM_ALU = {
    "ADI": 0xC6,
    "ACI": 0xCE,
    "SUI": 0xD6,
    "SBI": 0xDE,
    "ANI": 0xE6,
    "XRI": 0xEE,
    "ORI": 0xF6,
    "CPI": 0xFE,
}

NO_ARG_OPCODES = {
    "NOP": 0x00,
    "RLC": 0x07,
    "RRC": 0x0F,
    "RAL": 0x17,
    "RAR": 0x1F,
    "DAA": 0x27,
    "CMA": 0x2F,
    "STC": 0x37,
    "CMC": 0x3F,
    "HLT": 0x76,
    "RET": 0xC9,
    "PCHL": 0xE9,
    "XCHG": 0xEB,
    "XTHL": 0xE3,
    "SPHL": 0xF9,
    "DI": 0xF3,
    "EI": 0xFB,
}


@dataclass
class ParsedLine:
    line_no: int
    label: Optional[str]
    op: Optional[str]
    operands: List[str]
    raw: str


def _clean_comment(line: str) -> str:
    return line.split(";", 1)[0].rstrip()


def _split_operands(text: str) -> List[str]:
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def parse_lines(text: str) -> List[ParsedLine]:
    parsed: List[ParsedLine] = []

    for i, src in enumerate(text.splitlines(), start=1):
        line = _clean_comment(src).strip()
        if not line:
            continue

        label = None
        rest = line
        if ":" in line:
            maybe_label, tail = line.split(":", 1)
            if maybe_label.strip():
                label = maybe_label.strip()
                rest = tail.strip()

        if not rest:
            parsed.append(ParsedLine(i, label, None, [], src))
            continue

        parts = rest.split(None, 1)
        op = parts[0].upper()
        ops_text = parts[1].strip() if len(parts) > 1 else ""
        operands = _split_operands(ops_text)

        parsed.append(ParsedLine(i, label, op, operands, src))

    return parsed


def _normalize_hex_notation(expr: str) -> str:
    # $1234 -> 0x1234
    expr = re.sub(r"\$([0-9A-Fa-f]+)", r"0x\1", expr)

    # 1234h -> 0x1234 (avoid matching identifier names by requiring leading digit)
    def repl(match: re.Match[str]) -> str:
        return str(int(match.group(1), 16))

    expr = re.sub(r"\b([0-9][0-9A-Fa-f]*)h\b", repl, expr, flags=re.IGNORECASE)
    return expr


def eval_expr(expr: str, symbols: Dict[str, int]) -> int:
    expr = _normalize_hex_notation(expr.strip())

    def _eval(node: ast.AST) -> int:
        if isinstance(node, ast.Expression):
            return _eval(node.body)

        if isinstance(node, ast.Constant):
            if isinstance(node.value, int):
                return node.value
            if isinstance(node.value, str) and len(node.value) == 1:
                return ord(node.value)
            raise ValueError(f"unsupported constant in expression: {expr}")

        if isinstance(node, ast.Name):
            if node.id in symbols:
                return symbols[node.id]
            raise KeyError(node.id)

        if isinstance(node, ast.UnaryOp):
            val = _eval(node.operand)
            unary = {
                ast.UAdd: operator.pos,
                ast.USub: operator.neg,
                ast.Invert: operator.invert,
            }
            fn = unary.get(type(node.op))
            if fn is None:
                raise ValueError(f"unsupported unary operator in: {expr}")
            return fn(val)

        if isinstance(node, ast.BinOp):
            left = _eval(node.left)
            right = _eval(node.right)
            binary = {
                ast.Add: operator.add,
                ast.Sub: operator.sub,
                ast.BitOr: operator.or_,
                ast.BitAnd: operator.and_,
                ast.LShift: operator.lshift,
                ast.RShift: operator.rshift,
            }
            fn = binary.get(type(node.op))
            if fn is None:
                raise ValueError(f"unsupported binary operator in: {expr}")
            return fn(left, right)

        raise ValueError(f"unsupported expression node in: {expr}")

    tree = ast.parse(expr, mode="eval")
    return _eval(tree)


def _reg(name: str) -> int:
    try:
        return REG_CODES[name.upper()]
    except KeyError as exc:
        raise ValueError(f"unknown register: {name}") from exc


def _rp(name: str) -> int:
    try:
        return RP_CODES[name.upper()]
    except KeyError as exc:
        raise ValueError(f"unknown register pair: {name}") from exc


def _pp(name: str) -> int:
    try:
        return PUSH_POP_CODES[name.upper()]
    except KeyError as exc:
        raise ValueError(f"unknown push/pop register pair: {name}") from exc


def instruction_size(op: str, operands: List[str]) -> int:
    op = op.upper()

    if op.startswith("."):
        if op == ".ORG":
            return 0
        if op == ".BYTE":
            return len(operands)
        if op == ".WORD":
            return len(operands) * 2
        if op == ".FILL":
            return 0  # resolved with expression in pass1
        raise ValueError(f"unsupported directive: {op}")

    if op in NO_ARG_OPCODES:
        return 1

    if op in RETCC_CODES:
        return 1

    if op in ("RST",):
        return 1

    if op in ("IN", "OUT"):
        return 2

    if op in IMM_ALU:
        return 2

    if op in ("MVI",):
        return 2

    if op in ("LXI", "STA", "LDA", "SHLD", "LHLD", "JMP", "CALL"):
        return 3

    if op in JCC_CODES or op in CALLCC_CODES:
        return 3

    if op in ("INX", "DCX", "DAD", "PUSH", "POP", "MOV", "INR", "DCR"):
        return 1

    if op in ALU_OP_BASE:
        return 1

    raise ValueError(f"unsupported instruction: {op}")


def encode_instruction(op: str, operands: List[str], symbols: Dict[str, int]) -> List[int]:
    op = op.upper()

    if op in NO_ARG_OPCODES:
        return [NO_ARG_OPCODES[op]]

    if op in RETCC_CODES:
        return [RETCC_CODES[op]]

    if op == "RST":
        if len(operands) != 1:
            raise ValueError("RST requires one operand")
        vec = eval_expr(operands[0], symbols)
        if not (0 <= vec <= 7):
            raise ValueError("RST vector must be 0..7")
        return [0xC7 + (vec << 3)]

    if op == "MOV":
        if len(operands) != 2:
            raise ValueError("MOV requires two operands")
        dst = _reg(operands[0])
        src = _reg(operands[1])
        return [0x40 + (dst << 3) + src]

    if op == "MVI":
        if len(operands) != 2:
            raise ValueError("MVI requires two operands")
        dst = _reg(operands[0])
        imm = eval_expr(operands[1], symbols) & 0xFF
        return [0x06 + (dst << 3), imm]

    if op == "LXI":
        if len(operands) != 2:
            raise ValueError("LXI requires two operands")
        rp = _rp(operands[0])
        val = eval_expr(operands[1], symbols) & 0xFFFF
        return [0x01 + (rp << 4), val & 0xFF, (val >> 8) & 0xFF]

    if op == "INX":
        rp = _rp(operands[0])
        return [0x03 + (rp << 4)]

    if op == "DCX":
        rp = _rp(operands[0])
        return [0x0B + (rp << 4)]

    if op == "DAD":
        rp = _rp(operands[0])
        return [0x09 + (rp << 4)]

    if op == "INR":
        r = _reg(operands[0])
        return [0x04 + (r << 3)]

    if op == "DCR":
        r = _reg(operands[0])
        return [0x05 + (r << 3)]

    if op in ALU_OP_BASE:
        r = _reg(operands[0])
        return [ALU_OP_BASE[op] + r]

    if op in IMM_ALU:
        imm = eval_expr(operands[0], symbols) & 0xFF
        return [IMM_ALU[op], imm]

    if op == "IN":
        port = eval_expr(operands[0], symbols) & 0xFF
        return [0xDB, port]

    if op == "OUT":
        port = eval_expr(operands[0], symbols) & 0xFF
        return [0xD3, port]

    if op == "STA":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0x32, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "LDA":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0x3A, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "SHLD":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0x22, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "LHLD":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0x2A, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "JMP":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0xC3, addr & 0xFF, (addr >> 8) & 0xFF]

    if op in JCC_CODES:
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        opc = JCC_CODES[op]
        return [opc, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "CALL":
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        return [0xCD, addr & 0xFF, (addr >> 8) & 0xFF]

    if op in CALLCC_CODES:
        addr = eval_expr(operands[0], symbols) & 0xFFFF
        opc = CALLCC_CODES[op]
        return [opc, addr & 0xFF, (addr >> 8) & 0xFF]

    if op == "PUSH":
        code = _pp(operands[0])
        return [0xC5 + (code << 4)]

    if op == "POP":
        code = _pp(operands[0])
        return [0xC1 + (code << 4)]

    raise ValueError(f"unsupported instruction in encoder: {op}")


def assemble(text: str) -> Tuple[bytes, Dict[str, int], int]:
    lines = parse_lines(text)
    symbols: Dict[str, int] = {}

    # Pass 1: label addresses
    addr = 0
    max_addr = 0

    for ln in lines:
        if ln.label:
            if ln.label in symbols:
                raise ValueError(f"line {ln.line_no}: duplicate label {ln.label}")
            symbols[ln.label] = addr

        if not ln.op:
            continue

        if ln.op == ".ORG":
            if len(ln.operands) != 1:
                raise ValueError(f"line {ln.line_no}: .org takes one operand")
            addr = eval_expr(ln.operands[0], symbols)
            max_addr = max(max_addr, addr)
            continue

        if ln.op == ".FILL":
            if len(ln.operands) != 2:
                raise ValueError(f"line {ln.line_no}: .fill takes two operands")
            count = eval_expr(ln.operands[0], symbols)
            if count < 0:
                raise ValueError(f"line {ln.line_no}: .fill count must be >= 0")
            addr += count
            max_addr = max(max_addr, addr)
            continue

        size = instruction_size(ln.op, ln.operands)
        addr += size
        max_addr = max(max_addr, addr)

    # Pass 2: emit bytes
    out = bytearray(max_addr if max_addr > 0 else 1)
    addr = 0
    high_water = 0

    def emit(byte_vals: Iterable[int]) -> None:
        nonlocal addr, high_water
        for b in byte_vals:
            if addr >= len(out):
                out.extend([0] * (addr - len(out) + 1))
            out[addr] = b & 0xFF
            addr += 1
            high_water = max(high_water, addr)

    for ln in lines:
        if not ln.op:
            continue

        if ln.op == ".ORG":
            addr = eval_expr(ln.operands[0], symbols)
            high_water = max(high_water, addr)
            continue

        if ln.op == ".BYTE":
            vals = [eval_expr(v, symbols) & 0xFF for v in ln.operands]
            emit(vals)
            continue

        if ln.op == ".WORD":
            words = []
            for v in ln.operands:
                w = eval_expr(v, symbols) & 0xFFFF
                words.extend([w & 0xFF, (w >> 8) & 0xFF])
            emit(words)
            continue

        if ln.op == ".FILL":
            count = eval_expr(ln.operands[0], symbols)
            fill_val = eval_expr(ln.operands[1], symbols) & 0xFF
            emit([fill_val] * count)
            continue

        emit(encode_instruction(ln.op, ln.operands, symbols))

    return bytes(out[:high_water]), symbols, high_water


def assemble_file(path: Path) -> Tuple[bytes, Dict[str, int], int]:
    text = path.read_text(encoding="utf-8")
    return assemble(text)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Assemble Intel 8080 source into ROM bytes")
    parser.add_argument("source", type=Path, help="input .asm file")
    parser.add_argument("-o", "--output", type=Path, required=True, help="output binary path")
    parser.add_argument("--pad", type=int, default=0, help="pad output to this size in bytes")
    args = parser.parse_args()

    image, symbols, used = assemble_file(args.source)

    if args.pad:
        if len(image) > args.pad:
            raise SystemExit(
                f"assembled image is {len(image)} bytes, larger than --pad {args.pad}"
            )
        image = image + bytes([0] * (args.pad - len(image)))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(image)

    print(f"assembled={args.source}")
    print(f"output={args.output}")
    print(f"bytes_used={used}")
    print(f"bytes_written={len(image)}")
    print(f"symbols={len(symbols)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
