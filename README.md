# OpenMindstorms

Free, browser-based tools for every LEGO Mindstorms brick: the **RCX** (1998), the
**NXT** (2006) and the **EV3** (2013). No Windows XP virtual machine, no 32-bit
drivers, nothing to install: Chrome or Edge talks to the brick directly.

One site, one app per brick: **OpenRCX**, **OpenNXT** and **OpenEV3**, launched from
the home page at www.openmindstorms.com (or self-hosted, see below). The RCX part
is where this project started, so the RCX sections below are the longest.

| Piece | What it is |
| --- | --- |
| [`web/`](web/) | The site. `web/index.html` is the OpenMindstorms home page; [`web/rcx/`](web/rcx/) is the **OpenRCX Workbench** (blocks or NQC text, in-browser compiler, firmware, datalog); [`web/nxt/`](web/nxt/) is the **OpenNXT Workbench** (USB or Bluetooth from the browser, NXC with a server-side compiler, motors, sensors, files); [`web/ev3/`](web/ev3/) is the **OpenEV3 Workbench** (USB HID or Bluetooth from the browser, EV3-G style blocks compiled to EV3 bytecode in the browser, motors, sensors, files). All three run in Chrome or Edge straight from the files, no install |
| [`tower/`](tower/) | Firmware that turns a **Teensy 4.x or ESP32** plus an IR LED and a 38 kHz receiver into an RCX infrared tower that appears as a normal USB serial port |
| [`python/`](python/) | `openrcx` / `rcx`, `opennxt` / `nxt` and `openev3` / `ev3`: libraries and command-line tools for scripting all three bricks |
| [`truenas/`](truenas/) | The TrueNAS app: nginx for the site plus the `nxc` compile container |

**Fastest start:** open [web/rcx/index.html](web/rcx/index.html) in Edge or Chrome, pick your
tower, press Connect. Choose *Simulator* to try it with no hardware at all.

Because the DIY tower looks exactly like a LEGO *serial* tower on a COM port, the
classic tools keep working too: **BricxCC** and **NQC** on Windows 11, WebPBrick in a
Chromium browser, firmdl3 on Linux.

## Why this exists

Every Mindstorms generation has lost its official software: the RCX tools need a
32-bit Windows, the NXT-G and EV3 apps are discontinued or end-of-life. The bricks
themselves still work, and every one of them speaks a documented protocol.

### The RCX in particular

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

## Hosting the site on TrueNAS

The site is static files, so it can live on the NAS and be opened from any PC on the
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

The app has three containers: `openrcx` (nginx, the site), `nxc` (the NXC compiler
behind `/api/nxc`, used by OpenNXT) and `stats` (usage counters behind `/api/stats`).
When the YAML changes, update it in TrueNAS under Apps > openrcx > Edit before
Stop/Start. The app, share and dataset keep the name `openrcx` from the first
deployment; renaming them would mean reinstalling the app, so they stay.

### Usage counters and the dashboard

The site keeps anonymous usage counts so you can see what people actually do:
page views and visitors, connections by brick and link type (with failures),
compiles, programs sent to a brick, runs, firmware installs, file operations,
editor-mode switches, examples opened, Control-panel use and time on site.
`web/shared/stats.js` posts tiny events to `/api/stats/event`; the `stats`
container (`truenas/stats-service/`, Python standard library + SQLite on the
`stats` dataset) stores them. Nothing identifying is kept: no IP addresses, no
cookies, no program contents; visitors are a random id in the browser's
localStorage; Do Not Track and Global Privacy Control switch it off, as does
opening any page once with `?stats=off`. Pages opened from a local file never
send anything.

The dashboard is at `/stats/` on the site and asks for the key set as
`STATS_KEY` in `truenas/openrcx-app.yaml` (pick a long random string before
installing; the key is sent in a header and kept only in your browser). It shows
range totals against all-time totals, a per-day chart, per-app and per-link
breakdowns, browsers and operating systems, failures, and the newest events, and
can download the raw events as CSV.

