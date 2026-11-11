# RCX IR protocol notes

Condensed from Kekoa Proudfoot's *RCX Internals* / opcode reference
(mralligator.com/rcx), LEGO's *RCX 2.0 Firmware Byte Codes Reference* (PDF in this
folder) and the NQC `rcxlib` sources.

## Physical layer

* 2400 baud, 1 start bit, 8 data bits (LSB first), **odd** parity, 1 stop bit.
* Bit `0` = 417 µs of 38 kHz carrier, bit `1` = 417 µs of no light.
* The LEGO serial tower echoes everything it transmits (its receiver hears its LED).
  The LEGO USB tower does not echo and strips the leading `0x55` of received packets.
* The receive state machine inside the RCX resets after ~30 ms of silence.
* Strong ambient light (sun, incandescent) is the usual cause of failed transfers.

## Packet

```
55 FF 00   D1 ~D1   D2 ~D2 ... Dn ~Dn   C ~C
```

* `D1` opcode, `D2..Dn` arguments, `C = (D1 + ... + Dn) mod 256`.
* Every byte is followed by its complement.
* Reply = same framing, opcode is `~D1`, followed by the reply payload.
* **Toggle bit**: the RCX will not execute two consecutive commands with the identical
  opcode byte (it re-sends the previous reply instead). Hosts alternate bit 3 (`0x08`)
  of the opcode. Reply opcodes are matched with `& 0xF7`.
* Multi-byte arguments are little-endian. Replies: `GetVersions` and `GetMemoryMap`
  are big-endian, `GetValue`/`GetBattery` little-endian.

## Direct commands used by OpenRCX

| Op | Name | Args | Reply payload |
| --- | --- | --- | --- |
| 10 | Alive | - | - |
| 12 | GetValue | source, index | int16 |
| 13 | SetMotorPower | motors, source(2), value 0-7 | - |
| 14 | SetVariable | index, source(2), int16 | - |
| 15 | GetVersions | 01 03 05 07 0B | rom u32 BE, firmware u32 BE |
| 20 | GetMemoryMap | - | 94 × u16 BE |
| 21 | SetMotorOnOff | bits 0-2 motors, 0x80 on, 0x40 off, neither = float | - |
| 22 | SetTime | hours, minutes | - |
| 23 | PlayTone | freq u16, duration (1/100 s) | - |
| 25 / 35 | BeginTask / BeginSub | 0, number, 0, length u16 | status (0 ok, 1 memory, 2 index) |
| 30 | GetBattery | - | millivolts u16 |
| 31 | SetTxRange | 0 short / 1 long | - |
| 32 | SetSensorType | sensor, type | - |
| 33 | SetDisplay | source(2), value u16 | - |
| 40 / 70 | DeleteAllTasks / DeleteAllSubs | - | - |
| 42 | SetSensorMode | sensor, (mode<<5)\|slope | - |
| 45 | TransferData | seq u16, length u16, data..., sum8(data) | status (0 ok, 3 block checksum, 4 image checksum, 6 not started) |
| 50 | StopAllTasks | - | - |
| 51 | PlaySound | 0-5 | - |
| 52 | SetDatalogSize | size u16 | status |
| 60 | PowerOff | - | - |
| 61 / C1 | DeleteTask / DeleteSub | number | - |
| 65 | DeleteFirmware | 01 03 05 07 0B | - |
| 71 / 81 | StartTask / StopTask | task | - |
| 75 | BeginFirmware | start u16, checksum u16, 0 | status |
| 91 | SetProgram | 0-4 | - |
| A1 | ClearTimer | timer | - |
| A4 | UploadDatalog | first u16, count u16 | count × (type, int16) |
| A5 | UnlockFirmware | "LEGO" AE | "Just a bit off the block!" |
| B1 | SetPowerDownDelay | minutes (0 = never) | - |
| D1 | ClearSensor | sensor | - |
| E1 | SetMotorDir | bits, 0x80 fwd, 0x40 flip, neither = rev | - |
| F7 | SetMessage | value | *no reply* |

GetValue sources: 0 variable, 1 timer, 3 motor status, 8 program, 9 sensor value,
10 sensor type, 11 sensor mode, 12 raw, 13 boolean, 14 clock (minutes), 15 message.

Motor status byte (source 3): bits 0-2 power, **bit 3 set = forward** (measured on a
real RCX 2.0: `SetMotorDir fwd` gives 0x4F, `rev` 0x47, `float` 0x0F), 0x40 off, 0x80 on,
neither = float.

Firmware version word: firm0328.lgo reports `00030208` on real hardware, not 0x0328.

**Without firmware** (observed on a real RCX 2.0, ROM 3.01): the ROM answers Alive,
GetVersions, DeleteFirmware, BeginFirmware, TransferData and UnlockFirmware. Any other
opcode, GetBattery and PlaySound included, makes it re-send its *previous* reply, so a
host must check GetVersions before asking for anything else.

**Windows USB-serial adapters**: never reconfigure the port (timeout, baud, parity,
RTS/DTR) while a reply may be arriving. pyserial's timeout setter reissues
SetCommState and a Prolific PL2303 then garbles the bytes in flight; the symptom is a
clean `55 FF 00 ~op` header followed by junk.

## Firmware download (ROM in charge)

1. `Alive`
2. `DeleteFirmware 01 03 05 07 0B`
3. `BeginFirmware start=0x8000, checksum = sum of the first 0x4C00 image bytes mod 65536, 0`
4. `TransferData` in 200-byte blocks, sequence 1, 2, 3 ... and **0 for the last block**
5. `UnlockFirmware "LEGO®"` (no retry, long timeout) → `"Just a bit off the block!"`, the
   brick boots the firmware and plays its start-up sound.

The `.lgo` files are Motorola S-records; gaps are zero-filled. firm0309.lgo yields the
checksum 0xC278 quoted in Kekoa's notes, which is a handy self-test.

## Program download (firmware in charge)

1. `Alive`, `StopAllTasks`, `SetProgram n`, `DeleteAllTasks`, `DeleteAllSubs`
2. For each chunk of the `.rcx` image: `BeginTask`/`BeginSub (0, number, 0, length)`,
   then `TransferData` in 20-byte blocks (last block sequence 0)
3. `PlaySound 5` as the "done" chirp (what NQC does)

## NQC `.rcx` image file (RCXI 1.02)

Little-endian. Header: `"RCXI"`, version u16, chunk count u16, symbol count u16,
target u8, reserved u8. Chunk: type u8 (0 task, 1 sub), number u8, length u16, data
padded to 4 bytes. Symbol: type u8 (0 task, 1 sub, 2 var), index u8, length u8
(including NUL), reserved u8, name.
