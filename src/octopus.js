// The player's octopus: a glossy mantle the rider sits in, and 4-12 long
// tentacles that lie across the ground, ripple, curl their tips and lash out.
//
// Construction
//  - Every tentacle is a CPU-built tube: (rings + 1) x (sides + 1) vertices whose
//    positions and normals are rewritten each frame from a procedural spine.
//    The spine is a kinematic chain (absolute pitch + yaw per segment) that rests
//    on the ground (a floor clamp keeps it there), carries travelling waves,
//    rows/steps in alternating groups while walking, and curls its tip up.
//  - Actions (slap / train / grab-and-slam) compute their own spine (raised
//    "cocked" pose, a whip arc onto the target, or a reach that wraps a helix
//    round the target and carries it) and blend over the rest pose by weight;
//    the whip arrives root-first, tip-last. A restarted action blends from a
//    snapshot of the current shape so nothing ever pops.
//  - The tube frame is parallel-transported from "up" at the root, so the
//    belly (u = 0.5 of the skin, where the suckers are) faces the ground and
//    shows on the outside of an up-curled tip.
//  - Everything octopus lives under `body` (scaled with the level); the rider's
//    `seat` is a sibling of `body`, so the rider stays 1.8 m tall at any size.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LatheGeometry, Mesh, Object3D, Sphere, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three'
import { eyeMaterials, skinMaterials } from './octopusSkins.js'

// --- Tunables -------------------------------------------------------------------------
// Lengths are body units = metres at scale 1.
export const OCTO = {
  armLength: 4.3,
  rootRadius: 0.3,
  tipRadius: 0.018,
  rootRing: 0.55, // roots start this far out from the centre, inside the mantle
  rootY: 0.62,
  rings: 28,
  sides: 12,
  displayRings: 16,
  displaySides: 8,
  reach: 4.6, // m at scale 1 (horizontal strike range from the centre)
  restCurl: 2.9, // rad of pitch the tip curls up to at rest
  waveAmp: 0.11, // rad, travelling pitch wave
  yawWave: 0.16, // rad, sideways sway
  gaitStride: 4.5, // m travelled per gait cycle
  gaitLift: 0.55, // rad, how far a stepping tentacle lifts
  gaitSweep: 0.22, // rad, rowing sweep while walking
  drag: 0.32, // rad tentacles trail backwards at full walking speed
  mantle: { rx: 1.02, top: 0.72, bottom: 0.52, cy: 0.62, segments: 32 },
  eyes: { angle: 0.42, y: 0.68, r: 0.95, size: 0.2 },
  slap: { hit: 0.28, hold: 0.1, recover: 0.34 },
  train: { hit: 0.2, hold: 0.06, recover: 0.26 },
  grab: { reach: 0.22, liftAt: 0.32, slamAt: 0.9, end: 1.3, highBase: 3.2, highPerScale: 0.6, wrap: 0.48, wrapStart: 0.68 },
  waist: 0.74, // rider-space height of the rider's waist; it sits at the dome surface
  collar: { radius: 0.31, tube: 0.1, rho: 0.32 },
  snapTime: 0.12, // s a restarted action blends from the previous shape
}

const TAU = Math.PI * 2
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (e0, e1, v) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const ease = (t) => {
  t = clamp(t, 0, 1)
  return t * t * (3 - 2 * t)
}
const bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2))
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

// Height of the mantle dome at radius rho (body units), before squash.
function domeY(rho) {
  const M = OCTO.mantle
  const c = Math.pow(clamp(rho / M.rx, 0, 1), 1.25)
  return M.cy + M.top * Math.sqrt(Math.max(0, 1 - c * c))
}

function mantleGeometry(segments) {
  const M = OCTO.mantle
  const pts = []
  const n = 24
  for (let i = 0; i <= n; i++) {
    const phi = -1.35 + (i / n) * (Math.PI / 2 + 1.35)
    const c = Math.max(0, Math.cos(phi))
    const r = i === n ? 0 : M.rx * Math.pow(c, 0.8)
    const y = M.cy + (phi < 0 ? M.bottom : M.top) * Math.sin(phi)
    pts.push(new Vector2(r, y))
  }
  pts.unshift(new Vector2(0.001, M.cy - M.bottom * 1.02)) // close the underside
  return new LatheGeometry(pts, segments)
}

