# OpenNXT Workbench

Browser front end for the LEGO Mindstorms NXT. Open `index.html` in Chrome or Edge, or
use the hosted copy on the OpenMindstorms server.

| Section | What it does |
| --- | --- |
| **Connect** | USB (WebUSB, needs the WinUSB driver via Zadig), Bluetooth (Web Serial on the paired COM port), or the built-in simulator. Shows name, firmware, battery, free flash, running program; rename the brick; self test |
| **Program** | NXC editor with examples and a searchable API reference. Compiles on the OpenMindstorms server (NBC runs in the `nxc` container; the compiler is native code, so there is no in-browser build). Upload to the brick, Run, Stop; open/save `.nxc` and `.rxe` |
| **Control** | Motors A/B/C: forward/backward, brake/coast, power, run-for-degrees, live rotation count; Drive panel steering B+C in sync; sensors on ports 1-4 (touch, light, sound, ultrasonic, colour, temperature, rotation) with live readout; tones, sound files, mailboxes |
| **Files** | List, upload, download, delete files on the brick; run programs and play sounds from the list; erase user flash |
| **Console** | Every message in hex, raw message sender |

Keys 1-5 switch sections; `index.html#control` opens a section directly.

## How it works

The protocol code in `js/` is a port of `python/opennxt` and shares its tests
(`node web/nxt/tests/run.js`). USB uses WebUSB bulk transfers on endpoints 1/2 with
64-byte packets; Bluetooth uses Web Serial with the 2-byte length prefix the brick
expects. Programs are written with `OpenWriteLinear` (executables must be contiguous)
in 58-byte chunks.

The compile server address is editable on the Program page; a local file:// copy of
this page defaults to `https://openrcx.vp/api/nxc`.
