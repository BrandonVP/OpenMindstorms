/* EVC example programs for the OpenEV3 Program section. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
OpenEV3.evcExamples = [
  { name: 'Hello: say hi and drive', source: `// Shows a message, plays a note, drives motors B and C one turn forward and back.
task main()
{
    TextOut(0, LCD_LINE1, "OpenEV3 says hi");
    SetLED(LED_ORANGE_PULSE);
    PlayTone(TONE_C5, 300);
    Wait(400);
    RotateMotorEx(OUT_BC, 50, 360, 0, true, true);    // both motors, one turn, straight
    Wait(500);
    RotateMotorEx(OUT_BC, 50, -360, 0, true, true);
    PlayTone(TONE_G5, 500);
    SetLED(LED_GREEN);
}
` },
  { name: 'Bumper car (touch sensor)', source: `// Drive until the touch sensor on port 1 is pressed, back up, turn, repeat.
task main()
{
    while (true)
    {
        OnFwdSync(OUT_BC, 50, 0);
        until (SensorTouch(S1));
        PlayTone(TONE_A4, 100);
        OnRevSync(OUT_BC, 40, 0);
        Wait(600);
        RotateMotorEx(OUT_BC, 40, 400, 100, true, true);   // spin right
    }
}
` },
  { name: 'Wall avoider (ultrasonic)', source: `// Turn away when something is closer than 25 cm on port 4; show the distance.
task main()
{
    while (true)
    {
        int cm = SensorUS(S4);
        NumOut(0, LCD_LINE1, cm);
        if (cm < 25)
        {
            OnRevSync(OUT_BC, 40, 0);
            Wait(400);
            RotateMotorEx(OUT_BC, 40, 300, 100, true, true);
        }
        else
        {
            OnFwdSync(OUT_BC, 50, 0);
        }
        Wait(50);
    }
}
` },
  { name: 'Line follower (colour sensor)', source: `// Follow the edge of a black line with the colour sensor on port 3.
#define THRESHOLD 40
#define SPEED 30

task main()
{
    while (true)
    {
        if (SensorLight(S3) < THRESHOLD)
            OnFwdSync(OUT_BC, SPEED, -30);    // on the line: steer left
        else
            OnFwdSync(OUT_BC, SPEED, 30);     // off the line: steer right
        Wait(10);
    }
}
` },
  { name: 'Count presses (variables and loops)', source: `// Count ten presses of the touch sensor, beeping and showing the count.
task main()
{
    int count = 0;
    repeat (10)
    {
        until (SensorTouch(S1));
        until (!SensorTouch(S1));
        count++;
        NumOut(0, LCD_LINE2, count);
        PlayTone(TONE_E5, 50);
    }
    TextOut(0, LCD_LINE4, "Done!");
}
` },
  { name: 'Gyro turn with a function', source: `// Turn by a number of degrees using the gyro sensor on port 2. Upload and run from the brick.
void turnTo(int target)
{
    ResetGyro(S2);
    if (target > 0) OnFwdSync(OUT_BC, 30, 100);    // spin right
    else OnFwdSync(OUT_BC, 30, -100);              // spin left
    until (abs(SensorGyro(S2)) >= abs(target));
    Off(OUT_BC);
}

task main()
{
    turnTo(90);
    Wait(500);
    turnTo(-90);
    NumOut(0, LCD_LINE1, SensorGyro(S2));
}
` },
  { name: 'Two tasks: drive and blink', source: `// Tasks run at the same time as VM threads. Needs Upload, then Run uploaded ("Run now" runs main only).
task blink()
{
    repeat (6)
    {
        SetLED(LED_RED);
        Wait(500);
        SetLED(LED_GREEN);
        Wait(500);
    }
}

task main()
{
    start blink;
    RotateMotor(OUT_A, 50, 3 * 360);
    RotateMotor(OUT_A, 50, -3 * 360);
    stop blink;
    SetLED(LED_GREEN);
}
` },
  { name: 'Data log to a file', source: `// Log the ultrasonic distance ten times a second for five seconds into ../prjs/distance.rtf.
// Afterwards open the Files view, go to prjs, and download distance.rtf.
task main()
{
    LogOpen("../prjs/distance.rtf");
    int i;
    for (i = 0; i < 50; i++)
    {
        int cm = SensorUS(S4);
        NumOut(0, LCD_LINE1, cm);
        LogWriteLine(NumToStr(i) + "," + NumToStr(cm));
        Wait(100);
    }
    LogClose();
    TextOut(0, LCD_LINE3, "Saved distance.rtf");
}
` },
  { name: 'Dashboard: battery, buttons and maths', source: `// Shows a few values and reacts to the brick buttons until Back is pressed.
task main()
{
    float v = BatteryLevel();
    TextOut(0, LCD_LINE1, "Battery (V):");
    NumOut(90, LCD_LINE1, v, 2);
    NumOut(0, LCD_LINE2, sqrt(2), 3);
    NumOut(0, LCD_LINE3, sin(30), 2);
    int n = 0;
    while (!ButtonPressed(BTN_BACK))
    {
        if (ButtonPressed(BTN_UP)) n++;
        if (ButtonPressed(BTN_DOWN)) n--;
        NumOut(0, LCD_LINE5, n);
        NumOut(0, LCD_LINE6, Random(100));
        Wait(150);
    }
    TextOut(0, LCD_LINE8, "Bye");
}
` },
];
