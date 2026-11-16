// The hub: a raised square island in the sea, walled by tall two-tone
// checkered cliffs on the west, north and east (grass caps, voxel trees), open
// to the sea on the south. Lavender tile paths with yellow chevrons lead from
// the Worlds portal (south) to the lane gap (north). Tentacle shop pedestals
// on the west (front row + a raised terrace with stairs), the two special
// pedestals beside the lane gap, nine themed training zones on a long yellow
// platform down the east side (the premium three over a blue pool), and a
// leaderboard pillar in each corner. Everything static is baked into one
// mesh per material; live pieces (pedestal tops, labels, dummies, boards,
// portal swirl, water) stay separate. See buildHub() for the returned API.
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { HUB, SHOP_LAYOUT, TENTACLES, ZONES, ZONE_LAYOUT } from './config.js'
import { RAPIER, addFixed } from './physics.js'
import { bake } from './bake.js'
import { label, neon, solidBox } from './propkit.js'
import { mulberry32, paintFade, paintLaneWater, paintPlanks } from './textures.js'
import {
  TILE,
  addBox,
  bakeColored,
  addMesh,
  addSpan,
  blobTree,
  bush,
  canvasPlane,
  canvasSprite,
  canvasTex,
  crystalRock,
  drawTrophy,
  flat,
  outlineText,
  roundRect,
  tileMat,
  voxelTree,
  worldMats,
} from './worldTextures.js'
import { initDebris, makeDummy, updateDebris } from './dummies.js'

// --- Tunables ----------------------------------------------------------------------------
export const HUB_LOOK = {
  outerHeight: 17, // the stepped outer tier behind the inner walls
  outerDepth: 12,
  capThickness: 0.7,
  boardFace: [6, 9], // leaderboard face, m
  boardCenter: { x: 0, z: 4 }, // boards turn to face this point
  padLabelY: 5.0, // shop label height above the pedestal top
  zoneSignY: 6.0,
  curtainHeight: 3.4,
  waterY: 0.17, // premium pool surface
  zoneFloorY: 0.32,
  stripTop: 0.25, // zone platform collider top
}

const PI = Math.PI

// --- Small painters ------------------------------------------------------------------------------
function paintChevron() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 96
  const ctx = c.getContext('2d')
  ctx.lineJoin = 'round'
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(14, 84)
    ctx.lineTo(64, 22)
    ctx.lineTo(114, 84)
    ctx.lineTo(90, 84)
    ctx.lineTo(64, 52)
    ctx.lineTo(38, 84)
    ctx.closePath()
  }
  path()
  ctx.lineWidth = 8
  ctx.strokeStyle = '#d99a00'
  ctx.stroke()
  ctx.fillStyle = '#ffd816'
  ctx.fill()
  return c
}

function paintTatami() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  const rand = mulberry32(31)
  // Two mats side by side (each 1 x 2 of the 2 m tile), a woven grain and dark bound edges.
  for (const x0 of [0, s / 2]) {
    ctx.fillStyle = '#d8cf8a'
    ctx.fillRect(x0, 0, s / 2, s)
    for (let y = 0; y < s; y += 4) {
      ctx.fillStyle = `rgba(120,110,40,${0.08 + rand() * 0.1})`
      ctx.fillRect(x0, y, s / 2, 2)
    }
    ctx.fillStyle = '#2f4a22'
    ctx.fillRect(x0, 0, 10, s)
    ctx.fillRect(x0 + s / 2 - 10, 0, 10, s)
  }
  return c
}

function paintStars() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  const rand = mulberry32(57)
  ctx.fillStyle = '#1c1240'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 8; i++) {
    const x = rand() * s
    const y = rand() * s
    const r = 30 + rand() * 50
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rand() < 0.5 ? 'rgba(180,90,255,0.35)' : 'rgba(80,160,255,0.3)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (let i = 0; i < 160; i++) {
    const r = rand() < 0.1 ? 2.2 : 1 + rand()
    ctx.fillStyle = rand() < 0.2 ? '#ffd6ff' : '#ffffff'
    ctx.beginPath()
    ctx.arc(rand() * s, rand() * s, r, 0, PI * 2)
    ctx.fill()
  }
  return c
}

function paintGrid() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, s, s)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 6
  ctx.strokeRect(0, 0, s, s)
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(s / 2, 0)
  ctx.lineTo(s / 2, s)
  ctx.moveTo(0, s / 2)
  ctx.lineTo(s, s / 2)
  ctx.stroke()
  return c
}

