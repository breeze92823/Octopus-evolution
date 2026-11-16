// Bandit models: blocky outlaw figures built from rounded boxes on pivot groups,
// animated procedurally (idle, run, wind-up, strike, flinch, flail while grabbed).
// Kinds: thug (cowboy hat + bandana, fists), masked (black hood + ski mask, knife),
// gunner (flat cap + vest, pistol), and boss tiers (big coat, hat/crown, cape).
// Each enemy owns its materials so it can flash white when hit.
import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const geoCache = new Map()
function rbox(w, h, d, r = 0.06) {
  const key = `r${w}|${h}|${d}|${r}`
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)))
  return geoCache.get(key)
}
function box(w, h, d) {
  const key = `b${w}|${h}|${d}`
  if (!geoCache.has(key)) geoCache.set(key, new BoxGeometry(w, h, d))
  return geoCache.get(key)
}
function cyl(rt, rb, h, seg = 20) {
  const key = `c${rt}|${rb}|${h}|${seg}`
  if (!geoCache.has(key)) geoCache.set(key, new CylinderGeometry(rt, rb, h, seg))
  return geoCache.get(key)
}

const SKINS = ['#f2c79a', '#e0a878', '#c98a5a', '#8d5a3a', '#ffd9b5']

// Palettes per kind.
const LOOKS = {
  thug: { name: 'Bandit', shirt: '#8a5a2e', sleeve: '#7a4b22', pants: '#3a5a9a', boots: '#3a2414', hat: '#6b4423', band: '#2a1a0e', scarf: '#d63a2a' },
  masked: { name: 'Masked Bandit', shirt: '#26262e', sleeve: '#1e1e26', pants: '#2c2c34', boots: '#151518', mask: '#141418', blade: '#d9e2ea' },
  gunner: { name: 'Bandit Gunner', shirt: '#e9e2d2', vest: '#4a3528', sleeve: '#e9e2d2', pants: '#4b3b30', boots: '#2a1a10', hat: '#2e2e2e', scarf: '#2a6fd6' },
  boss1: { name: 'Bandit Boss', shirt: '#dfe3ea', coat: '#c9ced8', sleeve: '#c9ced8', pants: '#4a4f5a', boots: '#2a2a2e', hat: '#efefef', band: '#3a3a40', trim: '#8a8f9a' },
  boss2: { name: 'Bandit Warlord', shirt: '#2a2a2a', coat: '#b3261e', sleeve: '#b3261e', pants: '#2a2a2a', boots: '#1a1a1a', hat: '#1e1e1e', band: '#e0a020', trim: '#e0a020', spikes: '#c9ced8' },
  boss3: { name: 'Bandit King', shirt: '#f2e6c8', coat: '#6a2bb8', sleeve: '#6a2bb8', pants: '#2a1a40', boots: '#1a1028', crown: '#ffcc22', trim: '#ffcc22', cape: '#c4122f' },
  giant: { name: 'Giant Bandit', shirt: '#b8742e', coat: '#5a3a1e', sleeve: '#5a3a1e', pants: '#2f4f86', boots: '#24160c', hat: '#3a2414', band: '#d63a2a', trim: '#d6a02a' },
}

function material(color, extra) {
  return new MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra })
}

