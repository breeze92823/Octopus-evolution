import { ACESFilmicToneMapping, Clock, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { CAMERA, HUB, SPAWN, SPAWN_FACING, STAGES, TENTACLES, graphicsPreset, RENDER } from './config.js'
import * as bloxity from './bloxity.js'
import { install as installInput, isLocked, onKey } from './input.js'
import { installTouch } from './touch.js'
import { createPlayerBody, interpolate as interpolatePlayer, player, resetPlayer } from './player.js'
import { setCameraScale, setCameraSensitivity, syncYawToPlayer, update as updateCamera } from './camera.js'
import { onModeChanged, toggleMode } from './modes.js'
import { bodyCount, initPhysics, stepPhysics } from './physics.js'
import { createLighting } from './lighting.js'
import { createWorld } from './world.js'
import { buildHub } from './hub.js'
import { buildLane } from './lane.js'
import { createPostFx } from './postfx.js'
import { setNeonBloom } from './propkit.js'
import { buildDefaultCharacter, loadBaseCharacter } from './avatar/character.js'
import { applyProportions, attachEquippedAccessories } from './avatar/loader.js'
import { disposeAnimator, makeAnimator } from './avatar/animator.js'
import { createOctopus, createTentacleDisplay } from './octopus.js'
import { createFx } from './fx.js'
import { createBars } from './bars.js'
import { createHud } from './hud.js'
import { closeTopWindow, anyWindowOpen, createWindows, setWindowReserved } from './windows.js'
import { createTraining } from './training.js'
import { createCombat } from './combat.js'
import { installAudio, isMuted, sfx, toggleMuted, updateAudio } from './audio/index.js'
import {
  addWins,
  armsFor,
  atCap,
  buyStarter,
  buyTentacle,
  buyTrain2x,
  buyWins2x,
  buyLevels,
  buyZone,
  emit,
  equipTentacle,
  equippedTentacle,
  fmt,
  levelCap,
  octoScale,
  onChange,
  owns,
  resetProgress,
  skipBossPrice,
  spendWins,
  state,
  zoneUnlocked,
} from './state.js'

// Boot order: Bloxity SDK -> renderer -> Rapier (async wasm) -> hub + lane + sky,
// player body -> octopus + rider avatar -> HUD, windows, training, combat -> loop.
let lighting = null
let renderer = null
let postfx = null
const timers = [] // one-shot delayed callbacks (real time)
const later = (s, fn) => timers.push({ at: performance.now() + s * 1000, fn })

function applySetting(key, value) {
  if (key === 'camera_sensitivity') setCameraSensitivity(value)
  else if (key === 'fullscreen') bloxity.requestFullscreen(value)
  else if (key === 'graphics_quality' && renderer) {
    const next = graphicsPreset(value)
    renderer.shadowMap.enabled = next.shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.dpr))
    lighting?.setShadows(next)
    postfx?.configure(next)
    setNeonBloom(next.bloom)
    postfx?.setSize(window.innerWidth, window.innerHeight)
  }
}
bloxity.onSetting(applySetting)
bloxity.init()

// --- Renderer ---------------------------------------------------------------
const preset = graphicsPreset(bloxity.settings.graphics_quality)
renderer = new WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = RENDER.exposure
renderer.shadowMap.enabled = preset.shadows
renderer.shadowMap.type = PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr))
document.body.appendChild(renderer.domElement)
// Esc closes an open window first, then opens the portal menu.
installInput(() => {
  if (!closeTopWindow()) bloxity.showMenu()
}, renderer.domElement)
installAudio()

const scene = new Scene()
const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
postfx = createPostFx(renderer, scene, camera)
postfx.configure(preset)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  postfx.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

for (const key of Object.keys(bloxity.settings)) applySetting(key, bloxity.settings[key])

// --- Physics + world ------------------------------------------------------------
bloxity.loadingStep('Starting physics')
await initPhysics()

lighting = createLighting(scene, renderer, preset)
const world = createWorld(scene) // sea + clouds
bloxity.loadingStep('Building the hub')
const hub = buildHub(scene)
const lane = buildLane(scene)
createPlayerBody()
syncYawToPlayer()

// --- The octopus and its rider -----------------------------------------------------
const octo = createOctopus()
scene.add(octo.group)
let arms = armsFor(state.level)
let scaleNow = octoScale(state.level)
octo.setArms(arms)
octo.setSkin(equippedTentacle())
octo.setScale(scaleNow)

