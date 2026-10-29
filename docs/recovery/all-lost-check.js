// all devices lost (autobase 7, latest modules). ali has one device a (the only indexer). when the vault is made a
// writer from the seed phrase m is added (not an indexer) and writes once (the seed phrase is in memory then anyway).
// a backup peer only replicates as a plain reader (stand in for a blind peer), aya only follows alis key. then a is gone.
// a new device n gets the seed phrase typed in, opens the vault as the writer m, gets the data from the backup peer,
// forks to [m] and adds its own device key as an indexer. checks that the data is back, signing works, aya follows.
// run with: node docs/recovery/all-lost-check.js
const Autobase = require('autobase')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
// autobase swallows the reason a fork failed, print it
const Fork = require('autobase/lib/fork.js')
const upgrade = Fork.prototype._upgrade
Fork.prototype._upgrade = function () { return upgrade.call(this).catch(err => { console.log('  fork upgrade error:', err.message); throw err }) }
const STEP = process.env.STEP ? console.log : () => {}
if (process.env.STEP) {
  for (const name of ['_get', '_migrate', 'createView']) {
    const fn = Fork.prototype[name]
    Fork.prototype[name] = async function (...args) {
      const label = name + ' ' + (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].name) || '')
      console.log('    fork step start', label, name === '_migrate' ? 'length ' + args[3] : '')
      const r = await fn.apply(this, args)
      console.log('    fork step done ', label)
      return r
    }
  }
}
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'all-lost-'))
let failed = 0
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true })) // each run makes ~200MB of rocksdb stores
main().then(() => process.exit(failed ? 1 : 0), err => { console.log('crashed', err); process.exit(1) })

