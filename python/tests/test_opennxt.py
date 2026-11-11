"""Unit tests for opennxt - run with:  python -m unittest discover -s python/tests -v"""

import struct
import unittest

from opennxt import protocol as P
from opennxt.brick import NXT
from opennxt.sim import SimTransport


class ProtocolTests(unittest.TestCase):
    def test_build_and_parse(self):
        self.assertEqual(P.build(P.DIRECT, P.PLAY_TONE, struct.pack("<HH", 440, 500)),
                         bytes.fromhex("00 03 b8 01 f4 01"))
        cmd, status, payload = P.parse_reply(bytes.fromhex("02 0b 00 40 1f"))
        self.assertEqual((cmd, status, payload), (P.GET_BATTERY_LEVEL, 0, b"\x40\x1f"))

    def test_name20(self):
        self.assertEqual(len(P.name20("prog.rxe")), 20)
        self.assertEqual(P.cstr(P.name20("prog.rxe")), "prog.rxe")
        with self.assertRaises(ValueError):
            P.name20("this-name-is-far-too-long.rxe")

    def test_bt_frame(self):
        self.assertEqual(P.bt_frame(b"\x00\x0b"), b"\x02\x00\x00\x0b")

    def test_sensor_helpers(self):
        self.assertEqual(P.sensor_type_code("ultrasonic"), 0x0B)
        self.assertEqual(P.sensor_type_code("touch"), 1)
        self.assertEqual(P.sensor_mode_code("percent"), 0x80)
        self.assertEqual(P.sensor_port(4), 3)
        self.assertEqual(P.motor_port("C"), 2)
        self.assertEqual(P.motor_port("all"), 0xFF)


