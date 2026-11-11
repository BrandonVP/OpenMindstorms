# OpenRCX

Program and control the original yellow LEGO Mindstorms **RCX** from a modern 64-bit
PC, no Windows XP virtual machine required.

Three pieces:

| Piece | What it is |
| --- | --- |
| [`web/`](web/) | **OpenRCX Workbench**: a point-and-click front end that runs in Chrome or Edge straight from `web/rcx/index.html`. Program with snap-together **blocks** (RCX Code style) or NQC text, compile in the browser, download, run, drive motors, watch sensors, load firmware, read the datalog. No install, no Python |
| [`tower/`](tower/) | Firmware that turns a **Teensy 4.x or ESP32** plus an IR LED and a 38 kHz receiver into an RCX infrared tower that appears as a normal USB serial port |
| [`python/`](python/) | `openrcx` library and the `rcx` command for scripting and automation: firmware install, program download, motors, sensors, sounds, datalog, raw opcodes. Compiles NQC sources with the bundled `nqc.exe` |

**Fastest start:** open [web/rcx/index.html](web/rcx/index.html) in Edge or Chrome, pick your
tower, press Connect. Choose *Simulator* to try it with no hardware at all.

Because the DIY tower looks exactly like a LEGO *serial* tower on a COM port, the
classic tools keep working too: **BricxCC** and **NQC** on Windows 11, WebPBrick in a
Chromium browser, firmdl3 on Linux.

## Why this exists

The RCX only ever shipped with two towers. The serial tower needs an RS-232 port and
works fine through any USB-serial adapter. The USB tower (the one in Robotics Invention
System 2.0) needs a kernel driver LEGO built for 32-bit Windows only, so on today's
machines it is dead weight unless you run a 32-bit XP VM. The IR link itself is trivial
(2400 baud, odd parity, 38 kHz carrier), so the fix is to build the tower.

## Three ways to reach the brick

| `--tower` | Hardware | Notes |
| --- | --- | --- |
| `serial` | Original LEGO **serial** tower (9713) on a COM port or USB-serial adapter | No driver work at all; the tower only needs its 9 V battery. The PC side sets RTS/DTR and expects the tower's echo |
| `diy` | **OpenRCX tower**: Teensy 4.x / ESP32 + IR LED + 38 kHz receiver, see [tower/](tower/) | Appears as a USB COM port; BricxCC/NQC treat it as a serial tower |
| `usb` | Original LEGO **USB** tower (RIS 2.0) | Driven through WinUSB/libusb, LEGO's 32-bit-only driver is not used. Written from the spec, not yet tested |

`rcx ports --probe` lists COM ports and toggles RTS on each one to spot a LEGO serial
tower (it loops RTS back to CTS). Save your choice once with
`rcx config --tower serial --port COM8`; `-t`/`-p` on the command line and the
`RCX_TOWER`/`RCX_PORT` environment variables override it. With no setting, `auto`
picks `diy` for a Teensy/Espressif port and `serial` for a USB-serial adapter.

## Quick start

1. **Pick a tower** from the table above. For the DIY tower, parts list, schematic
   and flashing steps are in [tower/README.md](tower/README.md).
2. **Install the PC tool** (Python 3.9+):

   ```
   pip install -e python
   rcx ports --probe                       # find the tower's COM port
   rcx config --tower serial --port COM8   # remember it
   ```

   If `rcx` is not found, pip put it in a Scripts folder that is not on your PATH
   (`%APPDATA%\Python\Python314\Scripts` for a `--user` install); `python -m openrcx`
   is the same thing.

3. **Fresh RCX?** Load the firmware (takes about four minutes at 2400 baud):

   ```
   rcx info                   # "firmware none" on a blank brick
   rcx firmware               # installs the bundled firm0328.lgo (RIS 2.0 firmware)
   ```

4. **Write a program** in NQC and run it:

   ```
   rcx run python/examples/hello.nqc        # compile + download to slot 1 + start
   rcx download robot.nqc -n 3              # into slot 3, don't start
   rcx start                                # press "Run" remotely
   rcx stop --motors
   ```

5. **Poke at the brick directly**:

   ```
   rcx demo --motor                 # beep, cycle the display, spin motor A
   rcx motor AC fwd on --power 7 -t 2
   rcx sensor 1 touch               # configure port 1
   rcx sensor --watch               # live readout of all three ports
   rcx tone 880 300
   rcx var 5 123
   rcx datalog
   rcx raw 51 03                    # any opcode: PlaySound 3
   rcx -v ping                      # dump packets both ways
   ```

