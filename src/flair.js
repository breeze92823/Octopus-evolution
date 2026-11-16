// What the collection puts on the octopus in the world:
// - the equipped TRAIL: a camera-facing ribbon that streams behind the octopus while it moves (the
//   trail's gradient from head to tail, fading out), plus glitter for the `sparkle` trails;
// - the equipped TITLE: a tag floating over the rider's head, coloured by the title's tier.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { isFirstPerson } from './modes.js'

const MAX = 56 // ribbon points
const LIFE = 0.75 // s a point lives
const STEP = 0.35 // m between points
const SPARKS = 48
const SPARK_LIFE = 0.7
const TIER_GRAD = [
  ['#ffffff', '#c9cfe0'],
  ['#bfe6ff', '#3a86ff'],
  ['#f0c4ff', '#a23aff'],
  ['#fff4a8', '#ffb21a'],
]

function gradientColors(colors, n) {
  const cs = colors.map((c) => new Color(c))
  const out = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (cs.length - 1)
    const a = Math.min(cs.length - 2, Math.floor(t))
    out.push(cs[a].clone().lerp(cs[a + 1], t - a))
  }
  return out
}

export function createFlair(scene) {
  // --- Trail ribbon ---------------------------------------------------------------------------------
  const pos = new Float32Array(MAX * 2 * 3)
  const col = new Float32Array(MAX * 2 * 4)
  const idx = []
  for (let i = 0; i < MAX - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('color', new BufferAttribute(col, 4))
  geo.setIndex(idx)
  const mat = new MeshBasicMaterial({ vertexColors: true, transparent: true, side: DoubleSide, depthWrite: false, toneMapped: false })
  const ribbon = new Mesh(geo, mat)
  ribbon.frustumCulled = false
  ribbon.renderOrder = 5
  ribbon.visible = false
  scene.add(ribbon)

  const sparkPos = new Float32Array(SPARKS * 3)
  const sparkCol = new Float32Array(SPARKS * 4)
  const sparkGeo = new BufferGeometry()
  sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3))
  sparkGeo.setAttribute('color', new BufferAttribute(sparkCol, 4))
  const sparkMat = new PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false })
  const sparks = new Points(sparkGeo, sparkMat)
  sparks.frustumCulled = false
  sparks.visible = false
  scene.add(sparks)
  const sparkState = Array.from({ length: SPARKS }, () => ({ age: SPARK_LIFE, x: 0, y: 0, z: 0, vy: 0 }))
  let sparkNext = 0
  let sparkTimer = 0

  let trail = null
  let grad = []
  const pts = [] // { x, y, z, age }
  const head = new Vector3()
  const tmp = new Vector3()
  const side = new Vector3()
  const toCam = new Vector3()
  const tan = new Vector3()

  function setTrail(def) {
    trail = def
    pts.length = 0
    ribbon.visible = !!def
    sparks.visible = !!def?.sparkle
    if (def) grad = gradientColors(def.colors, MAX)
  }

  function updateTrail(dt, at, scale, camera) {
    if (!trail) return
    head.set(at.x, at.y + 0.9 * scale, at.z)
    for (const p of pts) p.age += dt
    while (pts.length && pts[pts.length - 1].age > LIFE) pts.pop()
    const last = pts[0]
    if (last && head.distanceTo(tmp.set(last.x, last.y, last.z)) > 12) pts.length = 0 // teleported
    if (!pts.length || head.distanceTo(tmp.set(pts[0].x, pts[0].y, pts[0].z)) > STEP) {
      pts.unshift({ x: head.x, y: head.y, z: head.z, age: 0 })
      if (pts.length > MAX - 1) pts.length = MAX - 1
    }
    // The ribbon: the live head, then the dropped points; each widened across the view direction.
    const n = Math.min(MAX, pts.length + 1)
    const width = 0.75 * scale
    const at_ = (k) => (k === 0 ? head : pts[k - 1]) // ribbon point k: the head, then the dropped points
    for (let i = 0; i < MAX; i++) {
      const k = Math.min(i, n - 1)
      const p = at_(k)
      const px = p.x
      const py = p.y
      const pz = p.z
      const a = at_(Math.max(0, k - 1))
      const b = at_(Math.min(n - 1, k + 1))
      tan.set(a.x - b.x, a.y - b.y, a.z - b.z)
      if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1)
      toCam.set(camera.position.x - px, camera.position.y - py, camera.position.z - pz)
      side.crossVectors(tan, toCam).normalize()
      const age = k === 0 ? 0 : pts[k - 1].age
      const life = 1 - Math.min(1, age / LIFE)
      const along = k / Math.max(1, n - 1)
      const w = width * (0.35 + 0.65 * life) * (1 - along * 0.6)
      const o = i * 6
      pos[o] = px + side.x * w
      pos[o + 1] = py + side.y * w
      pos[o + 2] = pz + side.z * w
      pos[o + 3] = px - side.x * w
      pos[o + 4] = py - side.y * w
      pos[o + 5] = pz - side.z * w
      const c = grad[Math.min(MAX - 1, Math.round(along * (MAX - 1)))]
      const alpha = i >= n ? 0 : 0.85 * Math.pow(life, 1.3)
      for (let v = 0; v < 2; v++) {
        const q = i * 8 + v * 4
        col[q] = c.r
        col[q + 1] = c.g
        col[q + 2] = c.b
        col[q + 3] = alpha
      }
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true

    if (!trail.sparkle) return
    const moving = pts.length > 2 && pts[1].age < 0.2
    sparkTimer -= dt
    if (moving && sparkTimer <= 0) {
      sparkTimer = 0.035
      const s = sparkState[sparkNext]
      sparkNext = (sparkNext + 1) % SPARKS
      const src = pts[Math.min(pts.length - 1, 1 + Math.floor(Math.random() * 4))]
      s.age = 0
      s.x = src.x + (Math.random() - 0.5) * width * 1.6
      s.y = src.y + (Math.random() - 0.5) * width * 1.6
      s.z = src.z + (Math.random() - 0.5) * width * 1.6
      s.vy = 0.4 + Math.random() * 0.8
    }
    sparkMat.size = 0.45 * scale
    for (let i = 0; i < SPARKS; i++) {
      const s = sparkState[i]
      s.age += dt
      s.y += s.vy * dt
      const l = 1 - Math.min(1, s.age / SPARK_LIFE)
      sparkPos[i * 3] = s.x
      sparkPos[i * 3 + 1] = s.y
      sparkPos[i * 3 + 2] = s.z
      const tw = 0.6 + 0.4 * Math.sin(s.age * 40 + i)
      sparkCol[i * 4] = 1
      sparkCol[i * 4 + 1] = 1
      sparkCol[i * 4 + 2] = 0.85
      sparkCol[i * 4 + 3] = l * tw
    }
    sparkGeo.attributes.position.needsUpdate = true
    sparkGeo.attributes.color.needsUpdate = true
  }

  // --- Title tag ------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  const tag = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }))
  tag.renderOrder = 20
  tag.visible = false
  scene.add(tag)
  let tagTitle = null

  function setTitle(def) {
    tagTitle = def
    tag.visible = !!def
    if (!def) return
    const g = canvas.getContext('2d')
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.font = '700 64px Fredoka, "Arial Rounded MT Bold", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const [c1, c2] = TIER_GRAD[def.tier] ?? TIER_GRAD[0]
    const grd = g.createLinearGradient(0, 30, 0, 98)
    grd.addColorStop(0, c1)
    grd.addColorStop(1, c2)
    g.lineJoin = 'round'
    g.lineWidth = 16
    g.strokeStyle = '#13163a'
    g.strokeText(def.name, 256, 66)
    g.fillStyle = grd
    g.fillText(def.name, 256, 64)
    tex.needsUpdate = true
  }

  function updateTitle(seat, scale) {
    if (!tagTitle) return
    tag.visible = !isFirstPerson()
    seat.getWorldPosition(tmp)
    tag.position.set(tmp.x, tmp.y + 2.55, tmp.z)
    const s = 1.6 + 0.35 * scale
    tag.scale.set(s * 4, s, 1)
  }

  return {
    setTrail,
    setTitle,
    // at: the octopus' feet (render position), scale: its size, seat: the rider's seat object.
    update(dt, { at, scale, camera, seat }) {
      updateTrail(dt, at, scale, camera)
      updateTitle(seat, scale)
    },
  }
}