let avatar = null
let animator = null
let generation = 0
let avatarReady = false
function setAvatar(next) {
  if (avatar) avatar.removeFromParent()
  disposeAnimator(animator)
  avatar = next
  octo.seat.add(avatar)
  animator = makeAnimator(avatar)
}
setAvatar(buildDefaultCharacter())
async function loadAvatar() {
  const mine = ++generation
  try {
    const group = await loadBaseCharacter()
    if (mine !== generation) return
    const equipped = bloxity.authState.user ? bloxity.getEquippedAvatar() : null
    await attachEquippedAccessories(group, equipped, { skinTextureUrl: bloxity.getSkinTextureUrl() })
    if (mine !== generation) return
    applyProportions(group, bloxity.authState.user ? bloxity.getProportions() : null)
    setAvatar(group)
  } finally {
    if (mine === generation) avatarReady = true
  }
}
let signedIn = null
bloxity.subscribeAuth((s) => {
  const now = !!s.user
  if (now !== signedIn) {
    signedIn = now
    loadAvatar()
  }
  refreshBoards()
})
bloxity.onAvatarChanged(loadAvatar)
bloxity.onProportionsChanged(() => applyProportions(avatar, bloxity.getProportions()))

// Shop pedestals: a live mini octopus in each skin.
const displays = hub.shopPads.map((pad) => {
  const d = createTentacleDisplay(pad.def, { size: pad.def.special ? 3.6 : 3.4, arms: 6 })
  pad.anchor.add(d.group)
  d.group.traverse((o) => (o.castShadow = false)) // small and many: not worth a shadow pass
  return { pad, d }
})

// --- Effects, HUD, windows ---------------------------------------------------------------
const fx = createFx(scene, camera)
const bars = createBars(camera)

function teleportHome() {
  resetPlayer(SPAWN, SPAWN_FACING)
  syncYawToPlayer()
  hud.setLane(false)
}

let combat = null
let training = null
let currentPrompt = null
const windows = createWindows({
  onBuyTentacle: (def) => celebrateTentacle(def),
  onRebirth: () => celebrateRebirth(),
})
function buyOrDeny(ok, what) {
  if (ok) sfx.purchase()
  else {
    sfx.deny()
    hud.toast(what ?? 'Not enough Wins!')
  }
  return ok
}
const hud = createHud({
  rebirth: () => windows.rebirth.toggle(),
  shop: () => windows.shop.toggle('tentacles'),
  inventory: () => windows.inventory.toggle(),
  buyLevels: (pack) => {
    if (atCap()) return buyOrDeny(false, 'Max level! Rebirth to go higher.')
    buyOrDeny(buyLevels(pack))
  },
  train2x: () => {
    if (buyOrDeny(buyTrain2x())) hud.toast('x2 Train active!')
  },
  wins2x: () => {
    if (state.wins2x) return hud.toast('x2 Wins already owned!')
    if (buyOrDeny(buyWins2x())) hud.announce('x2 WINS!', 'Every Wins reward is doubled', 'win')
  },
  starter: () => {
    if (buyOrDeny(buyStarter())) {
      hud.announce('STARTER PACK!', 'Sunken Gold + x2 Train + Levels', 'win')
      celebrateTentacle(equippedTentacle())
    }
  },
  skipBoss: () => {
    if (combat.hubBossActive()) return
    if (!spendWins(skipBossPrice())) return buyOrDeny(false)
    sfx.purchase()
    combat.skipBossTimer()
  },
  leave: () => combat.leave(),
  throw: () => combat.throwAction(),
  prompt: () => currentPrompt?.action?.(),
  hit: () => training.manualHit(),
  mute: () => {
    toggleMuted()
    return isMuted()
  },
  tick: () => sfx.countdown(),
})

training = createTraining({ hub, octo, fx, player })
combat = createCombat({ scene, octo, fx, bars, lane, hud, player, teleportHome })

// Platform toolbar + chat live in the top-left: keep the HUD below them.
bloxity.onReservedAreas((areas) => {
  let bottom = 0
  let toolbarBottom = 0
  for (const a of areas) {
    bottom = Math.max(bottom, (a.top ?? 0) + (a.height ?? 0))
    if (a.id === 'toolbar') toolbarBottom = (a.top ?? 0) + (a.height ?? 0)
  }
  hud.root.style.setProperty('--hud-top', `${bottom + 8}px`)
  setWindowReserved(toolbarBottom + 8)
})