// --- One tentacle -----------------------------------------------------------------------
class Arm {
  constructor(parent, index, count, rings, sides, rand) {
    this.R = rings
    this.S = sides
    this.index = index
    this.theta = ((index + 0.5) / count) * TAU + (rand() - 0.5) * 0.12
    this.ph = rand() * TAU
    this.ph2 = rand() * TAU
    this.ph3 = rand() * TAU
    this.side = index % 2 ? 1 : -1
    this.grp = index % 2
    this.lenK = 0.94 + rand() * 0.12 // slight length variety
    const n = (rings + 1) * 3
    this.rest = new Float32Array(n)
    this.actA = new Float32Array(n)
    this.actB = new Float32Array(n)
    this.pts = new Float32Array(n)
    this.snap = new Float32Array(n)
    this.snapW = 0
    this.weight = 0
    this.action = null
    this.frame = new Float32Array(n * 3) // T, N, B per ring

    // Radius profile, its slope term for normals and the arc-length v coordinate.
    this.rad = new Float32Array(rings + 1)
    this.slope = new Float32Array(rings + 1)
    this.inv = new Float32Array(rings + 1)
    const ds = (OCTO.armLength * this.lenK) / rings
    const vs = new Float32Array(rings + 1)
    for (let k = 0; k <= rings; k++) {
      const t = k / rings
      const r = OCTO.tipRadius + (OCTO.rootRadius - OCTO.tipRadius) * Math.pow(1 - t, 1.1) * (1 + 0.12 * bump(t, 0.08, 0.08))
      this.rad[k] = r
      if (k > 0) vs[k] = vs[k - 1] + ds / (2 * TAU * Math.max(0.05, (r + this.rad[k - 1]) / 2))
    }
    for (let k = 0; k <= rings; k++) {
      const a = this.rad[Math.max(0, k - 1)]
      const b = this.rad[Math.min(rings, k + 1)]
      const g = -(b - a) / (ds * (k === 0 || k === rings ? 1 : 2))
      this.slope[k] = g
      this.inv[k] = 1 / Math.sqrt(1 + g * g)
    }

    // Tube geometry: static index + uv, dynamic position + normal.
    const verts = (rings + 1) * (sides + 1)
    const geo = new BufferGeometry()
    this.pos = new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage)
    this.nor = new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage)
    const uv = new Float32Array(verts * 2)
    for (let k = 0; k <= rings; k++) {
      for (let j = 0; j <= sides; j++) {
        const i = k * (sides + 1) + j
        uv[i * 2] = j / sides
        uv[i * 2 + 1] = vs[k]
      }
    }
    const idx = []
    for (let k = 0; k < rings; k++) {
      for (let j = 0; j < sides; j++) {
        const a = k * (sides + 1) + j
        const b = a + 1
        const c = a + sides + 1
        const d = c + 1
        idx.push(a, b, c, b, d, c)
      }
    }
    geo.setIndex(idx)
    geo.setAttribute('position', this.pos)
    geo.setAttribute('normal', this.nor)
    geo.setAttribute('uv', new BufferAttribute(uv, 2))
    geo.boundingSphere = new Sphere(new Vector3(0, 1, 0), OCTO.armLength + 1.5)
    this.mesh = new Mesh(geo, undefined)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    parent.add(this.mesh)

    // Spikes: small horns along the top line, following the spine.
    this.spikeRings = []
    for (let k = 4; k <= rings - 4; k += Math.max(2, Math.round(rings / 9))) this.spikeRings.push(k)
    const K = this.spikeRings.length
    const sgeo = new BufferGeometry()
    this.spos = new BufferAttribute(new Float32Array(K * 5 * 3), 3).setUsage(DynamicDrawUsage)
    this.snor = new BufferAttribute(new Float32Array(K * 5 * 3), 3).setUsage(DynamicDrawUsage)
    const sidx = []
    for (let s = 0; s < K; s++) {
      const o = s * 5
      for (let j = 0; j < 4; j++) sidx.push(o + j, o + ((j + 1) % 4), o + 4)
    }
    sgeo.setIndex(sidx)
    sgeo.setAttribute('position', this.spos)
    sgeo.setAttribute('normal', this.snor)
    sgeo.boundingSphere = geo.boundingSphere
    this.spikes = new Mesh(sgeo, undefined)
    this.spikes.castShadow = true
    this.spikes.visible = false
    parent.add(this.spikes)
  }

  setMaterials(arm, spike, spikes) {
    this.mesh.material = arm
    this.spikes.material = spike
    this.spikes.visible = !!spikes
  }

  dispose() {
    this.mesh.removeFromParent()
    this.spikes.removeFromParent()
    this.mesh.geometry.dispose()
    this.spikes.geometry.dispose()
  }

  // Starts (or restarts) an action, blending from the current shape if mid-move.
  start(action) {
    if (this.weight > 0.02 || this.snapW > 0.02) {
      this.snap.set(this.pts)
      this.snapW = 1
    }
    this.action = action
  }

  // Busy = an action still before (or just at) its impact.
  busy() {
    const a = this.action
    if (!a) return false
    if (a.kind === 'grab') return true
    return a.t < a.cfg.hit + a.cfg.hold
  }

  // --- Rest spine (idle, walking, airborne) -----------------------------------------------
  restPose(out, env) {
    const R = this.R
    const ds = (OCTO.armLength * this.lenK) / R
    const th = this.theta + env.drag * Math.sin(this.theta)
    let x = Math.sin(th) * OCTO.rootRing
    let y = OCTO.rootY + env.bob
    let z = Math.cos(th) * OCTO.rootRing
    out[0] = x
    out[1] = y
    out[2] = z
    const tB = env.tipStart
    const curl = env.curl + 0.5 * Math.sin(env.time * 0.6 + this.ph) + env.hurt * 1.2 - env.flare * 2.2
    const wave = OCTO.waveAmp + env.hurt * 0.45 + env.flare * 0.25
    const gaitS = Math.sin(env.gait + this.grp * Math.PI)
    const gaitC = Math.cos(env.gait + this.grp * Math.PI)
    const lift = OCTO.gaitLift * env.move * Math.max(0, gaitS)
    const floorDrop = env.air * 1.6
    for (let k = 0; k < R; k++) {
      const t = (k + 0.5) / R
      const tc = Math.max(0, (t - tB) / (1 - tB))
      let a = -1.05 * (1 - smooth(0, 0.2, t)) - env.air * 0.7 * (1 - t)
      a += wave * Math.sin(TAU * 1.3 * t - env.time * 1.6 + this.ph) * smooth(0.12, 0.3, t)
      a += lift * (bump(t, 0.3, 0.12) - 0.8 * bump(t, 0.55, 0.12))
      a += curl * Math.pow(tc, 1.6) + env.flare * 0.5 * t
      const b =
        OCTO.yawWave * Math.sin(TAU * 0.9 * t - env.time * 1.1 + this.ph2) * t +
        this.side * 0.85 * tc * tc * (1 + 0.3 * Math.sin(env.time * 0.45 + this.ph3)) +
        OCTO.gaitSweep * env.move * gaitC * t
      const yaw = th + b
      const ca = Math.cos(a)
      x += ds * ca * Math.sin(yaw)
      y += ds * Math.sin(a)
      z += ds * ca * Math.cos(yaw)
      const floor = this.rad[k + 1] * 0.92 + 0.012 - floorDrop
      if (y < floor) y = floor
      const o = (k + 1) * 3
      out[o] = x
      out[o + 1] = y
      out[o + 2] = z
    }
  }

  // Cocked pose: rises from the root toward `yaw` and curls back over (a whip drawn back).
  raisedPose(out, yaw, env) {
    const R = this.R
    const ds = (OCTO.armLength * this.lenK) / R
    let x = Math.sin(this.theta) * OCTO.rootRing
    let y = OCTO.rootY + env.bob
    let z = Math.cos(this.theta) * OCTO.rootRing
    out[0] = x
    out[1] = y
    out[2] = z
    for (let k = 0; k < R; k++) {
      const t = (k + 0.5) / R
      const a = 0.5 + 2.5 * t
      const yw = yaw + this.side * 0.35 * t * t
      const ca = Math.cos(a)
      x += ds * ca * Math.sin(yw)
      y += ds * Math.sin(a)
      z += ds * ca * Math.cos(yw)
      const o = (k + 1) * 3
      out[o] = x
      out[o + 1] = Math.max(y, this.rad[k + 1])
      out[o + 2] = z
    }
  }

  // Whip arc from the root onto target (x, y, z): a quadratic Bezier, lifted mid-way.
  strikePose(out, tx, ty, tz, env, overshoot = 0) {
    const R = this.R
    const x0 = Math.sin(this.theta) * OCTO.rootRing
    const y0 = OCTO.rootY + env.bob
    const z0 = Math.cos(this.theta) * OCTO.rootRing
    const dist = Math.hypot(tx - x0, tz - z0)
    const cx = (x0 + tx) / 2
    const cy = Math.max(y0, ty) + 0.6 + 0.35 * dist
    const cz = (z0 + tz) / 2
    // Overshoot: the tip presses on past the target into the ground.
    const ox = tx + ((tx - x0) / (dist || 1)) * overshoot
    const oz = tz + ((tz - z0) / (dist || 1)) * overshoot
    const oy = ty - overshoot * 0.6
    for (let k = 0; k <= R; k++) {
      const u = Math.pow(k / R, 0.92)
      const a = (1 - u) * (1 - u)
      const b = 2 * (1 - u) * u
      const c = u * u
      const o = k * 3
      out[o] = a * x0 + b * cx + c * ox
      out[o + 1] = Math.max(a * y0 + b * cy + c * oy, this.rad[k] * 0.92)
      out[o + 2] = a * z0 + b * cz + c * oz
    }
  }

  // Reach to a point A next to the held point H, then a helix wrapped round H.
  wrapPose(out, H, wrap, rw, env) {
    const R = this.R
    const x0 = Math.sin(this.theta) * OCTO.rootRing
    const y0 = OCTO.rootY + env.bob
    const z0 = Math.cos(this.theta) * OCTO.rootRing
    const phi0 = Math.atan2(z0 - H.z, x0 - H.x)
    const ax = H.x + Math.cos(phi0) * rw
    const az = H.z + Math.sin(phi0) * rw
    const ay = H.y + rw * 0.6
    const dist = Math.hypot(ax - x0, az - z0)
    const cx = (x0 + ax) / 2
    const cy = Math.max(y0, ay) + 0.4 + 0.25 * dist
    const cz = (z0 + az) / 2
    const tw = OCTO.grab.wrapStart
    const kw = Math.round(tw * R)
    for (let k = 0; k <= R; k++) {
      const o = k * 3
      if (k <= kw) {
        const u = k / kw
        const a = (1 - u) * (1 - u)
        const b = 2 * (1 - u) * u
        const c = u * u
        out[o] = a * x0 + b * cx + c * ax
        out[o + 1] = a * y0 + b * cy + c * ay
        out[o + 2] = a * z0 + b * cz + c * az
      } else {
        const f = (k - kw) / (R - kw)
        const phi = phi0 + f * TAU * 1.2 * wrap
        const r = rw * (1 - 0.18 * f)
        out[o] = H.x + Math.cos(phi) * r
        out[o + 1] = H.y + rw * 0.6 - f * rw * 1.4 * wrap
        out[o + 2] = H.z + Math.sin(phi) * r
      }
      out[o + 1] = Math.max(out[o + 1], this.rad[k] * 0.92)
    }
  }

  // --- Per-frame ---------------------------------------------------------------------------------
  update(dt, env) {
    this.restPose(this.rest, env)
    const n = this.rest.length
    const a = this.action
    if (a) {
      a.t += dt
      let w = 0
      if (a.kind === 'grab') {
        const G = OCTO.grab
        const p = a.t
        if (p < G.reach) w = ease(p / G.reach)
        else if (p < G.slamAt + 0.12) w = 1
        else w = 1 - ease((p - G.slamAt - 0.12) / (G.end - G.slamAt - 0.12))
        const wrap = smooth(G.liftAt * 0.35, G.liftAt, p)
        this.wrapPose(this.actA, a.H, Math.max(0.05, wrap), a.rw, env)
        if (p >= G.end) this.action = null
      } else {
        const { hit, hold, recover } = a.cfg
        const p = a.t
        const cock = hit * 0.5
        if (p < cock) w = ease(p / cock)
        else if (p < hit + hold) w = 1
        else w = 1 - ease((p - hit - hold) / recover)
        if (p < cock) {
          this.raisedPose(this.actA, a.yaw, env)
        } else {
          this.raisedPose(this.actA, a.yaw, env)
          const over = p < hit ? 0 : 0.25 * Math.sin(clamp((p - hit) / (hold + 0.05), 0, 1) * Math.PI)
          this.strikePose(this.actB, a.target.x, a.target.y, a.target.z, env, over)
          let q = clamp((p - cock) / (hit - cock), 0, 1)
          q *= q // accelerate into the strike
          const A = this.actA
          const B = this.actB
          for (let k = 0; k <= this.R; k++) {
            const t = k / this.R
            const qk = clamp(q * 1.4 - 0.4 * t, 0, 1) // root arrives first, the tip lashes last
            const o = k * 3
            A[o] += (B[o] - A[o]) * qk
            A[o + 1] += (B[o + 1] - A[o + 1]) * qk
            A[o + 2] += (B[o + 2] - A[o + 2]) * qk
          }
        }
        if (p >= hit + hold + recover) this.action = null
      }
      this.weight = this.action ? w : 0
      const R = this.rest
      const A = this.actA
      const P = this.pts
      for (let i = 0; i < n; i++) P[i] = R[i] + (A[i] - R[i]) * w
    } else {
      this.weight = 0
      this.pts.set(this.rest)
    }
    if (this.snapW > 0) {
      const s = ease(this.snapW)
      const P = this.pts
      const S = this.snap
      for (let i = 0; i < n; i++) P[i] += (S[i] - P[i]) * s
      this.snapW = Math.max(0, this.snapW - dt / OCTO.snapTime)
    }
    this.writeTube()
  }

  writeTube() {
    const { R, S, pts, rad, slope, inv, frame } = this
    // Tangents (central differences).
    for (let k = 0; k <= R; k++) {
      const a = Math.max(0, k - 1) * 3
      const b = Math.min(R, k + 1) * 3
      let tx = pts[b] - pts[a]
      let ty = pts[b + 1] - pts[a + 1]
      let tz = pts[b + 2] - pts[a + 2]
      const l = Math.hypot(tx, ty, tz) || 1
      const f = k * 9
      frame[f] = tx / l
      frame[f + 1] = ty / l
      frame[f + 2] = tz / l
    }
    // Normals: "up" projected at the root, then parallel transport down the spine.
    let nx = 0
    let ny = 1
    let nz = 0
    for (let k = 0; k <= R; k++) {
      const f = k * 9
      const tx = frame[f]
      const ty = frame[f + 1]
      const tz = frame[f + 2]
      if (k === 0) {
        const d = ty
        nx = -d * tx
        ny = 1 - d * ty
        nz = -d * tz
        if (Math.hypot(nx, ny, nz) < 0.25) {
          // Root pointing straight up: lean the frame on the outward direction.
          const ox = Math.sin(this.theta)
          const oz = Math.cos(this.theta)
          const e = ox * tx + oz * tz
          nx = -(ox - e * tx)
          ny = e * ty
          nz = -(oz - e * tz)
        }
      } else {
        const d = nx * tx + ny * ty + nz * tz
        nx -= d * tx
        ny -= d * ty
        nz -= d * tz
      }
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl
      ny /= nl
      nz /= nl
      frame[f + 3] = nx
      frame[f + 4] = ny
      frame[f + 5] = nz
      frame[f + 6] = ty * nz - tz * ny
      frame[f + 7] = tz * nx - tx * nz
      frame[f + 8] = tx * ny - ty * nx
    }
    const pos = this.pos.array
    const nor = this.nor.array
    const cos = TABLES[S].cos
    const sin = TABLES[S].sin
    for (let k = 0; k <= R; k++) {
      const f = k * 9
      const px = pts[k * 3]
      const py = pts[k * 3 + 1]
      const pz = pts[k * 3 + 2]
      const r = rad[k]
      const g = slope[k]
      const iv = inv[k]
      const tx = frame[f]
      const ty = frame[f + 1]
      const tz = frame[f + 2]
      const Nx = frame[f + 3]
      const Ny = frame[f + 4]
      const Nz = frame[f + 5]
      const Bx = frame[f + 6]
      const By = frame[f + 7]
      const Bz = frame[f + 8]
      for (let j = 0; j <= S; j++) {
        const c = cos[j]
        const s = sin[j]
        const ox = c * Nx + s * Bx
        const oy = c * Ny + s * By
        const oz = c * Nz + s * Bz
        const i = (k * (S + 1) + j) * 3
        pos[i] = px + ox * r
        pos[i + 1] = py + oy * r
        pos[i + 2] = pz + oz * r
        nor[i] = (ox + g * tx) * iv
        nor[i + 1] = (oy + g * ty) * iv
        nor[i + 2] = (oz + g * tz) * iv
      }
    }
    this.pos.needsUpdate = true
    this.nor.needsUpdate = true
    if (this.spikes.visible) this.writeSpikes()
  }

  writeSpikes() {
    const { pts, rad, frame } = this
    const pos = this.spos.array
    const nor = this.snor.array
    for (let s = 0; s < this.spikeRings.length; s++) {
      const k = this.spikeRings[s]
      const f = k * 9
      const tx = frame[f]
      const ty = frame[f + 1]
      const tz = frame[f + 2]
      // Alternate a little left/right of the top line.
      const ang = (s % 2 ? 0.32 : -0.32)
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const dx = ca * frame[f + 3] + sa * frame[f + 6]
      const dy = ca * frame[f + 4] + sa * frame[f + 7]
      const dz = ca * frame[f + 5] + sa * frame[f + 8]
      // Side vector in the base plane.
      const sx = dy * tz - dz * ty
      const sy = dz * tx - dx * tz
      const sz = dx * ty - dy * tx
      const r = rad[k]
      const h = r * 1.15 + 0.05
      const br = r * 0.42
      const cx = pts[k * 3] + dx * r * 0.8
      const cy = pts[k * 3 + 1] + dy * r * 0.8
      const cz = pts[k * 3 + 2] + dz * r * 0.8
      const o = s * 15
      // Base square: corners along +T, +side, -T, -side.
      for (let j = 0; j < 4; j++) {
        const sg = j < 2 ? 1 : -1
        const ux = (j % 2 === 0 ? tx : sx) * sg
        const uy = (j % 2 === 0 ? ty : sy) * sg
        const uz = (j % 2 === 0 ? tz : sz) * sg
        const i = o + j * 3
        pos[i] = cx + ux * br
        pos[i + 1] = cy + uy * br
        pos[i + 2] = cz + uz * br
        nor[i] = ux * 0.8 + dx * 0.6
        nor[i + 1] = uy * 0.8 + dy * 0.6
        nor[i + 2] = uz * 0.8 + dz * 0.6
      }
      const i = o + 12
      pos[i] = cx + dx * h + tx * h * 0.35
      pos[i + 1] = cy + dy * h + ty * h * 0.35
      pos[i + 2] = cz + dz * h + tz * h * 0.35
      nor[i] = dx
      nor[i + 1] = dy
      nor[i + 2] = dz
    }
    this.spos.needsUpdate = true
    this.snor.needsUpdate = true
  }
}

