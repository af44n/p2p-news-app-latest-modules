
A p2p news app that uses the hypercore/hyperswarm stack to provide independent, no limit communication.

# Dev Diray
You can check out the dev-diary [here](https://hackmd.io/@mERxC4akTfWgpejBs9V3VQ/Hk-gF47-lg)

Also I have made a demo video which you guys can check that essentially explains this stack and app.
[Video](https://www.youtube.com/watch?v=79pv95Yk8qE)

# Latest modules

this repo is the same p2p news app as [af44n/p2p-news-app](https://github.com/af44n/p2p-news-app) (copied at `f525902`), but on the latest holepunch modules. what kept us on the old ones was rocksdb (hypercore-storage), which doesnt run in browsers. [serapath/rocksdb-native-opfs](https://github.com/serapath/rocksdb-native-opfs/tree/3cafa293487c43b78fdda5700f1ebac0e18b3dca) reimplements rocksdb-native's binding on the browsers private file system (opfs), so the browser can run the latest storage too. everything below is what had to change for that

## modules

- corestore 7.15.0, hypercore 11.39.0, autobase 7.28.2, hyperdrive 13.3.4, hyperbee 2.27.3, hypercore-storage 3.4.0 (rocksdb-native 3.19.1), bare-module 7.5.0
- `mirror-drive` stays on 1.10.0 (the old override), newer ones need `rabin-native`, a native addon browsers cant run
- the hypercore 10 patch is gone, hypercore 11 has no oplog file anymore. the dht-relay, blind-pairing and bip39-mnemonic patches stay

## storage in the browser

- the vault is stored in an opfs folder `identity-<name>` instead of indexeddb (random-access-web)
- opfs only works on a secure page, so open `http://localhost:9966` (or https), not the `192.168.x.x` address budo prints
- one tab per browser profile, the storage lets only one writer open it (another browser profile is fine)
- Reset All Data closes the swarms and the store and deletes the `identity-` folders

## the vault runs in a web worker

opfs storage only works in a web worker, so the vault moved out of the page
- `lib/vault-worker.js` runs the real vault (`identity`) and the news app, it is built into `vault.bundle.js` by `lib/build-vault.js` (esbuild, with the module swaps from rocksdb-native-opfs). `npm run build` and `npm run web` build it first
- `lib/node_modules/remote` lets the page use the vault in the worker. calls, callbacks and objects that stay in the worker (the vault bee, watchers, the swarm) work like before (`await`, `.then`, `for await`), the messages use our `make_tx` format
- `datashell.js` starts the worker on web, the `session_*` values stay in the page (localStorage), the worker gets a copy and sends its writes (seed phrase, session) back to the page
- what a worker doesnt have gets a stand in there, `window`, `open`, `alert` and `location.reload` (the page does those for a removed device) and `setImmediate` (hypercore 11 uses it)
- `websys-ui.js` / `webapp-ui.js` only got an `await` where they read a vault value right away (device key, relay, network and performance info, app audit, the news apps blog key, discovered blogs, swarm peer count), webapp-ui gets the news app from `uservault.news_app()` since it runs in the worker
- webrtc between browsers goes through `lib/node_modules/webrtc-bridge`, workers have no webrtc, so the real connection lives in the page and the worker drives it (hyper-webrtc itself is unchanged). the data still goes browser to browser

## code changes for the new modules

- corestore 7, `store.cores` isnt a map of `[id, core]` anymore, there is no `core-open` event (`store.watch` instead) and cores join a replication stream with `core.replicator.attachTo` once they are open (`identity`, `identity-networking`)
- in browsers keys and file bytes are `Uint8Array`, where `.toString('hex')` / `.toString()` give `"101,111,..."`, so those use `b4a.toString` now (datastructure-manager, autodisk, autobee, auditcore, identity, p2p-news-app-content), and the news feeds autobase view is opened as `utf-8` so its entries come back as text

## tested

by hand in chrome, on localhost, 2 or 3 browser profiles and a local relay
- seed, log in and log out
- pairing a device, writing posts, removing a device, 3 devices
- two peers finding and subscribing to each other and reading posts
- uploading an avatar
- Reset All Data and pairing again
- browser to browser webrtc connection

not tested yet, will be added here: the cli on these modules, the rest of the system bar tabs, firefox and safari

## good to know

- the Performance tab measures the worker now, chrome gives no memory numbers to workers, so some values show "unavailable"
- chrome can keep an old `vault.bundle.js` cached, tick Disable cache in devtools while testing
- when the relay stops, the webrtc connections close too (hyper-webrtc closes them with the relay connection, same as the main repo)


# Usage

We've added some cool stuff recently:
- **Offline Mode:** If the relay crashes, the app just falls back to cached data.
- **Device Management:** You can now give devices petnames, kick them out safely, and see which ones are dead.
- **Top Bar:** A top bar that shows which profile you're logged in as.

This repo isnt deployed yet, the [github_page](https://af44n.github.io/p2p-news-app/) runs the main repo on the old modules. Run it locally like below.

But if you want to try it manually:


Clone the repository:
```git clone (link)```

## Install bare

```npm i -g bare```

## Run relay 


e.g: `npm run relay`                                                  
```
> p2p-news-app-workspace@0.0.1 relay
> node lib/node_modules/relay/index.js

Relay running on ws://localhost:8080

```


## Run web peer

e.g: `npm run build && npm run web`   

```
[0000] info  Server running at http://192.168.1.10:9966/ (connect)
[0000] info  LiveReload running
[0003] 2752ms     2.3MB (browserify)

```
Now open `http://localhost:9966` (not the `192.168.x.x` address, the storage needs a secure page), click Seed and enter your name (or Pair with an invite code from your other device), launch the app, have your friends join aswell and when two peers connect, you can subsribe to each other and exchange blogs, fully decentralized. 

**Screenshot**

<img width="623" height="316" alt="image" src="https://github.com/user-attachments/assets/daffc03b-a036-4beb-a3db-6586b151bef2" />



## Run native peer

e.g: `npm run cli` (runs `bare lib/run.js`, its data is kept in the folder you run it in)

```
=== System Authentication ===
1. Seed   (create new account)
2. Pair   (join with invite code)
3. Load   (restore from mnemonic)
4. Reset All Data
```
The cli hasnt been tested on the latest modules yet.

After Seed (or Pair) you get the system menu (launch app, devices, invite code, vault log, reset). The news app on the cli joins the same topic as the web peers, so you can post, see other peers blogs (web or CLI), subscribe to them and see your profile. The screenshot below is from an older version of the cli.

**Screenshot**

<img width="322" height="151" alt="image" src="https://github.com/user-attachments/assets/ab4b0ce6-f41f-47e2-b63c-59f806552650" />

If you want to see the flow of the code and how everything was made step by step check out the dev diary and for quick go through, check [code_explanation](https://github.com/af44n/p2p-news-app/blob/main/docs/code_explanation.md)


# Protocol Architecture Trust Model

what u can rely on in the vault and in disks, and why. the details are in [docs/autobase.md](docs/autobase.md) (how autobase works) and [docs/disks.md](docs/disks.md) (our disks and pinned links), and every claim there links to a check in `docs/` you can run, the results are in [docs/autobase-checks.md](docs/autobase-checks.md). the checks were run in the main repo on autobase 6.5.13, hypercore 10.38.2 and corestore 6.18.4, not yet on the latest modules here

## one identity, many devices

your vault (the vault bee and the audit log) and every disk are autobases. each device writes only to its own core, and every device puts all entries in the same order and builds the same views from them. a new device can only write once an existing one adds it, and pairing adds every device as an indexer

<details><summary>eli5</summary>

every device keeps its own diary, and everyone copies all diaries into one shared notebook in the same order. only the devices already in the group can let a new one write in it

</details>

## what makes it final

a view is only final where more than half of the indexers signed it together. no device has a key to write or cut a view alone, so a signed part can never be rewritten, its fork stays 0 ([docs/fork-check.js](docs/fork-check.js)). when the indexers change the views get new keys, but they start with the old data and the hashes of old versions stay the same, only the autobase key stays forever ([docs/view-history-check.js](docs/view-history-check.js))

<details><summary>eli5</summary>

a page in the notebook only counts once most of the group stamped it, and nobody has an eraser for stamped pages. if the group changes, they start a new notebook that begins with a copy of the old pages

</details>

## pinned links

a pack name always means the latest files. a pinned link `dat://<length>.<fork>.<autobase key>.<hash>` means exactly the files at that version, the hash proves it, and it keeps working after the indexers change, on every device ([docs/pin-check.js](docs/pin-check.js)). the file bytes are pinned through the file list, thats from the code, not tested against an indexer that signs something wrong

<details><summary>eli5</summary>

"page 2 of group X's notebook, and page 2 looks exactly like this". if someone shows u a different page 2, it doesnt match

</details>

## what u cant rely on yet

- **the newest entries.** whatever isnt signed yet can still be reordered, a device can even think its an indexer before thats signed ([docs/indexer-offline-check.js](docs/indexer-offline-check.js))
- **2 devices with one gone.** both have to sign, so with one offline nothing new gets final, and even a 3rd device cant be added till it is back. the newest entries can also stay unsigned while both are online ([docs/pin-hang-check.js](docs/pin-hang-check.js))
- **a removed device.** it only wipes its data if it sees its own removal and runs our code. a changed client keeps whatever it already had
- **privacy.** nothing is encrypted yet, anyone who gets the keys can read the vault and the disks
- **who continues a disk.** anyone can make a core that starts with the same data, only the autobase key and its indexers say which one is real. true forks arent supported yet
- **recovery.** what happens when devices are lost for good (mnemonic recovery) isnt defined yet


If you want to learn or collab.. Please dm me on discord. my username is `trulynotafan`


