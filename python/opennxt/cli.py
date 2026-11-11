"""``nxt`` command-line tool."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from . import __version__
from . import protocol as P
from .brick import NXT
from .transport import TransportError, list_bluetooth_ports


def _open(args) -> NXT:
    if args.sim:
        from .sim import SimTransport
        return NXT(SimTransport(), verbose=args.verbose)
    return NXT.open(args.port or os.environ.get("NXT_PORT"), verbose=args.verbose)


def _bar(label):
    t0 = time.monotonic()

    def cb(done, total):
        pct = 100 * done // max(1, total)
        el = time.monotonic() - t0
        rate = done / el if el else 0
        sys.stdout.write(f"\r{label} {pct:3d}%  {done}/{total} B  {rate:6.0f} B/s ")
        sys.stdout.flush()
        if done >= total:
            sys.stdout.write("\n")
    return cb


def cmd_ports(args):
    ports = list_bluetooth_ports()
    print("USB: use -p usb (default). Bluetooth COM ports found:" if ports else "No Bluetooth COM ports found; USB is the default.")
    for p in ports:
        print(f"  {p['device']:6} {p['description']}")
    return 0


def cmd_info(args):
    with _open(args) as nxt:
        i = nxt.device_info()
        proto, fw = nxt.firmware_version()
        print(f"name       {i.name}")
        print(f"firmware   {fw}  (protocol {proto})")
        print(f"battery    {nxt.battery_mv() / 1000:.2f} V")
        print(f"free flash {i.free_flash} bytes")
        print(f"bluetooth  {i.bt_address}")
        prog = nxt.current_program()
        print(f"running    {prog or '-'}")
    return 0


def cmd_battery(args):
    with _open(args) as nxt:
        print(f"{nxt.battery_mv() / 1000:.2f} V")
    return 0


def cmd_tone(args):
    with _open(args) as nxt:
        nxt.play_tone(args.hz, args.ms)
    return 0


def cmd_sound(args):
    with _open(args) as nxt:
        nxt.play_sound_file(args.name, args.loop)
    return 0


def cmd_motor(args):
    with _open(args) as nxt:
        ports = [c for c in args.ports.upper() if c in "ABC"] or ["A"]
        if args.sync and len(ports) == 2:
            nxt.motors_sync(args.power, args.turn, args.degrees, ports, brake=not args.coast)
        else:
            for p in ports:
                nxt.motor_run(p, args.power, args.degrees, regulated=not args.unregulated, brake=not args.coast)
        if args.seconds:
            time.sleep(args.seconds)
            for p in ports:
                nxt.motor_stop(p, brake=not args.coast)
        for p in ports:
            s = nxt.get_output_state(p)
            print(f"motor {p}: power {s.power}, tacho {s.tacho_count}, {'running' if s.running else 'stopped'}")
    return 0


def cmd_stop(args):
    with _open(args) as nxt:
        nxt.motors_stop(brake=not args.coast)
        if args.program:
            nxt.stop_program()
    return 0


def cmd_reset(args):
    with _open(args) as nxt:
        for p in args.ports.upper():
            if p in "ABC":
                nxt.reset_motor_position(p, args.relative)
    return 0


def cmd_sensor(args):
    with _open(args) as nxt:
        if args.type:
            nxt.set_input_mode(args.port, args.type, args.mode)
            print(f"port {args.port} set to {args.type}" + (f"/{args.mode}" if args.mode else ""))
            time.sleep(0.1)
        if args.watch:
            print("Ctrl-C to stop")
            try:
                while True:
                    vals = []
                    for port in range(1, 5):
                        try:
                            v = nxt.get_input_values(port)
                            vals.append(f"{port}:{v.scaled:5d}" if v.sensor_type else f"{port}:   --")
                        except Exception:
                            vals.append(f"{port}:  ???")
                    sys.stdout.write("\r" + "  ".join(vals) + "   ")
                    sys.stdout.flush()
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                print()
        else:
            v = nxt.get_input_values(args.port)
            print(f"port {args.port}: {v.type_name}/{v.mode_name}  scaled {v.scaled}  raw {v.raw}  normalized {v.normalized}")
    return 0


def cmd_ultrasonic(args):
    with _open(args) as nxt:
        nxt.ultrasonic_setup(args.port)
        for _ in range(args.count):
            cm = nxt.ultrasonic_cm(args.port)
            print("no echo" if cm is None else f"{cm} cm")
            if args.count > 1:
                time.sleep(0.3)
    return 0


def cmd_files(args):
    with _open(args) as nxt:
        files = nxt.list_files(args.pattern)
        if not files:
            print("no files")
        for name, size in files:
            print(f"{size:8d}  {name}")
        print(f"free: {nxt.device_info().free_flash} bytes")
    return 0


def cmd_upload(args):
    path = Path(args.file)
    with _open(args) as nxt:
        name = nxt.upload_file(path, args.name, _bar(path.name))
        print(f"uploaded {name}")
        if args.run:
            nxt.start_program(name)
            print(f"started {name}")
    return 0


def cmd_download(args):
    with _open(args) as nxt:
        data = nxt.download(args.name, _bar(args.name))
    out = Path(args.output or args.name)
    out.write_bytes(data)
    print(f"saved {len(data)} bytes to {out}")
    return 0


def cmd_delete(args):
    with _open(args) as nxt:
        nxt.delete_file(args.name)
        print(f"deleted {args.name}")
    return 0


def cmd_run(args):
    with _open(args) as nxt:
        nxt.start_program(args.name if args.name.lower().endswith(".rxe") else args.name + ".rxe")
        print(f"running {nxt.current_program()}")
    return 0


def cmd_name(args):
    with _open(args) as nxt:
        if args.new_name:
            nxt.set_brick_name(args.new_name)
        print(nxt.device_info().name)
    return 0


def cmd_message(args):
    with _open(args) as nxt:
        if args.text is not None:
            nxt.message_write(args.inbox, args.text)
            print(f"sent to mailbox {args.inbox + 1}")
        else:
            m = nxt.message_read(args.inbox)
            print("(empty)" if m is None else m)
    return 0


def cmd_keepalive(args):
    with _open(args) as nxt:
        print(f"sleep limit {nxt.keep_alive() / 1000:.0f} s")
    return 0


def cmd_raw(args):
    body = bytes.fromhex("".join(args.bytes).replace(" ", ""))
    with _open(args) as nxt:
        status, data = nxt.call(body[0], body[1], body[2:], ok_statuses=tuple(range(256)))
        print(f"status 0x{status:02X} ({P.STATUS.get(status, '?')})  payload: {P.hexs(data) or '(none)'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="nxt", description="Control and program a LEGO Mindstorms NXT over USB or Bluetooth.")
    ap.add_argument("--version", action="version", version=f"opennxt {__version__}")
    ap.add_argument("-p", "--port", help="'usb' (default) or the Bluetooth COM port, e.g. COM5 ($NXT_PORT)")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every message")
    ap.add_argument("--sim", action="store_true", help="talk to a simulated NXT")
    sp = ap.add_subparsers(dest="cmd", required=True)

    sp.add_parser("ports", help="list Bluetooth COM ports").set_defaults(fn=cmd_ports)
    sp.add_parser("info", help="name, firmware, battery, free flash").set_defaults(fn=cmd_info)
    sp.add_parser("battery", help="battery voltage").set_defaults(fn=cmd_battery)
    s = sp.add_parser("tone", help="play a tone"); s.add_argument("hz", type=int); s.add_argument("ms", type=int, nargs="?", default=500); s.set_defaults(fn=cmd_tone)
    s = sp.add_parser("sound", help="play a sound file on the brick"); s.add_argument("name"); s.add_argument("--loop", action="store_true"); s.set_defaults(fn=cmd_sound)
    s = sp.add_parser("motor", help="run motors, e.g. 'motor BC 75 --degrees 360' or 'motor A -50 -t 2'")
    s.add_argument("ports", help="A, B, C or a combination like BC")
    s.add_argument("power", type=int, nargs="?", default=75, help="-100..100")
    s.add_argument("--degrees", type=int, default=0, help="stop after this many degrees (0 = keep running)")
    s.add_argument("-t", "--seconds", type=float, help="run this long, then stop")
    s.add_argument("--sync", action="store_true", help="drive two motors in sync (with --turn)")
    s.add_argument("--turn", type=int, default=0, help="turn ratio -100..100 for --sync")
    s.add_argument("--coast", action="store_true", help="coast instead of brake when stopping")
    s.add_argument("--unregulated", action="store_true")
    s.set_defaults(fn=cmd_motor)
    s = sp.add_parser("stop", help="stop all motors (and --program)"); s.add_argument("--coast", action="store_true"); s.add_argument("--program", action="store_true"); s.set_defaults(fn=cmd_stop)
    s = sp.add_parser("reset", help="reset motor tacho counters"); s.add_argument("ports", nargs="?", default="ABC"); s.add_argument("--relative", action="store_true"); s.set_defaults(fn=cmd_reset)
    s = sp.add_parser("sensor", help="configure or read a sensor port 1-4")
    s.add_argument("port", type=int, choices=range(1, 5), nargs="?", default=1)
    s.add_argument("type", nargs="?", choices=sorted(list(P.SENSOR_TYPES) + ["ultrasonic"]))
    s.add_argument("mode", nargs="?", choices=sorted(P.SENSOR_MODES))
    s.add_argument("-w", "--watch", action="store_true"); s.add_argument("--interval", type=float, default=0.3)
    s.set_defaults(fn=cmd_sensor)
    s = sp.add_parser("ultrasonic", help="read the ultrasonic sensor in cm"); s.add_argument("port", type=int, choices=range(1, 5), nargs="?", default=4); s.add_argument("-n", "--count", type=int, default=1); s.set_defaults(fn=cmd_ultrasonic)
    s = sp.add_parser("files", help="list files on the brick"); s.add_argument("pattern", nargs="?", default="*.*"); s.set_defaults(fn=cmd_files)
    s = sp.add_parser("upload", help="copy a file (.rxe program, .rso sound, .ric picture) to the brick"); s.add_argument("file"); s.add_argument("--name"); s.add_argument("--run", action="store_true"); s.set_defaults(fn=cmd_upload)
    s = sp.add_parser("download", help="copy a file from the brick"); s.add_argument("name"); s.add_argument("-o", "--output"); s.set_defaults(fn=cmd_download)
    s = sp.add_parser("delete", help="delete a file on the brick"); s.add_argument("name"); s.set_defaults(fn=cmd_delete)
    s = sp.add_parser("run", help="start a program on the brick"); s.add_argument("name"); s.set_defaults(fn=cmd_run)
    s = sp.add_parser("name", help="show or set the brick name"); s.add_argument("new_name", nargs="?"); s.set_defaults(fn=cmd_name)
    s = sp.add_parser("message", help="read mailbox N, or send TEXT to it"); s.add_argument("inbox", type=int, choices=range(0, 10)); s.add_argument("text", nargs="?"); s.set_defaults(fn=cmd_message)
    sp.add_parser("keepalive", help="reset the sleep timer").set_defaults(fn=cmd_keepalive)
    s = sp.add_parser("raw", help="send raw bytes: type command payload..., e.g. 'raw 00 0b'"); s.add_argument("bytes", nargs="+"); s.set_defaults(fn=cmd_raw)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(message)s")
    try:
        return args.fn(args) or 0
    except TimeoutError as e:
        print(f"error: {e}. Is the brick on and connected?", file=sys.stderr)
        return 2
    except (P.NxtError, TransportError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    except Exception as e:  # serial/usb layer surprises: say what happened, no traceback
        hint = ""
        if args.port and args.port.upper().startswith("COM"):
            hint = (" A paired NXT shows two COM ports; use the one marked 'outgoing' in "
                    "Device Manager, and make sure the Workbench is not holding it open.")
        print(f"error: {type(e).__name__}: {e}.{hint}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
