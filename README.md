# Blackroot

A feature-rich, single-process **multiplayer browser RPG alpha / vertical slice**.
The Node.js server simulates movement, combat and progression at 20 Hz and sends
JSON snapshots at 12 Hz; the Three.js client has no build step. This is not a
claim of production MMO capacity or security certification.

## Run

Use Node.js 24 LTS (the regression baseline uses Node 24), then:

```sh
cd server
npm ci
npm start
```

Open http://localhost:8080. `PORT=9000 npm start` selects another port. Create an
account with a character name and a password of at least six characters; use the
same credentials to return. Choose Fighter, Cleric or Bard. A second browser can
join with a **different** account. Never reuse a real password on a local alpha.
The client loads browser dependencies from a CDN and needs network access.

`BLACKROOT_DATA_DIR=/absolute/path` isolates accounts and character checkpoints
from the default repository-local storage. Back up the **whole** account directory
and `saves/world.checkpoint.json` checkpoint together while the server is stopped, rather
than restoring individual characters from different generations. Checkpoints are
atomic and keep a previous `.bak`; corrupt durable data fails closed and needs
explicit operator recovery. Legacy per-character JSON saves are imported when no
world checkpoint exists. Test tools always use disposable temporary storage.

## Implemented in source

- Blackroot: one composed surface world with **Dark Woods and Killing Fields**
  regions, plus **Spider Den**, connected by portals; terrain, collision, weather,
  day/night, fog of war and discovery.
- 45 quests with dialogue, prerequisite chains, collect/kill/reach/chest/gather/use
  objectives, NPC markers and rewards. Feathers and Hide and A Lantern for the
  Road are starter quests, not the whole quest catalogue.
- Accounts and character persistence; inventory, ground loot, equipment, gold,
  death recovery, merchants that buy items, treasure chests and progression.
- Fighter/Cleric/Bard class stats, abilities, resources, trainers, cooldowns,
  buffs/debuffs, weapon profiles and attack tables; monster archetypes and bosses.
- Mining, fishing and cooking; parties, trading and duels.
- Fourteen-slot equipment UI, chat, map, quest log, procedural/split-mesh animation
  and world/content tooling. These source features still require gameplay and
  visual QA; animation/asset claims require the actual GLB checkout.

## Controls

WASD moves; arrow keys rotate the camera. Click ground to move, a monster to
attack, or a world object to interact. Drag to look and scroll to zoom. **I** opens
the bag, **E** equipment, **Q** quests; Enter opens chat. Consult the in-game UI for
ability slots and additional controls.

## Test layers

From `server/`:

```sh
npm test                 # fast deterministic logic/data/client regression gates
npm run test:e2e         # authenticated quest, equipment and mining gameplay
npm run test:assets      # model/zone/animation validation: full GLB checkout required
npm run test:world       # full map reachability scan (can take several minutes)
npx playwright install chromium
npm run test:browser     # real Chromium UI: full assets + CDN access required
npm run test:client:browser # optional asset-independent DOM smoke (system Chromium)
```

E2E scripts start their own server on a free local port, register unique throwaway
accounts, bound waits, and clean up server processes and temporary storage in
`finally`. They **never** attach to `PORT` or mutate a developer's running world.
The equipment scenario seeds a valid isolated save with a Bronze Dagger rather
than depending on a rare goblin drop, then uses real authenticated equip, hit,
unequip and sale protocol. Its damage sheet uses class stats and weapon swing
bands; actual hit assertions distinguish critical hits. The focused quest
contract uses a saved level-five Fighter with legal gear, walks
to the live giver, kills/loots livestock with auto-attacks and the known Heavy
Swing skill (resource/cooldown-aware, at most one press/second), rejects remote
turn-in and verifies
reward and prerequisite changes. It is not fresh-character progression validation.
Mining uses Mining level one on a combat-level-20 character five metres from a
collision-verified real vein in the goblin camp; it checks real swing odds, the
current 3–6-ore copper yield, depletion, respawn, level gates and remote interaction.
It intentionally excludes long-distance travel (use the separate world scan).
Gameplay timing is bounded but is not a
performance benchmark; failures are failures, including timeouts. Quest checks
use separate bounded approach/combat windows and retain a hard overall deadline
plus snapshot/position/target-HP diagnostics. The generated-scenery spatial index
reduced process CPU from 101.8% to 19.5% of one core and raised snapshots from
6.12 to 9.85 per second in one controlled 60-second before/after movement test.
The 20 Hz tick quantizes the configured 12 Hz snapshot target to approximately
10 Hz. These results do not establish large-player capacity or public gameplay
readiness; profile representative workloads before deployment.

A text-only checkout lacks `client/models/*.glb`. Asset and browser checks are
**blocked**, not passed, in that case. `npm test` intentionally does not load GLBs
or launch a browser. Browser runs require installed Chromium, working WebGL and
CDN access. Do not infer visual quality, frame rate, full progression balance,
multiplayer scalability or deployment readiness from the fast suite.

## Diagnostics (from repository root)

```sh
node tools/balance.mjs
CLASS=cleric node tools/balance.mjs  # fighter / cleric / bard
BARE=1 node tools/balance.mjs        # no equipment
SEED=123 node tools/balance.mjs     # reproducible attack-table sampling
node tools/mining.mjs
```