Every command also works against a built-in simulated RCX: add `--sim` (or
`--sim --sim-blank` for a brick without firmware) to try the tool with no hardware.

### Drivers

#### Serial tower on a Prolific PL2303 USB-serial cable (Windows 11)

Most USB-to-RS-232 cables use a Prolific PL2303 chip. Windows Update installs
Prolific's driver 3.9.x, which deliberately refuses the older PL2303HXA/XA/TA chips:
Device Manager shows the port as *"PL2303TA DO NOT SUPPORT WINDOWS 11 OR LATER"* and
opening it fails with "a device which does not exist was specified". The chip is fine;
it just needs the older driver, which is kept here:

**https://github.com/BrandonVP/Prolific**

1. Download the repo (Code > Download ZIP) and extract it.
2. Plug in the cable. Open *Device Manager*, right-click the Prolific port under
   *Ports (COM & LPT)* and choose *Update driver* > *Browse my computer for drivers*.
3. **Newer cables (usually black, PL2303TA/HXD):** extract `PL2303_Prolific_v3.8.38.2.cab`
   into a folder (right-click > Extract, or `expand file.cab -F:* folder`), then
   *Let me pick from a list* > *Have Disk...* > point at that folder > pick the
   *Prolific USB-to-Serial Comm Port* entry.
   **Older cables (usually grey, PL2303HXA/XA):** run `PL2303_Prolific_v3.3.2.105.exe`,
   then *Let me pick from a list* and choose the **2008** driver version.
4. Unplug and replug the cable. The port should now be named *Prolific USB-to-Serial
   Comm Port (COMx)* and `rcx ports --probe` should report the LEGO serial tower on it.
5. Stop Windows Update from putting 3.9.x back: *Settings > System > About > Advanced
   system settings > Hardware tab > Device Installation Settings > No*, or hide that
   update with Microsoft's *wushowhide* tool.

FTDI and CP2102 adapters need none of this.

#### Original LEGO USB tower (Windows)

LEGO's own driver is 32-bit only. OpenRCX and the Workbench talk to the tower directly
through the generic **WinUSB** driver, installed with **Zadig**:

1. Download Zadig from https://zadig.akeo.ie/ (a single exe, no install) and plug in
   the tower.
2. In Zadig: *Options > List All Devices*, pick **LEGO USB Tower** (USB ID 0694 0001)
   in the dropdown, make sure the target driver on the right says **WinUSB**, and click
   *Replace Driver* (or *Install Driver*). Windows asks once to trust the installer.
3. Done: `rcx -t usb ping` from the command line, or choose *LEGO USB tower* in the
   Workbench (it uses WebUSB, which also requires WinUSB on Windows).

