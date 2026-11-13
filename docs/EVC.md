# EVC: text programs for the EV3 on stock firmware

EVC is OpenEV3's text language: a small C-like language in the spirit of NQC (RCX) and
NXC (NXT), compiled in the browser straight to the EV3's own bytecode. Nothing is
installed on the brick and no firmware is replaced: the program runs on the LEGO
firmware like one written in EV3-G. **Run now** sends the main task as a direct
command; **Upload** stores it as an `.rbf` in the brick's `prjs` folder so it appears in
the brick's menu, and that is also how extra tasks (parallel threads) run.

```c
task main()
{
    TextOut(0, LCD_LINE1, "Hello EV3");
    OnFwdSync(OUT_BC, 50, 0);        // both drive motors, straight
    until (SensorTouch(S1));         // wait for the bumper
    Off(OUT_BC);
    RotateMotor(OUT_A, 75, 360);     // one turn, then brake
    PlayTone(TONE_A4, 500);
}
```

## Program structure

| | |
| --- | --- |
| `task main() { ... }` | required; runs first |
| `task name() { ... }` | another thread; `start name;` / `stop name;` from any task (needs Upload) |
| `int f(int a, float b) { return a; }` | functions with parameters and a return value (`int`, `float`, `bool`, or `void` / `sub` for none). They are inlined at each call, so they work in Run now too; recursion is not allowed |
| `int x = 5;` above `main` | global variables, initialised when main starts |
| `#define NAME 50`, `const int NAME = 50;` | named constants |
| `// comment`, `/* comment */` | comments |

## Types and expressions

`int` (32-bit), `float`, `bool`, `string` (32 characters unless declared `string s[80]`),
and arrays `int a[10]` of int, float or bool (indexed from 0, no initialiser lists yet).
Mixing int and float gives a float; assigning a float to an int truncates.

Operators as in C: `+ - * / %`, comparisons, `&& || !`, `& | ^ ~ << >>` (shift amounts
must be constants), `? :`, `++ --`, and `= += -= *= /= %= ...`. Strings join with `+` and
compare with `==`.

## Statements

`if / else`, `while`, `do / while`, `for`, `repeat (n)`, `switch / case / default`,
`break`, `continue`, `return`, and NXC's `until (cond);`, which waits (polling every
10 ms) until the condition is true. `until (cond) { ... }` loops until it is true.

## API

Ports: `OUT_A`..`OUT_D` and combinations such as `OUT_BC`, `OUT_ABCD`; sensor ports
`S1`..`S4`. Power is -100..100. Steering (`turnpct`) is -100 (spin left) .. 0 .. 100
(spin right).

**Motors** `OnFwd(ports, power)`, `OnRev`, `Off(ports)` (brake), `Coast(ports)`,
`OnFwdSync(ports, power, turnpct)`, `OnRevSync`, `RotateMotor(ports, power, degrees)`,
`RotateMotorEx(ports, power, degrees, turnpct, sync, brake)`, `OnFwdTime(ports, power,
ms)`, `OnFwdSyncTime(ports, power, turnpct, ms)`, `MotorRotationCount(port)`,
`ResetRotationCount(ports)`, `MotorPower(port)`, `MotorRunning(ports)`.

**Sensors** (type is detected automatically) `SensorTouch(port)`, `SensorBumps`,
`SensorLight`, `SensorAmbient`, `SensorColor` (`COLOR_BLACK` ... `COLOR_BROWN`),
`SensorRGB(port, 0..2)`, `SensorUS` (cm), `SensorUScm`, `SensorUSInches`, `SensorGyro`,
`SensorGyroRate`, `ResetGyro`, `SensorIR`, `SensorIRHeading(port, channel)`,
`SensorIRDistance`, `SensorIRRemote`, `SensorNXTTouch / Light / Sound / US`,
`SensorValue(port)` (current mode, as a float; `SENSOR_1`..`SENSOR_4` for short),
`SensorRaw(port, mode)`, `SetSensorMode(port, mode)`, `SensorType(port)`.

**Timing** `Wait(ms)`, `CurrentTick()`.

**Display** (178 x 128, y = 0 at the top, `LCD_LINE1`..`LCD_LINE10` 12 px apart)
`TextOut(x, y, "text" [, font])`, `NumOut(x, y, value [, decimals])`, `ClearScreen()`,
`ClearLine(y)`, `PointOut`, `LineOut`, `RectOut(x, y, w, h [, filled])`,
`CircleOut(x, y, r [, filled])`, `GraphicOut(x, y, "file")`.

**Sound** `PlayTone(hz, ms)`, `PlayToneEx(hz, ms, volume)`, `PlayFile("name")`,
`PlayFileEx`, `SoundReady()`, `StopSound()`, `SetVolume(v)`; `TONE_C4`..`TONE_C6`.

**Brick** `SetLED(LED_GREEN ...)`, `ButtonPressed(BTN_ENTER ...)`, `BatteryLevel()`,
`BatteryPercent()`, `Random(n)` or `Random(lo, hi)`, `KeepAlive()`, `Stop()`,
`StopAllTasks()`.

**Maths** `abs min max sqrt pow sin cos tan asin acos atan exp log log10 floor ceil
round trunc` (angles in degrees). **Strings** `NumToStr(value [, decimals])`,
`StrLen(s)`. **Data log** `LogOpen("../prjs/name.rtf")`, `LogWrite`, `LogWriteLine`,
`LogClose()`. **Mailboxes** (experimental, untested on hardware) `SendMessage("box",
"text")`, `ReceiveMessage("box")`.

## Limits

- Run now: main task only, up to about 1 KB of bytecode and 1023 bytes of variables.
  Upload has no such limits.
- All variables live in the program's global area; a function's locals are allocated
  once per call site.
- Not yet: real subroutine calls (functions are inlined), array initialisers, `float`
  array elements through `NumOut` need no conversion but `string` arrays do not exist.

## Assembly

The Assembly editor shows and accepts the bytecode listing EVC and the blocks produce:
`DATA32 x` declarations, then `vmthread MAIN { ... }` blocks with one instruction per
line, labels for jumps, numbers, `"text"`, variable names and sub-code names such as
`UI_DRAW(TEXT, 1, 2, 2, "hi")`. "Send to Assembly" in the other two editors copies the
listing there, which is the quickest way to see what a program compiles to.
