// The lane: a canyon running north from the hub's wall gap, cut into
// STAGES.count stages. Grass floor with a sandy dirt track down the middle,
// stepped checkered cliffs with grass tops and voxel trees on both sides, a
// few props along the edges. Each stage ends in a pink frame holding a
// translucent glowing LOCKED wall (with a collider) and, just before it, two
// reward pads (pink Wins, orange XP). Past the last stage: a finish platform
// with a trophy statue. Static geometry is baked per few stages; each stage's
// live pieces (gate, pads, sign) sit in their own group so update() can hide
// the ones far from the player. See buildLane() for the returned API.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector2,
} from 'three'
import { LANE, STAGES, gateZ, padZ, stageEndZ, stageStartZ } from './config.js'
import { RAPIER, addFixed, world } from './physics.js'
import { label, neon, solidBox } from './propkit.js'
import { mulberry32, paintFade } from './textures.js'
import {
  TILE,
  addBox,
  bakeColored,
  addMesh,
  addSpan,
  brokenFence,
  bush,
  canvasPlane,
  canvasSprite,
  canvasTex,
  crystalRock,
  drawStar,
  drawTrophy,
  flat,
  outlineText,
  voxelTree,
  worldMats,
} from './worldTextures.js'

// --- Tunables --------------------------------------------------------------------------------
export const LANE_LOOK = {
  chunkStages: 3, // stages baked together
  // Cliff terraces beyond the floor edge: [from, to] metres past halfWidth, [min, max] height.
  tiers: [
    [0, 6, [5, 8]],
    [6, 14, [9, 12]],
    [14, 26, [13, 17]],
  ],
  cliffChunk: 14, // m of cliff per height step
  hubOverlap: 4, // the lane's visuals start this far inside the hub's north wall
  gateHeight: 12,
  gateColor: '#ff4fc8',
  gateOpenTime: 0.8, // s
  padColors: { wins: '#ff3fd0', xp: '#ff9a1a' },
  padLabelY: 3.4,
  finishLength: 30,
  visibleRange: 150, // m: a stage's live pieces farther than this from update()'s focus are hidden
}

const PI = Math.PI
const ease = (t) => t * t * (3 - 2 * t)

const gateVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const gateFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float top = 1.0 - smoothstep(0.5, 1.0, vUv.y);
    float sides = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
    float wave = sin(vUv.y * 16.0 - uTime * 2.2 + sin(vUv.x * 7.0 + uTime * 0.9) * 1.6);
    float shimmer = 0.5 + 0.5 * wave;
    float sparkle = pow(max(0.0, sin(vUv.x * 61.0 + uTime * 1.3) * sin(vUv.y * 47.0 - uTime * 1.7)), 12.0);
    vec3 col = uColor * (1.05 + 0.35 * shimmer) + vec3(1.0, 0.85, 0.95) * sparkle * 0.8;
    col += uColor * smoothstep(0.1, 0.0, vUv.y) * 1.4;
    float alpha = (0.34 + 0.12 * shimmer + sparkle * 0.3) * top * sides * uFade;
    alpha += smoothstep(0.06, 0.0, vUv.y) * 0.35 * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

