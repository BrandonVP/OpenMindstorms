# Plan: adding the LEGO Mindstorms NXT to OpenMindstorms (then called OpenRCX)

Status: proposal, 2026-11-10. Nothing in this document is built yet.

## What the NXT is, compared with the RCX

| | RCX (1998) | NXT (2006) |
| --- | --- | --- |
| CPU / memory | Hitachi H8, 32 KB RAM, firmware lost when batteries are out | ARM7 at 48 MHz, 256 KB flash, 64 KB RAM, firmware stays in flash |
| Link to the PC | Infrared tower, 2400 baud | **USB built in** (full speed, ID 0694:0002) and **Bluetooth** (classic, serial profile) |
| Outputs | 3 motors, on/off/power | 3 motors **with rotation encoders** (degrees), synchronised steering, regulation |
| Inputs | 3 analog ports | 4 ports: touch, light, sound, **ultrasonic and colour over I2C** |
| Display | 5-digit LCD | 100 x 64 pixel LCD: text, numbers, graphics |
| Sound | tones | tones and .rso sound files |
| Storage | 5 program slots | a file system: programs (.rxe), sounds (.rso), pictures (.ric), data logs |
| Official software | RCX Code (RIS) | NXT-G (LabVIEW-based blocks) |
| Text language | NQC | **NXC** ("Not eXactly C", same author as NQC) compiled by **NBC** |

The important consequences: no tower to build, no firmware to reload, far more to
control, and a compiler that does not run in the browser.

## What it would take

### 0. Driver and protocol spike (an hour, needs you at the PC)

The NXT is connected right now with no driver (Device Manager problem code 28). Two
drivers exist and only one can be bound at a time:

- **WinUSB via Zadig**, exactly like the USB tower: Options > List All Devices >
  *LEGO MINDSTORMS NXT* (0694 0002) > WinUSB > Install. This is what OpenRCX, the
  Workbench (WebUSB) and nxt-python use. **Recommended.**
- **LEGO Fantom driver** (the official one; a 64-bit build exists and still installs
  on Windows 11). Needed only by NXT-G and BricxCC's NXT mode. Switching back is
  Device Manager > Uninstall device > replug.

Bluetooth needs no driver: pair the brick in Windows (PIN 1234) and Windows creates
two COM ports; the Workbench can use the outgoing one through Web Serial, the CLI
through pyserial. Good fallback for a PC where the USB driver cannot be changed.

Spike: after Zadig, `GetDeviceInfo`, `GetFirmwareVersion` and `PlayTone` over raw
pyusb. Proves the link in about 30 lines before anything else is built.

### 1. Python package `opennxt` (about a day)

Mirrors `openrcx` so the tools feel the same.

- **Protocol**: LEGO documents it fully (*NXT Communication Protocol* and *Direct
  Commands* PDFs from the Bluetooth Developer Kit, to be added to `docs/`). Every
  message is `[type, command, payload]`; type 0x00/0x80 direct command with/without
  reply, 0x01/0x81 system command; replies start 0x02 and carry a status byte. USB is
  bulk endpoints 0x01 out / 0x82 in with 64-byte packets; Bluetooth adds a 2-byte
  little-endian length in front of each message.
- **Direct commands** (20): start/stop program, play tone, play sound file, set output
  state (power, mode, regulation, turn ratio, run state, tacho limit), get output state
  (tacho count, block count, rotation count), set input mode, get input values (raw,
  normalised, scaled, calibrated), reset scaled value, reset motor position, battery
  level, keep alive, LS write/read/status (I2C for ultrasonic), message read/write
  (10 mailboxes), get current program name.
- **System commands**: open read/write/append, read, write, close, delete, find
  first/next, get firmware version, get device info (name, Bluetooth address, free
  flash), set brick name, delete user flash, boot (into firmware-flash mode).
- **Program upload**: OpenWrite(name, size) then Write in chunks (USB packets hold 64
  bytes, so about 58 data bytes per Write) then Close, then StartProgram. Same shape
  as the RCX download, so the progress and retry code carries over.
- **Transports**: `UsbTransport` (pyusb/WinUSB), `BluetoothTransport` (pyserial COM
  port), `SimTransport`. Option: use the maintained **nxt-python 3.x** as the backend
  instead of our own protocol code. My recommendation is our own (it is small, and it
  keeps the browser and Python ports line-for-line identical like the RCX code); use
  nxt-python as the reference for the tricky bits (I2C sensors, file system).