class BrickTests(unittest.TestCase):
    def setUp(self):
        self.t = SimTransport()
        self.nxt = NXT(self.t)
        self.sim = self.t.nxt

    def test_identity(self):
        info = self.nxt.device_info()
        self.assertEqual(info.name, "NXT")
        self.assertEqual(info.bt_address, "00:16:53:02:C8:E0")
        self.assertEqual(self.nxt.firmware_version(), ("1.124", "1.31"))
        self.assertEqual(self.nxt.battery_mv(), 8000)
        self.nxt.set_brick_name("Robbie")
        self.assertEqual(self.nxt.device_info().name, "Robbie")
        self.assertEqual(self.nxt.keep_alive(), 600000)

    def test_tone_and_sound(self):
        self.nxt.play_tone(880, 250)
        self.nxt.play_sound_file("Woops.rso")
        self.assertEqual(self.sim.sounds, [(880, 250), "Woops.rso"])
        with self.assertRaises(P.NxtError) as cm:
            self.nxt.play_sound_file("nope.rso")
        self.assertEqual(cm.exception.status, 0xBD)

    def test_no_reply_commands(self):
        self.nxt.play_tone(440, 100, reply=False)
        self.assertEqual(self.t.tx_log[-1][0], P.DIRECT_NOREPLY)
        self.assertEqual(self.t.queue, [])

    def test_motors(self):
        self.nxt.motor_run("B", 50, degrees=360)
        s = self.nxt.get_output_state("B")
        self.assertEqual(s.power, 50)
        self.assertEqual(s.tacho_limit, 360)
        self.assertEqual(s.tacho_count, 360)
        self.assertTrue(s.mode & P.MOTOR_REGULATED)
        self.nxt.motor_run("A", -30)
        self.assertEqual(self.nxt.get_output_state("A").tacho_count, -360)
        self.nxt.motors_sync(60, turn_ratio=25, degrees=720)
        self.assertEqual(self.nxt.get_output_state("C").regulation, P.REGULATION_SYNC)
        self.assertEqual(self.nxt.get_output_state("C").turn_ratio, 25)
        self.nxt.motor_stop("B", brake=False)
        self.assertEqual(self.nxt.get_output_state("B").mode, 0)
        self.nxt.reset_motor_position("A")
        self.assertEqual(self.nxt.get_output_state("A").tacho_count, 0)
        self.nxt.motors_stop()
        self.assertEqual(self.nxt.get_output_state("C").power, 0)

    def test_sensors(self):
        self.nxt.set_input_mode(1, "touch")
        v = self.nxt.get_input_values(1)
        self.assertEqual((v.type_name, v.mode_name), ("touch", "bool"))
        self.sim.sensors[0]["scaled"] = 1
        self.assertEqual(self.nxt.sensor_value(1), 1)
        self.nxt.set_input_mode(3, "light", "percent")
        self.assertEqual(self.nxt.get_input_values(3).sensor_mode, 0x80)
        with self.assertRaises(ValueError):
            self.nxt.set_input_mode(5, "touch")

    def test_ultrasonic(self):
        self.nxt.ultrasonic_setup(4)
        self.sim.ultrasonic_cm[3] = 23
        self.assertEqual(self.nxt.ultrasonic_cm(4), 23)
        self.sim.ultrasonic_cm[3] = 255
        self.assertIsNone(self.nxt.ultrasonic_cm(4))

    def test_messages(self):
        self.assertIsNone(self.nxt.message_read(0))
        self.nxt.message_write(0, "hello")
        self.assertEqual(self.nxt.message_read(0), "hello")
        self.assertIsNone(self.nxt.message_read(0))

    def test_programs(self):
        self.assertIsNone(self.nxt.current_program())
        self.nxt.start_program("Untitled-1.rxe")
        self.assertEqual(self.nxt.current_program(), "Untitled-1.rxe")
        self.nxt.stop_program()
        self.assertIsNone(self.nxt.current_program())
        self.nxt.stop_program()   # status 0xEC is tolerated
        with self.assertRaises(P.NxtError):
            self.nxt.start_program("missing.rxe")

    def test_files(self):
        self.assertEqual([n for n, _ in self.nxt.list_files()], ["Untitled-1.rxe", "Woops.rso"])
        self.assertEqual(self.nxt.list_files("*.rso"), [("Woops.rso", 1500)])
        self.assertEqual(self.nxt.list_files("*.ric"), [])
        data = bytes(range(256)) * 3        # 768 bytes -> 14 write chunks
        seen = []
        before = self.nxt.device_info().free_flash
        self.nxt.upload("test.rxe", data, progress=lambda d, t: seen.append(d))
        self.assertEqual(self.sim.files["test.rxe"], data)
        self.assertEqual(seen[-1], 768)
        self.assertEqual(self.nxt.device_info().free_flash, before - 768)
        opens = [c for c, _ in self.sim.log if c in (P.OPEN_WRITE, P.OPEN_WRITE_LINEAR)]
        self.assertEqual(opens[-1], P.OPEN_WRITE_LINEAR)   # programs are linear files
        self.assertEqual(self.nxt.download("test.rxe"), data)
        self.nxt.upload("test.rxe", b"abc")              # replace
        self.assertEqual(self.sim.files["test.rxe"], b"abc")
        self.nxt.upload("log.txt", b"1,2,3")
        self.assertEqual([c for c, _ in self.sim.log if c == P.OPEN_WRITE][-1], P.OPEN_WRITE)
        self.nxt.delete_file("test.rxe")
        self.assertNotIn("test.rxe", self.sim.files)
        with self.assertRaises(P.NxtError) as cm:
            self.nxt.delete_file("test.rxe")
        self.assertEqual(cm.exception.status, 0x87)

    def test_timeout_and_unknown_command(self):
        self.nxt.timeout = 0.02
        with self.assertRaises(P.NxtError) as cm:
            self.nxt.call(P.DIRECT, 0x7F)
        self.assertEqual(cm.exception.status, 0xBE)
        self.t.queue.clear()
        self.t.nxt.handle_message = lambda msg: None
        with self.assertRaises(TimeoutError):
            self.nxt.battery_mv()


if __name__ == "__main__":
    unittest.main()