// Ring cos/sin tables per side count (the tables include the seam copy j = sides).
const TABLES = {}
function tables(S) {
  if (!TABLES[S]) {
    const cos = new Float32Array(S + 1)
    const sin = new Float32Array(S + 1)
    for (let j = 0; j <= S; j++) {
      cos[j] = Math.cos((j / S) * TAU)
      sin[j] = Math.sin((j / S) * TAU)
    }
    TABLES[S] = { cos, sin }
  }
  return TABLES[S]
}

// Seeded random for per-arm variety (same arms every rebuild).
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Body: mantle + eyes + arms (shared by the player octopus and the shop displays) --------
const mantleGeos = {}
let eyeGeos = null

class OctoCore {
  constructor(parent, { rings, sides, eyes }) {
    this.parent = parent
    this.rings = rings
    this.sides = sides
    tables(sides)
    this.arms = []
    this.def = null
    this.mats = null
    const segs = rings >= 24 ? OCTO.mantle.segments : 20
    mantleGeos[segs] ||= mantleGeometry(segs)
    this.mantleNode = new Group()
    parent.add(this.mantleNode)
    this.mantle = new Mesh(mantleGeos[segs], undefined)
    this.mantle.castShadow = true
    this.mantle.receiveShadow = true
    this.mantleNode.add(this.mantle)
    this.eyes = []
    if (eyes) this.buildEyes()
    this.blinkIn = 2 + Math.random() * 3
    this.blink = 0
  }

