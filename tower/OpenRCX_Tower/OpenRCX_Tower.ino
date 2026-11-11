/*
 * OpenRCX Tower - a LEGO Mindstorms RCX infrared tower on a Teensy 4.x or ESP32.
 *
 * The board shows up as a USB serial port.  Every byte the PC writes is sent
 * over infrared exactly the way the LEGO towers do it:
 *
 *   2400 baud, 1 start bit, 8 data bits (LSB first), ODD parity, 1 stop bit.
 *   A "0" bit is 417 us of 38 kHz carrier, a "1" bit is 417 us of darkness.
 *
 * Bytes the RCX sends back are demodulated by a 38 kHz IR receiver module
 * (TSOP38238 / TSOP4838 / VS1838B).  Its open-collector output idles high and
 * goes low while carrier is present, which is precisely a UART signal, so it is
 * wired straight into a hardware UART RX pin configured 2400 8-O-1.
 *
 * Any software that knows how to drive a LEGO *serial* tower on a COM port
 * (OpenRCX's python tool, NQC, BricxCC, WebPBrick, firmdl3, ...) works with it.
 *
 * ---------------------------------------------------------------------------
 *  Wiring (Teensy 4.0 defaults, change the #defines for other pins/boards)
 * ---------------------------------------------------------------------------
 *
 *   IR receiver (TSOP38238: pins OUT, GND, VS looking at the lens, left->right)
 *     OUT -> IR_RX_PIN (Teensy pin 0 = RX1)
 *     GND -> GND
 *     VS  -> 3.3V            (100 ohm + 4.7 uF decoupling recommended)
 *
 *   IR transmitter (940 nm LED, e.g. TSAL6200 or TSAL6400)
 *     IR_TX_PIN -> 1 kohm -> base of 2N2222 / 2N3904 (NPN)
 *     emitter -> GND
 *     collector -> LED cathode;  LED anode -> 33..47 ohm -> VUSB (5V)
 *     (~100 mA peak at 50% carrier duty; the LED is off between packets)
 *
 *   Teensy pin 13 (on-board LED) blinks on activity.
 *
 *   Point the LED and the receiver in the same direction, 5..50 cm from the
 *   RCX's IR window.  Shade both ends from sunlight and bright incandescents.
 *
 * ---------------------------------------------------------------------------
 *  Echo
 * ---------------------------------------------------------------------------
 *  A real serial tower's receiver hears its own LED, so the PC sees every
 *  byte it sent come back before the RCX reply.  Host software copes with
 *  that but does not need it, so by default this firmware swallows the echo
 *  (ECHO_MODE 0).  Set ECHO_MODE 1 to behave exactly like the LEGO tower.
 *
 * Board support: Teensy 4.0 / 4.1 (tested build), ESP32 / ESP32-S3 with
 * Arduino-ESP32 3.x (build target; set the pins for your module).
 */

#include <Arduino.h>

// ------------------------------- configuration ------------------------------
#if defined(__IMXRT1062__)                // Teensy 4.0 / 4.1
  #define IR_RX_PIN        0              // Serial1 RX  <- TSOP OUT
  #define IR_TX_PIN        2              // PWM capable -> transistor base
  #define ACT_LED_PIN      13
  #define IR_UART          Serial1
  #define HOST_SERIAL      Serial
#elif defined(ESP32)
  #define IR_RX_PIN        18             // any GPIO (HardwareSerial pin mux)
  #define IR_TX_PIN        17             // any GPIO (LEDC)
  #define ACT_LED_PIN      -1             // set to your module's LED, or -1
  #define IR_UART          Serial1
  #define HOST_SERIAL      Serial
#else
  #error "OpenRCX Tower supports Teensy 4.x and ESP32 boards"
#endif

#define CARRIER_HZ       38000            // RCX receivers listen at 38 kHz
#define BAUD             2400
#define ECHO_MODE        0                // 0 = suppress our own echo, 1 = pass it on
#define TX_BUFFER_SIZE   4096             // a firmware block packet is ~415 bytes
#define ECHO_WINDOW_US   20000            // how long to remember a sent byte for echo matching
#define ACT_FLASH_MS     40

static const uint32_t BIT_US = 1000000UL / BAUD;   // 416 us (rounded; drift-corrected per frame)

// ------------------------------- ring buffer --------------------------------
struct Ring {
  uint8_t  buf[TX_BUFFER_SIZE];
  volatile uint16_t head = 0, tail = 0;
  bool     empty() const { return head == tail; }
  uint16_t count() const { return (uint16_t)((head - tail) & (TX_BUFFER_SIZE - 1)); }
  bool     push(uint8_t b) {
    uint16_t n = (head + 1) & (TX_BUFFER_SIZE - 1);
    if (n == tail) return false;
    buf[head] = b; head = n; return true;
  }
  uint8_t  pop() { uint8_t b = buf[tail]; tail = (tail + 1) & (TX_BUFFER_SIZE - 1); return b; }
};

static Ring txRing;        // PC -> IR
static Ring echoRing;      // bytes we transmitted, awaiting their echo
static uint32_t echoDeadline = 0;
static uint32_t actLedOff = 0;

