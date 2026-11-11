"""Unit tests for openev3 - run with:  python -m unittest discover -s python/tests -v"""

import struct
import unittest

from openev3 import protocol as P
from openev3.brick import EV3
from openev3.protocol import GV, LC, LC0, LC1, LC2, LCS, LV, op
from openev3.sim import SimTransport
from openev3.vm import VM, BrickState, VMError


class EncodingTests(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(LC0(5), b"\x05")
        self.assertEqual(LC0(-1), b"\x3f")
        self.assertEqual(LC0(-32), b"\x20")
        self.assertEqual(LC1(100), b"\x81\x64")
        self.assertEqual(LC1(-50), b"\x81\xce")
        self.assertEqual(LC2(440), b"\x82\xb8\x01")
        self.assertEqual(LC(31), b"\x1f")
        self.assertEqual(LC(32), b"\x81\x20")
        self.assertEqual(LC(1000), b"\x82\xe8\x03")
        self.assertEqual(LC(100000)[0], 0x83)
        self.assertEqual(LCS("hi"), b"\x84hi\x00")
        self.assertEqual(GV(3), b"\x63")
        self.assertEqual(GV(40), b"\xe1\x28")
        self.assertEqual(LV(2), b"\x42")

    def test_framing(self):
        msg = P.direct_command(op("SOUND", LC0(1), LC1(50), LC2(440), LC2(300)), 0, 0, 7, reply=False)
        self.assertEqual(msg[:5], bytes([len(msg) - 2, 0, 7, 0, 0x80]))
        self.assertEqual(msg[5:7], b"\x00\x00")
        counter, typ, rest = P.parse_message(bytes.fromhex("0700 0500 02 01 02 03 04"))
        self.assertEqual((counter, typ, rest), (5, 2, b"\x01\x02\x03\x04"))
        with self.assertRaises(ValueError):
            P.direct_command(b"\x01" * 1100, 0, 0, 1)

    def test_rbf_header(self):
        img = P.rbf_image([(b"\x01\x0a", 0)], 4)
        self.assertEqual(img[:4], b"LEGO")
        size, ver, n, g = struct.unpack_from("<IHHI", img, 4)
        self.assertEqual((size, ver, n, g), (len(img), 0x68, 1, 4))
        offset = struct.unpack_from("<I", img, 16)[0]
        self.assertEqual(img[offset:], b"\x01\x0a")

    def test_file_listing(self):
        text = "0123456789abcdef0123456789abcdef 0000012C Program.rbf\nSD_Card/\nBrkProg_SAVE/\n"
        lst = P.parse_file_listing(text)
        self.assertEqual(lst[0], {"name": "Program.rbf", "dir": False, "size": 300, "md5": "0123456789abcdef0123456789abcdef"})
        self.assertTrue(lst[1]["dir"])


class VMTests(unittest.TestCase):
    def test_arithmetic_and_jumps(self):
        # g[0..3] = 5 ; loop: g[0] += 3 while g[0] < 20 (5,8,...,20) ; g[4] = 1 if g[0] == 20
        code = (op("MOVE8_32", LC0(5), GV(0))
                + op("ADD32", GV(0), LC0(3), GV(0))
                + op("JR_LT32", GV(0), LC0(20), LC0(-8))     # back to the ADD32
                + op("CP_EQ32", GV(0), LC0(20), GV(4)))
        vm = VM(BrickState(), 5, 0, code)
        vm.run()
        self.assertEqual(struct.unpack_from("<i", vm.g, 0)[0], 20)
        self.assertEqual(vm.g[4], 1)
        self.assertEqual(vm.steps, 1 + 2 * 5 + 1)

    def test_float_and_strings(self):
        code = op("MOVE8_F", LC0(7), GV(0)) + op("DIVF", GV(0), LC(2), GV(4)) + op("UI_DRAW", LC0(P.UI_DRAW["VALUE"]), LC0(1), LC0(0), LC0(0), GV(4), LC0(3), LC0(1))
        b = BrickState()
        vm = VM(b, 8, 0, code)
        vm.run()
        self.assertAlmostEqual(struct.unpack_from("<f", vm.g, 4)[0], 3.5)
        self.assertEqual(b.display, ["(0,0) 3.5"])

    def test_unknown_opcode(self):
        with self.assertRaises(VMError):
            VM(BrickState(), 0, 0, b"\xfe").run()


class BrickTests(unittest.TestCase):
    def setUp(self):
        self.t = SimTransport()
        self.ev3 = EV3(self.t)
        self.sim = self.t.ev3.state

    def test_info(self):
        i = self.ev3.info()
        self.assertEqual((i.name, i.firmware, i.hardware), ("EV3", "V1.09H", "V0.60"))
        self.assertAlmostEqual(i.battery_v, 7.9, places=2)
        self.assertEqual(i.battery_pct, 95)
        self.ev3.set_name("Robbie")
        self.assertEqual(self.ev3.name(), "Robbie")
        self.ev3.set_volume(80)
        self.assertEqual(self.ev3.volume(), 80)

    def test_sound_led_display(self):
        self.ev3.play_tone(440, 250, volume=30)
        self.ev3.play_file("../prjs/Sounds/Hello", 60)
        self.ev3.led("red_flash")
        self.ev3.display_text(["hello", "world"])
        self.assertEqual(self.sim.sounds[0], ("tone", 440, 250, 30))
        self.assertEqual(self.sim.sounds[1], ("file", "../prjs/Sounds/Hello", 60))
        self.assertEqual(self.sim.led, 5)
        self.assertEqual(self.sim.display, ["(2,2) hello", "(2,14) world"])
        self.assertEqual(self.t.tx_log[-1][4], P.DIRECT_NO_REPLY)

    def test_devices_and_sensors(self):
        self.sim.inputs[0].update(type=16, values=[1.0])
        self.sim.inputs[3].update(type=30, values=[42.5])
        devs = self.ev3.devices()
        self.assertEqual([d.type_name for d in devs], ["touch", "none", "none", "ultrasonic", "large-motor", "large-motor", "large-motor", "none"])
        self.assertEqual(self.ev3.sensor_value(1), 1.0)
        self.assertEqual(self.ev3.sensor_value(4, mode=0), 42.5)
        self.assertEqual(self.sim.inputs[3]["mode"], 0)
        self.assertEqual(self.ev3.sensor_name(4), ("ultrasonic", "ultrasonic"))
        self.sim.inputs[1].update(type=29, values=[3.0, 4.0, 5.0])
        self.assertEqual(self.ev3.sensor_read(2, mode=4, values=3), [3.0, 4.0, 5.0])

    def test_motors(self):
        self.ev3.motor_speed("B", 60)
        self.assertTrue(self.sim.motors[1]["running"])
        self.assertEqual(self.sim.motors[1]["speed"], 60)
        self.ev3.motor_degrees("C", 50, 360)
        self.assertEqual(self.sim.motors[2]["tacho"], 360)
        self.ev3.motor_degrees("C", 50, -90, wait=True)
        self.assertEqual(self.ev3.motor_position("C"), 270)
        self.ev3.drive("BC", 50, turn=50, degrees=720)
        self.assertEqual(self.sim.motors[1]["tacho"], 720)
        self.ev3.motor_stop("ABCD")
        self.assertFalse(self.sim.motors[1]["running"])
        self.ev3.motor_reset("C")
        self.assertEqual(self.ev3.motor_position("C"), 0)
        self.assertFalse(self.ev3.motor_busy("B"))
        self.assertEqual(self.ev3.motor_state("B"), (0, 720))

    def test_buttons(self):
        self.sim.buttons["enter"] = True
        b = self.ev3.buttons()
        self.assertTrue(b["enter"] and not b["up"])

    def test_files_and_programs(self):
        data = bytes(range(256)) * 10
        seen = []
        self.ev3.upload("OpenEV3/test.rbf", data, lambda d, t: seen.append(d))
        self.assertEqual(self.sim.files["../prjs/OpenEV3/test.rbf"], data)
        self.assertEqual(seen[-1], len(data))
        names = [f["name"] for f in self.ev3.list_files()]
        self.assertIn("BrkProg_SAVE", names)
        self.assertIn("OpenEV3", names)
        self.assertEqual(self.ev3.list_files("../prjs/OpenEV3/")[0], {"name": "test.rbf", "dir": False, "size": 2560, "md5": "0" * 32})
        self.assertEqual(self.ev3.download("OpenEV3/test.rbf"), data)
        self.ev3.run_program("OpenEV3/test.rbf")
        self.assertEqual(self.sim.running_program, "../prjs/OpenEV3/test.rbf")
        self.assertTrue(self.ev3.program_running())
        self.ev3.stop_program()
        self.assertIsNone(self.sim.running_program)
        self.ev3.delete("OpenEV3/test.rbf")
        self.assertNotIn("../prjs/OpenEV3/test.rbf", self.sim.files)
        with self.assertRaises(P.EV3Error):
            self.ev3.delete("OpenEV3/test.rbf")
        with self.assertRaises(P.EV3Error):
            self.ev3.run_program("nope.rbf")

    def test_timeout(self):
        self.ev3.timeout = 0.02
        self.t.ev3.handle = lambda msg: None
        with self.assertRaises(TimeoutError):
            self.ev3.battery()


if __name__ == "__main__":
    unittest.main()