To go back to LEGO's driver later: Device Manager > the tower under *Universal Serial
Bus devices* > Uninstall device > tick *delete the driver software*, then replug.
On Linux no driver change is needed (the kernel's legousbtower module exists), but
unbind it or run as root for libusb access.

## Using the Python library

```python
from openrcx import RCX, load_firmware, load_rcx, bundled_firmware_path

with RCX.open("COM7", tower="serial") as rcx:        # or tower="diy" / "usb"
    print(rcx.versions())              # ROM 3.01 (00030001), firmware 3.28 (00030328)
    print(rcx.battery_mv())            # 8732
    if not rcx.versions().has_firmware:
        rcx.download_firmware(load_firmware(bundled_firmware_path("0328")),
                              progress=lambda done, total: print(done, total))
    rcx.download_program(load_rcx("robot.rcx"), program=0)
    rcx.start_task(0)
    rcx.configure_sensor(0, "light")
    print(rcx.sensor_value(0))
    rcx.motor_power("A", 5); rcx.motor_direction("A", "fwd"); rcx.motor_on("A")
```

`RCX.open()` with no arguments uses the saved config / environment, then auto-detects.
`RCX.open(tower="usb")` targets an **original LEGO USB tower** through libusb (see below).

## Using BricxCC / NQC with the DIY tower

Install BricxCC 3.3 (the installer is on the NAS under `Lego/`), pick **RCX2** as the
brick, **Serial** as the tower, and the tower's COM port. Everything in BricxCC's
*Tools* menu (Direct Control, Diagnostics, Watching the Brick, firmware download) works
through the DIY tower because it is indistinguishable from the LEGO serial tower.

From the command line, `tools/nqc/nqc.exe -SCOM7 -d -Trcx2 robot.nqc` downloads
directly as well; `rcx build` wraps the same compiler.

## The original USB tower (optional, untested)

`openrcx.transport.UsbTowerTransport` drives the LEGO USB tower (VID 0694, PID 0001)
through pyusb using the vendor requests from LEGO's *USB Tower Interface Reference*
(in `docs/`). On Windows that means binding the tower to the generic **WinUSB** driver
with [Zadig](https://zadig.akeo.ie/) instead of LEGO's driver, then
`pip install pyusb` and `rcx -t usb ping`. This path is written from the spec and has
**not** been exercised on hardware yet; the DIY tower is the supported route.
(The 64-bit `tower164.zip` driver on the NAS is only for ROBOLAB/LabVIEW and does not
help other software.)

## Hosting the Workbench on TrueNAS

The GUI is static files, so it can live on the NAS and be opened from any PC on the
network; the browser on *that* PC still talks to the tower, the NAS only serves the
page. Because Chrome and Edge hand out serial ports only to pages served over HTTPS,
the container runs nginx with a self-signed certificate it generates on first start.

```
powershell -ExecutionPolicy Bypass -File .\deploy-to-nas.ps1     # copies HEAD to \\TRUENAS\openrcx\src
```

Then in TrueNAS SCALE: *Apps > Discover Apps > ⋮ > Install via YAML*, name `openrcx`,
paste [truenas/openrcx-app.yaml](truenas/openrcx-app.yaml). The app builds the image
from `/mnt/apps/configs/openrcx/src` ([Dockerfile](Dockerfile)) and listens on
**https://openrcx.vp** / **https://192.168.68.208** (the names and IP in the YAML's
`SERVER_NAMES` / `SERVER_IP` go into the certificate). After a redeploy, Stop and Start
the app to rebuild.

The certificate is self-signed, so the first visit warns. To make the warning go away
for good on a PC, run once (as Administrator for the whole machine, or as yourself for
your account only):

```
powershell -ExecutionPolicy Bypass -File .\truenas\trust-cert.ps1
```

It imports `\\TRUENAS\openrcx\certs\server.crt` into the Windows trusted-root store,
which Edge and Chrome use. The same file is also downloadable from
`https://openrcx.vp/cert` for other machines.

If you would rather skip certificates, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
add `http://openrcx.vp`, and use plain HTTP; the page is served on both ports.

## Repository layout

```
tower/OpenRCX_Tower/   Arduino sketch for the Teensy/ESP32 tower
python/openrcx/        library: protocol, transports, link, rcx API, firmware/image parsers, simulator, CLI
python/tests/          unit tests (python -m unittest discover -s python/tests)
python/examples/       NQC samples
firmware/              official LEGO firmware images firm0328.lgo (RIS 2.0) and firm0309.lgo (RIS 1.0/1.5)
tools/nqc/             NQC 3.1 r6 Win32 compiler (MPL 2.0)
docs/                  protocol notes and LEGO reference PDFs
```

## Protocol references

The implementation follows Kekoa Proudfoot's RCX Internals and opcode reference, the
LEGO RCX 2.0 *Firmware Byte Codes Reference* and the NQC `rcxlib` sources
(chunk sizes, download sequences and reply matching were taken from there so the
behaviour matches the proven tools). See [docs/protocol.md](docs/protocol.md).

## Status

* **Verified on a real RCX 2.0** (ROM 3.01) through a LEGO serial tower on a Prolific
  USB-serial adapter, 2026-11-10: ping, versions, full firmware 3.28 install (no
  retries), program compile + download + run, battery, sensor setup and readout,
  motor direction/power/status, sounds, memory map.
* Python library and CLI: 31 unit tests against the simulator; the simulator now
  mirrors behaviour measured on the brick (bare-ROM replies, motor status bits,
  firmware version word).
* Browser GUI: protocol core shares those tests (`node web/rcx/tests/run.js`); compile,
  download and firmware install verified in headless Edge against the simulator.
  Web Serial path to the real tower not yet exercised from the GUI.
* Tower firmware: compiles for Teensy 4.0 and ESP32-S3, not yet tried on hardware.
* USB tower transport: written from the spec, untested.
