# Blackroot (3D browser MMO)

A modern MMORPG vertical slice built from scratch with an **authoritative
server** (the security lesson from the old *Gate to Heaven* codebase in this
repo, applied correctly: the client is never trusted).

- **Server:** Node.js + WebSocket. Simulates all movement, combat, AI and
  progression at 20 Hz and broadcasts world snapshots at 12 Hz.
- **Client:** Three.js (loaded from CDN — no build step). Third-person 3D,
  snapshot interpolation, nameplates, HUD, chat.

## Run it

```bash
cd server
npm install
npm start
```

Then open **http://localhost:8080** in your browser. Open a **second window**
to see real-time multiplayer (both players share one world).

> If port 8080 is busy, run `PORT=9000 npm start` and use that port instead.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD / Arrow keys |
| Look | Drag mouse |
| Zoom | Scroll wheel |
| Attack | Click a monster (auto-attacks while in range) |
| Equipment | E |
| Chat | Enter |

## What's implemented

- Real-time multiplayer: players see each other move and fight in one shared world
- Two zones — **The Dark Woods** (organic boundary, river + bridge, trail, POIs,
  hazards) and **The Hidden Cave** below it, joined by portals
- Authoritative movement with collision (bounds, boundary polygon, rocks, trees, river)
- Monster AI: wander -> aggro -> chase -> melee -> leash/return -> respawn
- Six monster types, passive livestock, and named elites with their own tuning
- Click-to-move / tab-target combat, OSRS-style hitsplats, floating HP bars
- XP, levelling, gold, weighted loot tables, ground loot, bag, treasure chests
- Synced day/night cycle and rain/mist weather, shared by all players
- **Quests** — 8 quests across three givers, with kill / collect / reach / chest /
  slay objectives, a quest log, NPC dialogue, and ! / ? markers over givers
- **Procedural character animation** — stride-synced locomotion, attack lunges
  and death topples (see the caveat below)
- **Equipment** — a fourteen-slot paper-doll window (helmet, shoulders, chest,
  gloves, legs, boots, cape, necklace, two earrings, two rings, weapon, offhand), attack and defence bonuses,
  level requirements, and a merchant who buys what you're carrying
- **Mining** — a separate skill with its own level, nine ore tiers, pickaxes
  that set your swing speed, and veins that deplete and respawn

## Combat balance

The numbers live in `server/balance.js` and can be measured without booting the
server:

```bash
node tools/balance.mjs
```

It prints, for every spawn group, how long the fight takes and how long the
player survives it at the level and equipment that area is tuned for. Normal
mobs sit at a 4-15x survive/kill ratio; both bosses land near 2.0.

Two flags change what it models:

```bash
node tools/mining.mjs            # ore tiers, pickaxe value, time-to-level
node tools/assets.mjs            # checks every declared model exists and every drop resolves
BARE=1 node tools/balance.mjs    # an unequipped character
REGEN=1 node tools/balance.mjs   # the old always-on regen
```

`BARE=1` reports the Rootbound Guardian as UNWINNABLE at 0.9, and that's
deliberate — the bosses assume you turned up wearing something.

Two things were tuned the hard way and are worth not undoing. Defence is a
percentage with diminishing returns rather than flat subtraction: flat armour
collapsed the whole curve the moment a player had any gear (every fight in the
game read as "trivial"). And regen is locked out for 5 seconds after taking a
hit — ticking straight through a fight, it was quietly paying for about a third
of all incoming damage.

## Tests

```bash
cd server
node server.js &            # or PORT=8099 node server.js &
node tools/questtest.mjs    # plays the first quest end to end against the live server
node tools/equiptest.mjs    # loots a weapon, equips it, checks the damage actually changes
node tools/miningtest.mjs  # walks to a real vein, mines it, checks depletion and respawn
node tools/animtest.mjs     # runs the client's animation code against the real GLBs

cd ..
npm i -D playwright && npx playwright install chromium
PORT=8080 node tools/uicheck.mjs  # headless assertions: camera, nameplates, panels, dialogue
PORT=8080 node tools/render.mjs   # same, but saves screenshots (much slower)
```

`questtest` joins as a real client, accepts a quest, kills and loots for the
objectives, proves turn-in is refused away from the giver, and checks the
rewards. `equiptest` earns a weapon off a goblin and verifies every landed hit
falls inside the geared damage range. `animtest` pulls the animation functions
out of `client/index.html` itself, so it can't drift from what ships.

`uicheck.mjs` is the one that catches what the others can't — it opens the game
in headless Chromium and reads real numbers back out of the running page. It
found two bugs the unit tests couldn't see: the spawn camera pointed at the
north boundary wall, and nameplates from the entire zone piling up at the top
of the screen (47 mobs alive, 47 plates drawn). Prefer it over `render.mjs` —
screenshots are what make browser testing slow, and most of what you want to
assert is a number. Opening the client with `?debug=1` attaches a
`window.__bk` handle (scene, camera, quest state, and a `pick(x, y)` raycast)
that the harness uses to interrogate what's actually on screen. Software
rendering is slow, so take screenshots sparingly.

## A note on the character models

None of the character GLBs are rigged — no skins, no animation clips, and most
(Male, Bandit, Guard, Cow, Chicken) are a single merged mesh with no separable
limbs. Walk cycles with swinging arms and legs are therefore not possible in the
engine; they need the models re-authored in Blender with a skeleton.

What runs instead is procedural: stride-synced bob, roll and lean driven by
measured speed, an attack lunge, and a death topple. The two models that *do*
have separate parts get real animation — the Spider's eight leg nodes move in an
alternating tripod, and the Hill Ogre swings its club. When the models get
rigged, replace `animateEntity()` in `client/index.html` with an `AnimationMixer`.

## Where this goes next (roadmap)

1. **Persistence** — accounts + character save/load (SQLite/Postgres, parameterized
   queries). Replaces the in-memory state, including quest progress.
2. **Shops & crafting** — merchants currently buy but don't sell, and materials
   (silk, hide, bones) have no use beyond their sale value.
3. **Abilities & classes** — a hotbar, cooldowns, resource (mana), a few classes.
4. **Rigged characters** — skeletons + clips, replacing the procedural animation.
5. **Netcode hardening** — binary protocol, client-side prediction + reconciliation
   for the local player, interest management (only send nearby entities).
6. **Content tooling** — data-driven monsters/items/spawns from JSON tables.

## File layout

```
server/
  server.js        # authoritative game server + static file host
  balance.js       # combat & progression maths (no side effects)
  quests.js        # quest definitions + objective tracking
  mining.js        # ore tiers, pickaxes, swing odds, mining xp curve
  worldgen.js      # deterministic tree and cave-dressing placement
  items.js         # item table, equip slots, stat bonuses
  zones/
    darkwoods.js   # zone 1 layout, spawns, NPCs, hazards
    hiddencave.js  # zone 2 layout, chests, spawns
  tools/
    questtest.mjs  # end-to-end quest test against a live server
    equiptest.mjs  # end-to-end equipment test against a live server
    miningtest.mjs # end-to-end mining test against a live server
    animtest.mjs   # headless test of the client's animation code
client/
  index.html       # entire Three.js client (renderer, netcode, HUD, quests)
  models/*.glb     # characters, trees, bushes
tools/
  balance.mjs      # prints the combat curve
  mining.mjs       # prints the mining curve
  assets.mjs       # verifies model declarations and drop-model coverage
  worldgen.mjs     # prints what world generation places
  map.mjs          # draws each zone's map from its own data
  rig_split.mjs    # splits merged character meshes into animatable parts
README.md
```
