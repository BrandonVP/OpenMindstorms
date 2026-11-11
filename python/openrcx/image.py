"""NQC ``.rcx`` program images (RCXI file format)."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Union

RCXI_SIGNATURE = 0x49584352  # "RCXI"
RCXI_VERSION = 0x0102

CHUNK_TASK = 0
CHUNK_SUB = 1

SYMBOL_TASK = 0
SYMBOL_SUB = 1
SYMBOL_VAR = 2

TARGET_NAMES = {0: "RCX", 1: "CyberMaster", 2: "Scout", 3: "RCX2",
                4: "Spybotics", 5: "Swan"}


class ImageError(ValueError):
    pass


@dataclass
class Chunk:
    type: int
    number: int
    data: bytes
    name: str = ""

    @property
    def kind(self) -> str:
        return "task" if self.type == CHUNK_TASK else "sub"


@dataclass
class ProgramImage:
    target: int = 3
    chunks: List[Chunk] = field(default_factory=list)
    variables: dict = field(default_factory=dict)

    @property
    def size(self) -> int:
        return sum(len(c.data) for c in self.chunks)

    @property
    def target_name(self) -> str:
        return TARGET_NAMES.get(self.target, f"target {self.target}")

    def describe(self) -> str:
        lines = [f"{self.target_name} image, {len(self.chunks)} chunks, {self.size} bytes"]
        for c in self.chunks:
            nm = f" ({c.name})" if c.name else ""
            lines.append(f"  {c.kind} {c.number}{nm}: {len(c.data)} bytes")
        for idx, name in sorted(self.variables.items()):
            lines.append(f"  var {idx} = {name}")
        return "\n".join(lines)


def parse_rcx(data: bytes) -> ProgramImage:
    if len(data) < 12:
        raise ImageError("file too short")
    sig, ver, nchunks, nsyms, target, _res = struct.unpack_from("<IHHHBB", data, 0)
    if sig != RCXI_SIGNATURE:
        raise ImageError("not an RCXI file (bad signature)")
    if ver > RCXI_VERSION:
        raise ImageError(f"unsupported RCXI version 0x{ver:04x}")
    img = ProgramImage(target=target)
    pos = 12
    for _ in range(nchunks):
        if pos + 4 > len(data):
            raise ImageError("truncated chunk header")
        ctype, number, length = struct.unpack_from("<BBH", data, pos)
        pos += 4
        if ctype > 1:
            raise ImageError(f"unknown chunk type {ctype}")
        if pos + length > len(data):
            raise ImageError("truncated chunk data")
        img.chunks.append(Chunk(ctype, number, bytes(data[pos:pos + length])))
        pos += length + ((4 - length) & 3)
    for _ in range(nsyms):
        if pos + 4 > len(data):
            break
        stype, index, length, _res = struct.unpack_from("<BBBB", data, pos)
        pos += 4
        name = data[pos:pos + length].split(b"\x00", 1)[0].decode("ascii", "replace")
        pos += length
        if stype in (SYMBOL_TASK, SYMBOL_SUB):
            for c in img.chunks:
                if c.type == stype and c.number == index:
                    c.name = name
        elif stype == SYMBOL_VAR:
            img.variables[index] = name
    return img


def write_rcx(img: ProgramImage) -> bytes:
    out = bytearray(struct.pack("<IHHHBB", RCXI_SIGNATURE, RCXI_VERSION,
                                len(img.chunks), len(img.chunks) + len(img.variables),
                                img.target, 0))
    for c in img.chunks:
        out += struct.pack("<BBH", c.type, c.number, len(c.data))
        out += c.data
        out += b"\x00" * ((4 - len(c.data)) & 3)
    for c in img.chunks:
        nm = c.name.encode("ascii") + b"\x00" if c.name else b""
        out += struct.pack("<BBBB", c.type, c.number, len(nm), 0) + nm
    for idx, name in sorted(img.variables.items()):
        nm = name.encode("ascii") + b"\x00"
        out += struct.pack("<BBBB", SYMBOL_VAR, idx, len(nm), 0) + nm
    return bytes(out)


def load_rcx(path: Union[str, Path]) -> ProgramImage:
    return parse_rcx(Path(path).read_bytes())
