import {
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { HUB, LANE, STAGES, WATER, stageEndZ } from './config.js'
import { bake } from './bake.js'
import { mulberry32, paintWaterNormal, toTexture } from './textures.js'

// The sea around the hub island and the lane, and puffy clouds in the sky.
// (The land itself is built by hub.js and lane.js.)
//
// Texture techniques used here:
//  - sea: one ripple normal map used twice (normalMap + clearcoatNormalMap) at
//    different scales, scrolled in different directions each frame, over a
//    lighter shallow-water band hugging the island and the lane

// --- Tunables ---------------------------------------------------------------------------
const SEA = {
  shallowPad: 7, // m of shallow band around the land
  clouds: 34,
  cloudSeed: 2024,
}

// Outline (world x, z) of the land seen from above: the hub square plus the lane strip.
function landOutline(pad) {
  const hubX = HUB.maxX + HUB.wallThickness + 12 + pad
  const hubN = HUB.minZ - HUB.wallThickness - 12 - pad
  const hubS = HUB.maxZ + pad
  const laneX = LANE.halfWidth + LANE.cliffWidth + pad
  const laneN = stageEndZ(STAGES.count) - 36 - pad
  return [
    [-hubX, hubS],
    [hubX, hubS],
    [hubX, hubN],
    [laneX, hubN],
    [laneX, laneN],
    [-laneX, laneN],
    [-laneX, hubN],
    [-hubX, hubN],
  ]
}

// Shape space is (x, -z): rotating the shape -90 deg about X maps shape y to world -z.
function outlineShape(points) {
  const s = new Shape()
  points.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)))
  s.closePath()
  return s
}

function makeClouds() {
  const rand = mulberry32(SEA.cloudSeed)
  const geo = new IcosahedronGeometry(1, 3)
  const mat = new MeshLambertMaterial({ color: '#ffffff', emissive: '#e4f0ff', emissiveIntensity: 0.66, fog: false })
  const group = new Group()
  const north = stageEndZ(STAGES.count)
  for (let i = 0; i < SEA.clouds; i++) {
    // Spread along the whole land (hub to the end of the lane), off to either side.
    const z = 180 + rand() * (north - 420)
    const side = rand() < 0.5 ? -1 : 1
    const x = side * (150 + rand() * 260)
    const cloud = new Group()
    const puffs = 5 + Math.floor(rand() * 4)
    const len = 24 + rand() * 30
    for (let p = 0; p < puffs; p++) {
      const t = p / (puffs - 1) - 0.5
      const r = (1 - Math.abs(t) * 1.1) * (9 + rand() * 7)
      const puff = new Mesh(geo, mat)
      puff.scale.set(r, r * 0.82, r)
      puff.position.set(t * len, r * 0.25 + rand() * 3, (rand() - 0.5) * 8)
      cloud.add(puff)
    }
    const flat = new Mesh(geo, mat) // flat underside
    flat.scale.set(len * 0.62, 4, 9)
    cloud.add(flat)
    cloud.position.set(x, 45 + rand() * 75, z)
    cloud.rotation.y = rand() * Math.PI
    group.add(cloud)
  }
  // One draw call for the whole sky.
  const baked = bake(group, false)
  baked.traverse((o) => o.isMesh && (o.frustumCulled = false))
  return baked
}

// The sea and the clouds. Returns { setSeaColor, update(dt, elapsed) }.
export function createWorld(scene) {
  const ripples = paintWaterNormal()
  const span = WATER.size * 2
  const normalA = toTexture(ripples, { repeat: span / 14 })
  const normalB = toTexture(ripples, { repeat: span / 37 })
  const sea = new Mesh(
    new PlaneGeometry(span, span),
    new MeshPhysicalMaterial({
      color: WATER.color,
      roughness: 0.25,
      metalness: 0,
      normalMap: normalA,
      normalScale: new Vector2(0.3, 0.3),
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      clearcoatNormalMap: normalB,
      clearcoatNormalScale: new Vector2(0.5, 0.5),
      transparent: true,
      opacity: 0.95,
    }),
  )
  sea.rotation.x = -Math.PI / 2
  sea.position.set(0, WATER.level, stageEndZ(STAGES.count) / 2)
  sea.receiveShadow = true

  const shallowGeo = new ShapeGeometry(outlineShape(landOutline(SEA.shallowPad)))
  shallowGeo.rotateX(-Math.PI / 2)
  const band = new Mesh(shallowGeo, new MeshStandardMaterial({ color: WATER.shallow, roughness: 0.3, transparent: true, opacity: 0.5, depthWrite: false }))
  band.position.y = WATER.level + 0.04
  band.renderOrder = 1

  scene.add(sea, band, makeClouds())

  return {
    setSeaColor: (color) => sea.material.color.set(color),
    update(dt, elapsed) {
      // One ripple tile is 14 m (A) / 37 m (B).
      normalA.offset.set(elapsed * 0.012, elapsed * 0.02)
      normalB.offset.set(-elapsed * 0.008, elapsed * 0.005)
    },
  }
}
