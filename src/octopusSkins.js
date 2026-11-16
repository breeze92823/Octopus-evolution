// Octopus skins: canvas-painted textures + wet physical materials for the
// tentacles, the mantle and the optional spikes, one set per TENTACLES entry
// (cached by id, so swapping skins is free after the first time).
//
// Tentacle texture layout: u runs AROUND the tube (u = 0 is the top / dorsal
// line, u = 0.5 the belly that faces the ground), v runs ALONG it. One tile
// covers two circumferences of length, so the canvas is twice as tall as wide
// and its pixels are square on the tentacle. The belly band carries two
// staggered rows of round suckers, painted into the colour map and, as relief,
// into a height map that becomes the normal map. Patterns (def.pattern) are
// painted over the dorsal side; glowing patterns also go into an emissive map
// bright enough to clear the bloom threshold.
import { CanvasTexture, Color, MeshBasicMaterial, MeshPhysicalMaterial, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three'
import { mulberry32 } from './textures.js'

// --- Tunables -----------------------------------------------------------------------
export const SKIN = {
  armW: 128, // canvas px around the tentacle
  armH: 256, // canvas px along one tile (= two circumferences)
  mantleW: 256,
  mantleH: 128,
  suckerRows: 10, // per column per tile
  suckerRadius: 7.5, // px
  armNormal: 3.2, // height -> normal strength
  mantleNormal: 2,
  roughness: 0.36,
  clearcoat: 0.8,
  clearcoatRoughness: 0.1,
  // emissiveIntensity per glowing pattern (bloom threshold is 2.0 linear luminance)
  glow: { glowspots: 3.6, crystal: 1.1, lava: 6.5, galaxy: 3.2, grid: 4.2 },
}

const cache = new Map() // def.id -> { arm, mantle, spike }

const cnv = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function hashId(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

const tmpA = new Color()
const tmpB = new Color()
// CSS colour of hex shaded toward black (k < 0) or white (k > 0).
function shade(hex, k, alpha = 1) {
  tmpA.set(hex)
  if (k < 0) tmpA.multiplyScalar(1 + k)
  else tmpA.lerp(tmpB.set('#ffffff'), k)
  return `rgba(${Math.round(tmpA.r * 255)},${Math.round(tmpA.g * 255)},${Math.round(tmpA.b * 255)},${alpha})`
}
function mix(hexA, hexB, t, alpha = 1) {
  tmpA.set(hexA).lerp(tmpB.set(hexB), t)
  return `rgba(${Math.round(tmpA.r * 255)},${Math.round(tmpA.g * 255)},${Math.round(tmpA.b * 255)},${alpha})`
}

// Calls fn(x, y) at (x, y) and at every wrapped copy that could overlap the canvas.
function wrapped(W, H, x, y, r, fn) {
  for (let dx = -W; dx <= W; dx += W) {
    for (let dy = -H; dy <= H; dy += H) {
      const px = x + dx
      const py = y + dy
      if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue
      fn(px, py)
    }
  }
}
function disc(ctx, W, H, x, y, r, style) {
  ctx.fillStyle = style
  wrapped(W, H, x, y, r, (px, py) => {
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  })
}
function radial(ctx, W, H, x, y, r, inner, outer) {
  wrapped(W, H, x, y, r, (px, py) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, inner)
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(px - r, py - r, r * 2, r * 2)
  })
}
// A polyline drawn at every wrapped offset (lines may cross the edges).
function strokePath(ctx, W, H, pts, width, style) {
  ctx.lineWidth = width
  ctx.strokeStyle = style
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let dx = -W; dx <= W; dx += W) {
    for (let dy = -H; dy <= H; dy += H) {
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[i] + dx, pts[i + 1] + dy)
        else ctx.lineTo(pts[i] + dx, pts[i + 1] + dy)
      }
      ctx.stroke()
    }
  }
}

