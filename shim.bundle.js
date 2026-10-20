(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (__dirname){(function (){
// Datashell code
// Loads identity module and executes app code with identity vault

const remote = require('remote')
const serve_webrtc = require('webrtc-bridge/page')

module.exports = { create_app_vault } // the vault worker (vault-worker.js) uses it too

if (typeof WorkerGlobalScope === 'undefined') { // in the vault worker this file only gives create_app_vault
  (globalThis.open
    ? boot(loadweb, inputweb('system.bundle.js', 'bundle.js'))
    : boot(loadcli, inputcli(__dirname + '/clisys-ui.js', __dirname + '/cliapp-ui.js'))
  ).catch(onerror)
}

function onerror (error) {
  console.error('[datashell] Loader error:', error)
}

function inputcli (sysurl, appurl) {
  const process = require('bare-process')
  const env = process.env
  const args1 = [sysurl, appurl, ...process.argv.slice(2)]
  const args2 = [sysurl, appurl]
  const arg = args1.length ? args1 : args2
  return { env, arg }
}

function inputweb (sysurl, appurl) {
  const env = Object.fromEntries(new URLSearchParams(location.search).entries())
  const args1 = location.hash.slice(1).split('#').filter(x => x)
  const args2 = document.currentScript.src.split('#').slice(1).filter(x => x)
  const args3 = [sysurl, appurl]
  const arg = args1.length ? args1 : args2.length ? args2 : args3
  return { env, arg }
}

async function loadcli (href) {
  // Use eval to avoid browserify trying to bundle bare-fs
  const fs = eval('require')('bare-fs')
  const src = fs.readFileSync(href)
  const async_function = (async () => {}).constructor
  const fn = new async_function('vault, document, require', src)
  return function (vault, doc) { return fn(vault, doc, require) }
}

// cli apps run from an autodisk: the app file and everything it requires is copied into it first
async function loadcli_drive (href, vault) {
  const req = eval('require') // keeps browserify from bundling these bare only modules
  const builtins = { 'bare-process': req('bare-process') }
  const drive = req('autodisk')({ store: vault.store.namespace('app-code') })
  const file = await req('code-to-disk')({ drive, file: href, builtins })
  const app = await req('disk-loader')({ drive, file, builtins })
  await drive.close()
  return app
}

async function loadweb (href) {
  const url = new URL(href, location)
  const response = await fetch(url, { cache: 'no-cache' })
  const src = await response.text()
  const async_function = (async () => {}).constructor
  return new async_function('vault, document', src)
}

async function boot (load, input) {
  const is_web = !!globalThis.open
  // on web the vault runs in a worker (opfs storage only works there), eval keeps browserify from bundling identity
  const vault = is_web ? open_vault_worker(input) : eval('require')('identity')(input)
  const [sysurl, appurl] = input.arg
  const sys_doc = is_web ? make_document(create_shadow()) : undefined
  const app_doc = is_web ? make_document(create_shadow()) : undefined
  const system = await load(sysurl)

  do {
  await system(vault, sys_doc)
  const uservault = await vault.user
    // Keep a state object attached to the user so the app can remember things across menu switches
    if (!uservault.app_state) uservault.app_state = {} 
  if (!appurl) break
  const app = is_web ? await load(appurl) : await loadcli_drive(appurl, vault)
  // Wrap vault for the app — auto-namespace so app never sees its APP_ID
    const app_instance_id = vault.session_get_joined_app() || 'p2p-news-app'
  const profile_name = app_instance_id.includes(':') ? app_instance_id.split(':')[0] : uservault.username
  const app_vault = is_web ? await vault.open_app(app_instance_id, profile_name) : await create_app_vault(uservault, app_instance_id, profile_name)
  if (is_web) app(app_vault, app_doc)
  else await app(app_vault, app_doc)
} while (!is_web)
}

/***************************************
APP VAULT WRAPPER
Provides a namespaced vault so the app is sandboxed.
The app only gets the functions listed here and its own namespaced corestore,
not the root store, the vault bee or the pairing and device functions.

Structure:
  root_store (identity)
  ├── namespace('vault-bee')         → system vault
  ├── namespace('vault-audit')       → system audit
  └── namespace(app_id)              → appstore (what app receives)
      └── app creates its own structures here
***************************************/
async function create_app_vault (vault, app_instance_id, profile_name) {
  const appstore = vault.store.namespace(app_instance_id)
  await appstore.ready()
  return {
    username: profile_name || vault.username,
    store: appstore,
    app_state: vault.app_state,
    // the app hands its structures to the vault, so the vault can add and remove their writers
    create_ds_manager: vault.create_ds_manager,
    set_ds_manager: vault.set_ds_manager,
    set_events_drive: vault.set_events_drive,
    get_raw_data: vault.get_raw_data,
    // Auto-namespaced data operations
    vault_put: (key, value) => vault.vault_put(`${app_instance_id}/${key}`, value),
    vault_get: (key) => vault.vault_get(`${app_instance_id}/${key}`),
    vault_del: (key) => vault.vault_del(`${app_instance_id}/${key}`),
    vault_watch: (key) => vault.get_vault_bee().watch({ gte: `${app_instance_id}/${key}`, lte: `${app_instance_id}/${key}` }),
    // Auto-scoped app operations
    register_app: (config) => vault.register_app(app_instance_id, config),
    get_app: () => vault.get_app(app_instance_id),
    get_app_audit: () => vault.get_app_audit(app_instance_id),
    load_app_audit: (key) => vault.load_app_audit(app_instance_id, key),
    start_writer_watcher: () => vault.start_writer_watcher(app_instance_id),
    request_writer_access: () => vault.request_writer_access(app_instance_id),
    wait_for_writer_access: () => vault.wait_for_writer_access(app_instance_id),
    log_bootstrap_device: () => vault.log_bootstrap_device(app_instance_id),
    get_app_status: () => vault.get_app_status(app_instance_id),
    network: (options = {}) => vault.network({ ...options, app_id: app_instance_id })
  }
}

/***************************************
VAULT WORKER
the vault runs in vault.bundle.js (lib/vault-worker.js), the page gets a stand in for it.
the session values stay in the page, they are read right away (not async) and live in localStorage
***************************************/
function open_vault_worker (input) {
  const worker = new Worker('vault.bundle.js')
  worker.postMessage({ type: 'start', data: { storage: { ...localStorage }, input } })
  serve_webrtc(worker) // the worker has no webrtc, the real connections live here
  return remote(worker, {
    session_get_username: () => localStorage.getItem('username'),
    session_set_username: v => localStorage.setItem('username', v),
    session_get_joined_app: () => localStorage.getItem('joined_app') || '',
    session_set_joined_app: v => localStorage.setItem('joined_app', v),
    session_get_pending_invite: () => localStorage.getItem('pending_invite_code') || null,
    session_set_pending_invite: v => localStorage.setItem('pending_invite_code', v),
    session_clear_pending_invite: () => localStorage.removeItem('pending_invite_code'),
    session_clear: () => localStorage.clear()
  })
}

/***************************************
SHADOW DOM HELPERS
***************************************/
function create_shadow () {
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  document.body.appendChild(el)
  return shadow
}

function make_document (shadow) {
  return {
    body: shadow,
    createElement: document.createElement.bind(document),
    createTextNode: document.createTextNode.bind(document),
    querySelector: shadow.querySelector.bind(shadow),
    querySelectorAll: shadow.querySelectorAll.bind(shadow),
    addEventListener: shadow.addEventListener.bind(shadow)
  }
}

}).call(this)}).call(this,"/lib")
},{"bare-process":34,"remote":3,"webrtc-bridge/page":4}],2:[function(require,module,exports){
module.exports = vm
vm.make_tx = make_tx

function vm (code, done, options = {}) {
  if (typeof code !== 'function') throw new Error('code must be a function')
  const mode = options.mode || 'controlled'
  if (mode !== 'controlled' && mode !== 'sandboxed') throw new Error('mode must be controlled or sandboxed')
  const document = options.document || globalThis.document
  const id = options.id || 'vm'
  const state = { port: null, closed: false }
  const src = URL.createObjectURL(new Blob([get_child_source()], { type: 'text/html' }))
  const vmview = document.createElement('div')
  const shadow = vmview.attachShadow({ mode: 'closed' })
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', options.title || 'Sandboxed runtime')
  iframe.src = src
  iframe.onload = load
  shadow.appendChild(iframe)
  vmview.close = close
  vmview.mode = mode
  return vmview

  function load () {
    iframe.onload = null
    if (state.closed) return
    const { port1, port2 } = new MessageChannel()
    state.port = port1
    // Opaque sandbox origins require '*'; the port is transferred only to this frame.
    iframe.contentWindow.postMessage({ source: `(${code})(port, tx)`, mode, id }, '*', [port2])
    done?.(port1, vmview)
  }

  function close () {
    if (state.closed) return
    state.closed = true
    state.port?.close()
    vmview.remove()
    URL.revokeObjectURL(src)
  }
}

/***************************************
CHILD RUNTIME SOURCE
the iframe waits for its port, then runs the code with (port, tx)
in controlled mode, 'run' messages from the host run more code
***************************************/
function get_child_source () {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><script>
globalThis.onmessage = connect // the only way an iframe can receive its port
function connect (event) {
  const port = event.ports[0]
  if (!port || !event.data?.source) return
  globalThis.onmessage = null
  const tx = (${make_tx})(event.data.id)
  if (event.data.mode === 'controlled') port.addEventListener('message', run)
  port.start()
  execute(event.data.source)
  function run (message) { if (message.data?.type === 'run') execute(message.data.data) }
  function execute (source) {
    try { new Function('port', 'tx', source)(port, tx) } catch (err) {
      port.postMessage(tx({ to: 'host', type: 'error', data: err.message }))
    }
  }
}
</script></body></html>`
}

/***************************************
MAKE TX
makes messages { head, refs, type, data, meta } sent by `by`
head = [by, to, mid], mid counts from 0 for every receiver
a reply points to the message it answers with refs.cause = msg.head
***************************************/
function make_tx (by) {
  const mids = new Map()
  return tx
  function tx ({ to, type, data = null, refs = {} }) {
    const mid = mids.has(to) ? mids.get(to) + 1 : 0
    mids.set(to, mid)
    return { head: [by, to, mid], refs, type, data, meta: { time: Date.now(), stack: new Error().stack } }
  }
}

},{}],3:[function(require,module,exports){
// lets the page use the vault that runs in a web worker (opfs storage only works in workers)
// page: const vault = remote(worker, local)   worker: remote.serve(self, vault)
// every call goes as a make_tx message { head, refs, type, data, meta }, the reply points back with refs.cause
// plain data is copied, anything else (the vault bee, watchers, the user vault) stays in the worker
// and the page gets a stand in for it, so `bee.update()`, `await vault.user` and `for await (x of bee.watch())` still work
const { make_tx } = require('iframe-runtime')

module.exports = remote
remote.serve = serve

function remote (port, local = {}) {
  const state = { waiting: new Map(), callbacks: new Map(), next_callback: 0, ids: new WeakMap() }
  const tx = make_tx('page')
  port.addEventListener('message', on_message)
  port.start?.()
  return make_ref({ ref: 0, own: local })

  function make_ref ({ ref, own }) {
    const proxy = make_proxy({ source: Promise.resolve({ ref }), path: [], own, settled: true })
    state.ids.set(proxy, ref)
    return proxy
  }
  function make_proxy ({ source, path, own = {}, settled = false }) {
    return new Proxy(function () {}, { get: get_key, apply: call })
    function get_key (target, key) {
      if (path.length === 0 && key in own) return own[key]
      if (key === 'then') return settled && path.length === 0 ? undefined : then
      if (key === Symbol.asyncIterator) return iterate
      if (typeof key === 'symbol') return undefined
      return make_proxy({ source, path: [...path, key] })
    }
    function then (resolve, reject) {
      const reply = settled || path.length ? run({ read: true }) : source // a call result is already its reply
      return reply.then(decode).then(resolve, reject)
    }
    function call (target, self, args) { return make_proxy({ source: run({ args: args.map(encode_arg) }), path: [] }) }
    function iterate () {
      const iterator = make_proxy({ source: run({ iterator: true }), path: [] })
      return { next: () => iterator.next() }
    }
    async function run (data) {
      const reply = await source
      if (reply.ref === undefined) return { value: path.reduce((value, key) => value?.[key], reply.value) } // plain data, no worker needed (null.x is undefined like ?.)
      return send({ ...data, ref: reply.ref, path })
    }
  }
  function send (data) {
    const msg = tx({ to: 'vault', type: 'call', data })
    port.postMessage(msg)
    return new Promise((resolve, reject) => state.waiting.set(msg.head[2], { resolve, reject }))
  }
  function on_message (event) {
    const msg = event.data
    if (msg?.type === 'callback') return state.callbacks.get(msg.data.id)(...msg.data.args.map(decode))
    if (msg?.type === 'storage') return update_storage(msg.data)
    if (msg?.type === 'alert') return alert(msg.data) // what the vault worker cant do itself
    if (msg?.type === 'reload') return location.reload()
    const waiting = state.waiting.get(msg?.refs?.cause?.[2])
    if (!waiting) return
    state.waiting.delete(msg.refs.cause[2])
    if (msg.type === 'error') waiting.reject(new Error(msg.data))
    else waiting.resolve(msg.data)
  }
  function decode (data) { return data.ref === undefined ? data.value : make_ref(data) }
  function encode_arg (arg) {
    if (typeof arg === 'function' && state.ids.has(arg)) return { ref: state.ids.get(arg) }
    if (typeof arg === 'function') return { callback: keep_callback(arg) }
    if (arg && typeof arg === 'object' && Object.values(arg).some(v => typeof v === 'function')) {
      return { fields: Object.fromEntries(Object.entries(arg).map(([key, value]) => [key, encode_arg(value)])) }
    }
    return { value: arg }
  }
  function keep_callback (fn) {
    const id = state.next_callback++
    state.callbacks.set(id, fn)
    return id
  }
}

// the worker writes localStorage (seed phrase, session), the page keeps the real one
function update_storage ({ key, value }) {
  if (key === null) localStorage.clear()
  else if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
}

function serve (port, root) {
  const refs = [root]
  const tx = make_tx('vault')
  port.addEventListener('message', on_message)
  port.start?.()

  async function on_message (event) {
    const msg = event.data
    if (msg?.type !== 'call') return
    const reply = { to: 'page', refs: { cause: msg.head } }
    try {
      port.postMessage(tx({ ...reply, type: 'reply', data: encode(await run(msg.data)) }))
    } catch (err) {
      port.postMessage(tx({ ...reply, type: 'error', data: err.message }))
    }
  }
  async function run ({ ref, path, args, read, iterator }) {
    const owner = path.slice(0, -1).reduce((value, key) => value[key], refs[ref])
    const value = path.length ? owner[path[path.length - 1]] : owner
    if (read) return await value
    if (iterator) return value[Symbol.asyncIterator]()
    return await value.apply(owner, args.map(decode_arg))
  }
  function encode (value) {
    if (is_plain(value)) {
      try { return { value: globalThis.structuredClone(value) } } catch (err) {} // has something that cant be copied, keep it here
    }
    refs.push(value)
    return { ref: refs.length - 1, own: own_props(value) }
  }
  function decode_arg (arg) {
    if (arg.ref !== undefined) return refs[arg.ref]
    if (arg.callback !== undefined) return (...args) => port.postMessage(tx({ to: 'page', type: 'callback', data: { id: arg.callback, args: args.map(encode) } }))
    if (arg.fields) return Object.fromEntries(Object.entries(arg.fields).map(([key, value]) => [key, decode_arg(value)]))
    return arg.value
  }
}

/***************************************
IS PLAIN
data that can be copied to the page as it is
***************************************/
function is_plain (value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return true
  if (typeof value === 'function') return false
  const proto = Object.getPrototypeOf(value)
  return Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set || proto === Object.prototype || proto === null
}

/***************************************
OWN PROPS
the simple values of an object that stays in the worker, the page can read them right away (user.username, result.done)
***************************************/
function own_props (value) {
  const own = {}
  for (const key of Object.keys(value)) {
    const v = value[key]
    if ((v !== null && typeof v !== 'object' && typeof v !== 'function') || ArrayBuffer.isView(v)) own[key] = v
  }
  return own
}

},{"iframe-runtime":2}],4:[function(require,module,exports){
// the page side of webrtc-bridge: the real RTCPeerConnection and data channel live here,
// the vault worker drives them with messages (see index.js)
module.exports = serve_webrtc

const CHUNK = 16 * 1024 // the message size every browser accepts

function serve_webrtc (worker) {
  const peers = new Map() // id -> { rtc, channel }
  const ops = { create, create_channel, send, close_channel, close, create_offer, create_answer, set_local_description, set_remote_description, add_ice_candidate }
  worker.addEventListener('message', on_message)

  async function on_message (event) {
    const msg = event.data
    if (msg?.type !== 'rtc') return
    const { mid, id, op, args } = msg.data
    try {
      worker.postMessage({ type: 'rtc-reply', data: { mid, value: await ops[op](id, ...args) } })
    } catch (err) {
      worker.postMessage({ type: 'rtc-reply', data: { mid, error: err.message } })
    }
  }
  function create (id, options) {
    const rtc = new RTCPeerConnection(options)
    rtc.onicecandidate = e => send_event(id, 'icecandidate', e.candidate && e.candidate.toJSON())
    peers.set(id, { rtc, channel: null })
  }
  function create_channel (id, label, options) {
    const peer = peers.get(id)
    peer.channel = peer.rtc.createDataChannel(label, options)
    peer.channel.binaryType = 'arraybuffer'
    for (const type of ['open', 'message', 'error', 'close']) peer.channel.addEventListener(type, e => on_channel_event(id, type, e))
  }
  function on_channel_event (id, type, e) {
    const channel = peers.get(id)?.channel
    send_event(id, type, type === 'message' ? e.data : null, channel?.readyState || 'closed')
    if (type === 'close') peers.delete(id)
  }
  function send_event (id, type, data, ready_state) { worker.postMessage({ type: 'rtc-event', data: { id, type, data, ready_state } }) }
  // one data channel message can be at most 256KB in chrome (and a big autodisk block is bigger), the channel is ordered
  // and hyper-webrtc reads it as a byte stream, so a big write just goes out in pieces
  function send (id, data) {
    const channel = peers.get(id)?.channel
    for (let i = 0; i < data.byteLength; i += CHUNK) channel?.send(data.subarray(i, i + CHUNK))
  }
  function close_channel (id) { peers.get(id)?.channel?.close() }
  function close (id) { peers.get(id)?.rtc.close() }
  async function create_offer (id) { return plain(await peers.get(id).rtc.createOffer()) }
  async function create_answer (id) { return plain(await peers.get(id).rtc.createAnswer()) }
  async function set_local_description (id, description) {
    const rtc = peers.get(id).rtc
    await rtc.setLocalDescription(description)
    return plain(rtc.localDescription)
  }
  function set_remote_description (id, description) { return peers.get(id).rtc.setRemoteDescription(description) }
  function add_ice_candidate (id, candidate) { return peers.get(id).rtc.addIceCandidate(candidate) }
}

// descriptions can be browser objects that postMessage cant copy, the worker only needs { type, sdp }
function plain (description) { return description && { type: description.type, sdp: description.sdp } }

},{}],5:[function(require,module,exports){
(function (Buffer){(function (){
function isBuffer(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
}

function isEncoding(encoding) {
  return Buffer.isEncoding(encoding)
}

function alloc(size, fill, encoding) {
  return Buffer.alloc(size, fill, encoding)
}

function allocUnsafe(size) {
  return Buffer.allocUnsafe(size)
}

function allocUnsafeSlow(size) {
  return Buffer.allocUnsafeSlow(size)
}

function byteLength(string, encoding) {
  return Buffer.byteLength(string, encoding)
}

function compare(a, b) {
  return Buffer.compare(a, b)
}

function concat(buffers, totalLength) {
  return Buffer.concat(buffers, totalLength)
}

function copy(source, target, targetStart, start, end) {
  return toBuffer(source).copy(target, targetStart, start, end)
}

function equals(a, b) {
  return toBuffer(a).equals(b)
}

function fill(buffer, value, offset, end, encoding) {
  return toBuffer(buffer).fill(value, offset, end, encoding)
}

function from(value, encodingOrOffset, length) {
  return Buffer.from(value, encodingOrOffset, length)
}

function includes(buffer, value, byteOffset, encoding) {
  return toBuffer(buffer).includes(value, byteOffset, encoding)
}

function indexOf(buffer, value, byfeOffset, encoding) {
  return toBuffer(buffer).indexOf(value, byfeOffset, encoding)
}

function lastIndexOf(buffer, value, byteOffset, encoding) {
  return toBuffer(buffer).lastIndexOf(value, byteOffset, encoding)
}

function swap16(buffer) {
  return toBuffer(buffer).swap16()
}

function swap32(buffer) {
  return toBuffer(buffer).swap32()
}

function swap64(buffer) {
  return toBuffer(buffer).swap64()
}

function toBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) return buffer
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function toString(buffer, encoding, start, end) {
  return toBuffer(buffer).toString(encoding, start, end)
}

function toHex(buffer, start, end) {
  return toBuffer(buffer).toString('hex', start, end)
}

function write(buffer, string, offset, length, encoding) {
  return toBuffer(buffer).write(string, offset, length, encoding)
}

function readDoubleBE(buffer, offset) {
  return toBuffer(buffer).readDoubleBE(offset)
}

function readDoubleLE(buffer, offset) {
  return toBuffer(buffer).readDoubleLE(offset)
}

function readFloatBE(buffer, offset) {
  return toBuffer(buffer).readFloatBE(offset)
}

function readFloatLE(buffer, offset) {
  return toBuffer(buffer).readFloatLE(offset)
}

function readInt32BE(buffer, offset) {
  return toBuffer(buffer).readInt32BE(offset)
}

function readInt32LE(buffer, offset) {
  return toBuffer(buffer).readInt32LE(offset)
}

function readUInt32BE(buffer, offset) {
  return toBuffer(buffer).readUInt32BE(offset)
}

function readUInt32LE(buffer, offset) {
  return toBuffer(buffer).readUInt32LE(offset)
}

function writeDoubleBE(buffer, value, offset) {
  return toBuffer(buffer).writeDoubleBE(value, offset)
}

function writeDoubleLE(buffer, value, offset) {
  return toBuffer(buffer).writeDoubleLE(value, offset)
}

function writeFloatBE(buffer, value, offset) {
  return toBuffer(buffer).writeFloatBE(value, offset)
}

function writeFloatLE(buffer, value, offset) {
  return toBuffer(buffer).writeFloatLE(value, offset)
}

function writeInt32BE(buffer, value, offset) {
  return toBuffer(buffer).writeInt32BE(value, offset)
}

function writeInt32LE(buffer, value, offset) {
  return toBuffer(buffer).writeInt32LE(value, offset)
}

function writeUInt32BE(buffer, value, offset) {
  return toBuffer(buffer).writeUInt32BE(value, offset)
}

function writeUInt32LE(buffer, value, offset) {
  return toBuffer(buffer).writeUInt32LE(value, offset)
}

module.exports = {
  isBuffer,
  isEncoding,
  alloc,
  allocUnsafe,
  allocUnsafeSlow,
  byteLength,
  compare,
  concat,
  copy,
  equals,
  fill,
  from,
  includes,
  indexOf,
  lastIndexOf,
  swap16,
  swap32,
  swap64,
  toBuffer,
  toString,
  toHex,
  write,
  readDoubleBE,
  readDoubleLE,
  readFloatBE,
  readFloatLE,
  readInt32BE,
  readInt32LE,
  readUInt32BE,
  readUInt32LE,
  writeDoubleBE,
  writeDoubleLE,
  writeFloatBE,
  writeFloatLE,
  writeInt32BE,
  writeInt32LE,
  writeUInt32BE,
  writeUInt32LE
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],6:[function(require,module,exports){
module.exports = require.addon()

},{}],7:[function(require,module,exports){
const binding = require('./binding')

module.exports = binding.abort

},{"./binding":6}],8:[function(require,module,exports){
const os = require('bare-os')

module.exports = new Proxy(Object.create(null), {
  ownKeys(target) {
    return os.getEnvKeys()
  },

  get(target, property) {
    if (typeof property !== 'string') return

    return os.getEnv(property)
  },

  has(target, property) {
    if (typeof property !== 'string') return false

    return os.hasEnv(property)
  },

  set(target, property, value) {
    if (typeof property !== 'string') return

    const type = typeof value

    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      throw new Error('Environment variable must be of type string, number, or boolean')
    }

    value = String(value)

    os.setEnv(property, value)

    return true
  },

  deleteProperty(target, property) {
    if (typeof property !== 'string') return

    os.unsetEnv(property)
  },

  getOwnPropertyDescriptor(target, property) {
    return {
      value: this.get(target, property),
      enumerable: true,
      configurable: true,
      writable: true
    }
  }
})

},{"bare-os":19}],9:[function(require,module,exports){
const errors = require('./lib/errors')

class EventListener {
  constructor() {
    this.list = []
    this.count = 0
  }

  append(ctx, name, fn, once) {
    this.count++
    ctx.emit('newListener', name, fn) // Emit BEFORE adding
    this.list.push([fn, once, false])
  }

  prepend(ctx, name, fn, once) {
    this.count++
    ctx.emit('newListener', name, fn) // Emit BEFORE adding
    this.list.unshift([fn, once, false])
  }

  remove(ctx, name, fn) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i][0] === fn) return this.removeAt(ctx, name, i)
    }
  }

  removeAt(ctx, name, i) {
    const fn = this.list[i][0]

    this.list.splice(i, 1)

    if (this.count === 1) delete ctx._events[name]

    ctx.emit('removeListener', name, fn) // Emit AFTER removing

    this.count--
  }

  removeAll(ctx, name) {
    const list = [...this.list]
    this.list = []

    if (this.count === list.length) delete ctx._events[name]

    for (let i = list.length - 1; i >= 0; i--) {
      ctx.emit('removeListener', name, list[i][0]) // Emit AFTER removing
    }

    this.count -= list.length
  }

  emit(ctx, name, ...args) {
    const list = [...this.list]

    for (let i = 0, n = list.length; i < n; i++) {
      const l = list[i]

      if (l[1] === true) {
        // A reentrant emit may already have fired this listener, in which case
        // it must not be fired again.
        if (l[2] === true) continue

        l[2] = true

        // Remove this entry, rather than the first one with the same listener,
        // as the same listener may have been added more than once.
        const j = this.list.indexOf(l)

        if (j !== -1) this.removeAt(ctx, name, j)
      }

      Reflect.apply(l[0], ctx, args)
    }

    return list.length > 0
  }
}

function appendListener(ctx, name, fn, once) {
  if (ctx._events === undefined) ctx._events = Object.create(null)
  const e = ctx._events[name] || (ctx._events[name] = new EventListener())
  e.append(ctx, name, fn, once)
  return ctx
}

function prependListener(ctx, name, fn, once) {
  if (ctx._events === undefined) ctx._events = Object.create(null)
  const e = ctx._events[name] || (ctx._events[name] = new EventListener())
  e.prepend(ctx, name, fn, once)
  return ctx
}

function removeListener(ctx, name, fn) {
  if (ctx._events === undefined) return ctx
  const e = ctx._events[name]
  if (e !== undefined) e.remove(ctx, name, fn)
  return ctx
}

function throwUnhandledError(...args) {
  let err

  if (args.length > 0) err = args[0]

  if (err instanceof Error === false) {
    err = errors.UNHANDLED_ERROR(err)

    if (Error.captureStackTrace) Error.captureStackTrace(err, exports.prototype.emit)
  }

  queueMicrotask(() => {
    throw err
  })
}

module.exports = exports = class EventEmitter {
  constructor() {
    this._events = Object.create(null)
  }

  addListener(name, fn) {
    return appendListener(this, name, fn, false)
  }

  addOnceListener(name, fn) {
    return appendListener(this, name, fn, true)
  }

  prependListener(name, fn) {
    return prependListener(this, name, fn, false)
  }

  prependOnceListener(name, fn) {
    return prependListener(this, name, fn, true)
  }

  removeListener(name, fn) {
    return removeListener(this, name, fn)
  }

  on(name, fn) {
    return appendListener(this, name, fn, false)
  }

  once(name, fn) {
    return appendListener(this, name, fn, true)
  }

  off(name, fn) {
    return removeListener(this, name, fn)
  }

  emit(name, ...args) {
    if (name === 'error' && (this._events === undefined || this._events.error === undefined)) {
      throwUnhandledError(...args)
    }

    if (this._events === undefined) return false
    const e = this._events[name]
    return e === undefined ? false : e.emit(this, name, ...args)
  }

  listeners(name) {
    if (this._events === undefined) return []
    const e = this._events[name]
    return e === undefined ? [] : e.list.map((l) => l[0])
  }

  rawListeners(name) {
    if (this._events === undefined) return []
    const e = this._events[name]
    return e === undefined ? [] : e.list.map((l) => l[0])
  }

  eventNames() {
    if (this._events === undefined) return []
    return Reflect.ownKeys(this._events)
  }

  listenerCount(name) {
    if (this._events === undefined) return 0
    const e = this._events[name]
    return e === undefined ? 0 : e.list.length
  }

  getMaxListeners() {
    return EventEmitter.defaultMaxListeners
  }

  setMaxListeners(n) {
    return this
  }

  removeAllListeners(name) {
    if (this._events === undefined) return this

    if (arguments.length === 0) {
      for (const key of Reflect.ownKeys(this._events)) {
        if (key === 'removeListener') continue
        this.removeAllListeners(key)
      }
      this.removeAllListeners('removeListener')
    } else {
      const e = this._events[name]
      if (e !== undefined) e.removeAll(this, name)
    }
    return this
  }
}

exports.EventEmitter = exports

exports.errors = errors

exports.defaultMaxListeners = 10

exports.on = function on(emitter, name, opts = {}) {
  const { signal } = opts

  if (signal && signal.aborted) {
    throw errors.OPERATION_ABORTED(signal.reason)
  }

  let error = null
  let done = false

  const events = []
  const promises = []

  if (name !== 'error') emitter.on('error', onerror)

  if (signal) signal.addEventListener('abort', onabort)

  emitter.on(name, onevent)

  return {
    next() {
      if (events.length) {
        return Promise.resolve({ value: events.shift(), done: false })
      }

      if (error) {
        const err = error

        error = null

        return Promise.reject(err)
      }

      if (done) return onclose()

      return new Promise((resolve, reject) => promises.push({ resolve, reject }))
    },

    return() {
      return onclose()
    },

    throw(err) {
      return onerror(err)
    },

    [Symbol.asyncIterator]() {
      return this
    }
  }

  function onevent(...args) {
    if (promises.length) {
      promises.shift().resolve({ value: args, done: false })
    } else {
      events.push(args)
    }
  }

  function onerror(err) {
    if (promises.length) {
      promises.shift().reject(err)
    } else {
      error = err
    }

    return onclose()
  }

  function onabort() {
    return onerror(errors.OPERATION_ABORTED(signal.reason))
  }

  function onclose() {
    emitter.off(name, onevent)

    if (name !== 'error') emitter.off('error', onerror)

    if (signal) signal.removeEventListener('abort', onabort)

    done = true

    const result = { done: true }

    while (promises.length) promises.shift().resolve(result)

    return Promise.resolve(result)
  }
}

exports.once = function once(emitter, name, opts = {}) {
  const { signal } = opts

  if (signal && signal.aborted) {
    return Promise.reject(errors.OPERATION_ABORTED(signal.reason))
  }

  return new Promise((resolve, reject) => {
    if (name !== 'error') emitter.on('error', onerror)

    if (signal) signal.addEventListener('abort', onabort)

    emitter.once(name, onevent)

    function onevent(...args) {
      if (name !== 'error') emitter.off('error', onerror)

      if (signal) signal.removeEventListener('abort', onabort)

      resolve(args)
    }

    function onerror(err) {
      emitter.off(name, onevent)

      if (name !== 'error') emitter.off('error', onerror)

      if (signal) signal.removeEventListener('abort', onabort)

      reject(err)
    }

    function onabort() {
      onerror(errors.OPERATION_ABORTED(signal.reason))
    }
  })
}

exports.forward = function forward(from, to, names, opts = {}) {
  if (Array.isArray(names) === false) names = [names]

  const { emit = to.emit.bind(to) } = opts

  const listeners = names.map(
    (name) =>
      function onevent(...args) {
        emit(name, ...args)
      }
  )

  for (let i = 0, n = names.length; i < n; i++) {
    if (to.listenerCount(names[i]) > 0) from.on(names[i], listeners[i])
  }

  to.on('newListener', (name) => {
    const i = names.indexOf(name)

    if (i !== -1 && to.listenerCount(name) === 0) {
      from.on(name, listeners[i])
    }
  }).on('removeListener', (name) => {
    const i = names.indexOf(name)

    if (i !== -1 && to.listenerCount(name) === 0) {
      from.off(name, listeners[i])
    }
  })
}

exports.listenerCount = function listenerCount(emitter, name) {
  return emitter.listenerCount(name)
}

exports.getMaxListeners = function getMaxListeners(emitter) {
  if (typeof emitter.getMaxListeners === 'function') {
    return emitter.getMaxListeners()
  }

  return exports.defaultMaxListeners
}

exports.setMaxListeners = function setMaxListeners(n, ...emitters) {
  if (emitters.length === 0) exports.defaultMaxListeners = n
  else {
    for (const emitter of emitters) {
      if (typeof emitter.setMaxListeners === 'function') {
        emitter.setMaxListeners(n)
      }
    }
  }
}

},{"./lib/errors":10}],10:[function(require,module,exports){
module.exports = class EventEmitterError extends Error {
  constructor(msg, fn = EventEmitterError, opts = {}) {
    const { code = fn.name } = opts

    super(`${code}: ${msg}`, opts)

    this.code = code

    if (Error.captureStackTrace) Error.captureStackTrace(this, fn)
  }

  get name() {
    return 'EventEmitterError'
  }

  static OPERATION_ABORTED(cause, msg = 'Operation aborted') {
    return new EventEmitterError(msg, EventEmitterError.OPERATION_ABORTED, { cause })
  }

  static UNHANDLED_ERROR(cause, msg = 'Unhandled error') {
    return new EventEmitterError(msg, EventEmitterError.UNHANDLED_ERROR, { cause })
  }
}

},{}],11:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],12:[function(require,module,exports){
(function (Buffer){(function (){
const FIFO = require('fast-fifo')
const EventEmitter = require('bare-events')
const path = require('bare-path')
const { isURL, fileURLToPath } = require('bare-url')
const { Readable, Writable } = require('bare-stream')
const binding = require('./binding')
const constants = require('./lib/constants')
const FileError = require('./lib/errors')

const isWindows = Bare.platform === 'win32'

exports.constants = constants

class FileRequest {
  static borrow() {
    if (this._free.length > 0) return this._free.pop()
    return new FileRequest()
  }

  static return(req) {
    if (this._free.length < 32) this._free.push(req.reset())
    else req.destroy()
  }

  constructor() {
    this._reset()
    this._handle = binding.requestInit(this, this._onresult)
  }

  get handle() {
    return this._handle
  }

  retain(value) {
    this._retain = value // Tie the lifetime of `value` to the lifetime of `this`
  }

  reset() {
    if (this._handle === null) return this

    binding.requestReset(this._handle)

    this._reset()

    return this
  }

  destroy() {
    if (this._handle === null) return this

    binding.requestDestroy(this._handle)

    this._reset()
    this._handle = null

    return this
  }

  then(resolve, reject) {
    return this._promise.then(resolve, reject)
  }

  return() {
    if (this._handle === null) return this

    FileRequest.return(this)

    return this
  }

  _reset() {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
    this._retain = null
  }

  _onresult(err, status) {
    if (err) this._reject(err)
    else this._resolve(status)
  }
}

FileRequest._free = []

function ok(result, cb) {
  if (typeof result === 'function') {
    cb = result
    result = undefined
  }

  if (cb) cb(null, result)
  else return result
}

function fail(err, cb) {
  if (cb) cb(err)
  else throw err
}

function done(err, result, cb) {
  if (typeof result === 'function') {
    cb = result
    result = undefined
  }

  if (err) fail(err, cb)
  else return ok(result, cb)
}

async function open(filepath, flags = 'r', mode = 0o666, cb) {
  if (typeof flags === 'function') {
    cb = flags
    flags = 'r'
    mode = 0o666
  } else if (typeof mode === 'function') {
    cb = mode
    mode = 0o666
  }

  if (typeof flags === 'string') flags = toFlags(flags)
  if (typeof mode === 'string') mode = toMode(mode)

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let fd
  let err = null
  try {
    binding.open(req.handle, filepath, flags, mode)

    fd = await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'open',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, fd, cb)
}

function openSync(filepath, flags = 'r', mode = 0o666) {
  if (typeof flags === 'string') flags = toFlags(flags)
  if (typeof mode === 'string') mode = toMode(mode)

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    return binding.openSync(req.handle, filepath, flags, mode)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'open',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function close(fd, cb) {
  const req = FileRequest.borrow()

  let err = null
  try {
    binding.close(req.handle, fd)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'close', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function closeSync(fd) {
  const req = FileRequest.borrow()

  try {
    binding.closeSync(req.handle, fd)
  } catch (e) {
    throw new FileError(e.message, { operation: 'close', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function access(filepath, mode = constants.F_OK, cb) {
  if (typeof mode === 'function') {
    cb = mode
    mode = constants.F_OK
  }

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.access(req.handle, filepath, mode)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'access',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function accessSync(filepath, mode = constants.F_OK) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.accessSync(req.handle, filepath, mode)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'access',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function exists(filepath, cb) {
  let ok = true
  try {
    await access(filepath)
  } catch {
    ok = false
  }

  return done(null, ok, cb)
}

function existsSync(filepath) {
  try {
    accessSync(filepath)
  } catch {
    return false
  }

  return true
}

async function read(fd, buffer, offset = 0, len = buffer.byteLength - offset, pos = -1, cb) {
  if (typeof offset === 'function') {
    cb = offset
    offset = 0
    len = buffer.byteLength
    pos = -1
  } else if (typeof len === 'function') {
    cb = len
    len = buffer.byteLength - offset
    pos = -1
  } else if (typeof pos === 'function') {
    cb = pos
    pos = -1
  }

  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  let bytes
  let err = null
  try {
    binding.read(req.handle, fd, buffer, offset, len, pos)

    req.retain(buffer)

    bytes = await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'read', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, bytes, cb)
}

function readSync(fd, buffer, offset = 0, len = buffer.byteLength - offset, pos = -1) {
  const req = FileRequest.borrow()

  try {
    return binding.readSync(req.handle, fd, buffer, offset, len, pos)
  } catch (e) {
    throw new FileError(e.message, { operation: 'read', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function readv(fd, buffers, pos = -1, cb) {
  if (typeof pos === 'function') {
    cb = pos
    pos = -1
  }

  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  let bytes
  let err = null
  try {
    binding.readv(req.handle, fd, buffers, pos)

    req.retain(buffers)

    bytes = await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'readv', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, bytes, cb)
}

function readvSync(fd, buffers, pos = -1) {
  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  try {
    return binding.readvSync(req.handle, fd, buffers, pos)
  } catch (e) {
    throw new FileError(e.message, { operation: 'readv', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function write(fd, data, offset, len, pos = -1, cb) {
  if (typeof data === 'string') {
    let encoding = len
    cb = pos
    pos = offset

    if (typeof pos === 'function') {
      cb = pos
      pos = -1
      encoding = 'utf8'
    } else if (typeof encoding === 'function') {
      cb = encoding
      encoding = 'utf8'
    }

    if (typeof pos === 'string') {
      encoding = pos
      pos = -1
    }

    data = Buffer.from(data, encoding)
    offset = 0
    len = data.byteLength
  } else if (typeof offset === 'function') {
    cb = offset
    offset = 0
    len = data.byteLength
    pos = -1
  } else if (typeof len === 'function') {
    cb = len
    len = data.byteLength - offset
    pos = -1
  } else if (typeof pos === 'function') {
    cb = pos
    pos = -1
  }

  if (typeof offset !== 'number') offset = 0
  if (typeof len !== 'number') len = data.byteLength - offset
  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  let bytes
  let err = null
  try {
    binding.write(req.handle, fd, data, offset, len, pos)

    req.retain(data)

    bytes = await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'write', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, bytes, cb)
}

function writeSync(fd, data, offset, len, pos = -1) {
  if (typeof data === 'string') {
    let encoding = len
    pos = offset

    if (typeof pos === 'string') {
      encoding = pos
      pos = -1
    }

    data = Buffer.from(data, encoding)
    offset = 0
    len = data.byteLength
  }

  if (typeof offset !== 'number') offset = 0
  if (typeof len !== 'number') len = data.byteLength - offset
  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  try {
    return binding.writeSync(req.handle, fd, data, offset, len, pos)
  } catch (e) {
    throw new FileError(e.message, { operation: 'write', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function writev(fd, buffers, pos = -1, cb) {
  if (typeof pos === 'function') {
    cb = pos
    pos = -1
  }

  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  let bytes
  let err = null
  try {
    binding.writev(req.handle, fd, buffers, pos)

    req.retain(buffers)

    bytes = await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'writev', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, bytes, cb)
}

function writevSync(fd, buffers, pos = -1) {
  if (typeof pos !== 'number') pos = -1

  const req = FileRequest.borrow()

  try {
    return binding.writevSync(req.handle, fd, buffers, pos)
  } catch (e) {
    throw new FileError(e.message, { operation: 'writev', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function stat(filepath, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let st
  let err = null
  try {
    binding.stat(req.handle, filepath)

    await req

    st = new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    err = new FileError(e.message, { operation: 'stat', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, st, cb)
}

function statSync(filepath) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.statSync(req.handle, filepath)

    return new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    throw new FileError(e.message, { operation: 'stat', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function lstat(filepath, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let st
  let err = null
  try {
    binding.lstat(req.handle, filepath)

    await req

    st = new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    err = new FileError(e.message, { operation: 'lstat', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, st, cb)
}

function lstatSync(filepath) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.lstatSync(req.handle, filepath)

    return new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    throw new FileError(e.message, { operation: 'lstat', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function fstat(fd, cb) {
  const req = FileRequest.borrow()

  let st
  let err = null
  try {
    binding.fstat(req.handle, fd)

    await req

    st = new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    err = new FileError(e.message, { operation: 'fstat', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, st, cb)
}

function fstatSync(fd) {
  const req = FileRequest.borrow()

  try {
    binding.fstatSync(req.handle, fd)

    return new Stats(...binding.requestResultStat(req.handle))
  } catch (e) {
    throw new FileError(e.message, { operation: 'fstat', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function statfs(filepath, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let st
  let err = null
  try {
    binding.statfs(req.handle, filepath)

    await req

    st = new StatFs(...binding.requestResultStatfs(req.handle))
  } catch (e) {
    err = new FileError(e.message, { operation: 'statfs', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, st, cb)
}

function statfsSync(filepath) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.statfsSync(req.handle, filepath)

    return new StatFs(...binding.requestResultStatfs(req.handle))
  } catch (e) {
    throw new FileError(e.message, { operation: 'statfs', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function ftruncate(fd, len = 0, cb) {
  if (typeof len === 'function') {
    cb = len
    len = 0
  }

  if (typeof len !== 'number') len = 0

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.ftruncate(req.handle, fd, len)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'ftruncate', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function ftruncateSync(fd, len = 0) {
  if (typeof len !== 'number') len = 0

  const req = FileRequest.borrow()

  try {
    binding.ftruncateSync(req.handle, fd, len)
  } catch (e) {
    throw new FileError(e.message, { operation: 'ftruncate', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function truncate(filepath, len, cb) {
  let fd = -1
  let err

  try {
    fd = await open(filepath, 'r+')

    await ftruncate(fd, len)
  } catch (e) {
    err = e
  } finally {
    if (fd !== -1) await close(fd)
  }

  return done(err, cb)
}

function truncateSync(filepath, len) {
  let fd = -1
  let err

  try {
    fd = openSync(filepath, 'r+')

    ftruncateSync(fd, len)
  } catch (e) {
    err = e
  } finally {
    if (fd !== -1) closeSync(fd)
  }
}

async function chmod(filepath, mode, cb) {
  if (typeof mode === 'string') mode = toMode(mode)

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.chmod(req.handle, filepath, mode)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'chmod',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function chmodSync(filepath, mode) {
  if (typeof mode === 'string') mode = toMode(mode)

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.chmodSync(req.handle, filepath, mode)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'chmod',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function fchmod(fd, mode, cb) {
  if (typeof mode === 'string') mode = toMode(mode)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.fchmod(req.handle, fd, mode)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'fchmod', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function fchmodSync(fd, mode) {
  if (typeof mode === 'string') mode = toMode(mode)

  const req = FileRequest.borrow()

  try {
    binding.fchmodSync(req.handle, fd, mode)
  } catch (e) {
    throw new FileError(e.message, { operation: 'fchmod', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function chown(filepath, uid, gid, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.chown(req.handle, filepath, uid, gid)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'chown', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function chownSync(filepath, uid, gid) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.chownSync(req.handle, filepath, uid, gid)
  } catch (e) {
    throw new FileError(e.message, { operation: 'chownSync', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function lchown(filepath, uid, gid, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.lchown(req.handle, filepath, uid, gid)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'lchown', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function lchownSync(filepath, uid, gid) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.lchownSync(req.handle, filepath, uid, gid)
  } catch (e) {
    throw new FileError(e.message, { operation: 'lchownSync', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function fchown(fd, uid, gid, cb) {
  const req = FileRequest.borrow()

  let err = null
  try {
    binding.fchown(req.handle, fd, uid, gid)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'fchown', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function fchownSync(fd, uid, gid) {
  const req = FileRequest.borrow()

  try {
    binding.fchownSync(req.handle, fd, uid, gid)
  } catch (e) {
    throw new FileError(e.message, { operation: 'fchownSync', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function utimes(filepath, atime, mtime, cb) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.utimes(req.handle, filepath, atime, mtime)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'utimes', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function utimesSync(filepath, atime, mtime) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.utimesSync(req.handle, filepath, atime, mtime)
  } catch (e) {
    throw new FileError(e.message, { operation: 'utimes', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function lutimes(filepath, atime, mtime, cb) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.lutimes(req.handle, filepath, atime, mtime)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'lutimes', code: e.code, path: filepath })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function lutimesSync(filepath, atime, mtime) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.lutimesSync(req.handle, filepath, atime, mtime)
  } catch (e) {
    throw new FileError(e.message, { operation: 'lutimes', code: e.code, path: filepath })
  } finally {
    req.return()
  }
}

async function futimes(fd, atime, mtime, cb) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.futimes(req.handle, fd, atime, mtime)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'futimes', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function futimesSync(fd, atime, mtime) {
  if (typeof atime !== 'number') atime = atime.getTime() / 1000
  if (typeof mtime !== 'number') mtime = mtime.getTime() / 1000

  const req = FileRequest.borrow()

  try {
    binding.futimesSync(req.handle, fd, atime, mtime)
  } catch (e) {
    throw new FileError(e.message, { operation: 'futimesSync', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function link(src, dst, cb) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.link(req.handle, src, dst)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'link', code: e.code, path: src, destination: dst })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function linkSync(src, dst) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  try {
    binding.linkSync(req.handle, src, dst)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'linkSync',
      code: e.code,
      path: src,
      destination: dst
    })
  } finally {
    req.return()
  }
}

async function mkdir(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = { mode: 0o777 }
  }

  if (typeof opts === 'number') opts = { mode: opts }
  else if (!opts) opts = {}

  const mode = typeof opts.mode === 'number' ? opts.mode : 0o777

  filepath = toNamespacedPath(filepath)

  if (opts.recursive) {
    let err = null
    try {
      try {
        await mkdir(filepath, { mode })
      } catch (err) {
        if (err.code !== 'ENOENT') {
          if (!(await stat(filepath)).isDirectory()) throw err
        } else {
          while (filepath.endsWith(path.sep)) filepath = filepath.slice(0, -1)
          const i = filepath.lastIndexOf(path.sep)
          if (i <= 0) throw err

          await mkdir(filepath.slice(0, i), { mode, recursive: true })

          try {
            await mkdir(filepath, { mode })
          } catch (err) {
            if (!(await stat(filepath)).isDirectory()) throw err
          }
        }
      }
    } catch (e) {
      err = e
    }

    return done(err, cb)
  }

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.mkdir(req.handle, filepath, mode)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'mkdir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function mkdirSync(filepath, opts) {
  if (typeof opts === 'number') opts = { mode: opts }
  else if (!opts) opts = {}

  const mode = typeof opts.mode === 'number' ? opts.mode : 0o777

  filepath = toNamespacedPath(filepath)

  if (opts.recursive) {
    try {
      mkdirSync(filepath, { mode })
    } catch (err) {
      if (err.code !== 'ENOENT') {
        if (!statSync(filepath).isDirectory()) throw err
      } else {
        while (filepath.endsWith(path.sep)) filepath = filepath.slice(0, -1)
        const i = filepath.lastIndexOf(path.sep)
        if (i <= 0) throw err

        mkdirSync(filepath.slice(0, i), { mode, recursive: true })

        try {
          mkdirSync(filepath, { mode })
        } catch (err) {
          if (!statSync(filepath).isDirectory()) throw err
        }
      }
    }

    return
  }

  const req = FileRequest.borrow()

  try {
    binding.mkdirSync(req.handle, filepath, mode)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'mkdir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function mkdtemp(prefix, cb) {
  prefix = toNamespacedPath(prefix)

  const req = FileRequest.borrow()

  let res
  let err = null
  try {
    binding.mkdtemp(req.handle, prefix + 'XXXXXX')

    await req

    res = binding.requestResultPath(req.handle)
  } catch (e) {
    err = new FileError(e.message, { operation: 'mkdtemp', code: e.code, path: prefix })
  } finally {
    req.return()
  }

  return done(err, res, cb)
}

function mkdtempSync(prefix) {
  prefix = toNamespacedPath(prefix)

  const req = FileRequest.borrow()

  try {
    binding.mkdtempSync(req.handle, prefix + 'XXXXXX')

    return binding.requestResultPath(req.handle)
  } catch (e) {
    throw new FileError(e.message, { operation: 'mkdtempSync', code: e.code, path: prefix })
  } finally {
    req.return()
  }
}

async function rmdir(filepath, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.rmdir(req.handle, filepath)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'rmdir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function rmdirSync(filepath) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.rmdirSync(req.handle, filepath)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'rmdir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function rm(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (!opts) opts = {}

  filepath = toNamespacedPath(filepath)

  let err = null
  try {
    const st = await lstat(filepath)

    if (st.isDirectory()) {
      if (opts.recursive) {
        try {
          await rmdir(filepath)
        } catch (err) {
          if (err.code !== 'ENOTEMPTY') throw err

          const files = await readdir(filepath)

          for (const file of files) {
            await rm(filepath + path.sep + file, opts)
          }

          await rmdir(filepath)
        }
      } else {
        throw new FileError('is a directory', {
          operation: 'rm',
          code: 'EISDIR',
          path: filepath
        })
      }
    } else {
      await unlink(filepath)
    }
  } catch (e) {
    if (e.code !== 'ENOENT' || !opts.force) err = e
  }

  return done(err, cb)
}

function rmSync(filepath, opts) {
  if (!opts) opts = {}

  filepath = toNamespacedPath(filepath)

  try {
    const st = lstatSync(filepath)

    if (st.isDirectory()) {
      if (opts.recursive) {
        try {
          rmdirSync(filepath)
        } catch (err) {
          if (err.code !== 'ENOTEMPTY') throw err

          const files = readdirSync(filepath)

          for (const file of files) {
            rmSync(filepath + path.sep + file, opts)
          }

          rmdirSync(filepath)
        }
      } else {
        throw new FileError('is a directory', {
          operation: 'rm',
          code: 'EISDIR',
          path: filepath
        })
      }
    } else {
      unlinkSync(filepath)
    }
  } catch (err) {
    if (err.code !== 'ENOENT' || !opts.force) throw err
  }
}

async function unlink(filepath, cb) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.unlink(req.handle, filepath)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'unlink',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function unlinkSync(filepath) {
  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.unlinkSync(req.handle, filepath)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'unlink',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function rename(src, dst, cb) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.rename(req.handle, src, dst)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'rename',
      code: e.code,
      path: src,
      destination: dst
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function renameSync(src, dst) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  try {
    binding.renameSync(req.handle, src, dst)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'rename',
      code: e.code,
      path: src,
      destination: dst
    })
  } finally {
    req.return()
  }
}

async function copyFile(src, dst, mode = 0, cb) {
  if (typeof mode === 'function') {
    cb = mode
    mode = 0
  }

  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.copyfile(req.handle, src, dst, mode)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'copyfile',
      code: e.code,
      path: src,
      destination: dst
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function copyFileSync(src, dst, mode = 0) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const req = FileRequest.borrow()

  try {
    binding.copyfileSync(req.handle, src, dst, mode)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'copyfile',
      code: e.code,
      path: src,
      destination: dst
    })
  } finally {
    req.return()
  }
}

async function cp(src, dst, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (!opts) opts = {}

  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  let err = null
  try {
    const st = await lstat(src)

    if (st.isDirectory()) {
      if (opts.recursive !== true) {
        throw new FileError('is a directory', { operation: 'cp', code: 'EISDIR', path: src })
      }

      try {
        await lstat(dst)
      } catch (e) {
        if (e.code !== 'ENOENT') throw e

        await mkdir(dst, { mode: st.mode, recursive: true })
      }

      const dir = await opendir(src)
      for await (const { name } of dir) {
        await cp(path.join(src, name), path.join(dst, name), opts)
      }
    } else if (st.isFile()) {
      await copyFile(src, dst)
      await chmod(dst, st.mode)
    } else if (st.isSymbolicLink()) {
      try {
        if (!(await lstat(dst)).isDirectory()) await unlink(dst)
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }

      await symlink(await readlink(src), dst)
    } else {
      throw new FileError('cannot copy a special file', {
        operation: 'cp',
        code: 'ENOTSUP',
        path: src
      })
    }
  } catch (e) {
    err = e
  }

  return done(err, cb)
}

function cpSync(src, dst, opts = {}) {
  src = toNamespacedPath(src)
  dst = toNamespacedPath(dst)

  const st = lstatSync(src)

  if (st.isDirectory()) {
    if (opts.recursive !== true) {
      throw new FileError('is a directory', { operation: 'cp', code: 'EISDIR', path: src })
    }

    try {
      lstatSync(dst)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e

      mkdirSync(dst, { mode: st.mode, recursive: true })
    }

    const dir = opendirSync(src)
    for (const { name } of dir) {
      cpSync(path.join(src, name), path.join(dst, name), opts)
    }
  } else if (st.isFile()) {
    copyFileSync(src, dst)
    chmodSync(dst, st.mode)
  } else if (st.isSymbolicLink()) {
    try {
      if (!lstatSync(dst).isDirectory()) unlinkSync(dst)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }

    symlinkSync(readlinkSync(src), dst)
  } else {
    throw new FileError('cannot copy a special file', {
      operation: 'cp',
      code: 'ENOTSUP',
      path: src
    })
  }
}

async function realpath(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'utf8' } = opts

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let res
  let err = null
  try {
    binding.realpath(req.handle, filepath)

    await req

    res = Buffer.from(binding.requestResultString(req.handle))

    if (encoding !== 'buffer') res = res.toString(encoding)
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'realpath',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, res, cb)
}

function realpathSync(filepath, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'utf8' } = opts

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.realpathSync(req.handle, filepath)

    let res = Buffer.from(binding.requestResultString(req.handle))

    if (encoding !== 'buffer') res = res.toString(encoding)

    return res
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'realpath',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function readlink(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'utf8' } = opts

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let res
  let err = null
  try {
    binding.readlink(req.handle, filepath)

    await req

    res = Buffer.from(binding.requestResultString(req.handle))

    if (encoding !== 'buffer') res = res.toString(encoding)
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'readlink',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, res, cb)
}

function readlinkSync(filepath, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'utf8' } = opts

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.readlinkSync(req.handle, filepath)

    let res = Buffer.from(binding.requestResultString(req.handle))

    if (encoding !== 'buffer') res = res.toString(encoding)

    return res
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'readlink',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function fsync(fd, cb) {
  const req = FileRequest.borrow()

  let err = null
  try {
    binding.fsync(req.handle, fd)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'fsync', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function fsyncSync(fd) {
  const req = FileRequest.borrow()

  try {
    binding.fsyncSync(req.handle, fd)
  } catch (e) {
    throw new FileError(e.message, { operation: 'fsyncSync', code: e.code, fd })
  } finally {
    req.return()
  }
}

async function fdatasync(fd, cb) {
  const req = FileRequest.borrow()

  let err = null
  try {
    binding.fdatasync(req.handle, fd)

    await req
  } catch (e) {
    err = new FileError(e.message, { operation: 'fdatasync', code: e.code, fd })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function fdatasyncSync(fd) {
  const req = FileRequest.borrow()

  try {
    binding.fdatasyncSync(req.handle, fd)
  } catch (e) {
    throw new FileError(e.message, { operation: 'fdatasyncSync', code: e.code, fd })
  } finally {
    req.return()
  }
}

function normalizeSymlinkTarget(target, type, filepath) {
  if (isWindows) {
    if (type === constants.UV_FS_SYMLINK_JUNCTION) target = path.resolve(filepath, '..', target)

    if (path.isAbsolute(target)) return path.toNamespacedPath(target)

    return target.replace(/\//g, path.sep)
  }

  return target
}

async function symlink(target, filepath, type, cb) {
  if (typeof type === 'function') {
    cb = type
    type = null
  }

  filepath = toNamespacedPath(filepath)

  if (typeof type === 'string') {
    switch (type) {
      case 'dir':
        type = constants.UV_FS_SYMLINK_DIR
        break
      case 'junction':
        type = constants.UV_FS_SYMLINK_JUNCTION
        break
      case 'file':
      default:
        type = 0
        break
    }
  } else if (typeof type !== 'number') {
    if (isWindows) {
      target = path.resolve(filepath, '..', target)

      try {
        type = (await stat(target)).isDirectory() ? constants.UV_FS_SYMLINK_DIR : 0
      } catch {
        type = 0
      }
    } else {
      type = 0
    }
  }

  target = normalizeSymlinkTarget(target, type, filepath)

  const req = FileRequest.borrow()

  let err = null
  try {
    binding.symlink(req.handle, target, filepath, type)

    await req
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'symlink',
      code: e.code,
      path: target,
      destination: filepath
    })
  } finally {
    req.return()
  }

  return done(err, cb)
}

function symlinkSync(target, filepath, type) {
  filepath = toNamespacedPath(filepath)

  if (typeof type === 'string') {
    switch (type) {
      case 'dir':
        type = constants.UV_FS_SYMLINK_DIR
        break
      case 'junction':
        type = constants.UV_FS_SYMLINK_JUNCTION
        break
      case 'file':
      default:
        type = 0
        break
    }
  } else if (typeof type !== 'number') {
    if (isWindows) {
      target = path.resolve(filepath, '..', target)

      try {
        type = statSync(target).isDirectory() ? constants.UV_FS_SYMLINK_DIR : 0
      } catch {
        type = 0
      }
    } else {
      type = 0
    }
  }

  target = normalizeSymlinkTarget(target, type, filepath)

  const req = FileRequest.borrow()

  try {
    binding.symlinkSync(req.handle, target, filepath, type)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'symlink',
      code: e.code,
      path: target,
      destination: filepath
    })
  } finally {
    req.return()
  }
}

async function opendir(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  let dir
  let err = null
  try {
    binding.opendir(req.handle, filepath)

    await req

    dir = new Dir(filepath, binding.requestResultDir(req.handle), opts)
  } catch (e) {
    err = new FileError(e.message, {
      operation: 'opendir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }

  return done(err, dir, cb)
}

function opendirSync(filepath, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  filepath = toNamespacedPath(filepath)

  const req = FileRequest.borrow()

  try {
    binding.opendirSync(req.handle, filepath)

    return new Dir(filepath, binding.requestResultDir(req.handle), opts)
  } catch (e) {
    throw new FileError(e.message, {
      operation: 'opendir',
      code: e.code,
      path: filepath
    })
  } finally {
    req.return()
  }
}

async function readdir(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { withFileTypes = false, recursive = false } = opts

  filepath = toNamespacedPath(filepath)

  const queue = [filepath]
  let result = []
  let err = null
  try {
    while (queue.length !== 0) {
      const dir = await opendir(queue.pop())

      for await (const entry of dir) {
        const entryPath = path.join(entry.parentPath, entry.name)

        if (withFileTypes) {
          result.push(entry)
        } else {
          result.push(path.relative(filepath, entryPath))
        }

        if (recursive && entry.isDirectory()) queue.push(entryPath)
      }
    }
  } catch (e) {
    result = []
    err = e
  }

  return done(err, result, cb)
}

function readdirSync(filepath, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { withFileTypes = false, recursive = false } = opts

  filepath = toNamespacedPath(filepath)

  const queue = [filepath]
  const result = []

  while (queue.length !== 0) {
    const dir = opendirSync(queue.pop(), opts)

    for (const entry of dir) {
      const entryPath = path.join(entry.parentPath, entry.name)

      if (withFileTypes) {
        result.push(entry)
      } else {
        result.push(path.relative(filepath, entryPath))
      }

      if (recursive && entry.isDirectory()) queue.push(entryPath)
    }
  }

  return result
}

async function readFile(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'buffer' } = opts

  let fd = -1
  let buffer = null
  let err = null
  try {
    fd = await open(filepath, opts.flag || 'r')

    const st = await fstat(fd)

    let len = 0

    if (st.size === 0) {
      const buffers = []

      while (true) {
        buffer = Buffer.allocUnsafe(8192)
        const r = await read(fd, buffer)
        len += r
        if (r === 0) break
        buffers.push(buffer.subarray(0, r))
      }

      buffer = Buffer.concat(buffers)
    } else {
      buffer = Buffer.allocUnsafe(st.size)

      while (true) {
        const r = await read(fd, len ? buffer.subarray(len) : buffer)
        len += r
        if (r === 0 || len === buffer.byteLength) break
      }

      if (len !== buffer.byteLength) buffer = buffer.subarray(0, len)
    }

    if (encoding !== 'buffer') buffer = buffer.toString(encoding)
  } catch (e) {
    err = e
  } finally {
    if (fd !== -1) await close(fd)
  }

  return done(err, buffer, cb)
}

function readFileSync(filepath, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  const { encoding = 'buffer' } = opts

  let fd = -1
  try {
    fd = openSync(filepath, opts.flag || 'r')

    const st = fstatSync(fd)

    let buffer
    let len = 0

    if (st.size === 0) {
      const buffers = []

      while (true) {
        buffer = Buffer.allocUnsafe(8192)
        const r = readSync(fd, buffer)
        len += r
        if (r === 0) break
        buffers.push(buffer.subarray(0, r))
      }

      buffer = Buffer.concat(buffers)
    } else {
      buffer = Buffer.allocUnsafe(st.size)

      while (true) {
        const r = readSync(fd, len ? buffer.subarray(len) : buffer)
        len += r
        if (r === 0 || len === buffer.byteLength) break
      }

      if (len !== buffer.byteLength) buffer = buffer.subarray(0, len)
    }

    if (encoding !== 'buffer') buffer = buffer.toString(encoding)

    return buffer
  } finally {
    if (fd !== -1) closeSync(fd)
  }
}

async function writeFile(filepath, data, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  if (typeof data === 'string') data = Buffer.from(data, opts.encoding)

  let fd = -1
  let len = 0
  let err = null
  try {
    fd = await open(filepath, opts.flag || 'w', opts.mode || 0o666)

    while (true) {
      len += await write(fd, len ? data.subarray(len) : data)
      if (len === data.byteLength) break
    }
  } catch (e) {
    err = e
  } finally {
    if (fd !== -1) await close(fd)
  }

  return done(err, len, cb)
}

function writeFileSync(filepath, data, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  if (typeof data === 'string') data = Buffer.from(data, opts.encoding)

  let fd = -1
  try {
    fd = openSync(filepath, opts.flag || 'w', opts.mode || 0o666)

    let len = 0

    while (true) {
      len += writeSync(fd, len ? data.subarray(len) : data)
      if (len === data.byteLength) break
    }
  } finally {
    if (fd !== -1) closeSync(fd)
  }
}

function appendFile(filepath, data, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  if (!opts.flag) opts = { ...opts, flag: 'a' }

  return writeFile(filepath, data, opts, cb)
}

function appendFileSync(filepath, data, opts) {
  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  if (!opts.flag) opts = { ...opts, flag: 'a' }

  return writeFileSync(filepath, data, opts)
}

function watch(filepath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (typeof opts === 'string') opts = { encoding: opts }
  else if (!opts) opts = {}

  filepath = toNamespacedPath(filepath)

  return new Watcher(filepath, opts, cb)
}

class Stats {
  constructor(
    dev,
    mode,
    nlink,
    uid,
    gid,
    rdev,
    blksize,
    ino,
    size,
    blocks,
    atimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs
  ) {
    this.dev = dev
    this.mode = mode
    this.nlink = nlink
    this.uid = uid
    this.gid = gid
    this.rdev = rdev
    this.blksize = blksize
    this.ino = ino
    this.size = size
    this.blocks = blocks
    this.atimeMs = atimeMs
    this.mtimeMs = mtimeMs
    this.ctimeMs = ctimeMs
    this.birthtimeMs = birthtimeMs
    this.atime = new Date(atimeMs)
    this.mtime = new Date(mtimeMs)
    this.ctime = new Date(ctimeMs)
    this.birthtime = new Date(birthtimeMs)
  }

  isDirectory() {
    return (this.mode & constants.S_IFMT) === constants.S_IFDIR
  }

  isFile() {
    return (this.mode & constants.S_IFMT) === constants.S_IFREG
  }

  isBlockDevice() {
    return (this.mode & constants.S_IFMT) === constants.S_IFBLK
  }

  isCharacterDevice() {
    return (this.mode & constants.S_IFMT) === constants.S_IFCHR
  }

  isFIFO() {
    return (this.mode & constants.S_IFMT) === constants.S_IFIFO
  }

  isSymbolicLink() {
    return (this.mode & constants.S_IFMT) === constants.S_IFLNK
  }

  isSocket() {
    return (this.mode & constants.S_IFMT) === constants.S_IFSOCK
  }
}

class StatFs {
  constructor(type, bsize, blocks, bfree, bavail, files, ffree, frsize) {
    this.type = type
    this.bsize = bsize
    this.blocks = blocks
    this.bfree = bfree
    this.bavail = bavail
    this.files = files
    this.ffree = ffree
    this.frsize = frsize
  }
}

class Dir {
  constructor(path, handle, opts = {}) {
    const { encoding = 'utf8', bufferSize = 32 } = opts

    this.path = path

    this._encoding = encoding
    this._capacity = bufferSize
    this._buffer = new FIFO()
    this._ended = false
    this._handle = handle
  }

  async read(cb) {
    if (this._buffer.length) return ok(this._buffer.shift(), cb)
    if (this._ended) return ok(null, cb)

    const req = FileRequest.borrow()

    let entries
    let err = null
    try {
      req.retain(binding.readdir(req.handle, this._handle, this._capacity))

      await req

      entries = binding.requestResultDirents(req.handle)
    } catch (e) {
      err = new FileError(e.message, {
        operation: 'readdir',
        code: e.code,
        path: this.path
      })
    } finally {
      req.return()
    }

    if (err) return fail(err, cb)

    if (entries.length === 0) {
      this._ended = true

      return ok(null, cb)
    }

    for (const entry of entries) {
      let name = Buffer.from(entry.name)

      if (this._encoding !== 'buffer') name = name.toString(this._encoding)

      this._buffer.push(new Dirent(this.path, name, entry.type))
    }

    return ok(this._buffer.shift(), cb)
  }

  readSync() {
    if (this._buffer.length) return this._buffer.shift()
    if (this._ended) return null

    const req = FileRequest.borrow()

    let entries
    try {
      req.retain(binding.readdirSync(req.handle, this._handle, this._capacity))

      entries = binding.requestResultDirents(req.handle)
    } catch (e) {
      throw new FileError(e.message, {
        operation: 'readdir',
        code: e.code,
        path: this.path
      })
    } finally {
      req.return()
    }

    if (entries.length === 0) {
      this._ended = true

      return null
    }

    for (const entry of entries) {
      let name = Buffer.from(entry.name)

      if (this._encoding !== 'buffer') name = name.toString(this._encoding)

      this._buffer.push(new Dirent(this.path, name, entry.type))
    }

    return this._buffer.shift()
  }

  async close(cb) {
    const req = FileRequest.borrow()

    let err = null
    try {
      binding.closedir(req.handle, this._handle)

      await req
    } catch (e) {
      err = new FileError(e.message, {
        operation: 'closedir',
        code: e.code,
        path: this.path
      })
    } finally {
      req.return()
    }

    this._handle = null

    return done(err, cb)
  }

  closeSync() {
    const req = FileRequest.borrow()

    try {
      binding.closedirSync(req.handle, this._handle)
    } catch (e) {
      throw new FileError(e.message, {
        operation: 'closedir',
        code: e.code,
        path: this.path
      })
    } finally {
      req.return()
    }

    this._handle = null
  }

  [Symbol.dispose]() {
    this.closeSync()
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  *[Symbol.iterator]() {
    while (true) {
      const entry = this.readSync()
      if (entry === null) break
      yield entry
    }

    this.closeSync()
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const entry = await this.read()
      if (entry === null) break
      yield entry
    }

    await this.close()
  }
}

class Dirent {
  constructor(parentPath, name, type) {
    this.parentPath = parentPath
    this.name = name
    this.type = type
  }

  isFile() {
    return this.type === constants.UV_DIRENT_FILE
  }

  isDirectory() {
    return this.type === constants.UV_DIRENT_DIR
  }

  isSymbolicLink() {
    return this.type === constants.UV_DIRENT_LINK
  }

  isFIFO() {
    return this.type === constants.UV_DIRENT_FIFO
  }

  isSocket() {
    return this.type === constants.UV_DIRENT_SOCKET
  }

  isCharacterDevice() {
    return this.type === constants.UV_DIRENT_CHAR
  }

  isBlockDevice() {
    return this.type === constants.UV_DIRENT_BLOCK
  }
}

class FileReadStream extends Readable {
  constructor(path, opts = {}) {
    const { eagerOpen = true } = opts

    super({ eagerOpen, ...opts })

    this.path = path
    this.fd = typeof opts.fd === 'number' ? opts.fd : -1
    this.flags = opts.flags || 'r'
    this.mode = opts.mode || 0o666

    this._offset = opts.start || 0
    this._missing = 0

    if (opts.length) {
      this._missing = opts.length
    } else if (typeof opts.end === 'number') {
      this._missing = opts.end - this._offset + 1
    } else {
      this._missing = -1
    }
  }

  async _open(cb) {
    let err

    if (this.fd === -1) {
      err = null
      try {
        this.fd = await open(this.path, this.flags, this.mode)
      } catch (e) {
        err = e
      }

      if (err) return cb(err)
    }

    let st
    err = null
    try {
      st = await fstat(this.fd)
    } catch (e) {
      err = e
    }

    if (err) return cb(err)

    this._isCharacterDevice = st.isCharacterDevice()

    if (this._isCharacterDevice) {
      this._missing = Infinity
    } else {
      if (this._missing === -1) this._missing = st.size

      if (st.size < this._offset) {
        this._offset = st.size
        this._missing = 0
      } else if (st.size < this._offset + this._missing) {
        this._missing = st.size - this._offset
      }
    }

    cb(null)
  }

  async _read(size) {
    if (this._missing <= 0) return this.push(null)

    const data = Buffer.allocUnsafe(Math.min(this._missing, size))

    let len
    let err = null
    try {
      len = await read(
        this.fd,
        data,
        0,
        data.byteLength,
        this._isCharacterDevice ? -1 : this._offset
      )
    } catch (e) {
      err = e
    }

    if (err) return this.destroy(err)

    if (len === 0) return this.push(null)

    if (this._missing < len) len = this._missing

    this._missing -= len
    this._offset += len

    this.push(data.subarray(0, len))
  }

  async _destroy(err, cb) {
    if (this.fd === -1) return cb(err)

    try {
      await close(this.fd)
    } catch (e) {
      err = err || e
    }

    cb(err)
  }
}

class FileWriteStream extends Writable {
  constructor(path, opts = {}) {
    const { eagerOpen = true } = opts

    super({ eagerOpen, ...opts })

    this.path = path
    this.fd = typeof opts.fd === 'number' ? opts.fd : -1
    this.flags = opts.flags || 'w'
    this.mode = opts.mode || 0o666
  }

  async _open(cb) {
    if (this.fd !== -1) return cb(null)

    let err = null
    try {
      this.fd = await open(this.path, this.flags, this.mode)
    } catch (e) {
      err = e
    }

    cb(err)
  }

  async _writev(batch, cb) {
    let err = null
    try {
      await writev(
        this.fd,
        batch.map(({ chunk }) => chunk)
      )
    } catch (e) {
      err = e
    }

    cb(err)
  }

  async _destroy(err, cb) {
    if (this.fd === -1) return cb(err)

    try {
      await close(this.fd)
    } catch (e) {
      err = err || e
    }

    cb(err)
  }
}

class Watcher extends EventEmitter {
  constructor(path, opts, onchange) {
    if (typeof opts === 'function') {
      onchange = opts
      opts = {}
    }

    if (!opts) opts = {}

    const { persistent = true, recursive = false, encoding = 'utf8' } = opts

    super()

    this._closed = false
    this._encoding = encoding
    this._handle = binding.watcherInit(this, this._onevent, this._onclose)

    try {
      binding.watcherStart(this._handle, path, recursive)
    } catch (err) {
      this.close()
      throw err
    }

    if (!persistent) this.unref()

    if (onchange) this.on('change', onchange)
  }

  close() {
    if (this._closed) return
    this._closed = true

    binding.watcherClose(this._handle)
  }

  ref() {
    if (this._handle) binding.watcherRef(this._handle)
    return this
  }

  unref() {
    if (this._handle) binding.watcherUnref(this._handle)
    return this
  }

  [Symbol.asyncIterator]() {
    const buffer = []
    let done = false
    let error = null
    let next = null

    this.on('change', (eventType, filename) => {
      if (next) {
        next.resolve({ done: false, value: { eventType, filename } })
        next = null
      } else {
        buffer.push({ eventType, filename })
      }
    })
      .on('error', (err) => {
        done = true
        error = err

        if (next) {
          next.reject(error)
          next = null
        }
      })
      .on('close', () => {
        done = true

        if (next) {
          next.resolve({ done })
          next = null
        }
      })

    return {
      next: () =>
        new Promise((resolve, reject) => {
          if (error) return reject(error)

          if (buffer.length) return resolve({ done: false, value: buffer.shift() })

          if (done) return resolve({ done })

          next = { resolve, reject }
        })
    }
  }

  _onevent(err, events, filename) {
    if (err) {
      this.close()
      this.emit('error', err)
    } else {
      const path =
        filename === null
          ? null
          : this._encoding === 'buffer'
            ? Buffer.from(filename)
            : Buffer.from(filename).toString(this._encoding)

      if (events & binding.UV_RENAME) {
        this.emit('change', 'rename', path)
      }

      if (events & binding.UV_CHANGE) {
        this.emit('change', 'change', path)
      }
    }
  }

  _onclose() {
    this._handle = null

    this.emit('close')
  }
}

exports.access = access
exports.appendFile = appendFile
exports.chmod = chmod
exports.chown = chown
exports.close = close
exports.copyFile = copyFile
exports.cp = cp
exports.exists = exists
exports.fchmod = fchmod
exports.fchown = fchown
exports.fdatasync = fdatasync
exports.fstat = fstat
exports.fsync = fsync
exports.ftruncate = ftruncate
exports.futimes = futimes
exports.lchown = lchown
exports.lutimes = lutimes
exports.link = link
exports.lstat = lstat
exports.mkdir = mkdir
exports.mkdtemp = mkdtemp
exports.open = open
exports.opendir = opendir
exports.read = read
exports.readFile = readFile
exports.readdir = readdir
exports.readlink = readlink
exports.readv = readv
exports.realpath = realpath
exports.rename = rename
exports.rm = rm
exports.rmdir = rmdir
exports.stat = stat
exports.statfs = statfs
exports.symlink = symlink
exports.truncate = truncate
exports.unlink = unlink
exports.utimes = utimes
exports.watch = watch
exports.write = write
exports.writeFile = writeFile
exports.writev = writev

exports.accessSync = accessSync
exports.appendFileSync = appendFileSync
exports.chmodSync = chmodSync
exports.chownSync = chownSync
exports.closeSync = closeSync
exports.copyFileSync = copyFileSync
exports.cpSync = cpSync
exports.existsSync = existsSync
exports.fchmodSync = fchmodSync
exports.fchownSync = fchownSync
exports.fdatasyncSync = fdatasyncSync
exports.fstatSync = fstatSync
exports.fsyncSync = fsyncSync
exports.ftruncateSync = ftruncateSync
exports.futimesSync = futimesSync
exports.lchownSync = lchownSync
exports.lutimesSync = lutimesSync
exports.linkSync = linkSync
exports.lstatSync = lstatSync
exports.mkdirSync = mkdirSync
exports.mkdtempSync = mkdtempSync
exports.openSync = openSync
exports.opendirSync = opendirSync
exports.readFileSync = readFileSync
exports.readSync = readSync
exports.readdirSync = readdirSync
exports.readlinkSync = readlinkSync
exports.readvSync = readvSync
exports.realpathSync = realpathSync
exports.renameSync = renameSync
exports.rmSync = rmSync
exports.rmdirSync = rmdirSync
exports.statSync = statSync
exports.statfsSync = statfsSync
exports.symlinkSync = symlinkSync
exports.truncateSync = truncateSync
exports.unlinkSync = unlinkSync
exports.utimesSync = utimesSync
exports.writeFileSync = writeFileSync
exports.writeSync = writeSync
exports.writevSync = writevSync

exports.promises = require('./promises')

exports.Stats = Stats
exports.StatFs = StatFs
exports.Dir = Dir
exports.Dirent = Dirent
exports.Watcher = Watcher

exports.ReadStream = FileReadStream

exports.createReadStream = function createReadStream(path, opts) {
  return new FileReadStream(path, opts)
}

exports.WriteStream = FileWriteStream

exports.createWriteStream = function createWriteStream(path, opts) {
  return new FileWriteStream(path, opts)
}

function toNamespacedPath(filepath) {
  if (typeof filepath !== 'string') {
    if (isURL(filepath)) filepath = fileURLToPath(filepath)
    else filepath = filepath.toString()
  }

  return path.toNamespacedPath(filepath)
}

function toFlags(flags) {
  switch (flags) {
    case 'r':
      return constants.O_RDONLY
    case 'rs': // Fall through.
    case 'sr':
      return constants.O_RDONLY | constants.O_SYNC
    case 'r+':
      return constants.O_RDWR
    case 'rs+': // Fall through.
    case 'sr+':
      return constants.O_RDWR | constants.O_SYNC

    case 'w':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY
    case 'wx': // Fall through.
    case 'xw':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL

    case 'w+':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR
    case 'wx+': // Fall through.
    case 'xw+':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL

    case 'a':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY
    case 'ax': // Fall through.
    case 'xa':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL
    case 'as': // Fall through.
    case 'sa':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_SYNC

    case 'a+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR
    case 'ax+': // Fall through.
    case 'xa+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL
    case 'as+': // Fall through.
    case 'sa+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_SYNC
    default:
      return 0
  }
}

function toMode(mode) {
  return parseInt(mode, 8)
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./binding":11,"./lib/constants":13,"./lib/errors":14,"./promises":15,"bare-events":9,"bare-path":23,"bare-stream":41,"bare-url":48,"buffer":52,"fast-fifo":55}],13:[function(require,module,exports){
const binding = require('../binding')

module.exports = {
  O_RDWR: binding.O_RDWR,
  O_RDONLY: binding.O_RDONLY,
  O_WRONLY: binding.O_WRONLY,
  O_CREAT: binding.O_CREAT,
  O_TRUNC: binding.O_TRUNC,
  O_APPEND: binding.O_APPEND,

  F_OK: binding.F_OK || 0,
  R_OK: binding.R_OK || 0,
  W_OK: binding.W_OK || 0,
  X_OK: binding.X_OK || 0,

  S_IFMT: binding.S_IFMT,
  S_IFREG: binding.S_IFREG,
  S_IFDIR: binding.S_IFDIR,
  S_IFCHR: binding.S_IFCHR,
  S_IFLNK: binding.S_IFLNK,
  S_IFBLK: binding.S_IFBLK || 0,
  S_IFIFO: binding.S_IFIFO || 0,
  S_IFSOCK: binding.S_IFSOCK || 0,

  S_IRUSR: binding.S_IRUSR || 0,
  S_IWUSR: binding.S_IWUSR || 0,
  S_IXUSR: binding.S_IXUSR || 0,
  S_IRGRP: binding.S_IRGRP || 0,
  S_IWGRP: binding.S_IWGRP || 0,
  S_IXGRP: binding.S_IXGRP || 0,
  S_IROTH: binding.S_IROTH || 0,
  S_IWOTH: binding.S_IWOTH || 0,
  S_IXOTH: binding.S_IXOTH || 0,

  UV_DIRENT_UNKNOWN: binding.UV_DIRENT_UNKNOWN,
  UV_DIRENT_FILE: binding.UV_DIRENT_FILE,
  UV_DIRENT_DIR: binding.UV_DIRENT_DIR,
  UV_DIRENT_LINK: binding.UV_DIRENT_LINK,
  UV_DIRENT_FIFO: binding.UV_DIRENT_FIFO,
  UV_DIRENT_SOCKET: binding.UV_DIRENT_SOCKET,
  UV_DIRENT_CHAR: binding.UV_DIRENT_CHAR,
  UV_DIRENT_BLOCK: binding.UV_DIRENT_BLOCK,

  COPYFILE_EXCL: binding.UV_FS_COPYFILE_EXCL,
  COPYFILE_FICLONE: binding.UV_FS_COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE: binding.UV_FS_COPYFILE_FICLONE_FORCE,
  UV_FS_SYMLINK_DIR: binding.UV_FS_SYMLINK_DIR,
  UV_FS_SYMLINK_JUNCTION: binding.UV_FS_SYMLINK_JUNCTION
}

},{"../binding":11}],14:[function(require,module,exports){
const binding = require('../binding')

module.exports = class FileError extends Error {
  constructor(msg, opts = {}) {
    const { code, operation = null, path = null, destination = null, fd = -1 } = opts

    if (operation !== null) msg += describe(operation, opts)

    super(`${code}: ${msg}`)

    this.code = code

    if (operation !== null) this.operation = operation
    if (path !== null) this.path = path
    if (destination !== null) this.destination = destination
    if (fd !== -1) this.fd = fd
  }

  get name() {
    return 'FileError'
  }

  // For Node.js compatibility
  get errno() {
    return binding.errnos[this.code]
  }

  // For Node.js compatibility
  get syscall() {
    return this.operation
  }

  // For Node.js compatibility
  get dest() {
    return this.destination
  }
}

function describe(operation, opts) {
  const { path = null, destination = null, fd = -1 } = opts

  let result = `, ${operation}`

  if (path !== null) {
    result += ` ${JSON.stringify(path)}`

    if (destination !== null) {
      result += ` -> ${JSON.stringify(destination)}`
    }
  } else if (fd !== -1) {
    result += ` ${fd}`
  }

  return result
}

},{"../binding":11}],15:[function(require,module,exports){
const EventEmitter = require('bare-events')
const fs = require('.')

class FileHandle extends EventEmitter {
  constructor(fd) {
    super()

    this.fd = fd
  }

  async close() {
    await fs.close(this.fd)

    this.fd = -1
    this.emit('close')
  }

  async read(buffer, ...args) {
    return {
      bytesRead: await fs.read(this.fd, buffer, ...args),
      buffer
    }
  }

  async readv(buffers, ...args) {
    return {
      bytesRead: await fs.readv(this.fd, buffers, ...args),
      buffers
    }
  }

  async write(buffer, ...args) {
    return {
      bytesWritten: await fs.write(this.fd, buffer, ...args),
      buffer
    }
  }

  async writev(buffers, ...args) {
    return {
      bytesWritten: await fs.writev(this.fd, buffers, ...args),
      buffers
    }
  }

  async stat() {
    return fs.fstat(this.fd)
  }

  async chmod(mode) {
    await fs.fchmod(this.fd, mode)
  }

  async chown(uid, gid) {
    await fs.fchown(this.fd, uid, gid)
  }

  async datasync() {
    return fs.fdatasync(this.fd)
  }

  async sync() {
    return fs.fsync(this.fd)
  }

  async truncate(len) {
    await fs.ftruncate(this.fd, len)
  }

  async utimes(atime, mtime) {
    await fs.futimes(this.fd, atime, mtime)
  }

  createReadStream(opts) {
    return fs.createReadStream(null, { ...opts, fd: this.fd })
  }

  createWriteStream(opts) {
    return fs.createWriteStream(null, { ...opts, fd: this.fd })
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }
}

exports.open = async function open(filepath, flags, mode) {
  return new FileHandle(await fs.open(filepath, flags, mode))
}

exports.access = fs.access
exports.appendFile = fs.appendFile
exports.chmod = fs.chmod
exports.chown = fs.chown
exports.constants = fs.constants
exports.copyFile = fs.copyFile
exports.cp = fs.cp
exports.lchown = fs.lchown
exports.lutimes = fs.lutimes
exports.link = fs.link
exports.lstat = fs.lstat
exports.mkdir = fs.mkdir
exports.mkdtemp = fs.mkdtemp
exports.opendir = fs.opendir
exports.readFile = fs.readFile
exports.readdir = fs.readdir
exports.readlink = fs.readlink
exports.realpath = fs.realpath
exports.rename = fs.rename
exports.rm = fs.rm
exports.rmdir = fs.rmdir
exports.stat = fs.stat
exports.statfs = fs.statfs
exports.truncate = fs.truncate
exports.symlink = fs.symlink
exports.unlink = fs.unlink
exports.utimes = fs.utimes
exports.watch = fs.watch
exports.writeFile = fs.writeFile

},{".":12,"bare-events":9}],16:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],17:[function(require,module,exports){
const binding = require('./binding')

module.exports = exports = function hrtime(past) {
  let now = binding.hrtime()

  if (past) now -= BigInt(past[0]) * 1000000000n + BigInt(past[1])

  return [Number(now / 1000000000n), Number(now % 1000000000n)]
}

exports.bigint = function hrtime() {
  return binding.hrtime()
}

},{"./binding":16}],18:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],19:[function(require,module,exports){
const binding = require('./binding')
const errors = require('./lib/errors')
const constants = require('./lib/constants')

exports.constants = constants
exports.errors = errors

exports.EOL = binding.platform === 'win32' ? '\r\n' : '\n'

exports.devNull = binding.platform === 'win32' ? '\\\\.\\nul' : '/dev/null'

exports.platform = function platform() {
  return binding.platform
}

exports.arch = function arch() {
  return binding.arch
}

exports.type = function type() {
  return binding.type()
}

exports.version = function version() {
  return binding.version()
}

exports.release = function release() {
  return binding.release()
}

exports.machine = function machine() {
  return binding.machine()
}

exports.execPath = function execPath() {
  return binding.execPath()
}

exports.pid = function pid() {
  return binding.pid()
}

exports.ppid = function ppid() {
  return binding.ppid()
}

exports.cwd = function cwd() {
  return binding.cwd()
}

exports.chdir = function chdir(dir) {
  validateString(dir, 'Directory')

  binding.chdir(dir)
}

exports.tmpdir = function tmpdir() {
  return binding.tmpdir()
}

exports.homedir = function homedir() {
  return binding.homedir()
}

exports.hostname = function hostname() {
  return binding.hostname()
}

exports.userInfo = function userInfo(uid) {
  if (uid !== undefined) validateInteger(uid, 'User ID')

  return binding.userInfo(uid)
}

exports.groupInfo = function groupInfo(gid) {
  if (gid !== undefined) validateInteger(gid, 'Group ID')

  return binding.groupInfo(gid)
}

exports.networkInterfaces = function networkInterfaces() {
  const result = {}

  for (const entry of binding.networkInterfaces()) {
    const { name, ...properties } = entry

    if (result[name]) result[name].push(properties)
    else result[name] = [properties]
  }

  return result
}

exports.kill = function kill(pid, signal = constants.signals.SIGTERM) {
  validateInteger(pid, 'Process ID')

  if (typeof signal === 'string') {
    if (signal in constants.signals === false) {
      throw errors.UNKNOWN_SIGNAL('Unknown signal: ' + signal)
    }

    signal = constants.signals[signal]
  } else {
    validateInteger(signal, 'Signal')
  }

  binding.kill(pid, signal)
}

exports.endianness = function endianness() {
  return binding.isLittleEndian ? 'LE' : 'BE'
}

exports.availableParallelism = function availableParallelism() {
  return binding.availableParallelism()
}

exports.cpuUsage = function cpuUsage(previous) {
  const current = binding.cpuUsage()

  if (previous) {
    return {
      user: current.user - previous.user,
      system: current.system - previous.system
    }
  }

  return current
}

exports.threadCpuUsage = function threadCpuUsage(previous) {
  const current = binding.threadCpuUsage()

  if (previous) {
    return {
      user: current.user - previous.user,
      system: current.system - previous.system
    }
  }

  return current
}

exports.resourceUsage = function resourceUsage() {
  return binding.resourceUsage()
}

exports.memoryUsage = function memoryUsage() {
  return binding.memoryUsage()
}

exports.freemem = function freemem() {
  return binding.freemem()
}

exports.totalmem = function totalmem() {
  return binding.totalmem()
}

exports.availableMemory = function availableMemory() {
  return binding.availableMemory()
}

exports.constrainedMemory = function constrainedMemory() {
  return binding.constrainedMemory()
}

exports.uptime = function uptime() {
  return binding.uptime()
}

exports.loadavg = function loadavg() {
  return binding.loadavg()
}

exports.cpus = function cpus() {
  return binding.cpus()
}

exports.getProcessTitle = function getProcessTitle() {
  return binding.getProcessTitle()
}

exports.setProcessTitle = function setProcessTitle(title) {
  if (typeof title !== 'string') title = title.toString()

  if (title.length >= 256) {
    throw errors.TITLE_OVERFLOW('Process title is too long')
  }

  binding.setProcessTitle(title)
}

exports.getPriority = function getPriority(pid = 0) {
  validateInteger(pid, 'Process ID')

  return binding.getPriority(pid)
}

exports.setPriority = function setPriority(pid, priority) {
  if (priority === undefined) {
    priority = pid
    pid = 0
  }

  validateInteger(pid, 'Process ID')
  validateInteger(priority, 'Priority')

  binding.setPriority(pid, priority)
}

exports.getEnvKeys = function getEnvKeys() {
  return binding.getEnvKeys()
}

exports.getEnv = function getEnv(name) {
  validateString(name, 'Name')

  return binding.getEnv(name)
}

exports.hasEnv = function hasEnv(name) {
  validateString(name, 'Name')

  return binding.hasEnv(name)
}

exports.setEnv = function setEnv(name, value) {
  validateString(name, 'Name')
  validateString(value, 'Value')

  binding.setEnv(name, value)
}

exports.unsetEnv = function unsetEnv(name) {
  validateString(name, 'Name')

  binding.unsetEnv(name)
}

function validateString(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string. Received type ${typeof value} (${value})`)
  }
}

function validateInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer. Received type ${typeof value} (${value})`)
  }
}

},{"./binding":18,"./lib/constants":20,"./lib/errors":21}],20:[function(require,module,exports){
const binding = require('../binding')

module.exports = {
  signals: binding.signals,
  errnos: binding.errnos,
  priority: binding.priority
}

},{"../binding":18}],21:[function(require,module,exports){
module.exports = class OSError extends Error {
  constructor(msg, fn = OSError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'OSError'
  }

  static UNKNOWN_SIGNAL(msg) {
    return new OSError(msg, OSError.UNKNOWN_SIGNAL)
  }

  static TITLE_OVERFLOW(msg) {
    return new OSError(msg, OSError.TITLE_OVERFLOW)
  }
}

},{}],22:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],23:[function(require,module,exports){
// This export SHOULD NOT be shortened in any way as having the full
// `module.exports = require(...)` statement is crucial for synthesizing
// ESM exports.

if (Bare.platform === 'win32') {
  module.exports = require('./lib/win32')
} else {
  module.exports = require('./lib/posix')
}

},{"./lib/posix":25,"./lib/win32":27}],24:[function(require,module,exports){
module.exports = {
  CHAR_UPPERCASE_A: 0x41,
  CHAR_LOWERCASE_A: 0x61,
  CHAR_UPPERCASE_Z: 0x5a,
  CHAR_LOWERCASE_Z: 0x7a,
  CHAR_DOT: 0x2e,
  CHAR_FORWARD_SLASH: 0x2f,
  CHAR_BACKWARD_SLASH: 0x5c,
  CHAR_COLON: 0x3a,
  CHAR_QUESTION_MARK: 0x3f
}

},{}],25:[function(require,module,exports){
const binding = require('../binding')

const { normalizeString, validateString } = require('./shared')
const { CHAR_DOT, CHAR_FORWARD_SLASH } = require('./constants')

function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH
}

exports.win32 = require('./win32')
exports.posix = exports

exports.sep = '/'
exports.delimiter = ':'

exports.resolve = function resolve(...args) {
  let resolvedPath = ''
  let resolvedAbsolute = false

  for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = i >= 0 ? args[i] : binding.cwd()

    if (i >= 0) validateString(path, `paths[${i}]`)

    if (path.length === 0) {
      continue
    }

    resolvedPath = `${path}/${resolvedPath}`
    resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  }

  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, '/', isPosixPathSeparator)

  if (resolvedAbsolute) {
    return `/${resolvedPath}`
  }

  return resolvedPath.length > 0 ? resolvedPath : '.'
}

exports.normalize = function normalize(path) {
  validateString(path, 'path')

  if (path.length === 0) return '.'

  const isAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH

  path = normalizeString(path, !isAbsolute, '/', isPosixPathSeparator)

  if (path.length === 0) {
    if (isAbsolute) return '/'
    return trailingSeparator ? './' : '.'
  }

  if (trailingSeparator) path += '/'

  return isAbsolute ? `/${path}` : path
}

exports.isAbsolute = function isAbsolute(path) {
  validateString(path, 'path')

  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH
}

exports.join = function join(...args) {
  if (args.length === 0) return '.'
  let joined
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i]
    validateString(arg, 'path')
    if (arg.length > 0) {
      if (joined === undefined) joined = arg
      else joined += `/${arg}`
    }
  }
  if (joined === undefined) return '.'
  return exports.normalize(joined)
}

exports.relative = function relative(from, to) {
  validateString(from, 'from')
  validateString(to, 'to')

  if (from === to) return ''

  from = exports.resolve(from)
  to = exports.resolve(to)

  if (from === to) return ''

  const fromStart = 1
  const fromEnd = from.length
  const fromLen = fromEnd - fromStart
  const toStart = 1
  const toLen = to.length - toStart

  const length = fromLen < toLen ? fromLen : toLen
  let lastCommonSep = -1
  let i = 0
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i)
    if (fromCode !== to.charCodeAt(toStart + i)) {
      break
    } else if (fromCode === CHAR_FORWARD_SLASH) {
      lastCommonSep = i
    }
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
        return to.substring(toStart + i + 1)
      }
      if (i === 0) {
        return to.substring(toStart + i)
      }
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
        lastCommonSep = i
      } else if (i === 0) {
        lastCommonSep = 0
      }
    }
  }

  let out = ''
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      out += out.length === 0 ? '..' : '/..'
    }
  }

  return `${out}${to.substring(toStart + lastCommonSep)}`
}

exports.toNamespacedPath = function toNamespacedPath(path) {
  return path
}

exports.dirname = function dirname(path) {
  validateString(path, 'path')

  if (path.length === 0) return '.'
  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH
  let end = -1
  let matchedSlash = true
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }

  if (end === -1) return hasRoot ? '/' : '.'
  if (hasRoot && end === 1) return '//'
  return path.substring(0, end)
}

exports.basename = function basename(path, suffix) {
  if (suffix !== undefined) validateString(suffix, 'suffix')
  validateString(path, 'path')

  let start = 0
  let end = -1
  let matchedSlash = true

  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) {
      return ''
    }
    let extIdx = suffix.length - 1
    let firstNonSlashEnd = -1
    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i)
      if (code === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          start = i + 1
          break
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false
          firstNonSlashEnd = i + 1
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              end = i
            }
          } else {
            extIdx = -1
            end = firstNonSlashEnd
          }
        }
      }
    }

    if (start === end) end = firstNonSlashEnd
    else if (end === -1) end = path.length
    return path.substring(start, end)
  }

  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        start = i + 1
        break
      }
    } else if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
  }

  if (end === -1) return ''
  return path.substring(start, end)
}

exports.extname = function extname(path) {
  validateString(path, 'path')

  let startDot = -1
  let startPart = 0
  let end = -1
  let matchedSlash = true
  let preDotState = 0
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i)
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1
        break
      }
      continue
    }
    if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i
      else if (preDotState !== 1) preDotState = 1
    } else if (startDot !== -1) {
      preDotState = -1
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return ''
  }
  return path.substring(startDot, end)
}

},{"../binding":22,"./constants":24,"./shared":26,"./win32":27}],26:[function(require,module,exports){
const { CHAR_DOT, CHAR_FORWARD_SLASH } = require('./constants')

exports.validateString = function validateString(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(
      `The "${name}" argument must be of type string. Received type ${typeof value}`
    )
  }
}

exports.normalizeString = function normalizeString(
  path,
  allowAboveRoot,
  separator,
  isPathSeparator
) {
  let res = ''
  let lastSegmentLength = 0
  let lastSlash = -1
  let dots = 0
  let code = 0
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i)
    } else if (isPathSeparator(code)) {
      break
    } else {
      code = CHAR_FORWARD_SLASH
    }

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1);
      else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== CHAR_DOT ||
          res.charCodeAt(res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator)
            if (lastSlashIndex === -1) {
              res = ''
              lastSegmentLength = 0
            } else {
              res = res.substring(0, lastSlashIndex)
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator)
            }
            lastSlash = i
            dots = 0
            continue
          } else if (res.length !== 0) {
            res = ''
            lastSegmentLength = 0
            lastSlash = i
            dots = 0
            continue
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : '..'
          lastSegmentLength = 2
        }
      } else {
        if (res.length > 0) {
          res += `${separator}${path.substring(lastSlash + 1, i)}`
        } else {
          res = path.substring(lastSlash + 1, i)
        }
        lastSegmentLength = i - lastSlash - 1
      }
      lastSlash = i
      dots = 0
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots
    } else {
      dots = -1
    }
  }
  return res
}

},{"./constants":24}],27:[function(require,module,exports){
const binding = require('../binding')

const { normalizeString, validateString } = require('./shared')
const {
  CHAR_UPPERCASE_A,
  CHAR_LOWERCASE_A,
  CHAR_UPPERCASE_Z,
  CHAR_LOWERCASE_Z,
  CHAR_DOT,
  CHAR_FORWARD_SLASH,
  CHAR_BACKWARD_SLASH,
  CHAR_COLON,
  CHAR_QUESTION_MARK
} = require('./constants')

function isWindowsPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH
}

function isWindowsDeviceRoot(code) {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
    (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  )
}

exports.posix = require('./posix')
exports.win32 = exports

exports.sep = '\\'
exports.delimiter = ';'

exports.resolve = function resolve(...args) {
  let resolvedDevice = ''
  let resolvedTail = ''
  let resolvedAbsolute = false

  for (let i = args.length - 1; i >= -1; i--) {
    let path
    if (i >= 0) {
      path = args[i]

      validateString(path, `paths[${i}]`)

      if (path.length === 0) continue
    } else if (resolvedDevice.length === 0) {
      path = binding.cwd()
    } else {
      path = binding.cwd(resolvedDevice)

      if (
        path === undefined ||
        (path.substring(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() &&
          path.charCodeAt(2) === CHAR_BACKWARD_SLASH)
      ) {
        path = `${resolvedDevice}\\`
      }
    }

    const len = path.length
    let rootEnd = 0
    let device = ''
    let isAbsolute = false
    const code = path.charCodeAt(0)

    if (len === 1) {
      if (isWindowsPathSeparator(code)) {
        rootEnd = 1
        isAbsolute = true
      }
    } else if (isWindowsPathSeparator(code)) {
      isAbsolute = true

      if (isWindowsPathSeparator(path.charCodeAt(1))) {
        let j = 2
        let last = j
        while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
          j++
        }
        if (j < len && j !== last) {
          const firstPart = path.substring(last, j)
          last = j
          while (j < len && isWindowsPathSeparator(path.charCodeAt(j))) {
            j++
          }
          if (j < len && j !== last) {
            last = j
            while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
              j++
            }
            if (j === len || j !== last) {
              device = `\\\\${firstPart}\\${path.substring(last, j)}`
              rootEnd = j
            }
          }
        }
      } else {
        rootEnd = 1
      }
    } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
      device = path.substring(0, 2)
      rootEnd = 2
      if (len > 2 && isWindowsPathSeparator(path.charCodeAt(2))) {
        isAbsolute = true
        rootEnd = 3
      }
    }

    if (device.length > 0) {
      if (resolvedDevice.length > 0) {
        if (device.toLowerCase() !== resolvedDevice.toLowerCase()) {
          continue
        }
      } else {
        resolvedDevice = device
      }
    }

    if (resolvedAbsolute) {
      if (resolvedDevice.length > 0) {
        break
      }
    } else {
      resolvedTail = `${path.substring(rootEnd)}\\${resolvedTail}`
      resolvedAbsolute = isAbsolute
      if (isAbsolute && resolvedDevice.length > 0) {
        break
      }
    }
  }

  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, '\\', isWindowsPathSeparator)

  return resolvedAbsolute
    ? `${resolvedDevice}\\${resolvedTail}`
    : `${resolvedDevice}${resolvedTail}` || '.'
}

exports.normalize = function normalize(path) {
  validateString(path, 'path')

  const len = path.length
  if (len === 0) return '.'
  let rootEnd = 0
  let device
  let isAbsolute = false
  const code = path.charCodeAt(0)

  if (len === 1) {
    return code === CHAR_FORWARD_SLASH ? '\\' : path
  }

  if (isWindowsPathSeparator(code)) {
    isAbsolute = true

    if (isWindowsPathSeparator(path.charCodeAt(1))) {
      let j = 2
      let last = j
      while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
        j++
      }
      if (j < len && j !== last) {
        const firstPart = path.substring(last, j)
        last = j
        while (j < len && isWindowsPathSeparator(path.charCodeAt(j))) {
          j++
        }
        if (j < len && j !== last) {
          last = j
          while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
            j++
          }
          if (j === len) {
            return `\\\\${firstPart}\\${path.substring(last)}\\`
          }
          if (j !== last) {
            device = `\\\\${firstPart}\\${path.substring(last, j)}`
            rootEnd = j
          }
        }
      }
    } else {
      rootEnd = 1
    }
  } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    device = path.substring(0, 2)
    rootEnd = 2
    if (len > 2 && isWindowsPathSeparator(path.charCodeAt(2))) {
      isAbsolute = true
      rootEnd = 3
    }
  }

  let tail =
    rootEnd < len
      ? normalizeString(path.substring(rootEnd), !isAbsolute, '\\', isWindowsPathSeparator)
      : ''
  if (tail.length === 0 && !isAbsolute) {
    tail = '.'
  }
  if (tail.length > 0 && isWindowsPathSeparator(path.charCodeAt(len - 1))) {
    tail += '\\'
  }
  if (device === undefined) {
    return isAbsolute ? `\\${tail}` : tail
  }
  return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`
}

