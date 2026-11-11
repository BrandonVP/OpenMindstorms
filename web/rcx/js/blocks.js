/* OpenRCX - block programming in the spirit of the original RCX Code software.
 * Defines the RCX blocks for Blockly, a toolbox, a theme and a generator that turns
 * a block program into NQC source, which then goes through the normal compiler. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
(function (ns) {
  'use strict';
  if (typeof Blockly === 'undefined') { ns.blocks = null; return; }

  const C = { program: '#d64545', motors: '#e8871e', sensors: '#2f7ed8', control: '#2e9e5b',
    sound: '#8a5cd6', comms: '#1d9a8f', math: '#5c7cfa', vars: '#c2185b', commands: '#7a5230' };
  const PORTS = [['1', '0'], ['2', '1'], ['3', '2']];
  const OUTS = [['A', 'OUT_A'], ['B', 'OUT_B'], ['C', 'OUT_C'], ['A + B', 'OUT_A + OUT_B'],
    ['A + C', 'OUT_A + OUT_C'], ['B + C', 'OUT_B + OUT_C'], ['A + B + C', 'OUT_A + OUT_B + OUT_C']];
  const SOUNDS = [['click', 'SOUND_CLICK'], ['beep beep', 'SOUND_DOUBLE_BEEP'], ['sweep down', 'SOUND_DOWN'],
    ['sweep up', 'SOUND_UP'], ['error buzz', 'SOUND_LOW_BEEP'], ['fast sweep up', 'SOUND_FAST_UP']];

  /* ------------------------------------------------------------ block definitions */
  Blockly.defineBlocksWithJsonArray([
    // ---- program hats
    { type: 'rcx_program', message0: 'when program starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.program, hat: 'cap', tooltip: 'The main task. Runs when you press Run on the brick.' },
    { type: 'rcx_touch_watcher', message0: 'when touch sensor %1 is %2 %3 %4',
      args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'STATE', options: [['pressed', 'PRESSED'], ['released', 'RELEASED']] }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.program, hat: 'cap', tooltip: 'Sensor watcher: runs its blocks every time this happens, in parallel with everything else.' },
    { type: 'rcx_light_watcher', message0: 'when light sensor %1 gets %2 %3 %4 %5',
      args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'DIR', options: [['brighter than', 'GT'], ['darker than', 'LT']] }, { type: 'field_number', name: 'LEVEL', value: 50, min: 0, max: 100 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.program, hat: 'cap', tooltip: 'Sensor watcher for a light sensor reading (0..100).' },
    { type: 'rcx_timer_watcher', message0: 'every %1 seconds %2 %3',
      args0: [{ type: 'field_number', name: 'SECS', value: 1, min: 0.1, precision: 0.1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.program, hat: 'cap', tooltip: 'Runs its blocks over and over with a pause in between.' },
    { type: 'rcx_message_watcher', message0: 'when message %1 is received %2 %3',
      args0: [{ type: 'field_number', name: 'MSG', value: 1, min: 1, max: 255, precision: 1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.program, hat: 'cap', tooltip: 'Runs when another brick (or the Workbench) sends this IR message.' },
    { type: 'rcx_my_command', message0: 'my command %1 %2 %3',
      args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.commands, hat: 'cap', tooltip: 'A reusable group of blocks (an NQC subroutine). Up to 8 per program.' },
    { type: 'rcx_call_command', message0: 'run my command %1', args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }],
      previousStatement: null, nextStatement: null, colour: C.commands, tooltip: 'Run the blocks under "my command" with this name.' },

    // ---- motors
    { type: 'rcx_motor_on', message0: 'turn motor %1 on %2',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: OUTS }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['backward', 'REV']] }],
      previousStatement: null, nextStatement: null, colour: C.motors, tooltip: 'Switch the motor on and keep it running.' },
    { type: 'rcx_motor_off', message0: 'turn motor %1 %2',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: OUTS }, { type: 'field_dropdown', name: 'HOW', options: [['off (brake)', 'OFF'], ['off (coast)', 'FLOAT']] }],
      previousStatement: null, nextStatement: null, colour: C.motors, tooltip: 'Brake stops hard; coast lets the motor spin down freely.' },
    { type: 'rcx_motor_for', message0: 'run motor %1 %2 for %3 seconds',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: OUTS }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['backward', 'REV']] }, { type: 'field_number', name: 'SECS', value: 1, min: 0.01, precision: 0.01 }],
      previousStatement: null, nextStatement: null, colour: C.motors, tooltip: 'Run the motor for a while, then brake.' },
    { type: 'rcx_motor_power', message0: 'set motor %1 power to %2',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: OUTS }, { type: 'field_dropdown', name: 'POWER', options: [['1', '0'], ['2', '1'], ['3', '2'], ['4', '3'], ['5', '4'], ['6', '5'], ['7', '6'], ['8 (full)', '7']] }],
      previousStatement: null, nextStatement: null, colour: C.motors, tooltip: 'Power level 1 to 8.' },
    { type: 'rcx_motor_dir', message0: 'set motor %1 direction %2',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: OUTS }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['backward', 'REV'], ['reversed', 'TOGGLE']] }],
      previousStatement: null, nextStatement: null, colour: C.motors, tooltip: 'Change direction without switching the motor on or off.' },

    // ---- sensors (values)
    { type: 'rcx_touch_pressed', message0: 'touch sensor %1 pressed', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
      output: 'Boolean', colour: C.sensors, tooltip: 'True while the touch sensor is pressed.' },
    { type: 'rcx_light_value', message0: 'light sensor %1', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
      output: 'Number', colour: C.sensors, tooltip: 'Brightness 0..100.' },
    { type: 'rcx_rotation_value', message0: 'rotation sensor %1', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
      output: 'Number', colour: C.sensors, tooltip: 'Turns counted in 1/16 revolutions.' },
    { type: 'rcx_temp_value', message0: 'temperature sensor %1 (°C x10)', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
      output: 'Number', colour: C.sensors, tooltip: 'Temperature in tenths of a degree Celsius.' },
    { type: 'rcx_sensor_reset', message0: 'reset sensor %1', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
      previousStatement: null, nextStatement: null, colour: C.sensors, tooltip: 'Set a rotation counter back to 0.' },
    { type: 'rcx_timer', message0: 'timer %1 (1/10 s)', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '0'], ['2', '1'], ['3', '2'], ['4', '3']] }],
      output: 'Number', colour: C.sensors, tooltip: 'Tenths of a second since the timer was reset.' },
    { type: 'rcx_timer_reset', message0: 'reset timer %1', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '0'], ['2', '1'], ['3', '2'], ['4', '3']] }],
      previousStatement: null, nextStatement: null, colour: C.sensors, tooltip: 'Start the timer from 0.' },

    // ---- control
    { type: 'rcx_wait', message0: 'wait %1 seconds', args0: [{ type: 'field_number', name: 'SECS', value: 1, min: 0.01, precision: 0.01 }],
      previousStatement: null, nextStatement: null, colour: C.control, tooltip: 'Pause this stack; other watchers keep running.' },
    { type: 'rcx_wait_until', message0: 'wait until %1', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
      previousStatement: null, nextStatement: null, colour: C.control, tooltip: 'Pause until the condition is true.' },
    { type: 'rcx_repeat', message0: 'repeat %1 times %2 %3', args0: [{ type: 'field_number', name: 'N', value: 4, min: 1, precision: 1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'rcx_forever', message0: 'repeat forever %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'rcx_while', message0: 'repeat while %1 %2 %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'rcx_if', message0: 'if %1 then %2 %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'rcx_if_else', message0: 'if %1 then %2 %3 else %4 %5', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'ELSE' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'rcx_stop_all', message0: 'stop program', previousStatement: null, colour: C.control, tooltip: 'Stop every task, like pressing Run again.' },

    // ---- sound & display
    { type: 'rcx_play_sound', message0: 'play sound %1', args0: [{ type: 'field_dropdown', name: 'SOUND', options: SOUNDS }],
      previousStatement: null, nextStatement: null, colour: C.sound },
    { type: 'rcx_play_tone', message0: 'play tone %1 Hz for %2 seconds', args0: [{ type: 'field_number', name: 'HZ', value: 440, min: 31, max: 20000, precision: 1 }, { type: 'field_number', name: 'SECS', value: 0.5, min: 0.01, max: 2.55, precision: 0.01 }],
      previousStatement: null, nextStatement: null, colour: C.sound },
    { type: 'rcx_display', message0: 'show %1 on the display', args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['the clock', 'DISPLAY_WATCH'], ['sensor 1', 'DISPLAY_SENSOR_1'], ['sensor 2', 'DISPLAY_SENSOR_2'], ['sensor 3', 'DISPLAY_SENSOR_3'], ['motor A', 'DISPLAY_OUT_A'], ['motor B', 'DISPLAY_OUT_B'], ['motor C', 'DISPLAY_OUT_C']] }],
      previousStatement: null, nextStatement: null, colour: C.sound },
    { type: 'rcx_display_value', message0: 'show value %1 on the display', args0: [{ type: 'input_value', name: 'VAL', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.sound, tooltip: 'Show a number on the LCD (RCX 2.0 firmware).' },

    // ---- communication & data
    { type: 'rcx_send_message', message0: 'send message %1', args0: [{ type: 'field_number', name: 'MSG', value: 1, min: 1, max: 255, precision: 1 }],
      previousStatement: null, nextStatement: null, colour: C.comms, tooltip: 'Broadcast an IR message to other bricks.' },
    { type: 'rcx_message', message0: 'last message', output: 'Number', colour: C.comms, tooltip: 'The last IR message received (0 = none).' },
    { type: 'rcx_clear_message', message0: 'clear message', previousStatement: null, nextStatement: null, colour: C.comms },
    { type: 'rcx_datalog_create', message0: 'start a datalog with room for %1 values', args0: [{ type: 'field_number', name: 'N', value: 100, min: 1, max: 2000, precision: 1 }],
      previousStatement: null, nextStatement: null, colour: C.comms },
    { type: 'rcx_datalog_add', message0: 'record %1 in the datalog', args0: [{ type: 'input_value', name: 'VAL', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.comms, tooltip: 'Read it back in the Datalog section.' },

    // ---- math
    { type: 'rcx_random', message0: 'random number up to %1', args0: [{ type: 'field_number', name: 'N', value: 10, min: 1, precision: 1 }],
      output: 'Number', colour: C.math },
  ]);

  /* ------------------------------------------------------------ toolbox */
  const toolbox = {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: 'Program', colour: C.program, contents: [
        { kind: 'block', type: 'rcx_program' }, { kind: 'block', type: 'rcx_touch_watcher' }, { kind: 'block', type: 'rcx_light_watcher' },
        { kind: 'block', type: 'rcx_timer_watcher' }, { kind: 'block', type: 'rcx_message_watcher' }] },
      { kind: 'category', name: 'Motors', colour: C.motors, contents: [
        { kind: 'block', type: 'rcx_motor_on' }, { kind: 'block', type: 'rcx_motor_off' }, { kind: 'block', type: 'rcx_motor_for' },
        { kind: 'block', type: 'rcx_motor_power' }, { kind: 'block', type: 'rcx_motor_dir' }] },
      { kind: 'category', name: 'Sensors', colour: C.sensors, contents: [
        { kind: 'block', type: 'rcx_touch_pressed' }, { kind: 'block', type: 'rcx_light_value' }, { kind: 'block', type: 'rcx_rotation_value' },
        { kind: 'block', type: 'rcx_temp_value' }, { kind: 'block', type: 'rcx_sensor_reset' }, { kind: 'block', type: 'rcx_timer' }, { kind: 'block', type: 'rcx_timer_reset' }] },
      { kind: 'category', name: 'Control', colour: C.control, contents: [
        { kind: 'block', type: 'rcx_wait' }, { kind: 'block', type: 'rcx_wait_until' }, { kind: 'block', type: 'rcx_repeat' },
        { kind: 'block', type: 'rcx_forever' }, { kind: 'block', type: 'rcx_while' }, { kind: 'block', type: 'rcx_if' },
        { kind: 'block', type: 'rcx_if_else' }, { kind: 'block', type: 'rcx_stop_all' }] },
      { kind: 'category', name: 'Sound & display', colour: C.sound, contents: [
        { kind: 'block', type: 'rcx_play_sound' }, { kind: 'block', type: 'rcx_play_tone' }, { kind: 'block', type: 'rcx_display' }, { kind: 'block', type: 'rcx_display_value' }] },
      { kind: 'category', name: 'Messages & data', colour: C.comms, contents: [
        { kind: 'block', type: 'rcx_send_message' }, { kind: 'block', type: 'rcx_message' }, { kind: 'block', type: 'rcx_clear_message' },
        { kind: 'block', type: 'rcx_datalog_create' }, { kind: 'block', type: 'rcx_datalog_add' }] },
      { kind: 'category', name: 'Math & logic', colour: C.math, contents: [
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } }, { kind: 'block', type: 'math_arithmetic' }, { kind: 'block', type: 'rcx_random' },
        { kind: 'block', type: 'logic_compare' }, { kind: 'block', type: 'logic_operation' }, { kind: 'block', type: 'logic_negate' }, { kind: 'block', type: 'logic_boolean' }] },
      { kind: 'category', name: 'Variables', colour: C.vars, custom: 'VARIABLE' },
      { kind: 'category', name: 'My commands', colour: C.commands, contents: [
        { kind: 'block', type: 'rcx_my_command' }, { kind: 'block', type: 'rcx_call_command' }] },
    ],
  };

  const theme = Blockly.Theme.defineTheme('openrcx', {
    base: Blockly.Themes.Zelos,
    blockStyles: { math_blocks: { colourPrimary: C.math }, logic_blocks: { colourPrimary: C.math }, variable_blocks: { colourPrimary: C.vars },
      variable_dynamic_blocks: { colourPrimary: C.vars }, text_blocks: { colourPrimary: C.comms } },
    fontStyle: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', weight: '600', size: 11 },
    startHats: true,
  });

  function themeFor(dark) {
    return Blockly.Theme.defineTheme(dark ? 'openrcx_dark' : 'openrcx_light', {
      base: theme,
      componentStyles: dark
        ? { workspaceBackgroundColour: '#1b2129', toolboxBackgroundColour: '#12161b', toolboxForegroundColour: '#e5e9ee',
          flyoutBackgroundColour: '#232b35', flyoutForegroundColour: '#e5e9ee', flyoutOpacity: 0.97, scrollbarColour: '#98a4b2', insertionMarkerColour: '#fff', insertionMarkerOpacity: 0.3 }
        : { workspaceBackgroundColour: '#f4f6f8', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#18212b',
          flyoutBackgroundColour: '#e9ecf0', flyoutForegroundColour: '#18212b', flyoutOpacity: 0.97, scrollbarColour: '#5e6b7a' },
    });
  }

  /* ------------------------------------------------------------ NQC generator */
  const G = new Blockly.Generator('NQC');
  G.INDENT = '    ';
  const ORDER = { ATOMIC: 0, UNARY: 2, MUL: 3, ADD: 4, REL: 6, EQ: 7, AND: 11, OR: 12, NONE: 99 };
  G.scrub_ = function (block, code, thisOnly) {
    const next = block.nextConnection && block.nextConnection.targetBlock();
    return thisOnly || !next ? code : code + this.blockToCode(next);
  };
  const state = { sensors: new Map(), explicit: new Set(), vars: new Map() };
  const sec = v => Math.max(1, Math.round(Number(v) * 100));
  const port = b => Number(b.getFieldValue('PORT'));
  const useSensor = (b, type) => { const p = port(b); if (!state.sensors.has(p)) state.sensors.set(p, type); return 'SENSOR_' + (p + 1); };
  const cname = s => { let n = String(s).replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z_]/.test(n)) n = '_' + n; return n || '_'; };
  const varName = (block, field) => { const id = block.getFieldValue(field); const v = block.workspace.getVariableById(id); const n = cname(v ? v.name : id); state.vars.set(n, true); return n; };
  const dirCall = { FWD: 'OnFwd', REV: 'OnRev' };
  const cond = (b, name) => G.valueToCode(b, name, ORDER.NONE) || 'false';
  const num = (b, name, dflt) => G.valueToCode(b, name, ORDER.NONE) || String(dflt);

  const F = G.forBlock;
  F.rcx_motor_on = b => dirCall[b.getFieldValue('DIR')] + '(' + b.getFieldValue('OUT') + ');\n';
  F.rcx_motor_off = b => (b.getFieldValue('HOW') === 'OFF' ? 'Off' : 'Float') + '(' + b.getFieldValue('OUT') + ');\n';
  F.rcx_motor_for = b => { const o = b.getFieldValue('OUT'); return (b.getFieldValue('DIR') === 'FWD' ? 'Fwd' : 'Rev') + '(' + o + ');\nOnFor(' + o + ', ' + sec(b.getFieldValue('SECS')) + ');\n'; };
  F.rcx_motor_power = b => 'SetPower(' + b.getFieldValue('OUT') + ', ' + b.getFieldValue('POWER') + ');\n';
  F.rcx_motor_dir = b => ({ FWD: 'Fwd', REV: 'Rev', TOGGLE: 'Toggle' }[b.getFieldValue('DIR')]) + '(' + b.getFieldValue('OUT') + ');\n';
  F.rcx_touch_pressed = b => ['(' + useSensor(b, 'SENSOR_TOUCH') + ' == 1)', ORDER.ATOMIC];
  F.rcx_light_value = b => [useSensor(b, 'SENSOR_LIGHT'), ORDER.ATOMIC];
  F.rcx_rotation_value = b => [useSensor(b, 'SENSOR_ROTATION'), ORDER.ATOMIC];
  F.rcx_temp_value = b => [useSensor(b, 'SENSOR_CELSIUS'), ORDER.ATOMIC];
  F.rcx_sensor_reset = b => 'ClearSensor(SENSOR_' + (port(b) + 1) + ');\n';
  F.rcx_timer = b => ['Timer(' + b.getFieldValue('T') + ')', ORDER.ATOMIC];
  F.rcx_timer_reset = b => 'ClearTimer(' + b.getFieldValue('T') + ');\n';
  F.rcx_wait = b => 'Wait(' + sec(b.getFieldValue('SECS')) + ');\n';
  F.rcx_wait_until = b => 'until (' + cond(b, 'COND') + ');\n';
  F.rcx_repeat = b => 'repeat (' + b.getFieldValue('N') + ')\n{\n' + G.statementToCode(b, 'DO') + '}\n';
  F.rcx_forever = b => 'while (true)\n{\n' + G.statementToCode(b, 'DO') + '}\n';
  F.rcx_while = b => 'while (' + cond(b, 'COND') + ')\n{\n' + G.statementToCode(b, 'DO') + '}\n';
  F.rcx_if = b => 'if (' + cond(b, 'COND') + ')\n{\n' + G.statementToCode(b, 'DO') + '}\n';
  F.rcx_if_else = b => 'if (' + cond(b, 'COND') + ')\n{\n' + G.statementToCode(b, 'DO') + '}\nelse\n{\n' + G.statementToCode(b, 'ELSE') + '}\n';
  F.rcx_stop_all = () => 'StopAllTasks();\n';
  F.rcx_play_sound = b => 'PlaySound(' + b.getFieldValue('SOUND') + ');\n';
  F.rcx_play_tone = b => 'PlayTone(' + b.getFieldValue('HZ') + ', ' + sec(b.getFieldValue('SECS')) + ');\n';
  F.rcx_display = b => 'SelectDisplay(' + b.getFieldValue('WHAT') + ');\n';
  F.rcx_display_value = b => 'SetUserDisplay(' + num(b, 'VAL', 0) + ', 0);\nSelectDisplay(DISPLAY_USER);\n';
  F.rcx_send_message = b => 'SendMessage(' + b.getFieldValue('MSG') + ');\n';
  F.rcx_message = () => ['Message()', ORDER.ATOMIC];
  F.rcx_clear_message = () => 'ClearMessage();\n';
  F.rcx_datalog_create = b => 'CreateDatalog(' + b.getFieldValue('N') + ');\n';
  F.rcx_datalog_add = b => 'AddToDatalog(' + num(b, 'VAL', 0) + ');\n';
  F.rcx_random = b => ['Random(' + b.getFieldValue('N') + ')', ORDER.ATOMIC];
  F.rcx_call_command = b => cname(b.getFieldValue('NAME')) + '();\n';
  // built-ins
  F.math_number = b => { const v = Number(b.getFieldValue('NUM')); return [String(Math.round(v)), v < 0 ? ORDER.UNARY : ORDER.ATOMIC]; };
  F.math_arithmetic = b => {
    const op = { ADD: [' + ', ORDER.ADD], MINUS: [' - ', ORDER.ADD], MULTIPLY: [' * ', ORDER.MUL], DIVIDE: [' / ', ORDER.MUL], POWER: null }[b.getFieldValue('OP')];
    if (!op) return ['0 /* power is not available on the RCX */', ORDER.ATOMIC];
    return [G.valueToCode(b, 'A', op[1]) + op[0] + G.valueToCode(b, 'B', op[1]), op[1]];
  };
  F.logic_compare = b => {
    const op = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[b.getFieldValue('OP')];
    const o = (op === '==' || op === '!=') ? ORDER.EQ : ORDER.REL;
    return ['(' + (G.valueToCode(b, 'A', o) || '0') + ' ' + op + ' ' + (G.valueToCode(b, 'B', o) || '0') + ')', ORDER.ATOMIC];
  };
  F.logic_operation = b => {
    const and = b.getFieldValue('OP') === 'AND';
    const o = and ? ORDER.AND : ORDER.OR;
    return ['(' + (G.valueToCode(b, 'A', o) || 'false') + (and ? ' && ' : ' || ') + (G.valueToCode(b, 'B', o) || 'false') + ')', ORDER.ATOMIC];
  };
  F.logic_negate = b => ['!' + (G.valueToCode(b, 'BOOL', ORDER.UNARY) || 'false'), ORDER.UNARY];
  F.logic_boolean = b => [b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', ORDER.ATOMIC];
  F.variables_get = b => [varName(b, 'VAR'), ORDER.ATOMIC];
  F.variables_set = b => varName(b, 'VAR') + ' = ' + num(b, 'VALUE', 0) + ';\n';
  F.math_change = b => varName(b, 'VAR') + ' += ' + num(b, 'DELTA', 1) + ';\n';
  // hats never generate inline; the program assembler handles them
  ['rcx_program', 'rcx_touch_watcher', 'rcx_light_watcher', 'rcx_timer_watcher', 'rcx_message_watcher', 'rcx_my_command'].forEach(t => { F[t] = () => ''; });

  function body(block) { return G.statementToCode(block, 'DO'); }
  const ind = s => s ? G.prefixLines(s, G.INDENT) : '';

  /* Turn a whole workspace into an NQC program. */
  function generate(ws) {
    state.sensors = new Map(); state.explicit = new Set(); state.vars = new Map();
    const tops = ws.getTopBlocks(true).filter(b => b.isEnabled());
    const tasks = [], subs = [], starts = [];
    let main = null, w = 0;
    const seenSubs = new Set();
    for (const b of tops) {
      switch (b.type) {
        case 'rcx_program': if (!main) main = body(b); else main += body(b); break;
        case 'rcx_my_command': {
          const n = cname(b.getFieldValue('NAME'));
          if (seenSubs.has(n)) break;
          seenSubs.add(n);
          subs.push('sub ' + n + '()\n{\n' + body(b) + '}\n');
          break;
        }
        case 'rcx_touch_watcher': {
          const s = useSensor(b, 'SENSOR_TOUCH'), on = b.getFieldValue('STATE') === 'PRESSED' ? 1 : 0;
          const n = 'watcher_' + (++w);
          tasks.push('task ' + n + '()\n{\n    while (true)\n    {\n        until (' + s + ' == ' + on + ');\n' + ind(body(b)) + '        until (' + s + ' == ' + (1 - on) + ');\n    }\n}\n');
          starts.push(n); break;
        }
        case 'rcx_light_watcher': {
          const s = useSensor(b, 'SENSOR_LIGHT'), lvl = b.getFieldValue('LEVEL'), gt = b.getFieldValue('DIR') === 'GT';
          const n = 'watcher_' + (++w);
          tasks.push('task ' + n + '()\n{\n    while (true)\n    {\n        until (' + s + (gt ? ' > ' : ' < ') + lvl + ');\n' + ind(body(b)) + '        until (' + s + (gt ? ' <= ' : ' >= ') + lvl + ');\n    }\n}\n');
          starts.push(n); break;
        }
        case 'rcx_timer_watcher': {
          const n = 'watcher_' + (++w);
          tasks.push('task ' + n + '()\n{\n    while (true)\n    {\n' + ind(body(b)) + '        Wait(' + sec(b.getFieldValue('SECS')) + ');\n    }\n}\n');
          starts.push(n); break;
        }
        case 'rcx_message_watcher': {
          const n = 'watcher_' + (++w), m = b.getFieldValue('MSG');
          tasks.push('task ' + n + '()\n{\n    while (true)\n    {\n        until (Message() == ' + m + ');\n        ClearMessage();\n' + ind(body(b)) + '    }\n}\n');
          starts.push(n); break;
        }
        default: break;   // loose blocks are ignored, like RIS
      }
    }
    const lines = ['// Generated by OpenRCX Workbench from blocks', ''];
    const vars = Array.from(state.vars.keys());
    if (vars.length) lines.push('int ' + vars.join(', ') + ';', '');
    for (const s of subs) lines.push(s);
    for (const t of tasks) lines.push(t);
    let setup = '';
    for (const [p, type] of Array.from(state.sensors.entries()).sort((a, b) => a[0] - b[0])) setup += G.INDENT + 'SetSensor(SENSOR_' + (p + 1) + ', ' + type + ');\n';
    for (const v of vars) setup += G.INDENT + v + ' = 0;\n';
    for (const n of starts) setup += G.INDENT + 'start ' + n + ';\n';
    lines.push('task main()', '{', setup + (main || ''), '}', '');
    return lines.join('\n');
  }

  /* Example programs.  chain() nests a list of blocks into Blockly's next/next/next form. */
  const chain = list => { let cur = null; for (let i = list.length - 1; i >= 0; i--) { cur = cur ? Object.assign({}, list[i], { next: { block: cur } }) : list[i]; } return cur; };
  const blk = (type, fields, inputs) => { const o = { type }; if (fields) o.fields = fields; if (inputs) o.inputs = inputs; return o; };
  const hat = (type, x, y, fields, body) => Object.assign(blk(type, fields), { x, y, inputs: { DO: { block: chain(body) } } });
  const V = name => ({ VAR: { id: 'v_' + name, name } });
  const numv = n => ({ block: blk('math_number', { NUM: n }) });

  const starter = { blocks: { languageVersion: 0, blocks: [
    hat('rcx_program', 40, 40, null, [
      blk('rcx_play_sound', { SOUND: 'SOUND_UP' }),
      blk('rcx_motor_power', { OUT: 'OUT_A', POWER: '7' }),
      blk('rcx_motor_on', { OUT: 'OUT_A', DIR: 'FWD' }),
      blk('rcx_wait', { SECS: 2 }),
      blk('rcx_motor_off', { OUT: 'OUT_A', HOW: 'OFF' }),
      blk('rcx_play_sound', { SOUND: 'SOUND_DOUBLE_BEEP' })]),
    hat('rcx_touch_watcher', 420, 40, { PORT: '0', STATE: 'PRESSED' }, [
      blk('rcx_play_sound', { SOUND: 'SOUND_CLICK' }),
      blk('rcx_motor_on', { OUT: 'OUT_A', DIR: 'REV' }),
      blk('rcx_wait', { SECS: 1 }),
      blk('rcx_motor_off', { OUT: 'OUT_A', HOW: 'OFF' })]),
  ] } };

  const examples = [
    { name: 'Starter: drive and bump', json: starter },
    { name: 'Line follower', json: { blocks: { languageVersion: 0, blocks: [
      hat('rcx_program', 40, 40, null, [
        blk('rcx_motor_power', { OUT: 'OUT_A + OUT_C', POWER: '4' }),
        blk('rcx_forever', null, { DO: { block:
          blk('rcx_if_else', null, {
            COND: { block: blk('logic_compare', { OP: 'LT' }, { A: { block: blk('rcx_light_value', { PORT: '1' }) }, B: numv(45) }) },
            DO: { block: chain([blk('rcx_motor_on', { OUT: 'OUT_A', DIR: 'FWD' }), blk('rcx_motor_off', { OUT: 'OUT_C', HOW: 'OFF' })]) },
            ELSE: { block: chain([blk('rcx_motor_on', { OUT: 'OUT_C', DIR: 'FWD' }), blk('rcx_motor_off', { OUT: 'OUT_A', HOW: 'OFF' })]) } }) } })]),
    ] } } },
    { name: 'Count presses with a variable', json: { blocks: { languageVersion: 0, blocks: [
      hat('rcx_program', 40, 40, null, [
        blk('variables_set', V('count'), { VALUE: numv(0) }),
        blk('rcx_display_value', null, { VAL: { block: blk('variables_get', V('count')) } })]),
      hat('rcx_touch_watcher', 40, 240, { PORT: '0', STATE: 'PRESSED' }, [
        blk('math_change', V('count'), { DELTA: { shadow: blk('math_number', { NUM: 1 }) } }),
        blk('rcx_display_value', null, { VAL: { block: blk('variables_get', V('count')) } }),
        blk('rcx_play_sound', { SOUND: 'SOUND_CLICK' })]),
    ] }, variables: [{ name: 'count', id: 'v_count' }] } },
    { name: 'Timer watcher: beep every 5 s', json: { blocks: { languageVersion: 0, blocks: [
      hat('rcx_program', 40, 40, null, [blk('rcx_display', { WHAT: 'DISPLAY_WATCH' })]),
      hat('rcx_timer_watcher', 40, 200, { SECS: 5 }, [blk('rcx_play_tone', { HZ: 880, SECS: 0.2 })]),
    ] } } },
  ];

  ns.blocks = { toolbox, themeFor, generate, generator: G, starter, examples, colours: C };
})(OpenRCX);
