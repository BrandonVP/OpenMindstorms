/* NQC example programs shown in the Program tab. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
OpenRCX.examples = [
  {
    name: 'Hello: beep and spin',
    source: `// Beeps, runs motor A forward for two seconds, then backward.
task main()
{
    PlaySound(SOUND_UP);
    SetPower(OUT_A, OUT_FULL);
    OnFwd(OUT_A);
    Wait(200);
    OnRev(OUT_A);
    Wait(200);
    Off(OUT_A);
    PlaySound(SOUND_DOUBLE_BEEP);
}
`,
  },
  {
    name: 'Touch sensor bumper',
    source: `// Drive on A and C until the touch sensor on port 1 is pressed,
// then back up, turn, and carry on.  Press Run on the brick again to stop.
task main()
{
    SetSensor(SENSOR_1, SENSOR_TOUCH);
    SetPower(OUT_A + OUT_C, OUT_FULL);
    while (true)
    {
        OnFwd(OUT_A + OUT_C);
        until (SENSOR_1 == 1);
        PlaySound(SOUND_CLICK);
        OnRev(OUT_A + OUT_C);
        Wait(60);
        OnFwd(OUT_A);
        Wait(80);
    }
}
`,
  },
  {
    name: 'Line follower',
    source: `// Follows a dark line with a light sensor on port 2.
// Tune THRESHOLD with the live sensor readout in the Control tab.
#define THRESHOLD 45

task main()
{
    SetSensor(SENSOR_2, SENSOR_LIGHT);
    SetPower(OUT_A + OUT_C, 5);
    while (true)
    {
        if (SENSOR_2 < THRESHOLD)
        {
            OnFwd(OUT_A);
            Off(OUT_C);
        }
        else
        {
            OnFwd(OUT_C);
            Off(OUT_A);
        }
    }
}
`,
  },
  {
    name: 'Datalog a light sensor',
    source: `// Samples the light sensor on port 1 ten times a second for 20 seconds.
// Afterwards open the Datalog tab and press Upload.
task main()
{
    SetSensor(SENSOR_1, SENSOR_LIGHT);
    CreateDatalog(200);
    repeat (200)
    {
        AddToDatalog(SENSOR_1);
        Wait(10);
    }
    PlaySound(SOUND_FAST_UP);
}
`,
  },
  {
    name: 'Two tasks and a sub',
    source: `// Shows tasks running in parallel and a subroutine.
sub blink()
{
    PlayTone(880, 10);
    Wait(20);
}

task watcher()
{
    SetSensor(SENSOR_3, SENSOR_TOUCH);
    while (true)
    {
        until (SENSOR_3 == 1);
        blink();
        until (SENSOR_3 == 0);
    }
}

task main()
{
    start watcher;
    SetPower(OUT_B, 3);
    OnFwd(OUT_B);
    Wait(500);
    Off(OUT_B);
    stop watcher;
}
`,
  },
];
