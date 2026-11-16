// Training: standing on an unlocked zone's floor, the octopus keeps lashing that
// zone's dummy; every hit pays XP = tentacle XP x zone multiplier x rebirth boost
// (x2 with the Train potion). Clicking / tapping HIT / pressing E hits faster.
// At the level cap the hits still land but pay nothing and say MAX LEVEL.
import { TRAINING } from './config.js'
import { addXp, atCap, fmt, state, xpPerHit, zoneUnlocked } from './state.js'
import { sfx } from './audio/index.js'
import { Vector3 } from 'three'

const KIND_COLORS = {
  scarecrow: ['#f2d36b', '#c98b3a', '#ffffff'],
  tiki: ['#b87a3a', '#6bd63a', '#ffffff'],
  dojo: ['#e8dca4', '#e0262b', '#ffffff'],
  knight: ['#d9e2ea', '#ffffff', '#3a6fe0'],
  sailor: ['#ffffff', '#3a6fe0', '#a8784a'],
  golem: ['#ff7a1a', '#ffd04a', '#5a4038'],
  astronaut: ['#ffffff', '#b06cff', '#8fd8ff'],
  cloud: ['#ffffff', '#ff7ad9', '#7ad9ff'],
  robot: ['#38ff6a', '#ffffff', '#9affb8'],
}

export function createTraining({ hub, octo, fx, player }) {
  let zone = null
  let auto = 0.25
  let last = -1
  let time = 0
  let maxShownAt = -10
  const events = []
  const v = new Vector3()

  function inZone() {
    const p = player.renderPosition
    for (const z of hub.zones) {
      const b = z.bounds
      if (p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ) return z
    }
    return null
  }

  function hit(z) {
    last = time
    const target = v.set(z.dummyPos.x, z.dummyPos.y, z.dummyPos.z)
    const delay = octo.train(target)
    sfx.whoosh(0.45, 0.3)
    events.push({
      at: time + delay,
      fn: () => {
        z.hit(1)
        const kind = z.def.dummy
        sfx.dummyHit(kind, 1)
        const top = v.set(z.dummyPos.x, z.dummyPos.y + 1.4, z.dummyPos.z)
        fx.sparks(v.set(z.dummyPos.x - 0.3, z.dummyPos.y, z.dummyPos.z), { count: 6, colors: KIND_COLORS[kind] ?? ['#ffffff'], speed: 4.5, size: 0.3, up: 2 })
        fx.shake(0.04)
        if (atCap()) {
          if (time - maxShownAt > 1.1) {
            maxShownAt = time
            fx.number(top, 'MAX LEVEL!', 'max', 1.05)
            sfx.maxLevel()
          }
          return
        }
        const xp = xpPerHit(z.def)
        addXp(xp)
        fx.number(top.set(z.dummyPos.x, z.dummyPos.y + 1.2, z.dummyPos.z), `+${fmt(xp)} XP`, 'xp')
        sfx.xp()
      },
    })
  }

  return {
    get zone() {
      return zone
    },
    // The zone the player is training in (unlocked), or null.
    activeZone: () => (zone && zoneUnlocked(zone.def) ? zone : null),
    // The zone the player stands in whether or not it is unlocked.
    standingIn: () => zone,
    manualHit() {
      const z = zone && zoneUnlocked(zone.def) ? zone : null
      if (!z) return false
      if (time - last >= TRAINING.clickMin) {
        hit(z)
        auto = TRAINING.autoEvery
      }
      return true
    },
    update(dt) {
      time += dt
      zone = inZone()
      if (zone && zoneUnlocked(zone.def)) {
        auto -= dt * (state.train2x > 0 ? 1.15 : 1)
        if (auto <= 0) {
          hit(zone)
          auto = TRAINING.autoEvery
        }
      } else auto = Math.min(auto, 0.25)
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].at <= time) {
          const e = events[i]
          events.splice(i, 1)
          e.fn()
        }
      }
    },
  }
}