export function buildLane(scene) {
  const W = worldMats()
  const rand = mulberry32(4040)
  const H = LANE.halfWidth
  const outer = H + LANE.cliffWidth
  const zStartVis = LANE.startZ - LANE_LOOK.hubOverlap // visuals begin inside the hub's north wall
  const lastEnd = stageEndZ(STAGES.count)
  const finishEnd = lastEnd - LANE_LOOK.finishLength
  const fadeTex = canvasTex(paintFade('#ffffff'))
  const time = { value: 0 }

  // --- Colliders (whole lane) ---
  solidBox(outer, 0.5, (zStartVis - finishEnd + 6) / 2, 0, -0.5, (zStartVis + finishEnd - 6) / 2)
  for (const s of [-1, 1]) solidBox(1, 15, (LANE.startZ - finishEnd) / 2, s * (H + 1), 15, (LANE.startZ + finishEnd) / 2)
  solidBox(H + 2, 15, 1, 0, 15, finishEnd - 1)

  // --- Static geometry, baked in chunks ---
  const chunks = []
  let chunk = null
  const newChunk = () => {
    chunk = new Group()
    chunks.push(chunk)
  }

  // A run of cliffs + floor between z0 (south, larger) and z1 (north).
  const terrain = (g, z0, z1, floorMat = W.grass, floorTile = TILE.grass) => {
    addSpan(g, W.checkerDark, -outer, outer, -7, -0.3, z1, z0, TILE.checker)
    addSpan(g, floorMat, -H, H, -0.3, 0, z1, z0, floorTile)
    for (const side of [-1, 1]) {
      for (let z = z0; z > z1 + 0.01; z -= LANE_LOOK.cliffChunk) {
        const za = z
        const zb = Math.max(z1, z - LANE_LOOK.cliffChunk)
        LANE_LOOK.tiers.forEach(([a, b, [hmin, hmax]], ti) => {
          const h = Math.round(hmin + rand() * (hmax - hmin))
          const xa = side * (H + a)
          const xb = side * (H + b)
          const x0 = Math.min(xa, xb)
          const x1 = Math.max(xa, xb)
          addSpan(g, W.checker, x0, x1, -1, h, zb, za, TILE.checker)
          const over = ti === 0 ? 0.3 : 0
          addSpan(g, W.grass, side > 0 ? x0 - over : x0, side > 0 ? x1 : x1 + over, h - 0.1, h + 0.6, zb, za, TILE.grass)
          const top = h + 0.6
          const zm = (za + zb) / 2 + (rand() - 0.5) * 8
          if (ti === 0 && rand() < 0.35) bush(g, side * (H + 2 + rand() * 3), top, zm, 0.9, rand)
          if (ti === 1 && rand() < 0.45) voxelTree(g, side * (H + a + 2 + rand() * 4), top, zm, 0.9 + rand() * 0.4, rand)
          if (ti === 2 && rand() < 0.65) voxelTree(g, side * (H + a + 3 + rand() * 7), top, zm, 1 + rand() * 0.5, rand)
        })
      }
    }
  }

  // Sandy track down the middle with ragged 2 m patches along its edges.
  const track = (g, z0, z1) => {
    addSpan(g, W.sand, -3.2, 3.2, -0.05, 0.02, z1, z0, TILE.sand)
    for (let z = z0; z - 2 >= z1; z -= 2) {
      for (const side of [-1, 1]) {
        if (rand() < 0.45) addSpan(g, W.sand, side > 0 ? 3.2 : -5.2, side > 0 ? 5.2 : -3.2, -0.05, 0.02, z - 2, z, TILE.sand)
      }
    }
  }

  const stages = []
  for (let s = 1; s <= STAGES.count; s++) {
    if ((s - 1) % LANE_LOOK.chunkStages === 0) newChunk()
    const zStart = stageStartZ(s)
    const zEnd = stageEndZ(s)
    const gz = gateZ(s)
    const pz = padZ(s)
    const boss = s % STAGES.bossEvery === 0
    const g = chunk
    const z0 = s === 1 ? zStartVis : zStart
    terrain(g, z0, zEnd)
    if (s === 1) {
      addSpan(g, W.path, -H, H, -0.05, 0.03, zStartVis - 10, zStartVis, TILE.path)
      track(g, zStartVis - 10, zEnd)
    } else track(g, zStart, zEnd)

    // Edge props, kept out of the reward / gate area.
    const props = 4 + Math.floor(rand() * 3)
    for (let i = 0; i < props; i++) {
      const side = rand() < 0.5 ? -1 : 1
      const z = zEnd + 15 + rand() * (zStart - zEnd - 20)
      const x = side * (6.9 + rand() * 1.1)
      const k = rand()
      if (k < 0.4) bush(g, x, 0, z, 0.8, rand)
      else if (k < 0.75) crystalRock(g, x, 0, z, 0.7 + rand() * 0.4, rand)
      else brokenFence(g, x, 0, z, 3 + rand() * 2, rand)
    }

    // Gate frame (stays when the gate opens).
    for (const side of [-1, 1]) addSpan(g, W.pink, side > 0 ? H - 0.1 : -H - 1.7, side > 0 ? H + 1.7 : -H + 0.1, -1, LANE_LOOK.gateHeight + 1, gz - 0.9, gz + 0.9, TILE.pink)
    addSpan(g, W.pink, -H - 1.7, H + 1.7, LANE_LOOK.gateHeight + 1, LANE_LOOK.gateHeight + 2.3, gz - 0.7, gz + 0.7, TILE.pink)
    for (let i = 0; i < 5; i++) {
      const w = 0.8 + rand() * 0.9
      addBox(g, W.pink, w, w, w, -H + rand() * 2 * H, LANE_LOOK.gateHeight + 2.3 + w / 2 - 0.1, gz + (rand() - 0.5) * 0.6, TILE.pink, rand())
    }

    stages.push(makeStage(s, { zStart, zEnd, gz, pz, boss }))
  }

  // --- Finish platform + trophy ---
  {
    const g = chunk
    terrain(g, lastEnd, finishEnd, W.gold, 2)
    addSpan(g, W.checker, -outer, outer, -1, 16, finishEnd - 6, finishEnd, TILE.checker)
    addSpan(g, W.grass, -outer, outer, 15.9, 16.6, finishEnd - 6, finishEnd, TILE.grass)
    const tz = finishEnd + 12
    addSpan(g, flat('#3a1a5a', { roughness: 0.5 }), -3, 3, 0, 0.8, tz - 3, tz + 3, 2)
    addSpan(g, W.gold, -1.8, 1.8, 0.8, 3.0, tz - 1.8, tz + 1.8, 2)
    const gold = flat('#ffc21a', { metalness: 0.75, roughness: 0.25 })
    const profile = [
      [0.0, 0],
      [0.9, 0],
      [0.9, 0.3],
      [0.35, 0.5],
      [0.3, 1.6],
      [0.7, 1.9],
      [1.7, 2.6],
      [2.1, 3.6],
      [2.2, 4.6],
      [2.0, 4.6],
      [1.6, 3.4],
      [0.0, 3.3],
    ].map(([x, y]) => new Vector2(x, y))
    addMesh(g, new LatheGeometry(profile, 32), gold, 0, 3.0, tz)
    for (const sx of [-1, 1]) addMesh(g, new TorusGeometry(0.8, 0.18, 8, 24, PI), gold, sx * 2.1, 6.4, tz, 0, 0, sx > 0 ? -PI / 2 : PI / 2)
    solidBox(3, 0.4, 3, 0, 0.4, tz)
    solidBox(1.9, 4, 1.9, 0, 4, tz)
    const champ = label('LANE COMPLETE!', 2.6, { colors: ['#ffe14a'], outline: '#3a1250' })
    champ.position.set(0, 11.5, tz)
    scene.add(champ)
    const star = new Mesh(new TorusGeometry(0.5, 0.18, 6, 5), neon('#fff27a', 3))
    star.position.set(0, 8.4, tz)
    scene.add(star)
  }

  for (const c of chunks) {
    const baked = bakeColored(c, true)
    baked.traverse((o) => o.isMesh && (o.receiveShadow = true))
    baked.name = 'lane-static'
    scene.add(baked)
  }

  // --- Stage live pieces ---
  function makeStage(s, { zStart, zEnd, gz, pz, boss }) {
    const live = new Group()
    live.name = `stage-${s}`
    scene.add(live)

    const sign = label(`STAGE ${s}\nRecommended Level ${STAGES.rec[s - 1]}`, 3.4, { colors: ['#ffffff', '#ffe14a'], outline: '#2a1040' })
    sign.position.set(0, 8.5, zStart - 7)
    live.add(sign)

    // Gate wall.
    const gh = LANE_LOOK.gateHeight
    const gateMat = new ShaderMaterial({
      uniforms: { uTime: time, uFade: { value: 1 }, uColor: { value: new Color(LANE_LOOK.gateColor) } },
      vertexShader: gateVertex,
      fragmentShader: gateFragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    const wall = new Mesh(new PlaneGeometry(2 * H + 0.4, gh), gateMat)
    wall.position.set(0, gh / 2, gz)
    wall.renderOrder = 3
    live.add(wall)
    const gate = { open: false, left: null, anim: -1, collider: null }
    const text = canvasPlane(1024, 560, 15, 8.2, (ctx, w) => {
      let y = 70
      if (boss) {
        outlineText(ctx, 'BOSS', w / 2, y, 120, { fill: '#ff3a5c', stroke: '#3a0716', lw: 22 })
        y += 120
      } else y += 30
      outlineText(ctx, 'LOCKED', w / 2, y, 72, { fill: '#ffd0f0', stroke: '#6a1050', lw: 14 })
      y += 100
      if (gate.left != null) outlineText(ctx, `${gate.left} LEFT`, w / 2, y, 128, { fill: '#cfe6ff', stroke: '#1a2a7a', lw: 24 })
      y += 105
      outlineText(ctx, 'CLEAR THE WAVE TO PASS', w / 2, y, 56, { fill: '#cfe6ff', stroke: '#1a2a7a', lw: 12, maxWidth: w - 60 })
    })
    text.mesh.position.set(0, gh / 2 - 0.6, gz + 0.08)
    text.mesh.renderOrder = 4
    live.add(text.mesh)
    const makeCollider = () => {
      if (!gate.collider) gate.collider = addFixed(RAPIER.ColliderDesc.cuboid(H + 1, 10, 0.4), { x: 0, y: 10, z: gz })
    }
    const removeCollider = () => {
      if (gate.collider) {
        world.removeCollider(gate.collider, true)
        gate.collider = null
      }
    }
    makeCollider()

    // Reward pads.
    const pads = [
      makePad(live, 'wins', -LANE.padX, pz),
      makePad(live, 'xp', LANE.padX, pz),
    ]

    return {
      index: s,
      zStart,
      zEnd,
      gateZ: gz,
      boss,
      pads,
      live,
      setGate({ open, left } = {}) {
        if (left !== undefined && left !== gate.left) {
          gate.left = left
          text.redraw()
        }
        if (open === true && !gate.open) {
          gate.open = true
          gate.anim = 0
          removeCollider()
        } else if (open === false && gate.open) {
          gate.open = false
          gate.anim = -1
          wall.visible = text.mesh.visible = true
          wall.position.y = gh / 2
          text.mesh.position.y = gh / 2 - 0.6
          gateMat.uniforms.uFade.value = 1
          text.material.opacity = 1
          makeCollider()
        }
      },
      update(dt, elapsed) {
        if (gate.open && gate.anim >= 0) {
          gate.anim += dt
          const k = ease(Math.min(1, gate.anim / LANE_LOOK.gateOpenTime))
          wall.position.y = gh / 2 - gh * k
          text.mesh.position.y = gh / 2 - 0.6 - gh * k
          gateMat.uniforms.uFade.value = 1 - k
          text.material.opacity = 1 - k
          if (k >= 1) {
            wall.visible = text.mesh.visible = false
            gate.anim = -1
          }
        }
        for (const p of pads) p.update(dt, elapsed)
      },
    }
  }

  function makePad(parent, kind, x, z) {
    const color = LANE_LOOK.padColors[kind]
    const half = LANE.padHalf
    const g = new Group()
    g.position.set(x, 0, z)
    parent.add(g)
    const base = new Mesh(new BoxGeometry(2 * half + 0.5, 0.1, 2 * half + 0.5), flat('#2a1030', { roughness: 0.5 }))
    base.position.y = 0.05
    base.receiveShadow = true
    g.add(base)
    const lit = neon(color, 2.4)
    const dim = flat(new Color(color).multiplyScalar(0.45).getStyle(), { roughness: 0.6 })
    const top = new Mesh(new BoxGeometry(2 * half, 0.08, 2 * half), dim)
    top.position.y = 0.13
    g.add(top)
    const beam = new Mesh(
      new CylinderGeometry(half * 1.02, half * 1.02, 6, 28, 1, true),
      new MeshBasicMaterial({ color, map: fadeTex, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    )
    beam.position.y = 3.1
    g.add(beam)
    const ring = new Mesh(new TorusGeometry(half * 1.2, 0.07, 6, 40), neon(color, 3))
    ring.rotation.x = PI / 2
    ring.position.y = 0.3
    g.add(ring)
    let txt = kind === 'wins' ? '+0 Wins' : '+0 XP'
    const lab = canvasSprite(560, 180, 1.8, (ctx, w, h) => {
      ctx.font = '700 92px Fredoka, "Arial Black", sans-serif'
      const tw = Math.min(w - 140, ctx.measureText(txt).width)
      const x0 = w / 2 - (tw + 100) / 2
      if (kind === 'wins') drawTrophy(ctx, x0 + 40, h / 2, 96)
      else drawStar(ctx, x0 + 40, h / 2, 40, '#7af6ff', '#0a2a4a')
      outlineText(ctx, txt, x0 + 100 + tw / 2, h / 2, 92, { fill: kind === 'wins' ? '#ffe14a' : '#7af6ff', stroke: '#2a1238', lw: 16, maxWidth: w - 140 })
    })
    lab.sprite.position.y = LANE_LOOK.padLabelY
    g.add(lab.sprite)
    let active = false
    const apply = () => {
      top.material = active ? lit : dim
      beam.visible = ring.visible = active
      lab.sprite.material.opacity = active ? 1 : 0.55
    }
    apply()
    return {
      kind,
      x,
      z,
      half,
      setText(t) {
        if (t === txt) return
        txt = String(t)
        lab.redraw()
      },
      setActive(on) {
        if (!!on === active) return
        active = !!on
        apply()
        if (!active) lab.sprite.position.y = LANE_LOOK.padLabelY
      },
      update(dt, elapsed) {
        if (!active) return
        ring.rotation.z += dt * 1.6
        lab.sprite.position.y = LANE_LOOK.padLabelY + Math.sin(elapsed * 2.6 + x) * 0.22
        beam.material.opacity = 0.24 + 0.1 * Math.sin(elapsed * 3 + x)
      },
    }
  }

  return {
    stages,
    // focus (optional): the player's position; stages farther than visibleRange hide their live pieces.
    update(dt, elapsed, focus) {
      time.value = elapsed
      for (const st of stages) {
        if (focus) {
          const mid = (st.zStart + st.zEnd) / 2
          const near = Math.abs(focus.z - mid) < LANE_LOOK.visibleRange
          st.live.visible = near
          if (!near) continue
        }
        st.update(dt, elapsed)
      }
    },
  }
}
