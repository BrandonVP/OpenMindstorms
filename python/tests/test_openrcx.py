"""Unit tests - run with:  python -m unittest discover -s python/tests -v"""

import struct
import unittest
from pathlib import Path

from openrcx import protocol as P
from openrcx.firmware import bundled_firmware_path, load_firmware, parse_srec, SRecordError
from openrcx.image import Chunk, ProgramImage, parse_rcx, write_rcx, CHUNK_TASK, CHUNK_SUB
from openrcx.link import NoReply, RcxLink, ReplyError
from openrcx.rcx import RCX, Versions
from openrcx.sim import SimRCX, SimTransport


class ProtocolTests(unittest.TestCase):
    def test_build_packet_matches_known_example(self):
        # Kekoa Proudfoot's example: Set Message 0x12
        self.assertEqual(P.build_packet(bytes([0xF7, 0x12])),
                         bytes.fromhex("55 ff 00 f7 08 12 ed 09 f6"))

    def test_ping_packet(self):
        self.assertEqual(P.build_packet(b"\x10"), bytes.fromhex("55 ff 00 10 ef 10 ef"))

    def test_find_reply_full_header(self):
        reply = P.build_packet(bytes([0xEF]))          # reply to Alive 0x10
        r = P.find_reply(reply, 0x10, 0)
        self.assertIsNotNone(r)
        self.assertEqual(r.payload, b"")
        self.assertEqual(r.end, len(reply))

    def test_find_reply_toggled_opcode(self):
        reply = P.build_packet(bytes([0xE7]))          # reply to 0x18
        self.assertIsNotNone(P.find_reply(reply, 0x18, 0))
        self.assertIsNotNone(P.find_reply(reply, 0x10, 0))  # toggle bit ignored

    def test_find_reply_skips_echo_and_noise(self):
        cmd = P.build_packet(bytes([0x30]))
        reply = P.build_packet(bytes([0xCF, 0x1C, 0x22]))   # battery 8732 mV
        buf = b"\x01\x02" + cmd + b"\xff" + reply + b"\xff"
        r = P.find_reply(buf, 0x30, 2)
        self.assertEqual(r.payload, b"\x1c\x22")

    def test_find_reply_without_55(self):
        reply = P.build_packet(bytes([0xCF, 0x1C, 0x22]))[1:]  # USB tower eats 0x55
        self.assertIsNotNone(P.find_reply(reply, 0x30, 2))

    def test_find_reply_rejects_bad_checksum(self):
        reply = bytearray(P.build_packet(bytes([0xCF, 0x1C, 0x22])))
        reply[-2] ^= 1
        reply[-1] ^= 1
        self.assertIsNone(P.find_reply(bytes(reply), 0x30, 2))

    def test_find_reply_incomplete(self):
        reply = P.build_packet(bytes([0xCF, 0x1C, 0x22]))
        self.assertIsNone(P.find_reply(reply[:-3], 0x30, 2))

    def test_parse_command_roundtrip(self):
        body = bytes([0x45, 1, 0, 3, 0, 9, 9, 9, 27])
        self.assertEqual(P.parse_command(P.build_packet(body)), body)
        self.assertIsNone(P.parse_command(P.build_packet(body)[:-1]))

    def test_expected_lengths(self):
        self.assertEqual(P.expected_reply_length(b"\x10"), 0)
        self.assertEqual(P.expected_reply_length(b"\x18"), 0)
        self.assertEqual(P.expected_reply_length(b"\x30"), 2)
        self.assertEqual(P.expected_reply_length(b"\x15\x01\x03\x05\x07\x0b"), 8)
        self.assertEqual(P.expected_reply_length(b"\xa5LEGO\xae"), 25)
        self.assertEqual(P.expected_reply_length(b"\x45\x01\x00\x01\x00\x00\x00"), 1)
        self.assertEqual(P.expected_reply_length(bytes([0xA4, 0, 0, 4, 0])), 12)


class FirmwareTests(unittest.TestCase):
    def test_parse_bundled_firmware(self):
        img = load_firmware(bundled_firmware_path("0328"))
        self.assertEqual(img.start, 0x8000)
        self.assertGreater(len(img), 0x4C00)
        self.assertLessEqual(len(img), 0x8000)
        self.assertEqual(img.title.lower(), "firm0328.lgo")
        # first bytes of the H8 vector table / entry point
        self.assertEqual(img.data[:2], bytes.fromhex("5e00"))

    def test_firmware_0309_checksum_is_the_documented_one(self):
        # Kekoa documents the "typical" BeginFirmware checksum as 0xC278
        img = load_firmware(bundled_firmware_path("0309"))
        self.assertEqual(img.start, 0x8000)
        self.assertEqual(img.checksum, 0xC278)

    def test_bad_checksum_rejected(self):
        with self.assertRaises(SRecordError):
            parse_srec("S1038000FF00\n")

    def test_gaps_are_zero_filled(self):
        txt = "S1048000AA01\nS1048002BB00\nS90380007C\n"
        # fix checksums programmatically
        lines = []
        for l in txt.splitlines():
            if l.startswith("S9"):
                lines.append(l)
                continue
            raw = bytes.fromhex(l[2:-2])
            cs = (~sum(raw)) & 0xFF
            lines.append(l[:-2] + f"{cs:02X}")
        img = parse_srec("\n".join(lines))
        self.assertEqual(img.data, bytes([0xAA, 0x00, 0xBB]))


