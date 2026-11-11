/* OpenEV3 - EV3-G style blocks compiled to lms2012 bytecode in the browser.
 * Palette follows EV3-G: Action (Move Steering, Move Tank, Large/Medium Motor,
 * Display, Sound, Brick Status Light), Flow (Start, Wait, Loop, Switch, Loop
 * Interrupt, Stop), Sensor (touch, colour, ultrasonic, gyro, infrared, motor
 * rotation, timer, brick buttons, battery, NXT sensors), Data (variables, math,
 * compare, range, logic, random), Advanced (keep awake, reset motor, comment).
 * The generator produces a main thread (for "Run now" as a direct command and for
 * the .rbf), plus one VM thread per parallel "sequence beam". */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  if (typeof Blockly === 'undefined') { ns.blocks = null; return; }
  const P = ns.protocol, A = ns.asm;
  const { LC, LC0, LC1, LC2, LC4, LCF, LCS, GV } = P;

  const C = { flow: '#e8871e', action: '#3f9a3f', sensor: '#d4a017', data: '#c0392b', advanced: '#2f7ed8', my: '#7a5230', vars: '#c2185b' };
  const MOTOR = [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']];
  const PAIRS = [['B + C', 'BC'], ['A + B', 'AB'], ['A + D', 'AD'], ['C + D', 'CD'], ['A + C', 'AC'], ['B + D', 'BD']];
  const PORTS = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']];
  const MODES = [['on', 'ON'], ['off', 'OFF'], ['on for seconds', 'SECONDS'], ['on for degrees', 'DEGREES'], ['on for rotations', 'ROTATIONS']];
  const THEN = [['brake', 'BRAKE'], ['coast', 'COAST']];
  const COLORS = [['no colour', '0'], ['black', '1'], ['blue', '2'], ['green', '3'], ['yellow', '4'], ['red', '5'], ['white', '6'], ['brown', '7']];
  const NOTES = [['C4', 262], ['D4', 294], ['E4', 330], ['F4', 349], ['G4', 392], ['A4', 440], ['B4', 494], ['C5', 523], ['D5', 587], ['E5', 659], ['F5', 698], ['G5', 784], ['A5', 880], ['B5', 988], ['C6', 1047]].map(([n, f]) => [n, String(f)]);
  const BTNS = [['centre', '2'], ['up', '1'], ['down', '3'], ['left', '5'], ['right', '4'], ['back', '6'], ['any', '7']];
  const LEDS = [['green', '1'], ['orange', '3'], ['red', '2'], ['green pulse', '7'], ['orange pulse', '9'], ['red pulse', '8'], ['green flash', '4'], ['orange flash', '6'], ['red flash', '5'], ['off', '0']];
  const CMP = [['<', 'LT'], ['>', 'GT'], ['=', 'EQ'], ['≠', 'NEQ'], ['≤', 'LTEQ'], ['≥', 'GTEQ']];
  const num = (name, v) => ({ type: 'input_value', name, check: 'Number' });
  const shadowNum = v => ({ shadow: { type: 'math_number', fields: { NUM: v } } });

  Blockly.defineBlocksWithJsonArray([
    { type: 'ev3_program', message0: 'when program starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.flow, hat: 'cap', tooltip: 'The main sequence beam.' },
    { type: 'ev3_parallel', message0: 'also run at the same time %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.flow, hat: 'cap', tooltip: 'A second sequence beam, run as a VM thread. Needs Upload (not "Run now").' },
    { type: 'ev3_my_block', message0: 'my block %1 %2 %3', args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.my, hat: 'cap', tooltip: 'Reusable blocks; "run my block" copies them in.' },
    { type: 'ev3_call_my_block', message0: 'run my block %1', args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }], previousStatement: null, nextStatement: null, colour: C.my },

    // ---- action
    { type: 'ev3_move_steering', message0: 'move steering %1 %2 steering %3 power %4 for %5 then %6',
      args0: [{ type: 'field_dropdown', name: 'PORTS', options: PAIRS }, { type: 'field_dropdown', name: 'MODE', options: MODES }, num('STEER'), num('POWER'), num('AMOUNT'), { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true, tooltip: 'EV3-G Move Steering: two motors in sync. Steering -100 (spin left) … 0 … 100 (spin right).' },
    { type: 'ev3_move_tank', message0: 'move tank %1 %2 left power %3 right power %4 for %5 then %6',
      args0: [{ type: 'field_dropdown', name: 'PORTS', options: PAIRS }, { type: 'field_dropdown', name: 'MODE', options: MODES }, { type: 'field_number', name: 'LEFT', value: 50, min: -100, max: 100, precision: 1 }, { type: 'field_number', name: 'RIGHT', value: 50, min: -100, max: 100, precision: 1 }, num('AMOUNT'), { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true, tooltip: 'EV3-G Move Tank: each wheel its own power.' },
    { type: 'ev3_motor', message0: 'motor %1 %2 power %3 for %4 then %5',
      args0: [{ type: 'field_dropdown', name: 'PORT', options: MOTOR }, { type: 'field_dropdown', name: 'MODE', options: MODES }, num('POWER'), num('AMOUNT'), { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true, tooltip: 'EV3-G Large / Medium Motor block.' },
    { type: 'ev3_motor_stop', message0: 'stop motors %1 %2', args0: [{ type: 'field_dropdown', name: 'PORTS', options: MOTOR.concat(PAIRS).concat([['all', 'ABCD']]) }, { type: 'field_dropdown', name: 'THEN', options: THEN }], previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'ev3_display_text', message0: 'display text %1 on line %2 %3', args0: [{ type: 'field_input', name: 'TEXT', text: 'Hello' }, { type: 'field_dropdown', name: 'LINE', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), String(n)]) }, { type: 'field_dropdown', name: 'FONT', options: [['normal', '1'], ['small', '0'], ['large', '2']] }], previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'ev3_display_value', message0: 'display value %1 on line %2 with %3 decimals', args0: [num('VAL'), { type: 'field_dropdown', name: 'LINE', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), String(n)]) }, { type: 'field_dropdown', name: 'DEC', options: [['0', '0'], ['1', '1'], ['2', '2']] }], previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true },
    { type: 'ev3_display_clear', message0: 'clear the display', previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'ev3_display_image', message0: 'display picture %1', args0: [{ type: 'field_input', name: 'FILE', text: '../apps/Brick Program/Smile' }], previousStatement: null, nextStatement: null, colour: C.action, tooltip: 'An .rgf picture on the brick, path without extension.' },
    { type: 'ev3_display_shape', message0: 'draw %1 at x %2 y %3 size %4', args0: [{ type: 'field_dropdown', name: 'SHAPE', options: [['circle', 'CIRCLE'], ['filled circle', 'FILLCIRCLE'], ['square', 'RECT'], ['filled square', 'FILLRECT'], ['pixel', 'PIXEL']] }, num('X'), num('Y'), num('SIZE')], previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true, tooltip: 'The screen is 178 x 128 pixels.' },
    { type: 'ev3_tone', message0: 'play tone %1 Hz for %2 seconds volume %3 %4', args0: [num('HZ'), num('SECS'), num('VOL'), { type: 'field_dropdown', name: 'WAIT', options: [['and wait', 'WAIT'], ['and carry on', 'GO']] }], previousStatement: null, nextStatement: null, colour: C.action, inputsInline: true },
    { type: 'ev3_note', message0: 'play note %1 for %2 seconds %3', args0: [{ type: 'field_dropdown', name: 'NOTE', options: NOTES }, { type: 'field_number', name: 'SECS', value: 0.5, min: 0.01, precision: 0.01 }, { type: 'field_dropdown', name: 'WAIT', options: [['and wait', 'WAIT'], ['and carry on', 'GO']] }], previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'ev3_sound_file', message0: 'play sound file %1 volume %2 %3', args0: [{ type: 'field_input', name: 'FILE', text: '../prjs/BrkProg_SAVE/Hello' }, { type: 'field_number', name: 'VOL', value: 50, min: 0, max: 100, precision: 1 }, { type: 'field_dropdown', name: 'WAIT', options: [['and wait', 'WAIT'], ['and carry on', 'GO'], ['repeat', 'REPEAT']] }], previousStatement: null, nextStatement: null, colour: C.action, tooltip: 'An .rsf sound on the brick, path without extension.' },
    { type: 'ev3_sound_stop', message0: 'stop all sounds', previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'ev3_led', message0: 'brick status light %1', args0: [{ type: 'field_dropdown', name: 'PATTERN', options: LEDS }], previousStatement: null, nextStatement: null, colour: C.action },

    // ---- flow
    { type: 'ev3_wait', message0: 'wait %1 seconds', args0: [num('SECS')], previousStatement: null, nextStatement: null, colour: C.flow, inputsInline: true },
    { type: 'ev3_wait_until', message0: 'wait until %1', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_wait_touch', message0: 'wait for touch sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'STATE', options: [['pressed', 'PRESSED'], ['released', 'RELEASED'], ['bumped', 'BUMPED']] }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_wait_button', message0: 'wait for brick button %1 %2', args0: [{ type: 'field_dropdown', name: 'BTN', options: BTNS }, { type: 'field_dropdown', name: 'STATE', options: [['pressed', 'PRESSED'], ['released', 'RELEASED'], ['bumped', 'BUMPED']] }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_loop_forever', message0: 'loop forever %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_loop_count', message0: 'loop %1 times %2 %3', args0: [num('N'), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow, inputsInline: true },
    { type: 'ev3_loop_while', message0: 'loop %1 %2 %3 %4', args0: [{ type: 'field_dropdown', name: 'MODE', options: [['while', 'WHILE'], ['until', 'UNTIL']] }, { type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_loop_seconds', message0: 'loop for %1 seconds %2 %3', args0: [num('SECS'), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow, inputsInline: true },
    { type: 'ev3_break', message0: 'leave the loop', previousStatement: null, colour: C.flow, tooltip: 'EV3-G Loop Interrupt.' },
    { type: 'ev3_switch', message0: 'switch: if %1 %2 %3 else %4 %5', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_if', message0: 'if %1 %2 %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'ev3_stop', message0: 'stop program', previousStatement: null, colour: C.flow },

    // ---- sensors
    { type: 'ev3_touch', message0: 'touch sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'STATE', options: [['pressed', 'PRESSED'], ['released', 'RELEASED']] }], output: 'Boolean', colour: C.sensor },
    { type: 'ev3_color_sees', message0: 'colour sensor %1 sees %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'COLOR', options: COLORS }], output: 'Boolean', colour: C.sensor },
    { type: 'ev3_color_value', message0: 'colour sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'MODE', options: [['reflected light %', '0'], ['ambient light %', '1'], ['colour number', '2']] }], output: 'Number', colour: C.sensor, tooltip: 'Colour numbers: 0 none, 1 black, 2 blue, 3 green, 4 yellow, 5 red, 6 white, 7 brown.' },
    { type: 'ev3_ultrasonic', message0: 'ultrasonic sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'MODE', options: [['distance cm', '0'], ['distance inches', '1']] }], output: 'Number', colour: C.sensor },
    { type: 'ev3_gyro', message0: 'gyro sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'MODE', options: [['angle °', '0'], ['rate °/s', '1']] }], output: 'Number', colour: C.sensor },
    { type: 'ev3_gyro_reset', message0: 'reset gyro sensor %1', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }], previousStatement: null, nextStatement: null, colour: C.sensor, tooltip: 'Zero the angle (keep the brick still).' },
    { type: 'ev3_infrared', message0: 'infrared sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'MODE', options: [['proximity %', 'PROX'], ['beacon heading (ch 1)', 'HEAD'], ['beacon distance (ch 1)', 'DIST'], ['remote button (ch 1)', 'REMOTE']] }], output: 'Number', colour: C.sensor, tooltip: 'Remote buttons: 1 top-left, 2 bottom-left, 3 top-right, 4 bottom-right, 9 beacon.' },
    { type: 'ev3_motor_rotation', message0: 'motor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: MOTOR }, { type: 'field_dropdown', name: 'MODE', options: [['degrees turned', 'DEG'], ['rotations turned', 'ROT'], ['current power', 'POWER']] }], output: 'Number', colour: C.sensor },
    { type: 'ev3_motor_reset', message0: 'reset motor %1 rotation', args0: [{ type: 'field_dropdown', name: 'PORT', options: MOTOR }], previousStatement: null, nextStatement: null, colour: C.sensor },
    { type: 'ev3_timer', message0: 'timer %1 seconds', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] }], output: 'Number', colour: C.sensor },
    { type: 'ev3_timer_reset', message0: 'reset timer %1', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] }], previousStatement: null, nextStatement: null, colour: C.sensor },
    { type: 'ev3_button', message0: 'brick button %1 pressed', args0: [{ type: 'field_dropdown', name: 'BTN', options: BTNS }], output: 'Boolean', colour: C.sensor },
    { type: 'ev3_battery', message0: 'battery %1', args0: [{ type: 'field_dropdown', name: 'MODE', options: [['volts', 'V'], ['percent', 'PCT']] }], output: 'Number', colour: C.sensor },
    { type: 'ev3_nxt_sensor', message0: 'NXT %1 sensor %2', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['touch (0/1)', 'TOUCH'], ['light %', 'LIGHT'], ['sound %', 'SOUND'], ['ultrasonic cm', 'US']] }, { type: 'field_dropdown', name: 'PORT', options: PORTS }], output: 'Number', colour: C.sensor },

    // ---- data
    { type: 'ev3_compare', message0: '%1 %2 %3', args0: [num('A'), { type: 'field_dropdown', name: 'OP', options: CMP }, num('B')], output: 'Boolean', colour: C.data, inputsInline: true },
    { type: 'ev3_range', message0: '%1 %2 %3 and %4', args0: [num('V'), { type: 'field_dropdown', name: 'MODE', options: [['is between', 'IN'], ['is outside', 'OUT']] }, num('A'), num('B')], output: 'Boolean', colour: C.data, inputsInline: true },
    { type: 'ev3_random', message0: 'random number from %1 to %2', args0: [num('A'), num('B')], output: 'Number', colour: C.data, inputsInline: true },
    { type: 'ev3_math_op', message0: '%1 %2', args0: [{ type: 'field_dropdown', name: 'OP', options: [['absolute', '6'], ['negative', '7'], ['square root', '8'], ['round', '5'], ['floor', '3'], ['ceiling', '4'], ['sin', '11'], ['cos', '12'], ['tan', '13']] }, num('V')], output: 'Number', colour: C.data, inputsInline: true },
    { type: 'ev3_modulo', message0: '%1 modulo %2', args0: [num('A'), num('B')], output: 'Number', colour: C.data, inputsInline: true },
    { type: 'ev3_keep_awake', message0: 'keep the brick awake', previousStatement: null, nextStatement: null, colour: C.advanced },
    { type: 'ev3_comment', message0: '# %1', args0: [{ type: 'field_input', name: 'TEXT', text: 'comment' }], previousStatement: null, nextStatement: null, colour: C.advanced, tooltip: 'Notes for yourself; generates nothing.' },
  ]);

  const toolbox = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: 'Program', colour: C.flow, contents: [{ kind: 'block', type: 'ev3_program' }, { kind: 'block', type: 'ev3_parallel' }] },
    { kind: 'category', name: 'Action', colour: C.action, contents: [
      { kind: 'block', type: 'ev3_move_steering', inputs: { STEER: shadowNum(0), POWER: shadowNum(50), AMOUNT: shadowNum(1) } },
      { kind: 'block', type: 'ev3_move_tank', inputs: { AMOUNT: shadowNum(1) } },
      { kind: 'block', type: 'ev3_motor', inputs: { POWER: shadowNum(50), AMOUNT: shadowNum(1) } },
      { kind: 'block', type: 'ev3_motor_stop' },
      { kind: 'block', type: 'ev3_display_text' }, { kind: 'block', type: 'ev3_display_value', inputs: { VAL: shadowNum(0) } }, { kind: 'block', type: 'ev3_display_clear' },
      { kind: 'block', type: 'ev3_display_image' }, { kind: 'block', type: 'ev3_display_shape', inputs: { X: shadowNum(89), Y: shadowNum(64), SIZE: shadowNum(20) } },
      { kind: 'block', type: 'ev3_note' }, { kind: 'block', type: 'ev3_tone', inputs: { HZ: shadowNum(440), SECS: shadowNum(0.5), VOL: shadowNum(50) } },
      { kind: 'block', type: 'ev3_sound_file' }, { kind: 'block', type: 'ev3_sound_stop' }, { kind: 'block', type: 'ev3_led' }] },
    { kind: 'category', name: 'Flow', colour: C.flow, contents: [
      { kind: 'block', type: 'ev3_wait', inputs: { SECS: shadowNum(1) } }, { kind: 'block', type: 'ev3_wait_until' }, { kind: 'block', type: 'ev3_wait_touch' }, { kind: 'block', type: 'ev3_wait_button' },
      { kind: 'block', type: 'ev3_loop_forever' }, { kind: 'block', type: 'ev3_loop_count', inputs: { N: shadowNum(4) } }, { kind: 'block', type: 'ev3_loop_while' }, { kind: 'block', type: 'ev3_loop_seconds', inputs: { SECS: shadowNum(5) } },
      { kind: 'block', type: 'ev3_break' }, { kind: 'block', type: 'ev3_switch' }, { kind: 'block', type: 'ev3_if' }, { kind: 'block', type: 'ev3_stop' }] },
    { kind: 'category', name: 'Sensor', colour: C.sensor, contents: [
      { kind: 'block', type: 'ev3_touch' }, { kind: 'block', type: 'ev3_color_sees' }, { kind: 'block', type: 'ev3_color_value' }, { kind: 'block', type: 'ev3_ultrasonic' },
      { kind: 'block', type: 'ev3_gyro' }, { kind: 'block', type: 'ev3_gyro_reset' }, { kind: 'block', type: 'ev3_infrared' }, { kind: 'block', type: 'ev3_motor_rotation' },
      { kind: 'block', type: 'ev3_motor_reset' }, { kind: 'block', type: 'ev3_timer' }, { kind: 'block', type: 'ev3_timer_reset' }, { kind: 'block', type: 'ev3_button' },
      { kind: 'block', type: 'ev3_battery' }, { kind: 'block', type: 'ev3_nxt_sensor' }] },
    { kind: 'category', name: 'Data', colour: C.data, contents: [
      { kind: 'block', type: 'math_number', fields: { NUM: 0 } }, { kind: 'block', type: 'math_arithmetic', inputs: { A: shadowNum(1), B: shadowNum(1) } },
      { kind: 'block', type: 'ev3_compare', inputs: { A: shadowNum(0), B: shadowNum(50) } }, { kind: 'block', type: 'ev3_range', inputs: { V: shadowNum(0), A: shadowNum(10), B: shadowNum(50) } },
      { kind: 'block', type: 'ev3_random', inputs: { A: shadowNum(1), B: shadowNum(10) } }, { kind: 'block', type: 'ev3_math_op', inputs: { V: shadowNum(0) } },
      { kind: 'block', type: 'ev3_modulo', inputs: { A: shadowNum(10), B: shadowNum(3) } }, { kind: 'block', type: 'logic_operation' }, { kind: 'block', type: 'logic_negate' }, { kind: 'block', type: 'logic_boolean' }] },
    { kind: 'category', name: 'Variables', colour: C.vars, custom: 'VARIABLE' },
    { kind: 'category', name: 'Advanced', colour: C.advanced, contents: [{ kind: 'block', type: 'ev3_keep_awake' }, { kind: 'block', type: 'ev3_comment' }] },
    { kind: 'category', name: 'My blocks', colour: C.my, contents: [{ kind: 'block', type: 'ev3_my_block' }, { kind: 'block', type: 'ev3_call_my_block' }] },
  ] };

  const base = Blockly.Theme.defineTheme('openev3', { base: Blockly.Themes.Zelos,
    blockStyles: { math_blocks: { colourPrimary: C.data }, logic_blocks: { colourPrimary: C.data }, variable_blocks: { colourPrimary: C.vars }, variable_dynamic_blocks: { colourPrimary: C.vars } },
    fontStyle: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', weight: '600', size: 11 }, startHats: true });
  function themeFor(dark) {
    return Blockly.Theme.defineTheme(dark ? 'openev3_dark' : 'openev3_light', { base,
      componentStyles: dark ? { workspaceBackgroundColour: '#1b2129', toolboxBackgroundColour: '#12161b', toolboxForegroundColour: '#e5e9ee', flyoutBackgroundColour: '#232b35', flyoutForegroundColour: '#e5e9ee', flyoutOpacity: 0.97, scrollbarColour: '#98a4b2', insertionMarkerColour: '#fff', insertionMarkerOpacity: 0.3 }
        : { workspaceBackgroundColour: '#f4f6f8', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#18212b', flyoutBackgroundColour: '#e9ecf0', flyoutForegroundColour: '#18212b', flyoutOpacity: 0.97, scrollbarColour: '#5e6b7a' } });
  }

  /* ------------------------------------------------------------ generator */
  class Gen {
    constructor(globals) {
      this.G = globals; this.a = new A.Asm(); this.loops = []; this.tmpBase = null; this.tmpTop = 0; this.subs = {}; this.depth = 0;
      this.scratch = this.G.alloc(4, 'scratch');           // TIMER_WAIT needs a 4-byte variable
      this.t8 = this.G.alloc(1, 't8');                     // byte scratch for int8 params
      this.t32 = this.G.alloc(4, 't32');                   // int32 scratch
    }
    // --- temporaries: a bump allocator inside the globals, reset per statement
    tmpF() { if (this.tmpBase === null) this.tmpBase = this.G.alloc(0); const off = this.G.alloc(4, 'tmp'); return off; }
    tmpB() { return this.G.alloc(1, 'tmpb'); }

    // --- expressions: a value is {c: number} (constant) or {f: offset} (float global) or {b: offset} (bool byte)
    value(block, name, dflt) {
      const target = block.getInputTargetBlock(name);
      if (!target) return { c: dflt == null ? 0 : dflt };
      return this.expr(target);
    }
    expr(b) {
      const E = EXPR[b.type];
      if (!E) throw new Error('block "' + b.type + '" cannot be used as a value');
      return E.call(this, b);
    }
    F(v) { return 'c' in v ? LCF(v.c) : GV(v.f !== undefined ? v.f : v.b); }           // operand usable as DATAF
    I8(v) { if ('c' in v) return LC(Math.round(v.c)); this.a.emit('MOVEF_8', [GV(v.f), GV(this.t8)]); return GV(this.t8); }
    I32(v) { if ('c' in v) return LC(Math.round(v.c)); this.a.emit('MOVEF_32', [GV(v.f), GV(this.t32)]); return GV(this.t32); }
    I16(v) { return this.I32(v); }
    B(v) { if ('c' in v) return LC0(v.c ? 1 : 0); if ('b' in v) return GV(v.b); const t = this.tmpB(); this.a.emit('CP_GTF', [GV(v.f), LCF(0.5), GV(t)]); return GV(t); }
    toF(v) { if ('f' in v || 'c' in v) return v; const t = this.tmpF(); this.a.emit('MOVE8_F', [GV(v.b), GV(t)]); return { f: t }; }
    cond(block, name) { const t = block.getInputTargetBlock(name); if (!t) return { c: 0 }; const v = this.expr(t); return v; }
    // sensor read into a fresh float temp
    readSI(portField, block, type, mode, values, index) {
      const no = Number(block.getFieldValue(portField)) - 1; const n = values || 1;
      const base = this.G.alloc(4 * n, 'sensor');
      const outs = []; for (let i = 0; i < n; i++) outs.push(GV(base + i * 4));
      this.a.emit('INPUT_DEVICE', [LC0(P.INPUT_DEVICE.READY_SI), LC0(0), LC0(no), LC(type || 0), LC(mode), LC0(n), ...outs], 'port ' + (no + 1) + ' mode ' + mode);
      return { f: base + 4 * (index || 0) };
    }
    // --- statements
    stmts(block, name) { let b = block.getInputTargetBlock(name); while (b) { if (b.isEnabled()) this.stmt(b); b = b.getNextBlock(); } }
    stmt(b) { const S = STMT[b.type]; if (!S) throw new Error('unsupported block "' + b.type + '"'); S.call(this, b); }
    waitMs(v) { this.a.emit('TIMER_WAIT', [this.I32(v), GV(this.scratch)]); this.a.emit('TIMER_READY', [GV(this.scratch)]); }
  }
  const sec = v => ('c' in v) ? { c: Math.round(v.c * 1000) } : (function (g) { const t = g.tmpF(); g.a.emit('MULF', [GV(v.f), LCF(1000), GV(t)]); return { f: t }; });
  const ms = (g, v) => { if ('c' in v) return { c: Math.max(1, Math.round(v.c * 1000)) }; const t = g.tmpF(); g.a.emit('MULF', [GV(v.f), LCF(1000), GV(t)]); return { f: t }; };
  const mask = ports => P.portMask(ports);

  const STMT = {
    ev3_comment() {},
    ev3_call_my_block(b) {
      const name = b.getFieldValue('NAME'); const def = this.subs[name];
      if (!def) throw new Error('my block "' + name + '" is not defined');
      if (this.depth > 8) throw new Error('my block "' + name + '" calls itself');
      this.depth++; this.stmts(def, 'DO'); this.depth--;
    },
    ev3_move_steering(b) {
      const m = mask(b.getFieldValue('PORTS')), mode = b.getFieldValue('MODE'), brake = b.getFieldValue('THEN') === 'BRAKE' ? 1 : 0;
      const steer = this.value(b, 'STEER', 0), power = this.value(b, 'POWER', 50), amount = this.value(b, 'AMOUNT', 1);
      if (mode === 'OFF') { this.a.emit('OUTPUT_STOP', [LC0(0), LC0(m), LC0(brake)]); return; }
      // turn ratio for the VM is -200..200, EV3-G steering is -100..100
      let turn; if ('c' in steer) turn = LC(Math.round(steer.c * 2)); else { const t = this.tmpF(); this.a.emit('MULF', [GV(steer.f), LCF(2), GV(t)]); turn = this.I16({ f: t }); }
      const sp = this.I8(power);
      if (mode === 'ON') { this.a.emit('OUTPUT_STEP_SYNC', [LC0(0), LC0(m), sp, turn, LC0(0), LC0(brake)], 'steering, unlimited'); return; }
      if (mode === 'SECONDS') { this.a.emit('OUTPUT_TIME_SYNC', [LC0(0), LC0(m), sp, turn, this.I32(ms(this, amount)), LC0(brake)]); }
      else { const deg = mode === 'ROTATIONS' ? ('c' in amount ? { c: amount.c * 360 } : (function (g) { const t = g.tmpF(); g.a.emit('MULF', [GV(amount.f), LCF(360), GV(t)]); return { f: t }; })(this)) : amount; this.a.emit('OUTPUT_STEP_SYNC', [LC0(0), LC0(m), sp, turn, this.I32(deg), LC0(brake)]); }
      this.a.emit('OUTPUT_READY', [LC0(0), LC0(m)], 'wait until done');
    },
    ev3_move_tank(b) {
      const m = mask(b.getFieldValue('PORTS')), mode = b.getFieldValue('MODE'), brake = b.getFieldValue('THEN') === 'BRAKE' ? 1 : 0;
      const L = Number(b.getFieldValue('LEFT')), R = Number(b.getFieldValue('RIGHT')), amount = this.value(b, 'AMOUNT', 1);
      if (mode === 'OFF') { this.a.emit('OUTPUT_STOP', [LC0(0), LC0(m), LC0(brake)]); return; }
      let speed, turn;
      if (L === R) { speed = L; turn = 0; } else if (Math.abs(L) >= Math.abs(R)) { speed = L; turn = Math.round(100 * (L - R) / Math.abs(L)); } else { speed = R; turn = -Math.round(100 * (R - L) / Math.abs(R)); }
      if (mode === 'ON') { this.a.emit('OUTPUT_STEP_SYNC', [LC0(0), LC0(m), LC(speed), LC(turn), LC0(0), LC0(brake)], 'tank L ' + L + ' R ' + R); return; }
      if (mode === 'SECONDS') this.a.emit('OUTPUT_TIME_SYNC', [LC0(0), LC0(m), LC(speed), LC(turn), this.I32(ms(this, amount)), LC0(brake)]);
      else { const deg = mode === 'ROTATIONS' ? ('c' in amount ? { c: amount.c * 360 } : (function (g) { const t = g.tmpF(); g.a.emit('MULF', [GV(amount.f), LCF(360), GV(t)]); return { f: t }; })(this)) : amount; this.a.emit('OUTPUT_STEP_SYNC', [LC0(0), LC0(m), LC(speed), LC(turn), this.I32(deg), LC0(brake)]); }
      this.a.emit('OUTPUT_READY', [LC0(0), LC0(m)]);
    },
    ev3_motor(b) {
      const m = mask(b.getFieldValue('PORT')), mode = b.getFieldValue('MODE'), brake = b.getFieldValue('THEN') === 'BRAKE' ? 1 : 0;
      const power = this.value(b, 'POWER', 50), amount = this.value(b, 'AMOUNT', 1);
      if (mode === 'OFF') { this.a.emit('OUTPUT_STOP', [LC0(0), LC0(m), LC0(brake)]); return; }
      const sp = this.I8(power);
      if (mode === 'ON') { this.a.emit('OUTPUT_SPEED', [LC0(0), LC0(m), sp]); this.a.emit('OUTPUT_START', [LC0(0), LC0(m)]); return; }
      if (mode === 'SECONDS') this.a.emit('OUTPUT_TIME_SPEED', [LC0(0), LC0(m), sp, LC0(0), this.I32(ms(this, amount)), LC0(0), LC0(brake)]);
      else { const deg = mode === 'ROTATIONS' ? ('c' in amount ? { c: amount.c * 360 } : (function (g) { const t = g.tmpF(); g.a.emit('MULF', [GV(amount.f), LCF(360), GV(t)]); return { f: t }; })(this)) : amount; this.a.emit('OUTPUT_STEP_SPEED', [LC0(0), LC0(m), sp, LC0(0), this.I32(deg), LC0(0), LC0(brake)]); }
      this.a.emit('OUTPUT_READY', [LC0(0), LC0(m)]);
    },
    ev3_motor_stop(b) { this.a.emit('OUTPUT_STOP', [LC0(0), LC0(mask(b.getFieldValue('PORTS'))), LC0(b.getFieldValue('THEN') === 'BRAKE' ? 1 : 0)]); },
    ev3_display_text(b) {
      const font = Number(b.getFieldValue('FONT')), line = Number(b.getFieldValue('LINE')) - 1, step = { 0: 9, 1: 12, 2: 18 }[font];
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.SELECT_FONT), LC0(font)]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.FILLRECT), LC0(0), LC(0), LC(2 + line * step), LC(178), LC(step)], 'clear the line');
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.TEXT), LC0(1), LC(2), LC(2 + line * step), LCS(b.getFieldValue('TEXT'))]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.UPDATE)]);
    },
    ev3_display_value(b) {
      const line = Number(b.getFieldValue('LINE')) - 1, dec = Number(b.getFieldValue('DEC')); const v = this.toF(this.value(b, 'VAL', 0));
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.SELECT_FONT), LC0(1)]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.FILLRECT), LC0(0), LC(0), LC(2 + line * 12), LC(178), LC(12)]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.VALUE), LC0(1), LC(2), LC(2 + line * 12), this.F(v), LC0(8), LC0(dec)]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.UPDATE)]);
    },
    ev3_display_clear() { this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.FILLWINDOW), LC0(0), LC0(0), LC0(0)]); this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.UPDATE)]); },
    ev3_display_image(b) { this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.BMPFILE), LC0(1), LC0(0), LC0(0), LCS(b.getFieldValue('FILE'))]); this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.UPDATE)]); },
    ev3_display_shape(b) {
      const shape = b.getFieldValue('SHAPE'); const x = this.I16(this.value(b, 'X', 89)), y = this.I16(this.value(b, 'Y', 64)), s = this.I16(this.value(b, 'SIZE', 20));
      if (shape === 'PIXEL') this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.PIXEL), LC0(1), x, y]);
      else if (shape === 'CIRCLE' || shape === 'FILLCIRCLE') this.a.emit('UI_DRAW', [LC0(P.UI_DRAW[shape]), LC0(1), x, y, s]);
      else this.a.emit('UI_DRAW', [LC0(P.UI_DRAW[shape]), LC0(1), x, y, s, s]);
      this.a.emit('UI_DRAW', [LC0(P.UI_DRAW.UPDATE)]);
    },
    ev3_tone(b) {
      const hz = this.I16(this.value(b, 'HZ', 440)), m = ms(this, this.value(b, 'SECS', 0.5)), vol = this.I8(this.value(b, 'VOL', 50));
      this.a.emit('SOUND', [LC0(P.SOUND.TONE), vol, hz, this.I16(m)]);
      if (b.getFieldValue('WAIT') === 'WAIT') this.waitMs(m);
    },
    ev3_note(b) { const hz = Number(b.getFieldValue('NOTE')), m = Math.max(1, Math.round(Number(b.getFieldValue('SECS')) * 1000)); this.a.emit('SOUND', [LC0(P.SOUND.TONE), LC(50), LC(hz), LC(m)]); if (b.getFieldValue('WAIT') === 'WAIT') this.waitMs({ c: m }); },
    ev3_sound_file(b) {
      const w = b.getFieldValue('WAIT'); this.a.emit('SOUND', [LC0(w === 'REPEAT' ? P.SOUND.REPEAT : P.SOUND.PLAY), LC(Number(b.getFieldValue('VOL'))), LCS(b.getFieldValue('FILE'))]);
      if (w === 'WAIT') this.a.emit('SOUND_READY', []);
    },
    ev3_sound_stop() { this.a.emit('SOUND', [LC0(P.SOUND.BREAK)]); },
    ev3_led(b) { this.a.emit('UI_WRITE', [LC0(P.UI_WRITE.LED), LC0(Number(b.getFieldValue('PATTERN')))]); },
    ev3_wait(b) { this.waitMs(ms(this, this.value(b, 'SECS', 1))); },
    ev3_wait_until(b) { const top = this.a.label(); const v = this.cond(b, 'COND'); this.waitMs({ c: 10 }); this.a.jump('JR_FALSE', [this.B(v)], top, 'poll'); },
    ev3_wait_touch(b) {
      const state = b.getFieldValue('STATE'); const poll = (want) => { const top = this.a.label(); const v = this.readSI('PORT', b, 16, 0); this.waitMs({ c: 10 }); this.a.jump(want ? 'JR_LTF' : 'JR_GTF', [GV(v.f), LCF(0.5)], top, 'until ' + (want ? 'pressed' : 'released')); };
      if (state === 'PRESSED') poll(true); else if (state === 'RELEASED') poll(false); else { poll(true); poll(false); }
    },
    ev3_wait_button(b) {
      const btn = Number(b.getFieldValue('BTN')), state = b.getFieldValue('STATE');
      const poll = want => { const top = this.a.label(); const t = this.tmpB(); this.a.emit('UI_BUTTON', [LC0(P.UI_BUTTON.PRESSED), LC0(btn), GV(t)]); this.waitMs({ c: 10 }); this.a.jump(want ? 'JR_FALSE' : 'JR_TRUE', [GV(t)], top); };
      if (state === 'PRESSED') poll(true); else if (state === 'RELEASED') poll(false); else { poll(true); poll(false); }
    },
    ev3_loop_forever(b) { const top = this.a.label(), end = this.a.newLabel(); this.loops.push(end); this.stmts(b, 'DO'); this.waitMs({ c: 1 }); this.a.jump('JR', [], top); this.loops.pop(); this.a.label(end); },
    ev3_loop_count(b) {
      const n = this.value(b, 'N', 4); const counter = this.G.alloc(4, 'loopcount'); const top = this.a.newLabel(), end = this.a.newLabel();
      this.a.emit('MOVE8_32', [LC0(0), GV(counter)]); this.a.label(top);
      this.a.jump('JR_GTEQ32', [GV(counter), this.I32(n)], end, 'loop ' + ('c' in n ? n.c : '?') + ' times');
      this.loops.push(end); this.stmts(b, 'DO'); this.loops.pop();
      this.a.emit('ADD32', [GV(counter), LC0(1), GV(counter)]); this.a.jump('JR', [], top); this.a.label(end);
    },
    ev3_loop_while(b) {
      const top = this.a.label(), end = this.a.newLabel(); const v = this.cond(b, 'COND');
      this.a.jump(b.getFieldValue('MODE') === 'WHILE' ? 'JR_FALSE' : 'JR_TRUE', [this.B(v)], end);
      this.loops.push(end); this.stmts(b, 'DO'); this.loops.pop(); this.waitMs({ c: 1 }); this.a.jump('JR', [], top); this.a.label(end);
    },
    ev3_loop_seconds(b) {
      const endT = this.G.alloc(4, 'loopend'); const m = ms(this, this.value(b, 'SECS', 5)); const top = this.a.newLabel(), end = this.a.newLabel();
      this.a.emit('TIMER_READ', [GV(endT)]); this.a.emit('ADD32', [GV(endT), this.I32(m), GV(endT)]);
      this.a.label(top); const now = this.G.alloc(4, 'now'); this.a.emit('TIMER_READ', [GV(now)]); this.a.jump('JR_GTEQ32', [GV(now), GV(endT)], end);
      this.loops.push(end); this.stmts(b, 'DO'); this.loops.pop(); this.waitMs({ c: 1 }); this.a.jump('JR', [], top); this.a.label(end);
    },
    ev3_break() { if (!this.loops.length) throw new Error('"leave the loop" must be inside a loop'); this.a.jump('JR', [], this.loops[this.loops.length - 1], 'leave the loop'); },
    ev3_switch(b) { const v = this.cond(b, 'COND'); const els = this.a.newLabel(), end = this.a.newLabel(); this.a.jump('JR_FALSE', [this.B(v)], els); this.stmts(b, 'DO'); this.a.jump('JR', [], end); this.a.label(els); this.stmts(b, 'ELSE'); this.a.label(end); },
    ev3_if(b) { const v = this.cond(b, 'COND'); const end = this.a.newLabel(); this.a.jump('JR_FALSE', [this.B(v)], end); this.stmts(b, 'DO'); this.a.label(end); },
    ev3_stop(b) { this.a.emit('OUTPUT_STOP', [LC0(0), LC0(15), LC0(0)]); this.a.emit('OBJECT_END', [], 'stop program'); },
    ev3_gyro_reset(b) { this.readSI('PORT', b, 32, 1); this.readSI('PORT', b, 32, 0); },
    ev3_motor_reset(b) { this.a.emit('OUTPUT_CLR_COUNT', [LC0(0), LC0(mask(b.getFieldValue('PORT')))]); },
    ev3_timer_reset(b) { const t = this.timer(b.getFieldValue('T')); this.a.emit('TIMER_READ', [GV(t)]); },
    ev3_keep_awake() { this.a.emit('KEEP_ALIVE', [GV(this.t8)]); },
    variables_set(b) { const v = this.toF(this.value(b, 'VALUE', 0)); this.a.emit('MOVEF_F', [this.F(v), GV(this.variable(b))]); },
    math_change(b) { const d = this.toF(this.value(b, 'DELTA', 1)); const g = this.variable(b); this.a.emit('ADDF', [GV(g), this.F(d), GV(g)]); },
  };
  Gen.prototype.variable = function (b) { const id = b.getFieldValue('VAR'); const v = b.workspace.getVariableById(id); const name = v ? v.name : id; if (!(name in this.vars)) this.vars[name] = this.G.alloc(4, 'var ' + name); return this.vars[name]; };
  Gen.prototype.timer = function (n) { if (!this.timers[n]) this.timers[n] = this.G.alloc(4, 'timer' + n); return this.timers[n]; };

  const EXPR = {
    math_number(b) { return { c: Number(b.getFieldValue('NUM')) || 0 }; },
    math_arithmetic(b) {
      const opn = { ADD: 'ADDF', MINUS: 'SUBF', MULTIPLY: 'MULF', DIVIDE: 'DIVF', POWER: null }[b.getFieldValue('OP')];
      const a = this.toF(this.value(b, 'A', 0)), c = this.toF(this.value(b, 'B', 0));
      if ('c' in a && 'c' in c) { const f = { ADDF: (x, y) => x + y, SUBF: (x, y) => x - y, MULF: (x, y) => x * y, DIVF: (x, y) => x / y }[opn] || Math.pow; return { c: f(a.c, c.c) }; }
      const t = this.tmpF(); if (opn) this.a.emit(opn, [this.F(a), this.F(c), GV(t)]); else { this.a.emit('MATH', [LC0(P.MATH.POW), this.F(a), this.F(c), GV(t)]); } return { f: t };
    },
    ev3_modulo(b) { const a = this.toF(this.value(b, 'A', 0)), c = this.toF(this.value(b, 'B', 1)); const t = this.tmpF(); this.a.emit('MATH', [LC0(P.MATH.MOD), this.F(a), this.F(c), GV(t)]); return { f: t }; },
    ev3_math_op(b) { const v = this.toF(this.value(b, 'V', 0)); const t = this.tmpF(); this.a.emit('MATH', [LC0(Number(b.getFieldValue('OP'))), this.F(v), GV(t)]); return { f: t }; },
    ev3_random(b) { const a = this.I16(this.value(b, 'A', 1)); const c = this.I16(this.value(b, 'B', 10)); const t16 = this.G.alloc(2, 'rnd'); this.a.emit('RANDOM', [a, c, GV(t16)]); const t = this.tmpF(); this.a.emit('MOVE16_F', [GV(t16), GV(t)]); return { f: t }; },
    ev3_compare(b) { const a = this.toF(this.value(b, 'A', 0)), c = this.toF(this.value(b, 'B', 0)); const t = this.tmpB(); this.a.emit('CP_' + b.getFieldValue('OP') + 'F', [this.F(a), this.F(c), GV(t)]); return { b: t }; },
    ev3_range(b) {
      const v = this.toF(this.value(b, 'V', 0)), lo = this.toF(this.value(b, 'A', 0)), hi = this.toF(this.value(b, 'B', 0)); const t1 = this.tmpB(), t2 = this.tmpB(), t = this.tmpB();
      this.a.emit('CP_GTEQF', [this.F(v), this.F(lo), GV(t1)]); this.a.emit('CP_LTEQF', [this.F(v), this.F(hi), GV(t2)]); this.a.emit('AND8', [GV(t1), GV(t2), GV(t)]);
      if (b.getFieldValue('MODE') === 'OUT') this.a.emit('XOR8', [GV(t), LC0(1), GV(t)]);
      return { b: t };
    },
    logic_operation(b) { const a = this.B(this.cond(b, 'A')), c = this.B(this.cond(b, 'B')); const t = this.tmpB(); this.a.emit(b.getFieldValue('OP') === 'AND' ? 'AND8' : 'OR8', [a, c, GV(t)]); return { b: t }; },
    logic_negate(b) { const a = this.B(this.cond(b, 'BOOL')); const t = this.tmpB(); this.a.emit('XOR8', [a, LC0(1), GV(t)]); return { b: t }; },
    logic_boolean(b) { return { c: b.getFieldValue('BOOL') === 'TRUE' ? 1 : 0 }; },
    variables_get(b) { return { f: this.variable(b) }; },
    ev3_touch(b) { const v = this.readSI('PORT', b, 16, 0); const t = this.tmpB(); this.a.emit(b.getFieldValue('STATE') === 'PRESSED' ? 'CP_GTF' : 'CP_LTF', [GV(v.f), LCF(0.5), GV(t)]); return { b: t }; },
    ev3_color_sees(b) { const v = this.readSI('PORT', b, 29, 2); const t = this.tmpB(); this.a.emit('CP_EQF', [GV(v.f), LCF(Number(b.getFieldValue('COLOR'))), GV(t)]); return { b: t }; },
    ev3_color_value(b) { return this.readSI('PORT', b, 29, Number(b.getFieldValue('MODE'))); },
    ev3_ultrasonic(b) { return this.readSI('PORT', b, 30, Number(b.getFieldValue('MODE'))); },
    ev3_gyro(b) { return this.readSI('PORT', b, 32, Number(b.getFieldValue('MODE'))); },
    ev3_infrared(b) { const m = b.getFieldValue('MODE'); if (m === 'PROX') return this.readSI('PORT', b, 33, 0); if (m === 'HEAD') return this.readSI('PORT', b, 33, 1, 8, 0); if (m === 'DIST') return this.readSI('PORT', b, 33, 1, 8, 1); return this.readSI('PORT', b, 33, 2, 4, 0); },
    ev3_nxt_sensor(b) { const k = b.getFieldValue('KIND'); const map = { TOUCH: [1, 0], LIGHT: [2, 0], SOUND: [3, 0], US: [5, 0] }[k]; return this.readSI('PORT', b, map[0], map[1]); },
    ev3_motor_rotation(b) {
      const no = P.portIndex(b.getFieldValue('PORT')), m = b.getFieldValue('MODE');
      if (m === 'POWER') { const s8 = this.G.alloc(1, 'speed'), t32 = this.G.alloc(4, 'tacho'); this.a.emit('OUTPUT_READ', [LC0(0), LC0(no), GV(s8), GV(t32)]); const t = this.tmpF(); this.a.emit('MOVE8_F', [GV(s8), GV(t)]); return { f: t }; }
      const t32 = this.G.alloc(4, 'tacho'); this.a.emit('OUTPUT_GET_COUNT', [LC0(0), LC0(no), GV(t32)]); const t = this.tmpF(); this.a.emit('MOVE32_F', [GV(t32), GV(t)]);
      if (m === 'ROT') { const r = this.tmpF(); this.a.emit('DIVF', [GV(t), LCF(360), GV(r)]); return { f: r }; }
      return { f: t };
    },
    ev3_timer(b) { const t0 = this.timer(b.getFieldValue('T')); const now = this.G.alloc(4, 'now'); this.a.emit('TIMER_READ', [GV(now)]); this.a.emit('SUB32', [GV(now), GV(t0), GV(now)]); const t = this.tmpF(); this.a.emit('MOVE32_F', [GV(now), GV(t)]); const r = this.tmpF(); this.a.emit('DIVF', [GV(t), LCF(1000), GV(r)]); return { f: r }; },
    ev3_button(b) { const t = this.tmpB(); this.a.emit('UI_BUTTON', [LC0(P.UI_BUTTON.PRESSED), LC0(Number(b.getFieldValue('BTN'))), GV(t)]); return { b: t }; },
    ev3_battery(b) { const t = this.tmpF(); if (b.getFieldValue('MODE') === 'V') this.a.emit('UI_READ', [LC0(P.UI_READ.GET_VBATT), GV(t)]); else { const t8 = this.tmpB(); this.a.emit('UI_READ', [LC0(P.UI_READ.GET_LBATT), GV(t8)]); this.a.emit('MOVE8_F', [GV(t8), GV(t)]); } return { f: t }; },
  };

  /* Turn a workspace into bytecode: {main, direct, rbf, threads, globals, locals, listing}. */
  function generate(ws) {
    const G = new A.Globals();
    const tops = ws.getTopBlocks(true).filter(b => b.isEnabled());
    const subs = {}; for (const b of tops) if (b.type === 'ev3_my_block') subs[b.getFieldValue('NAME')] = b;
    const timers = {}, vars = {};
    const mkGen = () => { const g = new Gen(G); g.subs = subs; g.timers = timers; g.vars = vars; return g; };
    const mainGen = mkGen();
    const beams = tops.filter(b => b.type === 'ev3_parallel');
    // timers start at program start
    const timerBlocks = []; ws.getAllBlocks(false).forEach(b => { if (b.type === 'ev3_timer' || b.type === 'ev3_timer_reset') timerBlocks.push(b.getFieldValue('T')); });
    for (const t of new Set(timerBlocks)) mainGen.a.emit('TIMER_READ', [GV(mainGen.timer(t))], 'timer ' + t + ' starts');
    beams.forEach((b, i) => mainGen.a.emit('OBJECT_START', [LC2(i + 2)], 'start beam ' + (i + 1)));
    for (const b of tops) if (b.type === 'ev3_program') mainGen.stmts(b, 'DO');
    const mainCode = mainGen.a.finish();
    const threadGens = beams.map(b => { const g = mkGen(); g.stmts(b, 'DO'); return g; });
    const threads = [[Uint8Array.from([...mainCode, P.OP.OBJECT_END]), 0], ...threadGens.map(g => [Uint8Array.from([...g.a.finish(), P.OP.OBJECT_END]), 0])];
    const globals = G.aligned;
    const listing = ['; main thread', mainGen.a.listing(), ...threadGens.map((g, i) => '; beam ' + (i + 1) + '\n' + g.a.listing()), '; globals: ' + globals + ' bytes (' + G.names.join(', ') + ')'].join('\n');
    return { main: mainCode, direct: mainCode, threads, globals, locals: 0, rbf: P.rbfImage(threads, globals), listing };
  }

  const chain = list => { let cur = null; for (let i = list.length - 1; i >= 0; i--) cur = cur ? Object.assign({}, list[i], { next: { block: cur } }) : list[i]; return cur; };
  const blk = (type, fields, inputs) => { const o = { type }; if (fields) o.fields = fields; if (inputs) o.inputs = inputs; return o; };
  const hat = (type, x, y, fields, list) => Object.assign(blk(type, fields), { x, y, inputs: { DO: { block: chain(list) } } });
  const n = v => ({ shadow: blk('math_number', { NUM: v }) });
  const starter = { blocks: { languageVersion: 0, blocks: [hat('ev3_program', 40, 40, null, [
    blk('ev3_display_text', { TEXT: 'OpenEV3 says hi', LINE: '1', FONT: '1' }),
    blk('ev3_led', { PATTERN: '9' }),
    blk('ev3_note', { NOTE: '523', SECS: 0.3, WAIT: 'WAIT' }),
    blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ROTATIONS', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(50), AMOUNT: n(1) }),
    blk('ev3_wait', null, { SECS: n(0.5) }),
    blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ROTATIONS', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(-50), AMOUNT: n(1) }),
    blk('ev3_note', { NOTE: '784', SECS: 0.5, WAIT: 'WAIT' }),
    blk('ev3_led', { PATTERN: '1' })])] } };
  const examples = [
    { name: 'Starter: say hi and drive', json: starter },
    { name: 'Bumper car (touch sensor)', json: { blocks: { languageVersion: 0, blocks: [hat('ev3_program', 40, 40, null, [
      blk('ev3_loop_forever', null, { DO: { block: chain([
        blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ON', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(50), AMOUNT: n(1) }),
        blk('ev3_wait_touch', { PORT: '1', STATE: 'PRESSED' }),
        blk('ev3_note', { NOTE: '440', SECS: 0.1, WAIT: 'GO' }),
        blk('ev3_move_steering', { PORTS: 'BC', MODE: 'SECONDS', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(-40), AMOUNT: n(0.6) }),
        blk('ev3_move_steering', { PORTS: 'BC', MODE: 'DEGREES', THEN: 'BRAKE' }, { STEER: n(100), POWER: n(40), AMOUNT: n(400) })]) } })])] } } },
    { name: 'Wall avoider (ultrasonic)', json: { blocks: { languageVersion: 0, blocks: [hat('ev3_program', 40, 40, null, [
      blk('ev3_loop_forever', null, { DO: { block: chain([
        blk('ev3_display_value', { LINE: '1', DEC: '0' }, { VAL: { block: blk('ev3_ultrasonic', { PORT: '4', MODE: '0' }) } }),
        blk('ev3_switch', null, { COND: { block: blk('ev3_compare', { OP: 'LT' }, { A: { block: blk('ev3_ultrasonic', { PORT: '4', MODE: '0' }) }, B: n(25) }) },
          DO: { block: chain([blk('ev3_move_steering', { PORTS: 'BC', MODE: 'SECONDS', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(-40), AMOUNT: n(0.4) }), blk('ev3_move_steering', { PORTS: 'BC', MODE: 'DEGREES', THEN: 'BRAKE' }, { STEER: n(100), POWER: n(40), AMOUNT: n(300) })]) },
          ELSE: { block: blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ON', THEN: 'BRAKE' }, { STEER: n(0), POWER: n(50), AMOUNT: n(1) }) } })]) } })])] } } },
    { name: 'Line follower (colour sensor)', json: { blocks: { languageVersion: 0, blocks: [hat('ev3_program', 40, 40, null, [
      blk('ev3_loop_forever', null, { DO: { block: blk('ev3_switch', null, { COND: { block: blk('ev3_compare', { OP: 'LT' }, { A: { block: blk('ev3_color_value', { PORT: '3', MODE: '0' }) }, B: n(40) }) },
        DO: { block: blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ON', THEN: 'BRAKE' }, { STEER: n(-30), POWER: n(30), AMOUNT: n(1) }) },
        ELSE: { block: blk('ev3_move_steering', { PORTS: 'BC', MODE: 'ON', THEN: 'BRAKE' }, { STEER: n(30), POWER: n(30), AMOUNT: n(1) }) } }) } })])] } } },
    { name: 'Count presses with a variable', json: { blocks: { languageVersion: 0, blocks: [hat('ev3_program', 40, 40, null, [
      blk('variables_set', { VAR: { id: 'v_count', name: 'count' } }, { VALUE: n(0) }),
      blk('ev3_loop_count', null, { N: n(10), DO: { block: chain([
        blk('ev3_wait_touch', { PORT: '1', STATE: 'BUMPED' }),
        blk('math_change', { VAR: { id: 'v_count', name: 'count' } }, { DELTA: n(1) }),
        blk('ev3_display_value', { LINE: '2', DEC: '0' }, { VAL: { block: blk('variables_get', { VAR: { id: 'v_count', name: 'count' } }) } }),
        blk('ev3_note', { NOTE: '659', SECS: 0.05, WAIT: 'GO' })]) } })])], variables: [{ name: 'count', id: 'v_count' }] } } },
    { name: 'Two beams: drive and blink', json: { blocks: { languageVersion: 0, blocks: [
      hat('ev3_program', 40, 40, null, [blk('ev3_motor', { PORT: 'A', MODE: 'ROTATIONS', THEN: 'BRAKE' }, { POWER: n(50), AMOUNT: n(3) }), blk('ev3_motor', { PORT: 'A', MODE: 'ROTATIONS', THEN: 'BRAKE' }, { POWER: n(-50), AMOUNT: n(3) })]),
      hat('ev3_parallel', 40, 300, null, [blk('ev3_loop_count', null, { N: n(6), DO: { block: chain([blk('ev3_led', { PATTERN: '2' }), blk('ev3_wait', null, { SECS: n(0.5) }), blk('ev3_led', { PATTERN: '1' }), blk('ev3_wait', null, { SECS: n(0.5) })]) } })])] } } },
  ];
  ns.blocks = { toolbox, themeFor, generate, starter, examples, colours: C };
})(OpenEV3);