// Tangent-space normal map from a greyscale height canvas (wraps both ways; any aspect).
function normalFromHeight(hc, strength) {
  const W = hc.width
  const H = hc.height
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data
  const out = cnv(W, H)
  const ctx = out.getContext('2d')
  const img = ctx.createImageData(W, H)
  const h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength
      let nx = -dx
      let ny = dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len
      const i = (y * W + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

function texture(c, srgb) {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = SRGBColorSpace
  return t
}

// --- Patterns --------------------------------------------------------------------------
// region: { x0, w } horizontal span the pattern lives in (wrapping), whole height.
// layers: { c: colour ctx, h: height ctx, g: glow ctx, W, H, rand, def, scale }
const rx = (L, region) => region.x0 + L.rand() * region.w

function patMottle(L, region, n) {
  const { c, W, H, rand, def } = L
  for (let i = 0; i < n; i++) {
    const r = (1 + rand() * 3.2) * L.scale
    disc(c, W, H, rx(L, region), rand() * H, r, shade(def.colors.base, (rand() - 0.55) * 0.22, 0.35))
  }
}

function patSpots(L, region, glow) {
  const { c, h, g, W, H, rand, def } = L
  const C = def.colors
  const n = Math.round(30 * L.area)
  for (let i = 0; i < n; i++) {
    const x = rx(L, region)
    const y = rand() * H
    const r = (4 + rand() * 7) * L.scale
    disc(c, W, H, x, y, r * 1.18, shade(C.accent, -0.25, 0.55))
    disc(c, W, H, x, y, r, C.accent)
    disc(c, W, H, x - r * 0.25, y - r * 0.25, r * 0.45, shade(C.accent, 0.25, 0.6))
    radial(h, W, H, x, y, r * 1.2, 'rgba(255,255,255,0.35)', 'rgba(128,128,128,0)')
    if (glow) {
      radial(g, W, H, x, y, r * 2.2, shade(C.glow, 0, 0.45), 'rgba(0,0,0,0)')
      disc(g, W, H, x, y, r * 0.9, C.glow)
    }
  }
}

function patStripes(L, region) {
  const { c, h, W, H, def } = L
  const lines = L.mantle ? [0.06, 0.19, 0.31, 0.44, 0.56, 0.69, 0.81, 0.94] : [0, 0.16, -0.16]
  for (const u of lines) {
    const pts = []
    const x0 = (L.mantle ? u : u + region.x0 / W + region.w / W / 2) * W
    for (let y = 0; y <= H; y += 8) pts.push(x0 + Math.sin((y / H) * Math.PI * 4) * 3 * L.scale, y)
    const wide = u === 0 || L.mantle ? 9 : 5
    strokePath(c, W, H, pts, wide * L.scale, def.colors.accent)
    strokePath(c, W, H, pts, wide * 0.4 * L.scale, shade(def.colors.accent, -0.2))
    strokePath(h, W, H, pts, wide * L.scale, 'rgba(255,255,255,0.25)')
  }
}

function patBands(L) {
  const { c, h, W, H, def } = L
  const n = L.mantle ? 3 : 4
  const bh = (H / n) * 0.42
  for (let i = 0; i < n; i++) {
    const y = (i / n) * H + (L.mantle ? H * 0.2 : 0)
    const grad = c.createLinearGradient(0, y, 0, y + bh)
    grad.addColorStop(0, shade(def.colors.accent, -0.15))
    grad.addColorStop(0.2, def.colors.accent)
    grad.addColorStop(0.75, def.colors.accent)
    grad.addColorStop(1, shade(def.colors.accent, -0.2))
    c.fillStyle = grad
    c.fillRect(0, y, W, bh)
    h.fillStyle = 'rgba(255,255,255,0.12)'
    h.fillRect(0, y, W, bh)
  }
}

function patCrystal(L, region) {
  const { c, h, g, W, H, rand, def } = L
  const C = def.colors
  const n = Math.round(46 * L.area)
  for (let i = 0; i < n; i++) {
    const x = rx(L, region)
    const y = rand() * H
    const s = (6 + rand() * 12) * L.scale
    const pts = []
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2
      pts.push(x + Math.cos(a) * s, y + Math.sin(a) * s)
    }
    const fill = rand() < 0.5 ? shade(C.base, -0.18, 0.55) : shade(C.base, 0.45, 0.5)
    for (const off of [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H]]) {
      c.beginPath()
      c.moveTo(pts[0] + off[0], pts[1] + off[1])
      c.lineTo(pts[2] + off[0], pts[3] + off[1])
      c.lineTo(pts[4] + off[0], pts[5] + off[1])
      c.closePath()
      c.fillStyle = fill
      c.fill()
    }
    strokePath(c, W, H, [pts[0], pts[1], pts[2], pts[3]], 1.2 * L.scale, 'rgba(255,255,255,0.8)')
    strokePath(h, W, H, [pts[0], pts[1], pts[2], pts[3]], 2 * L.scale, 'rgba(255,255,255,0.5)')
    strokePath(g, W, H, [pts[0], pts[1], pts[2], pts[3]], 2.2 * L.scale, shade(C.glow, 0, 0.5))
  }
}