  buildEyes() {
    const E = OCTO.eyes
    const m = eyeMaterials()
    eyeGeos ||= { white: new SphereGeometry(1, 20, 14), pupil: new SphereGeometry(1, 16, 12), shine: new SphereGeometry(1, 8, 6) }
    for (const s of [-1, 1]) {
      const a = s * E.angle
      const eye = new Group()
      eye.position.set(Math.sin(a) * E.r, E.y, Math.cos(a) * E.r)
      eye.rotation.y = a
      const white = new Mesh(eyeGeos.white, m.white)
      white.scale.set(E.size, E.size * 1.1, E.size * 0.8)
      const pupil = new Mesh(eyeGeos.pupil, m.pupil)
      pupil.scale.setScalar(E.size * 0.55)
      pupil.position.set(-s * 0.02, -0.01, E.size * 0.48)
      const shine = new Mesh(eyeGeos.shine, m.shine)
      shine.scale.setScalar(E.size * 0.18)
      shine.position.set(E.size * 0.2, E.size * 0.28, E.size * 0.85)
      eye.add(white, pupil, shine)
      this.mantleNode.add(eye)
      this.eyes.push(eye)
    }
  }

  setArms(n) {
    n = clamp(Math.round(n), 1, 16)
    if (this.arms.length === n) return
    for (const a of this.arms) a.dispose()
    this.arms = []
    const rand = seeded(1234)
    for (let i = 0; i < n; i++) this.arms.push(new Arm(this.parent, i, n, this.rings, this.sides, rand))
    if (this.def) this.applySkin()
  }