exports.isAbsolute = function isAbsolute(path) {
  validateString(path, 'path')

  const len = path.length
  if (len === 0) return false

  const code = path.charCodeAt(0)

  return (
    isWindowsPathSeparator(code) ||
    (len > 2 &&
      isWindowsDeviceRoot(code) &&
      path.charCodeAt(1) === CHAR_COLON &&
      isWindowsPathSeparator(path.charCodeAt(2)))
  )
}

exports.join = function join(...args) {
  if (args.length === 0) return '.'

  let joined
  let firstPart
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i]
    validateString(arg, 'path')
    if (arg.length > 0) {
      if (joined === undefined) joined = firstPart = arg
      else joined += `\\${arg}`
    }
  }

  if (joined === undefined) return '.'

  let needsReplace = true
  let slashCount = 0
  if (isWindowsPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount
    const firstLen = firstPart.length
    if (firstLen > 1 && isWindowsPathSeparator(firstPart.charCodeAt(1))) {
      ++slashCount
      if (firstLen > 2) {
        if (isWindowsPathSeparator(firstPart.charCodeAt(2))) {
          ++slashCount
        } else {
          needsReplace = false
        }
      }
    }
  }
  if (needsReplace) {
    while (slashCount < joined.length && isWindowsPathSeparator(joined.charCodeAt(slashCount))) {
      slashCount++
    }

    if (slashCount >= 2) {
      joined = `\\${joined.substring(slashCount)}`
    }
  }

  return exports.normalize(joined)
}