- **CLI** `nxt`: info, battery, tone, motor (run for N degrees / seconds, power,
  brake), sensor (type, live readout, ultrasonic in cm), files (list, upload, delete,
  free space), run / stop, name, messages, raw.
- **Simulator** plus tests, as for the RCX.

### 2. Workbench: NXT support (about a day)

- A **brick selector** (RCX / NXT) at the top of the Connect page; the tabs adapt.
- Transports in the browser: **WebUSB** (needs the WinUSB driver) and **Web Serial**
  for the Bluetooth COM port. Both already have working patterns in the RCX code.
- **Control** tab for the NXT: motors with power, run-for-degrees, synchronised pair
  (steering), live tacho; four sensor cards with type dropdown (touch, light active /
  passive, sound dB / dBA, ultrasonic cm, colour) and live values; tones and sound
  files; brick name, battery, firmware, free flash.
- **Files** tab (replaces Firmware/Datalog for the NXT): list what is on the brick,
  upload / delete programs, sounds and pictures, download data-log files.
- **Console**: raw command sender and packet log, as now.

### 3. Programming: NXC text and blocks (one to two days)

- **NXC text editor** with an API reference like the NQC one. NXC is much bigger
  (several hundred functions); the panel would carry a curated set of about 120 with
  the full guide PDF linked.
- **Compiler**: NBC is a native program (Free Pascal), so unlike NQC it cannot be
  compiled to WebAssembly for in-browser use. Two routes, both planned:
  1. A tiny **compile service inside the TrueNAS container**: Debian packages NBC
     (`apt install nbc`), and a 60-line HTTP endpoint turns `POST /api/nxc` source into
     an .rxe or a list of errors. The hosted Workbench on openrcx.vp compiles there.
     The Python CLI can use the same endpoint.
  2. **Local `nbc.exe`** (ships with BricxCC, MPL-licensed) for the CLI and for the
     file:// Workbench, which then loads the produced .rxe. Note that Smart App Control
     on this PC may block unsigned nbc.exe, which is another reason for route 1.
- **Blocks**: an NXT block set for the existing Blockly editor generating NXC: motors
  by degrees/rotations/seconds, steering, sensor values and watchers including
  ultrasonic and colour, display text/number at a line, sounds, loops, waits,
  variables, my commands. The RCX generator structure is reused; only the vocabulary
  changes.

### 4. Later, if wanted

- **Firmware flashing** (SAM-BA protocol over USB, different USB ID while flashing):
  install the enhanced NBC firmware or leJOS, or restore LEGO 1.31. Same job as
  libnxt's `fwflash`.
- **Data logging** helpers (NXC `CreateFile`/`WriteLn` to a file, download via the
  Files tab, CSV export).
- **NXT-G programs** cannot be imported: .rbt files are LabVIEW documents without a
  public format. Blocks + NXC replace NXT-G rather than read its files.

## Effort and order

| Phase | Work | Calendar |
| --- | --- | --- |
| 0 | Zadig, spike | an hour, needs your hands on Zadig |
| 1 | Python package, CLI, simulator, tests | 1 day |
| 2 | Workbench NXT connect, control, files | 1 day |
| 3 | NXC editor + compile service + blocks | 1 to 2 days |
| 4 | Firmware flashing and extras | optional |

Phases 1 and 2 give a fully usable "drive and test the brick" tool; phase 3 gives
programming. Each phase ends verified on the real brick, as with the RCX.

## Decisions for Brandon

1. **Driver**: bind the NXT to WinUSB with Zadig (my recommendation)? NXT-G and
   BricxCC would then not see the brick until the driver is switched back.
2. **Repository**: keep the NXT inside this repo as `python/opennxt`, `gui` brick
   selector and `docs/nxt-*` (recommended: one Workbench for both bricks), or a
   separate repo?
3. **Bluetooth**: worth supporting from the start, or USB only first?
4. **Compile service**: fine to add a small Python compile server to the TrueNAS
   container (it currently serves static files only)?
5. **Scope of phase 3 blocks**: a focused NXT set like the RCX one (about 40 blocks),
   or try to match NXT-G's full palette?

## Open facts to confirm on the brick

- Firmware version shown under *Settings > NXT Version* (NXC needs 1.28 or newer;
  LEGO's last is 1.31).
- Battery type (AA or the rechargeable pack) and whether it holds charge.
- Which sensors and motors came with the set (NXT 1.0 has light/sound/touch/ultrasonic;
  NXT 2.0 has the colour sensor instead of light).
