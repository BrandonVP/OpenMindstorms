"""``rcx`` command-line tool."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from . import __version__
from . import protocol as P
from .config import TOWER_HELP, TOWER_TYPES, config_path, load_config, resolve, save_config
from .firmware import bundled_firmware_path, load_firmware
from .image import load_rcx
from .link import NoReply, RcxError
from .nqc import NqcError, compile_nqc, find_nqc
from .rcx import RCX
from .transport import TransportError, list_serial_ports


def _progress_bar(label: str):
    start = time.monotonic()

    def cb(done: int, total: int) -> None:
        pct = 100 * done // max(1, total)
        width = 30
        filled = width * done // max(1, total)
        bar = "#" * filled + "-" * (width - filled)
        el = time.monotonic() - start
        rate = done / el if el > 0 else 0
        eta = (total - done) / rate if rate > 0 else 0
        sys.stdout.write(f"\r{label} [{bar}] {pct:3d}%  {done}/{total} B  "
                         f"{rate:5.0f} B/s  ETA {eta:4.0f}s ")
        sys.stdout.flush()
        if done >= total:
            sys.stdout.write("\n")

    return cb


def _open(args) -> RCX:
    if args.sim:
        from .sim import SimTransport
        return RCX.from_transport(SimTransport(firmware=not args.sim_blank), verbose=args.verbose)
    s = resolve(args.port, "serial" if args.echo else args.tower, args.usb_range)
    rcx = RCX.open(s["port"], tower=s["tower"], verbose=args.verbose, usb_range=s["usb_range"])
    if args.verbose:
        print(f"tower: {rcx.link.t.name} on {s['port'] or 'usb'}")
    return rcx


def _resolve_image(path: Path, target: str):
    """Accept .rcx or .nqc (compiled on the fly)."""
    if path.suffix.lower() == ".nqc":
        out = compile_nqc(path, target=target)
        print(f"compiled {path.name} -> {out.name}")
        return load_rcx(out)
    return load_rcx(path)


# ---------------------------------------------------------------------------
def cmd_ports(args):
    ports = list_serial_ports(probe=args.probe)
    if not ports:
        print("no serial ports found")
        return 1
    for p in ports:
        vidpid = f"{p['vid']:04x}:{p['pid']:04x}" if p["vid"] else "    -    "
        extra = ""
        if args.probe and p["kind"] != "diy":
            extra = {True: "  <- LEGO serial tower detected (CTS follows RTS)",
                     False: "  (no serial tower answering on RTS/CTS)",
                     None: "  (port busy or cannot be opened)"}[p["tower"]]
        print(f"{p['device']:8} {vidpid}  {p['description']}  {p['hint']}{extra}")
    if not args.probe:
        print("tip: 'rcx ports --probe' toggles RTS on each port to find a LEGO serial tower")
    return 0


def cmd_config(args):
    cfg = load_config()
    changed = False
    if args.clear:
        cfg = {}
        changed = True
    for key in ("tower", "port", "usb_range"):
        val = getattr(args, "set_" + key)
        if val is not None:
            cfg[key] = val
            changed = True
    if changed:
        path = save_config(cfg)
        print(f"saved {path}")
    eff = resolve()
    print(f"tower:     {eff['tower']}  ({TOWER_HELP[eff['tower']]})")
    print(f"port:      {eff['port'] or '(auto-detect)'}")
    print(f"usb range: {eff['usb_range']}")
    print(f"config file: {config_path()}" + ("" if config_path().exists() else " (not written yet)"))
    return 0


def cmd_ping(args):
    with _open(args) as rcx:
        t0 = time.monotonic()
        rcx.ping()
        print(f"RCX is alive ({(time.monotonic() - t0) * 1000:.0f} ms round trip)")
    return 0


def cmd_info(args):
    with _open(args) as rcx:
        v = rcx.versions()
        print(v)
        if not v.has_firmware:
            print("no firmware loaded - run: rcx firmware   (battery, sounds, motors need firmware)")
            return 0
        mv = rcx.battery_mv()
        print(f"battery {mv / 1000:.2f} V")
        if args.memmap:
            m = rcx.memory_map()
            free = m[93] - m[92]
            print(f"free memory {free} bytes (0x{m[92]:04x}..0x{m[93]:04x})")
    return 0


def cmd_battery(args):
    with _open(args) as rcx:
        print(f"{rcx.battery_mv() / 1000:.2f} V")
    return 0


def cmd_firmware(args):
    if args.delete:
        with _open(args) as rcx:
            rcx.delete_firmware()
            print("firmware deleted")
        return 0
    path = Path(args.file) if args.file else bundled_firmware_path(args.fw_version)
    img = load_firmware(path)
    print(f"{path.name}: {len(img)} bytes at 0x{img.start:04x}, checksum 0x{img.checksum:04x}"
          + (f" ({img.title})" if img.title else ""))
    with _open(args) as rcx:
        v = rcx.versions()
        print(v)
        if v.has_firmware and not args.force:
            print("firmware already present. Use --force to replace it "
                  "(the brick will forget its programs).")
            return 1
        est = len(img) * 2.0 * 11 / 2400 * 1.15
        print(f"downloading firmware, about {est:.0f} s at 2400 baud. "
              "Keep the tower pointed at the RCX and shade it from bright light.")
        rcx.download_firmware(img, _progress_bar("firmware"))
        print("firmware installed; the RCX should have played its start-up sound")
        time.sleep(1.0)
        try:
            print(rcx.versions())
        except NoReply:
            pass
    return 0


def cmd_build(args):
    out = Path(args.output) if args.output else None
    path = compile_nqc(Path(args.source), out, target=args.target, extra=args.nqc_args)
    img = load_rcx(path)
    print(f"{path}: {img.describe()}")
    return 0


def cmd_download(args):
    img = _resolve_image(Path(args.file), args.target)
    print(img.describe())
    slot = args.program - 1
    with _open(args) as rcx:
        rcx.download_program(img, slot, _progress_bar(f"program {args.program}"))
        print(f"downloaded into program slot {args.program}")
        if args.run:
            rcx.start_task(0)
            print("started task 0")
    return 0


def cmd_run(args):
    args.run = True
    return cmd_download(args)


def cmd_start(args):
    with _open(args) as rcx:
        if args.program is not None:
            rcx.select_program(args.program - 1)
        rcx.start_task(args.task)
    return 0


def cmd_stop(args):
    with _open(args) as rcx:
        if args.task is None:
            rcx.stop_all()
        else:
            rcx.stop_task(args.task)
        if args.motors:
            rcx.motor_off("ABC")
    return 0


def cmd_program(args):
    with _open(args) as rcx:
        rcx.select_program(args.number - 1)
    return 0


def cmd_motor(args):
    with _open(args) as rcx:
        m = args.motors
        if args.power is not None:
            rcx.motor_power(m, args.power)
        for act in args.actions:
            a = act.lower()
            if a == "on":
                rcx.motor_on(m)
            elif a == "off":
                rcx.motor_off(m)
            elif a == "float":
                rcx.motor_float(m)
            elif a in ("fwd", "forward", "rev", "reverse", "flip"):
                rcx.motor_direction(m, a)
            else:
                raise SystemExit(f"unknown motor action '{act}'")
        if args.seconds:
            time.sleep(args.seconds)
            rcx.motor_off(m)
    return 0


def cmd_sound(args):
    with _open(args) as rcx:
        s = args.sound
        rcx.play_sound(int(s) if s.isdigit() else s)
    return 0


def cmd_tone(args):
    with _open(args) as rcx:
        rcx.play_tone(args.hz, max(1, args.ms // 10))
    return 0


def cmd_sensor(args):
    with _open(args) as rcx:
        idx = args.number - 1
        if args.type:
            rcx.configure_sensor(idx, args.type, args.mode)
            print(f"sensor {args.number} configured as {args.type}" + (f"/{args.mode}" if args.mode else ""))
        if args.watch:
            print("Ctrl-C to stop")
            try:
                while True:
                    vals = []
                    for i in range(3):
                        try:
                            vals.append(f"S{i + 1}={rcx.sensor_value(i):5d}")
                        except NoReply:
                            vals.append(f"S{i + 1}=  ???")
                    sys.stdout.write("\r" + "  ".join(vals) + "   ")
                    sys.stdout.flush()
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                print()
        elif not args.type:
            print(f"sensor {args.number} = {rcx.sensor_value(idx)} "
                  f"(raw {rcx.sensor_raw(idx)}, bool {int(rcx.sensor_bool(idx))})")
    return 0


def cmd_get(args):
    with _open(args) as rcx:
        src = P.SOURCES.get(args.source.lower())
        if src is None:
            src = int(args.source, 0)
        print(rcx.get_value(src, args.index))
    return 0


def cmd_var(args):
    with _open(args) as rcx:
        if args.value is not None:
            rcx.set_variable(args.index, args.value)
        print(f"var {args.index} = {rcx.variable(args.index)}")
    return 0


def cmd_message(args):
    with _open(args) as rcx:
        if args.value is not None:
            rcx.set_message(args.value)
        else:
            print(f"message = {rcx.message()}")
    return 0


def cmd_display(args):
    with _open(args) as rcx:
        rcx.set_display(args.what)
    return 0


def cmd_clock(args):
    with _open(args) as rcx:
        if args.time:
            h, m = args.time.split(":")
            rcx.set_time(int(h), int(m))
        else:
            now = time.localtime()
            rcx.set_time(now.tm_hour, now.tm_min)
        print(f"RCX clock set; watch reads {rcx.watch()} minutes")
    return 0


def cmd_off(args):
    with _open(args) as rcx:
        rcx.power_off()
    return 0


def cmd_sleep(args):
    with _open(args) as rcx:
        rcx.set_power_down_delay(args.minutes)
        print("auto power-off " + ("disabled" if args.minutes == 0 else f"after {args.minutes} min"))
    return 0


def cmd_datalog(args):
    with _open(args) as rcx:
        if args.size is not None:
            rcx.set_datalog_size(args.size)
            print(f"datalog cleared, size {args.size}")
            return 0
        rows = rcx.upload_datalog()
        if not rows:
            print("datalog is empty")
            return 0
        for i, (kind, val) in enumerate(rows):
            if kind < 0x20:
                src = f"var {kind}"
            elif kind < 0x24:
                src = f"timer {kind - 0x20}"
            elif 0x40 <= kind <= 0x42:
                src = f"sensor {kind - 0x40 + 1}"
            elif kind == 0x80:
                src = "clock"
            else:
                src = f"type 0x{kind:02x}"
            print(f"{i:4d}  {src:10} {val}")
    return 0


def cmd_raw(args):
    body = bytes.fromhex("".join(args.bytes).replace(",", " ").replace(" ", ""))
    with _open(args) as rcx:
        r = rcx.raw(body, expect=args.expect)
        print(f"reply payload: {P.hexs(r) or '(none)'}")
    return 0


def cmd_memmap(args):
    with _open(args) as rcx:
        m = rcx.memory_map()
        # Entries are start addresses; a chunk's size is the gap to the next
        # entry, so the usable facts are the datalog window and free space.
        for prog in range(5):
            tasks = m[40 + prog * 10:40 + prog * 10 + 10]
            subs = m[prog * 8:prog * 8 + 8]
            print(f"program {prog + 1}: task 0 at 0x{tasks[0]:04x}, sub 0 at 0x{subs[0]:04x}")
        print(f"datalog 0x{m[90]:04x}..0x{m[91]:04x} ({m[91] - m[90]} bytes used), "
              f"free 0x{m[92]:04x}..0x{m[93]:04x} ({m[93] - m[92]} bytes)")
    return 0


def cmd_demo(args):
    """Quick hardware check: beep, flash the display, spin motor A briefly."""
    with _open(args) as rcx:
        print(rcx.versions())
        print(f"battery {rcx.battery_mv() / 1000:.2f} V")
        rcx.play_sound("up")
        for d in ("1", "2", "3", "a", "b", "c", "watch"):
            rcx.set_display(d)
            time.sleep(0.3)
        if args.motor:
            rcx.motor_power("A", 7)
            rcx.motor_direction("A", "fwd")
            rcx.motor_on("A")
            time.sleep(1.0)
            rcx.motor_direction("A", "flip")
            time.sleep(1.0)
            rcx.motor_off("A")
        rcx.play_sound("fastup")
        s = rcx.link.stats
        print(f"link stats: {s['sent']} packets, {s['retries']} retries, {s['failed']} failed")
    return 0


# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="rcx",
                                 description="Program and control a LEGO Mindstorms RCX "
                                             "through an IR tower.")
    ap.add_argument("--version", action="version", version=f"openrcx {__version__}")
    ap.add_argument("-p", "--port", help="COM port of the tower (default: $RCX_PORT, then the "
                                         "saved config, then auto-detect)")
    ap.add_argument("-t", "--tower", choices=TOWER_TYPES,
                    help="which tower: diy = OpenRCX Teensy/ESP32, serial = original LEGO serial "
                         "tower on a COM port/USB-serial adapter, usb = original LEGO USB tower "
                         "via WinUSB (default: $RCX_TOWER, saved config, else auto)")
    ap.add_argument("--echo", action="store_true", help=argparse.SUPPRESS)  # old alias for -t serial
    ap.add_argument("--usb-range", choices=["short", "medium", "long"],
                    help="IR range for the LEGO USB tower (default medium)")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every packet")
    ap.add_argument("--sim", action="store_true", help="talk to a simulated RCX (no hardware)")
    ap.add_argument("--sim-blank", action="store_true", help="simulated RCX has no firmware")
    ap.add_argument("-T", "--target", default="rcx2", help="NQC target when compiling (default rcx2)")

    sp = ap.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("ports", help="list serial ports; --probe looks for a LEGO serial tower")
    s.add_argument("--probe", action="store_true")
    s.set_defaults(fn=cmd_ports)

    s = sp.add_parser("config", help="show or save the default tower and port")
    s.add_argument("--tower", dest="set_tower", choices=TOWER_TYPES)
    s.add_argument("--port", dest="set_port")
    s.add_argument("--usb-range", dest="set_usb_range", choices=["short", "medium", "long"])
    s.add_argument("--clear", action="store_true", help="forget saved settings")
    s.set_defaults(fn=cmd_config)
    sp.add_parser("ping", help="check the RCX answers").set_defaults(fn=cmd_ping)
    s = sp.add_parser("info", help="ROM/firmware versions and battery")
    s.add_argument("--memmap", action="store_true")
    s.set_defaults(fn=cmd_info)
    sp.add_parser("battery", help="battery voltage").set_defaults(fn=cmd_battery)

    s = sp.add_parser("firmware", help="install firmware (default: bundled firm0328.lgo)")
    s.add_argument("file", nargs="?", help=".lgo S-record file")
    s.add_argument("--fw-version", default="0328", help="bundled version: 0328 or 0309")
    s.add_argument("--force", action="store_true", help="replace existing firmware")
    s.add_argument("--delete", action="store_true", help="erase firmware instead")
    s.set_defaults(fn=cmd_firmware)

    s = sp.add_parser("build", help="compile an NQC source file")
    s.add_argument("source")
    s.add_argument("-o", "--output")
    s.add_argument("nqc_args", nargs="*", help="extra nqc arguments")
    s.set_defaults(fn=cmd_build)

    for name, fn, hlp in (("download", cmd_download, "download a .rcx/.nqc program"),
                          ("run", cmd_run, "download then start task 0")):
        s = sp.add_parser(name, help=hlp)
        s.add_argument("file")
        s.add_argument("-n", "--program", type=int, default=1, choices=range(1, 6),
                       help="program slot 1-5 (default 1)")
        s.add_argument("--run", action="store_true", help="start task 0 afterwards")
        s.set_defaults(fn=fn)

    s = sp.add_parser("start", help="start a task (default 0 = main)")
    s.add_argument("task", nargs="?", type=int, default=0)
    s.add_argument("-n", "--program", type=int, choices=range(1, 6), help="select slot first")
    s.set_defaults(fn=cmd_start)

    s = sp.add_parser("stop", help="stop a task, or everything")
    s.add_argument("task", nargs="?", type=int)
    s.add_argument("--motors", action="store_true", help="also switch motors off")
    s.set_defaults(fn=cmd_stop)

    s = sp.add_parser("program", help="select program slot 1-5")
    s.add_argument("number", type=int, choices=range(1, 6))
    s.set_defaults(fn=cmd_program)

    s = sp.add_parser("motor", help="drive motors, e.g. 'motor AC fwd on --power 5 -t 2'")
    s.add_argument("motors", help="A, B, C or a combination like AB")
    s.add_argument("actions", nargs="*", help="on off float fwd rev flip")
    s.add_argument("--power", type=int, choices=range(0, 8))
    s.add_argument("-t", "--seconds", type=float, help="run this long, then stop")
    s.set_defaults(fn=cmd_motor)

    s = sp.add_parser("sound", help="play a system sound: " + " ".join(P.SOUNDS))
    s.add_argument("sound", nargs="?", default="beep")
    s.set_defaults(fn=cmd_sound)

    s = sp.add_parser("tone", help="play a tone")
    s.add_argument("hz", type=int)
    s.add_argument("ms", type=int, nargs="?", default=500)
    s.set_defaults(fn=cmd_tone)

    s = sp.add_parser("sensor", help="configure or read a sensor port 1-3")
    s.add_argument("number", type=int, choices=range(1, 4), nargs="?", default=1)
    s.add_argument("type", nargs="?", choices=sorted(P.SENSOR_TYPES))
    s.add_argument("mode", nargs="?", choices=sorted(P.SENSOR_MODES))
    s.add_argument("-w", "--watch", action="store_true", help="live readout of all three")
    s.add_argument("--interval", type=float, default=0.3)
    s.set_defaults(fn=cmd_sensor)

    s = sp.add_parser("get", help="read any value source: var timer motor program sensor raw bool watch message")
    s.add_argument("source")
    s.add_argument("index", type=int, nargs="?", default=0)
    s.set_defaults(fn=cmd_get)

    s = sp.add_parser("var", help="read or set variable 0-31")
    s.add_argument("index", type=int)
    s.add_argument("value", type=int, nargs="?")
    s.set_defaults(fn=cmd_var)

    s = sp.add_parser("message", help="read the IR message, or send one")
    s.add_argument("value", type=int, nargs="?")
    s.set_defaults(fn=cmd_message)

    s = sp.add_parser("display", help="LCD shows: watch, 1, 2, 3, A, B or C")
    s.add_argument("what")
    s.set_defaults(fn=cmd_display)

    s = sp.add_parser("clock", help="set the RCX clock (default: now)")
    s.add_argument("time", nargs="?", help="HH:MM")
    s.set_defaults(fn=cmd_clock)

    sp.add_parser("off", help="power the RCX off").set_defaults(fn=cmd_off)
    s = sp.add_parser("sleep", help="auto power-off delay in minutes (0 = never)")
    s.add_argument("minutes", type=int)
    s.set_defaults(fn=cmd_sleep)

    s = sp.add_parser("datalog", help="upload the datalog, or --size N to reset it")
    s.add_argument("--size", type=int)
    s.set_defaults(fn=cmd_datalog)

    sp.add_parser("memmap", help="program slot usage and free memory").set_defaults(fn=cmd_memmap)

    s = sp.add_parser("raw", help="send raw opcode bytes, e.g. 'raw 51 01'")
    s.add_argument("bytes", nargs="+")
    s.add_argument("--expect", type=int, help="reply payload length if not standard")
    s.set_defaults(fn=cmd_raw)

    s = sp.add_parser("demo", help="beep, cycle the display, optionally spin motor A")
    s.add_argument("--motor", action="store_true")
    s.set_defaults(fn=cmd_demo)
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(message)s")
    try:
        return args.fn(args) or 0
    except NoReply as e:
        print(f"error: {e}. Is the RCX on, in range of the tower, and shaded from bright light?",
              file=sys.stderr)
        return 2
    except (RcxError, TransportError, NqcError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