exports.relative = function relative(from, to) {
  validateString(from, 'from')
  validateString(to, 'to')

  if (from === to) return ''

  const fromOrig = exports.resolve(from)
  const toOrig = exports.resolve(to)

  if (fromOrig === toOrig) return ''

  from = fromOrig.toLowerCase()
  to = toOrig.toLowerCase()

  if (from === to) return ''

  let fromStart = 0
  while (fromStart < from.length && from.charCodeAt(fromStart) === CHAR_BACKWARD_SLASH) {
    fromStart++
  }
  let fromEnd = from.length
  while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === CHAR_BACKWARD_SLASH) {
    fromEnd--
  }
  const fromLen = fromEnd - fromStart

  let toStart = 0
  while (toStart < to.length && to.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) {
    toStart++
  }
  let toEnd = to.length
  while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === CHAR_BACKWARD_SLASH) {
    toEnd--
  }
  const toLen = toEnd - toStart

  const length = fromLen < toLen ? fromLen : toLen
  let lastCommonSep = -1
  let i = 0
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i)
    if (fromCode !== to.charCodeAt(toStart + i)) {
      break
    } else if (fromCode === CHAR_BACKWARD_SLASH) {
      lastCommonSep = i
    }
  }

  if (i !== length) {
    if (lastCommonSep === -1) return toOrig
  } else {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
        return toOrig.substring(toStart + i + 1)
      }
      if (i === 2) {
        return toOrig.substring(toStart + i)
      }
    }
    if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
        lastCommonSep = i
      } else if (i === 2) {
        lastCommonSep = 3
      }
    }
    if (lastCommonSep === -1) lastCommonSep = 0
  }

  let out = ''
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
      out += out.length === 0 ? '..' : '\\..'
    }
  }

  toStart += lastCommonSep

  if (out.length > 0) {
    return `${out}${toOrig.substring(toStart, toEnd)}`
  }
  if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) {
    ++toStart
  }
  return toOrig.substring(toStart, toEnd)
}

exports.toNamespacedPath = function toNamespacedPath(path) {
  if (typeof path !== 'string' || path.length === 0) return path

  const resolvedPath = exports.resolve(path)

  if (resolvedPath.length <= 2) return path

  if (resolvedPath.charCodeAt(0) === CHAR_BACKWARD_SLASH) {
    if (resolvedPath.charCodeAt(1) === CHAR_BACKWARD_SLASH) {
      const code = resolvedPath.charCodeAt(2)
      if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) {
        return `\\\\?\\UNC\\${resolvedPath.substring(2)}`
      }
    }
  } else if (
    isWindowsDeviceRoot(resolvedPath.charCodeAt(0)) &&
    resolvedPath.charCodeAt(1) === CHAR_COLON &&
    resolvedPath.charCodeAt(2) === CHAR_BACKWARD_SLASH
  ) {
    return `\\\\?\\${resolvedPath}`
  }

  return path
}

exports.dirname = function dirname(path) {
  validateString(path, 'path')

  const len = path.length
  if (len === 0) return '.'
  let rootEnd = -1
  let offset = 0
  const code = path.charCodeAt(0)

  if (len === 1) {
    return isWindowsPathSeparator(code) ? path : '.'
  }

  if (isWindowsPathSeparator(code)) {
    rootEnd = offset = 1

    if (isWindowsPathSeparator(path.charCodeAt(1))) {
      let j = 2
      let last = j
      while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
        j++
      }
      if (j < len && j !== last) {
        last = j
        while (j < len && isWindowsPathSeparator(path.charCodeAt(j))) {
          j++
        }
        if (j < len && j !== last) {
          last = j
          while (j < len && !isWindowsPathSeparator(path.charCodeAt(j))) {
            j++
          }
          if (j === len) {
            return path
          }
          if (j !== last) {
            rootEnd = offset = j + 1
          }
        }
      }
    }
  } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    rootEnd = len > 2 && isWindowsPathSeparator(path.charCodeAt(2)) ? 3 : 2
    offset = rootEnd
  }

  let end = -1
  let matchedSlash = true
  for (let i = len - 1; i >= offset; --i) {
    if (isWindowsPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }

  if (end === -1) {
    if (rootEnd === -1) return '.'

    end = rootEnd
  }
  return path.substring(0, end)
}

exports.basename = function basename(path, suffix) {
  if (suffix !== undefined) validateString(suffix, 'suffix')
  validateString(path, 'path')

  let start = 0
  let end = -1
  let matchedSlash = true

  if (
    path.length >= 2 &&
    isWindowsDeviceRoot(path.charCodeAt(0)) &&
    path.charCodeAt(1) === CHAR_COLON
  ) {
    start = 2
  }

  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return ''
    let extIdx = suffix.length - 1
    let firstNonSlashEnd = -1
    for (let i = path.length - 1; i >= start; --i) {
      const code = path.charCodeAt(i)
      if (isWindowsPathSeparator(code)) {
        if (!matchedSlash) {
          start = i + 1
          break
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false
          firstNonSlashEnd = i + 1
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              end = i
            }
          } else {
            extIdx = -1
            end = firstNonSlashEnd
          }
        }
      }
    }

    if (start === end) end = firstNonSlashEnd
    else if (end === -1) end = path.length
    return path.substring(start, end)
  }
  for (let i = path.length - 1; i >= start; --i) {
    if (isWindowsPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        start = i + 1
        break
      }
    } else if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
  }

  if (end === -1) return ''
  return path.substring(start, end)
}

exports.extname = function extname(path) {
  validateString(path, 'path')

  let start = 0
  let startDot = -1
  let startPart = 0
  let end = -1
  let matchedSlash = true
  let preDotState = 0

  if (
    path.length >= 2 &&
    path.charCodeAt(1) === CHAR_COLON &&
    isWindowsDeviceRoot(path.charCodeAt(0))
  ) {
    start = startPart = 2
  }

  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i)
    if (isWindowsPathSeparator(code)) {
      if (!matchedSlash) {
        startPart = i + 1
        break
      }
      continue
    }
    if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i
      else if (preDotState !== 1) preDotState = 1
    } else if (startDot !== -1) {
      preDotState = -1
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return ''
  }
  return path.substring(startDot, end)
}

},{"../binding":22,"./constants":24,"./posix":25,"./shared":26}],28:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],29:[function(require,module,exports){
(function (Buffer){(function (){
const EventEmitter = require('bare-events')
const { Duplex, isFinished, isReadable, isWritable } = require('bare-stream')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')

const defaultReadBufferSize = 65536
const empty = Buffer.alloc(0)

const ipcHandle = Symbol.for('bare.ipc.handle')
const ipcAccept = Symbol.for('bare.ipc.accept')

module.exports = exports = class Pipe extends Duplex {
  constructor(path, opts = {}) {
    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true,
      eagerOpen = true,
      ipc = false
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    super({ eagerOpen: !!eagerOpen })

    this._state = 0

    this._allowHalfOpen = !!allowHalfOpen
    this._ipc = !!ipc

    this._fd = -1
    this._path = null

    this._error = null

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingWriteSegments = null
    this._pendingWriteIdx = 0
    this._pendingFinal = null
    this._pendingDestroy = null

    this._handleQueue = []
    this._handleQueueSize = 0

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(
      this._buffer,
      this._ipc,
      this,
      noop,
      this._onconnect,
      this._onread,
      this._onwrite,
      this._onfinal,
      this._onhandle,
      this._onclose
    )

    if (typeof path === 'number') {
      this.open(path)
    } else if (typeof path === 'string') {
      this.connect(path)
    }
  }

  get connecting() {
    return (this._state & constants.state.CONNECTING) !== 0
  }

  get pending() {
    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return true

    return (this._state & constants.state.CONNECTED) === 0
  }

  get readyState() {
    if (this._state & constants.state.CONNECTING) return 'opening'

    if (this._state & constants.state.CONNECTED) {
      const readable = (this._state & constants.state.READABLE) !== 0 && isReadable(this)
      const writable =
        (this._state & constants.state.WRITABLE) !== 0 && isWritable(this) && !isFinished(this)

      if (readable && writable) return 'open'
      if (readable) return 'readOnly'
      if (writable) return 'writeOnly'
    }

    return 'closed'
  }

  get [ipcHandle]() {
    return this._handle
  }

  remoteCredentials() {
    if (this._state & constants.state.CLOSING) {
      throw errors.PIPE_IS_CLOSED('Pipe is closed')
    }

    if ((this._state & constants.state.CONNECTED) === 0) {
      throw errors.PIPE_NOT_CONNECTED('Pipe is not connected')
    }

    return binding.remoteCredentials(this._handle)
  }

  connect(path, opts = {}, onconnect) {
    if ((this._state & constants.state.CLOSING) !== 0 || this._error !== null) {
      throw errors.PIPE_IS_CLOSED('Pipe is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.PIPE_ALREADY_CONNECTED('Pipe is already connected')
    }

    if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = opts.path
    }

    validatePath(path)

    this._state |= constants.state.CONNECTING

    try {
      binding.connect(this._handle, path)

      this._path = path

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      queueMicrotask(() => this._failConnect(err))
    }

    return this
  }

  open(fd, opts = {}, onconnect) {
    if ((this._state & constants.state.CLOSING) !== 0 || this._error !== null) {
      throw errors.PIPE_IS_CLOSED('Pipe is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.PIPE_ALREADY_CONNECTED('Pipe is already connected')
    }

    if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof fd === 'object' && fd !== null) {
      opts = fd
      fd = opts.fd
    }

    validateFd(fd)

    try {
      const status = binding.open(this._handle, fd)

      this._fd = fd

      this._state |= constants.state.CONNECTED

      if (status & binding.READABLE) {
        this._state |= constants.state.READABLE
      } else {
        this.push(null)
      }

      if (status & binding.WRITABLE) {
        this._state |= constants.state.WRITABLE
      } else {
        this.end()
      }

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      this._error = err

      queueMicrotask(() => {
        if (this._pendingOpen) this._continueOpen(err)
        else this.destroy(err)
      })

      return this
    }

    this._continueOpen()

    queueMicrotask(() => {
      if (this._state & constants.state.CLOSING) return

      this.emit('connect')
    })

    return this
  }

  write(chunk, encoding, handle, cb) {
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = undefined
      handle = null
    } else if (typeof encoding === 'object' && encoding !== null) {
      if (typeof handle === 'function') cb = handle
      handle = encoding
      encoding = undefined
    } else if (typeof handle === 'function') {
      cb = handle
      handle = null
    }

    if (handle) toIPCHandle(handle)

    if ((this._state & constants.state.CLOSING) === 0) {
      if (handle) this._handleQueueSize++

      this._handleQueue.push(handle || null)
    }

    if (encoding) return super.write(chunk, encoding, cb)

    return super.write(chunk, cb)
  }

  accept(target) {
    const handle = toIPCHandle(target)

    binding.accept(this._handle, handle)

    if (typeof target[ipcAccept] === 'function') target[ipcAccept]()

    return target
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.unref(this._handle)

    return this
  }

  [ipcAccept]() {
    this._onaccept()
  }

  _open(cb) {
    if (this._state & constants.state.CONNECTED) return cb(null)

    this._pendingOpen = cb
  }

  _read() {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING

      binding.resume(this._handle)
    }
  }

  _writev(batch, cb) {
    this._pendingWrite = cb
    this._pendingWriteBatch = batch

    try {
      coerceBatch(batch)
    } catch (err) {
      return this._continueWrite(err)
    }

    if (this._handleQueueSize === 0) {
      this._handleQueue = []
      this._pendingWriteSegments = null

      try {
        binding.writev(
          this._handle,
          batch.map(({ chunk }) => chunk),
          null
        )
      } catch (err) {
        this._continueWrite(err)
      }

      return
    }

    const handles = this._handleQueue.splice(0, batch.length)

    // Fill any holes in the batch for messages that don't carry a handle. Each
    // message that does carry a handle decrements the handle queue size.
    for (let i = 0; i < batch.length; i++) {
      if (handles[i] === undefined) handles[i] = null
      else if (handles[i] !== null) this._handleQueueSize--
    }

    // A handle rides along with a single write, so the batch is split into runs
    // of handleless messages and one message per handle.
    const segments = []

    let i = 0
    while (i < batch.length) {
      if (handles[i] !== null) {
        segments.push({ chunks: [batch[i]], handle: handles[i] })
        i++
      } else {
        const start = i
        while (i < batch.length && handles[i] === null) i++
        segments.push({ chunks: batch.slice(start, i), handle: null })
      }
    }

    this._pendingWriteSegments = segments
    this._pendingWriteIdx = 0

    this._writeNextSegment()
  }

  _writeNextSegment() {
    const segment = this._pendingWriteSegments[this._pendingWriteIdx]

    const chunks = []
    for (let i = 0; i < segment.chunks.length; i++) {
      chunks.push(segment.chunks[i].chunk)
    }

    let sendHandle = null

    try {
      // The target was checked when the write was queued, but it may have been
      // invalidated since.
      if (segment.handle !== null) sendHandle = toIPCHandle(segment.handle)

      binding.writev(this._handle, chunks, sendHandle)
    } catch (err) {
      this._continueWrite(err)
    }
  }

  _final(cb) {
    const duplex = constants.state.READABLE | constants.state.WRITABLE

    if ((this._state & duplex) !== duplex) return cb(null)

    this._pendingFinal = cb

    try {
      binding.end(this._handle)
    } catch (err) {
      this._continueFinal(err.code === 'ENOTCONN' ? null : err)
    }
  }

  _predestroy() {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    this._clearHandleQueue()

    binding.close(this._handle)
  }

  _destroy(err, cb) {
    if (this._state & constants.state.CLOSED) return cb(err)

    this._pendingDestroy = cb

    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    this._clearHandleQueue()

    binding.close(this._handle)
  }

  _clearHandleQueue() {
    this._handleQueue = []
    this._handleQueueSize = 0
  }

  _continueOpen(err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite(err) {
    if (this._pendingWrite === null) return

    // A batch that carries handles is written one segment at a time, so it only
    // settles once the last segment has been written or one of them failed.
    if (this._pendingWriteSegments !== null) {
      this._pendingWriteIdx++

      if (err === null && this._pendingWriteIdx < this._pendingWriteSegments.length) {
        return this._writeNextSegment()
      }
    }

    const cb = this._pendingWrite
    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingWriteSegments = null
    this._pendingWriteIdx = 0
    cb(err)
  }

  _continueFinal(err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _continueDestroy() {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _failConnect(err) {
    if (this._state & constants.state.CLOSING) return

    this._state &= ~constants.state.CONNECTING

    if (this._pendingOpen) this._continueOpen(err)
    else this.destroy(err)
  }

  _onconnect(err) {
    if (err) {
      this._failConnect(err)
      return
    }

    this._state |= constants.state.CONNECTED | constants.state.READABLE | constants.state.WRITABLE
    this._state &= ~constants.state.CONNECTING

    this._continueOpen()

    this.emit('connect')
  }

  _onaccept() {
    this._state |= constants.state.CONNECTED | constants.state.READABLE | constants.state.WRITABLE

    this._continueOpen()
  }

  _onread(err, read) {
    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    // Unpooled, as a read too small to be given a buffer of its own would
    // otherwise pin the whole pool it came from for as long as its consumer
    // holds on to it.
    const copy = Buffer.allocUnsafeSlow(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._state &= ~constants.state.READING

      binding.pause(this._handle)
    }
  }

  _onwrite(err) {
    this._continueWrite(err)
  }

  _onfinal() {
    this._continueFinal(null)
  }

  _onhandle(type) {
    this.emit('handle', type)
  }

  _onclose() {
    this._state |= constants.state.CLOSED

    this._continueOpen()
    this._continueDestroy()
  }

  _onspawn(readable, writable) {
    this._state |= constants.state.CONNECTED

    if (readable) {
      this._state |= constants.state.READABLE
    } else {
      this.push(null)
    }

    if (writable) {
      this._state |= constants.state.WRITABLE
    } else {
      this.end()
    }

    this._continueOpen()
  }
}

exports.Pipe = exports

exports.Server = class PipeServer extends EventEmitter {
  constructor(opts = {}, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }

    super()

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true,
      pauseOnConnect = false,
      ipc = false
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    this._state = 0

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = !!allowHalfOpen
    this._pauseOnConnect = !!pauseOnConnect
    this._ipc = !!ipc

    this._path = null
    this._connections = new Set()

    this._error = null
    this._handle = null

    if (onconnection) this.on('connection', onconnection)
  }

  get listening() {
    return (this._state & constants.state.BOUND) !== 0
  }

  get closing() {
    return (this._state & constants.state.CLOSING) !== 0
  }

  address() {
    if ((this._state & constants.state.BOUND) === 0) return null

    return this._path
  }

  listen(path, backlog = 511, opts = {}, onlistening) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SERVER_IS_CLOSED('Server is closed')
    }

    if (this._state & (constants.state.BINDING | constants.state.BOUND)) {
      throw errors.SERVER_ALREADY_LISTENING('Server is already listening')
    }

    if (typeof backlog === 'function') {
      onlistening = backlog
      backlog = 511
    } else if (typeof opts === 'function') {
      onlistening = opts
      opts = {}
    }

    if (typeof path === 'object' && path !== null) {
      opts = path
      path = opts.path
      backlog = defaultTo(opts.backlog, 511)
    }

    if (backlog === null || backlog === 0) backlog = 511

    const { ownerOnly = false } = opts || {}

    validatePath(path)
    validateInteger(backlog, 'Backlog', 0, 0x7fffffff)
    validateBoolean(ownerOnly, 'Owner only')

    if (ownerOnly && (path === '' || path[0] === '\0')) {
      throw errors.INVALID_ARGUMENT('An abstract socket cannot be restricted to its owner')
    }

    this._state |= constants.state.BINDING
    this._state &= ~constants.state.CLOSED

    this._handle = binding.init(
      empty,
      this._ipc,
      this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    if (this._state & constants.state.UNREFED) binding.unref(this._handle)

    try {
      binding.bind(this._handle, path, backlog, ownerOnly)

      this._path = path

      this._state |= constants.state.BOUND
      this._state &= ~constants.state.BINDING

      if (onlistening) this.once('listening', onlistening)

      queueMicrotask(() => {
        if (this._state & constants.state.CLOSING) return

        this.emit('listening')
      })
    } catch (err) {
      this._error = err

      binding.close(this._handle)
    }

    return this
  }

  close(onclose) {
    if (this._state & constants.state.CLOSED) {
      if (onclose) queueMicrotask(onclose)

      return this
    }

    if (onclose) this.once('close', onclose)

    if (this._state & constants.state.CLOSING) return this
    this._state |= constants.state.CLOSING
    this._state &= ~(constants.state.BINDING | constants.state.BOUND)

    if (this._handle !== null) binding.close(this._handle)
    else this._closeMaybe()

    return this
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._handle !== null) binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._handle !== null) binding.unref(this._handle)

    return this
  }

  _closeMaybe() {
    if ((this._state & constants.state.CLOSING) === 0) return
    if (this._state & constants.state.CLOSED) return
    if (this._handle !== null || this._connections.size > 0) return

    this._state |= constants.state.CLOSED
    this._state &= ~constants.state.CLOSING

    queueMicrotask(() => this.emit('close'))
  }

  _onconnection(err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this._state & constants.state.CLOSING) return

    const pipe = new exports.Pipe({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen,
      eagerOpen: !this._pauseOnConnect,
      ipc: this._ipc
    })

    try {
      if (!binding.accept(this._handle, pipe._handle)) {
        pipe.destroy()
        return
      }

      pipe._path = this._path

      pipe._onaccept()

      this._connections.add(pipe)

      pipe.on('close', () => {
        this._connections.delete(pipe)
        this._closeMaybe()
      })
    } catch (err) {
      pipe.destroy()

      this.emit('error', err)
      return
    }

    this.emit('connection', pipe)
  }

  _onclose() {
    const err = this._error

    this._state &= ~(constants.state.BINDING | constants.state.BOUND)
    this._error = null
    this._handle = null
    this._path = null

    if (err) this.emit('error', err)

    this._closeMaybe()
  }
}

exports.constants = constants
exports.errors = errors

exports.createConnection = function createConnection(path, opts, onconnect) {
  if (typeof opts === 'function') {
    onconnect = opts
    opts = {}
  }

  if (typeof path === 'object' && path !== null) {
    opts = path
    path = opts.path
  }

  return new exports.Pipe(opts).connect(path, opts, onconnect)
}

exports.createServer = function createServer(opts, onconnection) {
  return new exports.Server(opts, onconnection)
}

exports.pipe = function pipe() {
  return binding.pipe()
}

function toIPCHandle(target) {
  const handle = target[ipcHandle]

  if (handle === undefined) {
    throw errors.INVALID_IPC_TARGET('Target does not implement the IPC handle protocol')
  }

  if (handle instanceof ArrayBuffer === false) {
    throw errors.INVALID_IPC_TARGET('Target does not provide a native IPC handle')
  }

  return handle
}

function validatePath(path) {
  if (typeof path !== 'string') {
    throw errors.INVALID_PATH(`Path must be a string, got ${typeof path}`)
  }

  validatePathLength(path)
}

function validatePathLength(path) {
  const length = Buffer.byteLength(path)

  if (length > constants.path.MAX_LENGTH) {
    throw errors.INVALID_PATH(
      `Path must be at most ${constants.path.MAX_LENGTH} bytes, got ${length}`
    )
  }
}

function validateFd(fd) {
  if (typeof fd !== 'number') {
    throw errors.INVALID_FD(`File descriptor must be a number, got ${typeof fd}`)
  }

  if (!Number.isInteger(fd) || fd < 0 || fd > 0x7fffffff) {
    throw errors.INVALID_FD(
      `File descriptor must be an integer between 0 and ${0x7fffffff}, got ${fd}`
    )
  }
}

function validateInteger(value, name, min, max) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`${name} must be a number, got ${typeof value}`)
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw errors.INVALID_ARGUMENT(
      `${name} must be an integer between ${min} and ${max}, got ${value}`
    )
  }
}

function validateBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw errors.INVALID_ARGUMENT(`${name} must be a boolean, got ${typeof value}`)
  }
}

function coerceBatch(batch) {
  for (let i = 0; i < batch.length; i++) {
    const chunk = batch[i].chunk

    if (ArrayBuffer.isView(chunk) === false) {
      throw errors.INVALID_ARGUMENT(`Chunk must be a string or a view, got ${typeof chunk}`)
    }

    batch[i].chunk = Buffer.coerce(chunk)
  }
}

function defaultTo(value, fallback) {
  return value === undefined || value === null ? fallback : value
}

function noop() {}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./binding":28,"./lib/constants":30,"./lib/errors":31,"bare-events":9,"bare-stream":41,"buffer":52}],30:[function(require,module,exports){
const binding = require('../binding')

module.exports = {
  state: {
    CONNECTING: 0x1,
    CONNECTED: 0x2,
    BINDING: 0x4,
    BOUND: 0x8,
    READING: 0x10,
    CLOSING: 0x20,
    CLOSED: 0x40,
    UNREFED: 0x80,
    READABLE: 0x100,
    WRITABLE: 0x200
  },
  path: {
    MAX_LENGTH: binding.MAX_PATH_LENGTH
  },
  handle: {
    NAMED_PIPE: binding.UV_NAMED_PIPE,
    TCP: binding.UV_TCP,
    UDP: binding.UV_UDP
  }
}

},{"../binding":28}],31:[function(require,module,exports){
module.exports = class PipeError extends Error {
  constructor(msg, fn = PipeError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'PipeError'
  }

  static PIPE_ALREADY_CONNECTED(msg) {
    return new PipeError(msg, PipeError.PIPE_ALREADY_CONNECTED)
  }

  static PIPE_NOT_CONNECTED(msg) {
    return new PipeError(msg, PipeError.PIPE_NOT_CONNECTED)
  }

  static PIPE_IS_CLOSED(msg) {
    return new PipeError(msg, PipeError.PIPE_IS_CLOSED)
  }

  static SERVER_ALREADY_LISTENING(msg) {
    return new PipeError(msg, PipeError.SERVER_ALREADY_LISTENING)
  }

  static SERVER_IS_CLOSED(msg) {
    return new PipeError(msg, PipeError.SERVER_IS_CLOSED)
  }

  static INVALID_ARGUMENT(msg) {
    return new PipeError(msg, PipeError.INVALID_ARGUMENT)
  }

  static INVALID_FD(msg) {
    return new PipeError(msg, PipeError.INVALID_FD)
  }

  static INVALID_IPC_TARGET(msg) {
    return new PipeError(msg, PipeError.INVALID_IPC_TARGET)
  }

  static INVALID_PATH(msg) {
    return new PipeError(msg, PipeError.INVALID_PATH)
  }
}

},{}],32:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],33:[function(require,module,exports){
const binding = require('./binding')

exports.getgid = binding.getgid

exports.setgid = function setgid(id) {
  if (typeof id === 'string') id = exports.getgrnam(id).gid

  binding.setgid(id)
}

exports.getegid = binding.getegid

exports.setegid = function setegid(id) {
  if (typeof id === 'string') id = exports.getgrnam(id).gid

  binding.setegid(id)
}

exports.getuid = binding.getuid

exports.setuid = function setuid(id) {
  if (typeof id === 'string') id = exports.getpwnam(id).uid

  binding.setuid(id)
}

exports.geteuid = binding.geteuid

exports.seteuid = function seteuid(id) {
  if (typeof id === 'string') id = exports.getpwnam(id).uid

  binding.seteuid(id)
}

exports.getgroups = binding.getgroups

exports.getgrnam = binding.getgrnam

exports.getpwnam = binding.getpwnam

},{"./binding":32}],34:[function(require,module,exports){
const abort = require('bare-abort')
const EventEmitter = require('bare-events')
const Signal = require('bare-signals')
const os = require('bare-os')
const env = require('bare-env')
const hrtime = require('bare-hrtime')
const stdio = require('bare-stdio')
const posix = require('bare-posix')

class Process extends EventEmitter {
  constructor() {
    super()

    this._startTime = hrtime.bigint()

    EventEmitter.forward(Bare, this, [
      'uncaughtException',
      'unhandledRejection',
      'beforeExit',
      'exit',
      'suspend',
      'wakeup',
      'idle',
      'resume'
    ])

    const signals = new Signal.Emitter()

    signals.unref()

    EventEmitter.forward(signals, this, Object.keys(os.constants.signals))
  }

  get stdin() {
    return stdio.in
  }

  get stdout() {
    return stdio.out
  }

  get stderr() {
    return stdio.err
  }

  get platform() {
    return os.platform()
  }

  get arch() {
    return os.arch()
  }

  get title() {
    return os.getProcessTitle()
  }

  set title(title) {
    os.setProcessTitle(title)
  }

  get pid() {
    return os.pid()
  }

  get ppid() {
    return os.ppid()
  }

  get argv() {
    return Bare.argv
  }

  get execArgv() {
    return []
  }

  get execPath() {
    return os.execPath()
  }

  get exitCode() {
    return Bare.exitCode
  }

  set exitCode(code) {
    Bare.exitCode = code
  }

  get version() {
    return Bare.version
  }

  get versions() {
    return Bare.versions
  }

  get env() {
    return env
  }

  get hrtime() {
    return hrtime
  }

  abort() {
    abort()
  }

  exit(code) {
    Bare.exit(code)
  }

  suspend() {
    Bare.suspend()
  }

  resume() {
    Bare.resume()
  }

  cwd() {
    return os.cwd()
  }

  chdir(directory) {
    os.chdir(directory)
  }

  kill(pid, signal) {
    os.kill(pid, signal)
  }

  uptime() {
    return Number(hrtime.bigint() - this._startTime) / 1e9
  }

  cpuUsage(previous) {
    return os.cpuUsage(previous)
  }

  threadCpuUsage(previous) {
    return os.threadCpuUsage(previous)
  }

  resourceUsage() {
    return os.resourceUsage()
  }

  availableMemory() {
    return os.availableMemory()
  }

  constrainedMemory() {
    return os.constrainedMemory()
  }

  memoryUsage() {
    return os.memoryUsage()
  }

  getgid() {
    return posix.getgid()
  }

  setgid(id) {
    return posix.setgid(id)
  }

  getegid() {
    return posix.getegid()
  }

  setegid(id) {
    return posix.setegid(id)
  }

  getuid() {
    return posix.getuid()
  }

  setuid(id) {
    return posix.setuid(id)
  }

  geteuid() {
    return posix.geteuid()
  }

  seteuid(id) {
    return posix.seteuid(id)
  }

  getgroups() {
    return posix.getgroups()
  }

  nextTick(cb, ...args) {
    queueMicrotask(cb.bind(null, ...args))
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Process },

      platform: this.platform,
      arch: this.arch,
      title: this.title,
      pid: this.pid,
      ppid: this.ppid,
      argv: this.argv,
      execPath: this.execPath,
      exitCode: this.exitCode,
      version: this.version,
      versions: this.versions,
      env: this.env
    }
  }
}

module.exports = new Process()

},{"bare-abort":7,"bare-env":8,"bare-events":9,"bare-hrtime":17,"bare-os":19,"bare-posix":33,"bare-signals":36,"bare-stdio":40}],35:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],36:[function(require,module,exports){
const EventEmitter = require('bare-events')
const binding = require('./binding')
const errors = require('./lib/errors')

const signals = binding.signals

module.exports = exports = class Signal extends EventEmitter {
  constructor(signum) {
    super()

    if (typeof signum === 'string') {
      if (signum in signals === false) {
        throw errors.UNKNOWN_SIGNAL(`Unknown signal '${signum}'`)
      }

      signum = signals[signum]
    }

    this._signum = signum
    this._closing = null
    this._handle = binding.init(this, this._onsignal, this._onclose)
  }

  start() {
    if (this._closing) throw errors.SIGNAL_CLOSED('Signal is closed')
    binding.start(this._handle, this._signum)
    return this
  }

  stop() {
    if (this._closing) return this
    binding.stop(this._handle)
    return this
  }

  ref() {
    if (this._closing) return this
    binding.ref(this._handle)
    return this
  }

  unref() {
    if (this._closing) return this
    binding.unref(this._handle)
    return this
  }

  close() {
    if (this._closing) return this._closing
    this._closing = EventEmitter.once(this, 'close')

    binding.close(this._handle)

    return this._closing
  }

  _onsignal() {
    this.emit('signal', this._signum)
  }

  _onclose() {
    this._handle = null

    this.emit('close')
  }
}

exports.Emitter = require('./lib/emitter')

exports.constants = signals
exports.errors = errors

},{"./binding":35,"./lib/emitter":37,"./lib/errors":38,"bare-events":9}],37:[function(require,module,exports){
const EventEmitter = require('bare-events')
const Signal = require('..')

module.exports = class SignalEmitter extends EventEmitter {
  constructor() {
    super()

    this._signals = new Map()
    this._unrefed = false

    this.on('newListener', this._onnewlistener).on('removeListener', this._onremovelistener)
  }

  ref() {
    this._unrefed = false
    for (const signal of this._signals.values()) signal.ref()
    return this
  }

  unref() {
    this._unrefed = true
    for (const signal of this._signals.values()) signal.unref()
    return this
  }

  _onnewlistener(name) {
    if (name === 'newListener' || name === 'removeListener') return

    if (this.listenerCount(name) === 0) {
      const signal = new Signal(name)

      signal.on('signal', this._onsignal.bind(this, name)).start()

      if (this._unrefed) signal.unref()

      this._signals.set(name, signal)
    }
  }

  _onremovelistener(name) {
    if (name === 'newListener' || name === 'removeListener') return

    if (this.listenerCount(name) === 0) {
      const signal = this._signals.get(name)

      if (this._unrefed) signal.ref()

      signal.close()

      this._signals.delete(name)
    }
  }

  _onsignal(name) {
    this.emit(name, name, Signal.constants[name])
  }
}

},{"..":36,"bare-events":9}],38:[function(require,module,exports){
module.exports = class SignalError extends Error {
  constructor(msg, fn = SignalError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'SignalError'
  }

  static UNKNOWN_SIGNAL(msg) {
    return new SignalError(msg, SignalError.UNKNOWN_SIGNAL)
  }

  static SIGNAL_CLOSED(msg) {
    return new SignalError(msg, SignalError.SIGNAL_CLOSED)
  }
}

},{}],39:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],40:[function(require,module,exports){
const fs = require('bare-fs')
const tty = require('bare-tty')
const Pipe = require('bare-pipe')
const binding = require('./binding')

const { TTY, NAMED_PIPE } = binding

class IO {
  constructor() {
    this._in = null
    this._out = null
    this._err = null
  }

  get in() {
    if (this._in === null) {
      switch (binding.guessType(0)) {
        case TTY:
          this._in = new tty.ReadStream(0)
          break
        case NAMED_PIPE:
          this._in = new Pipe(0, { eagerOpen: false })
          break
        default:
          this._in = fs.createReadStream(null, { fd: 0, eagerOpen: false })
      }
    }

    return this._in
  }

  get out() {
    if (this._out === null) {
      switch (binding.guessType(1)) {
        case TTY:
          this._out = new tty.WriteStream(1)
          break
        case NAMED_PIPE:
          this._out = new Pipe(1, { eagerOpen: false })
          this._out.unref()
          break
        default:
          this._out = fs.createWriteStream(null, { fd: 1, eagerOpen: false })
      }
    }

    return this._out
  }

  get err() {
    if (this._err === null) {
      switch (binding.guessType(2)) {
        case TTY:
          this._err = new tty.WriteStream(2)
          break
        case NAMED_PIPE:
          this._err = new Pipe(2, { eagerOpen: false })
          this._err.unref()
          break
        default:
          this._err = fs.createWriteStream(null, { fd: 2, eagerOpen: false })
      }
    }

    return this._err
  }
}

module.exports = new IO()

},{"./binding":39,"bare-fs":12,"bare-pipe":29,"bare-tty":44}],41:[function(require,module,exports){
const b4a = require('b4a')
const stream = require('streamx')
const { ReadableStream, WritableStream } = require('./web')

const defaultEncoding = 'utf8'

module.exports = exports = stream.Stream

exports.pipeline = stream.pipeline

exports.isStream = stream.isStream
exports.isEnding = stream.isEnding
exports.isEnded = stream.isEnded
exports.isFinishing = stream.isFinishing
exports.isFinished = stream.isFinished
exports.isDisturbed = stream.isDisturbed

exports.isErrored = function isErrored(stream) {
  return exports.getStreamError(stream) !== null
}

exports.isReadable = function isReadable(stream) {
  return stream.readable && !stream.destroying && !exports.isEnded(stream)
}

exports.isWritable = function isWritable(stream) {
  return stream.writable && !stream.destroying && !exports.isFinishing(stream)
}

exports.getStreamError = stream.getStreamError

exports.addAbortSignal = function addAbortSignal(signal, stream) {
  function onAbort() {
    stream.destroy(signal.reason)
  }

  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort)

  return stream
}

exports.Stream = exports

exports.Readable = class Readable extends stream.Readable {
  constructor(opts = {}) {
    super({
      ...opts,
      byteLength: null,
      byteLengthReadable: null,
      map: null,
      mapReadable: null
    })

    if (this._construct) this._open = this._construct

    if (this._read !== stream.Readable.prototype._read) {
      this._read = read.bind(this, this._read)
    }

    if (this._destroy !== stream.Stream.prototype._destroy) {
      this._destroy = destroy.bind(this, this._destroy)
    }
  }

  get closed() {
    return !exports.isReadable(this)
  }

  get errored() {
    return stream.getStreamError(this)
  }

  push(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    return super.push(chunk)
  }

  unshift(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    super.unshift(chunk)
  }

  static fromWeb(readableStream, opts = {}) {
    const stream = readableStream._stream

    if (opts.encoding) stream.setEncoding(opts.encoding)
    if (opts.signal) exports.addAbortSignal(opts.signal, stream)

    return stream
  }

  static toWeb(readable, opts = {}) {
    return new ReadableStream(readable, opts.strategy)
  }

  async [Symbol.asyncDispose]() {
    if (!this.destroyed) this.destroy()

    await new Promise((resolve) => exports.finished(this, resolve))
  }
}

exports.Writable = class Writable extends stream.Writable {
  constructor(opts = {}) {
    super({
      ...opts,
      byteLength: null,
      byteLengthWritable,
      map: null,
      mapWritable: null
    })

    if (this._construct) this._open = this._construct

    if (this._write !== stream.Writable.prototype._write) {
      this._write = write.bind(this, this._write)
    }

    if (this._destroy !== stream.Stream.prototype._destroy) {
      this._destroy = destroy.bind(this, this._destroy)
    }
  }

  get closed() {
    return !exports.isWritable(this)
  }

  get errored() {
    return stream.getStreamError(this)
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding)
    } else {
      encoding = 'buffer'
    }

    const result = super.write({ chunk, encoding })

    if (cb) stream.Writable.drained(this).then(() => cb(null), cb)

    return result
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk
      chunk = null
    } else if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    } else {
      encoding = 'buffer'
    }

    const result =
      chunk !== undefined && chunk !== null ? super.end({ chunk, encoding }) : super.end()

    if (cb) this.once('finish', () => cb(null))

    return result
  }

  static fromWeb(writableStream, opts = {}) {
    const stream = writableStream._stream

    if (opts.signal) exports.addAbortSignal(opts.signal, stream)

    return stream
  }

  static toWeb(writable) {
    return new WritableStream(writable)
  }

  async [Symbol.asyncDispose]() {
    if (!this.destroyed) this.destroy()

    await new Promise((resolve) => exports.finished(this, resolve))
  }
}

exports.Duplex = class Duplex extends stream.Duplex {
  constructor(opts = {}) {
    super({
      ...opts,
      byteLength: null,
      byteLengthReadable: null,
      byteLengthWritable,
      map: null,
      mapReadable: null,
      mapWritable: null
    })

    if (this._construct) this._open = this._construct

    if (this._read !== stream.Readable.prototype._read) {
      this._read = read.bind(this, this._read)
    }

    if (this._write !== stream.Duplex.prototype._write) {
      this._write = write.bind(this, this._write)
    }

    if (this._destroy !== stream.Stream.prototype._destroy) {
      this._destroy = destroy.bind(this, this._destroy)
    }
  }

  push(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    return super.push(chunk)
  }

  unshift(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    super.unshift(chunk)
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding)
    } else {
      encoding = 'buffer'
    }

    const result = super.write({ chunk, encoding })

    if (cb) stream.Writable.drained(this).then(() => cb(null), cb)

    return result
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk
      chunk = null
    } else if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding)
    } else {
      encoding = 'buffer'
    }

    const result =
      chunk !== undefined && chunk !== null ? super.end({ chunk, encoding }) : super.end()

    if (cb) this.once('finish', () => cb(null))

    return result
  }

  static fromWeb({ readable: readableStream, writable: writableStream }, opts) {
    const readable = exports.Readable.fromWeb(readableStream, opts)
    const writable = exports.Writable.fromWeb(writableStream, opts)

    const duplex = new exports.Duplex({
      write(data, encoding, cb) {
        writable.write(data, encoding, cb)
      }
    })

    readable
      .on('data', (data) => duplex.push(data))
      .on('end', () => duplex.push(null))
      .on('error', (err) => duplex.destroy(err))

    writable.on('finish', () => duplex.end()).on('error', (err) => duplex.destroy(err))

    return duplex
  }

  static toWeb(duplex) {
    const readableStream = exports.Readable.toWeb(duplex)
    const writableStream = exports.Writable.toWeb(duplex)

    return { readable: readableStream, writable: writableStream }
  }
}

class DuplexSide extends exports.Duplex {
  constructor(opts) {
    super(opts)

    this._otherSide = null
    this._cb = null
  }

  _read() {
    const cb = this._cb
    if (!cb) return

    this._cb = null
    cb()
  }

  _write(chunk, encoding, cb) {
    this._otherSide.push(chunk, encoding)
    this._otherSide._cb = cb
  }

  _final(cb) {
    this._otherSide.on('end', cb)
    this._otherSide.push(null)
  }
}

exports.duplexPair = function duplexPair(opts) {
  const sideA = new DuplexSide(opts)
  const sideB = new DuplexSide(opts)

  sideA._otherSide = sideB
  sideB._otherSide = sideA

  return [sideA, sideB]
}

exports.Transform = class Transform extends stream.Transform {
  constructor(opts = {}) {
    super({
      ...opts,
      byteLength: null,
      byteLengthReadable: null,
      byteLengthWritable,
      map: null,
      mapReadable: null,
      mapWritable: null
    })

    if (this._transform !== stream.Transform.prototype._transform) {
      this._transform = transform.bind(this, this._transform)
    } else {
      this._transform = passthrough
    }
  }

  push(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    return super.push(chunk)
  }

  unshift(chunk, encoding) {
    if (typeof chunk === 'string') {
      chunk = b4a.from(chunk, encoding || defaultEncoding)
    }

    super.unshift(chunk)
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding)
    } else {
      encoding = 'buffer'
    }

    const result = super.write({ chunk, encoding })

    if (cb) stream.Writable.drained(this).then(() => cb(null), cb)

    return result
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk
      chunk = null
    } else if (typeof encoding === 'function') {
      cb = encoding
      encoding = null
    }

    if (typeof chunk === 'string') {
      encoding = encoding || defaultEncoding
      chunk = b4a.from(chunk, encoding)
    } else {
      encoding = 'buffer'
    }

    const result =
      chunk !== undefined && chunk !== null ? super.end({ chunk, encoding }) : super.end()

    if (cb) this.once('finish', () => cb(null))

    return result
  }
}

exports.PassThrough = class PassThrough extends exports.Transform {}

exports.finished = function finished(stream, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (!opts) opts = {}

  const { cleanup = false } = opts

  const done = () => {
    cb(exports.getStreamError(stream, { all: true }))

    if (cleanup) detach()
  }

  const detach = () => {
    stream.off('close', done)
    stream.off('error', noop)
  }

  if (stream.destroyed) {
    done()
  } else {
    stream.on('close', done)
    stream.on('error', noop)
  }

  return detach
}

function read(read, cb) {
  read.call(this, 65536)

  cb(null)
}

function write(write, data, cb) {
  write.call(this, data.chunk, data.encoding, cb)
}

function transform(transform, data, cb) {
  transform.call(this, data.chunk, data.encoding, cb)
}

function destroy(destroy, cb) {
  destroy.call(this, exports.getStreamError(this), cb)
}

function passthrough(data, cb) {
  cb(null, data.chunk)
}

function byteLengthWritable(data) {
  return data.chunk.byteLength
}