// --- World state from progress ----------------------------------------------------------------------
function refreshPads() {
  for (const pad of hub.shopPads) {
    const def = pad.def
    if (state.equipped === def.id) pad.setStatus('equipped', 'EQUIPPED')
    else if (owns(def.id)) pad.setStatus('owned', 'OWNED')
    else pad.setStatus('buy', def.price === 0 ? 'FREE' : `${fmt(def.price)} Wins`)
  }
}
function refreshZones() {
  for (const z of hub.zones) {
    const d = z.def
    if (zoneUnlocked(d)) z.setLock({ locked: false, text: 'OPEN' })
    else if (d.price) z.setLock({ locked: true, text: `${fmt(d.price)} Wins` })
    else z.setLock({ locked: true, text: `${d.rebirths} Rebirth${d.rebirths > 1 ? 's' : ''}` })
  }
}
function refreshBoards() {
  const name = bloxity.displayName()
  const row = (value) => {
    const rows = [{ rank: 1, name, value }]
    for (let i = 2; i <= 10; i++) rows.push({ rank: i, name: '---', value: '' })
    return rows
  }
  hub.boards.wins.setRows(row(fmt(state.totalWins)))
  hub.boards.rebirths.setRows(row(fmt(state.rebirths)))
  const h = Math.floor(state.playtime / 3600)
  const m = Math.floor((state.playtime % 3600) / 60)
  hub.boards.playtime.setRows(row(h ? `${h}h ${m}m` : `${m}m`))
  hub.boards.stage.setRows(row(state.bestStage ? `Stage ${state.bestStage}` : '-'))
}
refreshPads()
refreshZones()
refreshBoards()

const tmp = new Vector3()
function celebrateTentacle(def) {
  octo.setSkin(def)
  octo.pulse()
  sfx.unlock()
  fx.motes(tmp.set(player.renderPosition.x, 0.6, player.renderPosition.z), { count: 30, colors: [def.colors.base, def.colors.accent, '#ffffff'], radius: 2.4, height: 1.5 })
  hud.announce(def.name.toUpperCase(), `+${fmt(def.xp)} XP per hit`, 'win')
}
function celebrateRebirth() {
  sfx.rebirth()
  octo.pulse()
  hud.announce('REBIRTH!', `Level cap ${levelCap()} · XP boost up!`, 'lvl')
  fx.motes(tmp.set(player.renderPosition.x, 0.4, player.renderPosition.z), { count: 60, colors: ['#ff5fa8', '#ffffff', '#ffe066', '#8fe0ff'], radius: 3.5, height: 3, rise: 1.4 })
  fx.ring(tmp.set(player.renderPosition.x, 0, player.renderPosition.z), { radius: 14, color: '#ff9ad0', life: 0.8 })
  fx.shake(0.4)
}

