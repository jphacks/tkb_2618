const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join } = require('node:path')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const root = process.env.DESKAPI_TEST_OUTPUT
const { scanKey } = require(join(root, 'main/virtual-keys.js'))
const { hotkeyInputs, mediaInputs, keyboardInputBuffer } = require(join(root, 'main/keyboard-input.js'))
const { normalizeHotkeyKey, migrateHotkeys, hotkeyLabel } = require(join(root, 'shared/hotkeys.js'))
const { DEFAULT_CONFIG } = require(join(root, 'shared/constants.js'))
const { ConfigStore } = require(join(root, 'main/config.js'))
test('physical codes use Set 1 positions including JIS OEM and IME keys', () => {
  const expected = { KeyA: 0x1e, KeyZ: 0x2c, Digit2: 0x03, Digit0: 0x0b,
    Equal: 0x0d, BracketLeft: 0x1a, BracketRight: 0x1b, Backslash: 0x2b,
    Semicolon: 0x27, Quote: 0x28, IntlYen: 0x7d, IntlRo: 0x73,
    Convert: 0x79, NonConvert: 0x7b, KanaMode: 0x70, Backquote: 0x29,
    Ctrl: 0x1d, Shift: 0x2a, Alt: 0x38, Enter: 0x1c,
    F1: 0x3b, F10: 0x44, F11: 0x57, F12: 0x58, F13: 0x64, F24: 0x76 }
  for (const [code, scan] of Object.entries(expected)) assert.deepEqual(scanKey(code), { scan, extended: false }, code)
  for (const code of ['Unknown', 'toString', '__proto__']) assert.throws(() => scanKey(code), /未対応/)
})
test('legacy keys migrate preserving old US semantics for ambiguous symbols', () => {
  for (const [old, code, scan] of [['a', 'KeyA', 0x1e], ['2', 'Digit2', 0x03], ['Up', 'ArrowUp', 0x48], ['@', 'BracketLeft', 0x1a], ['^', 'Equal', 0x0d], ['¥', 'IntlYen', 0x7d], ['_', 'Minus', 0x0c], ['"', 'Quote', 0x28], ['Control', 'Ctrl', 0x1d], [' ', 'Space', 0x39]]) {
    assert.equal(normalizeHotkeyKey(old), code)
    assert.equal(scanKey(normalizeHotkeyKey(old)).scan, scan)
  }
  assert.equal(normalizeHotkeyKey('Unknown'), 'Unknown')
  assert.equal(normalizeHotkeyKey('IntlRo'), 'IntlRo')
})
test('E0 keys carry extended flags and differ from numpad positions', () => {
  const expected = { NumLock: 0x45, ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4b, ArrowRight: 0x4d,
    Insert: 0x52, Delete: 0x53, Home: 0x47, End: 0x4f, PageUp: 0x49, PageDown: 0x51,
    ControlRight: 0x1d, AltRight: 0x38, Win: 0x5b, MetaLeft: 0x5b, MetaRight: 0x5c,
    NumpadEnter: 0x1c, NumpadDivide: 0x35, PrintScreen: 0x37, ContextMenu: 0x5d }
  for (const [code, scan] of Object.entries(expected)) assert.deepEqual(scanKey(code), { scan, extended: true }, code)
  assert.deepEqual(scanKey('Numpad8'), { scan: 0x48, extended: false })
  assert.deepEqual(scanKey('ShiftRight'), { scan: 0x36, extended: false })
})
test('INPUT bytes use zero VK, scan code and SCANCODE/EXTENDED/KEYUP flags on both ABIs', () => {
  const names = ['Ctrl', 'Shift', 'Alt', 'Win', 'BracketLeft', 'IntlYen', 'IntlRo', 'Convert', 'NonConvert', 'KanaMode', 'Backquote', 'ArrowLeft', 'NumpadEnter', 'NumpadDivide']
  const scans = [0x1d, 0x2a, 0x38, 0x5b, 0x1a, 0x7d, 0x73, 0x79, 0x7b, 0x70, 0x29, 0x4b, 0x1c, 0x35]
  for (const arch of ['ia32', 'x64', 'arm64']) {
    const offset = arch === 'ia32' ? 4 : 8, size = arch === 'ia32' ? 28 : 40
    for (const [index, key] of hotkeyInputs(names).entries()) {
      for (const up of [false, true]) {
        const expected = Buffer.alloc(size)
        expected.writeUInt32LE(1, 0)
        expected.writeUInt16LE(scans[index], offset + 2)
        expected.writeUInt32LE(8 | ([3, 11, 12, 13].includes(index) ? 1 : 0) | (up ? 2 : 0), offset + 4)
        assert.deepEqual(keyboardInputBuffer(key, up, arch), expected, `${arch} ${names[index]} up=${up}`)
      }
    }
    for (const vk of [0xb1, 0xb3, 0xb0, 0xae, 0xaf]) {
      for (const up of [false, true]) {
        const expected = Buffer.alloc(size)
        expected.writeUInt32LE(1, 0)
        expected.writeUInt16LE(vk, offset)
        expected.writeUInt32LE(1 | (up ? 2 : 0), offset + 4)
        assert.deepEqual(keyboardInputBuffer(mediaInputs([vk])[0], up, arch), expected)
      }
    }
  }
  assert.throws(() => hotkeyInputs(['Ctrl', 'Unknown']), /未対応/)
})
test('keycaps use layout characters and fallback labels', () => {
  assert.equal(hotkeyLabel('KeyA'), 'A')
  assert.equal(hotkeyLabel('Digit2'), '2')
  assert.equal(hotkeyLabel('IntlYen'), '¥')
  assert.equal(hotkeyLabel('BracketLeft', new Map([['BracketLeft', '@']])), '@')
  assert.equal(hotkeyLabel('Space', new Map([['Space', ' ']])), 'Space')
})
test('loading migrates every profile and preserves unknown values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deskapi-config-'))
  try {
    const config = structuredClone(DEFAULT_CONFIG)
    for (const profile of config.profiles) profile.keys[0] = { ...config.profiles[0].keys.find(Boolean), action: { type: 'hotkey', keys: ['Ctrl', 'a', 'Unknown'] } }
    const migrated = migrateHotkeys(config)
    assert.deepEqual(migrateHotkeys(migrated), migrated)
    assert.deepEqual(config.profiles[0].keys[0].action.keys, ['Ctrl', 'a', 'Unknown'])
    await writeFile(join(directory, 'config.json'), JSON.stringify(config))
    const store = new ConfigStore(directory)
    const loaded = await store.load()
    for (const profile of loaded.profiles) assert.deepEqual(profile.keys[0].action.keys, ['Ctrl', 'KeyA', 'Unknown'])
    await store.save(loaded)
    assert.deepEqual(await new ConfigStore(directory).load(), loaded)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
