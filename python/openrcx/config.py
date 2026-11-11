"""Persistent settings: which tower, which port.

Precedence when opening a tower: explicit arguments > environment
(``RCX_PORT``, ``RCX_TOWER``) > the config file written by ``rcx config``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

TOWER_TYPES = ("auto", "diy", "serial", "usb")
TOWER_HELP = {
    "auto": "pick by port: Teensy/Espressif -> diy, other USB-serial -> serial, 'usb' -> usb",
    "diy": "OpenRCX Teensy/ESP32 tower on a COM port (no echo)",
    "serial": "original LEGO serial tower (9713) on a COM port or USB-serial adapter",
    "usb": "original LEGO USB tower through WinUSB/libusb",
}


def config_path() -> Path:
    base = os.environ.get("APPDATA") if os.name == "nt" else os.environ.get("XDG_CONFIG_HOME")
    root = Path(base) if base else Path.home() / ".config"
    return root / "openrcx" / "config.json"


def load_config() -> dict:
    p = config_path()
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(cfg: dict) -> Path:
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=2), "utf-8")
    return p


def resolve(port: Optional[str] = None, tower: Optional[str] = None,
            usb_range: Optional[str] = None) -> dict:
    """Merge explicit values, environment and the config file."""
    cfg = load_config()
    out = {
        "port": port or os.environ.get("RCX_PORT") or cfg.get("port"),
        "tower": (tower or os.environ.get("RCX_TOWER") or cfg.get("tower") or "auto").lower(),
        "usb_range": usb_range or cfg.get("usb_range") or "medium",
    }
    if out["tower"] not in TOWER_TYPES:
        raise ValueError(f"unknown tower type '{out['tower']}' (use {', '.join(TOWER_TYPES)})")
    return out