Combat diagnostics use the runtime class/weapon/attack-table formulas and live
Blackroot/Spider Den content. They model **unbuffed auto-attacks only**, not a
complete encounter: abilities, healing, movement, AI, player decisions and boss
mechanics change outcomes. Ratios are not proof of an unwinnable or balanced
fight. Mining prints ore/pickaxe progression and the runtime-prepared vein census;
a census does not prove path reachability. `REGEN=1` is an obsolete model option.

## Generated scenery collision cache

Collision queries use a spatial candidate index for generated `_trees` and
`_scatter`, preserving the original collision order and rechecking candidates
after displacement. Replacing either array or changing its length rebuilds the
index automatically. After intentional in-place edits to generated coordinates,
scale, collision radius or array order, call `invalidateCollisionScenery(zone)`
from `server/collision.js` before the next query. Live editor objects remain
uncached and continue to use their existing collision rules.

Run `node --test test/collision-independent.test.js` from `server/` for the
independent original-implementation parity checks. The frozen oracle is a test
fixture, not another production collision implementation.
`node tools/collision-independent-benchmark.mjs` measures identical query inputs
against that oracle, separating index construction from warm queries. Its
function timings are not whole-game or browser frame-rate measurements.

## Next milestones

1. Keep reproducible regression gates and restore/crash/reconnect/inventory
   conservation checks; validate operations and backups in a closed alpha.
2. Playtest one complete progression loop for every class, all quest objectives,
   skill loops, transitions, death recovery and two-client social systems.
3. Extend the economy only with transaction/conservation tests; cooking already
   exists and generic crafting is not a substitute for economy design.
4. Define player-count/latency budgets and profile tick, snapshot and frame costs
   before selecting interest management or transport changes.
5. Extract client/server modules and strengthen schemas/tooling; expand content
   and animation with full asset and visual QA.

## Layout

`server/server.js` is the authoritative simulation and static host;
`balance.js`, `combat.js`, `items.js`, `quests.js`, skill/class modules and
`worldgen.js` supply shared rules. `server/zones/blackroot.js` is the composed live
surface, `spiderden.js` the cave; standalone regional source files are not the
running world. `server/tools/` contains gameplay and animation checks,
`server/test/` deterministic regressions. `client/index.html` contains the browser
client and `client/models/` its assets. Root `tools/` contains diagnostics, data,
reachability, asset and browser checks and world/asset authoring utilities.

### Bounded multiplayer checks

On Linux with Node 24, from `server/`:

```sh
node tools/multiplayertest.mjs --smoke   # 2-client harness/functional check, not a benchmark
node tools/multiplayertest.mjs --clients=2 # stop after the full 2-client tier
node tools/multiplayertest.mjs --input-only # separate 2-client, 60s ~20Hz input workload
node tools/multiplayertest.mjs           # gated 2/8/16-client characterization
```

The harness owns a free local port and a disposable `BLACKROOT_DATA_DIR`, uses
random throwaway passwords, and serializes joins at 5.1-second spacing to respect
the 12-authentication-starts/IP/minute limit. The server also permits at most
eight concurrent sockets per IP: the 16-client tier therefore binds clients
0–7 to source `127.0.0.1` and clients 8–15 to source `127.0.0.2`. No production
limit is disabled or increased. A ninth same-IP socket was observed being
rejected with close code 1006, verifying that admission cap rather than showing
a gameplay defect. The harness never targets an existing world.
Normal runs warm up for 30 seconds, measure 60 seconds idle and 120 seconds moving
per tier, then verify trade escrow on logout/heartbeat expiry, exactly-once trade
completion, abrupt disconnect, reconnect and a graceful server restart. Every
moving client must actually move, not merely send inputs. Movement sends one
`move` destination per client per second; idle sends no game inputs. In contrast,
the shipped browser sends `input` packets at a render-frame-dependent interval
greater than 50 ms (up to roughly 20 Hz). This is therefore a **moderate scripted
pathfinding workload**, not full typical browser packet volume. The separate
`--input-only` phase sends only `input` (no `move` destinations) every 50 ms,
alternating forward/back every 500 ms for 60 seconds, and reports achieved send
frequency. It exercises browser-like packet volume without claiming browser
rendering or real-world user behavior. Healthy-client presence
and post-departure cleanup are checked. The existing integrity suite separately
covers SIGKILL, grave recovery, ground transfer and checkpoint corruption.

Results, raw snapshot timestamps/resource samples, and bounded server logs are
written to a fresh temporary results directory printed at completion; set
`MULTIPLAYER_RESULTS` to choose a results directory. The directory contains no
account files or passwords. Server processes/sockets and disposable account data
are cleaned on success, failure, interruption, or the 25-minute overall deadline
(3 minutes for smoke). A 1 GiB server-RSS ceiling and 10-second snapshot-liveness
deadline are test safety stops, **not** agreed performance budgets. Failing tiers
prevent escalation. Linux `/proc` and `getconf CLK_TCK` supply CPU/RSS readings;
100% CPU means one logical core. The generator's CPU and RSS are reported too.

Metrics include admission latency, per-client snapshot inter-arrival percentiles,
delivered snapshot frequency, bytes/sec, movement distance and server CPU/RSS.
Snapshot arrival gaps are not server serialization timings or synchronized
network latency. This clustered, synthetic loopback workload is not a rendered
browser test, geographically dispersed workload, sustained soak, leak proof,
stale-social-invite audit or capacity certification. After lower tiers have passed on identical production source, `--only-tier=16`
can resume just the 16-client tier; the default still gates 2 → 8 → 16.
No player-count/latency SLO is asserted; a passing run does not override other known regression failures.
