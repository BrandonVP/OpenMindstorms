"""Motorola S-record (.lgo) firmware images."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Union

MAX_FIRMWARE = 0x8000           # RCX RAM window (0x8000..0xFFFF)
FIRMWARE_CHECKSUM_SPAN = 0x4C00  # bytes the ROM sums for BeginFirmware


class SRecordError(ValueError):
    pass


@dataclass
class FirmwareImage:
    start: int
    data: bytes
    title: str = ""

    @property
    def checksum(self) -> int:
        """16-bit sum used by the BeginFirmware command."""
        return sum(self.data[:FIRMWARE_CHECKSUM_SPAN]) & 0xFFFF

    def __len__(self) -> int:
        return len(self.data)


def parse_srec(text: Union[str, bytes], max_size: int = MAX_FIRMWARE) -> FirmwareImage:
    if isinstance(text, bytes):
        text = text.decode("ascii", "replace")
    mem = {}
    title = ""
    lo, hi = None, None
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line[0] != "S" or len(line) < 8 or len(line) % 2:
            raise SRecordError(f"line {lineno}: not an S-record")
        kind = line[1]
        try:
            count = int(line[2:4], 16)
            payload = bytes.fromhex(line[4:4 + count * 2])
        except ValueError as e:
            raise SRecordError(f"line {lineno}: bad hex") from e
        if len(payload) != count:
            raise SRecordError(f"line {lineno}: length mismatch")
        body, csum = payload[:-1], payload[-1]
        if ((count + sum(body)) & 0xFF) ^ 0xFF != csum:
            raise SRecordError(f"line {lineno}: checksum mismatch")
        if kind == "0":
            title = body[2:].decode("ascii", "replace").rstrip("\x00")
        elif kind in "123":
            alen = {"1": 2, "2": 3, "3": 4}[kind]
            addr = int.from_bytes(body[:alen], "big")
            for i, b in enumerate(body[alen:]):
                mem[addr + i] = b
            lo = addr if lo is None else min(lo, addr)
            end = addr + len(body) - alen
            hi = end if hi is None else max(hi, end)
        elif kind in "789":
            break
        # S4-S6 (count records) are ignored
    if lo is None:
        raise SRecordError("no data records")
    if hi - lo > max_size:
        raise SRecordError(f"image is {hi - lo} bytes, larger than {max_size}")
    data = bytes(mem.get(a, 0) for a in range(lo, hi))
    return FirmwareImage(lo, data, title)


def load_firmware(path: Union[str, Path]) -> FirmwareImage:
    return parse_srec(Path(path).read_bytes())


def bundled_firmware_path(version: str = "0328") -> Path:
    """Path to a firmware image shipped in the repo's firmware/ folder."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        cand = parent / "firmware" / f"firm{version}.lgo"
        if cand.exists():
            return cand
    raise FileNotFoundError(f"firm{version}.lgo not found next to the package")
