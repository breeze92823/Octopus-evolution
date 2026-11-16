// Training dummies for the hub's zones: one characterful blocky figure per
// zone theme, each on a stand with a red-and-white target on its chest. Built
// facing +Z (hub.js turns them to face the player's side). hit(strength)
// kicks a damped spring that tilts the whole figure back on its stand and
// squashes it, and throws a few themed debris cubes from one shared pooled
// InstancedMesh (initDebris + updateDebris, driven by hub.js).
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { bakeColored } from './worldTextures.js'
import { neon } from './propkit.js'

// --- Tunables ---------------------------------------------------------------------------
export const DUMMY = {
  tiltK: 140, // spring stiffness of the tilt (1/s^2)
  tiltDamp: 9, // damping (1/s)
  tiltKick: 5.5, // rad/s added per hit at strength 1
  tiltMax: 0.6, // rad
  squashK: 260,
  squashDamp: 14,
  squashKick: 3.2,
  debrisPerHit: 5, // + 3 x strength
  debrisPool: 180,
  debrisGravity: 16,
  debrisLife: [0.55, 1.0],
}

const DEBRIS_COLORS = {
  scarecrow: ['#f2c94c', '#e8b93a', '#d93a2f', '#f7dd7a'],
  tiki: ['#9b6a3c', '#7a4a26', '#3f9d2f', '#c8955a'],
  dojo: ['#b07a45', '#d39a5c', '#e0262b', '#f0d2a0'],
  knight: ['#dfe5ee', '#9aa3b2', '#ffd23a', '#ffffff'],
  sailor: ['#ffffff', '#3a6fe0', '#e0262b', '#f2c79a'],
  golem: ['#4a403c', '#ff7a1a', '#ffb02e', '#6a5d57'],
  astronaut: ['#ffffff', '#b06cff', '#ffe066', '#7ad9ff'],
  cloud: ['#ffffff', '#ff7ad9', '#7ad9ff', '#fff27a'],
  robot: ['#9aa3b2', '#38ff6a', '#2a2f36', '#cfd6df'],
}

// --- Shared bits -------------------------------------------------------------------------------
const mats = new Map()
function M(color, extra = {}) {
  const key = color + JSON.stringify(extra)
  let m = mats.get(key)
  if (!m) mats.set(key, (m = new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra })))
  return m
}
const glowMats = new Map()
function G(color, k = 3) {
  const key = color + k
  let m = glowMats.get(key)
  if (!m) glowMats.set(key, (m = neon(color, k)))
  return m
}

let targetMat = null
function targetMaterial() {
  if (targetMat) return targetMat
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  const rings = ['#e3262e', '#ffffff', '#e3262e', '#ffffff', '#e3262e']
  rings.forEach((col, i) => {
    ctx.beginPath()
    ctx.arc(64, 64, 62 - i * 12.5, 0, Math.PI * 2)
    ctx.fillStyle = col
    ctx.fill()
  })
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  targetMat = new MeshStandardMaterial({ map: tex, roughness: 0.6 })
  return targetMat
}