// ------------------------------- carrier ------------------------------------
static inline void carrierOn()  {
#if defined(__IMXRT1062__)
  analogWrite(IR_TX_PIN, 128);            // 50 % duty 38 kHz
#else
  ledcWrite(IR_TX_PIN, 128);
#endif
}
static inline void carrierOff() {
#if defined(__IMXRT1062__)
  analogWrite(IR_TX_PIN, 0);
#else
  ledcWrite(IR_TX_PIN, 0);
#endif
}

static void carrierInit() {
#if defined(__IMXRT1062__)
  pinMode(IR_TX_PIN, OUTPUT);
  analogWriteResolution(8);
  analogWriteFrequency(IR_TX_PIN, CARRIER_HZ);
  analogWrite(IR_TX_PIN, 0);
#else
  ledcAttach(IR_TX_PIN, CARRIER_HZ, 8);
  ledcWrite(IR_TX_PIN, 0);
#endif
}

// ------------------------------- activity LED -------------------------------
static inline void flash() {
#if ACT_LED_PIN >= 0
  digitalWrite(ACT_LED_PIN, HIGH);
  actLedOff = millis() + ACT_FLASH_MS;
#endif
}
static inline void serviceLed() {
#if ACT_LED_PIN >= 0
  if (actLedOff && (int32_t)(millis() - actLedOff) >= 0) {
    digitalWrite(ACT_LED_PIN, LOW);
    actLedOff = 0;
  }
#endif
}

// ------------------------------- IR transmit --------------------------------
// Build the 11-bit frame: start(0), d0..d7, odd parity, stop(1).  Bit value 0
// means "carrier on".  Timing is kept against the frame start so per-bit
// rounding does not accumulate.
static void irSendByte(uint8_t b) {
  uint16_t frame = 0;
  uint8_t ones = 0;
  for (uint8_t i = 0; i < 8; i++) if (b & (1 << i)) ones++;
  uint8_t parity = (ones & 1) ? 0 : 1;          // odd parity: total ones must be odd
  frame = (uint16_t)b << 1;                     // bit0 = start (0), bits1..8 = data
  frame |= (uint16_t)parity << 9;
  frame |= (uint16_t)1 << 10;                   // stop bit

  uint32_t t0 = micros();
  for (uint8_t i = 0; i < 11; i++) {
    if (frame & (1 << i)) carrierOff(); else carrierOn();
    uint32_t edge = t0 + ((uint32_t)(i + 1) * 1000000UL) / BAUD;
    while ((int32_t)(micros() - edge) < 0) { /* spin */ }
  }
  carrierOff();
}

static void pumpHostToRing() {
  while (HOST_SERIAL.available() > 0) {
    int c = HOST_SERIAL.read();
    if (c < 0) break;
    if (!txRing.push((uint8_t)c)) break;        // full: leave it in the USB buffer
  }
}

// ------------------------------- IR receive ---------------------------------
static void pumpIrToHost() {
  while (IR_UART.available() > 0) {
    int c = IR_UART.read();
    if (c < 0) break;
#if ECHO_MODE == 0
    // Is this the echo of something we just sent?
    if (!echoRing.empty()) {
      if ((int32_t)(micros() - echoDeadline) > 0) {
        // echo window expired: forget the pending bytes
        echoRing.tail = echoRing.head;
      } else if (echoRing.buf[echoRing.tail] == (uint8_t)c) {
        echoRing.pop();
        continue;                               // swallowed
      } else {
        // mismatch: our echo was lost or garbled; stop filtering this packet
        echoRing.tail = echoRing.head;
      }
    }
#endif
    HOST_SERIAL.write((uint8_t)c);
    flash();
  }
}

// ------------------------------- setup / loop -------------------------------
void setup() {
#if ACT_LED_PIN >= 0
  pinMode(ACT_LED_PIN, OUTPUT);
  digitalWrite(ACT_LED_PIN, LOW);
#endif
  carrierInit();

#if defined(__IMXRT1062__)
  IR_UART.begin(BAUD, SERIAL_8O1);
#else
  IR_UART.begin(BAUD, SERIAL_8O1, IR_RX_PIN, -1);
#endif
  HOST_SERIAL.begin(115200);                    // baud is ignored on USB CDC

  // three quick blinks: alive
#if ACT_LED_PIN >= 0
  for (int i = 0; i < 3; i++) {
    digitalWrite(ACT_LED_PIN, HIGH); delay(60);
    digitalWrite(ACT_LED_PIN, LOW);  delay(90);
  }
#endif
}

void loop() {
  pumpHostToRing();
  pumpIrToHost();

  if (!txRing.empty()) {
    uint8_t b = txRing.pop();
    flash();
#if ECHO_MODE == 0
    echoRing.push(b);
    echoDeadline = micros() + ECHO_WINDOW_US;
#endif
    irSendByte(b);
    // Keep the USB side drained between bytes so long packets never stall.
    pumpHostToRing();
  }

  if (txRing.empty()) {
    HOST_SERIAL.flush();                        // push any pending RX bytes to the PC
  }
  serviceLed();
}
