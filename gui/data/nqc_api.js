/* NQC 3.1 API for the RCX2 target: what you can call from a program.
 * Each entry: group, name, signature shown in the list, snippet inserted into the
 * editor, and a one-line description.  Based on Dave Baum's NQC Programmer's Guide. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
OpenRCX.nqcApi = [
  // ------------------------------------------------------------- language
  { g: 'Language', n: 'task main()', s: 'task main() { }', i: 'task main()\n{\n    \n}\n', d: 'Every program needs task main. Up to 10 tasks run in parallel.' },
  { g: 'Language', n: 'task name()', s: 'task name() { }', i: 'task name()\n{\n    \n}\n', d: 'Another task. Start it with "start name;" and stop it with "stop name;".' },
  { g: 'Language', n: 'start / stop', s: 'start name; stop name;', i: 'start name;\n', d: 'Start or stop a task from another task.' },
  { g: 'Language', n: 'sub name()', s: 'sub name() { }', i: 'sub name()\n{\n    \n}\n', d: 'Subroutine, up to 8 per program. Called like a function, takes no arguments.' },
  { g: 'Language', n: 'void name(args)', s: 'void name(int x) { }', i: 'void name(int x)\n{\n    \n}\n', d: 'Inline function: expanded at each call, so it may take arguments.' },
  { g: 'Language', n: 'int', s: 'int x = 0;', i: 'int x = 0;\n', d: '16-bit signed variable. 32 globals and 16 task-local variables on RCX2.' },
  { g: 'Language', n: '#define', s: '#define NAME value', i: '#define NAME 1\n', d: 'Constant or macro, as in C.' },
  { g: 'Language', n: 'if / else', s: 'if (cond) { } else { }', i: 'if ()\n{\n    \n}\nelse\n{\n    \n}\n', d: 'Conditional. Conditions compare values: ==, !=, <, >, <=, >=, &&, ||, !.' },
  { g: 'Language', n: 'while', s: 'while (cond) { }', i: 'while ()\n{\n    \n}\n', d: 'Loop while the condition holds. "while (true)" runs forever.' },
  { g: 'Language', n: 'do / while', s: 'do { } while (cond);', i: 'do\n{\n    \n} while ();\n', d: 'Loop that runs the body at least once.' },
  { g: 'Language', n: 'for', s: 'for (init; cond; step) { }', i: 'for (int i = 0; i < 10; i++)\n{\n    \n}\n', d: 'Counted loop.' },
  { g: 'Language', n: 'repeat', s: 'repeat (count) { }', i: 'repeat (4)\n{\n    \n}\n', d: 'Run the body a fixed number of times. Cheaper than for on the RCX.' },
  { g: 'Language', n: 'until', s: 'until (cond);', i: 'until ();\n', d: 'Wait until the condition becomes true, e.g. until (SENSOR_1 == 1);' },
  { g: 'Language', n: 'break / continue', s: 'break; continue;', i: 'break;\n', d: 'Leave a loop, or jump to its next iteration.' },
  { g: 'Language', n: 'abs / sign', s: 'abs(x)  sign(x)', i: 'abs(x)', d: 'Absolute value, or -1 / 0 / 1 for the sign of x.' },
  { g: 'Language', n: 'Random', s: 'Random(n)', i: 'Random(10)', d: 'Random number from 0 to n.' },
  { g: 'Language', n: 'monitor / catch', s: 'monitor (EVENT_MASK(e)) { } catch { }', i: 'monitor (EVENT_MASK(0))\n{\n    \n}\ncatch\n{\n    \n}\n', d: 'RCX2 events: leave the body as soon as a configured event fires.' },
  { g: 'Language', n: 'acquire / catch', s: 'acquire (ACQUIRE_OUT_A) { } catch { }', i: 'acquire (ACQUIRE_OUT_A)\n{\n    \n}\ncatch\n{\n    \n}\n', d: 'RCX2 access control: own a motor until a higher-priority task takes it.' },

  // ------------------------------------------------------------- outputs
  { g: 'Outputs', n: 'OnFwd', s: 'OnFwd(outputs)', i: 'OnFwd(OUT_A);\n', d: 'Switch outputs on, forward. Outputs: OUT_A, OUT_B, OUT_C, or sums like OUT_A + OUT_C.' },
  { g: 'Outputs', n: 'OnRev', s: 'OnRev(outputs)', i: 'OnRev(OUT_A);\n', d: 'Switch outputs on, reverse.' },
  { g: 'Outputs', n: 'On', s: 'On(outputs)', i: 'On(OUT_A);\n', d: 'Switch on in the current direction.' },
  { g: 'Outputs', n: 'Off', s: 'Off(outputs)', i: 'Off(OUT_A);\n', d: 'Brake: the motor stops and resists turning.' },
  { g: 'Outputs', n: 'Float', s: 'Float(outputs)', i: 'Float(OUT_A);\n', d: 'Coast: power removed, the motor turns freely.' },
  { g: 'Outputs', n: 'Fwd / Rev / Toggle', s: 'Fwd(outputs)  Rev(outputs)  Toggle(outputs)', i: 'Toggle(OUT_A);\n', d: 'Set the direction without changing on/off.' },
  { g: 'Outputs', n: 'OnFor', s: 'OnFor(outputs, time)', i: 'OnFor(OUT_A, 100);\n', d: 'Run for a time in 1/100 s, then switch off.' },
  { g: 'Outputs', n: 'SetPower', s: 'SetPower(outputs, power)', i: 'SetPower(OUT_A, OUT_FULL);\n', d: 'Power 0..7, or OUT_LOW, OUT_HALF, OUT_FULL.' },
  { g: 'Outputs', n: 'SetDirection', s: 'SetDirection(outputs, dir)', i: 'SetDirection(OUT_A, OUT_FWD);\n', d: 'OUT_FWD, OUT_REV or OUT_TOGGLE.' },
  { g: 'Outputs', n: 'SetOutput', s: 'SetOutput(outputs, mode)', i: 'SetOutput(OUT_A, OUT_ON);\n', d: 'OUT_ON, OUT_OFF or OUT_FLOAT.' },
  { g: 'Outputs', n: 'OutputStatus', s: 'OutputStatus(n)', i: 'OutputStatus(0)', d: 'Status byte of output 0..2: power, direction and mode bits.' },
  { g: 'Outputs', n: 'SetGlobalOutput', s: 'SetGlobalOutput(outputs, mode)', i: 'SetGlobalOutput(OUT_A, OUT_OFF);\n', d: 'RCX2: master override; OUT_OFF here disables the output for every task until OUT_ON.' },
  { g: 'Outputs', n: 'SetGlobalDirection', s: 'SetGlobalDirection(outputs, dir)', i: 'SetGlobalDirection(OUT_A, OUT_REV);\n', d: 'RCX2: invert an output globally, handy for mirrored motors.' },
  { g: 'Outputs', n: 'SetMaxPower', s: 'SetMaxPower(outputs, power)', i: 'SetMaxPower(OUT_A, OUT_FULL);\n', d: 'RCX2: cap the power any task can set.' },

  // ------------------------------------------------------------- sensors
  { g: 'Sensors', n: 'SetSensor', s: 'SetSensor(sensor, config)', i: 'SetSensor(SENSOR_1, SENSOR_TOUCH);\n', d: 'Type and mode in one go: SENSOR_TOUCH, SENSOR_LIGHT, SENSOR_ROTATION, SENSOR_CELSIUS, SENSOR_FAHRENHEIT, SENSOR_PULSE, SENSOR_EDGE.' },
  { g: 'Sensors', n: 'SetSensorType', s: 'SetSensorType(sensor, type)', i: 'SetSensorType(SENSOR_1, SENSOR_TYPE_LIGHT);\n', d: 'SENSOR_TYPE_NONE, _TOUCH, _TEMPERATURE, _LIGHT, _ROTATION.' },
  { g: 'Sensors', n: 'SetSensorMode', s: 'SetSensorMode(sensor, mode)', i: 'SetSensorMode(SENSOR_1, SENSOR_MODE_RAW);\n', d: 'SENSOR_MODE_RAW, _BOOL, _EDGE, _PULSE, _PERCENT, _CELSIUS, _FAHRENHEIT, _ROTATION.' },
  { g: 'Sensors', n: 'SENSOR_n', s: 'SENSOR_1  SENSOR_2  SENSOR_3', i: 'SENSOR_1', d: 'Reads the sensor value in its current mode, e.g. if (SENSOR_2 < 40).' },
  { g: 'Sensors', n: 'SensorValue', s: 'SensorValue(n)', i: 'SensorValue(0)', d: 'Same as SENSOR_1..3, with the port given as 0..2.' },
  { g: 'Sensors', n: 'SensorValueRaw', s: 'SensorValueRaw(n)', i: 'SensorValueRaw(0)', d: 'Raw 0..1023 reading regardless of mode.' },
  { g: 'Sensors', n: 'SensorValueBool', s: 'SensorValueBool(n)', i: 'SensorValueBool(0)', d: 'Boolean 0/1 reading regardless of mode.' },
  { g: 'Sensors', n: 'ClearSensor', s: 'ClearSensor(sensor)', i: 'ClearSensor(SENSOR_1);\n', d: 'Reset a rotation, pulse or edge counter to 0.' },
  { g: 'Sensors', n: 'SensorType / SensorMode', s: 'SensorType(n)  SensorMode(n)', i: 'SensorType(0)', d: 'Current type or mode of a port.' },
  { g: 'Sensors', n: 'SetSensorLowerLimit…', s: 'SetSensorLowerLimit(n, v) …UpperLimit …Hysteresis', i: 'SetSensorLowerLimit(0, 40);\n', d: 'RCX2 event thresholds for a sensor port (with SetEvent).' },

  // ------------------------------------------------------------- timers & counters
  { g: 'Timers & counters', n: 'Wait', s: 'Wait(time)', i: 'Wait(100);\n', d: 'Pause this task for time in 1/100 s. Other tasks keep running.' },
  { g: 'Timers & counters', n: 'Timer', s: 'Timer(n)', i: 'Timer(0)', d: 'Timer 0..3 in 1/10 s since it was cleared.' },
  { g: 'Timers & counters', n: 'FastTimer', s: 'FastTimer(n)', i: 'FastTimer(0)', d: 'RCX2: same timer in 1/100 s.' },
  { g: 'Timers & counters', n: 'ClearTimer', s: 'ClearTimer(n)', i: 'ClearTimer(0);\n', d: 'Reset timer 0..3.' },
  { g: 'Timers & counters', n: 'SetTimer', s: 'SetTimer(n, value)', i: 'SetTimer(0, 0);\n', d: 'RCX2: preset a timer.' },
  { g: 'Timers & counters', n: 'Counter', s: 'Counter(n)', i: 'Counter(0)', d: 'RCX2 counters 0..2, stored in variables 0..2.' },
  { g: 'Timers & counters', n: 'ClearCounter / IncCounter / DecCounter', s: 'IncCounter(n)', i: 'IncCounter(0);\n', d: 'RCX2: reset, add one, subtract one.' },
  { g: 'Timers & counters', n: 'Watch', s: 'Watch()', i: 'Watch()', d: 'The brick clock in minutes.' },
  { g: 'Timers & counters', n: 'SetWatch', s: 'SetWatch(hours, minutes)', i: 'SetWatch(12, 0);\n', d: 'Set the brick clock.' },

  // ------------------------------------------------------------- sound
  { g: 'Sound', n: 'PlaySound', s: 'PlaySound(sound)', i: 'PlaySound(SOUND_CLICK);\n', d: 'SOUND_CLICK, SOUND_DOUBLE_BEEP, SOUND_DOWN, SOUND_UP, SOUND_LOW_BEEP, SOUND_FAST_UP.' },
  { g: 'Sound', n: 'PlayTone', s: 'PlayTone(frequency, duration)', i: 'PlayTone(440, 50);\n', d: 'Frequency in Hz, duration in 1/100 s.' },
  { g: 'Sound', n: 'MuteSound / UnmuteSound', s: 'MuteSound()  UnmuteSound()', i: 'MuteSound();\n', d: 'RCX2: silence all sounds.' },
  { g: 'Sound', n: 'ClearSound', s: 'ClearSound()', i: 'ClearSound();\n', d: 'RCX2: drop queued sounds.' },

  // ------------------------------------------------------------- display
  { g: 'Display', n: 'SelectDisplay', s: 'SelectDisplay(mode)', i: 'SelectDisplay(DISPLAY_SENSOR_1);\n', d: 'DISPLAY_WATCH, DISPLAY_SENSOR_1..3, DISPLAY_OUT_A..C, DISPLAY_USER (RCX2).' },
  { g: 'Display', n: 'SetUserDisplay', s: 'SetUserDisplay(value, precision)', i: 'SetUserDisplay(x, 0);\n', d: 'RCX2: show a number on the LCD; precision = decimal places.' },

  // ------------------------------------------------------------- messages & IR
  { g: 'Messages & IR', n: 'SendMessage', s: 'SendMessage(message)', i: 'SendMessage(1);\n', d: 'Broadcast a 1..255 message over IR to other bricks (and this tool).' },
  { g: 'Messages & IR', n: 'Message', s: 'Message()', i: 'Message()', d: 'Last message received, 0 if none.' },
  { g: 'Messages & IR', n: 'ClearMessage', s: 'ClearMessage()', i: 'ClearMessage();\n', d: 'Set the received message back to 0.' },
  { g: 'Messages & IR', n: 'SetTxPower', s: 'SetTxPower(power)', i: 'SetTxPower(TX_POWER_HI);\n', d: 'TX_POWER_LO or TX_POWER_HI for the brick transmitter.' },
  { g: 'Messages & IR', n: 'SetSerial… / SendSerial', s: 'SetSerialComm/Packet/Data, SendSerial(start, count)', i: 'SendSerial(0, 1);\n', d: 'RCX2: raw IR packets, used to drive other LEGO IR devices.' },

  // ------------------------------------------------------------- datalog
  { g: 'Datalog', n: 'CreateDatalog', s: 'CreateDatalog(size)', i: 'CreateDatalog(100);\n', d: 'Allocate a log of size entries (0 clears it).' },
  { g: 'Datalog', n: 'AddToDatalog', s: 'AddToDatalog(value)', i: 'AddToDatalog(SENSOR_1);\n', d: 'Append a sensor, timer, variable or Watch() value. Read it back in the Datalog section.' },
  { g: 'Datalog', n: 'UploadDatalog', s: 'UploadDatalog(start, count)', i: 'UploadDatalog(0, 10);\n', d: 'Make the brick send part of the log over IR.' },

  // ------------------------------------------------------------- program flow
  { g: 'Program', n: 'StopAllTasks', s: 'StopAllTasks()', i: 'StopAllTasks();\n', d: 'Stop the whole program, like pressing Run.' },
  { g: 'Program', n: 'SetPriority', s: 'SetPriority(p)', i: 'SetPriority(1);\n', d: 'RCX2: task priority 0 (highest) to 255, used with acquire.' },
  { g: 'Program', n: 'SetSleepTime', s: 'SetSleepTime(minutes)', i: 'SetSleepTime(0);\n', d: 'Auto power-off delay; 0 disables it.' },
  { g: 'Program', n: 'SleepNow', s: 'SleepNow()', i: 'SleepNow();\n', d: 'Switch the brick off.' },
  { g: 'Program', n: 'Program', s: 'Program()', i: 'Program()', d: 'Number of the running program slot, 0..4.' },
  { g: 'Program', n: 'BatteryLevel', s: 'BatteryLevel()', i: 'BatteryLevel()', d: 'RCX2: battery in millivolts.' },
  { g: 'Program', n: 'FirmwareVersion', s: 'FirmwareVersion()', i: 'FirmwareVersion()', d: 'RCX2: firmware version number.' },
  { g: 'Program', n: 'SetEvent / ClearEvent', s: 'SetEvent(event, source, type)', i: 'SetEvent(0, SENSOR_1, EVENT_TYPE_PRESSED);\n', d: 'RCX2: define one of 16 events (EVENT_TYPE_PRESSED, _RELEASED, _LOW, _NORMAL, _HIGH, _CLICK, _DOUBLECLICK, _MESSAGE) for monitor.' },
];