  setSkin(def) {
    if (!def) return
    this.def = def
    this.mats = skinMaterials(def)
    this.applySkin()
  }

  applySkin() {
    this.mantle.material = this.mats.mantle
    for (const a of this.arms) a.setMaterials(this.mats.arm, this.mats.spike, this.def.spikes)
  }

  update(dt, env) {
    // Blinking eyes.
    if (this.eyes.length) {
      this.blinkIn -= dt
      if (this.blinkIn <= 0) {
        this.blink = 0.14
        this.blinkIn = 2.5 + Math.random() * 4
      }
      this.blink = Math.max(0, this.blink - dt)
      const sy = this.blink > 0 ? 0.15 + 0.85 * Math.abs(this.blink / 0.07 - 1) : 1
      for (const e of this.eyes) e.scale.y = sy
    }
    for (const a of this.arms) a.update(dt, env)
  }

  dispose() {
    for (const a of this.arms) a.dispose()
    this.arms = []
    this.mantleNode.removeFromParent()
  }
}

// Shared per-frame environment for the arms (one object, rewritten each frame).
function makeEnv() {
  return { time: 0, gait: 0, move: 0, drag: 0, hurt: 0, flare: 0, bob: 0, air: 0, curl: OCTO.restCurl, tipStart: 0.62 }
}