let lastLevel = state.level
onChange((kind) => {
  if (kind === 'tentacle') {
    octo.setSkin(equippedTentacle())
    refreshPads()
  }
  if (kind === 'zone' || kind === 'rebirth') refreshZones()
  if (kind === 'stage' || kind === 'rebirth' || kind === 'wins') refreshBoards()
  if (kind === 'level' || kind === 'rebirth') {
    const L = state.level
    const nextArms = armsFor(L)
    if (nextArms !== arms) {
      const grew = nextArms > arms
      arms = nextArms
      octo.setArms(arms)
      if (grew) {
        sfx.armGrow()
        later(0.9, () => hud.announce('NEW ARM!', `${arms} arms`, 'lvl'))
      }
    }
    if (kind === 'level' && L > lastLevel) {
      octo.pulse()
      sfx.levelUp()
      const p = player.renderPosition
      fx.motes(tmp.set(p.x, 0.5, p.z), { count: 34, colors: ['#ffe066', '#ffffff', '#7dff6a'], radius: 2.2, height: 2 })
      fx.ring(tmp.set(p.x, 0, p.z), { radius: 8, color: '#ffe9a0', life: 0.6 })
      if (atCap()) hud.announce('MAX LEVEL!', 'Open Rebirth to grow stronger', 'lvl')
      else hud.announce('LEVEL UP!', `Level ${L}`, 'lvl')
    }
    lastLevel = L
  }
})
// --- Prompts: shop pedestals, locked zones, the portal ----------------------------------------------
const T = (n) => `${hud.trophyIcon()}${fmt(n)} Wins`
function findPrompt() {
  if (combat.isDead()) return null
  const p = player.renderPosition
  for (const pad of hub.shopPads) {
    const c = pad.center
    if (Math.abs(p.x - c.x) < pad.half + 0.8 && Math.abs(p.z - c.z) < pad.half + 0.8 && Math.abs(p.y - c.y) < 1.6) {
      const def = pad.def
      if (state.equipped === def.id) return { title: `${def.name} equipped`, sub: `+${fmt(def.xp)} XP per hit`, tone: 'ok', noKey: true }
      if (owns(def.id))
        return {
          title: `Equip ${def.name}`,
          sub: `+${fmt(def.xp)} XP per hit`,
          tone: 'ok',
          action: () => {
            if (equipTentacle(def.id)) {
              sfx.equip()
              octo.pulse()
            }
          },
        }
      return {
        title: `Buy ${def.name} Tentacles`,
        sub: `${T(def.price)} · +${fmt(def.xp)} XP`,
        tone: 'buy',
        action: () => {
          if (buyTentacle(def.id)) {
            sfx.purchase()
            celebrateTentacle(def)
          } else buyOrDeny(false)
        },
      }
    }
  }
  const z = training.standingIn()
  if (z) {
    const d = z.def
    if (!zoneUnlocked(d)) {
      if (d.price)
        return {
          title: `Unlock ${d.name} (x${d.mult} XP)`,
          sub: T(d.price),
          tone: 'buy',
          action: () => {
            if (buyZone(d)) {
              sfx.unlock()
              hud.announce(`${d.name.toUpperCase()} UNLOCKED!`, `x${d.mult} XP training`, 'win')
            } else buyOrDeny(false)
          },
        }
      return { title: `${d.name} is locked`, sub: `Needs ${d.rebirths} Rebirth${d.rebirths > 1 ? 's' : ''} (you have ${state.rebirths})`, tone: 'locked', noKey: true }
    }
    if (atCap()) return { title: 'MAX LEVEL!', sub: 'Rebirth to keep growing', tone: 'locked', action: () => windows.rebirth.open() }
  }
  const portal = hub.portal
  if (Math.hypot(p.x - portal.x, p.z - portal.z) < portal.radius + 2.5) {
    if (state.bestStage >= STAGES.count) return { title: 'World 2', sub: 'Coming soon, champion!', tone: 'ok', noKey: true }
    return { title: 'World 2 is locked', sub: `Beat Stage ${STAGES.count} (best: ${state.bestStage})`, tone: 'locked', noKey: true }
  }
  return null
}

// --- Keys ------------------------------------------------------------------------------------------------
function pressE() {
  if (anyWindowOpen()) return
  if (combat.isDead()) return
  if (combat.inCombat()) {
    combat.throwAction()
    return
  }
  if (currentPrompt?.action) {
    currentPrompt.action()
    return
  }
  if (training.manualHit()) return
  if (combat.inLane() || combat.hubBossActive()) combat.throwAction()
}
onKey('KeyE', pressE)
onKey('KeyF', pressE)
onKey('KeyV', toggleMode)
onKey('KeyN', () => lighting.toggleDayNight())
onKey('KeyR', () => {
  if (combat.inLane()) combat.leave()
  else teleportHome()
})
onKey('KeyB', () => windows.shop.toggle('tentacles'))
onKey('KeyI', () => windows.inventory.toggle())
installTouch({
  mode: toggleMode,
  day: () => lighting.toggleDayNight(),
  respawn: () => (combat.inLane() ? combat.leave() : teleportHome()),
})
// A click on the world while training (cursor captured) is a hit.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (e.pointerType === 'mouse' && !isLocked()) return
  if (e.pointerType !== 'mouse') return // touch has the HIT button
  training.manualHit()
})

onModeChanged((mode) => {
  if (avatar) avatar.visible = mode !== 'player'
})

// --- Loop -----------------------------------------------------------------------------------------------------
const clock = new Clock()
let shownLoading = true
let readySince = 0
let boardTimer = 0
let elapsed = 0