// --- Portal swirl -----------------------------------------------------------------------------------
const swirlVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const swirlFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float s1 = sin(a * 3.0 + r * 11.0 - uTime * 3.2);
    float s2 = sin(a * 5.0 - r * 16.0 + uTime * 2.1);
    vec3 c1 = vec3(0.35, 0.08, 1.0);
    vec3 c2 = vec3(1.0, 0.3, 0.85);
    vec3 col = mix(c1, c2, 0.5 + 0.5 * s1);
    col *= 0.75 + 0.35 * s2;
    col += vec3(0.75, 0.6, 1.0) * pow(1.0 - r, 3.0) * 2.4;
    float alpha = smoothstep(1.0, 0.86, r) * (0.5 + 0.5 * (1.0 - r));
    gl_FragColor = vec4(col * 1.7, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

// --- Labels ----------------------------------------------------------------------------------------------
function shopLabel(def) {
  let status = 'buy'
  let text = ''
  const lab = canvasSprite(512, 300, 2.7, () => {})
  const draw = (ctx, w, h) => {
    outlineText(ctx, def.name, w / 2, 52, 64, { fill: '#ffffff', stroke: '#2a1238', maxWidth: w - 20 })
    const col = status === 'equipped' ? '#5dff6a' : status === 'owned' ? '#8fd4ff' : '#ffd23a'
    if (status === 'buy' && text) {
      ctx.font = '700 70px Fredoka, "Arial Black", sans-serif'
      const tw = Math.min(w - 120, ctx.measureText(text).width)
      const x0 = w / 2 - (tw + 70) / 2
      drawTrophy(ctx, x0 + 28, 150, 70)
      outlineText(ctx, text, x0 + 70 + tw / 2, 150, 70, { fill: col, stroke: '#2a1238', maxWidth: w - 120 })
    } else outlineText(ctx, text, w / 2, 150, 66, { fill: col, stroke: '#2a1238', maxWidth: w - 20 })
    outlineText(ctx, `+${def.xp.toLocaleString('en-US')} XP`, w / 2, 245, 60, { fill: '#7af6ff', stroke: '#2a1238' })
  }
  lab.redraw(draw)
  return {
    sprite: lab.sprite,
    set(nextStatus, nextText) {
      status = nextStatus
      text = nextText
      lab.redraw()
    },
  }
}

function zoneSign(def) {
  let line2 = 'OPEN'
  let col = '#5dff6a'
  const lab = canvasSprite(512, 280, 2.8, () => {})
  lab.redraw((ctx, w) => {
    outlineText(ctx, `x${def.mult} XP`, w / 2, 92, 120, { fill: '#ffe14a', stroke: '#3a1250', lw: 22 })
    outlineText(ctx, line2, w / 2, 214, 74, { fill: col, stroke: '#2a1238', maxWidth: w - 30 })
  })
  return {
    sprite: lab.sprite,
    set(text, color) {
      line2 = text
      col = color
      lab.redraw()
    },
  }
}

function drawBoard(ctx, w, h, def, rows) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, def.color)
  g.addColorStop(1, def.dark)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  roundRect(ctx, 16, 118, w - 32, h - 134, 18)
  ctx.fill()
  outlineText(ctx, def.title, w / 2, 62, 66, { fill: '#ffffff', stroke: '#2a1640', maxWidth: w - 40 })
  const rowH = (h - 146) / 10
  for (let i = 0; i < 10; i++) {
    const y = 128 + i * rowH
    const r = rows[i]
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)'
    roundRect(ctx, 26, y + 4, w - 52, rowH - 8, 12)
    ctx.fill()
    const cy = y + rowH / 2
    const rank = r?.rank ?? i + 1
    ctx.beginPath()
    ctx.arc(64, cy, rowH * 0.32, 0, PI * 2)
    ctx.fillStyle = ['#ffd23a', '#dfe4ec', '#e8a05e'][rank - 1] ?? '#5a4a7a'
    ctx.fill()
    outlineText(ctx, String(rank), 64, cy + 1, rowH * 0.36, { fill: '#ffffff', stroke: '#2a1640', lw: 6 })
    if (r) {
      outlineText(ctx, String(r.name), 102, cy, rowH * 0.4, { align: 'left', fill: '#ffffff', stroke: '#2a1640', lw: 7, maxWidth: w - 300 })
      outlineText(ctx, String(r.value), w - 42, cy, rowH * 0.4, { align: 'right', fill: '#fff59a', stroke: '#2a1640', lw: 7, maxWidth: 170 })
    } else outlineText(ctx, '---', 102, cy, rowH * 0.4, { align: 'left', fill: 'rgba(255,255,255,0.55)', lw: 0 })
  }
}

