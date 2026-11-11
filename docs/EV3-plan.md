# Plan: adding the LEGO Mindstorms EV3 to OpenMindstorms

Status: proposal, 2026-11-10. Nothing is built yet. No EV3 was connected to the PC when
this was written, so the hardware facts below come from LEGO's developer kits and from
community projects, not from a brick on the bench.

## What the EV3 is, compared with the NXT

| | NXT (2006) | EV3 (2013) |
| --- | --- | --- |
| CPU / OS | ARM7, bare-metal firmware | ARM9 at 300 MHz, 64 MB RAM, 16 MB flash, **Linux** underneath the LEGO VM |
| Link to the PC | USB (vendor class, needs WinUSB) and Bluetooth | **USB as a HID device** (ID 0694:0005, so Windows needs no driver and the browser's WebHID can open it), Bluetooth serial, Wi-Fi with a dongle |
| Outputs | 3 motor ports | 4 motor ports A-D, large and medium motors with encoders |
| Inputs | 4 analog/I2C ports | 4 ports with auto-detected UART sensors: colour, gyro, ultrasonic, infrared with beacon; touch is analog |
| Display | 100 x 64 LCD | 178 x 128 LCD, 6 buttons, red/green/orange LEDs, loudspeaker |
| Storage | small flash file system | Linux file system, microSD slot, plus "projects" folders for .rbf programs |
| Official software | NXT-G | EV3-G / EV3 Classroom (LabVIEW), **end of support 31 July 2026** |
| Text languages | NXC on stock firmware | none for stock firmware except LEGO's own bytecode assembler; Python via **Pybricks** (new native firmware, 2025-26) or ev3dev (SD card) |

The decisive differences: the link is easy (HID, no Zadig), the control side is very
similar to the NXT (direct and system commands over the same message framing), but there
is **no C-like compiler for stock firmware**. Programs for the stock firmware are
lms2012 VM bytecode (.rbf), and the only text language is LEGO's assembler.

## Protocol, in short

Every message is `[u16 length][u16 message counter][type]...`. Direct commands (type
0x00 with reply, 0x80 without) carry a 2-byte header for global/local variable sizes
followed by **VM bytecodes**: a direct command is literally a tiny program that the VM
runs in one thread, so "turn motor A at 50 %" is the opcodes `opOUTPUT_POWER`,
`opOUTPUT_START`, and "read sensor 1" is `opINPUT_DEVICE READY_SI` with the result
written to a global the reply sends back. System commands (0x01/0x81) handle files:
begin/continue download and upload, list files, create directory, delete, and also
`WRITEMAILBOX` and firmware update. Replies are 0x02/0x04 (direct ok/error) and
0x03/0x05 (system). USB packets are up to 1024 bytes; Bluetooth is the same stream over
the serial profile.

Sources to add to `docs/`: LEGO *EV3 Communication Developer Kit* and *EV3 Firmware
Developer Kit* (bytecode reference); the lms2012 firmware source (open, GPL) and
ev3dev's `lmsasm` assembler with its machine-readable opcode table.

## Two programming routes, both planned

### Route A: stock LEGO firmware, our blocks compiled to EV3 bytecode

Blocks modelled on EV3-G, generating lms2012 bytecode directly in the browser (no
server compiler needed this time). Two ways to run:

- **Run now**: send the program as a direct command. Instant, no upload, but limited
  to one VM thread and no subroutines; loops, waits, sensor reads and motor control are
  all fine. Good for everything a beginner builds.
- **Upload**: wrap the same bytecode in an .rbf file (image header, object headers)
  and write it to the brick's `prjs` folder with the system download commands, so it
  appears in the brick's own file browser and runs standalone. Parallel sequence beams
  become VM threads here.

This needs a small assembler for a subset of the VM: motors (power, speed, step with
degrees, stop/brake, sync steering), input reads in SI units, waits and timers, sound
(tone, file), display (text at a line, clear), LEDs, buttons, comparisons, jumps for
loops and ifs, variables. The opcode encodings are tabulated in the Firmware Developer
Kit, so this is careful work rather than research.

### Route B: Pybricks for Python (link out, do not rebuild)

Pybricks 4.0 (beta since November 2025, still beta in May 2026) runs natively on the
EV3: you boot the brick into update mode, open the Pybricks Code web app over USB, and
install; the LEGO firmware can be restored the same way. Pybricks Code is already an
open-source browser IDE with a MicroPython editor, so OpenEV3 should **link to it**
and document the install/restore steps rather than duplicate it. Note that a brick
running Pybricks does not speak the LEGO protocol, so the OpenEV3 control panel and
blocks apply to bricks on stock firmware; the two routes are "either/or" per brick,
switchable in minutes.

## What it would take

| Phase | Work | Needs | Calendar |
| --- | --- | --- | --- |
| 0 | Spike: open the brick with WebHID in Chrome and with Python `hidapi`; read firmware version and battery; play a tone | an EV3 on USB | an hour |
| 1 | `openev3` Python package and `ev3` CLI: info, battery, motors (power/speed/degrees/sync), sensors in SI units with auto type, sound, display text, LEDs, buttons, files (list, upload, download, delete), run/stop program, simulator, tests | | 1 day |
| 2 | OpenEV3 Workbench: Connect (WebHID USB, Bluetooth via Web Serial, simulator), Control, Files, Console; same look as the other two apps | | 1 day |
| 3 | Bytecode assembler in JavaScript, EV3-G style blocks and generator, "Run now" over direct commands, .rbf writer and upload | | 2 to 3 days |
| 4 | Pybricks route: home page card and Connect page link to Pybricks Code, flash/restore guide, ev3dev mention | | hours |
| 5 | Optional: Wi-Fi link through a small relay on the NAS, firmware update/restore from OpenEV3, EV3-G `.ev3` project import (LabVIEW XML, feasible only for a subset) | | later |

Phases 1 and 2 again give a complete "drive and test the brick" tool before any
programming exists. Everything is verified on the real brick at the end of each phase.

## Decisions for Brandon

1. **Do you have an EV3?** Home set 31313 (infrared sensor and beacon, no gyro) or
   Education 45544 (gyro, ultrasonic, rechargeable battery)? It was not connected when
   this was written.
2. **Route A on stock firmware** (our blocks to bytecode) **plus Route B as a link to
   Pybricks** for Python, as described? Or Pybricks only, with OpenEV3 reduced to the
   control panel?
3. **Blocks scope**: match the EV3-G palette (large: Move Steering, Move Tank, Large
   and Medium Motor, Display with graphics, Sound, Brick Status Light, Wait/Loop/Switch
   with sensor modes, Data Operations, Advanced) or a focused set first?
4. **Bluetooth from the start** again, or USB first? (USB needs no driver this time.)
5. **Wi-Fi**: skip? The brick needs a specific USB dongle, and browsers cannot open raw
   TCP sockets, so it would need a relay on the NAS.

## Open facts to confirm on the brick

- Firmware version (Settings > Brick Info); V1.09H/V1.10E are the last LEGO releases.
- Battery type (AA or the 2050 rechargeable pack) and whether it holds charge.
- Which motors and sensors are in the set.
- Whether Windows shows it as a HID device when plugged in (it should, with no driver
  work).