// --- The player's octopus ------------------------------------------------------------------------------
class Octopus {
  // lod: the cheaper mesh (the shop displays' ring / side counts) for the other players' octopi.
  constructor({ lod = false } = {}) {
    this.group = new Group()
    this.group.name = 'octopus'
    this.body = new Group()
    this.group.add(this.body)
    this.seat = new Object3D()
    this.seat.name = 'octopus-seat'
    this.group.add(this.seat)
    this.core = new OctoCore(this.body, { rings: lod ? OCTO.displayRings : OCTO.rings, sides: lod ? OCTO.displaySides : OCTO.sides, eyes: false }) // the player's lower body: no face
    this.scale = 1
    this.env = makeEnv()
    this.moveEased = 0
    this.airEased = 0
    this.lean = 0
    this.hurtT = 0
    this.pulseT = 0
    this.dipT = 0
    this.trainTurn = 0
    this.grabs = [] // { arm, H, target, high, ground, world }
    this.grabT = -1
    this.grabSlammed = false
    this.tmp = new Vector3()

    // A fleshy collar hugging the rider's waist where they emerge from the dome.
    this.collar = new Mesh(new TorusGeometry(OCTO.collar.radius, OCTO.collar.tube, 10, 28), undefined)
    this.collar.rotation.x = Math.PI / 2
    this.collar.castShadow = true
    this.seat.add(this.collar)
  }