function frame(forcedDt, draw = true) {
  const dt = forcedDt ?? Math.min(clock.getDelta(), 0.1)
  elapsed += dt

  stepPhysics(dt)
  interpolatePlayer()

  // Progress clocks.
  state.playtime += dt
  if (state.train2x > 0) {
    state.train2x = Math.max(0, state.train2x - dt)
    if (state.train2x === 0) {
      emit('boost', 'train2x')
      hud.toast('x2 Train ran out')
    }
  }
  boardTimer += dt
  if (boardTimer > 5) {
    boardTimer = 0
    refreshBoards()
    emit('tick')
  }

  // Octopus: grows smoothly toward its level's size.
  const targetScale = octoScale(state.level)
  if (Math.abs(targetScale - scaleNow) > 0.001) {
    scaleNow += (targetScale - scaleNow) * Math.min(1, dt * 3)
    octo.setScale(scaleNow)
  }
  const p = player.renderPosition
  const speed = Math.hypot(player.velocity.x, player.velocity.z)
  octo.group.position.set(p.x, p.y, p.z)
  octo.group.rotation.y = player.facing
  octo.group.updateMatrixWorld()
  octo.update(dt, { speed, grounded: player.grounded, time: elapsed })
  animator?.update(dt, { grounded: true, speed: 0, verticalVelocity: 0, turn: 0 })

  training.update(dt)
  combat.update(dt)
  for (const { pad, d } of displays) {
    const dx = pad.center.x - p.x
    const dz = pad.center.z - p.z
    const near = dx * dx + dz * dz < 70 * 70
    d.group.visible = near
    if (near) d.update(dt, elapsed)
  }

  // HUD state.
  const inLane = combat.inLane()
  hud.setLane(inLane)
  hud.setWindowed(anyWindowOpen())
  currentPrompt = combat.inCombat() ? null : findPrompt()
  hud.prompt(currentPrompt)
  hud.setTraining(!!training.activeZone() && !combat.inCombat())
  hud.update()
  for (let i = timers.length - 1; i >= 0; i--) {
    if (performance.now() >= timers[i].at) {
      const t = timers[i]
      timers.splice(i, 1)
      t.fn()
    }
  }

  setCameraScale(scaleNow, 0.7 + 0.25 * scaleNow, camera.aspect < 1 ? Math.min(1.45, 0.75 / Math.max(camera.aspect, 0.4) + 0.2) : 1)
  updateCamera(camera, dt)
  fx.update(dt)
  bars.update()
  world.update(dt, elapsed)
  hub.update(dt, elapsed)
  lane.update(dt, elapsed, p)
  lighting.update(dt, octo.group.position)
  updateAudio(dt, {
    camera,
    player: { x: p.x, y: p.y, z: p.z, vy: player.velocity.y, grounded: player.grounded, speed },
    area: inLane ? 'lane' : 'hub',
    windowOpen: anyWindowOpen(),
    combat: combat.inCombat(),
  })
  if (draw) postfx.render()

  if (shownLoading) {
    readySince += dt
    if (avatarReady || readySince > 5) {
      shownLoading = false
      bloxity.notifyFirstFrame()
    }
  }
}
renderer.setAnimationLoop(() => frame())

window.addEventListener('beforeunload', bloxity.teardown)

// Dev-only console hook, e.g. __game.teleport(0, 0, -60) or __game.give(1000)
if (import.meta.env.DEV) {
  const teleport = (x, y, z, facing = player.facing) => {
    resetPlayer({ x, y, z }, facing)
    syncYawToPlayer()
  }
  window.__game = {
    player,
    scene,
    renderer,
    camera,
    postfx,
    state,
    combat,
    hub,
    lane,
    octo,
    bodies: bodyCount,
    toggleMode,
    teleport,
    give: (n) => addWins(n, { boosted: false }),
    levels: (n) => {
      state.level = Math.min(levelCap(), state.level + n)
      state.xp = 0
      emit('xp')
      emit('level', n)
    },
    reset: () => {
      combat.reset()
      resetProgress()
      teleportHome()
    },
    tentacles: TENTACLES,
    HUB,
    // Steps the game by hand (the loop pauses while the tab is hidden): __game.sim(3)
    sim(seconds, step = 1 / 60) {
      const n = Math.round(seconds / step)
      for (let i = 0; i < n; i++) frame(step, i === n - 1)
      clock.getDelta()
    },
  }
}
