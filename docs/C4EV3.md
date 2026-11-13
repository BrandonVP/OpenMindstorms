# Native C for the EV3 (the c4ev3 route)

The fourth editor in OpenEV3's Program view writes real C, compiled on the OpenMindstorms
server with GCC for the EV3's ARM9 and linked against the
[c4ev3 EV3-API](https://github.com/c4ev3/EV3-API) (GPL-2). The result is a static Linux
program that runs on the stock firmware, started from the brick's menu through a tiny
launcher `.rbf`. Nothing on the brick changes; no SD card, no firmware replacement.

Use it when EVC is not enough: full C99 with the standard library, floats at native
speed, threads, big arrays, string handling, files.

## How it works

1. **Compile** posts the source to `/api/c4ev3` (the `c4ev3` container: Debian with the
   C4EV3.Toolchain GCC 8.2 / uClibc-ng build for the brick's 2.6.33 kernel, plus
   `libev3api.a`). Errors come back with line numbers and are highlighted in the editor.
2. **Upload** writes the ELF to `../prjs/<project>/<name>.elf` and a launcher
   `<name>.rbf` next to it. The launcher is one VM instruction, `opSYSTEM`, running
   `chmod +x <elf>; <elf>`; it is byte for byte what ev3duder's `mkrbf` makes.
3. **Run uploaded** starts the launcher, or pick the program in the brick menu.

## What to know

- **The brick pauses while a C program runs.** `opSYSTEM` blocks the firmware's main
  loop, so the brick menu and the USB/Bluetooth link do nothing until the program exits.
  This is how every c4ev3 program behaves. Always give the program a way to end: the
  examples poll `ButtonIsDown(BTNEXIT)` and leave. Stop from the Workbench is not
  possible for this reason; "Run now" is not offered either.
- The API's names are close to NXC: `OnFwdEx`, `RotateMotor`, `ReadEV3TouchSensor`,
  `LcdTextf`, `PlayTone`, `Wait`. Sensors are declared once with `SetAllSensors`.
- `LCD_LINE1..LCD_LINE8` are 16 pixels apart here (the EVC ones are 12 apart).
- Programs can write files under `/home/root/lms2012/prjs/` and read them back from the
  Files view.

## Setting it up on the NAS

The `c4ev3` service in `truenas/openrcx-app.yaml` builds its image from
`truenas/c4ev3-service/` and downloads the toolchain (about 60 MB) on the first build.
The web container does not depend on it: with the service absent the C editor simply
reports that the compile server is unreachable, everything else keeps working.

## Verified

The service's HTTP flow is tested locally with a stand-in compiler, and the editor with
a stubbed server in headless Edge. The real toolchain build and a C program on the brick
are still to be confirmed on the NAS and on hardware.
