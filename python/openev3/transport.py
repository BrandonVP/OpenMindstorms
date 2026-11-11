"""EV3 transports: USB HID (no driver needed on Windows) and Bluetooth serial."""

from __future__ import annotations

import struct
import time
from typing import List, Optional

from . import protocol as P


class TransportError(Exception):
    pass


class Transport:
    name = "transport"

    def send(self, msg: bytes) -> None:
        raise NotImplementedError

    def recv(self, timeout: float) -> Optional[bytes]:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class HidTransport(Transport):
    """The brick's USB port, which enumerates as a vendor HID device with 1024-byte
    reports.  Windows' inbox HID driver handles it; the `hidapi` package talks to it."""

    name = "usb"

    def __init__(self, serial: Optional[str] = None):
        try:
            import hid
        except ImportError as e:  # pragma: no cover
            raise TransportError("the 'hidapi' package is not installed (pip install hidapi)") from e
        devs = [d for d in hid.enumerate(P.USB_VID, P.USB_PID) if not serial or d.get("serial_number") == serial]
        if not devs:
            raise TransportError("no EV3 found on USB (ID 0694:0005). Is it switched on and plugged in?")
        self.dev = hid.device()
        try:
            self.dev.open_path(devs[0]["path"])
        except OSError as e:
            raise TransportError(f"cannot open the EV3 ({e}); is another program (the Workbench?) using it?") from e
        self.dev.set_nonblocking(0)
        self.serial = self.dev.get_serial_number_string() or ""
        self.product = self.dev.get_product_string() or ""

    def send(self, msg: bytes) -> None:
        # report id 0 + message; hidapi pads to the 1024-byte output report
        self.dev.write(b"\x00" + msg)

    def recv(self, timeout: float) -> Optional[bytes]:
        data = bytes(self.dev.read(P.HID_REPORT, int(timeout * 1000)))
        if not data:
            return None
        # Windows returns the report without the report-id byte; Linux/mac may include a leading 0
        if data[0] == 0 and len(data) > 2:
            length = struct.unpack_from("<H", data, 1)[0]
            if 3 <= length <= P.HID_REPORT - 2:
                data = data[1:]
        return data

    def close(self) -> None:
        try:
            self.dev.close()
        except Exception:
            pass


class BluetoothTransport(Transport):
    """Serial port profile: pair the brick (PIN 1234) and use the outgoing COM port."""

    name = "bluetooth"

    def __init__(self, port: str):
        import serial

        self.port = port
        try:
            self.ser = serial.Serial(port, 115200, timeout=0.05, write_timeout=5)
        except serial.SerialException as e:
            raise TransportError(f"cannot open {port}: {e}") from e
        self.ser.reset_input_buffer()

    def send(self, msg: bytes) -> None:
        self.ser.write(msg)
        self.ser.flush()

    def _read_exact(self, n: int, deadline: float) -> Optional[bytes]:
        out = bytearray()
        while len(out) < n:
            chunk = self.ser.read(n - len(out))
            if chunk:
                out += chunk
            elif time.monotonic() >= deadline:
                return None
        return bytes(out)

    def recv(self, timeout: float) -> Optional[bytes]:
        deadline = time.monotonic() + timeout
        head = self._read_exact(2, deadline)
        if head is None:
            return None
        length = struct.unpack("<H", head)[0]
        rest = self._read_exact(length, deadline + 1.0)
        return None if rest is None else head + rest

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass


def list_hid_bricks() -> List[dict]:
    try:
        import hid
    except ImportError:
        return []
    return [{"serial": d.get("serial_number"), "name": d.get("product_string")} for d in hid.enumerate(P.USB_VID, P.USB_PID)]


def list_bluetooth_ports() -> List[dict]:
    from serial.tools import list_ports

    out = []
    for p in list_ports.comports():
        desc = (p.description or "") + " " + (p.hwid or "")
        if "bluetooth" in desc.lower() or "BTHENUM" in desc.upper():
            out.append({"device": p.device, "description": p.description})
    return out


def open_transport(spec: Optional[str] = None) -> Transport:
    """``usb`` / None -> USB HID; ``COM5`` -> Bluetooth serial port."""
    if not spec or spec.lower() == "usb":
        return HidTransport()
    return BluetoothTransport(spec)
