// World kit shared by hub.js and lane.js: the bevelled-tile texture painter
// and the materials built from it, world-space-UV boxes (so every wall and
// floor tiles at the same density and lines up across pieces), canvas
// sprites/planes that repaint once Fredoka loads, and the small voxel props
// (trees, bushes, crystal rocks, fences) both areas scatter.
import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
} from 'three'
import { BufferAttribute } from 'three'
import { bake } from './bake.js'
import { fbm, heightToNormal, mulberry32 } from './textures.js'
import { fontReady } from './propkit.js'

// --- Baking with vertex colours ------------------------------------------------------------
// bake() merges per material; plain untextured opaque colours would still cost one draw
// call each. This first moves every such mesh onto a shared vertex-coloured material (one
// per roughness/metalness pair, the colour written into the geometry), then bakes.
const vcMats = new Map()
function vertexColorMat(roughness, metalness) {
  const key = `${roughness.toFixed(2)}|${metalness.toFixed(2)}`
  let m = vcMats.get(key)
  if (!m) vcMats.set(key, (m = new MeshStandardMaterial({ vertexColors: true, roughness, metalness })))
  return m
}
const plainColor = (m) =>
  m && m.isMeshStandardMaterial && !m.vertexColors && !m.map && !m.normalMap && !m.emissiveMap && !m.transparent && m.emissive.r + m.emissive.g + m.emissive.b === 0 && m.opacity === 1
export function bakeColored(root, castShadow = false) {
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !plainColor(o.material)) return
    const g = o.geometry.clone()
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3)
    const c = o.material.color
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    o.geometry = g
    o.material = vertexColorMat(o.material.roughness, o.material.metalness)
  })
  return bake(root, castShadow)
}

// --- Tunables ---------------------------------------------------------------------------
export const WORLD_KIT = {
  texSize: 256, // px per tile texture
  normalStrength: 2.2,
  normalScale: 0.75,
}

const smooth = (t) => t * t * (3 - 2 * t)
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// --- Bevelled tiles ----------------------------------------------------------------------
// `tiles` square tiles per side, each with a soft inner bevel (lit from the top-left in
// the colour map, real slopes in the normal map) and faint noise. `cells` > 1 groups the
// tiles into a two-tone checker (colors alternate per cell). Tileable.
export function paintBlockTiles({ size = WORLD_KIT.texSize, tiles = 4, colors = ['#52d822'], cells = 1, bevel = 0.14, variance = 0.05, noise = 0.08, rim = 0.12, seed = 1 } = {}) {
  const rand = mulberry32(seed)
  const field = fbm(size, 8, 3, seed + 101)
  const t = size / tiles
  const tint = []
  for (let i = 0; i < tiles * tiles; i++) tint.push(1 + (rand() * 2 - 1) * variance)
  const pal = colors.map(hexRgb)
  const per = Math.max(1, tiles / cells)
  const bev = Math.max(1, t * bevel)
  const heights = new Float32Array(size * size)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    const ty = Math.floor(y / t)
    const ly = y - ty * t
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / t)
      const lx = x - tx * t
      const dl = lx + 0.5
      const dt = ly + 0.5
      const dr = t - lx - 0.5
      const db = t - ly - 0.5
      const m = Math.min(dl, dt, dr, db)
      const b = smooth(Math.min(1, m / bev))
      const base = pal[(Math.floor(tx / per) + Math.floor(ty / per)) % pal.length]
      const i = y * size + x
      const nv = field[i] - 0.5
      let k = tint[ty * tiles + tx] * (0.84 + 0.16 * b)
      if (m < bev) k += (m === dl || m === dt ? rim : -rim) * (1 - b)
      k += nv * noise
      const o = i * 4
      img.data[o] = clamp255(base[0] * k)
      img.data[o + 1] = clamp255(base[1] * k)
      img.data[o + 2] = clamp255(base[2] * k)
      img.data[o + 3] = 255
      heights[i] = b + nv * 0.22
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(heights, size, WORLD_KIT.normalStrength) }
}

export function canvasTex(c, srgb = true) {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = SRGBColorSpace
  return t
}

