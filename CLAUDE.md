# Octopus Evolution

## Repos
- Frontend (this repo): `C:\ThreeJS\Octopus-evolution\Octopus-evolution`
- Backend: `C:\ThreeJS\Octopus-evolution\Octopus-evolution-backend` (Colyseus + MongoDB game server, see its CLAUDE.md; still the old game's contract). **The frontend does not talk to it yet**: progress is saved to localStorage (`state.js`, `SAVE_KEY`) as a stopgap, there is no multiplayer, and the leaderboards show only the local player.
- Reference game for Bloxity patterns: `C:\ThreeJS\Clean-leaves-for-loot\Clean-leaves-for-loot` (avatar/ and bloxity.js were ported from it).

## The game
The player is a half-octopus: their avatar rides in the middle of a big procedural octopus. Loop:
1. **Hub** (an island, walled W/N/E): stand on a training zone's floor and the octopus keeps lashing its dummy for XP (click / E / HIT hits faster). Levels give damage, HP, size and arms (4 -> 12); the level is capped per rebirth and Rebirth resets to Lv 1 for a permanent XP boost.
2. **Tentacle shop**: pedestals on the west side (+ two specials by the lane mouth). Each skin sets XP per training hit.
3. **Lane** (north of the hub): 15 stages, each a wave of bandits behind a pink LOCKED gate. Clear the wave -> the gate opens and two pads light (Wins / XP). Stepping on a pad cashes it and sends you home; walking on starts the next, exponentially harder stage. Stages 5/10/15 add a boss. Dying offers Revive / Revenge (paid in Wins) or No.
4. **Hub boss**: a countdown on the HUD; at zero a giant bandit lands in the hub centre (Skip = pay Wins to call it now).
- Combat: the octopus auto-slaps the nearest bandit in reach; E / THROW grabs the bandits around it, lifts them and slams them down (cooldown). Bandits telegraph attacks on the ground (rect swing, line shot, circle smash) and only hit what is inside when it fills.
- **Every price is in Wins** (see the root CLAUDE.md: never premium currency).

## Stack
Three.js (vanilla) + Vite + Rapier (`@dimforge/rapier3d-compat`, wasm inlined, top-level await -> `build.target: 'es2022'`). Everything is procedural (canvas textures, synthesized audio); the only imported model is the Bloxity base rig `public/avatars/player.glb`. Font: Fredoka.
- `npm run dev` / `npm run build`. `VITE_DEV_MODE=true` skips the Bloxity SDK/CDN. Preview config `octopus` in `.claude/launch.json` (port 5231, dev mode).
- All tunables are in `src/config.js`: identity, `HUB` / `LANE` layout (+ `stageStartZ`/`stageEndZ`/`gateZ`/`padZ`), `PROGRESSION` (XP curve, level cap, arms table, damage/HP growth), `TENTACLES`, `ZONES` + `ZONE_LAYOUT`, `SHOP_LAYOUT`, `STAGES` (recommended levels, rewards, bandit scaling), `COMBAT`, `HUB_BOSS`, `TRAINING`, `BOOSTS` (Wins prices), `AUDIO`, `JUICE`, plus the base look/camera/physics/rig sections.
- Dev console (dev builds): `__game.give(1000)`, `__game.levels(10)`, `__game.teleport(x, y, z)`, `__game.reset()`, `__game.state`.

## Files (`src/`)
- `main.js`: boot + wiring + the frame loop; hub prompts (buy/equip on pedestals, unlock zones, portal) and key bindings (E/F interact-throw-hit, B shop, I inventory, R home/leave, V camera mode, N day/night).
- `state.js`: the progress object, change events (`onChange`/`emit`), save, and every derived number (xpNeed, levelCap, armsFor, damageFor, maxHpFor, octoScale, prices, stage rewards, bandit stats).
- `octopus.js` + `octopusSkins.js`: the player octopus (CPU-animated tube tentacles, mantle, eyes, rider seat) and the shop display octopi; skins per tentacle pattern.
- `world.js` (sea + clouds), `hub.js` (island, walls, paths, shop pedestals, training zones, leaderboards, portal), `lane.js` (canyon, stage gates, reward pads, stage signs), `dummies.js` (training dummies), `worldTextures.js`.
- `combat.js` (waves, bandit AI, telegraphs, slaps, grab-and-slam, revive, hub boss), `enemies.js` (bandit/boss models + animation, telegraph decals), `training.js`, `fx.js` (debris, sparks, dust, rings, damage numbers, shake), `bars.js` (floating HP bars).
- `hud.js`/`hud.css` (HUD, prompts, combat buttons, revive dialog, announcements), `windows.js`/`windows.css` (Shop, Inventory, Rebirth).
- `audio/`: `core.js` (context, buses, reverb), `synth.js` (noise bursts, modal, bubbles, grunts...), `sfx.js` (every one-shot), `ambience.js` (wind, birds, combat tension layer), `index.js` (the one import).
- Base (unchanged roles): `player.js` kinematic capsule + Rapier character controller, `camera.js` chase cam (scaled by the octopus via `setCameraScale`), `modes.js`, `input.js`, `touch.js`, `physics.js`, `lighting.js`, `postfx.js`, `propkit.js`, `bake.js`, `textures.js`, `avatar/`, `bloxity.js`.
- Boxity layout: the platform draws its toolbar + chat in the top-left; the HUD stays below them (`bloxity.onReservedAreas` -> `--hud-top`). Never bind P.

## Mobile & responsive (required for every change)
The game must play on phones and tablets (portrait and landscape) as well as desktop. Every action needs a touch path (THROW button, HIT button while training, tappable prompts). Use Pointer Events, `matchMedia('(pointer: coarse)')` for touch UI, relative units, tap targets >= 44px, safe-area insets, `touch-action: none` on game controls, react to `resize`. Respect the graphics presets (DPR, shadow map, bloom off on phones). Check UI changes at 375x812 and 812x375 with touch emulation plus desktop.
