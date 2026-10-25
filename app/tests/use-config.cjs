const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function setup(t) {
  const states = [], effects = [], saves = []
  let changed
  const initial = { activeProfileId: 'a', locked: false, profiles: [{ name: 'old' }] }
  const react = {
    useRef: current => ({ current }),
    useState: initial => {
      const i = states.length
      states.push(initial)
      return [initial, value => { states[i] = value }]
    },
    useEffect: effect => effects.push(effect)
  }
  const api = {
    getConfig: async () => structuredClone(initial), getDeviceStatus: async () => ({ state: 'connected' }),
    onConfigChanged: callback => { changed = callback; return () => {} }, onDeviceStatus: () => () => {},
    saveConfig: value => new Promise((resolve, reject) => saves.push({ value: structuredClone(value), resolve, reject }))
  }
  const exports = {}
  runInNewContext(readFileSync(process.env.DESKAPI_TEST_OUTPUT + '/renderer/src/useConfig.js', 'utf8'), {
    exports, require: name => { assert.equal(name, 'react'); return react }, structuredClone,
    setTimeout, clearTimeout, window: { deskapi: api, addEventListener() {}, removeEventListener() {} }
  })
  const hook = exports.useConfig()
  const cleanups = effects.map(effect => effect())
  t.after(() => cleanups.forEach(cleanup => cleanup?.()))
  await tick()
  return { hook, states, saves, changed: patch => changed({ ...structuredClone(initial), ...patch }) }
}

test('tray notification preserves outstanding edits and rebases queued saves', async t => {
  const { hook, states, saves, changed } = await setup(t)
  hook.edit(c => ({ ...c, profiles: [{ name: 'first' }] }))
  const first = hook.flush()
  await tick()
  changed({ locked: true })
  assert.equal(states[0].profiles[0].name, 'first')
  hook.edit(c => ({ ...c, profiles: [{ name: 'second' }] }))
  const second = hook.flush()
  changed({ locked: false, activeProfileId: 'b' })
  saves[0].resolve()
  await first
  await tick()
  assert.equal(saves[1].value.activeProfileId, 'b')
  assert.equal(saves[1].value.locked, false)
  assert.equal(saves[1].value.profiles[0].name, 'second')
  saves[1].resolve()
  await second
  assert.equal(states[0].profiles[0].name, 'second')
  changed({ profiles: [{ name: 'from main' }] })
  assert.equal(states[0].profiles[0].name, 'from main')
})

test('failed save remains retryable after a tray notification', async t => {
  const { hook, saves, changed } = await setup(t)
  hook.edit(c => ({ ...c, profiles: [{ name: 'edited' }] }))
  const saving = hook.flush()
  await tick()
  changed({ locked: true })
  saves[0].reject(new Error('disk unavailable'))
  await assert.rejects(saving, /disk unavailable/)
  const retry = hook.flush()
  await tick()
  assert.equal(saves[1].value.profiles[0].name, 'edited')
  assert.equal(saves[1].value.locked, true)
  saves[1].resolve()
  await retry
})