const tileMats = new Map()
// A tiled PBR material (cached by key). The texture repeats once per `tile` metres of
// a wbox built with the same tile size.
export function tileMat(key, painter, extra = {}) {
  let m = tileMats.get(key)
  if (m) return m
  const p = paintBlockTiles(painter)
  m = new MeshStandardMaterial({
    map: canvasTex(p.color, true),
    normalMap: canvasTex(p.normal, false),
    normalScale: new Vector2(WORLD_KIT.normalScale, WORLD_KIT.normalScale),
    roughness: 0.82,
    metalness: 0,
    ...extra,
  })
  tileMats.set(key, m)
  return m
}

const flatMats = new Map()
// A plain coloured material, shared by colour + options so baking merges it.
export function flat(color, extra = {}) {
  const key = color + JSON.stringify(extra)
  let m = flatMats.get(key)
  if (!m) flatMats.set(key, (m = new MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...extra })))
  return m
}

// The world's shared tiled materials (built once). Tile sizes (m per texture repeat)
// in TILE: pass them to wbox/addBox with the material.
let W = null
export const TILE = { grass: 4, path: 4, checker: 8, yellow: 4, sand: 4, pink: 8, trunk: 2, crystal: 2, stone: 4, wood: 2 }
export function worldMats() {
  if (W) return W
  W = {
    grass: tileMat('grass', { tiles: 4, colors: ['#4fd41f'], bevel: 0.12, variance: 0.045, noise: 0.07, rim: 0.1, seed: 11 }),
    grassDark: tileMat('grassDark', { tiles: 4, colors: ['#38b41a'], bevel: 0.12, variance: 0.05, noise: 0.08, rim: 0.1, seed: 12 }),
    path: tileMat('path', { tiles: 2, colors: ['#c4c1f7'], bevel: 0.07, variance: 0.035, noise: 0.06, rim: 0.09, seed: 13 }),
    pathTrim: tileMat('pathTrim', { tiles: 2, colors: ['#9b96e8'], bevel: 0.08, variance: 0.04, noise: 0.06, rim: 0.1, seed: 14 }),
    checker: tileMat('checker', { tiles: 4, cells: 2, colors: ['#f6a066', '#e07a44'], bevel: 0.08, variance: 0.035, noise: 0.06, rim: 0.1, seed: 15 }),
    checkerDark: tileMat('checkerDark', { tiles: 4, cells: 2, colors: ['#d6824d', '#bb6232'], bevel: 0.08, variance: 0.04, noise: 0.07, rim: 0.1, seed: 16 }),
    yellow: tileMat('yellow', { tiles: 4, colors: ['#ffd43b'], bevel: 0.1, variance: 0.04, noise: 0.06, rim: 0.1, seed: 17 }),
    sand: tileMat('sand', { tiles: 4, cells: 2, colors: ['#f6deac', '#ebca90'], bevel: 0.1, variance: 0.04, noise: 0.08, rim: 0.08, seed: 18 }),
    pink: tileMat('pink', { tiles: 4, cells: 2, colors: ['#ff69cf', '#ff8edd'], bevel: 0.08, variance: 0.03, noise: 0.05, rim: 0.1, seed: 19 }),
    trunk: tileMat('trunk', { tiles: 2, colors: ['#8a5530'], bevel: 0.1, variance: 0.06, noise: 0.1, rim: 0.1, seed: 20 }),
    crystal: tileMat('crystal', { tiles: 2, colors: ['#9a86ff'], bevel: 0.12, variance: 0.05, noise: 0.05, rim: 0.14, seed: 21 }),
    stone: tileMat('stone', { tiles: 2, colors: ['#a3abb9'], bevel: 0.08, variance: 0.06, noise: 0.1, rim: 0.1, seed: 22 }),
    purpleStone: tileMat('purpleStone', { tiles: 2, colors: ['#7b52e6'], bevel: 0.08, variance: 0.05, noise: 0.08, rim: 0.12, seed: 23 }),
    wood: tileMat('wood', { tiles: 2, colors: ['#a8744a'], bevel: 0.06, variance: 0.08, noise: 0.12, rim: 0.08, seed: 24 }),
    gold: tileMat('gold', { tiles: 2, colors: ['#ffcc33'], bevel: 0.1, variance: 0.04, noise: 0.05, rim: 0.12, seed: 25 }, { metalness: 0.35, roughness: 0.45 }),
  }
  return W
}