function box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new Mesh(new BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  parent.add(m)
  return m
}
function cyl(parent, mat, rTop, rBot, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 16) {
  const m = new Mesh(new CylinderGeometry(rTop, rBot, h, seg), mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  parent.add(m)
  return m
}
function ball(parent, mat, r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) {
  const m = new Mesh(new IcosahedronGeometry(r, detail), mat)
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  parent.add(m)
  return m
}
function target(parent, r, x, y, z) {
  const m = new Mesh(new CircleGeometry(r, 28), targetMaterial())
  m.position.set(x, y, z)
  parent.add(m)
  return m
}
// Simple face: two dark eyes with white glints.
function eyes(parent, y, z, spread = 0.13, size = 0.09, color = '#1b1b1f') {
  for (const s of [-1, 1]) {
    box(parent, M(color), size, size * 1.3, 0.03, s * spread, y, z)
    box(parent, M('#ffffff'), size * 0.35, size * 0.35, 0.02, s * spread - size * 0.18, y + size * 0.3, z + 0.02)
  }
}
function stand(parent, mat, r = 0.62) {
  cyl(parent, mat, r, r * 1.1, 0.22, 0, 0.11, 0, 0, 0, 0, 20)
}

// --- Builders (local: feet at y 0, facing +Z, chest target around y 1.4) -------------------------
const BUILD = {
  scarecrow(base, body) {
    stand(base, M('#7a4a26'))
    const wood = M('#8a5a30')
    const shirt = M('#d93a2f')
    const straw = M('#f2c94c')
    const sack = M('#d9b57a')
    box(body, wood, 0.18, 1.05, 0.18, 0, 0.72, 0)
    box(body, shirt, 0.92, 0.88, 0.46, 0, 1.46, 0)
    box(body, M('#3a6fe0'), 0.94, 0.16, 0.48, 0, 1.06, 0) // belt
    box(body, wood, 2.0, 0.15, 0.15, 0, 1.72, -0.02)
    for (const s of [-1, 1]) {
      box(body, shirt, 0.5, 0.32, 0.32, s * 0.62, 1.72, 0)
      for (let i = 0; i < 3; i++) box(body, straw, 0.2, 0.06, 0.06, s * (0.95 + i * 0.03), 1.72 + (i - 1) * 0.08, 0.02 * i, 0, 0, s * (i - 1) * 0.5)
    }
    for (let i = 0; i < 5; i++) box(body, straw, 0.06, 0.24, 0.06, -0.3 + i * 0.15, 0.94, 0.18, 0.2, 0, (i - 2) * 0.15)
    box(body, sack, 0.62, 0.6, 0.56, 0, 2.2, 0)
    // stitched X eyes and mouth
    for (const s of [-1, 1]) {
      box(body, M('#3a2410'), 0.16, 0.04, 0.02, s * 0.14, 2.28, 0.29, 0, 0, 0.78)
      box(body, M('#3a2410'), 0.16, 0.04, 0.02, s * 0.14, 2.28, 0.29, 0, 0, -0.78)
    }
    box(body, M('#3a2410'), 0.3, 0.04, 0.02, 0, 2.06, 0.29)
    for (let i = 0; i < 4; i++) box(body, M('#3a2410'), 0.03, 0.08, 0.02, -0.11 + i * 0.075, 2.06, 0.295)
    cyl(body, straw, 0.6, 0.6, 0.06, 0, 2.52, 0, 0, 0, 0, 24)
    cyl(body, straw, 0.33, 0.36, 0.32, 0, 2.7, 0)
    cyl(body, M('#d93a2f'), 0.365, 0.37, 0.09, 0, 2.6, 0)
    target(body, 0.3, 0, 1.46, 0.235)
  },
  tiki(base, body) {
    stand(base, M('#6a4a2a'))
    const wood = M('#a2703f')
    const dark = M('#5a3518')
    box(body, wood, 0.95, 2.0, 0.82, 0, 1.22, 0)
    box(body, dark, 1.0, 0.1, 0.86, 0, 2.22, 0)
    box(body, dark, 1.0, 0.1, 0.86, 0, 0.24, 0)
    // carved face
    for (const s of [-1, 1]) {
      box(body, M('#ffffff'), 0.24, 0.18, 0.04, s * 0.22, 1.9, 0.42)
      box(body, M('#1b1b1f'), 0.1, 0.12, 0.05, s * 0.22, 1.89, 0.43)
      box(body, dark, 0.3, 0.07, 0.05, s * 0.22, 2.05, 0.42, 0, 0, s * -0.25)
    }
    box(body, dark, 0.16, 0.26, 0.08, 0, 1.68, 0.44)
    box(body, dark, 0.62, 0.22, 0.05, 0, 1.36, 0.42)
    for (let i = 0; i < 4; i++) box(body, M('#fff6dd'), 0.1, 0.08, 0.04, -0.21 + i * 0.14, 1.42, 0.445)
    // leaf headdress
    const leaf = M('#3fae2b')
    const leaf2 = M('#2c8a1e')
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.32
      box(body, i % 2 ? leaf : leaf2, 0.2, 1.0, 0.06, Math.sin(a) * 0.4, 2.62 + Math.cos(a) * 0.2, -0.1, 0, 0, -a)
    }
    target(body, 0.3, 0, 0.8, 0.415)
  },
  dojo(base, body) {
    stand(base, M('#5a3518'))
    const wood = M('#b98049')
    cyl(body, wood, 0.34, 0.36, 2.0, 0, 1.22, 0, 0, 0, 0, 18)
    cyl(body, M('#d39a5c'), 0.3, 0.34, 0.2, 0, 2.3, 0, 0, 0, 0, 18)
    // pegs (arms + leg)
    for (const s of [-1, 1]) cyl(body, M('#8a5a30'), 0.06, 0.07, 0.75, s * 0.2, 1.78, 0.4, Math.PI / 2 - 0.25, 0, s * 0.35, 8)
    cyl(body, M('#8a5a30'), 0.07, 0.08, 0.8, 0, 0.72, 0.42, Math.PI / 2 + 0.5, 0, 0, 8)
    // red headband with tails
    cyl(body, M('#e0262b'), 0.355, 0.355, 0.14, 0, 2.08, 0, 0, 0, 0, 18)
    box(body, M('#e0262b'), 0.08, 0.5, 0.04, 0.1, 1.86, -0.38, 0.3, 0, 0.2)
    box(body, M('#e0262b'), 0.08, 0.42, 0.04, -0.06, 1.88, -0.37, 0.35, 0, -0.15)
    eyes(body, 1.98, 0.35, 0.12, 0.08)
    target(body, 0.28, 0, 1.36, 0.355)
  },
  knight(base, body) {
    cyl(base, M('#8d95a3'), 0.62, 0.7, 0.24, 0, 0.12, 0, 0, 0, 0, 8)
    const metal = M('#c3cbd6', { metalness: 0.65, roughness: 0.32 })
    const dark = M('#6c7584', { metalness: 0.6, roughness: 0.4 })
    for (const s of [-1, 1]) box(body, dark, 0.3, 0.75, 0.32, s * 0.2, 0.62, 0)
    box(body, metal, 0.9, 0.88, 0.52, 0, 1.4, 0)
    box(body, M('#3a6fe0'), 0.64, 0.86, 0.04, 0, 1.36, 0.27)
    box(body, M('#ffd23a'), 0.66, 0.08, 0.05, 0, 1.78, 0.275)
    for (const s of [-1, 1]) {
      box(body, metal, 0.42, 0.28, 0.6, s * 0.6, 1.78, 0)
      box(body, dark, 0.26, 0.72, 0.28, s * 0.6, 1.3, 0)
    }
    box(body, metal, 0.64, 0.68, 0.64, 0, 2.18, 0)
    box(body, M('#15181d'), 0.5, 0.06, 0.03, 0, 2.2, 0.33)
    box(body, M('#15181d'), 0.06, 0.26, 0.03, 0, 2.1, 0.33)
    for (let i = 0; i < 4; i++) box(body, M('#e0262b'), 0.12, 0.36 - i * 0.04, 0.16, 0, 2.62 - i * 0.02, -0.12 - i * 0.12, -0.3 - i * 0.2, 0, 0)
    target(body, 0.26, 0, 1.36, 0.295)
  },
  sailor(base, body) {
    stand(base, M('#7a4a26'))
    const white = M('#f6f8fb')
    const navy = M('#1d2b6b')
    const blue = M('#3a6fe0')
    const skin = M('#f2c79a')
    cyl(body, M('#5a3518'), 0.1, 0.1, 0.5, 0, 0.42, 0, 0, 0, 0, 8)
    for (const s of [-1, 1]) box(body, navy, 0.3, 0.55, 0.32, s * 0.2, 0.86, 0)
    box(body, white, 0.88, 0.86, 0.48, 0, 1.52, 0)
    for (let i = 0; i < 3; i++) box(body, blue, 0.9, 0.08, 0.5, 0, 1.22 + i * 0.22, 0)
    box(body, M('#e0262b'), 0.3, 0.3, 0.04, 0, 1.82, 0.25, 0, 0, Math.PI / 4)
    for (const s of [-1, 1]) {
      box(body, white, 0.3, 0.8, 0.32, s * 0.6, 1.5, 0)
      box(body, blue, 0.32, 0.08, 0.34, s * 0.6, 1.32, 0)
      box(body, skin, 0.24, 0.22, 0.24, s * 0.6, 1.02, 0)
    }
    box(body, skin, 0.56, 0.56, 0.52, 0, 2.24, 0)
    eyes(body, 2.28, 0.265, 0.12, 0.08)
    box(body, M('#6b3a1a'), 0.5, 0.18, 0.06, 0, 2.06, 0.25) // beard
    cyl(body, white, 0.34, 0.3, 0.2, 0, 2.6, 0, 0, 0, 0, 18)
    cyl(body, navy, 0.31, 0.31, 0.06, 0, 2.52, 0, 0, 0, 0, 18)
    target(body, 0.27, 0, 1.5, 0.245)
  },
  golem(base, body) {
    cyl(base, M('#3a302c'), 0.7, 0.8, 0.26, 0, 0.13, 0, 0, 0, 0, 7)
    const rock = M('#4f4540', { roughness: 0.95 })
    const rock2 = M('#62574f', { roughness: 0.95 })
    const lava = G('#ff6a00', 3.4)
    for (const s of [-1, 1]) box(body, rock, 0.38, 0.6, 0.4, s * 0.25, 0.55, 0, 0, 0.1 * s, 0)
    box(body, rock2, 1.1, 1.0, 0.66, 0, 1.38, 0, 0, 0.05, 0.03)
    box(body, rock, 0.7, 0.3, 0.6, 0.15, 1.95, -0.05, 0, 0, 0.1)
    for (const s of [-1, 1]) {
      box(body, rock, 0.48, 0.48, 0.5, s * 0.78, 1.7, 0, 0.1, 0, s * 0.2)
      box(body, rock2, 0.42, 0.8, 0.42, s * 0.82, 1.15, 0.05)
    }
    box(body, rock, 0.52, 0.48, 0.48, 0, 2.28, 0.04)
    for (const s of [-1, 1]) box(body, lava, 0.12, 0.07, 0.03, s * 0.12, 2.32, 0.29)
    // glowing cracks
    box(body, lava, 0.05, 0.45, 0.02, -0.38, 1.45, 0.34, 0, 0, 0.4)
    box(body, lava, 0.04, 0.3, 0.02, 0.4, 1.2, 0.34, 0, 0, -0.5)
    box(body, lava, 0.3, 0.04, 0.02, 0.3, 1.62, 0.34, 0, 0, 0.2)
    target(body, 0.28, 0, 1.38, 0.335)
  },
  astronaut(base, body) {
    cyl(base, M('#4a3a8a'), 0.62, 0.7, 0.24, 0, 0.12, 0, 0, 0, 0, 20)
    const suit = M('#f4f6fb')
    const grey = M('#b9c0cc')
    for (const s of [-1, 1]) {
      box(body, suit, 0.32, 0.62, 0.36, s * 0.2, 0.56, 0)
      box(body, grey, 0.34, 0.14, 0.38, s * 0.2, 0.3, 0.02)
    }
    box(body, suit, 0.92, 0.9, 0.56, 0, 1.36, 0)
    box(body, grey, 0.7, 0.9, 0.36, 0, 1.4, -0.42) // backpack
    box(body, M('#3a6fe0'), 0.2, 0.12, 0.04, 0.26, 1.7, 0.29)
    box(body, M('#e0262b'), 0.12, 0.12, 0.04, 0.26, 1.54, 0.29)
    for (const s of [-1, 1]) {
      box(body, suit, 0.32, 0.8, 0.36, s * 0.64, 1.36, 0)
      box(body, grey, 0.34, 0.2, 0.38, s * 0.64, 0.98, 0)
    }
    ball(body, suit, 0.42, 0, 2.18, 0, 1, 1, 1, 2)
    ball(body, M('#1b2546', { metalness: 0.5, roughness: 0.12 }), 0.3, 0, 2.18, 0.22, 1.1, 0.85, 0.6, 2)
    ball(body, M('#ffffff', { roughness: 0.1 }), 0.06, -0.1, 2.28, 0.4)
    target(body, 0.26, -0.12, 1.3, 0.285)
  },
  cloud(base, body) {
    cyl(base, M('#ffd6f2'), 0.62, 0.7, 0.24, 0, 0.12, 0, 0, 0, 0, 20)
    cyl(body, M('#ff9ad9'), 0.1, 0.12, 0.8, 0, 0.6, 0, 0, 0, 0, 10)
    const white = M('#ffffff', { roughness: 0.9 })
    ball(body, white, 0.62, 0, 1.5, 0, 1.1, 0.9, 0.9, 2)
    ball(body, white, 0.42, -0.6, 1.36, 0.05, 1, 0.9, 0.9, 2)
    ball(body, white, 0.44, 0.6, 1.4, 0, 1, 0.9, 0.9, 2)
    ball(body, white, 0.4, -0.25, 1.95, 0, 1, 1, 0.9, 2)
    ball(body, white, 0.36, 0.3, 1.92, -0.05, 1, 1, 0.9, 2)
    for (const s of [-1, 1]) {
      ball(body, M('#2a1a3a'), 0.07, s * 0.18, 1.7, 0.5)
      ball(body, M('#ff9ad9'), 0.08, s * 0.32, 1.56, 0.47, 1, 0.6, 0.5)
    }
    box(body, M('#2a1a3a'), 0.12, 0.04, 0.03, 0, 1.58, 0.53, 0, 0, 0)
    target(body, 0.22, 0, 1.28, 0.56)
  },
  robot(base, body) {
    cyl(base, M('#2a2f36', { metalness: 0.4 }), 0.62, 0.7, 0.24, 0, 0.12, 0, 0, 0, 0, 6)
    const metal = M('#aab3bf', { metalness: 0.7, roughness: 0.3 })
    const dark = M('#2a2f36', { metalness: 0.5, roughness: 0.4 })
    const green = G('#38ff6a', 3)
    cyl(body, dark, 0.12, 0.14, 0.5, 0, 0.42, 0, 0, 0, 0, 8)
    box(body, dark, 0.6, 0.3, 0.5, 0, 0.78, 0)
    box(body, metal, 0.95, 0.95, 0.6, 0, 1.4, 0)
    box(body, dark, 0.7, 0.7, 0.04, 0, 1.4, 0.31)
    for (let i = 0; i < 3; i++) box(body, green, 0.08, 0.04, 0.02, 0.26, 1.65 - i * 0.1, 0.335)
    for (const s of [-1, 1]) {
      box(body, dark, 0.2, 0.2, 0.2, s * 0.58, 1.7, 0)
      box(body, metal, 0.24, 0.8, 0.26, s * 0.66, 1.3, 0)
      box(body, dark, 0.3, 0.2, 0.3, s * 0.66, 0.86, 0)
    }
    box(body, metal, 0.66, 0.54, 0.56, 0, 2.18, 0)
    box(body, dark, 0.52, 0.2, 0.04, 0, 2.22, 0.29)
    for (const s of [-1, 1]) box(body, green, 0.12, 0.08, 0.03, s * 0.12, 2.22, 0.31)
    cyl(body, dark, 0.03, 0.03, 0.4, 0.18, 2.62, 0, 0, 0, 0, 6)
    ball(body, green, 0.07, 0.18, 2.85, 0)
    target(body, 0.22, 0, 1.36, 0.335)
  },
}

