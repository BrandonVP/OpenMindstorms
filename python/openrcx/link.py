"""Request/reply layer: framing, toggle bit, echo skipping, retries."""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional

from . import protocol as P
from .transport import Transport

log = logging.getLogger("openrcx.link")


class RcxError(Exception):
    pass


class NoReply(RcxError):
    """The RCX did not answer (out of range, off, no firmware for that op)."""


class ReplyError(RcxError):
    """The RCX answered with a non-zero error code."""

    def __init__(self, op: int, code: int, text: str = ""):
        self.op, self.code = op, code
        super().__init__(text or f"{P.opcode_name(op)} failed with error {code}")


class RcxLink:
    """Send commands and collect replies over a :class:`Transport`."""

    DEFAULT_TIMEOUT = 0.5      # like NQC's kMaxTimeout
    DOWNLOAD_TIMEOUT = 0.3     # extra wait after a TransferData packet
    UNLOCK_TIMEOUT = 2.0       # firmware unlock takes a while
    RETRIES = 4

    def __init__(self, transport: Transport, verbose: bool = False):
        self.t = transport
        self.verbose = verbose
        self._last_opcode: Optional[int] = None
        self.last_reply: Optional[P.Reply] = None
        self.stats = {"sent": 0, "retries": 0, "failed": 0}

    # ------------------------------------------------------------------
    def close(self) -> None:
        self.t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ------------------------------------------------------------------
    def _toggle(self, body: bytes) -> bytes:
        op = body[0]
        if self._last_opcode is not None and op == self._last_opcode:
            op ^= P.TOGGLE
        self._last_opcode = op
        return bytes([op]) + body[1:]

    def send(self, body: bytes, timeout: Optional[float] = None,
             retries: Optional[int] = None, expect: Optional[int] = None) -> bytes:
        """Send ``body`` (opcode + args) and return the reply payload.

        Raises :class:`NoReply` after all retries are exhausted.
        """
        body = self._toggle(body)
        packet = P.build_packet(body)
        if expect is None:
            expect = P.expected_reply_length(body)
        tries = self.RETRIES if retries is None else max(1, retries)
        base_timeout = self.DEFAULT_TIMEOUT if timeout is None else timeout
        # pyserial/libusb return as soon as the tower has buffered the bytes;
        # the IR link itself is slow, so wait for the transmission too.
        tx_time = self.t.tx_seconds(len(packet))

        for attempt in range(tries):
            self.stats["sent"] += 1
            if attempt:
                self.stats["retries"] += 1
            self.t.flush_input()
            if self.verbose:
                log.info("TX %s", P.hexs(packet))
            self.t.write(packet)
            if (body[0] & 0xF7) in P.NO_REPLY:
                time.sleep(tx_time)
                return b""
            reply = self._receive(body[0], expect, tx_time + base_timeout)
            if reply is not None:
                self.last_reply = reply
                return reply.payload
            if self.verbose:
                log.info("no reply (attempt %d/%d)", attempt + 1, tries)
        self.stats["failed"] += 1
        self._last_opcode = None  # lost sync; next command may reuse the opcode
        raise NoReply(f"no reply to {P.opcode_name(body[0])}")

    def _receive(self, opcode: int, expect: Optional[int], timeout: float) -> Optional[P.Reply]:
        buf = bytearray()
        want = 3 + 2 + 2 * (expect or 0) + 2   # header, opcode pair, payload, checksum
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            chunk = self.t.read(max(want, 64), remaining)
            if chunk:
                buf += chunk
                r = P.find_reply(bytes(buf), opcode, expect)
                if r is not None:
                    if self.verbose:
                        log.info("RX %s", P.hexs(bytes(buf)))
                    return r
                # once bytes are arriving, stretch a little for the tail
                deadline = max(deadline, time.monotonic() + 0.15)
        if self.verbose and buf:
            log.info("RX (unmatched) %s", P.hexs(bytes(buf)))
        return None

    # ------------------------------------------------------------------
    def send_checked(self, body: bytes, **kw) -> bytes:
        """Send and raise :class:`ReplyError` if the one-byte status is non-zero."""
        payload = self.send(body, **kw)
        if payload and payload[0] != 0:
            raise ReplyError(body[0], payload[0])
        return payload

    def download(self, data: bytes, chunk: int, timeout: float,
                 progress: Optional[Callable[[int, int], None]] = None) -> None:
        """Stream ``data`` with TransferData packets (sequence 1.., last = 0)."""
        total = len(data)
        seq = 1
        pos = 0
        while pos < total:
            n = min(chunk, total - pos)
            block = data[pos:pos + n]
            if pos + n >= total:
                seq = 0
            body = bytes([P.TRANSFER_DATA, seq & 0xFF, seq >> 8, n & 0xFF, n >> 8]) \
                + block + bytes([P.checksum8(block)])
            payload = self.send(body, timeout=timeout)
            if not payload or payload[0] != 0:
                code = payload[0] if payload else -1
                raise ReplyError(P.TRANSFER_DATA, code, _transfer_error_text(code))
            pos += n
            seq += 1
            if progress:
                progress(pos, total)


def _transfer_error_text(code: int) -> str:
    return {
        1: "transfer failed: not enough memory",
        2: "transfer failed: invalid index",
        3: "transfer failed: block checksum error",
        4: "transfer failed: firmware checksum error",
        6: "transfer failed: download was not started",
    }.get(code, f"transfer failed with error {code}")
