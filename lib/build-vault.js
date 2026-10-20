// builds vault.bundle.js, the vault worker (lib/vault-worker.js) for the browser.
// esbuild with the module swaps rocksdb-native-opfs needs (its README, "Using it in a browser build")
const esbuild = require('esbuild')
const path = require('path')
const opfs = path.dirname(require.resolve('rocksdb-native-opfs/package.json'))

esbuild.build({
  entryPoints: [path.join(__dirname, 'vault-worker.js')],
  outfile: path.join(__dirname, '..', 'vault.bundle.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  mainFields: ['browser', 'module', 'main'],
  nodePaths: [path.join(__dirname, 'node_modules')], // our own modules in lib/node_modules
  inject: [path.join(opfs, 'browser/globals.js')], // Buffer and process for the hyper modules
  define: { global: 'globalThis' },
  plugins: [browser_swaps()],
  external: ['node:*'],
  logLevel: 'warning'
}).catch(() => process.exit(1))

// rocksdb-native's binding -> opfs, fs and device-file -> its browser versions, path -> path-browserify,
// and get-webrtc -> webrtc-bridge (workers have no webrtc, hyper-webrtc gets its RTCPeerConnection from get-webrtc)
function browser_swaps () {
  return { name: 'browser-swaps', setup }
  function setup (build) {
    build.onResolve({ filter: /^\.\.?\/binding(\.js)?$/ }, args => args.importer.split(path.sep).includes('rocksdb-native') ? { path: path.join(opfs, 'index.js') } : undefined)
    build.onResolve({ filter: /^fs$/ }, () => ({ path: path.join(opfs, 'browser/fs.js') }))
    build.onResolve({ filter: /^device-file$/ }, () => ({ path: path.join(opfs, 'browser/device-file.js') }))
    build.onResolve({ filter: /^path$/ }, () => ({ path: require.resolve('path-browserify') }))
    build.onResolve({ filter: /^get-webrtc$/ }, () => ({ path: path.join(__dirname, 'node_modules/webrtc-bridge/index.js') }))
  }
}
