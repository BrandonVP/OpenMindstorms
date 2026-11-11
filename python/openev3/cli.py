"""``ev3`` command-line tool."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from . import __version__
from . import protocol as P
from .brick import EV3
from .transport import TransportError, list_bluetooth_ports, list_hid_bricks


def _open(args) -> EV3:
    if args.sim:
        from .sim import SimTransport
        return EV3(SimTransport(), verbose=args.verbose)
    return EV3.open(args.port or os.environ.get("EV3_PORT"), verbose=args.verbose)


def _bar(label):
    t0 = time.monotonic()

    def cb(done, total):
        pct = 100 * done // max(1, total)
        sys.stdout.write(f"\r{label} {pct:3d}%  {done}/{total} B ")
        sys.stdout.flush()
        if done >= total:
            sys.stdout.write("\n")
    return cb


def cmd_ports(args):
    for b in list_hid_bricks():
        print(f"usb     EV3 '{b['name']}' serial {b['serial']}")
    for p in list_bluetooth_ports():
        print(f"{p['device']:7} {p['description']}")
    return 0


def cmd_info(args):
    with _open(args) as ev3:
        i = ev3.info()
        print(f"name       {i.name}")
        print(f"firmware   {i.firmware}   hardware {i.hardware}   {i.os}")
        print(f"battery    {i.battery_v:.2f} V ({i.battery_pct}%)")
        print(f"volume     {ev3.volume()}%   sleep after {ev3.sleep_minutes()} min")
        for d in ev3.devices():
            if d.present:
                print(f"port {d.port}:    {d.type_name} (mode {d.mode})")
    return 0


def cmd_devices(args):
    with _open(args) as ev3:
        for d in ev3.devices():
            print(f"port {d.port}: {d.type_name}" + (f", mode {d.mode}" if d.present else ""))
    return 0


def cmd_battery(args):
    with _open(args) as ev3:
        v, pct = ev3.battery()
        print(f"{v:.2f} V ({pct}%)")
    return 0


def cmd_tone(args):
    with _open(args) as ev3:
        ev3.play_tone(args.hz, args.ms, args.volume)
    return 0


def cmd_sound(args):
    with _open(args) as ev3:
        ev3.play_file(args.name, args.volume)
    return 0


def cmd_led(args):
    with _open(args) as ev3:
        ev3.led(args.pattern)
    return 0


def cmd_say(args):
    with _open(args) as ev3:
        ev3.display_text(" ".join(args.text), font=args.font)
    return 0


def cmd_motor(args):
    with _open(args) as ev3:
        if args.degrees:
            ev3.motor_degrees(args.ports, args.speed, args.degrees, brake=not args.coast, wait=True)
        elif args.seconds:
            ev3.motor_time(args.ports, args.speed, int(args.seconds * 1000), brake=not args.coast, wait=True)
        else:
            ev3.motor_speed(args.ports, args.speed)
        for p in args.ports.upper():
            if p in "ABCD":
                sp, tacho = ev3.motor_state(p)
                print(f"motor {p}: speed {sp}, position {tacho} deg")
    return 0


def cmd_drive(args):
    with _open(args) as ev3:
        ev3.drive(args.ports, args.speed, args.turn, degrees=args.degrees, ms=int(args.seconds * 1000) if args.seconds else 0,
                  brake=not args.coast, wait=bool(args.degrees or args.seconds))
    return 0


def cmd_stop(args):
    with _open(args) as ev3:
        ev3.motor_stop("ABCD", brake=not args.coast)
        if args.program:
            ev3.stop_program()
    return 0


def cmd_sensor(args):
    with _open(args) as ev3:
        if args.watch:
            print("Ctrl-C to stop")
            try:
                while True:
                    vals = []
                    for d in ev3.devices():
                        if d.present:
                            try:
                                v = ev3.sensor_value(d.port)
                                vals.append(f"{d.port}:{d.type_name}={v:g}")
                            except Exception:
                                vals.append(f"{d.port}:?")
                    sys.stdout.write("\r" + "  ".join(vals) + "    ")
                    sys.stdout.flush()
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                print()
            return 0
        vals = ev3.sensor_read(args.port, args.mode, args.values)
        name, typ = ev3.sensor_name(args.port)
        print(f"port {args.port} ({typ}): " + ", ".join(f"{v:g}" for v in vals))
    return 0


def cmd_files(args):
    with _open(args) as ev3:
        for f in ev3.list_files(args.path):
            print(("   <dir>  " if f["dir"] else f"{f['size']:8d}  ") + f["name"])
    return 0


def cmd_upload(args):
    with _open(args) as ev3:
        remote = ev3.upload_file(args.file, args.to, _bar(Path(args.file).name))
        print(f"uploaded to {remote}")
        if args.run:
            ev3.run_program(remote)
            print("running")
    return 0


def cmd_download(args):
    with _open(args) as ev3:
        data = ev3.download(args.path, _bar(args.path))
    out = Path(args.output or Path(args.path).name)
    out.write_bytes(data)
    print(f"saved {len(data)} bytes to {out}")
    return 0


def cmd_delete(args):
    with _open(args) as ev3:
        ev3.delete(args.path)
        print("deleted")
    return 0


def cmd_run(args):
    with _open(args) as ev3:
        ev3.run_program(args.path)
        print("running " + args.path)
    return 0


def cmd_name(args):
    with _open(args) as ev3:
        if args.new_name:
            ev3.set_name(args.new_name)
        print(ev3.name())
    return 0


def cmd_volume(args):
    with _open(args) as ev3:
        if args.pct is not None:
            ev3.set_volume(args.pct)
        print(f"{ev3.volume()}%")
    return 0


def cmd_buttons(args):
    with _open(args) as ev3:
        b = ev3.buttons()
        print(", ".join(k for k, v in b.items() if v) or "(none pressed)")
    return 0


def cmd_raw(args):
    body = bytes.fromhex("".join(args.bytes).replace(" ", ""))
    with _open(args) as ev3:
        g = ev3.direct(body, args.globals)
        print("globals: " + (P.hexs(g) or "(none)"))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ev3", description="Control a LEGO Mindstorms EV3 over USB or Bluetooth.")
    ap.add_argument("--version", action="version", version=f"openev3 {__version__}")
    ap.add_argument("-p", "--port", help="'usb' (default) or a Bluetooth COM port ($EV3_PORT)")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--sim", action="store_true", help="talk to a simulated EV3")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("ports", help="list EV3s on USB and Bluetooth COM ports").set_defaults(fn=cmd_ports)
    sp.add_parser("info", help="name, firmware, battery, attached devices").set_defaults(fn=cmd_info)
    sp.add_parser("devices", help="what is plugged into each port").set_defaults(fn=cmd_devices)
    sp.add_parser("battery", help="battery voltage").set_defaults(fn=cmd_battery)
    s = sp.add_parser("tone", help="play a tone"); s.add_argument("hz", type=int); s.add_argument("ms", type=int, nargs="?", default=500); s.add_argument("--volume", type=int, default=50); s.set_defaults(fn=cmd_tone)
    s = sp.add_parser("sound", help="play a sound file on the brick (path without .rsf)"); s.add_argument("name"); s.add_argument("--volume", type=int, default=50); s.set_defaults(fn=cmd_sound)
    s = sp.add_parser("led", help="brick status light: " + " ".join(P.LED_PATTERNS)); s.add_argument("pattern"); s.set_defaults(fn=cmd_led)
    s = sp.add_parser("say", help="show text on the display"); s.add_argument("text", nargs="+"); s.add_argument("--font", type=int, default=1, choices=[0, 1, 2]); s.set_defaults(fn=cmd_say)
    s = sp.add_parser("motor", help="run motors, e.g. 'motor B 50 --degrees 360'"); s.add_argument("ports"); s.add_argument("speed", type=int, nargs="?", default=50)
    s.add_argument("--degrees", type=int, default=0); s.add_argument("-t", "--seconds", type=float); s.add_argument("--coast", action="store_true"); s.set_defaults(fn=cmd_motor)
    s = sp.add_parser("drive", help="steer two motors in sync, e.g. 'drive BC 50 --turn 100 --degrees 720'"); s.add_argument("ports", nargs="?", default="BC"); s.add_argument("speed", type=int, nargs="?", default=50)
    s.add_argument("--turn", type=int, default=0, help="-200..200"); s.add_argument("--degrees", type=int, default=0); s.add_argument("-t", "--seconds", type=float); s.add_argument("--coast", action="store_true"); s.set_defaults(fn=cmd_drive)
    s = sp.add_parser("stop", help="stop all motors (and --program)"); s.add_argument("--coast", action="store_true"); s.add_argument("--program", action="store_true"); s.set_defaults(fn=cmd_stop)
    s = sp.add_parser("sensor", help="read a port, e.g. 'sensor 4' or 'sensor 3 --mode 2'"); s.add_argument("port", nargs="?", default="1"); s.add_argument("--mode", type=int); s.add_argument("--values", type=int, default=1)
    s.add_argument("-w", "--watch", action="store_true"); s.add_argument("--interval", type=float, default=0.3); s.set_defaults(fn=cmd_sensor)
    s = sp.add_parser("files", help="list files (default ../prjs/)"); s.add_argument("path", nargs="?", default="../prjs/"); s.set_defaults(fn=cmd_files)
    s = sp.add_parser("upload", help="copy a file to the brick (default folder ../prjs/OpenEV3/)"); s.add_argument("file"); s.add_argument("--to"); s.add_argument("--run", action="store_true"); s.set_defaults(fn=cmd_upload)
    s = sp.add_parser("download", help="copy a file from the brick"); s.add_argument("path"); s.add_argument("-o", "--output"); s.set_defaults(fn=cmd_download)
    s = sp.add_parser("delete", help="delete a file on the brick"); s.add_argument("path"); s.set_defaults(fn=cmd_delete)
    s = sp.add_parser("run", help="start an .rbf program, e.g. 'run BrkProg_SAVE/Demo.rpf'"); s.add_argument("path"); s.set_defaults(fn=cmd_run)
    s = sp.add_parser("name", help="show or set the brick name"); s.add_argument("new_name", nargs="?"); s.set_defaults(fn=cmd_name)
    s = sp.add_parser("volume", help="show or set the volume"); s.add_argument("pct", type=int, nargs="?"); s.set_defaults(fn=cmd_volume)
    sp.add_parser("buttons", help="which brick buttons are pressed").set_defaults(fn=cmd_buttons)
    s = sp.add_parser("raw", help="run raw bytecodes as a direct command, e.g. 'raw 94 01 81 32 82 b8 01 82 2c 01'"); s.add_argument("bytes", nargs="+"); s.add_argument("--globals", type=int, default=0); s.set_defaults(fn=cmd_raw)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(message)s")
    try:
        return args.fn(args) or 0
    except TimeoutError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except (P.EV3Error, TransportError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