### Public site: www.openmindstorms.com through the Cloudflare tunnel

The same Cloudflare tunnel that publishes Empires of Rome can publish this site; the
tunnel runs on the NAS and can reach the app's bridge address.

1. Register `openmindstorms.com` and add it to the Cloudflare account (nameservers to
   Cloudflare).
2. Zero Trust > Networks > Tunnels > the existing tunnel > Public Hostname > Add:
   `www.openmindstorms.com`, service **HTTP**, URL `192.168.68.208:80`. Add a second one
   for the bare `openmindstorms.com` or a redirect rule to `www`.
3. Done: Cloudflare terminates HTTPS with a real certificate, so Web Serial and WebUSB
   work for every visitor with no certificate warning. The compile service is reached
   through the same hostname at `/api/nxc`.

nginx already answers any hostname, and the Workbench pages use relative URLs, so
nothing in the container changes. If you later put the public site on its own bridge
alias or port, only the tunnel's public hostname entry moves.

## OpenEV3

The EV3 needs no driver: it is a USB HID device, so Chrome and Edge reach it through
WebHID and Python through `hidapi`. Bluetooth works the same way as the NXT (pair the
brick in Windows, pick its *outgoing* COM port). The Workbench keeps the stock LEGO
firmware. Its block editor follows the EV3-G palette (Move Steering, Move Tank, motors,
display, sound, status light, wait/loop/switch, every EV3 and NXT sensor, data
operations, variables, parallel beams, My Blocks) and compiles the program to lms2012
bytecode in the browser. **Run now** sends it as a direct command; **Upload** wraps it
in an `.rbf` file in the brick's `prjs` folder so it shows up in the brick's own menu.
For Python, the Workbench links out to [Pybricks](https://pybricks.com/), which runs
natively on the EV3 and is reversible.

```
ev3 ports                 # USB bricks and Bluetooth COM ports
ev3 info                  # name, firmware, battery
ev3 say "Hello" --line 1  # write to the display
ev3 drive BC 50 --degrees 360
ev3 files OpenEV3         # list ../prjs/OpenEV3
ev3 run OpenEV3/Program   # start an .rbf from the brick
```

## Repository layout

```
tower/OpenRCX_Tower/   Arduino sketch for the Teensy/ESP32 tower
python/openrcx/        library: protocol, transports, link, rcx API, firmware/image parsers, simulator, CLI
python/opennxt/        NXT: protocol, USB/Bluetooth transports, brick API, simulator, CLI
python/openev3/        EV3: protocol + bytecode encoders, HID/Bluetooth transports, brick API, VM simulator, CLI
web/rcx/ web/nxt/ web/ev3/  the three Workbenches (web/ev3/js/blocks.js is the EV3-G block compiler)
python/tests/          unit tests (python -m unittest discover -s python/tests)
python/examples/       NQC samples
firmware/              official LEGO firmware images firm0328.lgo (RIS 2.0) and firm0309.lgo (RIS 1.0/1.5)
tools/nqc/             NQC 3.1 r6 Win32 compiler (MPL 2.0)
docs/                  protocol notes and LEGO reference PDFs
```

## Licence

MIT, see [LICENSE](LICENSE). Vendored components (Blockly, WebNQC, NQC) and the
LEGO firmware images and documents keep their own terms, listed in
[THIRD_PARTY.md](THIRD_PARTY.md).

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
* **NXT**: verified on a real NXT over USB and Bluetooth (2026-11-10): info, files,
  motors, sensors, NXC compile on the server and run on the brick.
* **EV3**: verified on a real EV3 (firmware V1.09H) over USB, 2026-11-11: Python
  library (info, battery, display, LED, tone, buttons, files) and the Workbench with
  two motors attached: block program uploaded as an .rbf, found under its name in the
  brick's menu and run from there, and "Run now" as a direct command.
