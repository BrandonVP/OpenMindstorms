"""Byte transports that carry RCX packets to an infrared tower.

* :class:`SerialTransport` - any COM port: the OpenRCX Teensy/ESP32 tower,
  a DIY tower on a USB-serial cable, or an original LEGO *serial* tower.
* :class:`UsbTowerTransport` - the original LEGO *USB* tower (VID 0694,
  PID 0001) driven directly through libusb/WinUSB, no LEGO driver needed.
"""

from __future__ import annotations

import time
from typing import List, Optional


class TransportError(Exception):
    pass


class Transport:
    """Minimal byte pipe.  ``echoes`` says whether our own transmission
    comes back on the receive side (true for a real serial tower)."""

    echoes = False
    name = "transport"

    def write(self, data: bytes) -> None:
        raise NotImplementedError

    def read(self, max_bytes: int, timeout: float) -> bytes:
        """Return up to ``max_bytes`` bytes, waiting at most ``timeout`` s
        for the first byte.  May return b""."""
        raise NotImplementedError

    def flush_input(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def tx_seconds(self, nbytes: int) -> float:
        """How long the tower needs to push ``nbytes`` out over IR."""
        return nbytes * 11.0 / 2400.0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


# ---------------------------------------------------------------------------
# Serial (COM port) tower
# ---------------------------------------------------------------------------

TEENSY_VID = 0x16C0
ESPRESSIF_VID = 0x303A
DIY_VIDS = {TEENSY_VID, ESPRESSIF_VID}
USB_SERIAL_VIDS = {0x0403: "FTDI", 0x10C4: "Silicon Labs CP210x", 0x1A86: "WCH CH340",
                   0x067B: "Prolific PL2303"}
LEGO_SERIAL_BAUD = 2400
PROLIFIC_DRIVER_URL = "https://github.com/BrandonVP/Prolific"
ZADIG_URL = "https://zadig.akeo.ie/"


def classify_port(vid: Optional[int], description: str = "") -> str:
    """'diy', 'serial' or 'unknown' from a port's USB vendor id."""
    if vid in DIY_VIDS:
        return "diy"
    if vid in USB_SERIAL_VIDS:
        return "serial"
    if vid is None and ("communications port" in description.lower()
                        or description.lower().startswith("com")):
        return "serial"          # a real on-board RS-232 port
    return "unknown"


def probe_serial_tower(port: str) -> Optional[bool]:
    """Is a LEGO serial tower (9713) plugged into ``port``?

    The tower loops RTS back to CTS, which is how LEGO's software detected it.
    Returns True/False, or None when the port cannot be opened.
    """
    import serial

    try:
        with serial.Serial(port, LEGO_SERIAL_BAUD, timeout=0.02) as s:
            s.dtr = True
            s.rts = False
            time.sleep(0.02)
            low = s.cts
            s.rts = True
            time.sleep(0.02)
            high = s.cts
            s.rts = False
            time.sleep(0.02)
            low2 = s.cts
            return bool(high and not low and not low2)
    except (serial.SerialException, OSError, ValueError):
        return None


def list_serial_ports(probe: bool = False) -> List[dict]:
    """Enumerate COM ports with a hint for ones that look like a tower."""
    from serial.tools import list_ports

    out = []
    for p in list_ports.comports():
        kind = classify_port(p.vid, p.description or "")
        if kind == "diy":
            hint = "Teensy" if p.vid == TEENSY_VID else "Espressif"
            hint += " - OpenRCX DIY tower"
        elif p.vid in USB_SERIAL_VIDS:
            hint = USB_SERIAL_VIDS[p.vid] + " USB-serial adapter"
            if "DO NOT SUPPORT" in (p.description or "").upper():
                hint += " - crippled by the Windows Update driver; install the older one from " + PROLIFIC_DRIVER_URL
        elif kind == "serial":
            hint = "RS-232 port"
        else:
            hint = ""
        entry = {"device": p.device, "description": p.description,
                 "vid": p.vid, "pid": p.pid, "kind": kind, "hint": hint, "tower": None}
        if probe and kind != "diy":
            entry["tower"] = probe_serial_tower(p.device)
        out.append(entry)
    return out


def guess_serial_port(tower: str = "auto") -> Optional[str]:
    ports = list_serial_ports()
    if tower in ("auto", "diy"):
        for p in ports:
            if p["kind"] == "diy":
                return p["device"]
    if tower in ("auto", "serial"):
        cands = [p for p in ports if p["kind"] == "serial"]
        if len(cands) == 1:
            return cands[0]["device"]
    if len(ports) == 1:
        return ports[0]["device"]
    return None


class SerialTransport(Transport):
    """COM-port tower.  The DIY OpenRCX tower is a USB CDC device, so the
    baud rate is cosmetic for it; an original serial tower needs 2400 8-O-1
    and asserted RTS/DTR lines, which we set in both cases."""

    name = "serial"

    def __init__(self, port: str, echoes: bool = False, baud: int = LEGO_SERIAL_BAUD):
        import serial

        self.port = port
        self.echoes = echoes
        self.name = "serial-tower" if echoes else "diy-tower"
        try:
            self.ser = serial.Serial()
            self.ser.port = port
            self.ser.baudrate = baud
            self.ser.bytesize = serial.EIGHTBITS
            self.ser.parity = serial.PARITY_ODD
            self.ser.stopbits = serial.STOPBITS_ONE
            # One fixed read timeout for the life of the port.  Changing
            # pyserial's timeout later re-issues SetCommState on Windows, and
            # Prolific PL2303 adapters corrupt bytes that are arriving while
            # the port is reprogrammed - which garbled every RCX reply.
            self.ser.timeout = self.POLL
            self.ser.write_timeout = 5
            self.ser.rts = True
            self.ser.dtr = True
            self.ser.open()
        except serial.SerialException as e:
            raise TransportError(f"cannot open {port}: {e}") from e
        # Give a freshly enumerated CDC device a moment, then drop any junk.
        time.sleep(0.05)
        self.flush_input()

    POLL = 0.02   # seconds per blocking read; never changed after open()

    def write(self, data: bytes) -> None:
        self.ser.write(data)
        self.ser.flush()

    def read(self, max_bytes: int, timeout: float) -> bytes:
        """Wait up to ``timeout`` s for the first byte, then return whatever
        has arrived by the time the line goes quiet for one poll period."""
        deadline = time.monotonic() + timeout
        out = bytearray()
        while len(out) < max_bytes:
            chunk = self.ser.read(min(max_bytes - len(out), max(1, self.ser.in_waiting)))
            if chunk:
                out += chunk
            elif out or time.monotonic() >= deadline:
                break
        return bytes(out)

    def flush_input(self) -> None:
        self.ser.reset_input_buffer()

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Original LEGO USB tower via libusb (pyusb).  On Windows bind the tower to
# WinUSB with Zadig first; on Linux unload/blacklist the legousbtower module
# or just use /dev/usb/legousbtower0 through a file transport instead.
# ---------------------------------------------------------------------------

LEGO_USB_VID = 0x0694
LEGO_USB_TOWER_PID = 0x0001

# Vendor requests (LEGO USB Tower Interface Reference, section 3.4)
LTW_REQ_GET_PARM = 0x01
LTW_REQ_SET_PARM = 0x02
LTW_REQ_FLUSH = 0x03
LTW_REQ_RESET = 0x04
LTW_REQ_GET_STAT = 0x05
LTW_REQ_GET_POWER = 0x06
LTW_REQ_GET_LED = 0x08
LTW_REQ_SET_LED = 0x09
LTW_REQ_SET_TX_SPEED = 0xEF
LTW_REQ_SET_RX_SPEED = 0xF1
LTW_REQ_GET_TX_STATE = 0xF2
LTW_REQ_SET_TX_CARRIER_FREQUENCY = 0xF4
LTW_REQ_GET_CAPS = 0xFC
LTW_REQ_GET_VERSION = 0xFD

LTW_PARM_MODE = 0x01
LTW_MODE_IR = 0x02
LTW_PARM_RANGE = 0x02
LTW_RANGE = {"short": 0x01, "medium": 0x02, "long": 0x03}
LTW_PARM_ERRDETECT = 0x03
LTW_ERRDETECT_ON = 0x01
LTW_ERRDETECT_OFF = 0x02
LTW_TX_BUFFER = 0x01
LTW_RX_BUFFER = 0x02
SPEED_COMM_BAUD_2400 = 0x0008
SPEED_COMM_BAUD_4800 = 0x0010
CAPS_TX_STATE_READY = 0x01

_VENDOR_IN = 0xC0  # device-to-host, vendor, device recipient


class UsbTowerTransport(Transport):
    """Original LEGO USB IR tower through pyusb.

    The tower strips the leading 0x55 of received packets and does not echo
    transmissions.  Interrupt endpoints: 0x81 IN, 0x02 OUT, 8-byte packets.
    """

    name = "usb-tower"
    echoes = False

    def __init__(self, range_: str = "medium", carrier_khz: int = 38):
        try:
            import usb.core
            import usb.util
        except ImportError as e:  # pragma: no cover
            raise TransportError("pyusb is not installed (pip install pyusb)") from e
        self._usb = usb
        dev = usb.core.find(idVendor=LEGO_USB_VID, idProduct=LEGO_USB_TOWER_PID)
        if dev is None:
            raise TransportError(
                "LEGO USB tower not found (VID 0694 PID 0001). On Windows the tower "
                f"must be bound to the WinUSB driver with Zadig ({ZADIG_URL}): "
                "Options > List All Devices > LEGO USB Tower > WinUSB > Replace Driver.")
        self.dev = dev
        try:
            if dev.is_kernel_driver_active(0):
                dev.detach_kernel_driver(0)
        except (NotImplementedError, usb.core.USBError):
            pass
        try:
            dev.set_configuration()
        except usb.core.USBError as e:
            raise TransportError(f"USB tower set_configuration failed: {e}") from e
        self.ep_in = 0x81
        self.ep_out = 0x02
        self._pending = bytearray()
        # Reset to defaults, then set IR mode / 2400 baud / 38 kHz / range.
        self.vendor(LTW_REQ_RESET, 0, 8)
        time.sleep(0.1)
        self.vendor(LTW_REQ_SET_PARM, LTW_PARM_MODE | (LTW_MODE_IR << 8), 4)
        self.vendor(LTW_REQ_SET_TX_SPEED, SPEED_COMM_BAUD_2400, 6)
        self.vendor(LTW_REQ_SET_RX_SPEED, SPEED_COMM_BAUD_2400, 6)
        if carrier_khz != 38:
            self.vendor(LTW_REQ_SET_TX_CARRIER_FREQUENCY, carrier_khz & 0xFF, 6)
        self.set_range(range_)
        self.flush_input()

    # -- vendor requests ---------------------------------------------------
    def vendor(self, request: int, value: int, length: int, index: int = 0) -> bytes:
        try:
            data = self.dev.ctrl_transfer(_VENDOR_IN, request, value, index, length, 1000)
        except self._usb.core.USBError as e:
            raise TransportError(f"USB tower vendor request 0x{request:02X} failed: {e}") from e
        data = bytes(data)
        if len(data) >= 3 and data[2] != 0:
            raise TransportError(f"USB tower request 0x{request:02X} error code {data[2]}")
        return data

    def set_range(self, range_: str) -> None:
        code = LTW_RANGE[range_]
        self.vendor(LTW_REQ_SET_PARM, LTW_PARM_RANGE | (code << 8), 4)

    def version(self) -> str:
        d = self.vendor(LTW_REQ_GET_VERSION, 0, 8)
        # wNoOfBytes, bErrCode, bSpare, bMajor, bMinor, wBuild
        if len(d) >= 8:
            return f"{d[4]}.{d[5]} build {d[6] | (d[7] << 8)}"
        return d.hex()

    # -- data path ---------------------------------------------------------
    def write(self, data: bytes) -> None:
        try:
            # The tower's UART TX buffer is small; feed it in pieces and
            # let the firmware drain between them.
            for i in range(0, len(data), 8):
                self.dev.write(self.ep_out, data[i:i + 8], 2000)
        except self._usb.core.USBError as e:
            raise TransportError(f"USB tower write failed: {e}") from e

    def read(self, max_bytes: int, timeout: float) -> bytes:
        out = bytearray(self._pending[:max_bytes])
        del self._pending[:len(out)]
        deadline = time.monotonic() + timeout
        while len(out) < max_bytes:
            remaining = deadline - time.monotonic()
            if remaining <= 0 and out:
                break
            ms = int(max(remaining, 0.02) * 1000)
            try:
                chunk = bytes(self.dev.read(self.ep_in, 8, ms))
            except self._usb.core.USBTimeoutError:
                chunk = b""
            except self._usb.core.USBError as e:
                if getattr(e, "errno", None) in (110, 60):  # timeout variants
                    chunk = b""
                else:
                    raise TransportError(f"USB tower read failed: {e}") from e
            if not chunk:
                if time.monotonic() >= deadline:
                    break
                continue
            take = max_bytes - len(out)
            out += chunk[:take]
            self._pending += chunk[take:]
            # once data is flowing only wait briefly for the rest
            deadline = min(deadline, time.monotonic() + 0.05)
        return bytes(out)

    def flush_input(self) -> None:
        self._pending.clear()
        try:
            self.vendor(LTW_REQ_FLUSH, LTW_RX_BUFFER, 4)
        except TransportError:
            pass
        # drain anything libusb still holds
        try:
            while True:
                if not self.dev.read(self.ep_in, 8, 10):
                    break
        except Exception:
            pass

    def close(self) -> None:
        try:
            self._usb.util.dispose_resources(self.dev)
        except Exception:
            pass


def open_transport(spec: Optional[str] = None, tower: str = "auto",
                   usb_range: str = "medium", echoes: Optional[bool] = None) -> Transport:
    """Open a tower.

    ``tower``: ``diy`` (OpenRCX Teensy/ESP32 on a COM port), ``serial``
    (original LEGO serial tower on a COM port), ``usb`` (original LEGO USB
    tower via libusb) or ``auto``.  ``spec`` is the COM port, or ``usb``.
    """
    tower = (tower or "auto").lower()
    if tower == "usb" or (spec and spec.lower() == "usb"):
        return UsbTowerTransport(range_=usb_range)
    port = spec or guess_serial_port(tower)
    if not port:
        raise TransportError(
            "no tower port given and none could be guessed; use --port COMx "
            "(or 'rcx config --port COMx') - run 'rcx ports --probe' to find it")
    if echoes is None:
        if tower == "auto":
            from serial.tools import list_ports
            vid = None
            desc = ""
            for p in list_ports.comports():
                if p.device.lower() == port.lower():
                    vid, desc = p.vid, p.description or ""
            tower = "serial" if classify_port(vid, desc) == "serial" else "diy"
        echoes = tower == "serial"
    return SerialTransport(port, echoes=echoes)