// --- Build ---------------------------------------------------------------------------------------------------
export function buildHub(scene) {
  const W = worldMats()
  const rand = mulberry32(777)
  const S = new Group() // static: baked at the end (casts + receives shadows)
  const decals = new Group() // flat ground decals: baked, no shadows
  const dyn = new Group() // live pieces
  dyn.name = 'hub-live'
  scene.add(dyn)
  initDebris(scene)

  const T = HUB.wallThickness
  const OD = HUB_LOOK.outerDepth
  const OH = HUB_LOOK.outerHeight
  const CAP = HUB_LOOK.capThickness
  const sx0 = HUB.minX - T - OD // slab extents
  const sx1 = HUB.maxX + T + OD
  const sz0 = HUB.minZ - T - OD
  const sz1 = HUB.maxZ

  // --- Island ---
  addSpan(S, W.checkerDark, sx0, sx1, -HUB.depth, -0.3, sz0, sz1, TILE.checker)
  addSpan(S, W.grass, sx0, sx1, -0.3, 0, HUB.minZ - T, sz1, TILE.grass)
  solidBox((sx1 - sx0) / 2, 0.5, (sz1 - sz0) / 2, (sx0 + sx1) / 2, -0.5, (sz0 + sz1) / 2)
  solidBox(HUB.maxX + T, HUB.fenceHeight / 2, 0.4, 0, HUB.fenceHeight / 2, sz1 + 0.4)

  // --- Walls: inner tier (wallHeight) + stepped outer tier with trees ---
  const wall = (x0, x1, z0, z1, h, capOut = null, lift = 0) => {
    addSpan(S, W.checker, x0, x1, -1, h, z0, z1, TILE.checker)
    let [cx0, cx1, cz0, cz1] = [x0, x1, z0, z1]
    if (capOut === 'x+') cx1 += 0.3
    if (capOut === 'x-') cx0 -= 0.3
    if (capOut === 'z+') cz1 += 0.3
    addSpan(S, W.grass, cx0, cx1, h - 0.1 + lift, h + CAP - 0.1 + lift, cz0, cz1, TILE.grass)
  }
  const wallH = HUB.wallHeight
  const gap = HUB.laneHalf
  wall(HUB.minX - T, HUB.minX, HUB.minZ - T, sz1, wallH, 'x+')
  wall(HUB.maxX, HUB.maxX + T, HUB.minZ - T, sz1, wallH, 'x-')
  wall(HUB.minX, -gap, HUB.minZ - T, HUB.minZ, wallH, 'z+', 0.02)
  wall(gap, HUB.maxX, HUB.minZ - T, HUB.minZ, wallH, 'z+', 0.02)
  wall(sx0, HUB.minX - T, sz0, sz1, OH)
  wall(HUB.maxX + T, sx1, sz0, sz1, OH)
  wall(HUB.minX - T, -35, sz0, HUB.minZ - T, OH, null, 0.03)
  wall(35, HUB.maxX + T, sz0, HUB.minZ - T, OH, null, 0.03)
  const tall = 15
  solidBox(T / 2, tall, (sz1 - HUB.minZ + T) / 2, HUB.minX - T / 2, tall, (sz1 + HUB.minZ - T) / 2)
  solidBox(T / 2, tall, (sz1 - HUB.minZ + T) / 2, HUB.maxX + T / 2, tall, (sz1 + HUB.minZ - T) / 2)
  solidBox((HUB.minX + gap) / -2, tall, T / 2, (HUB.minX - gap) / 2, tall, HUB.minZ - T / 2)
  solidBox((HUB.maxX - gap) / 2, tall, T / 2, (HUB.maxX + gap) / 2, tall, HUB.minZ - T / 2)
  const ot = OH + CAP - 0.1
  for (let z = sz0 + 6; z < sz1 - 3; z += 11 + rand() * 5) {
    voxelTree(S, sx0 + 4 + rand() * 4, ot, z, 1 + rand() * 0.4, rand)
    voxelTree(S, sx1 - 4 - rand() * 4, ot, z + rand() * 5, 1 + rand() * 0.4, rand)
  }
  for (const side of [-1, 1]) {
    for (let x = 40; x < sx1 - 2; x += 12 + rand() * 5) voxelTree(S, side * x, ot, sz0 + 5 + rand() * 4, 1 + rand() * 0.4, rand)
  }
  const it = wallH + CAP - 0.1
  for (let z = HUB.minZ + 6; z < sz1 - 4; z += 14 + rand() * 6) {
    bush(S, HUB.minX - T / 2, it, z, 0.9, rand)
    bush(S, HUB.maxX + T / 2, it, z + 6, 0.9, rand)
  }

  // --- Paths (rects at slightly different heights where they overlap) ---
  const paths = [
    [-5, 5, HUB.minZ - T, 51, 0.03],
    [-gap, gap, HUB.minZ - T, -38, 0.04],
    [-14, 14, 34, 51, 0.05],
    [-40, 38, -32, -26, 0.05],
    [-29, 38, -3, 3, 0.05],
    [-29, 38, 26, 30, 0.05],
    [-35.5, -28.5, -26, 26, 0.04],
    [36, 40, -40, 40, 0.04],
    [-19, -11, -46, -38, 0.03],
    [11, 19, -46, -38, 0.03],
    [-62, -53, -49, -40, 0.03],
    [53, 62, -49, -40, 0.03],
    [-62, -53, 49, 58, 0.03],
    [53, 62, 49, 58, 0.03],
  ]
  for (const [x0, x1, z0, z1, top] of paths) addSpan(S, W.path, x0, x1, -0.05, top, z0, z1, TILE.path)
  for (const s of [-1, 1]) addSpan(S, W.pathTrim, s > 0 ? 5 : -5.5, s > 0 ? 5.5 : -5, -0.05, 0.045, -38, 34, TILE.path)

  const chevMat = new MeshStandardMaterial({ map: canvasTex(paintChevron()), transparent: true, alphaTest: 0.4, roughness: 0.6, depthWrite: false })
  for (let z = 31; z > -47; z -= 5) {
    if ((z > -33 && z < -25) || (z > -4 && z < 4) || (z > 25 && z < 31)) continue
    const g = new PlaneGeometry(3.4, 2.4)
    g.rotateX(-PI / 2)
    g.translate(0, 0.075, z)
    decals.add(new Mesh(g, chevMat))
  }

  // --- Tentacle shop ---
  const L = SHOP_LAYOUT
  const half = L.pad / 2
  const tx0 = L.backX - 6
  const tx1 = -39.5
  const tz0 = L.zStart - 6
  const tz1 = L.zStart + 4 * L.pitch + 6
  addSpan(S, W.pathTrim, tx0, tx1, -1, L.backY - 0.06, tz0, tz1, TILE.path)
  addSpan(S, W.path, tx0, tx1, L.backY - 0.06, L.backY, tz0, tz1, TILE.path)
  solidBox((tx1 - tx0) / 2, (L.backY + 1) / 2, (tz1 - tz0) / 2, (tx0 + tx1) / 2, (L.backY - 1) / 2, (tz0 + tz1) / 2)
  const steps = Math.max(1, Math.round(L.backY / 0.4))
  const run = 0.75
  for (let k = 1; k <= steps; k++) {
    const top = (L.backY * k) / steps
    const xa = tx1 + run * (steps - k)
    const xb = xa + run
    addSpan(S, k % 2 ? W.path : W.pathTrim, xa, xb, -1, top, tz0, tz1, TILE.path)
    solidBox(run / 2, (top + 1) / 2, (tz1 - tz0) / 2, (xa + xb) / 2, (top - 1) / 2, (tz0 + tz1) / 2)
  }
  // Terrace railing posts on its ends + back.
  const rail = flat('#f2f0ff')
  for (let z = tz0 + 0.5; z <= tz1 - 0.4; z += 2.4) addBox(S, rail, 0.3, 1.0, 0.3, tx0 + 0.4, L.backY + 0.5, z, 2)
  addBox(S, rail, 0.18, 0.18, tz1 - tz0 - 0.6, tx0 + 0.4, L.backY + 0.95, (tz0 + tz1) / 2, 2)
  const shopSign = label('TENTACLE SHOP', 3, { colors: ['#ffe14a'], outline: '#3a1250' })
  shopSign.position.set(tx0 + 3, L.backY + 9, (tz0 + tz1) / 2)
  dyn.add(shopSign)

  const topMats = {
    buy: flat('#ec3340', { roughness: 0.45 }),
    owned: flat('#3a7bff', { roughness: 0.45 }),
    equipped: flat('#33d64a', { roughness: 0.45 }),
  }
  const rimMat = flat('#3b1d2e')
  const shopPads = []
  const specials = []
  const fadeTex = canvasTex(paintFade('#ffffff'))
  const regular = TENTACLES.filter((t) => !t.special)
  const special = TENTACLES.filter((t) => t.special)

  regular.forEach((def, i) => {
    const back = i >= 5
    const x = back ? L.backX : L.frontX
    const y0 = back ? L.backY : 0
    const z = L.zStart + (i % 5) * L.pitch
    addBox(S, rimMat, L.pad + 0.5, 0.24, L.pad + 0.5, x, y0 + 0.12, z, 2)
    const top = new Mesh(new BoxGeometry(L.pad, 0.16, L.pad), topMats.buy)
    top.position.set(x, y0 + 0.32, z)
    top.receiveShadow = true
    dyn.add(top)
    solidBox(half + 0.25, 0.2, half + 0.25, x, y0 + 0.2, z)
    const anchor = new Object3D()
    anchor.position.set(x, y0 + 0.4, z)
    dyn.add(anchor)
    const lab = shopLabel(def)
    lab.sprite.position.set(x, y0 + 0.4 + HUB_LOOK.padLabelY, z)
    dyn.add(lab.sprite)
    shopPads.push(makePad(def, { x, y: y0 + 0.4, z }, half, anchor, top, lab))
  })

  special.forEach((def, i) => {
    const x = (i === 0 ? -1 : 1) * L.specialX
    const z = L.specialZ
    const accent = def.colors.glow ?? def.colors.accent
    addMesh(S, new CylinderGeometry(2.5, 2.7, 0.3, 32), flat('#1a1030', { roughness: 0.4, metalness: 0.3 }), x, 0.15, z)
    const top = new Mesh(new CylinderGeometry(2.15, 2.15, 0.14, 32), topMats.buy)
    top.position.set(x, 0.35, z)
    top.receiveShadow = true
    dyn.add(top)
    const ring = new Mesh(new TorusGeometry(2.38, 0.09, 8, 56), neon(accent, 3))
    ring.rotation.x = PI / 2
    ring.position.set(x, 0.33, z)
    dyn.add(ring)
    const beam = new Mesh(
      new CylinderGeometry(2.05, 2.05, 9, 32, 1, true),
      new MeshBasicMaterial({ color: accent, map: fadeTex, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    )
    beam.position.set(x, 4.9, z)
    dyn.add(beam)
    addFixed(RAPIER.ColliderDesc.cylinder(0.21, 2.7), { x, y: 0.21, z })
    const anchor = new Object3D()
    anchor.position.set(x, 0.42, z)
    dyn.add(anchor)
    const lab = shopLabel(def)
    lab.sprite.position.set(x, 0.42 + HUB_LOOK.padLabelY + 0.6, z)
    dyn.add(lab.sprite)
    const tag = label('SPECIAL', 1.1, { colors: [accent], outline: '#1a0830' })
    tag.position.set(x, 0.42 + HUB_LOOK.padLabelY + 2.4, z)
    dyn.add(tag)
    specials.push({ anchor, ring, beam })
    shopPads.push(makePad(def, { x, y: 0.42, z }, 1.6, anchor, top, lab))
  })

  function makePad(def, center, halfSize, anchor, top, lab) {
    const pad = {
      def,
      center,
      half: halfSize,
      anchor,
      setStatus(status, text) {
        top.material = topMats[status] ?? topMats.buy
        lab.set(status, text ?? (status === 'equipped' ? 'EQUIPPED' : status === 'owned' ? 'OWNED' : `${def.price.toLocaleString('en-US')}`))
      },
    }
    pad.setStatus('buy', def.price === 0 ? 'FREE' : def.price.toLocaleString('en-US'))
    return pad
  }

  // --- Training zones ---
  const Z = ZONE_LAYOUT
  const zhw = Z.width / 2
  const zhd = Z.depth / 2
  const fy = HUB_LOOK.zoneFloorY
  const stripX0 = Z.x - zhw - 2
  const stripX1 = Z.x + zhw + 4
  const zTop = Z.zStart + zhd + 1.2
  const zBot = Z.zStart - (ZONES.length - 1) * Z.pitch - zhd - 1.2
  const firstPremium = ZONES.findIndex((d) => d.price)
  // Boundary between the last regular zone and the first premium one.
  const zPrem = firstPremium >= 0 ? Z.zStart - firstPremium * Z.pitch + Z.pitch / 2 : zBot
  const st = HUB_LOOK.stripTop
  addSpan(S, W.yellow, stripX0, stripX1, -1, st, zPrem, zTop, TILE.yellow)
  if (firstPremium >= 0) {
    const rimW = 0.8
    addSpan(S, W.yellow, stripX0, stripX0 + rimW, -1, st + 0.05, zBot, zPrem, TILE.yellow)
    addSpan(S, W.yellow, stripX1 - rimW, stripX1, -1, st + 0.05, zBot, zPrem, TILE.yellow)
    addSpan(S, W.yellow, stripX0, stripX1, -1, st + 0.05, zBot, zBot + rimW, TILE.yellow)
    addSpan(S, flat('#1552c0'), stripX0 + rimW, stripX1 - rimW, -1, -0.3, zBot + rimW, zPrem, 4)
  }
  solidBox((stripX1 - stripX0) / 2, (st + 1) / 2, (zTop - zBot) / 2, (stripX0 + stripX1) / 2, (st - 1) / 2, (zTop + zBot) / 2)
  let waterTex = null
  if (firstPremium >= 0) {
    waterTex = canvasTex(paintLaneWater('#1a7cf0'))
    waterTex.repeat.set(4, 6)
    const water = new Mesh(
      new PlaneGeometry(stripX1 - stripX0 - 1.6, zPrem - zBot - 0.8),
      new MeshStandardMaterial({ map: waterTex, color: '#9fe0ff', transparent: true, opacity: 0.85, roughness: 0.12, metalness: 0.1 }),
    )
    water.rotation.x = -PI / 2
    water.position.set((stripX0 + stripX1) / 2, HUB_LOOK.waterY, (zPrem + zBot + 0.8) / 2)
    water.receiveShadow = true
    dyn.add(water)
  }

  const floorMats = zoneFloorMaterials()
  const pulse = { lava: [], grid: [floorMats.cyber.mat] }
  const zones = ZONES.map((def, index) => {
    const cz = Z.zStart - index * Z.pitch
    const premium = !!def.price
    const fm = floorMats[def.id] ?? { mat: flat(def.floor), tile: 4 }
    addSpan(S, fm.mat, Z.x - zhw, Z.x + zhw, premium ? -0.3 : 0.15, fy, cz - zhd, cz + zhd, fm.tile)
    const trim = premium ? flat('#ffcc33', { metalness: 0.4, roughness: 0.4 }) : flat(def.theme === '#ffffff' ? '#e0e6f0' : def.theme)
    addSpan(S, trim, Z.x - zhw, Z.x + zhw, fy - 0.05, fy + 0.05, cz - zhd, cz - zhd + 0.18, 2)
    addSpan(S, trim, Z.x - zhw, Z.x + zhw, fy - 0.05, fy + 0.05, cz + zhd - 0.18, cz + zhd, 2)
    addSpan(S, trim, Z.x + zhw - 0.18, Z.x + zhw, fy - 0.05, fy + 0.05, cz - zhd, cz + zhd, 2)
    zoneProps(S, def, Z.x, fy, cz, rand, pulse)

    const dummy = makeDummy(def.dummy)
    dummy.group.position.set(Z.x + Z.dummyDx, fy, cz)
    dummy.group.rotation.y = -PI / 2 // faces west (-X), toward the player's half
    dummy.group.traverse((o) => o.isMesh && (o.castShadow = true))
    dyn.add(dummy.group)
    solidBox(0.55, 1.4, 0.55, Z.x + Z.dummyDx, fy + 1.4, cz)

    const sign = zoneSign(def)
    sign.sprite.position.set(Z.x + 0.5, HUB_LOOK.zoneSignY, cz)
    dyn.add(sign.sprite)

    const curtain = new Mesh(
      new PlaneGeometry(Z.depth, HUB_LOOK.curtainHeight),
      new MeshBasicMaterial({ color: premium ? '#ffcc33' : '#ff4f6a', map: fadeTex, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
    )
    curtain.rotation.y = PI / 2
    curtain.position.set(Z.x - zhw + 0.05, fy + HUB_LOOK.curtainHeight / 2, cz)
    dyn.add(curtain)

    const zone = {
      def,
      index,
      center: { x: Z.x, z: cz },
      bounds: { minX: Z.x - zhw, maxX: Z.x + zhw, minZ: cz - zhd, maxZ: cz + zhd },
      dummyPos: { x: Z.x + Z.dummyDx, y: fy + 1.4, z: cz },
      dummy,
      hit: (strength = 1) => dummy.hit(strength),
      setLock({ locked, text }) {
        curtain.visible = !!locked
        const color = !locked ? '#5dff6a' : premium ? '#ffd23a' : '#ff5a6e'
        sign.set(text ?? (locked ? 'LOCKED' : 'OPEN'), color)
      },
    }
    if (premium) zone.setLock({ locked: true, text: `${def.price.toLocaleString('en-US')} Wins` })
    else if (def.rebirths) zone.setLock({ locked: true, text: `${def.rebirths} Rebirth${def.rebirths > 1 ? 's' : ''}` })
    else zone.setLock({ locked: false, text: 'OPEN' })
    return zone
  })

  // --- Leaderboards ---
  const boardDefs = [
    { key: 'wins', title: 'Most Wins', color: '#ffc21a', dark: '#b06a00', x: -57.5, z: -44.5 },
    { key: 'rebirths', title: 'Most Rebirths', color: '#ff5fcf', dark: '#9c1f74', x: 57.5, z: -44.5 },
    { key: 'playtime', title: 'Most Playtime', color: '#3fa9ff', dark: '#14559c', x: -57.5, z: 53.5 },
    { key: 'stage', title: 'Best Stage', color: '#4fd84a', dark: '#1d7d22', x: 57.5, z: 53.5 },
  ]
  const boards = {}
  for (const def of boardDefs) {
    const yaw = Math.atan2(HUB_LOOK.boardCenter.x - def.x, HUB_LOOK.boardCenter.z - def.z)
    const frame = new Group()
    frame.position.set(def.x, 0, def.z)
    frame.rotation.y = yaw
    const col = flat(def.color, { roughness: 0.5 })
    const dark = flat(def.dark, { roughness: 0.6 })
    addMesh(frame, new BoxGeometry(7.4, 1.2, 2.2), dark, 0, 0.6, -0.3)
    for (const s of [-1, 1]) {
      addMesh(frame, new BoxGeometry(0.9, 11, 1.4), col, s * 3.45, 5.9, -0.3)
      addMesh(frame, new BoxGeometry(1.2, 0.6, 1.7), dark, s * 3.45, 0.9, -0.3)
    }
    addMesh(frame, new BoxGeometry(8.2, 1.4, 1.9), col, 0, 11.6, -0.3)
    addMesh(frame, new BoxGeometry(6.4, 0.5, 1.5), dark, 0, 12.5, -0.3)
    for (const s of [-1, 0, 1]) addMesh(frame, new BoxGeometry(0.8, 0.8, 0.8), col, s * 2.6, 13.1, -0.3, 0, PI / 4, 0)
    addMesh(frame, new BoxGeometry(6.2, 9.6, 0.4), dark, 0, 6.3, -0.55)
    S.add(frame)
    const [fw, fh] = HUB_LOOK.boardFace
    let rows = []
    const face = canvasPlane(512, 768, fw, fh, (ctx, w, h) => drawBoard(ctx, w, h, def, rows), { transparent: false })
    const holder = new Group()
    holder.position.copy(frame.position)
    holder.rotation.y = yaw
    face.mesh.position.set(0, 6.3, -0.33)
    holder.add(face.mesh)
    dyn.add(holder)
    solidBox(3.9, 6.5, 1.1, def.x, 6.5, def.z, yaw)
    boards[def.key] = {
      setRows(next) {
        rows = (next ?? []).slice(0, 10)
        face.redraw()
      },
    }
  }

  // --- Worlds portal (faces north, toward spawn) ---
  const P = HUB.portal
  const portal = new Group()
  portal.position.set(P.x, 0, P.z)
  portal.rotation.y = PI
  const pStone = W.purpleStone
  const pDark = flat('#4a2a9a', { roughness: 0.7 })
  addBox(portal, pDark, 13, 0.4, 5.4, 0, 0.2, 0, 2)
  for (const s of [-1, 1]) {
    addBox(portal, pStone, 2.3, 9.2, 2.6, s * 4.75, 4.8, 0, TILE.crystal)
    addBox(portal, pDark, 2.7, 0.7, 3.0, s * 4.75, 0.75, 0, 2)
    addBox(portal, pDark, 2.7, 0.6, 3.0, s * 4.75, 9.1, 0, 2)
    addBox(portal, pStone, 1.0, 1.4, 2.2, s * 3.2, 8.4, 0, TILE.crystal)
    addBox(portal, pStone, 0.8, 0.8, 2.2, s * 2.4, 9.0, 0, TILE.crystal)
    // lanterns on arms
    addBox(portal, flat('#3a2a1a'), 1.2, 0.2, 0.2, s * 6.3, 5.6, -1.0, 2)
    addMesh(portal, new BoxGeometry(0.7, 0.9, 0.7), neon('#ffd23a', 2.6), s * 6.8, 5.0, -1.0)
    addBox(portal, flat('#2a1a10'), 0.9, 0.15, 0.9, s * 6.8, 5.5, -1.0, 2)
  }
  addBox(portal, pStone, 11.8, 2.2, 2.6, 0, 10.4, 0, TILE.crystal)
  addBox(portal, pDark, 12.4, 0.5, 3.0, 0, 11.6, 0, 2)
  // sign board on posts
  const woodSign = flat('#7a4422', { roughness: 0.8 })
  for (const s of [-1, 1]) addBox(portal, woodSign, 0.4, 2.2, 0.4, s * 3.6, 12.8, 0.2, 2)
  addBox(portal, woodSign, 9.6, 2.6, 0.5, 0, 14.3, 0.2, 2)
  addBox(portal, flat('#4a2410'), 10.0, 0.3, 0.7, 0, 15.65, 0.2, 2)
  S.add(portal)
  const portalLive = new Group()
  portalLive.position.copy(portal.position)
  portalLive.rotation.y = PI
  const swirl = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: swirlVertex,
    fragmentShader: swirlFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mouth = new Mesh(new CircleGeometry(3.5, 48), swirl)
  mouth.position.set(0, 4.7, 0)
  portalLive.add(mouth)
  const pring = new Mesh(new TorusGeometry(3.6, 0.14, 8, 64), neon('#c06bff', 3))
  pring.position.set(0, 4.7, 0)
  portalLive.add(pring)
  const worldsSign = canvasPlane(512, 140, 9.2, 2.5, (ctx, w, h) => {
    outlineText(ctx, 'WORLDS', w / 2, 56, 84, { fill: '#ffd23a', stroke: '#3a1a08', lw: 14 })
    outlineText(ctx, 'TELEPORT', w / 2, 116, 36, { fill: '#ffffff', stroke: '#3a1a08', lw: 8 })
  })
  worldsSign.mesh.position.set(0, 14.3, 0.47)
  portalLive.add(worldsSign.mesh)
  const reqSign = canvasPlane(640, 120, 10.6, 2.0, (ctx, w) => {
    outlineText(ctx, 'UNLOCK WORLD 2', w / 2, 34, 40, { fill: '#ffe14a', stroke: '#1a0830', lw: 9 })
    outlineText(ctx, 'BEAT STAGE 15', w / 2, 86, 56, { fill: '#ffffff', stroke: '#1a0830', lw: 11 })
  })
  reqSign.mesh.position.set(0, 10.4, 1.32)
  portalLive.add(reqSign.mesh)
  dyn.add(portalLive)
  for (const s of [-1, 1]) solidBox(1.15, 4.8, 1.3, P.x + s * 4.75, 4.8, P.z)
  solidBox(5.9, 1.4, 1.3, P.x, 10.6, P.z)

  // --- Greenery ---
  const trees = [
    [-26, -44], [26, -44], [-18, -14], [18, -14], [-18, 16], [20, 16],
    [-22, 44], [24, 44], [-57, -28], [-57, 12], [-57, 34], [-46, 40], [30, -14],
  ]
  for (const [tx, tz] of trees) {
    const x = tx + (rand() - 0.5) * 2
    const z = tz + (rand() - 0.5) * 2
    blobTree(S, x, 0, z, 0.9 + rand() * 0.35, rand)
    solidBox(0.5, 2, 0.5, x, 2, z) // trunk
  }
  const onCross = (z) => Math.abs(z) < 5 || Math.abs(z - 28) < 4 || Math.abs(z + 29) < 4
  for (let z = -36; z < 32; z += 9 + rand() * 4) {
    if (!onCross(z)) bush(S, -7.2, 0, z, 0.75, rand)
    if (!onCross(z + 3)) bush(S, 7.2, 0, z + 3, 0.75, rand)
  }
  for (const [x, z] of [[-30, 40], [32, 36], [-62, 2], [30, -45], [-30, -45], [24, 4]]) crystalRock(S, x, 0, z, 1 + rand() * 0.4, rand)
  // low fence along the open south edge
  const fence = flat('#a8744a')
  for (let x = HUB.minX; x <= HUB.maxX; x += 3) addBox(S, fence, 0.3, 1.1, 0.3, x, 0.55, sz1 - 0.6, 2)
  for (const y of [0.45, 0.9]) addBox(S, fence, HUB.maxX - HUB.minX, 0.16, 0.14, 0, y, sz1 - 0.6, 2)

  // --- Bake ---
  const baked = bakeColored(S, true)
  baked.traverse((o) => o.isMesh && (o.receiveShadow = true))
  baked.name = 'hub-static'
  scene.add(baked)
  const bakedDecals = bake(decals, false)
  bakedDecals.traverse((o) => {
    if (o.isMesh) {
      o.receiveShadow = true
      o.renderOrder = 1
    }
  })
  scene.add(bakedDecals)

  // --- Animate ---
  return {
    zones,
    shopPads,
    boards,
    portal: { x: P.x, z: P.z, radius: 3.5 },
    update(dt, elapsed) {
      swirl.uniforms.uTime.value = elapsed
      pring.rotation.z = elapsed * 0.6
      for (const z of zones) z.dummy.update(dt)
      updateDebris(dt)
      const lava = 0.72 + 0.28 * Math.sin(elapsed * 2.4)
      for (const m of pulse.lava) m.opacity = lava
      const grid = 1.6 + 0.9 * (0.5 + 0.5 * Math.sin(elapsed * 1.7))
      for (const m of pulse.grid) m.emissiveIntensity = grid
      if (waterTex) waterTex.offset.set(elapsed * 0.03, -elapsed * 0.08)
      for (const s of specials) {
        s.anchor.rotation.y += dt * 0.45
        s.ring.rotation.z += dt * 0.8
        s.beam.material.opacity = 0.22 + 0.1 * Math.sin(elapsed * 2.2)
      }
    },
  }
}

// --- Zone floors ------------------------------------------------------------------------------------------------
function zoneFloorMaterials() {
  const planks = paintPlanks(256, 6, 9)
  const grid = canvasTex(paintGrid(), false)
  const stars = canvasTex(paintStars())
  return {
    farm: { mat: tileMat('floor-farm', { tiles: 4, cells: 4, colors: ['#f2d36b', '#e8c452'], bevel: 0.1, noise: 0.12, seed: 41 }), tile: 4 },
    jungle: { mat: tileMat('floor-jungle', { tiles: 4, cells: 2, colors: ['#ecd093', '#dfbe7a'], bevel: 0.1, noise: 0.1, seed: 42 }), tile: 4 },
    dojo: { mat: new MeshStandardMaterial({ map: canvasTex(paintTatami()), roughness: 0.85 }), tile: 4 },
    castle: { mat: tileMat('floor-castle', { tiles: 2, cells: 2, colors: ['#a3abb9', '#8f98a8'], bevel: 0.08, noise: 0.14, seed: 43 }), tile: 4 },
    pirate: { mat: new MeshStandardMaterial({ map: canvasTex(planks.color), normalMap: canvasTex(planks.normal, false), roughness: 0.8 }), tile: 4 },
    volcano: { mat: tileMat('floor-volcano', { tiles: 2, cells: 2, colors: ['#3d2c27', '#2c201c'], bevel: 0.1, noise: 0.25, seed: 44 }, { roughness: 0.95 }), tile: 4 },
    space: { mat: new MeshStandardMaterial({ map: stars, emissiveMap: stars, emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 0.6 }), tile: 6 },
    rainbow: { mat: tileMat('floor-rainbow', { tiles: 4, cells: 4, colors: ['#ffffff', '#eef2ff'], bevel: 0.12, noise: 0.04, seed: 45 }), tile: 4 },
    cyber: { mat: new MeshStandardMaterial({ color: '#0b120e', emissiveMap: grid, emissive: '#38ff6a', emissiveIntensity: 2, roughness: 0.35, metalness: 0.3 }), tile: 2 },
  }
}

// --- Zone props (kept to the east half and the corners; the west half is the player's) --------------------------
function zoneProps(S, def, cx, fy, cz, rand, pulse) {
  const ex = cx + ZONE_LAYOUT.width / 2 // east edge
  const wx = cx - ZONE_LAYOUT.width / 2
  const hd = ZONE_LAYOUT.depth / 2
  const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => addMesh(S, new BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz)
  const cyl = (mat, r0, r1, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 14) => addMesh(S, new CylinderGeometry(r0, r1, h, seg), mat, x, y, z, rx, ry, rz)
  switch (def.id) {
    case 'farm': {
      const wood = flat('#8a5a30')
      const hay = flat('#f0c94a', { roughness: 0.95 })
      const hayBand = flat('#c9952a')
      for (let z = cz - hd + 0.3; z <= cz + hd - 0.2; z += 1.5) box(wood, 0.2, 1.3, 0.2, ex - 0.35, fy + 0.65, z)
      for (const y of [0.55, 1.05]) box(wood, 0.1, 0.16, ZONE_LAYOUT.depth - 0.4, ex - 0.35, fy + y, cz)
      for (const [x, z] of [[ex - 1.3, cz + hd - 0.8], [ex - 1.6, cz - hd + 0.8], [ex - 1.3, cz - hd + 0.8 + 0.95]]) {
        box(hay, 1.3, 0.8, 0.85, x, fy + 0.4, z)
        box(hayBand, 0.08, 0.82, 0.87, x - 0.3, fy + 0.4, z)
        box(hayBand, 0.08, 0.82, 0.87, x + 0.3, fy + 0.4, z)
      }
      box(hay, 1.3, 0.8, 0.85, ex - 1.45, fy + 1.2, cz - hd + 1.25)
      for (const [x, z] of [[wx + 0.6, cz + hd - 0.6], [wx + 0.6, cz - hd + 0.6]]) {
        for (let i = 0; i < 6; i++) box(flat('#e8c03a'), 0.06, 0.7 + rand() * 0.3, 0.06, x + (rand() - 0.5) * 0.6, fy + 0.4, z + (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4)
      }
      break
    }
    case 'jungle': {
      const trunk = flat('#8a5a2b')
      const leafA = flat('#3fae2b')
      const leafB = flat('#2c8a1e')
      for (const z of [cz + hd - 0.9, cz - hd + 0.9]) {
        const x = ex - 0.9
        for (let i = 0; i < 6; i++) box(trunk, 0.42, 0.75, 0.42, x - i * 0.08, fy + 0.4 + i * 0.72, z, 0, i * 0.3, -0.06)
        const top = fy + 4.6
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * PI * 2
          box(i % 2 ? leafA : leafB, 2.3, 0.1, 0.6, x - 0.5 + Math.cos(a) * 1.0, top - 0.25, z + Math.sin(a) * 1.0, 0, -a, -0.35)
        }
        box(flat('#6a3a18'), 0.3, 0.3, 0.3, x - 0.3, top - 0.35, z + 0.2)
      }
      for (const z of [cz + hd - 0.4, cz - hd + 0.4]) {
        box(flat('#6a3a18'), 0.16, 1.9, 0.16, wx + 0.5, fy + 0.95, z)
        box(flat('#a0642a'), 0.36, 0.3, 0.36, wx + 0.5, fy + 1.9, z)
        const flame = neon('#ff8a1a', 3)
        box(flame, 0.22, 0.4, 0.22, wx + 0.5, fy + 2.25, z, 0, PI / 4, 0)
      }
      break
    }
    case 'dojo': {
      const red = flat('#e0262b', { roughness: 0.5 })
      const black = flat('#1b1416')
      const x = ex - 0.7
      for (const s of [-1, 1]) {
        cyl(red, 0.2, 0.24, 3.8, x, fy + 1.9, cz + s * (hd - 0.5))
        cyl(black, 0.3, 0.3, 0.3, x, fy + 0.15, cz + s * (hd - 0.5))
      }
      box(red, 0.32, 0.3, ZONE_LAYOUT.depth - 0.6, x, fy + 3.05, cz)
      box(black, 0.5, 0.36, ZONE_LAYOUT.depth + 0.6, x, fy + 3.95, cz)
      box(red, 0.42, 0.18, ZONE_LAYOUT.depth + 0.2, x, fy + 3.7, cz)
      box(black, 0.12, 0.6, 0.8, x - 0.2, fy + 3.4, cz)
      // taiko drum on a stand
      const tx = wx + 0.9
      const tz = cz + hd - 0.9
      cyl(flat('#8a3a1a'), 0.55, 0.55, 0.8, tx, fy + 0.85, tz, 0, 0, PI / 2, 18)
      cyl(flat('#f3e3c0'), 0.5, 0.5, 0.82, tx, fy + 0.85, tz, 0, 0, PI / 2, 18)
      box(flat('#3a2214'), 0.12, 0.6, 0.9, tx, fy + 0.3, tz)
      for (let i = 0; i < 3; i++) cyl(flat('#5fbf3a'), 0.07, 0.08, 2.6 + i * 0.4, wx + 0.5 + i * 0.25, fy + 1.3 + i * 0.2, cz - hd + 0.4, 0, 0, 0, 8)
      break
    }
    case 'castle': {
      const stone = flat('#9aa3b2', { roughness: 0.9 })
      const stoneD = flat('#7d8697', { roughness: 0.9 })
      box(stone, 0.9, 2.2, ZONE_LAYOUT.depth, ex - 0.45, fy + 1.1, cz)
      for (let z = cz - hd + 0.45; z <= cz + hd; z += 1.5) box(stoneD, 0.95, 0.6, 0.8, ex - 0.45, fy + 2.5, z)
      for (const s of [-1, 1]) {
        box(flat('#2f5fd0'), 0.06, 1.7, 0.95, ex - 0.93, fy + 1.15, cz + s * 2.1)
        box(flat('#ffd23a'), 0.07, 0.25, 0.97, ex - 0.94, fy + 1.4, cz + s * 2.1)
        box(flat('#2f5fd0'), 0.06, 0.3, 0.45, ex - 0.93, fy + 0.2, cz + s * 2.1 + 0.25, 0, 0, 0)
      }
      for (const s of [-1, 1]) box(stone, 0.9, 1.0, 0.9, wx + 0.5, fy + 0.5, cz + s * (hd - 0.5))
      break
    }
    case 'pirate': {
      const wood = flat('#7a4a26')
      cyl(wood, 0.18, 0.24, 6.6, ex - 0.9, fy + 3.3, cz - hd + 1.6)
      cyl(wood, 0.08, 0.08, 3.6, ex - 0.9, fy + 5.2, cz - hd + 1.6, PI / 2, 0, 0, 8)
      box(flat('#fbf4e6', { roughness: 0.9 }), 0.06, 2.6, 3.3, ex - 1.05, fy + 3.8, cz - hd + 1.6)
      box(flat('#e0262b'), 0.07, 0.6, 3.31, ex - 1.06, fy + 3.8, cz - hd + 1.6)
      box(flat('#15151a'), 0.05, 0.55, 0.9, ex - 0.9, fy + 6.75, cz - hd + 2.05)
      for (const [x, z] of [[wx + 0.6, cz + hd - 0.6], [wx + 1.5, cz + hd - 0.55]]) {
        cyl(flat('#9a6436'), 0.38, 0.34, 0.9, x, fy + 0.45, z)
        cyl(flat('#3a3a40', { metalness: 0.5 }), 0.4, 0.4, 0.08, x, fy + 0.2, z)
        cyl(flat('#3a3a40', { metalness: 0.5 }), 0.4, 0.4, 0.08, x, fy + 0.7, z)
      }
      box(flat('#8a5a2b'), 1.1, 0.6, 0.75, ex - 1.0, fy + 0.3, cz + hd - 0.8)
      box(flat('#ffcc33', { metalness: 0.5, roughness: 0.35 }), 1.14, 0.1, 0.79, ex - 1.0, fy + 0.45, cz + hd - 0.8)
      box(flat('#8a5a2b'), 1.1, 0.3, 0.75, ex - 1.0, fy + 0.76, cz + hd - 0.95, -0.5, 0, 0)
      break
    }
    case 'volcano': {
      const rock = flat('#3f3330', { roughness: 0.95 })
      const rock2 = flat('#57483f', { roughness: 0.95 })
      for (let i = 0; i < 6; i++) {
        const s = 0.6 + rand() * 0.8
        box(i % 2 ? rock : rock2, s, s * 0.8, s, ex - 0.6 - rand() * 0.6, fy + s * 0.35, cz - hd + 0.5 + rand() * (ZONE_LAYOUT.depth - 1), rand(), rand(), rand() * 0.3)
      }
      addMesh(S, new ConeGeometry(1.5, 2.6, 7), rock, ex - 1.4, fy + 1.3, cz + hd - 1.5)
      const lava = neon('#ff5a00', 3.4, { transparent: true })
      pulse.lava.push(lava)
      cyl(lava, 0.42, 0.42, 0.1, ex - 1.4, fy + 2.55, cz + hd - 1.5, 0, 0, 0, 7)
      const cracks = [
        [0.12, 3.2, -2.0, -1.0, 0.4],
        [0.12, 2.4, -0.4, 1.4, -0.7],
        [0.1, 1.6, 1.8, -2.2, 1.1],
        [0.1, 2.0, -4.2, 2.4, 0.2],
      ]
      for (const [w, l, dx, dz, a] of cracks) box(lava, w, 0.04, l, cx + dx, fy + 0.02, cz + dz, 0, a, 0)
      break
    }
    case 'space': {
      addMesh(S, new SphereGeometry(0.85, 24, 16), flat('#b06cff', { roughness: 0.5 }), ex - 1.2, fy + 3.2, cz + hd - 1.4)
      addMesh(S, new TorusGeometry(1.35, 0.1, 6, 40), flat('#ffd6ff', { roughness: 0.4 }), ex - 1.2, fy + 3.2, cz + hd - 1.4, PI / 2.4, 0, 0.3)
      cyl(flat('#9aa3b2', { metalness: 0.5 }), 0.06, 0.06, 2.4, ex - 1.2, fy + 1.2, cz + hd - 1.4, 0, 0, 0, 6)
      const rx = ex - 1.1
      const rz = cz - hd + 1.3
      cyl(flat('#f4f6fb'), 0.45, 0.5, 2.6, rx, fy + 1.6, rz, 0, 0, 0, 18)
      addMesh(S, new ConeGeometry(0.45, 0.9, 18), flat('#e0262b'), rx, fy + 3.35, rz)
      addMesh(S, new CircleGeometry(0.2, 16), flat('#3fa9ff', { metalness: 0.3, roughness: 0.2 }), rx - 0.5, fy + 2.1, rz, 0, -PI / 2, 0)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2
        box(flat('#e0262b'), 0.08, 0.8, 0.6, rx + Math.cos(a) * 0.5, fy + 0.6, rz + Math.sin(a) * 0.5, 0, -a, 0)
      }
      for (let i = 0; i < 5; i++) box(neon('#fff3a0', 3), 0.14, 0.14, 0.14, wx + 0.4 + rand() * 1.2, fy + 1.5 + rand() * 2.5, cz + (rand() < 0.5 ? -1 : 1) * (hd - 0.3), 0.6, 0.6, 0)
      break
    }
    case 'rainbow': {
      const colors = ['#ff4a4a', '#ff9a2a', '#ffe14a', '#4ade4a', '#3fa9ff', '#a66bff']
      colors.forEach((c, i) => addMesh(S, new TorusGeometry(3.4 - i * 0.26, 0.14, 8, 40, PI), neon(c, 1.4), ex - 0.8, fy, cz, 0, PI / 2, 0))
      const cloud = flat('#ffffff', { roughness: 0.9 })
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) addMesh(S, new IcosahedronGeometry(0.55 + rand() * 0.3, 1), cloud, ex - 0.8 + (rand() - 0.5) * 1.2, fy + 0.35, cz + s * (3.1 + rand() * 0.3) - s * i * 0.25)
      }
      for (const s of [-1, 1]) addMesh(S, new IcosahedronGeometry(0.5, 1), cloud, wx + 0.6, fy + 0.3, cz + s * (hd - 0.6))
      break
    }
    case 'cyber': {
      const glow = neon('#38ff6a', 3)
      for (const [x, z] of [[wx + 0.25, cz - hd + 0.25], [wx + 0.25, cz + hd - 0.25], [ex - 0.25, cz - hd + 0.25], [ex - 0.25, cz + hd - 0.25]]) box(glow, 0.2, 3.0, 0.2, x, fy + 1.5, z)
      const rack = flat('#1b2026', { metalness: 0.5, roughness: 0.4 })
      for (const s of [-1, 1]) {
        box(rack, 0.9, 2.3, 1.4, ex - 0.9, fy + 1.15, cz + s * 2.3)
        for (let i = 0; i < 5; i++) box(glow, 0.04, 0.05, 1.0, ex - 1.36, fy + 0.5 + i * 0.4, cz + s * 2.3)
      }
      break
    }
  }
}