async function main () {
  const seed_writer = crypto.keyPair(b4a.alloc(32, 7)) // stand in for the keypair made from the seed phrase
  const a = make('a')
  await a.base.ready()
  const key = a.base.key
  const backup = make('backup', key)
  const aya = make('aya', key)
  await Promise.all([backup.base.ready(), aya.base.ready()])
  const links = [connect(a, backup), connect(a, aya), connect(backup, aya)]

  // when the vault is made: add the seed phrase writer and let it write once
  const m = make('m-at-creation', key, seed_writer)
  await m.base.ready()
  const am = connect(a, m)
  await a.base.append({ add: hex(m.base.local.key), indexer: false })
  await settle([a, m], () => m.base.writable)
  await m.base.append({ seed_writer: 'hello' })
  await a.base.append('post 1')
  await a.base.append('post 2')
  await settle([a, m, backup, aya], () => a.base.view.signedLength === 2 && backup.base.view.length === 2 && aya.base.view.length === 2)
  check('vault made, the seed phrase writer wrote once, everything signed by a, backup and aya have it', a.base.view.signedLength === 2 && backup.base.view.length === 2 && aya.base.view.length === 2)
  am.forEach(s => s.destroy())
  const m_core_key = m.base.local.key
  await m.base.close() // the seed phrase is forgotten

  // the backup is a plain reader, it already has the seed phrase writers block locally (has() doesnt fetch anything)
  const kept = backup.store.get({ key: m_core_key })
  await kept.ready()
  check('the backup (a plain reader) has the seed phrase writers block too', await kept.has(0))
  await kept.close()

  // a is gone for good
  for (const l of links.slice(0, 2)) l.forEach(s => s.destroy())
  await a.base.close()

  // new device: the seed phrase is typed in, it opens the vault as the seed phrase writer and syncs from the backup
  // autobase opens its own writer core as not active, so it wont download it. the seed phrase writer wrote before,
  // so first fetch that history from the backup, otherwise the first append waits forever
  const n_store = new Corestore(path.join(root, 'n-seed'))
  const nb = connect({ store: n_store }, backup)
  const local_key = await Autobase.getLocalKey(n_store, { keyPair: seed_writer })
  STEP('  same key as the seed writer core at creation:', hex(local_key) === hex(m_core_key))
  const own = n_store.get({ key: local_key })
  await own.ready()
  if (!own.peers.length) await new Promise(resolve => own.once('peer-add', resolve))
  await own.get(0, { timeout: 10000 }) // update() didnt pick up the length here, a get does
  for (let i = 1; i < own.length; i++) await own.get(i)
  STEP('  fetched the seed phrase writers own history,', own.length, 'block(s)')
  await own.close()
  const n = make('n-seed', key, seed_writer, n_store)
  await n.base.ready()
  await settle([n, backup], () => n.base.view.length === 2)
  check('the new device gets all the data from the backup peer', n.base.view.length === 2)
  check('it can write as the seed phrase writer', n.base.writable)

  STEP('  local writer core on n, length', n.base.local.length, 'contiguous', n.base.local.contiguousLength, 'remote length', n.base.local.remoteLength)
  STEP('  appending the fork, indexedLength', n.base.indexedLength, 'system length', n.base.system.core.length)
  // the new devices own key (a normal device writer from its corestore) opens the vault before the fork.
  // a device that opens it for the first time after the fork only sees the old state (FRESH_AFTER_FORK=1 shows it)
  let d = null
  let nd = null
  if (!process.env.FRESH_AFTER_FORK) {
    d = make('n-device', key)
    await d.base.ready()
    nd = connect(n, d)
    await settle([n, d], () => d.base.view.length === 2)
  }
  await n.base.append({ fork: { indexers: [hex(n.base.local.key)], system: { key: hex(n.base.system.core.key), length: n.base.indexedLength } } })
  await settle([n], () => n.base.system.indexers.length === 1 && hex(n.base.system.indexers[0].key) === hex(n.base.local.key))
  STEP('  after fork settle, indexers', keys(n.base.system.indexers).map(k => k.slice(0, 6)).join(','))
  const writable_again = await settle([n], () => n.base.writable, 10000)
  STEP('  after the fork, writable', n.base.writable, 'isIndexer', n.base.isIndexer, 'local', hex(n.base.local.key).slice(0, 6))
  check('after the fork the new device can write again', writable_again)
  await settle([n, backup, aya], () => keys(aya.base.system.indexers).join() === hex(n.base.local.key), 15000)
  STEP('  after the fork, backup indexers', keys(backup.base.system.indexers).map(k => k.slice(0, 6)).join(','), '| aya indexers', keys(aya.base.system.indexers).map(k => k.slice(0, 6)).join(','))
  check('it forks the vault to the seed phrase writer', hex(n.base.system.indexers[0].key) === hex(n.base.local.key))

  // the new devices own key becomes an indexer, then it writes
  if (!d) {
    d = make('n-device', key)
    await d.base.ready()
    nd = connect(n, d)
  }
  await n.base.append({ add: hex(d.base.local.key), indexer: true })
  const d_ok = await settle([n, d], () => d.base.writable && d.base.isIndexer, 20000)
  STEP('  d writable', d.base.writable, 'indexer', d.base.isIndexer, '| d view', d.base.view.length, 'indexers on d', keys(d.base.system.indexers).map(k => k.slice(0, 6)).join(','), '| n system members', n.base.system.members, 'n view', n.base.view.length, 'signed', n.base.view.signedLength)
  if (!d_ok) { check('the new devices key is added and becomes an indexer', false); console.log(failed + ' failed'); process.exit(1) }
  await d.base.append('post 3 from the new device')
  await settle([n, d, backup, aya], () => d.base.view.length === 3 && d.base.view.signedLength === 3 && aya.base.view.length === 3, 20000)
  check('the new device is an indexer and its post is signed', d.base.isIndexer && d.base.view.signedLength === 3, `length ${d.base.view.length} signed ${d.base.view.signedLength}`)
  const posts = []
  for (let i = 0; i < d.base.view.length; i++) posts.push(await d.base.view.get(i))
  check('the old posts are still there', posts.includes('post 1') && posts.includes('post 2'), posts.map(p => JSON.stringify(p)).join(' '))
  check('the vault key stayed the same, aya follows and has the new post', hex(aya.base.key) === hex(key) && aya.base.view.length === 3)
  check('aya didnt have to do anything, she sees the new indexers', keys(aya.base.system.indexers).sort().join() === keys(d.base.system.indexers).sort().join())

  for (const l of [links[2], nb, nd]) l.forEach(s => s.destroy())
  for (const x of [n, d, backup, aya]) await x.base.close()
  console.log(failed ? failed + ' failed' : 'all good')
}

async function apply (nodes, view, host) {
  for (const { value } of nodes) {
    if (value && value.add) { await host.addWriter(b4a.from(value.add, 'hex'), { indexer: value.indexer }); continue }
    if (value && value.fork) {
      // in the vault this is only allowed when signed by the seed phrase (user/public_key), here every fork is allowed
      await host.fork(value.fork.indexers.map(k => b4a.from(k, 'hex')), { key: b4a.from(value.fork.system.key, 'hex'), length: value.fork.system.length })
      continue
    }
    if (value && value.seed_writer) continue
    if (value !== null) await view.append(value)
  }
}

function make (name, key = null, keyPair = null, store = new Corestore(path.join(root, name))) {
  const base = new Autobase(store, key, { apply, open: s => s.get('view', { valueEncoding: 'json' }), valueEncoding: 'json', ackInterval: 100, keyPair: keyPair || undefined })
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
    for (const x of devices) await x.base.update().catch(() => {})
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