// --- Debris pool -------------------------------------------------------------------------------------
let pool = null
const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpS = new Vector3()
const tmpP = new Vector3()
const tmpC = new Color()

export function initDebris(scene) {
  if (pool) return
  const n = DUMMY.debrisPool
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: 0.7 }), n)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.castShadow = false
  tmpM.makeScale(0, 0, 0)
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, tmpM)
    mesh.setColorAt(i, tmpC.set('#ffffff'))
  }
  scene.add(mesh)
  pool = {
    mesh,
    next: 0,
    live: 0,
    parts: Array.from({ length: n }, () => ({ life: 0, max: 1, p: new Vector3(), v: new Vector3(), r: new Vector3(), rv: new Vector3(), s: 0.1, floor: 0 })),
  }
}

function spawnDebris(at, colors, count, floor) {
  if (!pool) return
  for (let k = 0; k < count; k++) {
    const i = pool.next
    pool.next = (pool.next + 1) % pool.parts.length
    const d = pool.parts[i]
    d.max = d.life = DUMMY.debrisLife[0] + Math.random() * (DUMMY.debrisLife[1] - DUMMY.debrisLife[0])
    d.p.set(at.x + (Math.random() - 0.5) * 0.5, at.y + (Math.random() - 0.5) * 0.5, at.z + (Math.random() - 0.5) * 0.5)
    const a = Math.random() * Math.PI * 2
    const sp = 2 + Math.random() * 3.5
    d.v.set(Math.cos(a) * sp, 3.5 + Math.random() * 4, Math.sin(a) * sp)
    d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    d.rv.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16)
    d.s = 0.07 + Math.random() * 0.12
    d.floor = floor
    pool.mesh.setColorAt(i, tmpC.set(colors[Math.floor(Math.random() * colors.length)]))
  }
  pool.mesh.instanceColor.needsUpdate = true
  pool.live = 1.2
}

