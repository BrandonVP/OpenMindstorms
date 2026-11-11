"""Transports that carry NXT messages: USB (pyusb/WinUSB) and Bluetooth (a COM port)."""

from __future__ import annotations

import struct
import time
from typing import List, Optional

from . import protocol as P


class TransportError(Exception):
    pass


def _libusb_backend():
    """pyusb needs a libusb-1.0 library.  Windows has none by default; the
    ``libusb-package`` wheel bundles one, so prefer it when installed."""
    try:
        import libusb_package
        return libusb_package.get_libusb1_backend()
    except Exception:
        return None


class Transport:
    name = "transport"

    def send(self, msg: bytes) -> None:
        raise NotImplementedError

    def recv(self, timeout: float) -> Optional[bytes]:
        """One complete message, or None on timeout."""
        raise NotImplementedError

    def flush(self) -> None:
        pass

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class UsbTransport(Transport):
    """The brick's USB port.  On Windows bind it to WinUSB with Zadig first."""

    name = "usb"

    def __init__(self):
        try:
            import usb.core
            import usb.util
        except ImportError as e:  # pragma: no cover
            raise TransportError("pyusb is not installed (pip install pyusb)") from e
        self._usb = usb
        dev = usb.core.find(idVendor=P.USB_VID, idProduct=P.USB_PID, backend=_libusb_backend())
        if dev is None:
            raise TransportError(
                "no NXT found on USB (ID 0694:0002). Is it switched on and plugged in, and on "
                "Windows bound to the WinUSB driver with Zadig (https://zadig.akeo.ie/)?")
        self.dev = dev
        try:
            if dev.is_kernel_driver_active(0):
                dev.detach_kernel_driver(0)
        except (NotImplementedError, usb.core.USBError):
            pass
        try:
            dev.set_configuration()
            usb.util.claim_interface(dev, 0)
        except usb.core.USBError as e:
            raise TransportError(f"cannot claim the NXT's USB interface: {e}") from e
        self.serial = dev.serial_number or ""
        self.flush()

    def send(self, msg: bytes) -> None:
        try:
            self.dev.write(P.USB_EP_OUT, msg, 1000)
        except self._usb.core.USBError as e:
            raise TransportError(f"USB write failed: {e}") from e

    def recv(self, timeout: float) -> Optional[bytes]:
        try:
            data = self.dev.read(P.USB_EP_IN, P.USB_PACKET, int(timeout * 1000))
        except self._usb.core.USBTimeoutError:
            return None
        except self._usb.core.USBError as e:
            if getattr(e, "errno", None) in (110, 60):
                return None
            raise TransportError(f"USB read failed: {e}") from e
        return bytes(data)

    def flush(self) -> None:
        for _ in range(8):
            try:
                if not self.dev.read(P.USB_EP_IN, P.USB_PACKET, 20):
                    break
            except Exception:
                break

    def close(self) -> None:
        try:
            self._usb.util.dispose_resources(self.dev)
        except Exception:
            pass


class BluetoothTransport(Transport):
    """Bluetooth serial port profile: pair the brick in Windows (PIN 1234) and use
    the *outgoing* COM port it creates.  Each message is length-prefixed."""

    name = "bluetooth"

    def __init__(self, port: str):
        import serial

        self.port = port
        try:
            self.ser = serial.Serial(port, 115200, timeout=0.05, write_timeout=5)
        except serial.SerialException as e:
            raise TransportError(f"cannot open {port}: {e}") from e
        self.flush()

    def send(self, msg: bytes) -> None:
        self.ser.write(P.bt_frame(msg))
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
        (length,) = struct.unpack("<H", head)
        return self._read_exact(length, deadline + 0.5)

    def flush(self) -> None:
        self.ser.reset_input_buffer()

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass


def list_bluetooth_ports() -> List[dict]:
    """COM ports that look like Bluetooth serial links."""
    from serial.tools import list_ports

    out = []
    for p in list_ports.comports():
        desc = (p.description or "") + " " + (p.hwid or "")
        if "bluetooth" in desc.lower() or "BTHENUM" in desc.upper():
            out.append({"device": p.device, "description": p.description, "hwid": p.hwid})
    return out


def open_transport(spec: Optional[str] = None) -> Transport:
    """``usb`` / None -> USB; ``COM5`` -> Bluetooth serial port."""
    if not spec or spec.lower() == "usb":
        return UsbTransport()
    return BluetoothTransport(spec)