function patLava(L, region) {
  const { c, h, g, W, H, rand, def } = L
  const C = def.colors
  // Rocky blotches first.
  for (let i = 0; i < 70 * L.area; i++) {
    disc(c, W, H, rx(L, region), rand() * H, (3 + rand() * 9) * L.scale, shade(C.base, (rand() - 0.4) * 0.5, 0.5))
  }
  const cracks = Math.round(16 * L.area)
  for (let i = 0; i < cracks; i++) {
    let x = rx(L, region)
    let y = rand() * H
    let a = rand() * Math.PI * 2
    const pts = [x, y]
    const steps = 6 + Math.floor(rand() * 10)
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 1.3
      x += Math.cos(a) * 5 * L.scale
      y += Math.sin(a) * 5 * L.scale
      pts.push(x, y)
    }
    strokePath(c, W, H, pts, 3.2 * L.scale, shade(C.accent, -0.3))
    strokePath(c, W, H, pts, 1.6 * L.scale, shade(C.accent, 0.35))
    strokePath(h, W, H, pts, 3.5 * L.scale, 'rgba(0,0,0,0.7)')
    strokePath(g, W, H, pts, 6 * L.scale, shade(C.glow, -0.4, 0.35))
    strokePath(g, W, H, pts, 2.2 * L.scale, C.glow)
    strokePath(g, W, H, pts, 1 * L.scale, '#ffd27a')
  }
}

function patGalaxy(L, region) {
  const { c, g, W, H, rand, def } = L
  const C = def.colors
  const nebula = [C.accent, '#4fd0ff', C.glow, '#ff7a59']
  for (let i = 0; i < 14 * L.area; i++) {
    const col = nebula[i % nebula.length]
    const x = rx(L, region)
    const y = rand() * H
    const r = (18 + rand() * 30) * L.scale
    radial(c, W, H, x, y, r, shade(col, 0, 0.55), shade(col, 0, 0))
    radial(g, W, H, x, y, r, shade(col, -0.2, 0.22), shade(col, 0, 0))
  }
}
function patStars(L) {
  const { c, g, W, H, rand } = L
  for (let i = 0; i < 90 * L.area; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = (0.5 + rand() * rand() * 1.8) * L.scale
    disc(c, W, H, x, y, r, '#ffffff')
    disc(g, W, H, x, y, r * 1.1, '#ffffff')
    if (rand() < 0.08) {
      const s = r * 5
      strokePath(g, W, H, [x - s, y, x + s, y], 0.8 * L.scale, 'rgba(255,255,255,0.9)')
      strokePath(g, W, H, [x, y - s, x, y + s], 0.8 * L.scale, 'rgba(255,255,255,0.9)')
    }
  }
}

function patGrid(L, faint = false) {
  const { c, h, g, W, H, rand, def } = L
  const C = def.colors
  const step = 16 * L.scale
  const alpha = faint ? 0.35 : 0.9
  for (let x = 0; x < W; x += step) {
    strokePath(c, W, H, [x, -2, x, H + 2], 1.3 * L.scale, shade(C.accent, -0.2, alpha))
    strokePath(g, W, H, [x, -2, x, H + 2], 1.3 * L.scale, shade(C.glow, -0.3, alpha))
  }
  for (let y = 0; y < H; y += step) {
    strokePath(c, W, H, [-2, y, W + 2, y], 1.3 * L.scale, shade(C.accent, -0.2, alpha))
    strokePath(g, W, H, [-2, y, W + 2, y], 1.3 * L.scale, shade(C.glow, -0.3, alpha))
  }
  if (faint) return
  // Circuit traces: L-shaped runs between grid nodes, with bright pads.
  for (let i = 0; i < 18 * L.area; i++) {
    const x = Math.floor(rand() * (W / step)) * step
    const y = Math.floor(rand() * (H / step)) * step
    const x2 = x + (rand() < 0.5 ? -1 : 1) * step * (1 + Math.floor(rand() * 2))
    const y2 = y + (rand() < 0.5 ? -1 : 1) * step * (1 + Math.floor(rand() * 3))
    strokePath(c, W, H, [x, y, x2, y, x2, y2], 2.4 * L.scale, C.accent)
    strokePath(g, W, H, [x, y, x2, y, x2, y2], 2.6 * L.scale, C.glow)
    strokePath(h, W, H, [x, y, x2, y, x2, y2], 2.6 * L.scale, 'rgba(255,255,255,0.4)')
    disc(c, W, H, x2, y2, 2.6 * L.scale, '#d8ffe2')
    disc(g, W, H, x2, y2, 3 * L.scale, '#ffffff')
  }
}

