/* OpenNXT - block programming modelled on NXT-G's palette, generating NXC.
 * Palette: Common (Move, Sound, Display, Wait, Loop, Switch), Action (Motor, Send
 * message), Sensor (touch, light, sound, ultrasonic, colour, rotation, timer,
 * buttons, receive message), Flow (stop), Data (logic, math, compare, range,
 * random, variables, text), Advanced (reset motor, file logging), My Blocks. */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
(function (ns) {
  'use strict';
  if (typeof Blockly === 'undefined') { ns.blocks = null; return; }

  // NXT-G palette colours: Common green, Action green, Sensor yellow, Flow orange, Data red, Advanced blue
  const C = { program: '#5a7d2a', common: '#3f9a3f', action: '#2e9e5b', sensor: '#d4a017', flow: '#e8871e',
    data: '#c0392b', advanced: '#2f7ed8', my: '#7a5230', math: '#5c7cfa', vars: '#c2185b' };
  const PORTS = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']];
  const MOTOR = [['A', 'OUT_A'], ['B', 'OUT_B'], ['C', 'OUT_C']];
  const PAIRS = [['B + C', 'OUT_BC'], ['A + B', 'OUT_AB'], ['A + C', 'OUT_AC'], ['A + B + C', 'OUT_ABC']];
  const DURATION = [['unlimited', 'UNLIMITED'], ['degrees', 'DEGREES'], ['rotations', 'ROTATIONS'], ['seconds', 'SECONDS']];
  const THEN = [['brake', 'BRAKE'], ['coast', 'COAST']];
  const LINES = [1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), 'LCD_LINE' + n]);
  const NOTES = [['C4', 'TONE_C4'], ['D4', 'TONE_D4'], ['E4', 'TONE_E4'], ['F4', 'TONE_F4'], ['G4', 'TONE_G4'], ['A4', 'TONE_A4'], ['B4', 'TONE_B4'],
    ['C5', 'TONE_C5'], ['D5', 'TONE_D5'], ['E5', 'TONE_E5'], ['F5', 'TONE_F5'], ['G5', 'TONE_G5'], ['A5', 'TONE_A5'], ['B5', 'TONE_B5'], ['C6', 'TONE_C6']];
  const COLORS = [['black', 'INPUT_BLACKCOLOR'], ['blue', 'INPUT_BLUECOLOR'], ['green', 'INPUT_GREENCOLOR'], ['yellow', 'INPUT_YELLOWCOLOR'], ['red', 'INPUT_REDCOLOR'], ['white', 'INPUT_WHITECOLOR']];
  const BUTTONS = [['orange (enter)', 'BTNCENTER'], ['left arrow', 'BTNLEFT'], ['right arrow', 'BTNRIGHT'], ['grey (exit)', 'BTNEXIT']];
  const CMP = [['<', 'LT'], ['>', 'GT'], ['=', 'EQ'], ['≠', 'NEQ']];

  Blockly.defineBlocksWithJsonArray([
    // ---- program
    { type: 'nxt_program', message0: 'when program starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.program, hat: 'cap', tooltip: 'The main sequence beam.' },
    { type: 'nxt_parallel', message0: 'also run at the same time %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.program, hat: 'cap', tooltip: 'A second sequence beam: its blocks run in parallel with the main one (an NXC task).' },
    { type: 'nxt_my_block', message0: 'my block %1 %2 %3', args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.my, hat: 'cap', tooltip: 'A reusable group of blocks (NXC subroutine).' },
    { type: 'nxt_call_my_block', message0: 'run my block %1', args0: [{ type: 'field_input', name: 'NAME', text: 'dance' }], previousStatement: null, nextStatement: null, colour: C.my },

    // ---- common: move, sound, display, wait, loop, switch
    { type: 'nxt_move', message0: 'move %1 %2 steering %3 power %4 for %5 %6 then %7',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: PAIRS }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['backward', 'REV']] },
        { type: 'field_number', name: 'STEER', value: 0, min: -100, max: 100, precision: 1 }, { type: 'field_number', name: 'POWER', value: 75, min: 0, max: 100, precision: 1 },
        { type: 'field_number', name: 'AMOUNT', value: 1, min: 0, precision: 0.01 }, { type: 'field_dropdown', name: 'UNIT', options: DURATION }, { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.common, tooltip: 'NXT-G Move block: two motors in sync. Steering -100 (spin left) … 0 (straight) … 100 (spin right). "unlimited" keeps going until another motor block.' },
    { type: 'nxt_motor', message0: 'motor %1 %2 power %3 for %4 %5 then %6',
      args0: [{ type: 'field_dropdown', name: 'OUT', options: MOTOR }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['backward', 'REV']] },
        { type: 'field_number', name: 'POWER', value: 75, min: 0, max: 100, precision: 1 }, { type: 'field_number', name: 'AMOUNT', value: 1, min: 0, precision: 0.01 },
        { type: 'field_dropdown', name: 'UNIT', options: DURATION }, { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.action, tooltip: 'NXT-G Motor block: one motor.' },
    { type: 'nxt_stop_motors', message0: 'stop motors %1 %2', args0: [{ type: 'field_dropdown', name: 'OUT', options: MOTOR.concat(PAIRS) }, { type: 'field_dropdown', name: 'THEN', options: THEN }],
      previousStatement: null, nextStatement: null, colour: C.action },
    { type: 'nxt_tone', message0: 'play note %1 for %2 seconds %3', args0: [{ type: 'field_dropdown', name: 'NOTE', options: NOTES }, { type: 'field_number', name: 'SECS', value: 0.5, min: 0.01, precision: 0.01 }, { type: 'field_dropdown', name: 'WAIT', options: [['and wait', 'WAIT'], ['and carry on', 'GO']] }],
      previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_tone_hz', message0: 'play tone %1 Hz for %2 seconds', args0: [{ type: 'input_value', name: 'HZ', check: 'Number' }, { type: 'field_number', name: 'SECS', value: 0.5, min: 0.01, precision: 0.01 }],
      previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_sound_file', message0: 'play sound file %1 %2', args0: [{ type: 'field_input', name: 'FILE', text: 'Woops.rso' }, { type: 'field_dropdown', name: 'WAIT', options: [['and wait', 'WAIT'], ['and carry on', 'GO']] }],
      previousStatement: null, nextStatement: null, colour: C.common, tooltip: 'A .rso file stored on the brick (upload it in the Files section).' },
    { type: 'nxt_display_text', message0: 'display %1 on line %2', args0: [{ type: 'input_value', name: 'TEXT' }, { type: 'field_dropdown', name: 'LINE', options: LINES }],
      previousStatement: null, nextStatement: null, colour: C.common, tooltip: 'Text or a number on one of the 8 screen lines.' },
    { type: 'nxt_display_clear', message0: 'clear the display', previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_display_picture', message0: 'display picture %1', args0: [{ type: 'field_input', name: 'FILE', text: 'Smile.ric' }], previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_wait', message0: 'wait %1 seconds', args0: [{ type: 'field_number', name: 'SECS', value: 1, min: 0.01, precision: 0.01 }], previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_wait_until', message0: 'wait until %1', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }], previousStatement: null, nextStatement: null, colour: C.common },
    { type: 'nxt_loop_forever', message0: 'loop forever %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_loop_count', message0: 'loop %1 times %2 %3', args0: [{ type: 'field_number', name: 'N', value: 4, min: 1, precision: 1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_loop_while', message0: 'loop %1 %2 %3 %4', args0: [{ type: 'field_dropdown', name: 'MODE', options: [['while', 'WHILE'], ['until', 'UNTIL']] }, { type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_loop_seconds', message0: 'loop for %1 seconds %2 %3', args0: [{ type: 'field_number', name: 'SECS', value: 5, min: 0.1, precision: 0.1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_switch', message0: 'switch: if %1 %2 %3 else %4 %5', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_if', message0: 'if %1 %2 %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: C.flow },
    { type: 'nxt_stop', message0: 'stop program', previousStatement: null, colour: C.flow },
    { type: 'nxt_send_message', message0: 'send %1 to mailbox %2', args0: [{ type: 'input_value', name: 'MSG' }, { type: 'field_dropdown', name: 'BOX', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), 'MAILBOX' + n]) }], previousStatement: null, nextStatement: null, colour: C.action, tooltip: 'Bluetooth message to another brick or to the Workbench.' },

    // ---- sensors (values)
    { type: 'nxt_touch', message0: 'touch sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'STATE', options: [['pressed', 'PRESSED'], ['released', 'RELEASED']] }], output: 'Boolean', colour: C.sensor },
    { type: 'nxt_light', message0: 'light sensor %1 %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'LAMP', options: [['lamp on', 'ACTIVE'], ['ambient', 'PASSIVE']] }], output: 'Number', colour: C.sensor, tooltip: 'Brightness 0..100.' },
    { type: 'nxt_sound', message0: 'sound sensor %1', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }], output: 'Number', colour: C.sensor, tooltip: 'Loudness 0..100.' },
    { type: 'nxt_ultrasonic', message0: 'ultrasonic sensor %1 cm', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }], output: 'Number', colour: C.sensor, tooltip: 'Distance in cm (255 = nothing in range).' },
    { type: 'nxt_color', message0: 'colour sensor %1 sees %2', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }, { type: 'field_dropdown', name: 'COLOR', options: COLORS }], output: 'Boolean', colour: C.sensor, tooltip: 'NXT 2.0 colour sensor.' },
    { type: 'nxt_color_value', message0: 'colour sensor %1 colour number', args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }], output: 'Number', colour: C.sensor, tooltip: '1 black, 2 blue, 3 green, 4 yellow, 5 red, 6 white.' },
    { type: 'nxt_rotation', message0: 'motor %1 degrees turned', args0: [{ type: 'field_dropdown', name: 'OUT', options: MOTOR }], output: 'Number', colour: C.sensor, tooltip: 'The motor\'s built-in rotation sensor.' },
    { type: 'nxt_reset_rotation', message0: 'reset motor %1 degrees', args0: [{ type: 'field_dropdown', name: 'OUT', options: MOTOR }], previousStatement: null, nextStatement: null, colour: C.advanced },
    { type: 'nxt_timer', message0: 'timer %1 seconds', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '1'], ['2', '2'], ['3', '3']] }], output: 'Number', colour: C.sensor },
    { type: 'nxt_timer_reset', message0: 'reset timer %1', args0: [{ type: 'field_dropdown', name: 'T', options: [['1', '1'], ['2', '2'], ['3', '3']] }], previousStatement: null, nextStatement: null, colour: C.sensor },
    { type: 'nxt_button', message0: 'NXT button %1 pressed', args0: [{ type: 'field_dropdown', name: 'BTN', options: BUTTONS }], output: 'Boolean', colour: C.sensor },
    { type: 'nxt_receive_message', message0: 'message in mailbox %1', args0: [{ type: 'field_dropdown', name: 'BOX', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), 'MAILBOX' + n]) }], output: 'String', colour: C.sensor, tooltip: 'The waiting message, or "" if none.' },
    { type: 'nxt_battery', message0: 'battery millivolts', output: 'Number', colour: C.sensor },
    { type: 'nxt_random', message0: 'random number from %1 to %2', args0: [{ type: 'field_number', name: 'A', value: 1, precision: 1 }, { type: 'field_number', name: 'B', value: 100, precision: 1 }], output: 'Number', colour: C.data },
    { type: 'nxt_range', message0: '%1 is between %2 and %3', args0: [{ type: 'input_value', name: 'V', check: 'Number' }, { type: 'field_number', name: 'A', value: 0, precision: 1 }, { type: 'field_number', name: 'B', value: 50, precision: 1 }], output: 'Boolean', colour: C.data, inputsInline: true },
    { type: 'nxt_compare', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'field_dropdown', name: 'OP', options: CMP }, { type: 'input_value', name: 'B', check: 'Number' }], output: 'Boolean', colour: C.data, inputsInline: true },
    { type: 'nxt_text', message0: '“ %1 ”', args0: [{ type: 'field_input', name: 'TEXT', text: 'hello' }], output: 'String', colour: C.data },
    { type: 'nxt_text_join', message0: 'join %1 %2', args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }], output: 'String', colour: C.data, inputsInline: true },
    { type: 'nxt_file_write', message0: 'write %1 to file %2', args0: [{ type: 'input_value', name: 'V' }, { type: 'field_input', name: 'FILE', text: 'log.txt' }], previousStatement: null, nextStatement: null, colour: C.advanced, tooltip: 'Data logging: one line per call. Download the file from the Files section afterwards.' },
    { type: 'nxt_keep_alive', message0: 'keep the brick awake', previousStatement: null, nextStatement: null, colour: C.advanced },
  ]);

  const toolbox = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: 'Program', colour: C.program, contents: [{ kind: 'block', type: 'nxt_program' }, { kind: 'block', type: 'nxt_parallel' }] },
    { kind: 'category', name: 'Common', colour: C.common, contents: [
      { kind: 'block', type: 'nxt_move' }, { kind: 'block', type: 'nxt_tone' }, { kind: 'block', type: 'nxt_sound_file' },
      { kind: 'block', type: 'nxt_display_text', inputs: { TEXT: { shadow: { type: 'nxt_text', fields: { TEXT: 'hello' } } } } },
      { kind: 'block', type: 'nxt_display_clear' }, { kind: 'block', type: 'nxt_wait' }, { kind: 'block', type: 'nxt_wait_until' },
      { kind: 'block', type: 'nxt_loop_forever' }, { kind: 'block', type: 'nxt_loop_count' }, { kind: 'block', type: 'nxt_switch' }] },
    { kind: 'category', name: 'Action', colour: C.action, contents: [
      { kind: 'block', type: 'nxt_motor' }, { kind: 'block', type: 'nxt_stop_motors' }, { kind: 'block', type: 'nxt_tone_hz', inputs: { HZ: { shadow: { type: 'math_number', fields: { NUM: 440 } } } } },
      { kind: 'block', type: 'nxt_display_picture' }, { kind: 'block', type: 'nxt_send_message', inputs: { MSG: { shadow: { type: 'nxt_text', fields: { TEXT: 'hi' } } } } }] },
    { kind: 'category', name: 'Sensor', colour: C.sensor, contents: [
      { kind: 'block', type: 'nxt_touch' }, { kind: 'block', type: 'nxt_light' }, { kind: 'block', type: 'nxt_sound' }, { kind: 'block', type: 'nxt_ultrasonic' },
      { kind: 'block', type: 'nxt_color' }, { kind: 'block', type: 'nxt_color_value' }, { kind: 'block', type: 'nxt_rotation' }, { kind: 'block', type: 'nxt_timer' },
      { kind: 'block', type: 'nxt_timer_reset' }, { kind: 'block', type: 'nxt_button' }, { kind: 'block', type: 'nxt_receive_message' }, { kind: 'block', type: 'nxt_battery' }] },
    { kind: 'category', name: 'Flow', colour: C.flow, contents: [
      { kind: 'block', type: 'nxt_loop_forever' }, { kind: 'block', type: 'nxt_loop_count' }, { kind: 'block', type: 'nxt_loop_while' }, { kind: 'block', type: 'nxt_loop_seconds' },
      { kind: 'block', type: 'nxt_switch' }, { kind: 'block', type: 'nxt_if' }, { kind: 'block', type: 'nxt_stop' }] },
    { kind: 'category', name: 'Data', colour: C.data, contents: [
      { kind: 'block', type: 'math_number', fields: { NUM: 0 } }, { kind: 'block', type: 'math_arithmetic' }, { kind: 'block', type: 'nxt_compare' },
      { kind: 'block', type: 'nxt_range' }, { kind: 'block', type: 'nxt_random' }, { kind: 'block', type: 'logic_operation' }, { kind: 'block', type: 'logic_negate' },
      { kind: 'block', type: 'logic_boolean' }, { kind: 'block', type: 'nxt_text' }, { kind: 'block', type: 'nxt_text_join' }] },
    { kind: 'category', name: 'Variables', colour: C.vars, custom: 'VARIABLE' },
    { kind: 'category', name: 'Advanced', colour: C.advanced, contents: [{ kind: 'block', type: 'nxt_reset_rotation' }, { kind: 'block', type: 'nxt_file_write', inputs: { V: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } }, { kind: 'block', type: 'nxt_keep_alive' }] },
    { kind: 'category', name: 'My blocks', colour: C.my, contents: [{ kind: 'block', type: 'nxt_my_block' }, { kind: 'block', type: 'nxt_call_my_block' }] },
  ] };

  const base = Blockly.Theme.defineTheme('opennxt', { base: Blockly.Themes.Zelos,
    blockStyles: { math_blocks: { colourPrimary: C.data }, logic_blocks: { colourPrimary: C.data }, variable_blocks: { colourPrimary: C.vars }, variable_dynamic_blocks: { colourPrimary: C.vars }, text_blocks: { colourPrimary: C.data } },
    fontStyle: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', weight: '600', size: 11 }, startHats: true });
  function themeFor(dark) {
    return Blockly.Theme.defineTheme(dark ? 'opennxt_dark' : 'opennxt_light', { base,
      componentStyles: dark ? { workspaceBackgroundColour: '#1b2129', toolboxBackgroundColour: '#12161b', toolboxForegroundColour: '#e5e9ee', flyoutBackgroundColour: '#232b35', flyoutForegroundColour: '#e5e9ee', flyoutOpacity: 0.97, scrollbarColour: '#98a4b2', insertionMarkerColour: '#fff', insertionMarkerOpacity: 0.3 }
        : { workspaceBackgroundColour: '#f4f6f8', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#18212b', flyoutBackgroundColour: '#e9ecf0', flyoutForegroundColour: '#18212b', flyoutOpacity: 0.97, scrollbarColour: '#5e6b7a' } });
  }

  /* ------------------------------------------------------------ NXC generator */
  const G = new Blockly.Generator('NXC');
  G.INDENT = '    ';
  const O = { ATOMIC: 0, UNARY: 2, MUL: 3, ADD: 4, REL: 6, EQ: 7, AND: 11, OR: 12, NONE: 99 };
  G.scrub_ = function (block, code, thisOnly) { const next = block.nextConnection && block.nextConnection.targetBlock(); return thisOnly || !next ? code : code + this.blockToCode(next); };
  const st = { sensors: new Map(), vars: new Map(), timers: new Set(), files: new Set(), strings: 0 };
  const ms = v => Math.max(1, Math.round(Number(v) * 1000));
  const cname = s => { let n = String(s).replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z_]/.test(n)) n = '_' + n; return n || '_'; };
  const varName = (b, f) => { const id = b.getFieldValue(f); const v = b.workspace.getVariableById(id); const n = cname(v ? v.name : id); st.vars.set(n, true); return n; };
  const port = b => 'S' + b.getFieldValue('PORT');
  const useSensor = (b, setup) => { const p = port(b); if (!st.sensors.has(p)) st.sensors.set(p, setup.replace('%P', p)); return p; };
  const val = (b, n, d) => G.valueToCode(b, n, O.NONE) || String(d);
  const cond = (b, n) => G.valueToCode(b, n, O.NONE) || 'false';
  const body = b => G.statementToCode(b, 'DO');
  const ind = s => s ? G.prefixLines(s, G.INDENT) : '';
  const asString = (b, n) => {   // string expression; numbers get NumToStr()
    const target = b.getInputTargetBlock(n);
    if (!target) return '""';
    const code = G.valueToCode(b, n, O.NONE);
    const isStr = target.outputConnection && target.outputConnection.getCheck() && target.outputConnection.getCheck().includes('String');
    return isStr ? code : 'NumToStr(' + code + ')';
  };
  function motion(out, dir, power, unit, amount, then, steer) {
    const brake = then === 'BRAKE';
    const sign = dir === 'FWD' ? '' : '-';
    const sync = steer !== undefined;
    if (unit === 'UNLIMITED') return (sync ? (dir === 'FWD' ? 'OnFwdSync' : 'OnRevSync') + '(' + out + ', ' + power + ', ' + steer + ');\n' : (dir === 'FWD' ? 'OnFwd' : 'OnRev') + '(' + out + ', ' + power + ');\n');
    if (unit === 'SECONDS') return motion(out, dir, power, 'UNLIMITED', 0, then, steer) + 'Wait(' + ms(amount) + ');\n' + (brake ? 'Off' : 'Coast') + '(' + out + ');\n';
    const deg = unit === 'ROTATIONS' ? Math.round(Number(amount) * 360) : Math.round(Number(amount));
    return sync ? 'RotateMotorEx(' + out + ', ' + sign + power + ', ' + deg + ', ' + steer + ', true, ' + (brake ? 'true' : 'false') + ');\n'
      : 'RotateMotor(' + out + ', ' + sign + power + ', ' + deg + ');\n' + (brake ? '' : 'Coast(' + out + ');\n');
  }
  const F = G.forBlock;
  F.nxt_move = b => motion(b.getFieldValue('OUT'), b.getFieldValue('DIR'), b.getFieldValue('POWER'), b.getFieldValue('UNIT'), b.getFieldValue('AMOUNT'), b.getFieldValue('THEN'), b.getFieldValue('STEER'));
  F.nxt_motor = b => motion(b.getFieldValue('OUT'), b.getFieldValue('DIR'), b.getFieldValue('POWER'), b.getFieldValue('UNIT'), b.getFieldValue('AMOUNT'), b.getFieldValue('THEN'));
  F.nxt_stop_motors = b => (b.getFieldValue('THEN') === 'BRAKE' ? 'Off' : 'Coast') + '(' + b.getFieldValue('OUT') + ');\n';
  F.nxt_tone = b => 'PlayTone(' + b.getFieldValue('NOTE') + ', ' + ms(b.getFieldValue('SECS')) + ');\n' + (b.getFieldValue('WAIT') === 'WAIT' ? 'Wait(' + ms(b.getFieldValue('SECS')) + ');\n' : '');
  F.nxt_tone_hz = b => 'PlayTone(' + val(b, 'HZ', 440) + ', ' + ms(b.getFieldValue('SECS')) + ');\nWait(' + ms(b.getFieldValue('SECS')) + ');\n';
  F.nxt_sound_file = b => 'PlayFile("' + b.getFieldValue('FILE') + '");\n' + (b.getFieldValue('WAIT') === 'WAIT' ? 'until (SoundFlags() == SOUND_FLAGS_IDLE);\n' : '');
  F.nxt_display_text = b => 'TextOut(0, ' + b.getFieldValue('LINE') + ', ' + asString(b, 'TEXT') + ', DRAW_OPT_CLEAR_EOL);\n';
  F.nxt_display_clear = () => 'ClearScreen();\n';
  F.nxt_display_picture = b => 'GraphicOut(0, 0, "' + b.getFieldValue('FILE') + '");\n';
  F.nxt_wait = b => 'Wait(' + ms(b.getFieldValue('SECS')) + ');\n';
  F.nxt_wait_until = b => 'until (' + cond(b, 'COND') + ');\n';
  F.nxt_loop_forever = b => 'while (true)\n{\n' + body(b) + '}\n';
  F.nxt_loop_count = b => 'repeat (' + b.getFieldValue('N') + ')\n{\n' + body(b) + '}\n';
  F.nxt_loop_while = b => (b.getFieldValue('MODE') === 'WHILE' ? 'while (' + cond(b, 'COND') + ')' : 'while (!(' + cond(b, 'COND') + '))') + '\n{\n' + body(b) + '}\n';
  F.nxt_loop_seconds = b => { const t = '__loopEnd' + (st.strings++); st.vars.set(t, 'long'); return t + ' = CurrentTick() + ' + ms(b.getFieldValue('SECS')) + ';\nwhile (CurrentTick() < ' + t + ')\n{\n' + body(b) + '}\n'; };
  F.nxt_switch = b => 'if (' + cond(b, 'COND') + ')\n{\n' + body(b) + '}\nelse\n{\n' + G.statementToCode(b, 'ELSE') + '}\n';
  F.nxt_if = b => 'if (' + cond(b, 'COND') + ')\n{\n' + body(b) + '}\n';
  F.nxt_stop = () => 'StopAllTasks();\n';
  F.nxt_send_message = b => 'SendMessage(' + b.getFieldValue('BOX') + ', ' + asString(b, 'MSG') + ');\n';
  F.nxt_touch = b => ['(' + useSensor(b, 'SetSensorTouch(%P);') + ' == ' + (b.getFieldValue('STATE') === 'PRESSED' ? 1 : 0) + ')', O.ATOMIC];
  F.nxt_light = b => [useSensor(b, b.getFieldValue('LAMP') === 'ACTIVE' ? 'SetSensorLight(%P);' : 'SetSensorLight(%P, false);'), O.ATOMIC];
  F.nxt_sound = b => [useSensor(b, 'SetSensorSound(%P);'), O.ATOMIC];
  F.nxt_ultrasonic = b => ['SensorUS(' + useSensor(b, 'SetSensorLowspeed(%P);') + ')', O.ATOMIC];
  F.nxt_color = b => ['(Sensor(' + useSensor(b, 'SetSensorColorFull(%P);') + ') == ' + b.getFieldValue('COLOR') + ')', O.ATOMIC];
  F.nxt_color_value = b => ['Sensor(' + useSensor(b, 'SetSensorColorFull(%P);') + ')', O.ATOMIC];
  F.nxt_rotation = b => ['MotorRotationCount(' + b.getFieldValue('OUT') + ')', O.ATOMIC];
  F.nxt_reset_rotation = b => 'ResetRotationCount(' + b.getFieldValue('OUT') + ');\n';
  F.nxt_timer = b => { st.timers.add(b.getFieldValue('T')); return ['((CurrentTick() - __timer' + b.getFieldValue('T') + ') / 1000)', O.ATOMIC]; };
  F.nxt_timer_reset = b => { st.timers.add(b.getFieldValue('T')); return '__timer' + b.getFieldValue('T') + ' = CurrentTick();\n'; };
  F.nxt_button = b => ['ButtonPressed(' + b.getFieldValue('BTN') + ', false)', O.ATOMIC];
  F.nxt_receive_message = b => { st.strings++; return ['__msg(' + b.getFieldValue('BOX') + ')', O.ATOMIC]; };
  F.nxt_battery = () => ['BatteryLevel()', O.ATOMIC];
  F.nxt_random = b => { const a = Number(b.getFieldValue('A')), c = Number(b.getFieldValue('B')); const lo = Math.min(a, c), hi = Math.max(a, c); return ['(' + lo + ' + Random(' + (hi - lo + 1) + '))', O.ATOMIC]; };
  F.nxt_range = b => { const v = val(b, 'V', 0); return ['(' + v + ' >= ' + b.getFieldValue('A') + ' && ' + v + ' <= ' + b.getFieldValue('B') + ')', O.ATOMIC]; };
  F.nxt_compare = b => { const op = { LT: '<', GT: '>', EQ: '==', NEQ: '!=' }[b.getFieldValue('OP')]; return ['(' + val(b, 'A', 0) + ' ' + op + ' ' + val(b, 'B', 0) + ')', O.ATOMIC]; };
  F.nxt_text = b => ['"' + b.getFieldValue('TEXT').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"', O.ATOMIC];
  F.nxt_text_join = b => ['StrCat(' + asString(b, 'A') + ', ' + asString(b, 'B') + ')', O.ATOMIC];
  F.nxt_file_write = b => { const f = b.getFieldValue('FILE'); st.files.add(f); return '__fileWrite("' + f + '", ' + asString(b, 'V') + ');\n'; };
  F.nxt_keep_alive = () => 'ResetSleepTimer();\n';
  F.nxt_call_my_block = b => cname(b.getFieldValue('NAME')) + '();\n';
  F.math_number = b => [String(Math.round(Number(b.getFieldValue('NUM')))), O.ATOMIC];
  F.math_arithmetic = b => { const op = { ADD: [' + ', O.ADD], MINUS: [' - ', O.ADD], MULTIPLY: [' * ', O.MUL], DIVIDE: [' / ', O.MUL], POWER: null }[b.getFieldValue('OP')]; if (!op) return ['0', O.ATOMIC]; return ['(' + (G.valueToCode(b, 'A', op[1]) || '0') + op[0] + (G.valueToCode(b, 'B', op[1]) || '0') + ')', O.ATOMIC]; };
  F.logic_compare = b => { const op = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[b.getFieldValue('OP')]; return ['(' + val(b, 'A', 0) + ' ' + op + ' ' + val(b, 'B', 0) + ')', O.ATOMIC]; };
  F.logic_operation = b => ['(' + cond(b, 'A') + (b.getFieldValue('OP') === 'AND' ? ' && ' : ' || ') + cond(b, 'B') + ')', O.ATOMIC];
  F.logic_negate = b => ['!' + (G.valueToCode(b, 'BOOL', O.UNARY) || 'false'), O.UNARY];
  F.logic_boolean = b => [b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', O.ATOMIC];
  F.variables_get = b => [varName(b, 'VAR'), O.ATOMIC];
  F.variables_set = b => varName(b, 'VAR') + ' = ' + val(b, 'VALUE', 0) + ';\n';
  F.math_change = b => varName(b, 'VAR') + ' += ' + val(b, 'DELTA', 1) + ';\n';
  ['nxt_program', 'nxt_parallel', 'nxt_my_block'].forEach(t => { F[t] = () => ''; });

  function generate(ws) {
    st.sensors = new Map(); st.vars = new Map(); st.timers = new Set(); st.files = new Set(); st.strings = 0;
    const tops = ws.getTopBlocks(true).filter(b => b.isEnabled());
    const tasks = [], subs = [], seen = new Set();
    let main = '', n = 0;
    for (const b of tops) {
      if (b.type === 'nxt_program') main += body(b);
      else if (b.type === 'nxt_parallel') { n++; tasks.push('task beam' + n + '()\n{\n' + body(b) + '}\n'); }
      else if (b.type === 'nxt_my_block') { const nm = cname(b.getFieldValue('NAME')); if (!seen.has(nm)) { seen.add(nm); subs.push('sub ' + nm + '()\n{\n' + body(b) + '}\n'); } }
    }
    const lines = ['// Generated by OpenNXT Workbench from blocks', ''];
    const decl = [];
    for (const [v, t] of st.vars) decl.push((t === 'long' ? 'long ' : 'int ') + v + ';');
    for (const t of st.timers) decl.push('long __timer' + t + ';');
    if (decl.length) lines.push(...decl, '');
    if (st.strings) lines.push('string __msg(byte box)\n{\n    string s = "";\n    ReceiveMessage(box, true, s);\n    return s;\n}\n');
    if (st.files.size) lines.push('byte __fileHandle;\nbool __fileOpen = false;\n\nvoid __fileWrite(string name, string line)\n{\n    unsigned int size = 4096;\n    if (!__fileOpen) { DeleteFile(name); CreateFile(name, size, __fileHandle); __fileOpen = true; }\n    WriteLnString(__fileHandle, line, size);\n}\n');
    for (const s of subs) lines.push(s);
    for (const t of tasks) lines.push(t);
    let setup = '';
    for (const s of st.sensors.values()) setup += G.INDENT + s + '\n';
    for (const t of st.timers) setup += G.INDENT + '__timer' + t + ' = CurrentTick();\n';
    if (tasks.length) {
      lines.push('task mainBeam()', '{', main.replace(/\n$/, ''), '}', '');
      lines.push('task main()', '{', setup + G.INDENT + 'Precedes(mainBeam, ' + tasks.map((_, i) => 'beam' + (i + 1)).join(', ') + ');', '}', '');
    } else {
      lines.push('task main()', '{', setup + main.replace(/\n$/, ''), '}', '');
    }
    return lines.join('\n');
  }

  const chain = list => { let cur = null; for (let i = list.length - 1; i >= 0; i--) cur = cur ? Object.assign({}, list[i], { next: { block: cur } }) : list[i]; return cur; };
  const blk = (type, fields, inputs) => { const o = { type }; if (fields) o.fields = fields; if (inputs) o.inputs = inputs; return o; };
  const hat = (type, x, y, fields, list) => Object.assign(blk(type, fields), { x, y, inputs: { DO: { block: chain(list) } } });
  const txt = s => ({ shadow: blk('nxt_text', { TEXT: s }) });
  const num = n => ({ shadow: blk('math_number', { NUM: n }) });
  const starter = { blocks: { languageVersion: 0, blocks: [
    hat('nxt_program', 40, 40, null, [
      blk('nxt_display_text', { LINE: 'LCD_LINE1' }, { TEXT: txt('OpenNXT says hi') }),
      blk('nxt_tone', { NOTE: 'TONE_C5', SECS: 0.3, WAIT: 'WAIT' }),
      blk('nxt_move', { OUT: 'OUT_BC', DIR: 'FWD', STEER: 0, POWER: 75, AMOUNT: 1, UNIT: 'ROTATIONS', THEN: 'BRAKE' }),
      blk('nxt_wait', { SECS: 0.5 }),
      blk('nxt_move', { OUT: 'OUT_BC', DIR: 'REV', STEER: 0, POWER: 75, AMOUNT: 1, UNIT: 'ROTATIONS', THEN: 'BRAKE' }),
      blk('nxt_tone', { NOTE: 'TONE_G5', SECS: 0.5, WAIT: 'WAIT' })]),
  ] } };
  const examples = [
    { name: 'Starter: say hi and drive', json: starter },
    { name: 'Bumper car (touch sensor)', json: { blocks: { languageVersion: 0, blocks: [
      hat('nxt_program', 40, 40, null, [
        blk('nxt_loop_forever', null, { DO: { block: chain([
          blk('nxt_move', { OUT: 'OUT_BC', DIR: 'FWD', STEER: 0, POWER: 75, AMOUNT: 0, UNIT: 'UNLIMITED', THEN: 'BRAKE' }),
          blk('nxt_wait_until', null, { COND: { block: blk('nxt_touch', { PORT: '1', STATE: 'PRESSED' }) } }),
          blk('nxt_tone', { NOTE: 'TONE_A4', SECS: 0.1, WAIT: 'GO' }),
          blk('nxt_move', { OUT: 'OUT_BC', DIR: 'REV', STEER: 0, POWER: 60, AMOUNT: 0.6, UNIT: 'SECONDS', THEN: 'BRAKE' }),
          blk('nxt_move', { OUT: 'OUT_BC', DIR: 'FWD', STEER: 100, POWER: 60, AMOUNT: 1, UNIT: 'ROTATIONS', THEN: 'BRAKE' })]) } })]),
    ] } } },
    { name: 'Wall avoider (ultrasonic)', json: { blocks: { languageVersion: 0, blocks: [
      hat('nxt_program', 40, 40, null, [
        blk('nxt_loop_forever', null, { DO: { block: chain([
          blk('nxt_display_text', { LINE: 'LCD_LINE1' }, { TEXT: { block: blk('nxt_ultrasonic', { PORT: '4' }) } }),
          blk('nxt_switch', null, { COND: { block: blk('nxt_compare', { OP: 'LT' }, { A: { block: blk('nxt_ultrasonic', { PORT: '4' }) }, B: num(25) }) },
            DO: { block: chain([blk('nxt_move', { OUT: 'OUT_BC', DIR: 'REV', STEER: 0, POWER: 50, AMOUNT: 0.4, UNIT: 'SECONDS', THEN: 'BRAKE' }), blk('nxt_move', { OUT: 'OUT_BC', DIR: 'FWD', STEER: 100, POWER: 50, AMOUNT: 300, UNIT: 'DEGREES', THEN: 'BRAKE' })]) },
            ELSE: { block: blk('nxt_move', { OUT: 'OUT_BC', DIR: 'FWD', STEER: 0, POWER: 75, AMOUNT: 0, UNIT: 'UNLIMITED', THEN: 'BRAKE' }) } })]) } })]),
    ] } } },
    { name: 'Two beams: drive and beep', json: { blocks: { languageVersion: 0, blocks: [
      hat('nxt_program', 40, 40, null, [blk('nxt_motor', { OUT: 'OUT_A', DIR: 'FWD', POWER: 75, AMOUNT: 2, UNIT: 'ROTATIONS', THEN: 'BRAKE' }), blk('nxt_wait', { SECS: 2 }), blk('nxt_motor', { OUT: 'OUT_A', DIR: 'REV', POWER: 75, AMOUNT: 2, UNIT: 'ROTATIONS', THEN: 'BRAKE' })]),
      hat('nxt_parallel', 40, 260, null, [blk('nxt_loop_count', { N: 5 }, { DO: { block: chain([blk('nxt_tone', { NOTE: 'TONE_E5', SECS: 0.05, WAIT: 'GO' }), blk('nxt_wait', { SECS: 1 })]) } })]),
    ] } } },
    { name: 'Count presses, log to file', json: { blocks: { languageVersion: 0, blocks: [
      hat('nxt_program', 40, 40, null, [
        blk('variables_set', { VAR: { id: 'v_count', name: 'count' } }, { VALUE: num(0) }),
        blk('nxt_loop_count', { N: 10 }, { DO: { block: chain([
          blk('nxt_wait_until', null, { COND: { block: blk('nxt_touch', { PORT: '1', STATE: 'PRESSED' }) } }),
          blk('math_change', { VAR: { id: 'v_count', name: 'count' } }, { DELTA: num(1) }),
          blk('nxt_display_text', { LINE: 'LCD_LINE2' }, { TEXT: { block: blk('variables_get', { VAR: { id: 'v_count', name: 'count' } }) } }),
          blk('nxt_file_write', { FILE: 'log.txt' }, { V: { block: blk('nxt_timer', { T: '1' }) } }),
          blk('nxt_wait_until', null, { COND: { block: blk('nxt_touch', { PORT: '1', STATE: 'RELEASED' }) } })]) } })]),
    ] }, variables: [{ name: 'count', id: 'v_count' }] } },
  ];

  ns.blocks = { toolbox, themeFor, generate, generator: G, starter, examples, colours: C };
})(OpenNXT);
