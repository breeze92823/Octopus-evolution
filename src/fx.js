// Hit effects: everything that makes a slap or a slam feel heavy.
//  - debris: pooled InstancedMesh of small lit cubes (dirt, wood, straw...) with
//    gravity, ground bounce, spin, shrink-out
//  - sparks: pooled additive point sprites (hit flashes, stars, sparkles), HDR
//    bright so bloom picks them up
//  - puffs: pooled soft normal-blended point sprites (dust, smoke) that grow and fade
//  - rings: pooled flat shockwave rings that expand and fade on the ground
//  - numbers: DOM damage / XP numbers projected from 3D, popping and arcing
//  - shake: trauma-based camera shake applied after the camera has been placed
// No per-frame allocations: every pool is preallocated and recycled.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  BoxGeometry,
} from 'three'
import { COARSE_POINTER, JUICE } from './config.js'
import { paintSoftDot, paintSparkle } from './textures.js'

const MAX_DEBRIS = 260
const MAX_SPARKS = 700
const MAX_PUFFS = 220
const MAX_RINGS = 14
const MAX_NUMBERS = JUICE.maxNumbers
const SCALE = COARSE_POINTER ? JUICE.touchScale : 1
const GRAVITY = 22

const rnd = (a, b) => a + Math.random() * (b - a)
const tmpV = new Vector3()
const tmpC = new Color()