export function updateDebris(dt) {
  if (!pool || pool.live <= 0) return
  pool.live -= dt
  const g = DUMMY.debrisGravity
  for (let i = 0; i < pool.parts.length; i++) {
    const d = pool.parts[i]
    if (d.life <= 0) {
      if (d.s !== 0) {
        d.s = 0
        tmpM.makeScale(0, 0, 0)
        pool.mesh.setMatrixAt(i, tmpM)
      }
      continue
    }
    pool.live = Math.max(pool.live, 0.1)
    d.life -= dt
    d.v.y -= g * dt
    d.p.addScaledVector(d.v, dt)
    if (d.p.y < d.floor) {
      d.p.y = d.floor
      d.v.y *= -0.35
      d.v.x *= 0.6
      d.v.z *= 0.6
      d.rv.multiplyScalar(0.6)
    }
    d.r.addScaledVector(d.rv, dt)
    const k = Math.min(1, d.life / 0.25) * d.s
    tmpQ.setFromAxisAngle(tmpP.set(d.r.x, d.r.y, d.r.z).normalize(), d.r.length())
    tmpS.set(k, k, k)
    tmpM.compose(d.p, tmpQ, tmpS)
    pool.mesh.setMatrixAt(i, tmpM)
  }
  pool.mesh.instanceMatrix.needsUpdate = true
}