function paintPattern(L, region) {
  const p = L.def.pattern
  if (p !== 'galaxy' && p !== 'grid') patMottle(L, region, Math.round(260 * L.area))
  if (p === 'spots') patSpots(L, region, false)
  else if (p === 'glowspots') patSpots(L, region, true)
  else if (p === 'stripes') patStripes(L, region)
  else if (p === 'bands') patBands(L)
  else if (p === 'crystal') patCrystal(L, region)
  else if (p === 'lava') patLava(L, region)
  else if (p === 'galaxy') patGalaxy(L, region)
  else if (p === 'grid') patGrid(L)
}

function layers(def, W, H, scale, mantle) {
  const col = cnv(W, H)
  const hgt = cnv(W, H)
  const glo = cnv(W, H)
  const L = {
    def,
    W,
    H,
    scale,
    mantle,
    area: (W * H) / (128 * 256),
    rand: mulberry32(hashId(def.id) + (mantle ? 77 : 0)),
    c: col.getContext('2d'),
    h: hgt.getContext('2d'),
    g: glo.getContext('2d'),
    canvases: { col, hgt, glo },
  }
  L.h.fillStyle = '#808080'
  L.h.fillRect(0, 0, W, H)
  L.g.fillStyle = '#000000'
  L.g.fillRect(0, 0, W, H)
  return L
}

// --- Tentacle canvas -------------------------------------------------------------------------
function paintArm(def) {
  const W = SKIN.armW
  const H = SKIN.armH
  const L = layers(def, W, H, 1, false)
  const { c, h, g } = L
  const C = def.colors

  // Dorsal shading -> base -> belly across u (u = 0 / 1 is the top line).
  const grad = c.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, shade(C.base, -0.2))
  grad.addColorStop(0.18, C.base)
  grad.addColorStop(0.3, shade(C.base, 0.06))
  grad.addColorStop(0.7, shade(C.base, 0.06))
  grad.addColorStop(0.82, C.base)
  grad.addColorStop(1, shade(C.base, -0.2))
  c.fillStyle = grad
  c.fillRect(0, 0, W, H)

  // Pattern over the dorsal side (centred on u = 0, wrapping).
  paintPattern(L, { x0: -0.36 * W, w: 0.72 * W })

  // Belly band over whatever spilled: soft-edged, slightly translucent at its edges.
  const belly = c.createLinearGradient(0, 0, W, 0)
  belly.addColorStop(0.28, mix(C.base, C.belly, 0, 0))
  belly.addColorStop(0.37, mix(C.base, C.belly, 0.85, 1))
  belly.addColorStop(0.5, C.belly)
  belly.addColorStop(0.63, mix(C.base, C.belly, 0.85, 1))
  belly.addColorStop(0.72, mix(C.base, C.belly, 0, 0))
  c.fillStyle = belly
  c.fillRect(0, 0, W, H)
  const hb = h.createLinearGradient(0, 0, W, 0)
  hb.addColorStop(0.28, 'rgba(128,128,128,0)')
  hb.addColorStop(0.37, 'rgba(128,128,128,1)')
  hb.addColorStop(0.63, 'rgba(128,128,128,1)')
  hb.addColorStop(0.72, 'rgba(128,128,128,0)')
  h.fillStyle = hb
  h.fillRect(0, 0, W, H)
  const gb = g.createLinearGradient(0, 0, W, 0)
  gb.addColorStop(0.3, 'rgba(0,0,0,0)')
  gb.addColorStop(0.38, 'rgba(0,0,0,0.85)')
  gb.addColorStop(0.62, 'rgba(0,0,0,0.85)')
  gb.addColorStop(0.7, 'rgba(0,0,0,0)')
  g.fillStyle = gb
  g.fillRect(0, 0, W, H)

  // Fine skin wrinkles across the belly.
  for (let i = 0; i < 40; i++) {
    const y = L.rand() * H
    strokePath(c, W, H, [W * 0.36, y, W * 0.64, y + (L.rand() - 0.5) * 6], 0.8, shade(C.belly, -0.12, 0.5))
  }

  // Suckers: two staggered columns either side of the belly line.
  const rows = SKIN.suckerRows
  const rs = SKIN.suckerRadius
  for (let col = 0; col < 2; col++) {
    const x = W * (col === 0 ? 0.425 : 0.575)
    for (let i = 0; i < rows; i++) {
      const y = ((i + (col ? 0.5 : 0)) / rows) * H
      const r = rs * (0.92 + L.rand() * 0.16)
      disc(c, W, H, x, y, r * 1.12, shade(C.belly, -0.18, 0.55)) // soft shadow ring
      disc(c, W, H, x, y, r, shade(C.belly, 0.16))
      disc(c, W, H, x, y, r * 0.66, shade(C.belly, -0.07))
      disc(c, W, H, x, y, r * 0.3, shade(C.belly, -0.32))
      disc(c, W, H, x - r * 0.35, y - r * 0.35, r * 0.18, 'rgba(255,255,255,0.55)')
      // Relief: raised rim, cupped middle, deep centre.
      radial(h, W, H, x, y, r * 1.25, 'rgba(255,255,255,0)', 'rgba(128,128,128,0)')
      disc(h, W, H, x, y, r, 'rgb(225,225,225)')
      disc(h, W, H, x, y, r * 0.72, 'rgb(150,150,150)')
      disc(h, W, H, x, y, r * 0.34, 'rgb(40,40,40)')
    }
  }

  if (def.pattern === 'galaxy') patStars(L)
  if (def.pattern === 'grid') patGrid(L, true)
  return L.canvases
}

