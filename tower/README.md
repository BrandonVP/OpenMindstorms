# OpenRCX Tower

This guide, with a drawn schematic and the sketch ready to download, is also on the
site: [www.openmindstorms.com/rcx/tower/](https://www.openmindstorms.com/rcx/tower/).

A replacement for the LEGO infrared tower, built from a Teensy 4.x (or ESP32) you
already have, one 940 nm IR LED and one 38 kHz IR receiver module. The PC sees a
plain USB serial port, so it works with OpenRCX's `rcx` tool, with BricxCC and NQC
on 64-bit Windows, and with anything else that knows how to drive a LEGO *serial*
tower.

## Why

The RCX talks over IR at 2400 baud, 8 data bits, odd parity, 1 stop bit. A `0` bit
is 417 µs of 38 kHz carrier, a `1` bit is 417 µs of darkness. The LEGO *serial*
tower is just a modulator/demodulator on an RS-232 port. The LEGO *USB* tower
needs a kernel driver that LEGO only ever shipped for 32-bit Windows, which is why
a Windows XP VM has been the usual workaround. This board removes that dependency.

## Parts

| Part | Notes |
| --- | --- |
| Teensy 4.0 or 4.1 | Any board with a hardware UART and PWM works; ESP32/ESP32-S3 is a supported alternate target |
| IR receiver module, 38 kHz | Vishay **TSOP38238** or TSOP4838, or the cheap **VS1838B** found in Arduino kits |
| IR LED, 940 nm | Vishay **TSAL6200** (narrow beam, long range) or TSAL6400 (wider). Any 940 nm LED works at short range |
| NPN transistor | 2N2222, 2N3904, PN2222 or similar |
| Resistors | 1 kΩ (base), 33–47 Ω (LED, 1/4 W) |
| Optional | 100 Ω + 4.7 µF on the receiver's supply pin (per Vishay datasheet) |

## Wiring (Teensy 4.0 default pins)

```
                      +3.3V
                        |
                 ______|______
   TSOP38238    |  OUT GND VS |   (pins left-to-right looking at the dome)
                |___|___|_____|
                    |   |
   Teensy pin 0 <---'   GND                      Teensy pin 0 = Serial1 RX
                                                 (ESP32 default: GPIO 18)

                                 VUSB (+5V)
                                   |
                                 [33-47 Ω]
                                   |
                                 (IR LED 940 nm)  anode up, cathode down
                                   |
   Teensy pin 2 ---[1 kΩ]---B  C --'
                           2N2222                Teensy pin 2 = 38 kHz PWM
                             E                   (ESP32 default: GPIO 17)
                             |
                            GND
```

Pins are `#define`s at the top of the sketch. Mount the LED and the receiver side by
side pointing the same way. Work 5–50 cm from the RCX's IR window and shade both
ends from sunlight and bright incandescent lamps; that is the number-one cause of
failed downloads with the LEGO towers too.

The on-board LED (pin 13) blinks three times at power-up and flashes on IR activity.

## Build and flash

* **Arduino IDE / Teensyduino**: open `OpenRCX_Tower/OpenRCX_Tower.ino`, board
  *Teensy 4.0*, USB Type *Serial*, upload.
* **Visual Micro**: open the folder as an Arduino project, same settings.
* **arduino-cli**:

  ```
  arduino-cli compile --fqbn teensy:avr:teensy40 tower/OpenRCX_Tower
  arduino-cli upload  --fqbn teensy:avr:teensy40 -p COMx tower/OpenRCX_Tower
  ```

  ESP32-S3 with native USB: `--fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc`.

  Note for machines with **Windows Smart App Control** enforced: the Teensy
  toolchain's unsigned `collect2.exe` (the linker) is blocked, so the Teensy build
  compiles but fails to link with "cannot execute collect2.exe". The ESP32 toolchain
  is not affected. Build the Teensy image on a PC without SAC, or allow the toolchain.

## Options at the top of the sketch

| Define | Default | Meaning |
| --- | --- | --- |
| `CARRIER_HZ` | 38000 | IR carrier. The RCX 2.0 brick's receiver is reportedly tuned for 76 kHz but every RCX revision accepts 38 kHz (that is all the serial tower can do); try 76000 only if range is poor |
| `ECHO_MODE` | 0 | 0 swallows the echo of our own LED that the receiver inevitably hears, 1 passes it to the PC like a real serial tower would |
| `TX_BUFFER_SIZE` | 4096 | Host-to-IR buffer. A firmware block packet is ~415 bytes |

## How it works

* **Transmit**: bytes from USB are queued; each is bit-banged as an 11-bit frame
  (start, 8 data, odd parity, stop) with timing referenced to the frame start so
  rounding never accumulates. The 38 kHz carrier itself comes from a hardware PWM
  channel (Teensy `analogWrite`, ESP32 LEDC) which is simply switched on for `0`
  bits and off for `1` bits.
* **Receive**: the receiver module's output is already a clean UART waveform, so it
  goes into a hardware UART set to 2400 8-O-1 and bytes are forwarded to USB.
* **Echo suppression**: every transmitted byte is remembered for 20 ms. Received
  bytes that match the head of that queue are dropped; the first mismatch stops the
  filtering so a genuine RCX reply is never eaten.

## Testing without an RCX

Open the COM port with any terminal at any baud and type: the activity LED should
flash and the IR LED should be visible as a faint purple flicker on a phone camera.
With `ECHO_MODE 1` the characters you type come back to you via the receiver,
which checks the whole optical path.

With `rcx -p COMx ping` against a real RCX you should get an answer within one
retry. `rcx -v ...` prints every packet both ways.
