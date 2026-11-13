# Plan: a free text language for the EV3 on stock firmware

Status: phases 0, 1 and 2 built 2026-11-13 (assembly editor, EVC compiler with functions,
arrays, strings, tasks, switch, data logging; every Pybricks mention removed). Decisions:
name EVC, NXC-style API names, c4ev3 kept as optional phase 3, Pybricks removed entirely.
Mailboxes and arrays with computed indices are untested on hardware. Language guide:
[EVC.md](EVC.md). Originally a proposal written the same day, prompted by Pybricks
putting block coding behind a licence.

## The question

OpenRCX has NQC and OpenNXT has NXC: text languages that compile to the stock
firmware. Does the EV3 have anything comparable?

Short answer: **no finished one exists, but everything needed to build one is already
in OpenEV3.** The stock EV3 firmware runs lms2012 VM bytecode and nothing else. Our
block editor already compiles to that bytecode in the browser (`web/ev3/js/asm.js`
and the 52-opcode table in `protocol.js`), runs it either as a direct command ("Run
now") or as an uploaded `.rbf`, and tests it on the JavaScript simulator (`vm.js`). A
text language is a second front end on the same back end.

## What exists today, and why none of it is the answer

| Option | Stock firmware? | Free? | Verdict |
| --- | --- | --- | --- |
| **Pybricks** (MicroPython) | No: replaces the firmware (restorable) | Python yes (MIT); blocks are paid | Their IDE, their firmware. Keep one line in the help, nothing more. |
| **LEGO EV3 MicroPython / ev3dev** | No: boots from a microSD card | Yes | Needs an SD card, SSH and VS Code; not a browser tool. Mention only. |
| **c4ev3** (C with GCC, [github.com/c4ev3](https://github.com/c4ev3)) | Yes: native ARM binary started by a tiny `.rbf` launcher | Yes, GPL-2 API, GPL-3 uploader | Real C, full power. Needs an ARM cross-compiler container on the NAS, no "Run now", no simulator, and the API is dormant since 2021. A possible later route, not the first. |
| **EV3Basic** (Small Basic to bytecode) | Yes | No licence file, last change 2018, Windows only | Not usable, but it proves a text-to-bytecode compiler for stock firmware works well. |
| **lmsasm** (LEGO's assembler syntax, as in ev3dev's `lmsasm`) | Yes | Yes | Too low level to teach with, but a cheap first step and a useful "show me what my blocks became" view. |
| **RobotC, leJOS** | No | No / needs SD | Out. |

NXC itself was never ported to the EV3; John Hansen's EV3 work in BricxCC stopped at
the assembler and a GCC C API, which became c4ev3.

## Proposal: an NXC-flavoured language compiled in the browser

Build a small C-like language, in JavaScript, that compiles to EV3 bytecode through
the existing assembler. Working name **EVC** (alternatives: NEC, "EV3 Script"). It
should read like NXC so that anyone who learned NQC or NXC in the other two
Workbenches can keep going, and so the NXT API panel's format can be reused:

```c
task main() {
  TextOut(0, LCD_LINE1, "Hello EV3");
  OnFwdSync(OUT_BC, 50, 0);      // both drive motors, no steering
  until (SensorValue(S1) > 40);  // touch pressed, or distance for ultrasonic
  Off(OUT_BC);
  RotateMotor(OUT_A, 75, 360);   // one turn, blocking
  PlayTone(440, 500);
  int i;
  for (i = 0; i < 5; i++) { NumOut(0, LCD_LINE3, i); Wait(200); }
}
```

### Language, first version

- Types: `int` (32-bit), `float`, `bool`; string literals only where the API takes
  text. Arrays and string variables in a later phase.
- Statements: `if`/`else`, `while`, `until`, `repeat(n)`, `for`, `break`,
  `continue`, blocks, assignment with `+= -= *= /=`, `++`/`--`.
- Expressions: arithmetic, comparison, `&& || !`, integer and float mixing with
  implicit conversion (the VM has separate 8/16/32/float opcodes and `MOVEx_y`
  conversions, which the block generator already uses).
- `task main()` plus extra `task`s that start on upload as VM threads (the block
  editor's parallel beams do this already). `sub name()` for calls without
  parameters in phase 1; parameters and return values in phase 2 (VM subcalls
  support them, but "Run now" direct commands cannot contain subcalls, so phase 1
  inlines `sub`s when running now and uses real calls when uploading).
- API, NXC names where they fit, EV3 names where the NXT had nothing:
  motors `OnFwd OnRev Off Float OnFwdSync OnRevSync RotateMotor RotateMotorEx
  MotorRotationCount ResetRotationCount`; sensors `SensorValue SensorRaw
  SetSensorMode` with auto-detected type (touch, colour, gyro, ultrasonic, infrared);
  time `Wait CurrentTick`; display `TextOut NumOut ClearScreen`; sound `PlayTone
  PlayFile`; EV3 extras `SetLED ButtonPressed Random`.
- Errors with line and column, shown in the editor like the NXC compile errors.

### How it is built

```
source  ->  tokenizer  ->  parser (recursive descent, AST)  ->  type pass
        ->  code generator (emits through Asm, Globals)  ->  bytes
```

The code generator targets the same `Asm` the block generator uses, so "Run now",
Upload (`.rbf` writer), the simulator and the usage counters all work unchanged.
Variables live in the global area (needed for direct commands anyway). The direct
command size limit (about 1 KB per beam) stays a "Run now" limit; Upload has no such
limit, as today.

Testing: the simulator runs every example and a set of unit programs (`node` tests
like the RCX ones), then the real brick for motors and sensors.

### Phases

| Phase | Work | Size |
| --- | --- | --- |
| 0 | **Assembly view and mode**: text form of what the blocks compile to (`Asm.listing()` already exists), plus an assembler that accepts that syntax back, so expert users can write raw bytecode. Gives the text editor, error display and "Run now / Upload from text" plumbing for free. | half a day |
| 1 | **EVC core**: tokenizer, parser, types, control flow, the API above, examples (drive, line follow, touch stop, display demo), API panel entries, simulator tests. Text becomes the third editor mode next to Blocks; the Python pill goes. | 2 to 3 days |
| 2 | **More language**: `sub` with parameters and return values, arrays, string variables, Bluetooth mailboxes, datalog to a file on the brick. | 1 to 2 days |
| 3 | Optional, later: **c4ev3** route with an ARM GCC container on the NAS for people who want real C and native speed. | 1 to 2 days plus the toolchain |

Pybricks: remove the Python pill from the mode switcher; keep one sentence in the
Connection help ("If you would rather run MicroPython, Pybricks replaces the firmware;
this Workbench needs the LEGO firmware") so nobody is misled. The home page card stops
mentioning Pybricks.

## Decisions for Brandon

1. **Name** of the language: EVC, or something else?
2. **NXC-style API names** (recommended, continuity with OpenNXT) or a fresh,
   plainer naming (`motor.on(B, 50)`) aimed at first-time programmers?
3. **Phase 0 first** (assembly view, cheap, useful on its own) or straight to phase 1?
4. **c4ev3** kept in the plan as an optional phase 3, or dropped?
5. **Pybricks**: reduce to one line as proposed, or remove every mention?
