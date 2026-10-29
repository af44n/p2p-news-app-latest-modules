# recovering a vault with the seed phrase

this will be the doc for "Recover a vault with the mnemonic". what happens when devices are lost, what we can do about it, whats tested and whats only a proposal. ali is the user, aya follows alis blog.

everything here needs autobase 7 (`host.fork()`), so the latest modules. p2p-news-app is still on autobase 6.5.13, which has no fork. there, with 2 indexers and 1 cut off, the other one keeps writing but nothing new gets signed (plain autobase 6.5.13 scripts, 11 Oct).

the checks are [`fork-check.js`](fork-check.js) and [`all-lost-check.js`](all-lost-check.js), plain autobase 7.28.2 + corestore 7 in node, not our vault code. 3 runs each, all checks pass. run them from the repo root with `node docs/recovery/fork-check.js` and `node docs/recovery/all-lost-check.js`, they go next to the vault code with the latest modules port.

## what we have today
- only the first device makes the seed phrase, the ui shows it once, the user types 3 of the words back, then its gone. only its public key is in the vault (`user/public_key`). paired devices never get it
- pairing adds every device as an indexer of the vault. a new entry is only signed when more than half of the indexers have it (2 of 2, 2 of 3, 3 of 4...), read in autobase's code
- the vault key is the first devices own writer key, which comes from its corestore (random). it does NOT come from the seed phrase

## 1. ali loses 1 of his 2 devices for good (the "alone" case)

with b gone the new entries stay unsigned (tested, also on autobase 7).

the device thats left (a) can fork the base to just itself
- `host.fork([a], { key: system key, length: signed length })` in apply. after that a is the only indexer and signs alone (1 of 1), the entry that was stuck gets signed (tested)
- then a adds a new device the normal way, it becomes the second indexer and both sign again (2 of 2, tested)
- the autobase key stays the same, the old entries are still there, the view gets a new key (tested)
- aya, a reader that only knows the autobase key and was connected during the fork, follows it without doing anything (tested)
- the lost device b, when it comes back with its old data, sees the fork too, and its `writable` is still true (tested, an actual append from b wasnt tried). so the recovery should remove b as a writer after the fork

what doesnt work
- the check forks at the signed length. forking straight to [a, new device] fails when the new device was added after that length. autobase still says yes in apply (`validateFork` looks at the current state, where the new device exists), then the fork crashes inside autobase with "Fork failed", thrown uncaught, the process dies (tested). `validateFork` also allows a length up to whats applied locally, a fork at a longer length that includes the new device wasnt tried. so apply has to check that every new indexer is a writer at the length it forks at, before it calls `host.fork()`

who may fork
- `host.fork()` itself checks no signatures (read in `validateFork`). if our apply forks for any node, any writer can fork the vault. so our apply should only accept a fork command signed with the seed phrase key, checked against `user/public_key`. like u said the seed phrase only authorizes. the checks use a plain `allowed` flag instead (proposal, the signature check isnt built)
- a fork the apply doesnt allow does nothing (tested)

## 2. ali loses all his devices (or his only one)

a single device user losing it is the same thing. nobody is left who can write, so nobody can append a fork, a new device isnt a writer.

what worked (tested), the seed phrase writer
- when the base is made, a writer made from the seed phrase is added too (not an indexer) and writes once. in the vault the seed phrase is in memory at that moment anyway
- a backup peer that only replicates as a plain reader (stand in for a blind peer) has everything that was needed, also the seed phrase writers block (tested)
- ali gets a new device and types the seed phrase in. the device opens the base as the seed phrase writer (`new Autobase(store, key, { keyPair })`) and gets the data from the backup
- before its first append it has to fetch the seed phrase writers old block. autobase opens its own writer core as not active (read in the code) and in the check it didnt download it, the first append waited until the timeout. `update()` on that core didnt pick up its length, a `get(0)` did (tested)
- the new devices own key (a normal device writer from its corestore) opens the base BEFORE the fork. one that opened it for the first time after the fork stayed on the old state for the 20s the check waits, even connected to the device that forked (tested, 2 runs)
- then the seed phrase writer forks the base to itself, adds the new devices own key as an indexer, and the new device posts again. old posts are there, the autobase key is the same, aya follows (tested)

whats still open here
- the seed phrase writer is the only indexer for a moment during the recovery. u said the seed phrase should only authorize indexers and never be one. here it has to be one for a moment, cuz the new devices key isnt a writer at the signed length. maybe it can step down right after the new device is an indexer (not tested)
- finding the vault with only the seed phrase. the vault key is random, so a new device that only has the seed phrase doesnt know where to look. idea, the backup (or any of alis devices) announces the vault key on a topic made from `user/public_key`, signed with it (proposal, not tested)
- 2 devices recovering at the same time with the same seed phrase would both write as the same writer, which would fork that core (not tested)
- the backup in the check is a plain reader, not a real blind peer, and nothing is encrypted

## 3. telling aya and the others
- the autobase key stays the same after a fork, so nobody has to switch to a "new ali" (tested on a plain autobase. alis blog is its own autobase, a fork of it wasnt tried)
- peers that were around during the fork follow it on their own, also aya when she was only connected to the backup (tested). the old device b coming back with its old data follows it too (tested)
- a peer that opens the base for the first time after the fork, with only the key, stayed on the old state for 20s, even connected to a peer that has the fork (tested, 2 runs). thats ur "people who discovered alis blog from aya while ali was offline" case. ideas, ask on keet how a fresh peer finds the newest state after a fork (maybe thats what the autobase wakeup protocol is for), or peers pass on a pointer to the newest system core signed with alis seed phrase key (proposal)
- a peer offline for a long time that had the old state follows when it comes back (thats what b did, tested). one that never had it is the point above

## the procedure, the forks are tested, the steps marked proposal arent
1. losing 1 of 2. the device thats left sends a fork command signed with the seed phrase (typed in once, proposal), apply checks the signature (proposal), forks to the devices that are left (tested), a new device is added the normal way (tested), the lost one is removed as a writer (proposal)
2. losing all. a backup has the data (tested with a plain reader). the new device opens its own key in the base (tested), fetches the seed phrase writers old block (tested), opens the base as the seed phrase writer and forks to it (tested), adds its own key as an indexer (tested), then the seed phrase writer steps down (proposal)

## not tested at all yet
- the seed phrase signature check in apply
- the seed phrase writer stepping down after the recovery
- removing the lost device after the fork, and whether it can really still append
- forking at a length that includes the new device
- whether a fresh peer catches up with a fork after more than 20s
- finding the vault key from the seed phrase
- a fork of the blog autobase
- a real blind peer (blind-peering), encryption
- any of this in the browser or with the real vault code, the checks are plain autobase 7