function noop() {}

},{"./web":42,"b4a":5,"streamx":57}],42:[function(require,module,exports){
const { Readable, Writable, Transform, getStreamError, isStreamx, isDisturbed } = require('streamx')
const tee = require('teex')

const readableKind = Symbol.for('bare.stream.readable.kind')
const writableKind = Symbol.for('bare.stream.writable.kind')
const transformKind = Symbol.for('bare.stream.transform.kind')

// https://streams.spec.whatwg.org/#readablestreamdefaultreader
exports.ReadableStreamDefaultReader = class ReadableStreamDefaultReader {
  constructor(stream) {
    this._stream = stream
    this._stream._stream.once('close', onclose).once('error', onerror)

    const closed = Promise.withResolvers()

    // Avoid unhandled exceptions
    closed.promise.catch(noop)

    this._closed = closed

    function onclose() {
      closed.resolve()
    }

    function onerror(err) {
      closed.reject(err)
    }
  }

  get closed() {
    return this._closed.promise
  }

  read() {
    const stream = this._stream._stream

    return new Promise((resolve, reject) => {
      const err = getStreamError(stream)

      if (err) return reject(err)

      if (stream.destroyed) {
        return resolve({ value: undefined, done: true })
      }

      const value = stream.read()

      if (value !== null) {
        return resolve({ value, done: false })
      }

      stream.once('readable', onreadable).once('close', onclose).once('error', onerror)

      function onreadable() {
        const value = stream.read()

        ondone(null, value === null ? { value: undefined, done: true } : { value, done: false })
      }

      function onclose() {
        ondone(null, { value: undefined, done: true })
      }

      function onerror(err) {
        ondone(err, null)
      }

      function ondone(err, value) {
        stream.off('readable', onreadable).off('close', onclose).off('error', onerror)

        if (err) reject(err)
        else resolve(value)
      }
    })
  }

  releaseLock() {
    this._closed.reject(new TypeError('Reader was released'))
    this._stream._releaseLock()
    this._stream = null
  }

  cancel(reason = new TypeError('Stream was cancelled')) {
    const stream = this._stream._stream

    if (stream.destroyed) return Promise.resolve()

    return new Promise((resolve) =>
      stream.once('close', resolve).once('error', noop).destroy(reason)
    )
  }
}

// https://streams.spec.whatwg.org/#readablestreamdefaultcontroller
exports.ReadableStreamDefaultController = class ReadableStreamDefaultController {
  constructor(stream) {
    this._stream = stream
  }

  get desiredSize() {
    const stream = this._stream._stream

    return stream._readableState.highWaterMark - stream._readableState.buffered
  }

  enqueue(data) {
    this._stream._stream.push(data)
  }

  close() {
    this._stream._stream.push(null)
  }

  error(err) {
    this._stream._stream.destroy(err)
  }
}

// https://streams.spec.whatwg.org/#readablestream
class ReadableStream {
  static get [readableKind]() {
    return 0 // Compatibility version
  }

  static from(iterable) {
    return new ReadableStream(Readable.from(iterable))
  }

  constructor(underlyingSource = {}, queuingStrategy) {
    if (isStreamx(underlyingSource)) {
      this._stream = underlyingSource
    } else {
      if (queuingStrategy === undefined) {
        queuingStrategy = new exports.CountQueuingStrategy()
      }

      const { start, pull, cancel } = underlyingSource
      const { highWaterMark = 1, size = defaultSize } = queuingStrategy

      this._stream = new Readable({ highWaterMark, byteLength: size })

      const controller = new exports.ReadableStreamDefaultController(this)

      try {
        let starting = Promise.resolve()

        if (start) starting = forwardError(start.call(this, controller), controller)

        if (pull) {
          this._stream._read = this._read.bind(this, starting, pull.bind(this, controller))
        }

        if (cancel) {
          this._stream.once('error', cancel.bind(this))
        }
      } catch (err) {
        controller.error(err)
      }
    }

    this._reader = null
  }

  get [readableKind]() {
    return ReadableStream[readableKind]
  }

  get locked() {
    return this._reader !== null
  }

  getReader() {
    if (this.locked) throw new TypeError('Stream is locked')

    this._reader = new exports.ReadableStreamDefaultReader(this)

    return this._reader
  }

  cancel(reason = new TypeError('Stream was cancelled')) {
    const stream = this._stream

    if (stream.destroyed) return Promise.resolve()

    if (this.locked) return Promise.reject(new TypeError('Stream is locked'))

    return new Promise((resolve) =>
      stream.once('close', resolve).once('error', noop).destroy(reason)
    )
  }

  tee() {
    const [a, b] = tee(this._stream)

    return [new ReadableStream(a), new ReadableStream(b)]
  }

  pipeTo(destination) {
    return new Promise((resolve, reject) =>
      this._stream.pipe(destination._stream, (err) => {
        err ? reject(err) : resolve()
      })
    )
  }

  [Symbol.asyncIterator]() {
    return this._stream[Symbol.asyncIterator]()
  }

  _releaseLock() {
    this._reader = null
  }

  async _read(starting, pull, cb) {
    await starting

    let err = null
    try {
      await pull()
    } catch (e) {
      err = e
    }
    cb(err)
  }
}

function defaultSize() {
  return 1
}

exports.ReadableStream = ReadableStream

// https://streams.spec.whatwg.org/#countqueuingstrategy
exports.CountQueuingStrategy = class CountQueuingStrategy {
  constructor(opts = {}) {
    const { highWaterMark = 1 } = opts

    this.highWaterMark = highWaterMark
  }

  size(chunk) {
    return 1
  }
}

// https://streams.spec.whatwg.org/#bytelengthqueuingstrategy
exports.ByteLengthQueuingStrategy = class ByteLengthQueuingStrategy {
  constructor(opts = {}) {
    const { highWaterMark = 16384 } = opts

    this.highWaterMark = highWaterMark
  }

  size(chunk) {
    return chunk.byteLength
  }
}

exports.isReadableStream = function isReadableStream(value) {
  if (value instanceof ReadableStream) return true

  return (
    typeof value === 'object' &&
    value !== null &&
    value[readableKind] === ReadableStream[readableKind]
  )
}

// https://streams.spec.whatwg.org/#readablestream-errored
exports.isReadableStreamErrored = function isReadableStreamErrored(stream) {
  return getStreamError(stream._stream) !== null
}

// https://streams.spec.whatwg.org/#is-readable-stream-disturbed
exports.isReadableStreamDisturbed = function isReadableStreamDisturbed(stream) {
  return isDisturbed(stream._stream)
}

// https://streams.spec.whatwg.org/#writablestreamdefaultwriter
exports.WritableStreamDefaultWriter = class WritableStreamDefaultWriter {
  constructor(stream) {
    this._stream = stream
    this._stream._stream.once('close', onclose).once('error', onerror)

    const closed = Promise.withResolvers()

    // Avoid unhandled exceptions
    closed.promise.catch(noop)

    this._closed = closed

    function onclose() {
      closed.resolve()
    }

    function onerror(err) {
      closed.reject(err)
    }
  }

  get desiredSize() {
    const stream = this._stream._stream

    return stream._writableState.highWaterMark - stream._writableState.buffered
  }

  get closed() {
    return this._closed.promise
  }

  get ready() {
    const stream = this._stream._stream

    if (getStreamError(stream)) return Promise.reject()

    return Writable.drained(stream).then()
  }

  async write(chunk) {
    const stream = this._stream._stream

    let err = getStreamError(stream)
    if (err) return Promise.reject(err)

    stream.write(chunk)

    await Writable.drained(stream)

    err = getStreamError(stream)
    if (err) return Promise.reject(err)
  }

  releaseLock() {
    this._closed.reject(new TypeError('Writer was released'))
    this._stream._releaseLock()
    this._stream = null
  }

  close() {
    const stream = this._stream._stream

    if (stream.destroyed) return Promise.resolve()

    return new Promise((resolve) => stream.once('close', resolve).end())
  }

  abort(reason = new TypeError('Stream was aborted')) {
    const stream = this._stream._stream

    if (stream.destroyed) return Promise.resolve()

    return new Promise((resolve) => stream.once('close', resolve).destroy(reason))
  }
}

// https://streams.spec.whatwg.org/#writablestreamdefaultcontroller
exports.WritableStreamDefaultController = class WritableStreamDefaultController {
  constructor(stream) {
    this._stream = stream
  }

  error(err) {
    this._stream._stream.destroy(err)
  }
}

// https://streams.spec.whatwg.org/#writablestream
class WritableStream {
  static get [writableKind]() {
    return 0 // Compatibility version
  }

  constructor(underlyingSink = {}, queuingStrategy = {}) {
    if (isStreamx(underlyingSink)) {
      this._stream = underlyingSink
    } else {
      if (queuingStrategy === undefined) {
        queuingStrategy = new exports.CountQueuingStrategy()
      }

      const { start, write, close, abort } = underlyingSink
      const { highWaterMark = 1, size = defaultSize } = queuingStrategy

      this._stream = new Writable({ highWaterMark, byteLength: size })

      const controller = new exports.WritableStreamDefaultController(this)

      this._controller = controller

      try {
        let starting = Promise.resolve()

        if (start) starting = forwardError(start.call(this, controller), controller)

        if (write) {
          this._stream._write = this._write.bind(this, starting, write.bind(this))
        }

        if (close) {
          this._stream._destroy = this._destroy.bind(this, close.call(this))
        }

        if (abort) {
          this._stream.once('error', abort.bind(this))
        }
      } catch (err) {
        controller.error(err)
      }
    }

    this._writer = null
  }

  get [writableKind]() {
    return WritableStream[writableKind]
  }

  get locked() {
    return this._writer !== null
  }

  getWriter() {
    if (this.locked) throw new TypeError('Stream is locked')

    this._writer = new exports.WritableStreamDefaultWriter(this)

    return this._writer
  }

  abort(reason = new TypeError('Stream was aborted')) {
    if (this._stream.destroyed) return Promise.resolve()

    if (this.locked) return Promise.reject(new TypeError('Stream is locked'))

    return new Promise((resolve) => this._stream.once('close', resolve).destroy(reason))
  }

  close() {
    if (this._stream.destroyed) return Promise.resolve()

    if (this.locked) return Promise.reject(new TypeError('Stream is locked'))

    return new Promise((resolve) => this._stream.once('close', resolve).end())
  }

  _releaseLock() {
    this._writer = null
  }

  async _write(starting, write, data, cb) {
    await starting

    let err = null
    try {
      await write(data, this._controller)
    } catch (e) {
      err = e
    }
    cb(err)
  }

  async _destroy(closing, cb) {
    let err = null
    try {
      await closing
    } catch (e) {
      err = e
    }
    cb(err)
  }
}

exports.WritableStream = WritableStream

exports.isWritableStream = function isWritableStream(value) {
  if (value instanceof WritableStream) return true

  return (
    typeof value === 'object' &&
    value !== null &&
    value[writableKind] === WritableStream[writableKind]
  )
}

// https://streams.spec.whatwg.org/#transformstreamdefaultcontroller
exports.TransformStreamDefaultController = class TransformStreamDefaultController {
  constructor(stream) {
    this._stream = stream
  }

  get desiredSize() {
    const stream = this._stream._stream

    return stream._readableState.highWaterMark - stream._readableState.buffered
  }

  enqueue(data) {
    this._stream._stream.push(data)
  }

  error(err) {
    this._stream._stream.destroy(err)
  }

  terminate() {
    const stream = this._stream._stream

    stream.push(null)
    stream.destroy(new TypeError('Stream has been terminated'))
  }
}

// https://streams.spec.whatwg.org/#transformstream
class TransformStream {
  static get [transformKind]() {
    return 0 // Compatibility version
  }

  constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
    if (isStreamx(transformer)) {
      this._stream = transformer
    } else {
      const { start, transform, flush } = transformer

      this._stream = new Transform({ ...writableStrategy, ...readableStrategy })

      const controller = new exports.TransformStreamDefaultController(this)

      this._controller = controller

      try {
        let starting = Promise.resolve()

        if (start) starting = forwardError(start.call(this, controller), controller)

        if (transform) {
          this._stream._transform = this._transform.bind(this, starting, transform.bind(this))
        }

        if (flush) {
          this._stream._flush = this._flush.bind(this, flush.call(this, this._controller))
        }
      } catch (err) {
        controller.error(err)
      }
    }

    this._writable = new WritableStream(this._stream)
    this._readable = new ReadableStream(this._stream)
  }

  get [transformKind]() {
    return TransformStream[transformKind]
  }

  get writable() {
    return this._writable
  }

  get readable() {
    return this._readable
  }

  async _transform(starting, transform, data, cb) {
    await starting

    let err = null
    try {
      await transform(data, this._controller)
    } catch (e) {
      err = e
    }
    cb(err)
  }

  async _flush(flush, cb) {
    let err = null
    try {
      await flush
    } catch (e) {
      err = e
    }
    cb(err)
  }
}

exports.TransformStream = TransformStream

exports.isTransformStream = function isTransformStream(value) {
  if (value instanceof TransformStream) return true

  return (
    typeof value === 'object' &&
    value !== null &&
    value[transformKind] === TransformStream[transformKind]
  )
}

async function forwardError(promise, controller) {
  try {
    await promise
  } catch (err) {
    controller.error(err)
  }
}

function noop() {}

},{"streamx":57,"teex":59}],43:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],44:[function(require,module,exports){
(function (Buffer){(function (){
const { Readable, Writable } = require('bare-stream')
const Signal = require('bare-signals')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')

const defaultReadBufferSize = 65536
const empty = Buffer.alloc(0)
const modes = new Set([constants.mode.NORMAL, constants.mode.RAW, constants.mode.IO])

exports.ReadStream = class TTYReadStream extends Readable {
  constructor(fd, opts = {}) {
    super(opts)

    const { readBufferSize = defaultReadBufferSize } = opts

    validateFd(fd)
    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    this._fd = fd
    this._state = 0
    this._buffer = Buffer.alloc(readBufferSize)

    this._pendingDestroy = null

    this._handle = binding.init(fd, this._buffer, this, noop, this._onread, this._onclose, false)
  }

  get fd() {
    return this._fd
  }

  get isTTY() {
    return true
  }

  setMode(mode) {
    validateMode(mode)

    this._alive()

    binding.setMode(this._handle, mode)

    return this
  }

  setRawMode(enabled) {
    return this.setMode(enabled ? constants.mode.RAW : constants.mode.NORMAL)
  }

  _alive() {
    if (this._state & constants.state.CLOSING) {
      throw errors.STREAM_IS_CLOSED('Stream is closed')
    }
  }

  _read() {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING

      binding.resume(this._handle)
    }
  }

  _predestroy() {
    this._close()
  }

  _destroy(err, cb) {
    if (this._state & constants.state.CLOSED) return cb(err)

    this._pendingDestroy = cb

    this._close()
  }

  _close() {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING

    binding.close(this._handle)
  }

  _continueDestroy() {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _onread(err, read) {
    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      return
    }

    // Unpooled, as a read too small to be given a buffer of its own would
    // otherwise pin the whole pool it came from for as long as its consumer
    // holds on to it.
    const copy = Buffer.allocUnsafeSlow(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._state &= ~constants.state.READING

      binding.pause(this._handle)
    }
  }

  _onclose() {
    this._state |= constants.state.CLOSED

    this._continueDestroy()
  }
}

exports.WriteStream = class TTYWriteStream extends Writable {
  constructor(fd, opts = {}) {
    super(opts)

    validateFd(fd)

    this._fd = fd
    this._state = 0
    this._size = null

    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingDestroy = null

    this._handle = binding.init(fd, empty, this, this._onwrite, noop, this._onclose, true)

    try {
      this._refreshSize()
    } catch (err) {
      this._close()

      throw err
    }

    if (TTYWriteStream._streams.size === 0) TTYWriteStream._resize.start()

    TTYWriteStream._streams.add(this)
  }

  get fd() {
    return this._fd
  }

  get isTTY() {
    return true
  }

  get columns() {
    return this._size[0]
  }

  get rows() {
    return this._size[1]
  }

  getWindowSize() {
    this._alive()

    return [this._size[0], this._size[1]]
  }

  _refreshSize() {
    const size = binding.getWindowSize(this._handle)

    const changed = this._size === null || size[0] !== this._size[0] || size[1] !== this._size[1]

    this._size = size

    return changed
  }

  _alive() {
    if (this._state & constants.state.CLOSING) {
      throw errors.STREAM_IS_CLOSED('Stream is closed')
    }
  }

  _writev(batch, cb) {
    this._pendingWrite = cb
    this._pendingWriteBatch = batch

    try {
      coerceBatch(batch)

      binding.writev(
        this._handle,
        batch.map(({ chunk }) => chunk)
      )
    } catch (err) {
      this._continueWrite(err)
    }
  }

  _predestroy() {
    this._close()
  }

  _destroy(err, cb) {
    if (this._state & constants.state.CLOSED) return cb(err)

    this._pendingDestroy = cb

    this._close()
  }

  _close() {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING

    binding.close(this._handle)

    TTYWriteStream._streams.delete(this)

    if (TTYWriteStream._streams.size === 0) TTYWriteStream._resize.stop()
  }

  _continueWrite(err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite
    this._pendingWrite = null
    this._pendingWriteBatch = null
    cb(err)
  }

  _continueDestroy() {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _onwrite(err) {
    this._continueWrite(err)
  }

  _onclose() {
    this._state |= constants.state.CLOSED

    this._continueDestroy()
  }

  _onresize() {
    let changed

    try {
      changed = this._refreshSize()
    } catch (err) {
      this.emit('error', err)
      return
    }

    if (changed) this.emit('resize')
  }

  static _streams = new Set()

  static _resize = new Signal('SIGWINCH')
}

exports.constants = constants

exports.errors = errors

exports.isTTY = function isTTY(fd) {
  return isValidFd(fd) && binding.isTTY(fd)
}

exports.isatty = exports.isTTY // For Node.js compatibility

exports.WriteStream._resize
  .on('signal', () => {
    for (const stream of exports.WriteStream._streams) {
      stream._onresize()
    }
  })
  .unref()

function isValidFd(fd) {
  return typeof fd === 'number' && Number.isInteger(fd) && fd >= 0 && fd <= 0x7fffffff
}

function validateFd(fd) {
  if (typeof fd !== 'number') {
    throw errors.INVALID_FD(`File descriptor must be a number, got ${typeof fd}`)
  }

  if (!isValidFd(fd)) {
    throw errors.INVALID_FD(
      `File descriptor must be an integer between 0 and ${0x7fffffff}, got ${fd}`
    )
  }
}

function validateMode(mode) {
  if (typeof mode !== 'number') {
    throw errors.INVALID_ARGUMENT(`Mode must be a number, got ${typeof mode}`)
  }

  if (!modes.has(mode)) {
    throw errors.INVALID_ARGUMENT(`Mode must be one of ${[...modes].join(', ')}, got ${mode}`)
  }
}

function validateInteger(value, name, min, max) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`${name} must be a number, got ${typeof value}`)
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw errors.INVALID_ARGUMENT(
      `${name} must be an integer between ${min} and ${max}, got ${value}`
    )
  }
}

function coerceBatch(batch) {
  for (let i = 0; i < batch.length; i++) {
    const chunk = batch[i].chunk

    if (ArrayBuffer.isView(chunk) === false) {
      throw errors.INVALID_ARGUMENT(`Chunk must be a string or a view, got ${typeof chunk}`)
    }

    batch[i].chunk = Buffer.coerce(chunk)
  }
}

function noop() {}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./binding":43,"./lib/constants":45,"./lib/errors":46,"bare-signals":36,"bare-stream":41,"buffer":52}],45:[function(require,module,exports){
const binding = require('../binding')

module.exports = exports = {
  mode: {
    NORMAL: binding.MODE_NORMAL,
    RAW: binding.MODE_RAW,
    IO: binding.MODE_IO || 0
  },

  state: {
    READING: 0x1,
    CLOSING: 0x2,
    CLOSED: 0x4
  }
}

/** @deprecated Use `mode.NORMAL` */
exports.MODE_NORMAL = exports.mode.NORMAL
/** @deprecated Use `mode.RAW` */
exports.MODE_RAW = exports.mode.RAW
/** @deprecated Use `mode.IO` */
exports.MODE_IO = exports.mode.IO

},{"../binding":43}],46:[function(require,module,exports){
module.exports = class TTYError extends Error {
  constructor(msg, fn = TTYError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'TTYError'
  }

  static STREAM_IS_CLOSED(msg) {
    return new TTYError(msg, TTYError.STREAM_IS_CLOSED)
  }

  static INVALID_FD(msg) {
    return new TTYError(msg, TTYError.INVALID_FD)
  }

  static INVALID_ARGUMENT(msg) {
    return new TTYError(msg, TTYError.INVALID_ARGUMENT)
  }
}

},{}],47:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"dup":6}],48:[function(require,module,exports){
const path = require('bare-path')
const binding = require('./binding')
const errors = require('./lib/errors')
const URLSearchParams = require('./lib/url-search-params')

const kind = Symbol.for('bare.url.kind')

const isWindows = Bare.platform === 'win32'

// Scratch buffer that the binding writes the parsed component offsets into. A
// single shared buffer is reused across every parse.
//
// The offsets are copied out into fields on the URL immediately after a
// successful parse, so nothing observes the buffer across calls.
const components = new Uint32Array(8)

// The value used for a component that is not present in the URL.
const unset = 0xffffffff

// The schemes the parser treats specially. A URL cannot be switched between a
// special and a non-special scheme, and a backslash only terminates a host for
// the former.
const special = new Set(['ftp', 'file', 'http', 'https', 'ws', 'wss'])

// https://url.spec.whatwg.org/#scheme-start-state
const scheme = /^[a-z][a-z0-9+\-.]*$/

// ASCII tab and newline are removed from input before it is parsed rather than
// percent-encoded like the other C0 controls.
const whitespaceAll = /[\t\n\r]/g

// The characters that terminate a host, and so bound the value the host and
// hostname setters accept.
const hostEnd = /[/\\?#]/
const hostEndOpaque = /[/?#]/

// The delimiters that would let a setter's value escape the component it is
// spliced into. Everything else is left to the reparse, which applies the full
// percent-encode set for the component. As elsewhere in this package, each set
// needs two patterns because test() advances a global pattern's lastIndex.
//
// Credentials are not run through the parser and so keep their tabs and
// newlines, percent-encoded, rather than having them stripped.
const userinfoDelimiter = /[\t\n\r/\\?#@:]/
const userinfoDelimiterAll = /[\t\n\r/\\?#@:]/g

const pathDelimiter = /[?#]/
const pathDelimiterAll = /[?#]/g

// A leading or trailing run of C0 control or space in a value that ends up at
// either end of the href. The parser strips those, but only when parsing a URL
// as a whole, so a setter has to encode its own.
const edges = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g

const escapes = {
  '\t': '%09',
  '\n': '%0A',
  '\r': '%0D',
  '/': '%2F',
  '\\': '%5C',
  ':': '%3A',
  '?': '%3F',
  '@': '%40',
  '#': '%23'
}

// The characters that pathToFileURL() has to percent-encode itself. A backslash
// is a path separator on Windows and so is left alone there.
const reserved = isWindows ? /[%#?\n\r\t]/ : /[%#?\n\r\t\\]/

class URL {
  static get [kind]() {
    return 0 // Compatibility version
  }

  constructor(input, base, opts = {}) {
    if (arguments.length === 0) throw errors.INVALID_URL()

    input = String(input)

    if (base !== undefined) base = String(base)

    this._href = undefined
    this._schemeEnd = 0
    this._usernameEnd = 0
    this._hostStart = 0
    this._hostEnd = 0
    this._pathStart = 0
    this._queryStart = 0
    this._fragmentStart = 0
    this._params = null

    this._parse(input, base, opts.throw !== false)
  }

  get [kind]() {
    return URL[kind]
  }

  // https://url.spec.whatwg.org/#dom-url-href

  get href() {
    return this._href
  }

  set href(value) {
    // Unlike every other setter, the href setter reports a parse failure rather
    // than leaving the URL untouched.
    this._parse(String(value), null, true)

    if (this._params) this._params._parse(this.search)
  }

  // https://url.spec.whatwg.org/#dom-url-protocol

  get protocol() {
    return this._slice(0, this._schemeEnd) + ':'
  }

  set protocol(value) {
    value = strip(String(value))

    const end = value.indexOf(':')

    if (end !== -1) value = value.slice(0, end)

    value = value.toLowerCase()

    if (!scheme.test(value)) return

    const current = this._slice(0, this._schemeEnd)

    if (special.has(current) !== special.has(value)) return

    if (value === 'file' && (this.username || this.password || this.port)) {
      return
    }

    if (current === 'file' && this._hostStart === this._hostEnd) return

    this._update(this._replace(value, 0, this._schemeEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-username

  get username() {
    return this._slice(this._schemeEnd + 3 /* :// */, this._usernameEnd)
  }

  set username(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = encodeUserinfo(String(value))

    if (!hasCredentials(this)) value += '@'

    this._update(this._replace(value, this._schemeEnd + 3 /* :// */, this._usernameEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-password

  get password() {
    return this._href.slice(this._usernameEnd + 1 /* : */, this._hostStart - 1 /* @ */)
  }

  set password(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = ':' + encodeUserinfo(String(value))

    let end = this._hostStart - 1 /* @ */

    if (!hasCredentials(this)) {
      value += '@'
      end = this._usernameEnd
    }

    this._update(this._replace(value, this._usernameEnd, end))
  }

  // https://url.spec.whatwg.org/#dom-url-host

  get host() {
    return this._slice(this._hostStart, this._pathStart)
  }

  set host(value) {
    if (hasOpaquePath(this)) {
      return
    }

    const protocol = this._slice(0, this._schemeEnd)

    value = truncateHost(protocol, String(value))

    // An `@` would make the reparse read the value as credentials rather than
    // as a host, so it is rejected outright.
    if (value.includes('@')) return

    const separator = portSeparator(value)

    let end = this._hostEnd

    // A port in the value is parsed separately so that an invalid one leaves
    // the existing port in place rather than rejecting the host along with it.
    if (separator !== -1) {
      // A file URL cannot have a port, so a value carrying one is rejected
      // rather than split.
      if (protocol === 'file') return

      const port = parsePort(value.slice(separator + 1))

      value = value.slice(0, separator)

      if (port !== null) {
        value += port
        end = this._pathStart
      }
    }

    if (value === '' && cannotHaveEmptyHost(protocol)) return

    this._update(this._replace(value, this._hostStart, end))
  }

  // https://url.spec.whatwg.org/#dom-url-hostname

  get hostname() {
    return this._slice(this._hostStart, this._hostEnd)
  }

  set hostname(value) {
    if (hasOpaquePath(this)) {
      return
    }

    const protocol = this._slice(0, this._schemeEnd)

    value = truncateHost(protocol, String(value))

    // A port cannot be set through this setter, and a value that carries one is
    // rejected outright rather than truncated. An `@` would make the reparse
    // read the value as credentials rather than as a host.
    if (value.includes('@') || portSeparator(value) !== -1) return

    if (value === '' && cannotHaveEmptyHost(protocol)) return

    this._update(this._replace(value, this._hostStart, this._hostEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-port

  get port() {
    return this._slice(this._hostEnd + 1 /* : */, this._pathStart)
  }

  set port(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = strip(String(value))

    if (value !== '') {
      value = parsePort(value)

      if (value === null) return
    }

    this._update(this._replace(value, this._hostEnd, this._pathStart))
  }

  // https://url.spec.whatwg.org/#dom-url-pathname

  get pathname() {
    return this._slice(this._pathStart, this._queryStart - 1 /* ? */)
  }

  set pathname(value) {
    if (hasOpaquePath(this)) {
      return
    }

    value = encodePath(encodeEdges(String(value)))

    // An empty path is left alone, as only a special scheme is required to have
    // one and the reparse inserts it there.
    if (value !== '' && value[0] !== '/' && value[0] !== '\\') {
      value = '/' + value
    }

    this._update(this._replace(value, this._pathStart, this._queryStart - 1 /* ? */))
  }

  // https://url.spec.whatwg.org/#dom-url-search

  get search() {
    return this._slice(this._queryStart - 1 /* ? */, this._fragmentStart - 1 /* # */)
  }

  set search(value) {
    value = String(value)

    if (value !== '') {
      if (value[0] === '?') value = value.slice(1)

      value = '?' + encodeQuery(encodeEdges(value))
    }

    this._update(
      this._replace(value, this._queryStart - 1 /* ? */, this._fragmentStart - 1 /* # */)
    )
  }

  // https://url.spec.whatwg.org/#dom-url-searchparams

  get searchParams() {
    if (this._params === null) {
      this._params = new URLSearchParams(this.search, this)
    }

    return this._params
  }

  // https://url.spec.whatwg.org/#dom-url-hash

  get hash() {
    return this._slice(this._fragmentStart - 1 /* # */)
  }

  set hash(value) {
    value = String(value)

    // The fragment runs to the end of the URL, so nothing in it can escape into
    // another component and no delimiter needs encoding here.
    if (value !== '') {
      if (value[0] === '#') value = value.slice(1)

      value = '#' + encodeEdges(value)
    }

    this._update(this._replace(value, this._fragmentStart - 1 /* # */))
  }

  toString() {
    return this._href
  }

  toJSON() {
    return this._href
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: URL },

      href: this.href,
      protocol: this.protocol,
      username: this.username,
      password: this.password,
      host: this.host,
      hostname: this.hostname,
      port: this.port,
      pathname: this.pathname,
      search: this.search,
      searchParams: this.searchParams,
      hash: this.hash
    }
  }

  _slice(start, end = this._href.length) {
    return this._href.slice(start, end)
  }

  _replace(replacement, start, end = this._href.length) {
    return this._slice(0, start) + replacement + this._slice(end)
  }

  _parse(input, base, shouldThrow) {
    let href

    try {
      href = binding.parse(input, base || null, components, shouldThrow)
    } catch (err) {
      if (err instanceof TypeError || err.code !== undefined) throw err

      throw errors.INVALID_URL(`Invalid URL '${input}'`, input)
    }

    if (href === undefined) return

    this._href = href
    this._schemeEnd = components[0]
    this._usernameEnd = components[1]
    this._hostStart = components[2]
    this._hostEnd = components[3]
    this._pathStart = components[5]

    const queryStart = components[6]
    const fragmentStart = components[7]

    const end = href.length + 1

    this._queryStart = queryStart === unset ? end : queryStart
    this._fragmentStart = fragmentStart === unset ? end : fragmentStart
  }

  _update(input) {
    try {
      this._parse(input, null, true)
    } catch (err) {
      if (err instanceof TypeError) throw err

      return
    }

    if (this._params) this._params._parse(this.search)
  }
}

module.exports = exports = URL

// https://url.spec.whatwg.org/#url-opaque-path
function hasOpaquePath(url) {
  return url.pathname[0] !== '/'
}

// https://url.spec.whatwg.org/#cannot-have-a-username-password-port
function cannotHaveCredentialsOrPort(url) {
  return url.hostname === '' || url.protocol === 'file:'
}

// Whether the URL carries a userinfo section, and so an `@` before its host.
function hasCredentials(url) {
  return url._hostStart !== url._usernameEnd
}

// Almost no input contains any of these, so it is worth ruling all three out
// before rewriting anything.
function strip(value) {
  if (value.indexOf('\t') === -1 && value.indexOf('\n') === -1 && value.indexOf('\r') === -1) {
    return value
  }

  return value.replace(whitespaceAll, '')
}

// https://url.spec.whatwg.org/#host-state
//
// Host parsing stops at the first character that starts another component, so
// anything from there on is dropped rather than spliced into the host.
function truncateHost(protocol, value) {
  const end = value.search(special.has(protocol) ? hostEnd : hostEndOpaque)

  return end === -1 ? value : value.slice(0, end)
}

// Only a special scheme other than file has to have a host.
function cannotHaveEmptyHost(protocol) {
  return protocol !== 'file' && special.has(protocol)
}

// The index of the colon that separates a host from its port, disregarding the
// colons of an IPv6 address, or -1 if the host carries no port.
function portSeparator(host) {
  return host.indexOf(':', host[0] === '[' ? host.indexOf(']') : 0)
}

// https://url.spec.whatwg.org/#port-state
//
// Parsing stops at the first character that is not a digit, so a value with no
// leading digits, or one that overflows, leaves the port as it was.
function parsePort(value) {
  value = /^\d*/.exec(value)[0]

  if (value === '' || Number(value) > 65535) return null

  return ':' + value
}

function encodeUserinfo(value) {
  if (!userinfoDelimiter.test(value)) return value

  return value.replace(userinfoDelimiterAll, (match) => escapes[match])
}

function encodePath(value) {
  if (!pathDelimiter.test(value)) return value

  return value.replace(pathDelimiterAll, (match) => escapes[match])
}

function encodeFilePath(value) {
  // Paths hardly ever contain any of these, so one pass to rule them out is
  // cheaper than the six or seven replacements it stands in for.
  if (!reserved.test(value)) return value

  value = value
    .replaceAll('%', '%25') // Must be first
    .replaceAll('#', '%23')
    .replaceAll('?', '%3f')
    .replaceAll('\n', '%0a')
    .replaceAll('\r', '%0d')
    .replaceAll('\t', '%09')

  if (!isWindows) {
    value = value.replaceAll('\\', '%5c')
  }

  return value
}

function encodeQuery(value) {
  if (value.indexOf('#') === -1) return value

  return value.replaceAll('#', '%23')
}

// Percent-encodes a leading or trailing run of C0 control or space, which the
// parser would otherwise strip from a value that lands at either end of the
// href. Every component that can end a URL encodes them anyway, so this only
// brings the encoding forward.
function encodeEdges(value) {
  const len = value.length

  if (len === 0) return value
  if (value.charCodeAt(0) > 0x20 && value.charCodeAt(len - 1) > 0x20) return value

  return value.replace(edges, (match) => {
    let encoded = ''

    for (let i = 0, n = match.length; i < n; i++) {
      encoded += '%' + match.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase()
    }

    return encoded
  })
}

exports.URL = URL
exports.URLSearchParams = URLSearchParams

exports.errors = errors

exports.isURL = function isURL(value) {
  if (value instanceof URL) return true

  return typeof value === 'object' && value !== null && value[kind] === URL[kind]
}

exports.isURLSearchParams = URLSearchParams.isURLSearchParams

// https://url.spec.whatwg.org/#dom-url-parse
exports.parse = function parse(input, base) {
  const url = new URL(input, base, { throw: false })
  return url._href ? url : null
}

// https://url.spec.whatwg.org/#dom-url-canparse
exports.canParse = function canParse(input, base) {
  return binding.canParse(String(input), base ? String(base) : null)
}

exports.fileURLToPath = function fileURLToPath(url) {
  if (typeof url === 'string') {
    url = new URL(url)
  }

  if (url.protocol !== 'file:') {
    throw errors.INVALID_URL_SCHEME('The URL must use the file: protocol')
  }

  if (!isWindows && url.hostname) {
    throw errors.INVALID_FILE_URL_HOST("The file: URL host must be 'localhost' or empty")
  }

  const encoded = url.pathname

  // Every check below looks for a percent encoded sequence, as does the decoding
  // that follows, so a path without any can skip all of them.
  const hasEncoded = encoded.includes('%')

  if (hasEncoded) {
    if (isWindows) {
      if (/%2f|%5c/i.test(encoded)) {
        throw errors.INVALID_FILE_URL_PATH(
          'The file: URL path must not include encoded \\ or / characters'
        )
      }
    } else if (/%2f/i.test(encoded)) {
      throw errors.INVALID_FILE_URL_PATH('The file: URL path must not include encoded / characters')
    }

    if (/%00/i.test(encoded)) {
      throw errors.INVALID_FILE_URL_PATH(
        'The file: URL path must not include encoded NUL characters'
      )
    }
  }

  const pathname = path.normalize(hasEncoded ? decodeURIComponent(encoded) : encoded)

  if (isWindows) {
    if (url.hostname) return '\\\\' + url.hostname + pathname

    const letter = pathname.charCodeAt(1) | 0x20

    if (letter < 0x61 /* a */ || letter > 0x7a /* z */ || pathname.charCodeAt(2) !== 0x3a /* : */) {
      throw errors.INVALID_FILE_URL_PATH('The file: URL path must be absolute')
    }

    return pathname.slice(1)
  }

  return pathname
}

exports.pathToFileURL = function pathToFileURL(pathname) {
  const isUNC = isWindows && pathname.startsWith('\\\\')

  let resolved = isUNC ? pathname : path.resolve(pathname)

  if (isUNC || (isWindows && resolved.startsWith('\\\\'))) {
    // https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
    const hostStart = resolved.startsWith('\\\\?\\UNC\\') ? 8 : 2
    const hostEnd = resolved.indexOf('\\', hostStart)

    if (hostEnd === -1) {
      throw errors.INVALID_ARG_VALUE('Missing UNC resource path')
    }

    if (hostEnd === 2) {
      throw errors.INVALID_ARG_VALUE('Empty UNC servername')
    }

    const hostname = truncateHost('file', resolved.slice(hostStart, hostEnd))

    return new URL('file://' + hostname + encodeFilePath(resolved.slice(hostEnd)))
  }

  if (pathname[pathname.length - 1] === '/') {
    resolved += '/'
  } else if (isWindows && pathname[pathname.length - 1] === '\\') {
    resolved += '\\'
  }

  return new URL('file:' + encodeFilePath(resolved))
}

exports.format = function format(parts) {
  const { protocol, auth, host, hostname, port, pathname, search, query, hash, slashes } = parts

  let result = ''

  if (typeof protocol === 'string') {
    result += protocol

    if (protocol[protocol.length - 1] !== ':') {
      result += ':'
    }

    if (slashes === true || /https?|ftp|gopher|file/.test(protocol)) {
      result += '//'
    }
  }

  if (typeof auth === 'string') {
    if (host || hostname) result += auth + '@'
  }

  if (typeof host === 'string') result += host
  else {
    result += hostname

    if (port) result += ':' + port
  }

  if (typeof pathname === 'string' && pathname !== '') {
    if (pathname[0] !== '/') result += '/'
    result += pathname
  }

  if (typeof search === 'string') {
    if (search[0] !== '?') result += '?'
    result += search
  } else if (typeof query === 'object' && query !== null) {
    result += '?' + new URLSearchParams(query)
  }

  if (typeof hash === 'string') {
    if (hash[0] !== '#') result += '#'
    result += hash
  }

  return result
}

},{"./binding":47,"./lib/errors":49,"./lib/url-search-params":50,"bare-path":23}],49:[function(require,module,exports){
module.exports = class URLError extends Error {
  constructor(msg, fn = URLError, code = fn.name) {
    super(`${code}: ${msg}`)

    this.code = code

    if (Error.captureStackTrace) Error.captureStackTrace(this, fn)
  }

  get name() {
    return 'URLError'
  }

  static INVALID_URL(msg, input) {
    const err = new URLError(msg, URLError.INVALID_URL)

    err.input = input

    return err
  }

  static INVALID_URL_SCHEME(msg = 'Invalid URL') {
    return new URLError(msg, URLError.INVALID_URL_SCHEME)
  }

  static INVALID_FILE_URL_HOST(msg = 'Invalid file: URL host') {
    return new URLError(msg, URLError.INVALID_FILE_URL_HOST)
  }

  static INVALID_FILE_URL_PATH(msg = 'Invalid file: URL path') {
    return new URLError(msg, URLError.INVALID_FILE_URL_PATH)
  }

  static INVALID_ARG_VALUE(msg = 'Invalid argument value') {
    return new URLError(msg, URLError.INVALID_ARG_VALUE)
  }
}

},{}],50:[function(require,module,exports){
const kind = Symbol.for('bare.url.search-params.kind')

// The URL each instance writes back to, if any. Kept module private so that the
// setter it drives cannot be pointed at an arbitrary object.
const urls = new WeakMap()

class URLSearchParams {
  static get [kind]() {
    return 0 // Compatibility version
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-urlsearchparams
  constructor(init, url = null) {
    this._params = null

    if (url) urls.set(this, url)

    if (typeof init === 'string') {
      this._parse(init)
    } else {
      this._params = new Map()

      if (init) {
        for (const [name, value] of typeof init[Symbol.iterator] === 'function'
          ? init
          : Object.entries(init)) {
          this.append(name, value)
        }
      }
    }
  }

  get [kind]() {
    return URLSearchParams[kind]
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-size
  get size() {
    let size = 0

    for (const values of this._params.values()) size += values.length

    return size
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-append
  append(name, value = null) {
    if (value === null) return

    let list = this._params.get(name)

    if (list === undefined) {
      list = []
      this._params.set(name, list)
    }

    list.push(value)

    this._update()
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-delete
  delete(name, value = null) {
    if (value === null) this._params.delete(name)
    else {
      let list = this._params.get(name)

      if (list === undefined) return

      list = list.filter((found) => found !== value)

      if (list.length === 0) this._params.delete(name)
      else this._params.set(name, list)
    }

    this._update()
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-get
  get(name) {
    const list = this._params.get(name)

    if (list === undefined) return null

    return list[0]
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-getall
  getAll(name) {
    const list = this._params.get(name)

    if (list === undefined) return []

    return Array.from(list)
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-has
  has(name, value = null) {
    const list = this._params.get(name)

    if (list === undefined) return false

    if (value === null) return true

    return list.includes(value)
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-set
  set(name, value = null) {
    if (value === null) this._params.delete(name)
    else this._params.set(name, [value])

    this._update()
  }

  toString() {
    return this._serialize()
  }

  toJSON() {
    return [...this]
  }

  *[Symbol.iterator]() {
    for (const [name, values] of this._params) {
      for (const value of values) yield [name, value]
    }
  }

  [Symbol.for('bare.inspect')]() {
    const object = {
      __proto__: { constructor: URLSearchParams }
    }

    for (const [name, values] of this._params) {
      if (values.length === 1) object[name] = values[0]
      else object[name] = values
    }

    return object
  }

  // https://url.spec.whatwg.org/#concept-urlsearchparams-update
  _update() {
    const url = urls.get(this)

    if (url === undefined) return

    url.search = this._serialize()
  }

  // https://url.spec.whatwg.org/#concept-urlencoded-parser
  _parse(input) {
    const params = new Map()

    this._params = params

    const len = input.length

    let start = input.charCodeAt(0) === 0x3f /* ? */ ? 1 : 0

    while (start < len) {
      let end = input.indexOf('&', start)
      if (end === -1) end = len

      if (end !== start) {
        let split = input.indexOf('=', start)
        if (split === -1 || split > end) split = end

        const name = decode(input.slice(start, split))
        const value = split === end ? '' : decode(input.slice(split + 1, end))

        const list = params.get(name)

        if (list === undefined) params.set(name, [value])
        else list.push(value)
      }

      start = end + 1
    }
  }

  // https://url.spec.whatwg.org/#concept-urlencoded-serializer
  _serialize() {
    let result = ''
    let separator = ''

    for (const [name, values] of this._params) {
      // The name is shared by all of its values, so it is only encoded once.
      const encoded = encode(String(name))

      for (const value of values) {
        result += separator + encoded + '=' + encode(String(value))
        separator = '&'
      }
    }

    return result
  }
}

module.exports = exports = URLSearchParams

exports.isURLSearchParams = function isURLSearchParams(value) {
  if (value instanceof URLSearchParams) return true

  return typeof value === 'object' && value !== null && value[kind] === URLSearchParams[kind]
}

// https://url.spec.whatwg.org/#concept-urlencoded-byte-serializer
//
// Everything except ASCII alphanumerics and `*-._` is percent-encoded, and a
// space becomes `+` rather than `%20`. Names and values usually consist entirely
// of characters that are left alone, so a component is tested as a whole before
// any of it is rewritten.
const unencoded = /^[\w*.-]*$/

// As above, but allowing spaces, which need nothing more than turning into `+`.
// Spaces are by far the most common reason for a component to need rewriting at
// all, so recognizing them here spares those components a trip through
// encodeURIComponent().
const spaced = /^[\w*. -]*$/

// The characters that encodeURIComponent() leaves alone but the urlencoded byte
// serializer does not. Two patterns are needed because a global regular
// expression cannot be shared between test() and replace(), as test() advances
// its lastIndex.
const extra = /[!'()~]/
const extraAll = /[!'()~]/g

const escapes = {
  '!': '%21',
  "'": '%27',
  '(': '%28',
  ')': '%29',
  '~': '%7E'
}

// A surrogate pair, or a surrogate that is not part of one and so encodes no
// scalar value. Pairs are matched first so that only the capture group can hold
// a lone surrogate; a lookbehind would say this more directly but isn't
// supported by every engine.
const lone = /[\ud800-\udbff][\udc00-\udfff]|([\ud800-\udbff]|[\udc00-\udfff])/g

function encode(component) {
  if (unencoded.test(component)) return component

  if (spaced.test(component)) return component.replaceAll(' ', '+')

  let encoded

  try {
    encoded = encodeURIComponent(component)
  } catch {
    // encodeURIComponent() rejects lone surrogates, whereas the UTF-8 encoder the
    // serializer is defined in terms of replaces them with U+FFFD.
    encoded = encodeURIComponent(
      component.replace(lone, (match, single) => (single === undefined ? match : '\ufffd'))
    )
  }

  if (encoded.includes('%20')) encoded = encoded.replaceAll('%20', '+')

  if (extra.test(encoded)) encoded = encoded.replace(extraAll, (match) => escapes[match])

  return encoded
}

// https://url.spec.whatwg.org/#percent-decode-after-encoding
function decode(component) {
  if (component.indexOf('+') !== -1) component = component.replaceAll('+', ' ')

  if (component.indexOf('%') === -1) return component

  return decodeURIComponent(component)
}

},{}],51:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],52:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":51,"buffer":52,"ieee754":56}],53:[function(require,module,exports){
module.exports = require('bare-events')

},{"bare-events":9}],54:[function(require,module,exports){
module.exports = class FixedFIFO {
  constructor (hwm) {
    if (!(hwm > 0) || ((hwm - 1) & hwm) !== 0) throw new Error('Max size for a FixedFIFO should be a power of two')
    this.buffer = new Array(hwm)
    this.mask = hwm - 1
    this.top = 0
    this.btm = 0
    this.next = null
  }

  clear () {
    this.top = this.btm = 0
    this.next = null
    this.buffer.fill(undefined)
  }

  push (data) {
    if (this.buffer[this.top] !== undefined) return false
    this.buffer[this.top] = data
    this.top = (this.top + 1) & this.mask
    return true
  }

  shift () {
    const last = this.buffer[this.btm]
    if (last === undefined) return undefined
    this.buffer[this.btm] = undefined
    this.btm = (this.btm + 1) & this.mask
    return last
  }

  peek () {
    return this.buffer[this.btm]
  }

  isEmpty () {
    return this.buffer[this.btm] === undefined
  }
}

},{}],55:[function(require,module,exports){
const FixedFIFO = require('./fixed-size')

module.exports = class FastFIFO {
  constructor (hwm) {
    this.hwm = hwm || 16
    this.head = new FixedFIFO(this.hwm)
    this.tail = this.head
    this.length = 0
  }

  clear () {
    this.head = this.tail
    this.head.clear()
    this.length = 0
  }

  push (val) {
    this.length++
    if (!this.head.push(val)) {
      const prev = this.head
      this.head = prev.next = new FixedFIFO(2 * this.head.buffer.length)
      this.head.push(val)
    }
  }

  shift () {
    if (this.length !== 0) this.length--
    const val = this.tail.shift()
    if (val === undefined && this.tail.next) {
      const next = this.tail.next
      this.tail.next = null
      this.tail = next
      return this.tail.shift()
    }

    return val
  }

  peek () {
    const val = this.tail.peek()
    if (val === undefined && this.tail.next) return this.tail.next.peek()
    return val
  }

  isEmpty () {
    return this.length === 0
  }
}

},{"./fixed-size":54}],56:[function(require,module,exports){
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],57:[function(require,module,exports){
(function (global){(function (){
const { EventEmitter } = require('events-universal')
const FIFO = require('fast-fifo')
const TextDecoder = require('text-decoder')

const StreamError = require('./lib/errors.js')

// if we do a future major, expect queue microtask to be there always, for now a bit defensive
const qmt =
  typeof queueMicrotask === 'undefined' ? (fn) => global.process.nextTick(fn) : queueMicrotask

// 29 bits used total (4 from shared, 14 from read, and 11 from write)
const MAX = (1 << 29) - 1

// Shared state
const OPENING = 0b0001
const PREDESTROYING = 0b0010
const DESTROYING = 0b0100
const DESTROYED = 0b1000

const NOT_OPENING = MAX ^ OPENING
const NOT_PREDESTROYING = MAX ^ PREDESTROYING

// Read state (4 bit offset from shared state)
const READ_ACTIVE = 0b00000000000001 << 4
const READ_UPDATING = 0b00000000000010 << 4
const READ_PRIMARY = 0b00000000000100 << 4
const READ_QUEUED = 0b00000000001000 << 4
const READ_RESUMED = 0b00000000010000 << 4
const READ_PIPE_DRAINED = 0b00000000100000 << 4
const READ_ENDING = 0b00000001000000 << 4
const READ_EMIT_DATA = 0b00000010000000 << 4
const READ_EMIT_READABLE = 0b00000100000000 << 4
const READ_EMITTED_READABLE = 0b00001000000000 << 4
const READ_DONE = 0b00010000000000 << 4
const READ_NEXT_TICK = 0b00100000000000 << 4
const READ_NEEDS_PUSH = 0b01000000000000 << 4
const READ_READ_AHEAD = 0b10000000000000 << 4

// Combined read state
const READ_FLOWING = READ_RESUMED | READ_PIPE_DRAINED
const READ_ACTIVE_AND_NEEDS_PUSH = READ_ACTIVE | READ_NEEDS_PUSH
const READ_PRIMARY_AND_ACTIVE = READ_PRIMARY | READ_ACTIVE
const READ_EMIT_READABLE_AND_QUEUED = READ_EMIT_READABLE | READ_QUEUED
const READ_RESUMED_READ_AHEAD = READ_RESUMED | READ_READ_AHEAD

const READ_NOT_ACTIVE = MAX ^ READ_ACTIVE
const READ_NON_PRIMARY = MAX ^ READ_PRIMARY
const READ_NON_PRIMARY_AND_PUSHED = MAX ^ (READ_PRIMARY | READ_NEEDS_PUSH)
const READ_PUSHED = MAX ^ READ_NEEDS_PUSH
const READ_PAUSED = MAX ^ READ_RESUMED
const READ_NOT_QUEUED = MAX ^ (READ_QUEUED | READ_EMITTED_READABLE)
const READ_NOT_ENDING = MAX ^ READ_ENDING
const READ_PIPE_NOT_DRAINED = MAX ^ READ_FLOWING
const READ_NOT_NEXT_TICK = MAX ^ READ_NEXT_TICK
const READ_NOT_UPDATING = MAX ^ READ_UPDATING
const READ_NO_READ_AHEAD = MAX ^ READ_READ_AHEAD
const READ_PAUSED_NO_READ_AHEAD = MAX ^ READ_RESUMED_READ_AHEAD

// Write state (18 bit offset, 4 bit offset from shared state and 14 from read state)
const WRITE_ACTIVE = 0b00000000001 << 18
const WRITE_UPDATING = 0b00000000010 << 18
const WRITE_PRIMARY = 0b00000000100 << 18
const WRITE_QUEUED = 0b00000001000 << 18
const WRITE_UNDRAINED = 0b00000010000 << 18
const WRITE_DONE = 0b00000100000 << 18
const WRITE_EMIT_DRAIN = 0b00001000000 << 18
const WRITE_NEXT_TICK = 0b00010000000 << 18
const WRITE_WRITING = 0b00100000000 << 18
const WRITE_FINISHING = 0b01000000000 << 18
const WRITE_CORKED = 0b10000000000 << 18

const WRITE_NOT_ACTIVE = MAX ^ (WRITE_ACTIVE | WRITE_WRITING)
const WRITE_NON_PRIMARY = MAX ^ WRITE_PRIMARY
const WRITE_NOT_FINISHING = MAX ^ (WRITE_ACTIVE | WRITE_FINISHING)
const WRITE_DRAINED = MAX ^ WRITE_UNDRAINED
const WRITE_NOT_QUEUED = MAX ^ WRITE_QUEUED
const WRITE_NOT_NEXT_TICK = MAX ^ WRITE_NEXT_TICK
const WRITE_NOT_UPDATING = MAX ^ WRITE_UPDATING
const WRITE_NOT_CORKED = MAX ^ WRITE_CORKED

// Combined shared state
const ACTIVE = READ_ACTIVE | WRITE_ACTIVE
const NOT_ACTIVE = MAX ^ ACTIVE
const DONE = READ_DONE | WRITE_DONE
const DESTROY_STATUS = DESTROYING | DESTROYED | PREDESTROYING
const OPEN_STATUS = DESTROY_STATUS | OPENING
const AUTO_DESTROY = DESTROY_STATUS | DONE
const NON_PRIMARY = WRITE_NON_PRIMARY & READ_NON_PRIMARY
const ACTIVE_OR_TICKING = WRITE_NEXT_TICK | READ_NEXT_TICK
const TICKING = ACTIVE_OR_TICKING & NOT_ACTIVE
const IS_OPENING = OPEN_STATUS | TICKING

// Combined shared state and read state
const READ_PRIMARY_STATUS = OPEN_STATUS | READ_ENDING | READ_DONE
const READ_STATUS = OPEN_STATUS | READ_DONE | READ_QUEUED
const READ_ENDING_STATUS = OPEN_STATUS | READ_ENDING | READ_QUEUED
const READ_READABLE_STATUS = OPEN_STATUS | READ_EMIT_READABLE | READ_QUEUED | READ_EMITTED_READABLE
const SHOULD_NOT_READ =
  OPEN_STATUS | READ_ACTIVE | READ_ENDING | READ_DONE | READ_NEEDS_PUSH | READ_READ_AHEAD
const READ_BACKPRESSURE_STATUS = DESTROY_STATUS | READ_ENDING | READ_DONE
const READ_UPDATE_SYNC_STATUS = READ_UPDATING | OPEN_STATUS | READ_NEXT_TICK | READ_PRIMARY
const READ_NEXT_TICK_OR_OPENING = READ_NEXT_TICK | OPENING

// Combined write state
const WRITE_PRIMARY_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_DONE
const WRITE_QUEUED_AND_UNDRAINED = WRITE_QUEUED | WRITE_UNDRAINED
const WRITE_QUEUED_AND_ACTIVE = WRITE_QUEUED | WRITE_ACTIVE
const WRITE_DRAIN_STATUS = WRITE_QUEUED | WRITE_UNDRAINED | OPEN_STATUS | WRITE_ACTIVE
const WRITE_STATUS = OPEN_STATUS | WRITE_ACTIVE | WRITE_QUEUED | WRITE_CORKED
const WRITE_PRIMARY_AND_ACTIVE = WRITE_PRIMARY | WRITE_ACTIVE
const WRITE_ACTIVE_AND_WRITING = WRITE_ACTIVE | WRITE_WRITING
const WRITE_FINISHING_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_QUEUED_AND_ACTIVE | WRITE_DONE
const WRITE_BACKPRESSURE_STATUS = WRITE_UNDRAINED | DESTROY_STATUS | WRITE_FINISHING | WRITE_DONE
const WRITE_UPDATE_SYNC_STATUS = WRITE_UPDATING | OPEN_STATUS | WRITE_NEXT_TICK | WRITE_PRIMARY
const WRITE_DROP_DATA = WRITE_FINISHING | WRITE_DONE | DESTROY_STATUS

const asyncIterator = Symbol.asyncIterator || Symbol('asyncIterator')

class WritableState {
  constructor(
    stream,
    { highWaterMark = 16384, map = null, mapWritable, byteLength, byteLengthWritable } = {}
  ) {
    this.stream = stream
    this.queue = new FIFO()
    this.highWaterMark = highWaterMark
    this.buffered = 0
    this.error = null
    this.pipeline = null
    this.drains = null // if we add more seldomly used helpers we might them into a subobject so its a single ptr
    this.byteLength = byteLengthWritable || byteLength || defaultByteLength
    this.map = mapWritable || map
    this.afterWrite = afterWrite.bind(this)
    this.afterUpdateNextTick = updateWriteNT.bind(this)
  }

  get ending() {
    return (this.stream._duplexState & WRITE_FINISHING) !== 0
  }

  get ended() {
    return (this.stream._duplexState & WRITE_DONE) !== 0
  }

  push(data) {
    if ((this.stream._duplexState & WRITE_DROP_DATA) !== 0) return false
    if (this.map !== null) data = this.map(data)

    this.buffered += this.byteLength(data)
    this.queue.push(data)

    if (this.buffered < this.highWaterMark) {
      this.stream._duplexState |= WRITE_QUEUED
      return true
    }

    this.stream._duplexState |= WRITE_QUEUED_AND_UNDRAINED
    return false
  }

  shift() {
    const data = this.queue.shift()

    this.buffered -= this.byteLength(data)
    if (this.buffered === 0) this.stream._duplexState &= WRITE_NOT_QUEUED

    return data
  }

  end(data) {
    if (typeof data === 'function') {
      this.stream.once('finish', data)
    } else if (data !== undefined && data !== null) {
      this.push(data)
    }

    this.stream._duplexState = (this.stream._duplexState | WRITE_FINISHING) & WRITE_NON_PRIMARY
  }

  autoBatch(data, cb) {
    const buffer = []
    const stream = this.stream

    buffer.push(data)
    while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED_AND_ACTIVE) {
      buffer.push(stream._writableState.shift())
    }

    if ((stream._duplexState & OPEN_STATUS) !== 0) return cb(null)
    stream._writev(buffer, cb)
  }

  update() {
    const stream = this.stream

    stream._duplexState |= WRITE_UPDATING

    do {
      while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED) {
        const data = this.shift()
        stream._duplexState |= WRITE_ACTIVE_AND_WRITING
        stream._write(data, this.afterWrite)
      }

      if ((stream._duplexState & WRITE_PRIMARY_AND_ACTIVE) === 0) this.updateNonPrimary()
    } while (this.continueUpdate() === true)

    stream._duplexState &= WRITE_NOT_UPDATING
  }

  updateNonPrimary() {
    const stream = this.stream

    if ((stream._duplexState & WRITE_FINISHING_STATUS) === WRITE_FINISHING) {
      stream._duplexState = stream._duplexState | WRITE_ACTIVE
      stream._final(afterFinal.bind(this))
      return
    }

    if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
      if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
        stream._duplexState |= ACTIVE
        stream._destroy(afterDestroy.bind(this))
      }
      return
    }

    if ((stream._duplexState & IS_OPENING) === OPENING) {
      stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING
      stream._open(afterOpen.bind(this))
    }
  }

  continueUpdate() {
    if ((this.stream._duplexState & WRITE_NEXT_TICK) === 0) return false
    this.stream._duplexState &= WRITE_NOT_NEXT_TICK
    return true
  }

  updateCallback() {
    if ((this.stream._duplexState & WRITE_UPDATE_SYNC_STATUS) === WRITE_PRIMARY) {
      this.update()
    } else {
      this.updateNextTick()
    }
  }

  updateNextTick() {
    if ((this.stream._duplexState & WRITE_NEXT_TICK) !== 0) return
    this.stream._duplexState |= WRITE_NEXT_TICK
    if ((this.stream._duplexState & WRITE_UPDATING) === 0) qmt(this.afterUpdateNextTick)
  }
}

class ReadableState {
  constructor(
    stream,
    { highWaterMark = 16384, map = null, mapReadable, byteLength, byteLengthReadable } = {}
  ) {
    this.stream = stream
    this.queue = new FIFO()
    this.highWaterMark = highWaterMark === 0 ? 1 : highWaterMark
    this.buffered = 0
    this.readAhead = highWaterMark > 0
    this.error = null
    this.pipeline = null
    this.byteLength = byteLengthReadable || byteLength || defaultByteLength
    this.map = mapReadable || map
    this.pipeTo = null
    this.afterRead = afterRead.bind(this)
    this.afterUpdateNextTick = updateReadNT.bind(this)
  }

  get ending() {
    return (this.stream._duplexState & READ_ENDING) !== 0
  }

  get ended() {
    return (this.stream._duplexState & READ_DONE) !== 0
  }

  pipe(pipeTo, cb) {
    if (this.pipeTo !== null) throw StreamError.BAD_ARGUMENT('Can only pipe to one destination')
    if (typeof cb !== 'function') cb = null

    this.stream._duplexState |= READ_PIPE_DRAINED
    this.pipeTo = pipeTo
    this.pipeline = new Pipeline(this.stream, pipeTo, cb)

    if (cb) this.stream.on('error', noop) // We already error handle this so supress crashes

    if (isStreamx(pipeTo)) {
      pipeTo._writableState.pipeline = this.pipeline
      if (cb) pipeTo.on('error', noop) // We already error handle this so supress crashes
      pipeTo.on('finish', this.pipeline.finished.bind(this.pipeline)) // TODO: just call finished from pipeTo itself
    } else {
      const onerror = this.pipeline.done.bind(this.pipeline, pipeTo)
      const onclose = this.pipeline.done.bind(this.pipeline, pipeTo, null) // onclose has a weird bool arg
      pipeTo.on('error', onerror)
      pipeTo.on('close', onclose)
      pipeTo.on('finish', this.pipeline.finished.bind(this.pipeline))
    }

    pipeTo.on('drain', afterDrain.bind(this))
    this.stream.emit('piping', pipeTo)
    pipeTo.emit('pipe', this.stream)
  }

  push(data) {
    const stream = this.stream

    if (data === null) {
      this.highWaterMark = 0
      stream._duplexState = (stream._duplexState | READ_ENDING) & READ_NON_PRIMARY_AND_PUSHED
      return false
    }

    if (this.map !== null) {
      data = this.map(data)
      if (data === null) {
        stream._duplexState &= READ_PUSHED
        return this.buffered < this.highWaterMark
      }
    }

    this.buffered += this.byteLength(data)
    this.queue.push(data)

    stream._duplexState = (stream._duplexState | READ_QUEUED) & READ_PUSHED

    return this.buffered < this.highWaterMark
  }

  shift() {
    const data = this.queue.shift()

    this.buffered -= this.byteLength(data)
    if (this.buffered === 0) {
      this.stream._duplexState &= READ_NOT_QUEUED
    }

    return data
  }

  unshift(data) {
    const pending = [this.map !== null ? this.map(data) : data]
    while (this.buffered > 0) pending.push(this.shift())

    for (let i = 0; i < pending.length - 1; i++) {
      const data = pending[i]
      this.buffered += this.byteLength(data)
      this.queue.push(data)
    }

    this.push(pending[pending.length - 1])
  }

  read() {
    const stream = this.stream

    if ((stream._duplexState & READ_STATUS) === READ_QUEUED) {
      const data = this.shift()

      if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
        stream._duplexState &= READ_PIPE_NOT_DRAINED
      }

      if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
        stream.emit('data', data)
      }

      return data
    }

    if (this.readAhead === false) {
      stream._duplexState |= READ_READ_AHEAD
      this.updateNextTick()
    }

    return null
  }

  drain() {
    const stream = this.stream

    while (
      (stream._duplexState & READ_STATUS) === READ_QUEUED &&
      (stream._duplexState & READ_FLOWING) !== 0
    ) {
      const data = this.shift()

      if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
        stream._duplexState &= READ_PIPE_NOT_DRAINED
      }

      if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
        stream.emit('data', data)
      }
    }
  }

  update() {
    const stream = this.stream

    stream._duplexState |= READ_UPDATING

    do {
      this.drain()

      while (
        this.buffered < this.highWaterMark &&
        (stream._duplexState & SHOULD_NOT_READ) === READ_READ_AHEAD
      ) {
        stream._duplexState |= READ_ACTIVE_AND_NEEDS_PUSH
        stream._read(this.afterRead)
        this.drain()
      }

      if ((stream._duplexState & READ_READABLE_STATUS) === READ_EMIT_READABLE_AND_QUEUED) {
        stream._duplexState |= READ_EMITTED_READABLE
        stream.emit('readable')
      }

      if ((stream._duplexState & READ_PRIMARY_AND_ACTIVE) === 0) {
        this.updateNonPrimary()
      }
    } while (this.continueUpdate() === true)

    stream._duplexState &= READ_NOT_UPDATING
  }

  updateNonPrimary() {
    const stream = this.stream

    if ((stream._duplexState & READ_ENDING_STATUS) === READ_ENDING) {
      stream._duplexState = (stream._duplexState | READ_DONE) & READ_NOT_ENDING
      stream.emit('end')

      if ((stream._duplexState & AUTO_DESTROY) === DONE) {
        stream._duplexState |= DESTROYING
      }

      if (this.pipeTo !== null) {
        this.pipeTo.end()
      }
    }

    if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
      if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
        stream._duplexState |= ACTIVE
        stream._destroy(afterDestroy.bind(this))
      }
      return
    }

    if ((stream._duplexState & IS_OPENING) === OPENING) {
      stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING
      stream._open(afterOpen.bind(this))
    }
  }

  continueUpdate() {
    if ((this.stream._duplexState & READ_NEXT_TICK) === 0) return false
    this.stream._duplexState &= READ_NOT_NEXT_TICK
    return true
  }

  updateCallback() {
    if ((this.stream._duplexState & READ_UPDATE_SYNC_STATUS) === READ_PRIMARY) {
      this.update()
    } else {
      this.updateNextTick()
    }
  }

  updateNextTickIfOpen() {
    if ((this.stream._duplexState & READ_NEXT_TICK_OR_OPENING) !== 0) return
    this.stream._duplexState |= READ_NEXT_TICK
    if ((this.stream._duplexState & READ_UPDATING) === 0) qmt(this.afterUpdateNextTick)
  }

  updateNextTick() {
    if ((this.stream._duplexState & READ_NEXT_TICK) !== 0) return
    this.stream._duplexState |= READ_NEXT_TICK
    if ((this.stream._duplexState & READ_UPDATING) === 0) qmt(this.afterUpdateNextTick)
  }
}

class TransformState {
  constructor(stream) {
    this.data = null
    this.afterTransform = afterTransform.bind(stream)
    this.afterFinal = null
  }
}

class Pipeline {
  constructor(src, dst, cb) {
    this.from = src
    this.to = dst
    this.afterPipe = cb
    this.error = null
    this.pipeToFinished = false
  }

  finished() {
    this.pipeToFinished = true
  }

  done(stream, err) {
    if (err) this.error = err

    if (stream === this.to) {
      this.to = null

      if (this.from !== null) {
        if ((this.from._duplexState & READ_DONE) === 0 || !this.pipeToFinished) {
          this.from.destroy(this.error || StreamError.PREMATURE_CLOSE('Writable stream closed'))
        }
        return
      }
    }

    if (stream === this.from) {
      this.from = null

      if (this.to !== null) {
        if ((stream._duplexState & READ_DONE) === 0) {
          this.to.destroy(this.error || StreamError.PREMATURE_CLOSE('Readable stream closed'))
        }
        return
      }
    }

    if (this.afterPipe !== null) this.afterPipe(this.error)
    this.to = this.from = this.afterPipe = null
  }
}

function afterDrain() {
  this.stream._duplexState |= READ_PIPE_DRAINED
  this.updateCallback()
}

function afterFinal(err) {
  const stream = this.stream
  if (err) stream.destroy(err)

  if ((stream._duplexState & DESTROY_STATUS) === 0) {
    stream._duplexState |= WRITE_DONE
    stream.emit('finish')
  }

  if ((stream._duplexState & AUTO_DESTROY) === DONE) {
    stream._duplexState |= DESTROYING
  }

  stream._duplexState &= WRITE_NOT_FINISHING

  // no need to wait the extra tick here, so we short circuit that
  if ((stream._duplexState & WRITE_UPDATING) === 0) {
    this.update()
  } else {
    this.updateNextTick()
  }
}

function afterDestroy(err) {
  const stream = this.stream

  if (!err && !StreamError.isStreamDestroyed(this.error)) err = this.error
  if (err) stream.emit('error', err)

  stream._duplexState |= DESTROYED
  stream.emit('close')

  const rs = stream._readableState
  const ws = stream._writableState

  if (rs !== null && rs.pipeline !== null) {
    rs.pipeline.done(stream, err)
  }

  if (ws !== null) {
    while (ws.drains !== null && ws.drains.length > 0) {
      ws.drains.shift().resolve(false)
    }

    if (ws.pipeline !== null) {
      ws.pipeline.done(stream, err)
    }
  }
}

function afterWrite(err) {
  const stream = this.stream

  if (err) stream.destroy(err)
  stream._duplexState &= WRITE_NOT_ACTIVE

  if (this.drains !== null) tickDrains(this.drains)

  if ((stream._duplexState & WRITE_DRAIN_STATUS) === WRITE_UNDRAINED) {
    stream._duplexState &= WRITE_DRAINED

    if ((stream._duplexState & WRITE_EMIT_DRAIN) === WRITE_EMIT_DRAIN) {
      stream.emit('drain')
    }
  }

  this.updateCallback()
}

function afterRead(err) {
  if (err) this.stream.destroy(err)
  this.stream._duplexState &= READ_NOT_ACTIVE

  if (this.readAhead === false && (this.stream._duplexState & READ_RESUMED) === 0) {
    this.stream._duplexState &= READ_NO_READ_AHEAD
  }

  this.updateCallback()
}

function updateReadNT() {
  if ((this.stream._duplexState & READ_UPDATING) === 0) {
    this.stream._duplexState &= READ_NOT_NEXT_TICK
    this.update()
  }
}

function updateWriteNT() {
  if ((this.stream._duplexState & WRITE_UPDATING) === 0) {
    this.stream._duplexState &= WRITE_NOT_NEXT_TICK
    this.update()
  }
}

function tickDrains(drains) {
  for (let i = 0; i < drains.length; i++) {
    // drains.writes are monotonic, so if one is 0 its always the first one
    if (--drains[i].writes === 0) {
      drains.shift().resolve(true)
      i--
    }
  }
}

function afterOpen(err) {
  const stream = this.stream

  if (err) stream.destroy(err)

  if ((stream._duplexState & DESTROYING) === 0) {
    if ((stream._duplexState & READ_PRIMARY_STATUS) === 0) {
      stream._duplexState |= READ_PRIMARY
    }

    if ((stream._duplexState & WRITE_PRIMARY_STATUS) === 0) {
      stream._duplexState |= WRITE_PRIMARY
    }

    stream.emit('open')
  }

  stream._duplexState &= NOT_ACTIVE

  if (stream._writableState !== null) {
    stream._writableState.updateCallback()
  }

  if (stream._readableState !== null) {
    stream._readableState.updateCallback()
  }
}

function afterTransform(err, data) {
  if (data !== undefined && data !== null) this.push(data)
  this._writableState.afterWrite(err)
}

function newListener(name) {
  if (this._readableState !== null) {
    if (name === 'data') {
      this._duplexState |= READ_EMIT_DATA | READ_RESUMED_READ_AHEAD
      this._readableState.updateNextTick()
    }
    if (name === 'readable') {
      this._duplexState |= READ_EMIT_READABLE
      this._readableState.updateNextTick()
    }
  }

  if (this._writableState !== null) {
    if (name === 'drain') {
      this._duplexState |= WRITE_EMIT_DRAIN
      this._writableState.updateNextTick()
    }
  }
}

class Stream extends EventEmitter {
  constructor(opts) {
    super()

    this._duplexState = 0
    this._readableState = null
    this._writableState = null

    if (opts) {
      if (opts.open) this._open = opts.open
      if (opts.destroy) this._destroy = opts.destroy
      if (opts.predestroy) this._predestroy = opts.predestroy
      if (opts.signal) opts.signal.addEventListener('abort', abort.bind(this))
    }

    this.on('newListener', newListener)
  }

  _open(cb) {
    cb(null)
  }

  _destroy(cb) {
    cb(null)
  }

  _predestroy() {
    // does nothing
  }

  get readable() {
    return this._readableState !== null ? true : undefined
  }

  get writable() {
    return this._writableState !== null ? true : undefined
  }

  get destroyed() {
    return (this._duplexState & DESTROYED) !== 0
  }

  get destroying() {
    return (this._duplexState & DESTROY_STATUS) !== 0
  }

  destroy(err) {
    if ((this._duplexState & DESTROY_STATUS) === 0) {
      if (!err) err = StreamError.STREAM_DESTROYED()
      this._duplexState = (this._duplexState | DESTROYING) & NON_PRIMARY

      if (this._readableState !== null) {
        this._readableState.highWaterMark = 0
        this._readableState.error = err
      }

      if (this._writableState !== null) {
        this._writableState.highWaterMark = 0
        this._writableState.error = err
      }

      this._duplexState |= PREDESTROYING
      this._predestroy()
      this._duplexState &= NOT_PREDESTROYING

      if (this._readableState !== null) {
        this._readableState.updateNextTick()
      }

      if (this._writableState !== null) {
        this._writableState.updateNextTick()
      }
    }
  }
}

class Readable extends Stream {
  constructor(opts) {
    super(opts)

    this._duplexState |= OPENING | WRITE_DONE | READ_READ_AHEAD
    this._readableState = new ReadableState(this, opts)

    if (opts) {
      if (this._readableState.readAhead === false) this._duplexState &= READ_NO_READ_AHEAD
      if (opts.read) this._read = opts.read
      if (opts.eagerOpen) this._readableState.updateNextTick()
      if (opts.encoding) this.setEncoding(opts.encoding)
    }
  }

  static deferred(fn, opts) {
    const out = new PassThrough(opts)

    fn()
      .then((src) => {
        if (src === null) return out.end()
        if (out.destroying) return
        pipeline(src, out, noop)
      })
      .catch((err) => out.destroy(err))

    return out
  }

  setEncoding(encoding) {
    const dec = new TextDecoder(encoding)
    const map = this._readableState.map || echo
    this._readableState.map = mapOrSkip
    return this

    function mapOrSkip(data) {
      const next = dec.push(data)
      return next === '' && (data.byteLength !== 0 || dec.remaining > 0) ? null : map(next)
    }
  }

  _read(cb) {
    cb(null)
  }

  pipe(dest, cb) {
    this._readableState.updateNextTick()
    this._readableState.pipe(dest, cb)
    return dest
  }

  read() {
    this._readableState.updateNextTick()
    return this._readableState.read()
  }

  push(data) {
    this._readableState.updateNextTickIfOpen()
    return this._readableState.push(data)
  }

  unshift(data) {
    this._readableState.updateNextTickIfOpen()
    return this._readableState.unshift(data)
  }

  resume() {
    this._duplexState |= READ_RESUMED_READ_AHEAD
    this._readableState.updateNextTick()
    return this
  }

  pause() {
    this._duplexState &=
      this._readableState.readAhead === false ? READ_PAUSED_NO_READ_AHEAD : READ_PAUSED
    return this
  }

  static _fromAsyncIterator(ite, opts) {
    let destroy

    const rs = new Readable({
      ...opts,
      read(cb) {
        ite.next().then(push).then(cb.bind(null, null)).catch(cb)
      },
      predestroy() {
        destroy = ite.return()
      },
      destroy(cb) {
        if (!destroy) return cb(null)
        destroy.then(cb.bind(null, null)).catch(cb)
      }
    })

    return rs

    function push(data) {
      if (data.done) rs.push(null)
      else rs.push(data.value)
    }
  }

  static from(data, opts) {
    if (isReadStreamx(data)) return data
    if (data[asyncIterator]) return this._fromAsyncIterator(data[asyncIterator](), opts)
    if (!Array.isArray(data)) data = data === undefined ? [] : [data]

    let i = 0
    return new Readable({
      ...opts,
      read(cb) {
        this.push(i === data.length ? null : data[i++])
        cb(null)
      }
    })
  }

  static isBackpressured(rs) {
    return (
      (rs._duplexState & READ_BACKPRESSURE_STATUS) !== 0 ||
      rs._readableState.buffered >= rs._readableState.highWaterMark
    )
  }

  static isPaused(rs) {
    return (rs._duplexState & READ_RESUMED) === 0
  }

  [asyncIterator]() {
    const stream = this

    let error = null
    let promiseResolve = null
    let promiseReject = null

    this.on('error', (err) => {
      error = err
    })
    this.on('readable', onreadable)
    this.on('close', onclose)

    return {
      [asyncIterator]() {
        return this
      },
      next() {
        return new Promise(function (resolve, reject) {
          promiseResolve = resolve
          promiseReject = reject
          const data = stream.read()
          if (data !== null) ondata(data)
          else if ((stream._duplexState & DESTROYED) !== 0) ondata(null)
        })
      },
      return() {
        return destroy(null)
      },
      throw(err) {
        return destroy(err)
      }
    }

    function onreadable() {
      if (promiseResolve !== null) ondata(stream.read())
    }

    function onclose() {
      if (promiseResolve !== null) ondata(null)
    }

    function ondata(data) {
      if (promiseReject === null) return
      if (error) {
        promiseReject(error)
      } else if (data === null && (stream._duplexState & READ_DONE) === 0) {
        promiseReject(StreamError.STREAM_DESTROYED())
      } else {
        promiseResolve({ value: data, done: data === null })
      }
      promiseReject = promiseResolve = null
    }

    function destroy(err) {
      stream.destroy(err)
      return new Promise((resolve, reject) => {
        if (stream._duplexState & DESTROYED) return resolve({ value: undefined, done: true })
        stream.once('close', function () {
          if (err) reject(err)
          else resolve({ value: undefined, done: true })
        })
      })
    }
  }
}

class Writable extends Stream {
  constructor(opts) {
    super(opts)

    this._duplexState |= OPENING | READ_DONE
    this._writableState = new WritableState(this, opts)

    if (opts) {
      if (opts.writev) this._writev = opts.writev
      if (opts.write) this._write = opts.write
      if (opts.final) this._final = opts.final
      if (opts.eagerOpen) this._writableState.updateNextTick()
    }
  }

  cork() {
    this._duplexState |= WRITE_CORKED
  }

  uncork() {
    this._duplexState &= WRITE_NOT_CORKED
    this._writableState.updateNextTick()
  }

  _writev(batch, cb) {
    cb(null)
  }

  _write(data, cb) {
    this._writableState.autoBatch(data, cb)
  }

  _final(cb) {
    cb(null)
  }

  static isBackpressured(ws) {
    return (ws._duplexState & WRITE_BACKPRESSURE_STATUS) !== 0
  }

  static drained(ws) {
    if (ws.destroyed) return Promise.resolve(false)

    const state = ws._writableState
    const pending = isWritev(ws) ? Math.min(1, state.queue.length) : state.queue.length
    const writes = pending + (ws._duplexState & WRITE_WRITING ? 1 : 0)
    if (writes === 0) return Promise.resolve(true)

    if (state.drains === null) state.drains = []
    return new Promise((resolve) => {
      state.drains.push({ writes, resolve })
    })
  }

  write(data) {
    this._writableState.updateNextTick()
    return this._writableState.push(data)
  }

  end(data) {
    this._writableState.updateNextTick()
    this._writableState.end(data)
    return this
  }
}

class Duplex extends Readable {
  // and Writable
  constructor(opts) {
    super(opts)

    this._duplexState = OPENING | (this._duplexState & READ_READ_AHEAD)
    this._writableState = new WritableState(this, opts)

    if (opts) {
      if (opts.writev) this._writev = opts.writev
      if (opts.write) this._write = opts.write
      if (opts.final) this._final = opts.final
    }
  }

  cork() {
    this._duplexState |= WRITE_CORKED
  }

  uncork() {
    this._duplexState &= WRITE_NOT_CORKED
    this._writableState.updateNextTick()
  }

  _writev(batch, cb) {
    cb(null)
  }

  _write(data, cb) {
    this._writableState.autoBatch(data, cb)
  }

  _final(cb) {
    cb(null)
  }

  write(data) {
    this._writableState.updateNextTick()
    return this._writableState.push(data)
  }

  end(data) {
    this._writableState.updateNextTick()
    this._writableState.end(data)
    return this
  }
}

class Transform extends Duplex {
  constructor(opts) {
    super(opts)
    this._transformState = new TransformState(this)

    if (opts) {
      if (opts.transform) this._transform = opts.transform
      if (opts.flush) this._flush = opts.flush
    }
  }

  _write(data, cb) {
    if (this._readableState.buffered >= this._readableState.highWaterMark) {
      this._transformState.data = data
    } else {
      this._transform(data, this._transformState.afterTransform)
    }
  }

  _read(cb) {
    if (this._transformState.data !== null) {
      const data = this._transformState.data
      this._transformState.data = null
      cb(null)
      this._transform(data, this._transformState.afterTransform)
    } else {
      cb(null)
    }
  }

  destroy(err) {
    super.destroy(err)
    if (this._transformState.data !== null) {
      this._transformState.data = null
      this._transformState.afterTransform()
    }
  }

  _transform(data, cb) {
    cb(null, data)
  }

  _flush(cb) {
    cb(null)
  }

  _final(cb) {
    this._transformState.afterFinal = cb
    this._flush(transformAfterFlush.bind(this))
  }
}

class PassThrough extends Transform {}

function transformAfterFlush(err, data) {
  const cb = this._transformState.afterFinal
  if (err) return cb(err)

  if (data !== null && data !== undefined) this.push(data)
  this.push(null)
  cb(null)
}

function pipelinePromise(...streams) {
  return new Promise((resolve, reject) => {
    return pipeline(...streams, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function pipeline(stream, ...streams) {
  const all = Array.isArray(stream) ? [...stream, ...streams] : [stream, ...streams]
  const done = all.length && typeof all[all.length - 1] === 'function' ? all.pop() : null

  if (all.length < 2) throw StreamError.BAD_ARGUMENT('Pipeline requires at least 2 streams')

  let src = all[0]
  let dest = null
  let error = null

  for (let i = 1; i < all.length; i++) {
    dest = all[i]

    if (isStreamx(src)) {
      src.pipe(dest, onerror)
    } else {
      errorHandle(src, true, i > 1, onerror)
      src.pipe(dest)
    }

    src = dest
  }

  if (done) {
    let fin = false

    const autoDestroy =
      isStreamx(dest) || !!(dest._writableState && dest._writableState.autoDestroy)

    dest.on('error', (err) => {
      if (error === null) error = err
    })

    dest.on('finish', () => {
      fin = true
      if (!autoDestroy) done(error)
    })

    if (autoDestroy) {
      dest.on('close', () => done(error || (fin ? null : StreamError.PREMATURE_CLOSE())))
    }
  }

  return dest

  function errorHandle(s, rd, wr, onerror) {
    s.on('error', onerror)
    s.on('close', onclose)

    function onclose() {
      if (rd && s._readableState && !s._readableState.ended) {
        return onerror(StreamError.PREMATURE_CLOSE())
      }
      if (wr && s._writableState && !s._writableState.ended) {
        return onerror(StreamError.PREMATURE_CLOSE())
      }
    }
  }

  function onerror(err) {
    if (!err || error) return
    error = err

    for (const s of all) {
      s.destroy(err)
    }
  }
}

function echo(s) {
  return s
}

function isStream(stream) {
  return !!stream._readableState || !!stream._writableState
}

function isStreamx(stream) {
  return typeof stream._duplexState === 'number' && isStream(stream)
}

function isEnding(stream) {
  return !!stream._readableState && stream._readableState.ending
}

function isEnded(stream) {
  return !!stream._readableState && stream._readableState.ended
}

function isFinishing(stream) {
  return !!stream._writableState && stream._writableState.ending
}

function isFinished(stream) {
  return !!stream._writableState && stream._writableState.ended
}

function getStreamError(stream, opts = {}) {
  const err =
    (stream._readableState && stream._readableState.error) ||
    (stream._writableState && stream._writableState.error)

  // avoid implicit errors by default
  return !opts.all && StreamError.isStreamDestroyed(err) ? null : err
}

function isReadStreamx(stream) {
  return isStreamx(stream) && stream.readable
}

function isDisturbed(stream) {
  return (
    (stream._duplexState & OPENING) !== OPENING ||
    (stream._duplexState & DESTROYING) === DESTROYING ||
    (stream._duplexState & ACTIVE_OR_TICKING) !== 0
  )
}

function isTypedArray(data) {
  return typeof data === 'object' && data !== null && typeof data.byteLength === 'number'
}

function defaultByteLength(data) {
  return isTypedArray(data) ? data.byteLength : 1024
}

function noop() {}

function abort() {
  this.destroy(StreamError.ABORTED())
}

function isWritev(s) {
  return s._writev !== Writable.prototype._writev && s._writev !== Duplex.prototype._writev
}

module.exports = {
  pipeline,
  pipelinePromise,
  isStream,
  isStreamx,
  isEnding,
  isEnded,
  isFinishing,
  isFinished,
  isDisturbed,
  getStreamError,
  Stream,
  Writable,
  Readable,
  Duplex,
  Transform,
  // Export PassThrough for compatibility with Node.js core's stream module
  PassThrough
}

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./lib/errors.js":58,"events-universal":53,"fast-fifo":55,"text-decoder":60}],58:[function(require,module,exports){
module.exports = class StreamError extends Error {
  constructor(msg, code, fn = StreamError) {
    super(msg)

    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  static isStreamDestroyed(err) {
    return err && err.code === 'STREAM_DESTROYED'
  }

  static isPrematureClose(err) {
    return err && err.code === 'PREMATURE_CLOSE'
  }

  static isAborted(err) {
    return err && err.code === 'ABORTED'
  }

  static isBadArgument(err) {
    return err && err.code === 'BAD_ARGUMENT'
  }

  get name() {
    return 'StreamError'
  }

  static STREAM_DESTROYED() {
    return new StreamError('Stream was destroyed', 'STREAM_DESTROYED', StreamError.STREAM_DESTROYED)
  }

  static PREMATURE_CLOSE(msg = 'Premature close') {
    return new StreamError(msg, 'PREMATURE_CLOSE', StreamError.PREMATURE_CLOSE)
  }

  static ABORTED() {
    return new StreamError('Stream aborted', 'ABORTED', StreamError.ABORTED)
  }

  static BAD_ARGUMENT(msg = 'Bad argument') {
    return new StreamError(msg, 'BAD_ARGUMENT', StreamError.BAD_ARGUMENT)
  }
}

},{}],59:[function(require,module,exports){
const { Readable } = require('streamx')

module.exports = function (s, forks = 2) {
  const streams = new Array(forks)
  const status = new Array(forks).fill(true)

  let ended = false

  for (let i = 0; i < forks; i++) {
    streams[i] = new Readable({
      read (cb) {
        const check = !status[i]
        status[i] = true
        if (check && allReadable()) s.resume()
        cb(null)
      }
    })
  }

  s.on('end', function () {
    ended = true
    for (const stream of streams) stream.push(null)
  })

  s.on('error', function (err) {
    for (const stream of streams) stream.destroy(err)
  })

  s.on('close', function () {
    if (ended) return
    for (const stream of streams) stream.destroy()
  })

  s.on('data', function (data) {
    let needsPause = false
    for (let i = 0; i < streams.length; i++) {
      if (!(status[i] = streams[i].push(data))) {
        needsPause = true
      }
    }
    if (needsPause) s.pause()
  })

  return streams

  function allReadable () {
    for (let j = 0; j < status.length; j++) {
      if (!status[j]) return false
    }
    return true
  }
}

},{"streamx":57}],60:[function(require,module,exports){
const PassThroughDecoder = require('./lib/pass-through-decoder')
const UTF8Decoder = require('./lib/utf8-decoder')

module.exports = class TextDecoder {
  constructor(encoding = 'utf8') {
    this.encoding = normalizeEncoding(encoding)

    switch (this.encoding) {
      case 'utf8':
        this.decoder = new UTF8Decoder()
        break
      case 'utf16le':
      case 'base64':
        throw new Error('Unsupported encoding: ' + this.encoding)
      default:
        this.decoder = new PassThroughDecoder(this.encoding)
    }
  }

  get remaining() {
    return this.decoder.remaining
  }

  push(data) {
    if (typeof data === 'string') return data
    return this.decoder.decode(data)
  }

  // For Node.js compatibility
  write(data) {
    return this.push(data)
  }

  end(data) {
    let result = ''
    if (data) result = this.push(data)
    result += this.decoder.flush()
    return result
  }
}

function normalizeEncoding(encoding) {
  encoding = encoding.toLowerCase()

  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return 'utf8'
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return 'utf16le'
    case 'latin1':
    case 'binary':
      return 'latin1'
    case 'base64':
    case 'ascii':
    case 'hex':
      return encoding
    default:
      throw new Error('Unknown encoding: ' + encoding)
  }
}

},{"./lib/pass-through-decoder":61,"./lib/utf8-decoder":62}],61:[function(require,module,exports){
const b4a = require('b4a')

module.exports = class PassThroughDecoder {
  constructor(encoding) {
    this.encoding = encoding
  }

  get remaining() {
    return 0
  }

  decode(data) {
    return b4a.toString(data, this.encoding)
  }

  flush() {
    return ''
  }
}

},{"b4a":5}],62:[function(require,module,exports){
const b4a = require('b4a')

/**
 * https://encoding.spec.whatwg.org/#utf-8-decoder
 */
module.exports = class UTF8Decoder {
  constructor() {
    this._reset()
  }

  get remaining() {
    return this.bytesSeen
  }

  decode(data) {
    if (data.byteLength === 0) return ''

    if (this.bytesNeeded === 0 && trailingIncomplete(data, 0) === 0) {
      this.bytesSeen = trailingBytesSeen(data)
      return b4a.toString(data, 'utf8')
    }

    let result = ''
    let start = 0

    if (this.bytesNeeded > 0) {
      while (start < data.byteLength) {
        const byte = data[start]

        if (byte < this.lowerBoundary || byte > this.upperBoundary) {
          result += '\ufffd'
          this._reset()
          break
        }

        this.lowerBoundary = 0x80
        this.upperBoundary = 0xbf
        this.codePoint = (this.codePoint << 6) | (byte & 0x3f)
        this.bytesSeen++
        start++

        if (this.bytesSeen === this.bytesNeeded) {
          result += String.fromCodePoint(this.codePoint)
          this._reset()
          break
        }
      }

      if (this.bytesNeeded > 0) return result
    }

    const trailing = trailingIncomplete(data, start)
    const end = data.byteLength - trailing

    if (end > start) result += b4a.toString(data, 'utf8', start, end)

    for (let i = end; i < data.byteLength; i++) {
      const byte = data[i]

      if (this.bytesNeeded === 0) {
        if (byte <= 0x7f) {
          this.bytesSeen = 0
          result += String.fromCharCode(byte)
        } else if (byte >= 0xc2 && byte <= 0xdf) {
          this.bytesNeeded = 2
          this.bytesSeen = 1
          this.codePoint = byte & 0x1f
        } else if (byte >= 0xe0 && byte <= 0xef) {
          if (byte === 0xe0) this.lowerBoundary = 0xa0
          else if (byte === 0xed) this.upperBoundary = 0x9f
          this.bytesNeeded = 3
          this.bytesSeen = 1
          this.codePoint = byte & 0xf
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          if (byte === 0xf0) this.lowerBoundary = 0x90
          else if (byte === 0xf4) this.upperBoundary = 0x8f
          this.bytesNeeded = 4
          this.bytesSeen = 1
          this.codePoint = byte & 0x7
        } else {
          this.bytesSeen = 1
          result += '\ufffd'
        }

        continue
      }

      if (byte < this.lowerBoundary || byte > this.upperBoundary) {
        result += '\ufffd'
        i--
        this._reset()

        continue
      }

      this.lowerBoundary = 0x80
      this.upperBoundary = 0xbf

      this.codePoint = (this.codePoint << 6) | (byte & 0x3f)
      this.bytesSeen++

      if (this.bytesSeen === this.bytesNeeded) {
        result += String.fromCodePoint(this.codePoint)
        this._reset()
      }
    }

    return result
  }

  flush() {
    const result = this.bytesNeeded > 0 ? '\ufffd' : ''
    this._reset()
    return result
  }

  _reset() {
    this.codePoint = 0
    this.bytesNeeded = 0
    this.bytesSeen = 0
    this.lowerBoundary = 0x80
    this.upperBoundary = 0xbf
  }
}

function trailingIncomplete(data, start) {
  const len = data.byteLength
  if (len <= start) return 0

  const limit = Math.max(start, len - 4)

  let i = len - 1
  while (i > limit && (data[i] & 0xc0) === 0x80) i--

  if (i < start) return 0

  const byte = data[i]

  let needed
  if (byte <= 0x7f) return 0
  if (byte >= 0xc2 && byte <= 0xdf) needed = 2
  else if (byte >= 0xe0 && byte <= 0xef) needed = 3
  else if (byte >= 0xf0 && byte <= 0xf4) needed = 4
  else return 0

  const available = len - i
  return available < needed ? available : 0
}

function trailingBytesSeen(data) {
  const len = data.byteLength
  if (len === 0) return 0

  const last = data[len - 1]

  if (last <= 0x7f) return 0
  if ((last & 0xc0) !== 0x80) return 1

  const limit = Math.max(0, len - 4)

  let i = len - 2
  while (i >= limit && (data[i] & 0xc0) === 0x80) i--

  if (i < 0) return 1

  const first = data[i]

  let needed
  if (first >= 0xc2 && first <= 0xdf) needed = 2
  else if (first >= 0xe0 && first <= 0xef) needed = 3
  else if (first >= 0xf0 && first <= 0xf4) needed = 4
  else return 1

  if (len - i !== needed) return 1

  if (needed >= 3) {
    const second = data[i + 1]
    if (first === 0xe0 && second < 0xa0) return 1
    if (first === 0xed && second > 0x9f) return 1
    if (first === 0xf0 && second < 0x90) return 1
    if (first === 0xf4 && second > 0x8f) return 1
  }

  return 0
}

},{"b4a":5}]},{},[1]);