// --- Dummy ---------------------------------------------------------------------------------------------
// Returns { group, hit(strength), update(dt) }. group origin = the stand's foot point.
export function makeDummy(kind) {
  const build = BUILD[kind] ?? BUILD.scarecrow
  const group = new Group()
  group.name = `dummy-${kind}`
  const baseRaw = new Group()
  const bodyRaw = new Group()
  build(baseRaw, bodyRaw)
  const base = bakeColored(baseRaw, true)
  base.traverse((o) => o.isMesh && (o.receiveShadow = true))
  const pivot = new Group() // tilts on the stand
  pivot.position.y = 0.22
  const squash = new Group()
  const body = bakeColored(bodyRaw, true)
  body.position.y = -0.22
  squash.add(body)
  pivot.add(squash)
  group.add(base, pivot)

  const colors = DEBRIS_COLORS[kind] ?? DEBRIS_COLORS.scarecrow
  let tilt = 0
  let tiltV = 0
  let sq = 0
  let sqV = 0
  let side = 1 // alternating sideways wobble
  const at = new Vector3()

  return {
    group,
    hit(strength = 1) {
      const s = Math.max(0.3, Math.min(2.5, strength))
      tiltV += DUMMY.tiltKick * s
      sqV += DUMMY.squashKick * s
      side = -side
      pivot.rotation.z = 0.12 * side * s
      group.updateMatrixWorld()
      group.localToWorld(at.set(0, 1.45, 0.35))
      group.getWorldPosition(tmpP)
      spawnDebris(at, colors, Math.round(DUMMY.debrisPerHit + 3 * s), tmpP.y + 0.05)
    },
    update(dt) {
      if (dt <= 0) return
      const h = Math.min(dt, 1 / 30)
      tiltV += (-DUMMY.tiltK * tilt - DUMMY.tiltDamp * tiltV) * h
      tilt = Math.max(-DUMMY.tiltMax, Math.min(DUMMY.tiltMax, tilt + tiltV * h))
      sqV += (-DUMMY.squashK * sq - DUMMY.squashDamp * sqV) * h
      sq += sqV * h
      // Pushed away from the player (who stands in front, +Z local): the top swings to -Z.
      pivot.rotation.x = -tilt
      pivot.rotation.z *= Math.exp(-6 * h)
      const s = Math.max(-0.35, Math.min(0.35, sq * 0.25))
      squash.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5)
    },
  }
}
