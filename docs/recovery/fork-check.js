// the "alone" case on autobase 7 (latest modules): 2 indexers a + b, b is lost for good, so nothing gets signed.
// a forks the base to the indexers [a] with host.fork(), then adds a new device c the normal way. checks
// - signing works again after the fork
// - the autobase key stays the same (so peers that know ali by that key can still find him)
// - an old reader that only knows the autobase key (like aya following alis blog) follows the fork
// - what the lost device b sees when it comes back
// - that apply decides who may fork (here only a node with "allowed: true", later a request signed with the seed phrase)
// FORK_TO_NEW=1 forks straight to [a, c] instead, c was added after the last signed point, autobase throws "Fork failed"
// run with: node docs/recovery/fork-check.js
const Autobase = require('autobase')
const Corestore = require('corestore')
const b4a = require('b4a')
// autobase swallows the reason a fork failed, print it
const Fork = require('autobase/lib/fork.js')
const upgrade = Fork.prototype._upgrade
Fork.prototype._upgrade = function () { return upgrade.call(this).catch(err => { console.log('  fork upgrade error:', err.message); throw err }) }
const fs = require('fs')
const os = require('os')
const path = require('path')

const ENCRYPTION = process.env.ENCRYPTION !== '0'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-check-'))
let failed = 0
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true })) // each run makes ~200MB of rocksdb stores
main().then(() => process.exit(failed ? 1 : 0), err => { console.log('crashed', err); process.exit(1) })

async function main () {
  const a = make('a')
  await a.base.ready()
  const b = make('b', a.base.key)
  const reader = make('aya', a.base.key) // only knows the key, never a writer
  await Promise.all([b.base.ready(), reader.base.ready()])
  const ab = connect(a, b)
  const ar = connect(a, reader)

  await a.base.append({ add: hex(b.base.local.key), indexer: true })
  await settle([a, b], () => b.base.writable && b.base.isIndexer && a.base.system.indexers.length === 2)
  await a.base.append('one')
  await b.base.append('two')
  await settle([a, b, reader], () => a.base.view.signedLength === 2 && reader.base.view.length === 2)
  check('2 indexers, both entries signed, the reader has them', a.base.view.signedLength === 2 && reader.base.view.length === 2)
  const key_before = hex(a.base.key)
  const view_key_before = hex(a.base.view.key)

  // b is lost for good
  ab.forEach(s => s.destroy())
  await b.base.close()
  await a.base.append('three')
  await wait(1500)
  await a.base.update()
  check('with b gone the new entry stays unsigned (needs 2 of 2)', a.base.view.length === 3 && a.base.view.signedLength === 2, `length ${a.base.view.length} signed ${a.base.view.signedLength}`)

  const c = make('c', a.base.key)
  await c.base.ready()
  const ac = connect(a, c)

  if (process.env.FORK_TO_NEW) {
    process.on('uncaughtException', err => { check('forking straight to a device added after the last signed point fails, and autobase throws it uncaught (the process dies)', err.message === 'Fork failed', err.message); process.exit(failed ? 1 : 0) })
    // c is added and writes, but none of that is signed (b is gone), then a forks to [a, c]
    await a.base.append({ add: hex(c.base.local.key), indexer: false })
    await settle([a, c], () => c.base.writable)
    await c.base.append('hello from c')
    await settle([a, c], () => a.base.view.length === 4)
    const error = await a.base.append(fork_cmd(a, [a, c], true)).then(() => null, err => err.message)
    check('forking straight to a device added after the last signed point fails', error === 'Fork failed', 'append: ' + error)
    console.log(failed ? failed + ' failed' : 'all good')
    process.exit(failed ? 1 : 0)
  }

  // a fork that apply doesnt allow does nothing
  await a.base.append(fork_cmd(a, [a], false))
  await settle([a], () => true)
  check('a fork apply doesnt allow is ignored', a.base.system.indexers.length === 2)

  await a.base.append(fork_cmd(a, [a], true))
  await settle([a], () => a.base.system.indexers.length === 1)
  check('after the fork a is the only indexer', keys(a.base.system.indexers).join() === hex(a.base.local.key))
  await settle([a], () => a.base.view.signedLength === a.base.view.length, 10000)
  check('the entry that was stuck is signed now (1 of 1)', a.base.view.signedLength === a.base.view.length && a.base.view.length === 3, `length ${a.base.view.length} signed ${a.base.view.signedLength}`)

  // now a new device c can be added the normal way and becomes the second indexer
  await a.base.append({ add: hex(c.base.local.key), indexer: true })
  await settle([a, c], () => c.base.writable && a.base.system.indexers.length === 2, 20000)
  await c.base.append('hello from c')
  await a.base.append('four')
  await settle([a, c], () => a.base.view.signedLength === 5 && c.base.view.signedLength === 5, 20000)
  check('c is the second indexer and both sign again (2 of 2)', keys(a.base.system.indexers).sort().join() === [hex(a.base.local.key), hex(c.base.local.key)].sort().join() && a.base.view.signedLength === 5, `length ${a.base.view.length} signed ${a.base.view.signedLength}`)
  check('the autobase key stays the same', hex(a.base.key) === key_before)
  check('the view got a new key (new cores after the fork)', hex(a.base.view.key) !== view_key_before)
  const entries = []
  for (let i = 0; i < a.base.view.length; i++) entries.push(await a.base.view.get(i))
  check('the old entries are still in the view', entries.slice(0, 3).sort().join() === 'one,three,two', entries.join(' | '))

  await settle([a, reader], () => reader.base.view.length === a.base.view.length, 20000)
  check('the reader that only knows the autobase key follows the fork', reader.base.view.length === a.base.view.length && keys(reader.base.system.indexers).sort().join() === keys(a.base.system.indexers).sort().join(), `reader length ${reader.base.view.length} vs ${a.base.view.length}`)

  // the lost device comes back with its old state
  const b2 = make('b', a.base.key)
  await b2.base.ready()
  const ab2 = connect(a, b2)
  await settle([a, b2], () => b2.base.view.length === a.base.view.length, 20000)
  console.log('  b back: view length', b2.base.view.length, 'of', a.base.view.length, '| writable', b2.base.writable, '| indexers', keys(b2.base.system.indexers).map(k => k.slice(0, 6)).join(','))
  check('the old device b sees the fork when it comes back', keys(b2.base.system.indexers).sort().join() === keys(a.base.system.indexers).sort().join())

  for (const s of [...ar, ...ac, ...ab2]) s.destroy()
  for (const d of [a, c, reader, b2]) await d.base.close()
  console.log(failed ? failed + ' failed' : 'all good')
}

