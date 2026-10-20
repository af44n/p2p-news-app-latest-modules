// the browser vault runs here, in a web worker, cuz its opfs storage (rocksdb-native-opfs) only works in workers
// datashell.js in the page talks to it through the remote module
// these have to be set before the requires: a worker has no window / open / alert / reload / setImmediate, and which-runtime reads global.process
globalThis.process = globalThis.process || process
globalThis.window = globalThis // crypto-helpers checks typeof window
globalThis.open = function () {} // identity and identity-networking check globalThis.open for "web"
globalThis.alert = text => self.postMessage({ type: 'alert', data: text }) // a removed device tells the user, the page shows it
self.location.reload = () => self.postMessage({ type: 'reload' }) // and reloads after wiping itself, the page does that
globalThis.setImmediate = globalThis.setImmediate || ((fn, ...args) => setTimeout(fn, 0, ...args)) // hypercore 11 uses it, browsers dont have it
const identity = require('identity')
const remote = require('remote')
const blog_app = require('p2p-news-app')
const { create_app_vault } = require('./datashell')

self.addEventListener('message', start, { once: true }) // the page sends its localStorage and the boot input first

function start (event) {
  const { storage, input } = event.data.data
  globalThis.localStorage = make_storage(storage)
  const vault = identity(input)
  vault.open_app = open_app
  remote.serve(self, vault)

  // same as datashell boot does on cli, plus the news app, which needs the live structures so it runs here too
  async function open_app (app_instance_id, profile_name) {
    const uservault = await vault.user
    if (!uservault.app_state) uservault.app_state = {}
    const app_vault = await create_app_vault(uservault, app_instance_id, profile_name)
    app_vault.news_app = () => blog_app(app_vault)
    return app_vault
  }
}

/***************************************
MAKE STORAGE
a worker has no localStorage, so this one starts with the pages values and sends every write back to the page
***************************************/
function make_storage (data) {
  const api = { getItem, setItem, removeItem, clear }
  return new Proxy(data, { get: get_item, set: set_item })
  function get_item (target, key) { return key in api ? api[key] : target[key] }
  function set_item (target, key, value) { setItem(key, value); return true }
  function getItem (key) { return key in data ? data[key] : null }
  function setItem (key, value) { data[key] = String(value); send_to_page(key, data[key]) }
  function removeItem (key) { delete data[key]; send_to_page(key, null) }
  function clear () { for (const key in data) delete data[key]; send_to_page(null, null) }
}

function send_to_page (key, value) { self.postMessage({ type: 'storage', data: { key, value } }) }
