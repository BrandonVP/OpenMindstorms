"""Locate and run the NQC compiler (nqc.exe / nqc)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional


class NqcError(Exception):
    pass


def find_nqc() -> Optional[Path]:
    env = os.environ.get("NQC")
    if env and Path(env).exists():
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        for name in ("nqc.exe", "nqc"):
            cand = parent / "tools" / "nqc" / name
            if cand.exists():
                return cand
    for name in ("nqc", "nqc.exe"):
        w = shutil.which(name)
        if w:
            return Path(w)
    for cand in (Path(r"C:\Program Files (x86)\BricxCC\nqc.exe"),
                 Path(r"C:\Program Files\BricxCC\nqc.exe")):
        if cand.exists():
            return cand
    return None


def compile_nqc(source: Path, output: Optional[Path] = None, target: str = "rcx2",
                extra: Optional[List[str]] = None) -> Path:
    """Compile ``source`` to an .rcx image.  Returns the output path."""
    nqc = find_nqc()
    if nqc is None:
        raise NqcError("nqc compiler not found: put nqc.exe in tools/nqc, on PATH, "
                       "or set the NQC environment variable")
    source = Path(source)
    if output is None:
        output = source.with_suffix(".rcx")
    cmd = [str(nqc), f"-T{target}", f"-O{output}"] + list(extra or []) + [str(source)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise NqcError(out.strip() or f"nqc exited with {proc.returncode}")
    if not Path(output).exists():
        raise NqcError("nqc reported success but produced no output file\n" + out)
    return Path(output)
