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
cd "mmo/server"
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
| Chat | Enter |

## What's implemented (v0.1)

- Real-time multiplayer: players see each other move and fight in one shared zone
- Authoritative movement with collision (arena bounds + rock obstacles)
- Monster AI: wander → aggro → chase → melee → leash/return → respawn
- Three monster types (boar / wolf / ogre) with distinct stats
- Tab-target combat, damage numbers, hit flash, floating HP bars
- XP, leveling (max HP scales), gold, basic loot drops
- Out-of-combat health regen, death + respawn
- Global chat with system messages

## Where this goes next (roadmap)

1. **Persistence** — accounts + character save/load (SQLite/Postgres, parameterized
   queries). Replaces the in-memory state.
2. **Inventory & equipment** — items with stats, equip slots, drag-and-drop UI.
3. **Abilities & classes** — a hotbar, cooldowns, resource (mana), a few classes.
4. **More world** — multiple zones with seamless/portal transitions, terrain
   heightmaps, NPCs and quests.
5. **Netcode hardening** — binary protocol, client-side prediction + reconciliation
   for the local player, interest management (only send nearby entities).
6. **Content tooling** — data-driven monsters/items/spawns from JSON tables
   (mirrors how the old server loaded `.tbl` files).

## File layout

```
mmo/
  server/
    server.js      # authoritative game server + static file host
    package.json
  client/
    index.html     # entire Three.js client (renderer, netcode, HUD)
  README.md
```
