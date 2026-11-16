// Game audio, the one import the rest of the game uses:
//   import { sfx, installAudio, updateAudio, toggleMuted, isMuted } from './audio/index.js'
// installAudio() once at boot (waits for the first gesture to start), then
// updateAudio(dt, state) every frame (footsteps, jump/land, ambience, combat layer,
// menu ducking) and sfx.<name>() for one-shots. Every button press anywhere gets
// its click here (one capture-phase listener), so menus need no wiring of their own.
import { A, installAudio as installCore, isMuted, onStart, setDucked, setMuted, setVolume, toggleMuted } from './core.js'
import * as sfx from './sfx.js'
import * as ambience from './ambience.js'

export { sfx, setVolume, setMuted, isMuted, toggleMuted }
export const setCombat = ambience.setCombat

// Presses on anything clickable: chunky window buttons press, everything else clicks.
function onPress(e) {
  if (e.button > 0) return
  const b = e.target.closest?.('button, [role="button"]')
  if (!b || b.disabled || b.dataset.silent !== undefined) return
  const pan = Math.max(-0.6, Math.min(0.6, (e.clientX / window.innerWidth - 0.5) * 1.2)) // a press on the left sounds left
  if (b.classList.contains('uiw-btn')) sfx.press(pan)
  else if (b.getAttribute('role') === 'option' || b.closest('[role="listbox"]')) sfx.tick(pan)
  else sfx.click(pan)
}

export function installAudio() {
  installCore()
  // After the core's unlock listener (same phase, registered later), so the context exists.
  window.addEventListener('pointerdown', onPress, { capture: true, passive: true })
}

// Feedback hooks for shared UI pieces (the window shell's replay: 'shake' | 'bump' | 'spend'):
// they wait one task so a specific sound fired in the same handler wins.
export function feedback(kind) {
  setTimeout(() => {
    if (kind === 'shake') return sfx.deny()
    if (sfx.claimedRecently()) return
    if (kind === 'spend') return sfx.purchase()
    if (kind === 'bump') return sfx.equip()
  }, 0)
}

// Per-frame state from main.js:
// { camera, player: { x, y, z, vy, grounded, speed }, area: 'hub' | 'lane', windowOpen, combat }
const prev = { x: 0, y: 0, z: 0, grounded: true, vy: 0, init: false }
let started = false
let stepClock = 0
let stepSide = 1
onStart(() => (started = true))

export function updateAudio(dt, st) {
  if (!started || !A.ctx || A.ctx.state !== 'running' || !st) return
  const p = st.player
  if (p) {
    if (prev.init) {
      if (prev.grounded && !p.grounded && p.vy > 2) sfx.jump()
      if (!prev.grounded && p.grounded && prev.vy < -3) sfx.land(Math.min(1, -prev.vy / 18))
      if (Math.hypot(p.x - prev.x, p.z - prev.z) > 12) sfx.respawnFx() // teleported (pad, respawn)
    }
    // Footsteps: soft wet pats while walking, faster with speed (8 tentacles = a quick patter).
    const speed = p.speed ?? 0
    if (p.grounded && speed > 1) {
      stepClock -= dt
      if (stepClock <= 0) {
        const k = Math.min(1, 0.35 + speed / 18)
        stepSide = -stepSide
        sfx.step(k, stepSide * 0.15)
        stepClock = Math.max(0.12, 0.62 - speed * 0.028) * (0.85 + Math.random() * 0.3)
      }
    } else {
      stepClock = Math.min(stepClock, 0.05)
    }
    prev.x = p.x
    prev.y = p.y
    prev.z = p.z
    prev.grounded = p.grounded
    prev.vy = p.vy
    prev.init = true
  }

  setDucked(!!st.windowOpen)
  ambience.update(dt, { area: st.area ?? 'hub', combat: !!st.combat })
}