class ImageTests(unittest.TestCase):
    def test_rcxi_roundtrip(self):
        img = ProgramImage(target=3, chunks=[
            Chunk(CHUNK_TASK, 0, bytes([0x51, 0x01, 0x21, 0x81]), "main"),
            Chunk(CHUNK_SUB, 2, bytes([0xF6]), "helper"),
        ], variables={0: "x", 5: "y"})
        data = write_rcx(img)
        self.assertEqual(data[:4], b"RCXI")
        back = parse_rcx(data)
        self.assertEqual(back.target, 3)
        self.assertEqual(len(back.chunks), 2)
        self.assertEqual(back.chunks[0].data, bytes([0x51, 0x01, 0x21, 0x81]))
        self.assertEqual(back.chunks[0].name, "main")
        self.assertEqual(back.chunks[1].number, 2)
        self.assertEqual(back.chunks[1].name, "helper")
        self.assertEqual(back.variables, {0: "x", 5: "y"})
        self.assertEqual(back.size, 5)

    def test_padding(self):
        img = ProgramImage(chunks=[Chunk(CHUNK_TASK, 0, b"\x01\x02\x03")])
        data = write_rcx(img)
        # header 12 + chunk header 4 + 3 data + 1 pad + symbol header 4
        self.assertEqual(len(data), 12 + 4 + 4 + 4)


class LinkTests(unittest.TestCase):
    def test_ping_and_toggle(self):
        t = SimTransport(firmware=True)
        link = RcxLink(t)
        link.send(b"\x10")
        link.send(b"\x10")
        link.send(b"\x10")
        ops = [P.parse_command(p)[0] for p in t.tx_log]
        self.assertEqual(ops, [0x10, 0x18, 0x10])
        self.assertEqual(len(t.rcx.log), 3)   # all three executed

    def test_retry_after_lost_reply(self):
        t = SimTransport(firmware=True, drop_replies=2)
        link = RcxLink(t)
        link.DEFAULT_TIMEOUT = 0.01
        rcx = RCX(link)
        self.assertEqual(rcx.battery_mv(), 8700)
        self.assertEqual(link.stats["retries"], 2)

    def test_no_reply_raises(self):
        t = SimTransport(firmware=False)    # ROM only: PlayTone is unknown
        link = RcxLink(t)
        link.DEFAULT_TIMEOUT = 0.01
        with self.assertRaises(NoReply):
            RCX(link).play_tone(440, 50)

    def test_echoing_tower(self):
        t = SimTransport(firmware=True, echoes=True)
        rcx = RCX(RcxLink(t))
        self.assertEqual(rcx.battery_mv(), 8700)
        self.assertEqual(str(rcx.versions()), "ROM 3.01 (00030001), firmware 3.0208 = firm0328 (RIS 2.0) (00030208)")


class RcxApiTests(unittest.TestCase):
    def setUp(self):
        self.t = SimTransport(firmware=True)
        self.rcx = RCX(RcxLink(self.t))
        self.sim = self.t.rcx

    def test_motors(self):
        self.rcx.motor_power("AC", 5)
        self.rcx.motor_direction("A", "rev")
        self.rcx.motor_on("ABC")
        self.assertEqual(self.sim.motors[0] & 0xC0, 0x80)
        self.assertEqual(self.sim.motors[0] & 0x08, 0x00)   # reverse clears the fwd bit
        self.assertEqual(self.sim.motors[1] & 0x08, 0x08)   # untouched motor stays fwd
        self.assertEqual(self.sim.motors[2] & 0x07, 5)
        self.rcx.motor_float("B")
        self.assertEqual(self.sim.motors[1] & 0xC0, 0x00)
        self.assertEqual(self.rcx.motor_status(0), self.sim.motors[0])

    def test_sensors_and_values(self):
        self.rcx.configure_sensor(0, "light")
        self.assertEqual(self.sim.sensor_type[0], 3)
        self.assertEqual(self.sim.sensor_mode[0] >> 5, 4)   # percent
        self.sim.sensor_values[0] = -17
        self.assertEqual(self.rcx.sensor_value(0), -17)
        self.rcx.set_variable(3, -1234)
        self.assertEqual(self.rcx.variable(3), -1234)
        self.rcx.set_message(42)
        self.assertEqual(self.rcx.message(), 42)

    def test_sound_display_program(self):
        self.rcx.play_sound("fastup")
        self.rcx.set_display("B")
        self.rcx.select_program(3)
        self.assertEqual(self.sim.sounds, [5])
        self.assertEqual(self.sim.display, 5)
        self.assertEqual(self.rcx.current_program(), 3)

    def test_memory_map_and_datalog(self):
        m = self.rcx.memory_map()
        self.assertEqual(len(m), 94)
        self.assertEqual(m[93], 0xFFFF)
        self.rcx.set_datalog_size(10)
        self.sim.datalog = [(0x40, 55), (0x00, -3)]
        self.assertEqual(self.rcx.upload_datalog(), [(0x40, 55), (0x00, -3)])

    def test_program_download(self):
        img = ProgramImage(target=3, chunks=[
            Chunk(CHUNK_TASK, 0, bytes(range(1, 51)), "main"),   # 50 bytes -> 3 packets
            Chunk(CHUNK_SUB, 1, bytes([0xF6]), "s"),
        ])
        seen = []
        self.rcx.download_program(img, 2, progress=lambda d, t: seen.append((d, t)))
        self.assertEqual(self.sim.program, 2)
        self.assertEqual(self.sim.programs[2][(0, 0)], bytes(range(1, 51)))
        self.assertEqual(self.sim.programs[2][(1, 1)], bytes([0xF6]))
        self.assertEqual(seen[-1], (51, 51))
        self.assertEqual(self.sim.sounds[-1], 5)
        # chunking: 20, 20, 10 with last sequence number 0
        transfers = [a for op, a in self.sim.log if op == P.TRANSFER_DATA]
        seqs = [a[0] | (a[1] << 8) for a in transfers]
        self.assertEqual(seqs, [1, 2, 0, 0])

    def test_program_download_bad_index(self):
        img = ProgramImage(chunks=[Chunk(CHUNK_TASK, 12, b"\x00")])
        with self.assertRaises(ReplyError):
            self.rcx.download_program(img, 0)