// --- World-UV boxes ----------------------------------------------------------------------------
// A BoxGeometry already placed at (x, y, z) (and turned by yaw) whose UVs are its
// world coordinates / tile, projected per face axis: tops use (x, -z), sides (z|x, y).
export function wbox(w, h, d, x, y, z, tile = 4, yaw = 0) {
  const g = new BoxGeometry(w, h, d)
  if (yaw) g.rotateY(yaw)
  g.translate(x, y, z)
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    const px = pos.getX(i)
    const py = pos.getY(i)
    const pz = pos.getZ(i)
    let u
    let v
    if (ny >= nx && ny >= nz) {
      u = px
      v = -pz
    } else if (nx >= nz) {
      u = pz * -Math.sign(nor.getX(i))
      v = py
    } else {
      u = px * Math.sign(nor.getZ(i))
      v = py
    }
    uv.setXY(i, u / tile, v / tile)
  }
  return g
}

// Adds a world-UV box mesh (geometry carries the placement; the mesh sits at the origin).
export function addBox(parent, mat, w, h, d, x, y, z, tile = 4, yaw = 0) {
  const m = new Mesh(wbox(w, h, d, x, y, z, tile, yaw), mat)
  parent.add(m)
  return m
}

// Box spanning [x0, x1] x [y0, y1] x [z0, z1].
export function addSpan(parent, mat, x0, x1, y0, y1, z0, z1, tile = 4) {
  return addBox(parent, mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, tile)
}

// A plain mesh (own geometry) placed and turned.
export function addMesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  parent.add(m)
  return m
}

// --- Text on canvases ------------------------------------------------------------------------
export const FONT = (px, weight = 700) => `${weight} ${px}px Fredoka, "Arial Black", sans-serif`

export function outlineText(ctx, text, x, y, px, { fill = '#ffffff', stroke = '#1b1035', lw = null, align = 'center', weight = 700, maxWidth = 0 } = {}) {
  ctx.font = FONT(px, weight)
  if (maxWidth > 0) {
    const w = ctx.measureText(text).width
    if (w > maxWidth) {
      px = Math.floor((px * maxWidth) / w)
      ctx.font = FONT(px, weight)
    }
  }
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const width = lw ?? px * 0.2
  if (width > 0) {
    ctx.lineWidth = width
    ctx.strokeStyle = stroke
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
  return px
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// A small trophy icon centred at (x, y), s = height in px.
export function drawTrophy(ctx, x, y, s) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s / 100, s / 100)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 10
  ctx.strokeStyle = '#3a2200'
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(-30, -44)
    ctx.lineTo(30, -44)
    ctx.quadraticCurveTo(30, 6, 0, 14)
    ctx.quadraticCurveTo(-30, 6, -30, -44)
    ctx.closePath()
  }
  // handles
  ctx.beginPath()
  ctx.arc(-30, -24, 14, Math.PI * 0.5, Math.PI * 1.5)
  ctx.arc(30, -24, 14, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
  ctx.strokeStyle = '#ffcc22'
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.lineWidth = 10
  ctx.strokeStyle = '#3a2200'
  path()
  ctx.stroke()
  ctx.fillStyle = '#ffcc22'
  ctx.fill()
  ctx.fillStyle = '#fff1a6'
  ctx.fillRect(-18, -38, 8, 30)
  // stem + base
  ctx.fillStyle = '#ffcc22'
  ctx.strokeStyle = '#3a2200'
  ctx.strokeRect(-7, 12, 14, 18)
  ctx.fillRect(-7, 12, 14, 18)
  ctx.strokeRect(-24, 30, 48, 14)
  ctx.fillStyle = '#e09a00'
  ctx.fillRect(-24, 30, 48, 14)
  ctx.restore()
}

export function drawStar(ctx, x, y, r, fill = '#ffe14a', stroke = '#3a2200') {
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = r * 0.22
  ctx.strokeStyle = stroke
  ctx.stroke()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

// A camera-facing sprite drawn by draw(ctx, w, h); redraw(next?) repaints it (and it
// repaints itself once the font has loaded). worldHeight = sprite height in metres.
export function canvasSprite(w, h, worldHeight, draw, { depthTest = true } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest, fog: false }))
  sprite.scale.set((worldHeight * w) / h, worldHeight, 1)
  let painter = draw
  const redraw = (next) => {
    if (next) painter = next
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    painter(ctx, w, h)
    tex.needsUpdate = true
  }
  redraw()
  fontReady.then(() => redraw())
  return { sprite, redraw, texture: tex }
}