// --- Mantle canvas -------------------------------------------------------------------------------
function paintMantle(def) {
  const W = SKIN.mantleW
  const H = SKIN.mantleH
  const L = layers(def, W, H, 1.25, true)
  const { c } = L
  const C = def.colors
  // Canvas top = top of the dome: darker crown, paler toward the underside.
  const grad = c.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, shade(C.base, -0.16))
  grad.addColorStop(0.45, C.base)
  grad.addColorStop(0.8, mix(C.base, C.belly, 0.35))
  grad.addColorStop(1, mix(C.base, C.belly, 0.7))
  c.fillStyle = grad
  c.fillRect(0, 0, W, H)
  paintPattern(L, { x0: 0, w: W })
  if (def.pattern === 'galaxy') patStars(L)
  return L.canvases
}

// --- Materials ----------------------------------------------------------------------------------------
function glowing(def) {
  return !!def.colors.glow && SKIN.glow[def.pattern] !== undefined
}

function physical(def, maps, normalStrength) {
  const crystal = def.pattern === 'crystal'
  const m = new MeshPhysicalMaterial({
    color: '#ffffff',
    map: texture(maps.col, true),
    normalMap: texture(normalFromHeight(maps.hgt, normalStrength), false),
    normalScale: new Vector2(0.9, 0.9),
    roughness: crystal ? 0.14 : SKIN.roughness,
    metalness: def.metal ?? 0,
    clearcoat: crystal ? 1 : SKIN.clearcoat,
    clearcoatRoughness: crystal ? 0.04 : SKIN.clearcoatRoughness,
    sheen: def.metal ? 0 : 0.25,
    sheenColor: new Color(def.colors.belly),
    sheenRoughness: 0.5,
  })
  if (crystal || def.pattern === 'galaxy') {
    m.iridescence = crystal ? 0.55 : 0.3
    m.iridescenceIOR = 1.4
  }
  if (glowing(def)) {
    m.emissive = new Color('#ffffff')
    m.emissiveMap = texture(maps.glo, true)
    m.emissiveIntensity = SKIN.glow[def.pattern]
  }
  return m
}

function spikeMaterial(def) {
  const C = def.colors
  const p = def.pattern
  const m = new MeshPhysicalMaterial({
    color: p === 'crystal' ? '#f2fdff' : p === 'lava' ? '#2a120a' : p === 'grid' ? '#0c2a14' : C.accent,
    roughness: p === 'crystal' ? 0.08 : 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
  if (p === 'crystal') {
    m.iridescence = 0.8
    m.emissive = new Color(C.glow ?? '#bff4ff')
    m.emissiveIntensity = 0.35
  } else if (C.glow) {
    m.emissive = new Color(C.glow)
    m.emissiveIntensity = p === 'lava' ? 2.4 : 3
  }
  return m
}

// { arm, mantle, spike } materials for a TENTACLES entry.
export function skinMaterials(def) {
  let set = cache.get(def.id)
  if (!set) {
    set = {
      arm: physical(def, paintArm(def), SKIN.armNormal),
      mantle: physical(def, paintMantle(def), SKIN.mantleNormal),
      spike: spikeMaterial(def),
    }
    cache.set(def.id, set)
  }
  return set
}

// Shared eye materials (one set for every octopus).
let eyes = null
export function eyeMaterials() {
  if (!eyes) {
    eyes = {
      white: new MeshPhysicalMaterial({ color: '#fbfbff', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
      pupil: new MeshPhysicalMaterial({ color: '#141022', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }),
      shine: new MeshBasicMaterial({ color: '#ffffff' }),
    }
  }
  return eyes
}
