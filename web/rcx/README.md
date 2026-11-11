# OpenRCX Workbench (GUI)

A desktop-style front end for the RCX that runs entirely inside Chrome or Edge. Nothing
to install: double-click `index.html`.

| Section | What it does |
| --- | --- |
| **Connect** | Choose the tower (DIY Teensy/ESP32, LEGO serial tower, LEGO USB tower, or the built-in simulator), connect, see ROM/firmware/battery/free memory, ping, beep, self test |
| **Program** | Two editors. **Blocks**: snap-together puzzle pieces in the spirit of the original RCX Code software (program start, sensor watchers, motors, waits, loops, sounds, variables, "my commands"); the generated NQC is shown underneath and can be sent to the text editor. **NQC text**: editor with examples and a searchable API reference beside it (click an entry to insert it; "Full guide" opens Dave Baum's Programmer's Guide from `docs/`). Both compile in the browser (WebNQC), download to slot 1-5, Run / Stop, and open/save their files |
| **Control** | Motors A/B/C (direction, on/off/float, power), sensor setup with a live LCD-style readout, sounds and tones, program slot, LCD display source, clock, IR range, variables, IR messages, auto power-off, power off |
| **Firmware** | Install the bundled firm0328 / firm0309 or any `.lgo`, with progress and ETA; delete firmware |
| **Datalog** | Upload the datalog, save as CSV, create/clear |
| **Console** | Every packet on the link in hex, retry statistics, send any raw opcode |

Keys 1-6 switch sections, and `index.html#program` etc. opens a section directly.
Your source, chosen tower and slot are remembered in the browser.

## Block programming

The Blocks editor is built on [Blockly](https://developers.google.com/blockly) 11
(`vendor/blockly/`, Apache 2.0) with RCX-specific blocks defined in `js/blocks.js`.
It follows the RCX Code model rather than plain NQC:

| Block | Becomes |
| --- | --- |
| *when program starts* | `task main()`; sensors used anywhere are set up at the top automatically |
| *when touch sensor N is pressed/released*, *when light sensor N gets brighter/darker than X*, *when message N is received*, *every N seconds* | one NQC task per watcher, started from main, looping on `until(...)` so it fires each time the condition becomes true |
| *my command NAME* / *run my command NAME* | `sub NAME()` and a call |
| motors, waits, loops, if/else, sounds, display, messages, datalog, timers, variables, math and logic | the matching NQC statements and expressions |

Loose blocks that are not under a hat are ignored, as in RCX Code. Programs are saved as
Blockly JSON (`.rcxblocks.json`) and also remembered in the browser; "Send to NQC text"
hands the generated program to the text editor for further editing.

## How it works

The browser opens the COM port itself through the **Web Serial API** (2400 baud, 8 data
bits, odd parity) and, for the original USB tower, talks **WebUSB** to the tower's
vendor requests. The protocol code in `js/` is a line-for-line port of the Python
package and is covered by the same tests (`node web/rcx/tests/run.js`).

Compilation uses **WebNQC**, NQC 3.1 r6 compiled to WebAssembly by maehw
(`vendor/webnqc/`, Mozilla Public License 2.0). A fresh compiler instance is created
for every build so a failed compile can never poison the next one. Error lines are
highlighted in the editor gutter.

The firmware images are embedded as text in `data/firmware.js` so the page needs no
web server and no network.

## Requirements and limits

* Chrome or Edge (any recent version). Firefox and Safari have no Web Serial; the page
  then offers only the simulator.
* The page must be opened from disk or a web server, not inside another page.
* Original USB tower: bind it to WinUSB with Zadig first, then pick "LEGO USB tower".
  This path is untested.
* Fonts come from Google Fonts when online; offline the page falls back to system fonts.

## Testing without a brick

Pick **Simulator** and connect. Everything works against a software RCX, and the
Connect page gains sliders that feed values to its sensor ports. `tests/browser-smoke.html`
compiles an example with WebNQC and downloads it into the simulator; open it in a
browser to see the result.