class FirmwareDownloadTests(unittest.TestCase):
    def test_full_firmware_download_into_blank_brick(self):
        t = SimTransport(firmware=False)
        rcx = RCX(RcxLink(t))
        self.assertFalse(rcx.versions().has_firmware)
        img = load_firmware(bundled_firmware_path("0328"))
        seen = []
        rcx.download_firmware(img, progress=lambda d, tot: seen.append(d))
        self.assertTrue(rcx.versions().has_firmware)
        self.assertEqual(bytes(t.rcx.fw_buf), img.data)
        self.assertEqual(seen[-1], len(img))
        # 200-byte blocks, last one has sequence 0
        transfers = [a for op, a in t.rcx.log if op == P.TRANSFER_DATA]
        self.assertEqual(len(transfers), -(-len(img) // 200))
        self.assertEqual(transfers[-1][0] | (transfers[-1][1] << 8), 0)
        self.assertTrue(all(a[2] | (a[3] << 8) == 200 for a in transfers[:-1]))
        # now the firmware answers things the ROM did not
        rcx.play_tone(440, 20)

    def test_firmware_checksum_mismatch_is_reported(self):
        t = SimTransport(firmware=False)
        rcx = RCX(RcxLink(t))
        img = load_firmware(bundled_firmware_path("0309"))
        declared = img.checksum

        class Tampered(type(img)):
            """Declares the right checksum but carries a flipped byte."""
            @property
            def checksum(self):
                return declared

        data = bytearray(img.data)
        data[100] ^= 0xFF
        with self.assertRaises(ReplyError) as cm:
            rcx.download_firmware(Tampered(img.start, bytes(data), img.title))
        self.assertEqual(cm.exception.code, 4)

    def test_versions_formatting(self):
        self.assertEqual(str(Versions(0x00030001, 0)), "ROM 3.01 (00030001), firmware none (00000000)")
        self.assertEqual(str(Versions(0x00030001, 0x00030309)).split(", ")[1], "firmware 3.0309 (00030309)")


if __name__ == "__main__":
    unittest.main()


class TowerSelectionTests(unittest.TestCase):
    def test_classify_port(self):
        from openrcx.transport import classify_port
        self.assertEqual(classify_port(0x16C0), "diy")           # Teensy
        self.assertEqual(classify_port(0x303A), "diy")           # Espressif
        self.assertEqual(classify_port(0x067B), "serial")        # Prolific adapter
        self.assertEqual(classify_port(0x0403), "serial")        # FTDI adapter
        self.assertEqual(classify_port(None, "Communications Port (COM1)"), "serial")
        self.assertEqual(classify_port(0x1234), "unknown")

    def test_resolve_precedence(self):
        import os
        from openrcx import config
        saved = dict(os.environ)
        try:
            os.environ.pop("RCX_PORT", None)
            os.environ.pop("RCX_TOWER", None)
            config.load_config = lambda: {"tower": "serial", "port": "COM8"}
            r = config.resolve()
            self.assertEqual((r["tower"], r["port"]), ("serial", "COM8"))
            os.environ["RCX_TOWER"] = "diy"
            self.assertEqual(config.resolve()["tower"], "diy")
            self.assertEqual(config.resolve(port="COM3", tower="usb")["port"], "COM3")
            self.assertEqual(config.resolve(tower="usb")["tower"], "usb")
            with self.assertRaises(ValueError):
                config.resolve(tower="bogus")
        finally:
            os.environ.clear()
            os.environ.update(saved)