// --- Point sprite system (sparks + puffs share the shader) --------------------------
const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uViewport;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
    gl_PointSize = aSize * projectionMatrix[1][1] * 0.5 * uViewport / max(-mv.z, 0.1);
  }`
const pointFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uIntensity;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb * uIntensity, t.a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

function makePointPool(scene, max, texture, additive, intensity, viewport) {
  const geo = new BufferGeometry()
  const pos = new Float32Array(max * 3)
  const size = new Float32Array(max)
  const alpha = new Float32Array(max)
  const color = new Float32Array(max * 3)
  const attr = (arr, n) => new BufferAttribute(arr, n).setUsage(DynamicDrawUsage)
  geo.setAttribute('position', attr(pos, 3))
  geo.setAttribute('aSize', attr(size, 1))
  geo.setAttribute('aAlpha', attr(alpha, 1))
  geo.setAttribute('aColor', attr(color, 3))
  const mat = new ShaderMaterial({
    uniforms: { map: { value: texture }, uViewport: viewport, uIntensity: { value: intensity } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = additive ? 4 : 3
  scene.add(points)
  // Particle records live in typed arrays: velocity, life, age, size0, size1, drag.
  return {
    points,
    pos,
    size,
    alpha,
    color,
    vel: new Float32Array(max * 3),
    life: new Float32Array(max),
    age: new Float32Array(max).fill(1e9),
    s0: new Float32Array(max),
    s1: new Float32Array(max),
    grav: new Float32Array(max),
    drag: new Float32Array(max),
    max,
    next: 0,
  }
}

function spawnPoint(pool, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, grav, drag) {
  const i = pool.next
  pool.next = (pool.next + 1) % pool.max
  pool.pos[i * 3] = x
  pool.pos[i * 3 + 1] = y
  pool.pos[i * 3 + 2] = z
  pool.vel[i * 3] = vx
  pool.vel[i * 3 + 1] = vy
  pool.vel[i * 3 + 2] = vz
  pool.life[i] = life
  pool.age[i] = 0
  pool.s0[i] = s0
  pool.s1[i] = s1
  pool.color[i * 3] = r
  pool.color[i * 3 + 1] = g
  pool.color[i * 3 + 2] = b
  pool.grav[i] = grav
  pool.drag[i] = drag
}

function updatePointPool(pool, dt, fadeIn) {
  let live = 0
  for (let i = 0; i < pool.max; i++) {
    const age = (pool.age[i] += dt)
    const life = pool.life[i]
    if (age >= life) {
      pool.alpha[i] = 0
      pool.size[i] = 0
      continue
    }
    live++
    const k = age / life
    const d = Math.exp(-pool.drag[i] * dt)
    const j = i * 3
    pool.vel[j] *= d
    pool.vel[j + 1] = pool.vel[j + 1] * d - pool.grav[i] * dt
    pool.vel[j + 2] *= d
    pool.pos[j] += pool.vel[j] * dt
    pool.pos[j + 1] = Math.max(0.05, pool.pos[j + 1] + pool.vel[j + 1] * dt)
    pool.pos[j + 2] += pool.vel[j + 2] * dt
    pool.size[i] = pool.s0[i] + (pool.s1[i] - pool.s0[i]) * k
    pool.alpha[i] = (fadeIn ? Math.min(1, k * 8) : 1) * (1 - k * k)
  }
  const g = pool.points.geometry
  g.attributes.position.needsUpdate = true
  g.attributes.aSize.needsUpdate = true
  g.attributes.aAlpha.needsUpdate = true
  g.attributes.aColor.needsUpdate = true
  pool.points.visible = live > 0
}

// --- Damage numbers ----------------------------------------------------------------------
const NUMBER_CSS = `
.fx-num { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 6; font-family: 'Fredoka', 'Arial Black', sans-serif; font-weight: 700;
  white-space: nowrap; will-change: transform, opacity; line-height: 1; -webkit-text-stroke: 0.09em #2a1300; paint-order: stroke fill;
  text-shadow: 0 0.08em 0 #2a1300, 0 0.14em 0.18em rgba(0,0,0,.35); }
.fx-num.dmg { color: #ffd23a; background: linear-gradient(#fff6a8, #ffc21a 55%, #ff9a00); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 0.09em #3a1a00; }
.fx-num.crit { background: linear-gradient(#fff, #ff8a3d 50%, #ff2d2d); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 0.1em #3a0000; }
.fx-num.big { background: linear-gradient(#ffffff, #ffe14a 45%, #ff7a00); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 0.1em #3a1400; }
.fx-num.xp { color: #9dff6a; -webkit-text-stroke: 0.08em #0d3a00; text-shadow: 0 0.07em 0 #0d3a00; }
.fx-num.wins { color: #ffe066; -webkit-text-stroke: 0.08em #4a2a00; }
.fx-num.hurt { color: #ff4a4a; -webkit-text-stroke: 0.08em #3a0000; }
.fx-num.heal { color: #6affb0; -webkit-text-stroke: 0.08em #003a1c; }
.fx-num.info { color: #ffffff; -webkit-text-stroke: 0.08em #1a1a3a; }
.fx-num.max { color: #ffd23a; -webkit-text-stroke: 0.09em #5a1a00; }
`

export function createFx(scene, camera) {
  const viewport = { value: 800 }
  const tex = (c) => {
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }
  const sparkTex = tex(paintSparkle(64))
  const dotTex = tex(paintSoftDot(64))
  const sparks = makePointPool(scene, MAX_SPARKS, sparkTex, true, 2.4, viewport)
  const glows = makePointPool(scene, Math.round(MAX_SPARKS / 2), dotTex, true, 1.8, viewport)
  const puffs = makePointPool(scene, MAX_PUFFS, dotTex, false, 1, viewport)

  // Debris cubes.
  const debrisMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), MAX_DEBRIS)
  debrisMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  debrisMesh.castShadow = true
  debrisMesh.frustumCulled = false
  debrisMesh.count = MAX_DEBRIS
  const D = {
    p: new Float32Array(MAX_DEBRIS * 3),
    v: new Float32Array(MAX_DEBRIS * 3),
    r: new Float32Array(MAX_DEBRIS * 3), // euler
    w: new Float32Array(MAX_DEBRIS * 3), // spin
    s: new Float32Array(MAX_DEBRIS),
    life: new Float32Array(MAX_DEBRIS),
    age: new Float32Array(MAX_DEBRIS).fill(1e9),
    next: 0,
  }
  const zeroM = new Matrix4().makeScale(0, 0, 0)
  for (let i = 0; i < MAX_DEBRIS; i++) {
    debrisMesh.setMatrixAt(i, zeroM)
    debrisMesh.setColorAt(i, tmpC.set('#ffffff'))
  }
  scene.add(debrisMesh)
  const dObj = new Object3D()

  // Shockwave rings.
  const ringGeo = new RingGeometry(0.82, 1, 48, 1)
  ringGeo.rotateX(-Math.PI / 2)
  const rings = []
  for (let i = 0; i < MAX_RINGS; i++) {
    const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    m.visible = false
    m.renderOrder = 3
    scene.add(m)
    rings.push({ mesh: m, age: 1e9, life: 1, r0: 1, r1: 5, op: 1 })
  }
  let ringNext = 0

  // DOM numbers.
  const style = document.createElement('style')
  style.textContent = NUMBER_CSS
  document.head.appendChild(style)
  const layer = document.createElement('div')
  layer.className = 'fx-layer'
  document.body.appendChild(layer)
  const numbers = []
  for (let i = 0; i < MAX_NUMBERS; i++) {
    const el = document.createElement('div')
    el.className = 'fx-num'
    el.style.display = 'none'
    layer.appendChild(el)
    numbers.push({ el, age: 1e9, life: 1, pos: new Vector3(), vx: 0, vy: 0, size: 1 })
  }
  let numNext = 0

  // Shake.
  let trauma = 0
  let shakeTime = 0
  const shakeOffset = new Vector3()
  const camQ = new Quaternion()

  const fx = {
    // Additive sparkles/flash. opts: { count, color | colors[], speed, up, spread, size, life, gravity }
    sparks(pos, o = {}) {
      const n = Math.max(1, Math.round((o.count ?? 14) * SCALE))
      const colors = o.colors ?? [o.color ?? '#ffe28a']
      const speed = o.speed ?? 7
      for (let i = 0; i < n; i++) {
        tmpC.set(colors[i % colors.length])
        const th = Math.random() * Math.PI * 2
        const ph = Math.acos(rnd(-1, 1))
        const sp = speed * rnd(0.35, 1)
        const vx = Math.sin(ph) * Math.cos(th) * sp
        const vz = Math.sin(ph) * Math.sin(th) * sp
        const vy = Math.abs(Math.cos(ph)) * sp * 0.8 + (o.up ?? 3)
        const s = (o.size ?? 0.45) * rnd(0.6, 1.3)
        spawnPoint(sparks, pos.x, pos.y, pos.z, vx, vy, vz, (o.life ?? 0.55) * rnd(0.7, 1.2), s, s * 0.2, tmpC.r, tmpC.g, tmpC.b, o.gravity ?? 14, 2.2)
      }
    },
    // A single soft additive flash (impact bloom).
    flash(pos, color = '#fff2b0', size = 2.4, life = 0.18) {
      tmpC.set(color)
      spawnPoint(glows, pos.x, pos.y, pos.z, 0, 0, 0, life, size, size * 1.6, tmpC.r, tmpC.g, tmpC.b, 0, 0)
    },
    // Rising glowing motes (level up, healing, wins).
    motes(pos, o = {}) {
      const n = Math.max(1, Math.round((o.count ?? 20) * SCALE))
      const colors = o.colors ?? [o.color ?? '#ffe66a']
      const r = o.radius ?? 1.5
      for (let i = 0; i < n; i++) {
        tmpC.set(colors[i % colors.length])
        const th = Math.random() * Math.PI * 2
        const rr = r * Math.sqrt(Math.random())
        const s = (o.size ?? 0.35) * rnd(0.6, 1.4)
        spawnPoint(sparks, pos.x + Math.cos(th) * rr, pos.y + rnd(0, o.height ?? 1), pos.z + Math.sin(th) * rr, Math.cos(th) * 0.6, rnd(2, 5) * (o.rise ?? 1), Math.sin(th) * 0.6, (o.life ?? 1.2) * rnd(0.7, 1.3), s, s * 0.4, tmpC.r, tmpC.g, tmpC.b, -0.5, 1.2)
      }
    },
    // Dust/smoke puffs. opts: { count, color, radius, speed, size, life, up }
    dust(pos, o = {}) {
      const n = Math.max(1, Math.round((o.count ?? 10) * SCALE))
      tmpC.set(o.color ?? '#e9d6b0')
      const speed = o.speed ?? 4
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3)
        const sp = speed * rnd(0.5, 1.1)
        const r0 = (o.radius ?? 0.5) * rnd(0.6, 1)
        const s = (o.size ?? 1.4) * rnd(0.7, 1.3)
        const shade = rnd(0.85, 1.08)
        spawnPoint(puffs, pos.x + Math.cos(th) * r0, pos.y + rnd(0.1, 0.5), pos.z + Math.sin(th) * r0, Math.cos(th) * sp, rnd(0.6, 2) * (o.up ?? 1), Math.sin(th) * sp, (o.life ?? 0.9) * rnd(0.7, 1.3), s * 0.5, s * 1.6, tmpC.r * shade, tmpC.g * shade, tmpC.b * shade, -0.8, 3)
      }
    },
    // Chunky lit cubes. opts: { count, colors[], speed, up, size, life }
    debris(pos, o = {}) {
      const n = Math.max(1, Math.round((o.count ?? 8) * SCALE))
      const colors = o.colors ?? ['#8a5a2b', '#b07a3c', '#5ea83a']
      const speed = o.speed ?? 6
      for (let k = 0; k < n; k++) {
        const i = D.next
        D.next = (D.next + 1) % MAX_DEBRIS
        const th = Math.random() * Math.PI * 2
        const sp = speed * rnd(0.4, 1)
        D.p[i * 3] = pos.x + rnd(-0.3, 0.3)
        D.p[i * 3 + 1] = pos.y + rnd(0, 0.4)
        D.p[i * 3 + 2] = pos.z + rnd(-0.3, 0.3)
        D.v[i * 3] = Math.cos(th) * sp
        D.v[i * 3 + 1] = rnd(0.5, 1) * (o.up ?? 7)
        D.v[i * 3 + 2] = Math.sin(th) * sp
        for (let a = 0; a < 3; a++) {
          D.r[i * 3 + a] = Math.random() * 6
          D.w[i * 3 + a] = rnd(-12, 12)
        }
        D.s[i] = (o.size ?? 0.22) * rnd(0.6, 1.4)
        D.life[i] = (o.life ?? 1.1) * rnd(0.8, 1.3)
        D.age[i] = 0
        debrisMesh.setColorAt(i, tmpC.set(colors[k % colors.length]))
      }
      if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true
    },
    // Ground shockwave. opts: { radius, from, color, life, opacity, y }
    ring(pos, o = {}) {
      const r = rings[ringNext]
      ringNext = (ringNext + 1) % MAX_RINGS
      r.age = 0
      r.life = o.life ?? 0.5
      r.r0 = o.from ?? 0.4
      r.r1 = o.radius ?? 5
      r.op = o.opacity ?? 0.9
      r.mesh.material.color.set(o.color ?? '#ffffff')
      r.mesh.position.set(pos.x, (o.y ?? pos.y) + 0.08, pos.z)
      r.mesh.visible = true
    },
    // Floating number. kind: dmg | crit | big | xp | wins | hurt | heal | info | max
    number(pos, text, kind = 'dmg', size = 1) {
      const n = numbers[numNext]
      numNext = (numNext + 1) % MAX_NUMBERS
      n.el.className = `fx-num ${kind}`
      n.el.textContent = text
      n.el.style.display = ''
      n.pos.set(pos.x + rnd(-0.4, 0.4), pos.y, pos.z + rnd(-0.4, 0.4))
      n.age = 0
      n.life = kind === 'xp' ? 0.85 : kind === 'max' ? 1.2 : 1.05
      n.vx = kind === 'xp' ? rnd(-12, 12) : rnd(-40, 40)
      n.vy = kind === 'xp' ? -70 : -150
      n.size = size
      n.kind = kind
    },
    // Camera shake (0..1 adds trauma; it decays).
    shake(amount) {
      trauma = Math.min(1, trauma + amount * JUICE.shake)
    },
    // Called after the camera is placed.
    update(dt) {
      viewport.value = window.innerHeight * Math.min(window.devicePixelRatio, 2)
      updatePointPool(sparks, dt, false)
      updatePointPool(glows, dt, false)
      updatePointPool(puffs, dt, true)

      // Debris.
      let live = 0
      for (let i = 0; i < MAX_DEBRIS; i++) {
        const age = (D.age[i] += dt)
        if (age >= D.life[i]) {
          if (age - dt < D.life[i]) debrisMesh.setMatrixAt(i, zeroM)
          continue
        }
        live++
        const j = i * 3
        D.v[j + 1] -= GRAVITY * dt
        D.p[j] += D.v[j] * dt
        D.p[j + 1] += D.v[j + 1] * dt
        D.p[j + 2] += D.v[j + 2] * dt
        const s = D.s[i]
        if (D.p[j + 1] < s * 0.5) {
          D.p[j + 1] = s * 0.5
          D.v[j + 1] *= -0.35
          D.v[j] *= 0.6
          D.v[j + 2] *= 0.6
          D.w[j] *= 0.6
          D.w[j + 2] *= 0.6
        }
        for (let a = 0; a < 3; a++) D.r[j + a] += D.w[j + a] * dt
        const k = age / D.life[i]
        const sc = s * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1)
        dObj.position.set(D.p[j], D.p[j + 1], D.p[j + 2])
        dObj.rotation.set(D.r[j], D.r[j + 1], D.r[j + 2])
        dObj.scale.setScalar(Math.max(0.0001, sc))
        dObj.updateMatrix()
        debrisMesh.setMatrixAt(i, dObj.matrix)
      }
      debrisMesh.instanceMatrix.needsUpdate = true
      debrisMesh.visible = live > 0

      // Rings.
      for (const r of rings) {
        if (!r.mesh.visible) continue
        r.age += dt
        const k = r.age / r.life
        if (k >= 1) {
          r.mesh.visible = false
          continue
        }
        const e = 1 - Math.pow(1 - k, 3)
        const rad = r.r0 + (r.r1 - r.r0) * e
        r.mesh.scale.set(rad, 1, rad)
        r.mesh.material.opacity = r.op * (1 - k)
      }

      // Numbers.
      const w = window.innerWidth
      const h = window.innerHeight
      const base = Math.max(18, Math.min(w, h) * 0.045)
      for (const n of numbers) {
        if (n.age > n.life) continue
        n.age += dt
        if (n.age > n.life) {
          n.el.style.display = 'none'
          continue
        }
        tmpV.copy(n.pos).project(camera)
        if (tmpV.z > 1) {
          n.el.style.opacity = '0'
          continue
        }
        const t = n.age
        const k = t / n.life
        const pop = t < 0.12 ? 0.4 + (t / 0.12) * 0.9 : t < 0.22 ? 1.3 - ((t - 0.12) / 0.1) * 0.3 : 1
        const x = (tmpV.x * 0.5 + 0.5) * w + n.vx * t
        const y = (-tmpV.y * 0.5 + 0.5) * h + n.vy * t + 260 * t * t
        const size = base * n.size * (n.kind === 'xp' ? 0.62 : n.kind === 'crit' || n.kind === 'big' ? 1.25 : 1)
        n.el.style.fontSize = `${size.toFixed(1)}px`
        n.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1)
        n.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${pop.toFixed(3)})`
      }

      // Shake: small positional + rotational jitter, trauma squared so small hits stay subtle.
      if (trauma > 0) {
        shakeTime += dt
        const s = trauma * trauma
        const t = shakeTime * 32
        shakeOffset.set(Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5, Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.4, Math.sin(t * 1.3 + 2)).multiplyScalar(0.32 * s)
        camera.position.add(shakeOffset)
        camQ.setFromAxisAngle(tmpV.set(0, 0, 1), Math.sin(t * 1.9) * 0.025 * s)
        camera.quaternion.multiply(camQ)
        trauma = Math.max(0, trauma - dt * 1.6)
      }
    },
  }

  // A named combo for the common cases.
  fx.slapHit = (pos, strength = 1, color = '#ffe28a') => {
    fx.flash(pos, '#fff3c4', 2.2 * strength, 0.14)
    fx.sparks(pos, { count: 10 * strength, colors: ['#ffffff', color, '#ffd04a'], speed: 7 * strength, size: 0.42 })
    fx.ring(pos, { radius: 2.4 * strength, color: '#fff2c0', life: 0.3, opacity: 0.7, y: 0 })
    fx.shake(0.12 * strength)
  }
  fx.slam = (pos, strength = 1) => {
    fx.flash(pos, '#ffe9b0', 5 * strength, 0.22)
    fx.ring(pos, { radius: 7 * strength, color: '#fff3c4', life: 0.55, opacity: 1, y: 0 })
    fx.ring(pos, { radius: 4.5 * strength, color: '#ffb347', life: 0.4, opacity: 0.8, y: 0 })
    fx.dust(pos, { count: 18, color: '#e3cf9f', speed: 7 * strength, size: 2.2 * strength, life: 1.1 })
    fx.debris(pos, { count: 14, colors: ['#6bd63a', '#8a5a2b', '#c9a46a', '#4fb52e'], speed: 7 * strength, up: 9, size: 0.3 })
    fx.sparks(pos, { count: 22, colors: ['#ffffff', '#ffe28a', '#ff9a3d'], speed: 10 * strength, size: 0.55, up: 5 })
    fx.shake(0.55 * strength)
  }
  return fx
}