// apply: add writers, and fork only when the node says it may (stand in for a seed phrase signature)
async function apply (nodes, view, host) {
  for (const { value } of nodes) {
    if (value && value.add) { await host.addWriter(b4a.from(value.add, 'hex'), { indexer: value.indexer }); continue }
    if (value && value.fork) {
      if (!value.fork.allowed) continue
      await host.fork(value.fork.indexers.map(k => b4a.from(k, 'hex')), { key: b4a.from(value.fork.system.key, 'hex'), length: value.fork.system.length })
      continue
    }
    if (value !== null) await view.append(value)
  }
}

function fork_cmd (from, devices, allowed) {
  return { fork: { allowed, indexers: devices.map(d => hex(d.base.local.key)), system: { key: hex(from.base.system.core.key), length: from.base.indexedLength } } }
}

function make (name, key = null) {
  const store = new Corestore(path.join(root, name))
  const base = new Autobase(store, key, { apply, open: s => s.get('view', { valueEncoding: 'json' }), valueEncoding: 'json', ackInterval: 100, encryptionKey: ENCRYPTION ? b4a.alloc(32, 1) : undefined })
  return { name, store, base }
}

function connect (x, y) {
  const s1 = x.store.replicate(true)
  const s2 = y.store.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  return [s1, s2]
}

async function settle (devices, done, ms = 10000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    for (const d of devices) await d.base.update().catch(() => {})
    if (done()) return true
    await wait(100)
  }
  return false
}

function keys (indexers) { return indexers.map(i => hex(i.key)) }
function hex (buf) { return b4a.toString(buf, 'hex') }
function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function check (name, ok, note = '') {
  if (!ok) failed++
  console.log((ok ? 'ok ' : 'not ok ') + name + (note ? '  (' + note + ')' : ''))
}