// Builds one bandit. kind: thug | masked | gunner | boss1 | boss2 | boss3 | giant.
export function buildBandit(kind, seed = Math.random()) {
  const L = LOOKS[kind] ?? LOOKS.thug
  const isBoss = kind.startsWith('boss') || kind === 'giant'
  const mats = []
  const mat = (color, extra) => {
    const m = material(color, extra)
    m.userData.baseEmissive = m.emissive.clone()
    mats.push(m)
    return m
  }
  const skinColor = SKINS[Math.floor(seed * SKINS.length) % SKINS.length]
  const M = {
    skin: mat(skinColor),
    shirt: mat(L.shirt),
    sleeve: mat(L.sleeve),
    pants: mat(L.pants),
    boots: mat(L.boots, { roughness: 0.6 }),
    dark: mat('#1a1a1a', { roughness: 0.4 }),
    white: mat('#ffffff', { roughness: 0.5 }),
  }

  const root = new Group()
  const body = new Group() // bobs and leans; root stays at the feet
  root.add(body)
  const add = (parent, geo, m, x, y, z) => {
    const mesh = new Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }

  // Legs (pivot at the hip).
  const hipY = 0.92
  const legs = []
  for (const side of [-1, 1]) {
    const pivot = new Group()
    pivot.position.set(side * 0.2, hipY, 0)
    add(pivot, rbox(0.36, 0.7, 0.4, 0.05), M.pants, 0, -0.35, 0)
    add(pivot, rbox(0.4, 0.26, 0.5, 0.06), M.boots, 0, -0.8, 0.05)
    body.add(pivot)
    legs.push(pivot)
  }
  // Belt + torso.
  const torso = new Group()
  torso.position.y = hipY
  body.add(torso)
  add(torso, rbox(0.84, 0.86, 0.44, 0.08), M.shirt, 0, 0.45, 0)
  const belt = mat('#3a2412')
  add(torso, box(0.86, 0.12, 0.46), belt, 0, 0.06, 0)
  add(torso, box(0.18, 0.14, 0.04), mat('#e8c048', { metalness: 0.7, roughness: 0.3 }), 0, 0.06, 0.24)

  if (L.vest) {
    const vest = mat(L.vest)
    add(torso, box(0.3, 0.74, 0.46), vest, -0.27, 0.48, 0)
    add(torso, box(0.3, 0.74, 0.46), vest, 0.27, 0.48, 0)
  }
  if (L.coat) {
    const coat = mat(L.coat)
    // Long coat: shell around the torso and two flaps hanging over the thighs.
    add(torso, rbox(0.92, 0.9, 0.5, 0.08), coat, 0, 0.47, -0.01)
    add(torso, box(0.3, 0.62, 0.5), coat, -0.29, -0.28, -0.01)
    add(torso, box(0.3, 0.62, 0.5), coat, 0.29, -0.28, -0.01)
    add(torso, box(0.3, 0.62, 0.06), coat, 0, -0.28, -0.23)
    const trim = mat(L.trim, { metalness: 0.4, roughness: 0.4 })
    add(torso, box(0.08, 0.86, 0.04), trim, -0.12, 0.46, 0.255)
    add(torso, box(0.08, 0.86, 0.04), trim, 0.12, 0.46, 0.255)
    add(torso, box(0.24, 0.42, 0.02), M.shirt, 0, 0.68, 0.252)
  }
  if (L.spikes) {
    const sp = mat(L.spikes, { metalness: 0.8, roughness: 0.25 })
    const cone = new ConeGeometry(0.08, 0.26, 8)
    for (const side of [-1, 1]) {
      add(torso, rbox(0.36, 0.16, 0.5, 0.05), mat('#3a3a3a', { metalness: 0.6, roughness: 0.35 }), side * 0.5, 0.9, 0)
      for (let i = 0; i < 3; i++) add(torso, cone, sp, side * (0.4 + i * 0.09), 1.06, -0.1 + i * 0.1)
    }
  }
  if (L.cape) {
    const cape = add(torso, box(0.9, 1.5, 0.06), mat(L.cape, { roughness: 0.9 }), 0, 0.2, -0.27)
    cape.rotation.x = 0.12
  }

  // Arms (pivot at the shoulder).
  const arms = []
  for (const side of [-1, 1]) {
    const pivot = new Group()
    pivot.position.set(side * 0.58, hipY + 0.8, 0)
    add(pivot, rbox(0.32, 0.62, 0.34, 0.06), M.sleeve, 0, -0.26, 0)
    add(pivot, rbox(0.3, 0.26, 0.32, 0.06), M.skin, 0, -0.68, 0) // hand
    body.add(pivot)
    arms.push(pivot)
  }

  // Head.
  const head = new Group()
  head.position.y = hipY + 0.9
  body.add(head)
  add(head, rbox(0.56, 0.56, 0.54, 0.12), M.skin, 0, 0.3, 0)
  // Angry eyes + brows.
  const eyeY = 0.36
  for (const side of [-1, 1]) {
    add(head, box(0.09, 0.11, 0.02), M.dark, side * 0.13, eyeY, 0.275)
    add(head, box(0.04, 0.04, 0.01), M.white, side * 0.115, eyeY + 0.025, 0.286)
    const brow = add(head, box(0.16, 0.045, 0.03), M.dark, side * 0.13, eyeY + 0.11, 0.28)
    brow.rotation.z = side * -0.35
  }

  if (kind === 'masked') {
    const mask = mat(L.mask, { roughness: 0.95 })
    add(head, rbox(0.6, 0.24, 0.58, 0.1), mask, 0, 0.53, 0) // top of the balaclava
    add(head, rbox(0.6, 0.22, 0.58, 0.1), mask, 0, 0.13, 0) // lower face
    add(head, box(0.6, 0.12, 0.2), mask, 0, 0.34, -0.2) // back
    add(head, box(0.22, 0.1, 0.2), mask, 0, 0.6, -0.05) // pom
    // Hood on the shoulders.
    add(torso, rbox(0.9, 0.18, 0.5, 0.08), mask, 0, 0.92, -0.02)
  }
  if (L.scarf) {
    const scarf = mat(L.scarf, { roughness: 0.9 })
    add(head, box(0.58, 0.2, 0.56), scarf, 0, 0.14, 0.02)
    const tip = add(head, box(0.2, 0.2, 0.04), scarf, 0, 0.0, 0.29)
    tip.rotation.z = Math.PI / 4
  }
  if (kind === 'boss1' || kind === 'boss2' || kind === 'giant') {
    // Mustache.
    const stache = add(head, box(0.34, 0.08, 0.05), M.dark, 0, 0.2, 0.285)
    stache.rotation.z = 0.0
    for (const side of [-1, 1]) {
      const end = add(head, box(0.12, 0.06, 0.05), M.dark, side * 0.2, 0.17, 0.285)
      end.rotation.z = side * 0.5
    }
  }
  if (kind === 'giant') {
    const patch = mat('#111111')
    add(head, box(0.16, 0.16, 0.03), patch, 0.13, eyeY, 0.285)
    const strap = add(head, box(0.62, 0.04, 0.58), patch, 0, 0.42, 0)
    strap.rotation.z = -0.35
  }
  // Hats.
  if (L.hat && kind !== 'masked') {
    const hat = mat(L.hat, { roughness: 0.85 })
    const band = mat(L.band ?? '#222222')
    if (kind === 'gunner') {
      add(head, cyl(0.33, 0.33, 0.14, 20), hat, 0, 0.64, 0) // flat cap
      add(head, box(0.42, 0.04, 0.24), hat, 0, 0.58, 0.32)
    } else {
      const brim = add(head, cyl(0.62, 0.62, 0.05, 28), hat, 0, 0.6, 0)
      brim.scale.set(1, 1, 0.85)
      add(head, cyl(0.27, 0.32, 0.36, 20), hat, 0, 0.8, 0)
      add(head, cyl(0.325, 0.325, 0.08, 20), band, 0, 0.66, 0)
      add(head, box(0.12, 0.08, 0.5), hat, 0, 0.98, 0) // crease
    }
  }
  if (L.crown) {
    const gold = mat(L.crown, { metalness: 0.85, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.4 })
    gold.userData.baseEmissive = gold.emissive.clone()
    add(head, cyl(0.31, 0.31, 0.16, 16), gold, 0, 0.66, 0)
    const spike = new ConeGeometry(0.07, 0.22, 6)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      add(head, spike, gold, Math.sin(a) * 0.27, 0.84, Math.cos(a) * 0.27)
    }
    const gem = mat('#ff2a5a', { emissive: '#ff2a5a', emissiveIntensity: 0.8, roughness: 0.2 })
    gem.userData.baseEmissive = gem.emissive.clone()
    add(head, rbox(0.09, 0.09, 0.05, 0.02), gem, 0, 0.67, 0.31)
  }

  // Weapons in the right hand (the +X arm is the model's left; right hand = arms[0], side -1).
  const hand = arms[0]
  let weapon = null
  if (kind === 'masked') {
    weapon = new Group()
    add(weapon, box(0.07, 0.14, 0.07), mat('#4a2a14'), 0, 0, 0)
    add(weapon, box(0.04, 0.38, 0.1), mat(L.blade, { metalness: 0.9, roughness: 0.15 }), 0, 0.26, 0)
    weapon.position.set(0, -0.74, 0.1)
    weapon.rotation.x = Math.PI / 2.4
    hand.add(weapon)
  } else if (kind === 'gunner') {
    weapon = new Group()
    const metal = mat('#3a3d44', { metalness: 0.8, roughness: 0.3 })
    add(weapon, box(0.08, 0.1, 0.42), metal, 0, 0.02, 0.18)
    add(weapon, box(0.08, 0.2, 0.1), mat('#6b3e1e'), 0, -0.1, 0)
    add(weapon, cyl(0.05, 0.05, 0.12, 10), metal, 0, 0.06, 0.06).rotation.x = Math.PI / 2
    weapon.position.set(0, -0.8, 0.06)
    hand.add(weapon)
  } else if (isBoss) {
    // A big wooden club (bosses smash).
    weapon = new Group()
    const wood = mat(kind === 'boss3' ? '#ffcc22' : '#7a4a22', kind === 'boss3' ? { metalness: 0.8, roughness: 0.3 } : {})
    add(weapon, cyl(0.07, 0.07, 0.5, 10), mat('#3a2412'), 0, 0, 0)
    add(weapon, cyl(0.17, 0.11, 0.85, 12), wood, 0, 0.62, 0)
    if (kind !== 'boss1') {
      const stud = new ConeGeometry(0.05, 0.14, 6)
      const studMat = mat('#d0d4dc', { metalness: 0.8, roughness: 0.3 })
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const s = add(weapon, stud, studMat, Math.sin(a) * 0.17, 0.75, Math.cos(a) * 0.17)
        s.rotation.set(Math.cos(a) * Math.PI / 2, 0, -Math.sin(a) * Math.PI / 2)
      }
    }
    weapon.position.set(0, -0.78, 0.1)
    weapon.rotation.x = Math.PI / 2.2
    hand.add(weapon)
  }

  // Ground shadow blob is the real shadow; nothing else.
  const scale = kind === 'giant' ? 3.1 : isBoss ? 1.9 + (kind === 'boss2' ? 0.15 : kind === 'boss3' ? 0.3 : 0) : 0.95 + seed * 0.12
  root.scale.setScalar(scale)

  const enemy = {
    kind,
    name: L.name,
    boss: isBoss,
    group: root,
    body,
    head,
    torso,
    arms,
    legs,
    weapon,
    mats,
    scale,
    radius: 0.55 * scale,
    height: 2.25 * scale,
    phase: seed * 10,
    flashT: 0,
    flash() {
      this.flashT = 0.16
    },
    // state: idle | run | windup | strike | hurt | grabbed | stunned | dead
    // k: 0..1 progress of windup/strike
    animate(dt, state, speed, k = 0) {
      this.phase += dt * (state === 'run' ? 2.2 + speed * 0.9 : state === 'grabbed' ? 18 : 3)
      const p = this.phase
      const [armR, armL] = arms
      const [legR, legL] = legs
      // Defaults.
      let lr = 0, ll = 0, ar = 0, al = 0, arz = 0.08, alz = -0.08, lean = 0, bob = 0, headX = 0, twist = 0
      if (state === 'run') {
        const s = Math.sin(p)
        const amp = Math.min(1, speed / 4) * 0.85
        lr = s * amp
        ll = -s * amp
        ar = -s * amp * 0.9
        al = s * amp * 0.9
        lean = 0.18 * Math.min(1, speed / 4)
        bob = Math.abs(Math.cos(p)) * 0.07
      } else if (state === 'idle' || state === 'stunned') {
        const s = Math.sin(p * 0.6)
        ar = s * 0.05
        al = -s * 0.05
        bob = s * 0.012
        if (state === 'stunned') {
          twist = Math.sin(p * 3) * 0.25
          headX = 0.3
        }
      } else if (state === 'windup') {
        const e = k * k * (3 - 2 * k)
        if (kind === 'gunner') {
          ar = -Math.PI / 2 * e
          arz = 0.05
          al = -0.6 * e
          lean = -0.05 * e
        } else if (isBoss) {
          ar = -2.7 * e
          al = -2.5 * e
          arz = 0.25 * e
          alz = -0.25 * e
          lean = -0.3 * e
          headX = -0.2 * e
        } else {
          ar = -2.4 * e
          arz = 0.4 * e
          al = 0.5 * e
          lean = -0.2 * e
          twist = 0.35 * e
        }
      } else if (state === 'strike') {
        const e = 1 - Math.pow(1 - k, 3)
        if (kind === 'gunner') {
          ar = -Math.PI / 2 - 0.5 * Math.sin(k * Math.PI) // recoil
          al = -0.6
        } else if (isBoss) {
          ar = -2.7 + 3.6 * e
          al = -2.5 + 3.3 * e
          lean = -0.3 + 0.75 * e
        } else {
          ar = -2.4 + 3.2 * e
          arz = 0.4 - 0.4 * e
          lean = -0.2 + 0.5 * e
          twist = 0.35 - 0.7 * e
        }
      } else if (state === 'hurt') {
        lean = -0.35
        headX = -0.3
        ar = 0.4
        al = 0.4
      } else if (state === 'grabbed') {
        lr = Math.sin(p) * 0.9
        ll = Math.sin(p + 2) * 0.9
        ar = -2.6 + Math.sin(p * 1.3) * 0.6
        al = -2.6 + Math.sin(p * 1.3 + 1.5) * 0.6
        arz = 0.5
        alz = -0.5
      } else if (state === 'dead') {
        ar = -2.9
        al = -2.9
        arz = 0.6
        alz = -0.6
        lr = 0.5
        ll = -0.5
      }
      legR.rotation.x = lr
      legL.rotation.x = ll
      armR.rotation.set(ar, 0, -arz)
      armL.rotation.set(al, 0, -alz)
      body.rotation.set(lean, twist, 0)
      body.position.y = bob
      head.rotation.x = headX

      // Hit flash (emissive white, fading).
      if (this.flashT > 0) {
        this.flashT = Math.max(0, this.flashT - dt)
        const f = this.flashT / 0.16
        for (const m of mats) m.emissive.copy(m.userData.baseEmissive).lerp(WHITE, f * 0.9)
        if (this.flashT === 0) for (const m of mats) m.emissive.copy(m.userData.baseEmissive)
      }
    },
    dispose() {
      root.removeFromParent()
      for (const m of mats) m.dispose()
    },
  }
  return enemy
}

