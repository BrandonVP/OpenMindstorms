/* C (c4ev3 / EV3-API) example programs. These compile on the OpenMindstorms server with the
 * c4ev3 GCC toolchain and run as native Linux programs on the stock firmware. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
OpenEV3.cExamples = [
  { name: 'Hello: display, sound, motors', source: `// Native C on the EV3 with the c4ev3 EV3-API. The brick menu pauses while a C program
// runs, so always give it a way to end: here the Back button.
#include <ev3.h>

int main(void)
{
    InitEV3();
    LcdTextf(1, 0, LCD_LINE1, "Hello from C");
    PlayTone(TONE_C5, 300);
    Wait(400);
    RotateMotor(OUT_BC, 50, 360);       // both drive motors one turn forward, then brake
    Wait(500);
    RotateMotor(OUT_BC, 50, -360);
    LcdTextf(1, 0, LCD_LINE3, "Press Back to exit");
    while (!ButtonIsDown(BTNEXIT))
        Wait(50);
    FreeEV3();
    return 0;
}
` },
  { name: 'Bumper car (touch sensor)', source: `#include <ev3.h>

int main(void)
{
    InitEV3();
    SetAllSensors(EV3Touch, NULL, NULL, NULL);        // touch on port 1
    while (!ButtonIsDown(BTNEXIT))
    {
        OnFwdSyncEx(OUT_BC, 50, 0, RESET_NONE);
        while (!ReadEV3TouchSensor(IN_1) && !ButtonIsDown(BTNEXIT))
            Wait(10);
        PlayTone(TONE_A4, 100);
        OnRevSyncEx(OUT_BC, 40, 0, RESET_NONE);
        Wait(600);
        RotateMotorEx(OUT_BC, 40, 400, 100, true, true);   // spin right
    }
    Off(OUT_BC);
    FreeEV3();
    return 0;
}
` },
  { name: 'Line follower with a timer readout', source: `#include <ev3.h>

#define THRESHOLD 40

int main(void)
{
    InitEV3();
    SetAllSensors(NULL, NULL, EV3Color, NULL);        // colour sensor on port 3
    int loops = 0;
    while (!ButtonIsDown(BTNEXIT))
    {
        int light = ReadEV3ColorSensorReflectedLight(IN_3);
        OnFwdSyncEx(OUT_BC, 30, light < THRESHOLD ? -30 : 30, RESET_NONE);
        if (++loops % 20 == 0)
            LcdTextf(1, 0, LCD_LINE1, "light %3d  t %lu ms", light, (unsigned long) TimerGetMS());
        Wait(10);
    }
    Off(OUT_BC);
    FreeEV3();
    return 0;
}
` },
];

/* EV3-API reference for the C editor (the full headers are in github.com/c4ev3/EV3-API/include). */
OpenEV3.cApi = [
  { g: 'Program', n: 'skeleton', s: '#include <ev3.h>  int main(void) { InitEV3(); ... FreeEV3(); }', i: '#include <ev3.h>\n\nint main(void)\n{\n    InitEV3();\n    \n    FreeEV3();\n    return 0;\n}\n', d: 'Every program starts with InitEV3() and ends with FreeEV3(). It is ordinary C99 (printf, math.h, string.h, pthreads).' },
  { g: 'Program', n: 'exit on Back', s: 'while (!ButtonIsDown(BTNEXIT)) { ... }', i: 'while (!ButtonIsDown(BTNEXIT))\n{\n    \n    Wait(50);\n}\n', d: 'The brick menu and the USB link pause while a C program runs, so give every program a way to end.' },
  { g: 'Motors', n: 'OnFwdEx / OnRevEx', s: 'OnFwdEx(ports, power, RESET_NONE)', i: 'OnFwdEx(OUT_BC, 50, RESET_NONE);\n', d: 'Run motors and carry on. Ports: OUT_A..OUT_D, OUT_BC, OUT_ABCD. Power -100..100.' },
  { g: 'Motors', n: 'Off / Float', s: 'Off(ports)  Float(ports)', i: 'Off(OUT_BC);\n', d: 'Brake, or coast.' },
  { g: 'Motors', n: 'OnFwdSyncEx', s: 'OnFwdSyncEx(ports, speed, turn, RESET_NONE)', i: 'OnFwdSyncEx(OUT_BC, 50, 0, RESET_NONE);\n', d: 'Two motors in sync with steering; OnRevSyncEx for backward.' },
  { g: 'Motors', n: 'RotateMotor', s: 'RotateMotor(ports, speed, degrees)', i: 'RotateMotor(OUT_A, 50, 360);\n', d: 'Turn by degrees and wait. RotateMotorEx(ports, speed, degrees, turn, sync, stop) adds steering; RotateMotorNoWaitEx does not wait.' },
  { g: 'Motors', n: 'OnForEx', s: 'OnForEx(ports, ms, power, RESET_NONE)', i: 'OnForEx(OUT_A, 1000, 50, RESET_NONE);\n', d: 'Run for a time.' },
  { g: 'Motors', n: 'MotorRotationCount', s: 'MotorRotationCount(port)', i: 'MotorRotationCount(OUT_A)', d: 'Degrees turned; ResetRotationCount(ports) zeroes it. MotorPower(port) gives the current power.' },
  { g: 'Sensors', n: 'SetAllSensors', s: 'SetAllSensors(EV3Touch, EV3Gyro, EV3Color, EV3Ultrasonic)', i: 'SetAllSensors(EV3Touch, NULL, EV3Color, EV3Ultrasonic);\n', d: 'Tell the API what is on ports 1..4 (NULL for nothing). Handlers: EV3Touch, EV3Color, EV3Ultrasonic, EV3Gyro, EV3Ir, NXTTouch, NXTLight, NXTSound, NXTUltrasonic.' },
  { g: 'Sensors', n: 'ReadEV3TouchSensor', s: 'ReadEV3TouchSensor(IN_1)', i: 'ReadEV3TouchSensor(IN_1)', d: 'true while pressed. Ports IN_1..IN_4.' },
  { g: 'Sensors', n: 'ReadEV3ColorSensorReflectedLight', s: 'ReadEV3ColorSensorReflectedLight(IN_3)', i: 'ReadEV3ColorSensorReflectedLight(IN_3)', d: '0..100. Also ReadEV3ColorSensorAmbientLight(port), ReadEV3ColorSensorColor(port), ReadEV3ColorSensorColorRGB(port, &rgb).' },
  { g: 'Sensors', n: 'ReadEV3UltrasonicSensorDistance', s: 'ReadEV3UltrasonicSensorDistance(IN_4, EV3_ULTRASONIC_CM)', i: 'ReadEV3UltrasonicSensorDistance(IN_4, EV3_ULTRASONIC_CM)', d: 'Distance in cm (EV3_ULTRASONIC_MM or EV3_ULTRASONIC_IN for other units).' },
  { g: 'Sensors', n: 'ReadEV3GyroSensorAngle', s: 'ReadEV3GyroSensorAngle(IN_2, mode)', i: 'ReadEV3GyroSensorAngle(IN_2, EV3GyroNormalAngle)', d: 'Angle in degrees; ReadEV3GyroSensorRate(port, mode); ResetEV3GyroSensor(port, strategy). The mode and strategy names are enums in ev3_gyro.h.' },
  { g: 'Sensors', n: 'ReadEV3IrSensorProximity', s: 'ReadEV3IrSensorProximity(IN_4)', i: 'ReadEV3IrSensorProximity(IN_4)', d: '0..100. ReadEV3IrSensorSeek(port, &result) finds the beacon.' },
  { g: 'Buttons / LED', n: 'ButtonIsDown', s: 'ButtonIsDown(BTNEXIT)', i: 'ButtonIsDown(BTNCENTER)', d: 'BTNEXIT (Back), BTNCENTER, BTNUP, BTNDOWN, BTNLEFT, BTNRIGHT. ButtonWaitForPress(btn), ButtonWaitForAnyPress(timeout_ms).' },
  { g: 'Buttons / LED', n: 'SetLedPattern', s: 'SetLedPattern(LED_GREEN)', i: 'SetLedPattern(LED_GREEN);\n', d: 'LED_BLACK, LED_GREEN, LED_RED, LED_ORANGE and the _FLASH and _PULSE variants (ev3_button.core.h).' },
  { g: 'Display', n: 'LcdTextf', s: 'LcdTextf(1, x, y, "fmt", ...)', i: 'LcdTextf(1, 0, LCD_LINE1, "value %d", 0);\n', d: 'printf-style text at x, y (LCD_LINE1..LCD_LINE8, 16 px apart). First argument 1 = black. LcdClean() clears.' },
  { g: 'Display', n: 'LcdPrintf', s: 'LcdPrintf(1, "fmt", ...)', i: 'LcdPrintf(1, "hello\\n");\n', d: 'Console-style output with a cursor; Ev3Printf / Ev3Println similar.' },
  { g: 'Display', n: 'shapes', s: 'LineOutEx(x1, y1, x2, y2, 0)  CircleOutEx(x, y, r, 0)  RectOutEx(x, y, w, h, 0)', i: 'LineOutEx(0, 0, 177, 127, 0);\n', d: 'Drawing; the options argument can be DRAW_OPT_FILL_SHAPE.' },
  { g: 'Sound', n: 'PlayTone', s: 'PlayTone(hz, ms)', i: 'PlayTone(TONE_C5, 200);\n', d: 'Blocks until done. PlayToneEx(hz, ms, volume), PlayFileEx("name", volume, loop), StopSound().' },
  { g: 'Timing', n: 'Wait', s: 'Wait(ms)', i: 'Wait(1000);\n', d: 'Pause.' },
  { g: 'Timing', n: 'TimerGetMS', s: 'TimerGetMS()', i: 'TimerGetMS()', d: 'Milliseconds since start (unsigned long long). TimerMS(n) / ClearTimerMS(n) for four resettable timers.' },
];