  get reach() {
    return OCTO.reach * this.scale
  }

  setArms(n) {
    this.grabs = []
    this.grabT = -1
    this.core.setArms(n)
  }

  setSkin(def) {
    this.core.setSkin(def)
    this.collar.material = this.core.mats?.mantle
  }

  setScale(s) {
    this.scale = Math.max(0.2, s)
    this.body.scale.setScalar(this.scale) // now, so actions issued before the next update() aim right
  }

  hurt() {
    this.hurtT = 1
  }

  pulse() {
    this.pulseT = 1
  }

  // World point -> body space (unscaled octopus units).
  toBody(world, out) {
    this.body.updateWorldMatrix(true, false)
    out.copy(world)
    return this.body.worldToLocal(out)
  }

  // Free arms sorted by how well they face `yaw` (body space); busy ones last.
  pickArms(yaw, count, allowBusy = true) {
    const list = this.core.arms
      .filter((a) => !a.action || a.action.kind !== 'grab')
      .map((a) => ({ a, d: angleDiff(a.theta, yaw) + (a.busy() ? 10 : 0) }))
      .sort((p, q) => p.d - q.d)
    const out = []
    for (const e of list) {
      if (out.length >= count) break
      if (!allowBusy && e.d >= 10) break
      out.push(e.a)
    }
    return out
  }

  clampTarget(t) {
    const maxR = OCTO.reach
    const d = Math.hypot(t.x, t.z)
    if (d > maxR) {
      t.x *= maxR / d
      t.z *= maxR / d
    } else if (d < 1.1) {
      const k = 1.1 / (d || 1)
      t.x = d ? t.x * k : 0
      t.z = d ? t.z * k : 1.1
    }
    t.y = clamp(t.y, 0.15, 3)
    return t
  }

  strike(worldPos, cfg, arm) {
    const target = this.clampTarget(this.toBody(worldPos, new Vector3()))
    const yaw = Math.atan2(target.x, target.z)
    if (!arm) arm = this.pickArms(yaw, 1)[0]
    if (!arm) return cfg.hit
    arm.start({ kind: 'strike', cfg, t: 0, target, yaw })
    return cfg.hit
  }

  slap(worldPos) {
    return this.strike(worldPos, OCTO.slap)
  }

  // Alternates between the arms best facing the dummy.
  train(worldPos) {
    const target = this.toBody(worldPos, this.tmp)
    const yaw = Math.atan2(target.x, target.z)
    const arms = this.pickArms(yaw, 3)
    const free = arms.filter((a) => !a.busy())
    const pool = free.length ? free : arms
    const arm = pool[this.trainTurn++ % pool.length]
    return this.strike(worldPos, OCTO.train, arm)
  }

  grabSlam(worldPositions) {
    const G = OCTO.grab
    const s = this.scale
    this.grabs = []
    const used = new Set()
    for (const wp of worldPositions) {
      const world = wp.clone()
      const target = this.clampTarget(this.toBody(wp, new Vector3()))
      const yaw = Math.atan2(target.x, target.z)
      const arm = this.core.arms
        .filter((a) => !used.has(a))
        .sort((p, q) => angleDiff(p.theta, yaw) - angleDiff(q.theta, yaw))[0]
      if (!arm) {
        this.grabs.push({ arm: null, world })
        continue
      }
      used.add(arm)
      const highY = (G.highBase + G.highPerScale * s) / s
      const entry = {
        arm,
        world,
        target,
        H: target.clone(),
        high: new Vector3(target.x * 0.5, highY, target.z * 0.5),
        ground: new Vector3(target.x * 1.05, 0.25 / s + 0.1, target.z * 1.05),
      }
      arm.start({ kind: 'grab', t: 0, H: entry.H, rw: clamp(G.wrap / s, 0.16, 0.5) })
      this.grabs.push(entry)
    }
    this.grabT = 0
    this.grabSlammed = false
    return { liftAt: G.liftAt, slamAt: G.slamAt, end: G.end }
  }

  getGrabPoint(i, out) {
    const g = this.grabs[i]
    if (!g) return out
    if (!g.arm) return out.copy(g.world)
    this.body.updateWorldMatrix(true, false)
    out.copy(g.H)
    return this.body.localToWorld(out)
  }