const WHITE = new Color('#ffffff')

// Ground telegraph decals: a translucent red outline with an orange fill that
// grows as the wind-up runs out (rect = melee swing, line = gunshot, circle = boss smash).
export function buildTelegraphPool(scene, count = 16) {
  const rectGeo = new BoxGeometry(1, 0.02, 1)
  rectGeo.translate(0, 0, 0.5) // extends forward from its origin
  const circleGeo = new CylinderGeometry(1, 1, 0.02, 40)
  const pool = []
  for (let i = 0; i < count; i++) {
    const outerMat = new MeshStandardMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.32, depthWrite: false, emissive: '#ff1a1a', emissiveIntensity: 0.6 })
    const fillMat = new MeshStandardMaterial({ color: '#ff8a1a', transparent: true, opacity: 0.55, depthWrite: false, emissive: '#ff5a00', emissiveIntensity: 0.9 })
    const g = new Group()
    const outerRect = new Mesh(rectGeo, outerMat)
    const fillRect = new Mesh(rectGeo, fillMat)
    const outerCirc = new Mesh(circleGeo, outerMat)
    const fillCirc = new Mesh(circleGeo, fillMat)
    fillRect.position.y = fillCirc.position.y = 0.01
    g.add(outerRect, fillRect, outerCirc, fillCirc)
    g.visible = false
    g.renderOrder = 2
    scene.add(g)
    pool.push({ g, outerRect, fillRect, outerCirc, fillCirc, outerMat, fillMat, busy: false })
  }
  return {
    // shape: 'rect' | 'circle'. rect: from (x,z), yaw, length, width. circle: centre (x,z), radius.
    show(shape, x, z, yaw, a, b) {
      const t = pool.find((p) => !p.busy)
      if (!t) return null
      t.busy = true
      t.shape = shape
      t.g.visible = true
      t.g.position.set(x, 0.06, z)
      t.g.rotation.y = yaw
      const rect = shape === 'rect'
      t.outerRect.visible = t.fillRect.visible = rect
      t.outerCirc.visible = t.fillCirc.visible = !rect
      if (rect) {
        t.outerRect.scale.set(b, 1, a)
        t.fillRect.scale.set(b, 1, 0.001)
        t.len = a
        t.wid = b
      } else {
        t.outerCirc.scale.set(a, 1, a)
        t.fillCirc.scale.set(0.001, 1, 0.001)
        t.len = a
      }
      return t
    },
    progress(t, k) {
      if (!t) return
      if (t.shape === 'rect') t.fillRect.scale.set(t.wid, 1, Math.max(0.001, t.len * k))
      else t.fillCirc.scale.set(Math.max(0.001, t.len * k), 1, Math.max(0.001, t.len * k))
      t.fillMat.opacity = 0.45 + 0.35 * k
      t.outerMat.opacity = 0.28 + 0.12 * Math.sin(k * 20)
    },
    hide(t) {
      if (!t) return
      t.busy = false
      t.g.visible = false
    },
    hideAll() {
      for (const p of pool) {
        p.busy = false
        p.g.visible = false
      }
    },
  }
}

