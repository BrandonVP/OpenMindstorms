/* NXC example programs for the Program section. */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
OpenNXT.examples = [
  { name: 'Hello: beep, drive, display', source: `// Beeps, shows a message, drives motors B and C forward one turn, then back.
task main()
{
    TextOut(0, LCD_LINE1, "OpenNXT says hi");
    PlayTone(TONE_C5, MS_200);
    Wait(300);
    RotateMotorEx(OUT_BC, 75, 360, 0, true, true);
    Wait(500);
    RotateMotorEx(OUT_BC, 75, -360, 0, true, true);
    PlayTone(TONE_G5, MS_500);
    Wait(600);
}
` },
  { name: 'Touch sensor bumper', source: `// Drive until the touch sensor on port 1 is pressed, back up, turn, repeat.
task main()
{
    SetSensorTouch(S1);
    while (true)
    {
        OnFwdSync(OUT_BC, 75, 0);
        until (SENSOR_1 == 1);
        PlayTone(TONE_A4, MS_100);
        OnRevSync(OUT_BC, 60, 0);
        Wait(600);
        RotateMotorEx(OUT_BC, 60, 360, 100, true, true);   // spin right
    }
}
` },
  { name: 'Ultrasonic wall avoider', source: `// Slow down and turn away when something is closer than 25 cm on port 4.
task main()
{
    SetSensorLowspeed(S4);
    while (true)
    {
        int cm = SensorUS(S4);
        NumOut(0, LCD_LINE1, cm);
        if (cm < 25)
        {
            OnRevSync(OUT_BC, 50, 0);
            Wait(400);
            RotateMotorEx(OUT_BC, 50, 300, 100, true, true);
        }
        else
        {
            OnFwdSync(OUT_BC, 75, 0);
        }
        Wait(50);
    }
}
` },
  { name: 'Line follower (light sensor)', source: `// Follow a dark line with the light sensor on port 3.
#define THRESHOLD 45

task main()
{
    SetSensorLight(S3);
    while (true)
    {
        if (SENSOR_3 < THRESHOLD)
            OnFwdSync(OUT_BC, 50, -40);
        else
            OnFwdSync(OUT_BC, 50, 40);
    }
}
` },
  { name: 'Data log to a file', source: `// Record the light sensor on port 3 ten times a second for ten seconds into log.txt.
// Afterwards download log.txt from the Files section.
task main()
{
    byte handle;
    SetSensorLight(S3);
    DeleteFile("log.txt");
    CreateFile("log.txt", 2048, handle);
    int value;
    repeat (100)
    {
        value = SENSOR_3;          // WriteLn wants a plain variable
        WriteLn(handle, value);
        Wait(100);
    }
    CloseFile(handle);
    PlayTone(TONE_C6, MS_200);
}
` },
  { name: 'Two tasks', source: `// A beeper task and a driver task running side by side.
task beeper()
{
    while (true)
    {
        PlayTone(TONE_E5, MS_50);
        Wait(1000);
    }
}

task main()
{
    Precedes(beeper);
    RotateMotor(OUT_A, 75, 720);
    Wait(2000);
    RotateMotor(OUT_A, 75, -720);
}
` },
];
