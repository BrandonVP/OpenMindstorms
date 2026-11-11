/* NXC (Not eXactly C) API, curated for the NXT with the standard LEGO firmware 1.28+.
 * Each entry: group, name, signature shown, snippet inserted, description.
 * From John Hansen's NXC Programmer's Guide; the full guide is linked in the app. */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
OpenNXT.nxcApi = [
  // ---- language
  { g: 'Language', n: 'task main()', s: 'task main() { }', i: 'task main()\n{\n    \n}\n', d: 'Every program needs task main. Tasks run in parallel; start others with "start name;" or Precedes()/Follows().' },
  { g: 'Language', n: 'task', s: 'task name() { }', i: 'task name()\n{\n    \n}\n', d: 'Another task. "start name;" runs it, "stop name;" stops it, StopAllTasks() stops everything.' },
  { g: 'Language', n: 'Precedes', s: 'Precedes(task1, task2)', i: 'Precedes(task1, task2);\n', d: 'Put at the start of main: start those tasks when main ends (NXT-G style parallel sequences).' },
  { g: 'Language', n: 'inline / sub', s: 'sub name() { }  /  inline void name() { }', i: 'sub name()\n{\n    \n}\n', d: 'Subroutine (one copy, called) or inline function (expanded). Real functions with arguments and return values also work: int add(int a, int b) { return a + b; }' },
  { g: 'Language', n: 'variables', s: 'int x; long y; bool b; byte c; string s; float f;', i: 'int x = 0;\n', d: 'Globals outside tasks, locals inside. Arrays: int a[]; and ArrayInit(a, 0, 10).' },
  { g: 'Language', n: '#define', s: '#define NAME value', i: '#define NAME 1\n', d: 'Constants and macros, as in C. #include "file.h" works too.' },
  { g: 'Language', n: 'if / else', s: 'if (cond) { } else { }', i: 'if ()\n{\n    \n}\nelse\n{\n    \n}\n', d: 'Full C expressions: ==, !=, <, >, &&, ||, !, arithmetic, bit operators.' },
  { g: 'Language', n: 'while / do', s: 'while (cond) { }', i: 'while (true)\n{\n    \n}\n', d: 'Loops. "while (true)" runs forever; break and continue work.' },
  { g: 'Language', n: 'for', s: 'for (int i = 0; i < 10; i++) { }', i: 'for (int i = 0; i < 10; i++)\n{\n    \n}\n', d: 'Counted loop.' },
  { g: 'Language', n: 'repeat', s: 'repeat (count) { }', i: 'repeat (4)\n{\n    \n}\n', d: 'Run the body a fixed number of times.' },
  { g: 'Language', n: 'until', s: 'until (cond);', i: 'until ();\n', d: 'Wait until the condition is true, e.g. until (SENSOR_1 == 1);' },
  { g: 'Language', n: 'switch', s: 'switch (x) { case 1: break; default: }', i: 'switch (x)\n{\n    case 1:\n        break;\n    default:\n        break;\n}\n', d: 'Multi-way branch on a number.' },
  { g: 'Language', n: 'Wait', s: 'Wait(ms)', i: 'Wait(1000);\n', d: 'Pause this task for milliseconds (1000 = one second). Other tasks keep running.' },
  { g: 'Language', n: 'Random', s: 'Random(n)', i: 'Random(100)', d: 'Random number 0 .. n-1.' },
  { g: 'Language', n: 'abs / sign', s: 'abs(x)  sign(x)', i: 'abs(x)', d: 'Absolute value; -1/0/1.' },
  { g: 'Language', n: 'StopAllTasks', s: 'StopAllTasks()', i: 'StopAllTasks();\n', d: 'End the program.' },

  // ---- motors
  { g: 'Motors', n: 'OnFwd', s: 'OnFwd(outputs, power)', i: 'OnFwd(OUT_A, 75);\n', d: 'Run forward at power 0..100 until told otherwise. Outputs: OUT_A, OUT_B, OUT_C, OUT_AB, OUT_AC, OUT_BC, OUT_ABC.' },
  { g: 'Motors', n: 'OnRev', s: 'OnRev(outputs, power)', i: 'OnRev(OUT_A, 75);\n', d: 'Run backward.' },
  { g: 'Motors', n: 'Off', s: 'Off(outputs)', i: 'Off(OUT_A);\n', d: 'Stop and brake (holds position).' },
  { g: 'Motors', n: 'Coast / Float', s: 'Coast(outputs)', i: 'Coast(OUT_A);\n', d: 'Stop and let the motor spin freely.' },
  { g: 'Motors', n: 'RotateMotor', s: 'RotateMotor(outputs, power, degrees)', i: 'RotateMotor(OUT_A, 75, 360);\n', d: 'Turn exactly this many degrees (negative = backward) and wait until done. The NXT-G Motor block.' },
  { g: 'Motors', n: 'RotateMotorEx', s: 'RotateMotorEx(outputs, power, degrees, turnpct, sync, stop)', i: 'RotateMotorEx(OUT_BC, 75, 720, 0, true, true);\n', d: 'Two synchronised motors (OUT_BC) with a turn percentage -100..100: the NXT-G Move block with degrees.' },
  { g: 'Motors', n: 'OnFwdSync', s: 'OnFwdSync(outputs, power, turnpct)', i: 'OnFwdSync(OUT_BC, 75, 0);\n', d: 'Drive two motors in sync with steering: 0 straight, 100 spin right, -100 spin left. OnRevSync for backwards.' },
  { g: 'Motors', n: 'OnFwdReg', s: 'OnFwdReg(outputs, power, regmode)', i: 'OnFwdReg(OUT_A, 50, OUT_REGMODE_SPEED);\n', d: 'Speed-regulated run: holds speed under load. OUT_REGMODE_IDLE / _SPEED / _SYNC.' },
  { g: 'Motors', n: 'MotorRotationCount', s: 'MotorRotationCount(output)', i: 'MotorRotationCount(OUT_A)', d: 'Degrees turned since the last reset (the built-in rotation sensor).' },
  { g: 'Motors', n: 'ResetRotationCount', s: 'ResetRotationCount(outputs)', i: 'ResetRotationCount(OUT_A);\n', d: 'Zero the rotation counter. ResetAllTachoCounts(outputs) clears everything.' },
  { g: 'Motors', n: 'MotorTachoCount', s: 'MotorTachoCount(output)', i: 'MotorTachoCount(OUT_A)', d: 'Degrees since the current RotateMotor started.' },
  { g: 'Motors', n: 'SetMotorPwnFreq…', s: 'SetOutput(outputs, field, value, …)', i: 'SetOutput(OUT_A, Power, 50, OutputMode, OUT_MODE_MOTORON + OUT_MODE_BRAKE, RunState, OUT_RUNSTATE_RUNNING, UpdateFlags, UF_UPDATE_MODE + UF_UPDATE_SPEED);\n', d: 'Low-level access to every output field (Power, OutputMode, RegMode, TurnRatio, RunState, TachoLimit, UpdateFlags).' },

  // ---- sensors
  { g: 'Sensors', n: 'SetSensorTouch', s: 'SetSensorTouch(port)', i: 'SetSensorTouch(S1);\n', d: 'Touch sensor on S1..S4; then SENSOR_1 (or Sensor(S1)) reads 1 when pressed.' },
  { g: 'Sensors', n: 'SetSensorLight', s: 'SetSensorLight(port)', i: 'SetSensorLight(S3);\n', d: 'Light sensor with its lamp on, 0..100 %. SetSensorLight(S3, false) turns the lamp off (ambient light).' },
  { g: 'Sensors', n: 'SetSensorSound', s: 'SetSensorSound(port)', i: 'SetSensorSound(S2);\n', d: 'Sound sensor, 0..100 % (dB). SetSensorSoundDBA? use SetSensorType(S2, SENSOR_TYPE_SOUND_DBA).' },
  { g: 'Sensors', n: 'SetSensorLowspeed', s: 'SetSensorLowspeed(port)', i: 'SetSensorLowspeed(S4);\n', d: 'Prepare a digital (I2C) sensor port: ultrasonic and most third-party sensors.' },
  { g: 'Sensors', n: 'SensorUS', s: 'SensorUS(port)', i: 'SensorUS(S4)', d: 'Ultrasonic distance in cm (255 = nothing). Needs SetSensorLowspeed first.' },
  { g: 'Sensors', n: 'SetSensorColorFull', s: 'SetSensorColorFull(port)', i: 'SetSensorColorFull(S3);\n', d: 'NXT 2.0 colour sensor: Sensor(S3) then returns INPUT_BLACKCOLOR .. INPUT_WHITECOLOR (1..6). SetSensorColorRed/Green/Blue/None use it as a light sensor.' },
  { g: 'Sensors', n: 'SENSOR_n / Sensor', s: 'SENSOR_1 .. SENSOR_4   Sensor(port)', i: 'SENSOR_1', d: 'Current scaled reading of a port (bool for touch, percent for light and sound).' },
  { g: 'Sensors', n: 'SensorRaw', s: 'SensorRaw(port)', i: 'SensorRaw(S1)', d: 'Raw 0..1023 reading.' },
  { g: 'Sensors', n: 'SetSensorType / Mode', s: 'SetSensorType(port, type)  SetSensorMode(port, mode)', i: 'SetSensorType(S1, SENSOR_TYPE_TOUCH);\nSetSensorMode(S1, SENSOR_MODE_BOOL);\n', d: 'Manual configuration. Types SENSOR_TYPE_TOUCH, _LIGHT_ACTIVE, _LIGHT_INACTIVE, _SOUND_DB, _SOUND_DBA, _LOWSPEED_9V, _COLORFULL…; modes SENSOR_MODE_RAW, _BOOL, _EDGE, _PULSE, _PERCENT, _CELSIUS, _FAHRENHEIT, _ROTATION.' },
  { g: 'Sensors', n: 'ClearSensor', s: 'ClearSensor(port)', i: 'ClearSensor(S1);\n', d: 'Reset an edge/pulse counter.' },
  { g: 'Sensors', n: 'ButtonPressed', s: 'ButtonPressed(button, reset)', i: 'ButtonPressed(BTNCENTER, false)', d: 'The brick\'s own buttons: BTNLEFT, BTNRIGHT, BTNCENTER, BTNEXIT. ButtonCount(button, reset) counts presses.' },

  // ---- timers
  { g: 'Timers', n: 'CurrentTick', s: 'CurrentTick()', i: 'CurrentTick()', d: 'Milliseconds since the brick was switched on. Subtract two readings to time things.' },
  { g: 'Timers', n: 'FirstTick', s: 'FirstTick()', i: 'FirstTick()', d: 'Tick when the program started.' },
  { g: 'Timers', n: 'SleepTime / SleepNow', s: 'SleepNow()  SetSleepTime(minutes)', i: 'SetSleepTime(0);\n', d: 'Auto power-off control; 0 disables it. SleepNow() switches the brick off.' },

  // ---- sound
  { g: 'Sound', n: 'PlayTone', s: 'PlayTone(frequency, ms)', i: 'PlayTone(440, 500);\n', d: 'Beep at frequency Hz for ms milliseconds (does not wait: add Wait(ms) if needed). PlayToneEx adds volume and looping.' },
  { g: 'Sound', n: 'PlayFile', s: 'PlayFile("name.rso")', i: 'PlayFile("Woops.rso");\n', d: 'Play a sound file stored on the brick (upload .rso files in the Files section). PlayFileEx adds volume and loop.' },
  { g: 'Sound', n: 'Note constants', s: 'TONE_C4 .. TONE_B7, MS_500 …', i: 'PlayTone(TONE_A4, MS_500);\n', d: 'Named notes (TONE_C4 = middle C) and durations (MS_50 .. MS_1000, SEC_1 ..).' },
  { g: 'Sound', n: 'StopSound / SetVolume', s: 'StopSound()  SetVolume(0..4)', i: 'SetVolume(4);\n', d: 'Stop playback; set the brick volume.' },
  { g: 'Sound', n: 'SoundFlags', s: 'until (SoundFlags() == SOUND_FLAGS_IDLE);', i: 'until (SoundFlags() == SOUND_FLAGS_IDLE);\n', d: 'Wait for a sound to finish.' },

  // ---- display
  { g: 'Display', n: 'TextOut', s: 'TextOut(x, y, "text")', i: 'TextOut(0, LCD_LINE1, "Hello");\n', d: 'Text at pixel x and a line LCD_LINE1 .. LCD_LINE8 (100 x 64 screen, 8 lines of 16 characters).' },
  { g: 'Display', n: 'NumOut', s: 'NumOut(x, y, value)', i: 'NumOut(0, LCD_LINE2, SENSOR_1);\n', d: 'Show a number.' },
  { g: 'Display', n: 'ClearScreen', s: 'ClearScreen()', i: 'ClearScreen();\n', d: 'Blank the display. TextOut(..., "text", true)? use the DRAW_OPT_CLEAR_WHOLE_SCREEN option instead.' },
  { g: 'Display', n: 'Graphics', s: 'PointOut, LineOut, RectOut, CircleOut', i: 'CircleOut(50, 32, 20);\n', d: 'Drawing primitives in pixels; GraphicOut(x, y, "pic.ric") shows a picture file.' },
  { g: 'Display', n: 'StrCat / NumToStr', s: 'StrCat(s1, s2)  NumToStr(n)', i: 'TextOut(0, LCD_LINE1, StrCat("S1=", NumToStr(SENSOR_1)));\n', d: 'Build strings for the display.' },

  // ---- messages & files
  { g: 'Bluetooth & files', n: 'SendMessage', s: 'SendMessage(mailbox, "text")', i: 'SendMessage(MAILBOX1, "hello");\n', d: 'Put a message in a mailbox (1..10) where the PC or another brick can read it. SendRemoteString sends to a connected brick.' },
  { g: 'Bluetooth & files', n: 'ReceiveMessage', s: 'ReceiveMessage(mailbox, remove, msg)', i: 'string msg;\nReceiveMessage(MAILBOX1, true, msg);\n', d: 'Read a mailbox; msg is "" when empty. ReceiveRemoteNumber reads a number.' },
  { g: 'Bluetooth & files', n: 'CreateFile', s: 'CreateFile("name.txt", size, handle)', i: 'byte handle;\nCreateFile("log.txt", 1024, handle);\n', d: 'Data logging: make a file, then WriteLn(handle, text) / WriteLnString, and CloseFile(handle). Download it from the Files section.' },
  { g: 'Bluetooth & files', n: 'WriteLn', s: 'WriteLn(handle, value)', i: 'WriteLn(handle, SENSOR_1);\n', d: 'Append a value and a newline to an open file.' },
  { g: 'Bluetooth & files', n: 'OpenFileRead', s: 'OpenFileRead("name", size, handle)', i: 'OpenFileRead("log.txt", size, handle);\n', d: 'Read back a file with ReadLn(handle, value) / ReadLnString.' },
  { g: 'Bluetooth & files', n: 'BatteryLevel', s: 'BatteryLevel()', i: 'BatteryLevel()', d: 'Battery in millivolts.' },
];