// A flat plane (faces +Z before you turn it) drawn the same way. Unlit.
export function canvasPlane(w, h, worldW, worldH, draw, { transparent = true, side = DoubleSide } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const mat = new MeshBasicMaterial({ map: tex, transparent, side, depthWrite: !transparent, fog: true })
  const mesh = new Mesh(new PlaneGeometry(worldW, worldH), mat)
  let painter = draw
  const redraw = (next) => {
    if (next) painter = next
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    painter(ctx, w, h)
    tex.needsUpdate = true
  }
  redraw()
  fontReady.then(() => redraw())
  return { mesh, redraw, texture: tex, material: mat }
}

// --- Voxel props ---------------------------------------------------------------------------------
// Blocky pine: a trunk and three stacked leaf slabs (alternating greens), at feet (x, y, z).
export function voxelTree(parent, x, y, z, s = 1, rand = Math.random) {
  const M = worldMats()
  addBox(parent, M.trunk, 0.8 * s, 2.6 * s, 0.8 * s, x, y + 1.3 * s, z, TILE.trunk)
  const tiers = [
    [3.6, 1.5, 2.6],
    [2.7, 1.4, 4.0],
    [1.7, 1.3, 5.3],
  ]
  const jitter = (rand() - 0.5) * 0.3
  tiers.forEach(([w, h, yy], i) => {
    addBox(parent, i % 2 ? M.grassDark : M.grass, w * s, h * s, w * s, x + jitter * i * s, y + yy * s, z - jitter * i * s, TILE.grass)
  })
}

// Leafy round tree: trunk + a cluster of leaf cubes (the hub's flat areas).
export function blobTree(parent, x, y, z, s = 1, rand = Math.random) {
  const M = worldMats()
  addBox(parent, M.trunk, 0.9 * s, 3.2 * s, 0.9 * s, x, y + 1.6 * s, z, TILE.trunk)
  addBox(parent, M.grass, 3.8 * s, 2.6 * s, 3.8 * s, x, y + 4.2 * s, z, TILE.grass)
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2
    const r = 1.6 * s
    const w = (1.6 + rand() * 0.8) * s
    addBox(parent, i % 2 ? M.grassDark : M.grass, w, w, w, x + Math.cos(a) * r, y + (3.4 + rand() * 1.8) * s, z + Math.sin(a) * r, TILE.grass)
  }
}

export function bush(parent, x, y, z, s = 1, rand = Math.random) {
  const M = worldMats()
  const n = 2 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const w = (0.9 + rand() * 0.7) * s
    addBox(parent, i % 2 ? M.grassDark : M.grass, w, w * 0.8, w, x + (rand() - 0.5) * 1.4 * s, y + w * 0.4 + (i > 1 ? 0.4 * s : 0), z + (rand() - 0.5) * 1.4 * s, TILE.grass)
  }
}

export function crystalRock(parent, x, y, z, s = 1, rand = Math.random) {
  const M = worldMats()
  addBox(parent, M.crystal, 1.6 * s, 1.0 * s, 1.4 * s, x, y + 0.5 * s, z, TILE.crystal, rand() * 0.6)
  addBox(parent, M.crystal, 0.9 * s, 1.5 * s, 0.9 * s, x + 0.4 * s, y + 1.2 * s, z + 0.2 * s, TILE.crystal, rand() * 0.6)
  if (rand() < 0.6) addBox(parent, M.crystal, 0.7 * s, 0.6 * s, 0.7 * s, x - 0.8 * s, y + 0.3 * s, z + 0.5 * s, TILE.crystal, rand())
}

// A short broken fence along z (posts + one or two rails, one rail tilted).
export function brokenFence(parent, x, y, z, len = 4, rand = Math.random) {
  const wood = flat('#9b6a3c')
  const posts = Math.max(2, Math.round(len / 1.4))
  for (let i = 0; i < posts; i++) {
    const zz = z - len / 2 + (i * len) / (posts - 1)
    addMesh(parent, new BoxGeometry(0.22, 1.2, 0.22), wood, x, y + 0.6, zz, 0, 0, (rand() - 0.5) * 0.2)
  }
  addMesh(parent, new BoxGeometry(0.12, 0.18, len), wood, x, y + 0.9, z, 0.04, 0, 0)
  addMesh(parent, new BoxGeometry(0.12, 0.18, len * 0.6), wood, x, y + 0.45, z + len * 0.15, 0.35, 0, 0)
}