  updateGrabs(dt) {
    if (this.grabT < 0) return
    const G = OCTO.grab
    this.grabT += dt
    const p = this.grabT
    const fall = 0.14
    for (const g of this.grabs) {
      if (!g.arm) continue
      if (p < G.liftAt) g.H.copy(g.target)
      else if (p < G.slamAt - fall) {
        const e = ease((p - G.liftAt) / (G.slamAt - fall - G.liftAt))
        g.H.lerpVectors(g.target, g.high, e)
        g.H.y += Math.sin(e * Math.PI) * 0.5 // swing up in an arc
      } else if (p < G.slamAt) {
        const e = (p - (G.slamAt - fall)) / fall
        g.H.lerpVectors(g.high, g.ground, e * e)
      } else g.H.copy(g.ground)
    }
    if (!this.grabSlammed && p >= G.slamAt) {
      this.grabSlammed = true
      this.dipT = 1
    }
    if (p >= G.end) {
      this.grabT = -1
      this.grabs = []
    }
  }

  update(dt, { speed = 0, grounded = true, time = 0 } = {}) {
    if (!(dt > 0)) dt = 0
    const env = this.env
    const k = 1 - Math.exp(-6 * dt)
    this.moveEased += (smooth(0.4, 6, speed) - this.moveEased) * k
    this.airEased += ((grounded ? 0 : 1) - this.airEased) * (1 - Math.exp(-(grounded ? 10 : 4) * dt))
    this.hurtT = Math.max(0, this.hurtT - dt / 0.35)
    this.pulseT = Math.max(0, this.pulseT - dt / 0.7)
    this.dipT = Math.max(0, this.dipT - dt / 0.3)
    const move = this.moveEased

    env.time = time
    env.gait += (dt * TAU * speed) / OCTO.gaitStride
    if (env.gait > 1e4) env.gait -= TAU * 1000
    env.move = move
    env.drag = OCTO.drag * move
    env.hurt = Math.sin(this.hurtT * Math.PI) * this.hurtT
    env.flare = Math.sin(this.pulseT * Math.PI)
    env.air = this.airEased
    const breath = Math.sin(time * 1.3)
    env.bob = 0.06 * Math.sin(env.gait * 2) * move + 0.015 * breath - 0.12 * Math.sin(this.dipT * Math.PI)

    // Mantle: breathing, squash on hurt / slam, lean into the walk.
    this.lean += (0.13 * move - this.lean) * k
    const squash = 0.16 * env.hurt + 0.1 * Math.sin(this.dipT * Math.PI)
    const sy = (1 + 0.022 * breath) * (1 - squash) + 0.08 * env.flare
    const sxz = (1 - 0.012 * breath) * (1 + squash * 0.7) + 0.05 * env.flare
    const node = this.core.mantleNode
    node.position.y = env.bob
    node.rotation.x = this.lean
    node.scale.set(sxz, sy, sxz)

    const s = this.scale * (1 + 0.16 * env.flare)
    this.body.scale.setScalar(s)

    this.updateGrabs(dt)
    this.core.update(dt, env)

    // Rider: waist at the dome surface, carried by the bob and lean.
    const rho = OCTO.collar.rho / s
    const top = (domeY(rho) * sy + env.bob) * s
    this.seat.position.set(0, top - OCTO.waist, Math.sin(this.lean) * top * 0.45)
    this.seat.rotation.x = this.lean * 0.6
    this.collar.position.y = OCTO.waist - 0.03
  }

  dispose() {
    this.core.dispose()
    this.collar.geometry.dispose()
    this.group.removeFromParent()
  }
}

export function createOctopus(opts) {
  return new Octopus(opts)
}

// --- Shop display: a smaller rider-less octopus that idles and slowly turns ----------------------------
export function createTentacleDisplay(def, { size = 2, arms = 6 } = {}) {
  const group = new Group()
  group.name = `display-${def.id}`
  const spin = new Group()
  spin.scale.setScalar(size / 7.6) // the idle pose spans ~7.6 body units across
  group.add(spin)
  const core = new OctoCore(spin, { rings: OCTO.displayRings, sides: OCTO.displaySides, eyes: false })
  core.setArms(arms)
  core.setSkin(def)
  const env = makeEnv()
  env.curl = OCTO.restCurl + 0.4
  env.tipStart = 0.55
  const offset = Math.random() * 100
  let clock = 0
  return {
    group,
    update(dt, time) {
      clock += dt
      env.time = (Number.isFinite(time) ? time : clock) + offset
      spin.rotation.y += dt * 0.35
      const breath = Math.sin(env.time * 1.3)
      env.bob = 0.02 * breath
      core.mantleNode.position.y = env.bob
      core.mantleNode.scale.set(1 - 0.012 * breath, 1 + 0.025 * breath, 1 - 0.012 * breath)
      core.update(dt, env)
    },
    dispose() {
      core.dispose()
      group.removeFromParent()
    },
  }
}
