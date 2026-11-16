// Every tunable constant lives here; the rest of src/ holds no theme values.

// --- Identity -------------------------------------------------------------
export const GAME_SLUG = 'octopus-evolution' // slug registered on bloxity.io
export const GAME_TITLE = 'Octopus Evolution'
export const SAVE_KEY = 'octopus-evolution.save.v1'

// Forces the Bloxity SDK and avatar CDN to be treated as unavailable (see .env.example).
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

// --- World (metres: +X east, +Z south, +Y up; north = -Z) ---------------------
export const GROUND_Y = 0
// The hub: a raised square island in the sea, walled on the west, north and east
// (checkered cliffs), open to the sea on the south. The lane leaves through a gap in
// the north wall. Tentacle shop on the west side, training zones along the east side,
// leaderboards in the four corners, the Worlds portal at the south end behind spawn.
export const HUB = {
  minX: -64,
  maxX: 64,
  minZ: -50, // the north wall's inner face; the lane starts here
  maxZ: 62,
  depth: 7, // island thickness above the sea floor (visual)
  wallHeight: 12,
  wallThickness: 4,
  laneHalf: 9, // half-width of the gap in the north wall (= the lane floor)
  tile: 4, // m per ground texture tile
  fenceHeight: 3, // invisible fence on the open south edge
  bossSpawn: { x: 0, z: -14 }, // the hub boss fight lands here
  portal: { x: 0, z: 54 },
}
export const WATER = { level: -0.6, size: 1400, color: '#1aa3ff', shallow: '#7ff0ff' }
export const SPAWN = { x: 0, y: 0.05, z: 33 }
export const SPAWN_FACING = Math.PI // yaw the character faces on spawn (PI = toward -Z, north)

// The lane: a canyon running north from the hub, cut into STAGES.count stages. Stage s
// (1-based) spans z from stageStartZ(s) down to stageStartZ(s) - stageLength; its gate
// (the pink LOCKED wall) stands gateInset metres before that end, and its two reward
// pads padInset metres before it.
export const LANE = {
  startZ: -50,
  stageLength: 56,
  halfWidth: 9, // walkable floor half-width
  cliffWidth: 26, // cliff terraces each side, beyond the floor
  gateInset: 2,
  padInset: 8,
  padX: 4.6, // pads at x = -padX (wins) and +padX (xp)
  padHalf: 1.9,
  triggerInset: 5, // walking this far past a stage's start begins its wave
}
export const stageStartZ = (s) => LANE.startZ - (s - 1) * LANE.stageLength
export const stageEndZ = (s) => stageStartZ(s) - LANE.stageLength
export const gateZ = (s) => stageEndZ(s) + LANE.gateInset
export const padZ = (s) => stageEndZ(s) + LANE.padInset

// --- Progression ------------------------------------------------------------------
// Levels come from training (hitting dummies). Each level needs xpNeed(L) XP; the level
// is capped per rebirth (capBase + capPerRebirth * rebirths) and a rebirth (at the cap)
// resets to level 1 for a permanent XP boost. Arms grow with level (arms table: [level,
// arms]), the octopus grows too. Damage and HP grow exponentially with level, and so do
// the bandits, stage by stage (STAGES.rec = the level each stage is tuned for).
export const PROGRESSION = {
  xpBase: 40,
  xpGrowth: 1.105,
  xpLinear: 15,
  capBase: 20,
  capPerRebirth: 12,
  rebirthBoost: 0.5, // +50% XP per rebirth
  arms: [
    [1, 4],
    [5, 5],
    [10, 6],
    [15, 7],
    [20, 8],
    [30, 9],
    [45, 10],
    [65, 11],
    [90, 12],
  ],
  dmgBase: 80,
  dmgGrowth: 1.145,
  hpBase: 150,
  hpGrowth: 1.12,
  sizeK: 0.38, // octopus scale = 1 + sizeK * log2(1 + level / 10)
}

// Tentacle skins. xp = training XP per dummy hit. price in Wins (never premium currency).
// colors: base (top skin), belly (sucker side), accent (pattern), glow (emissive pattern, optional).
// pattern: plain | spots | stripes | bands | glowspots | crystal | lava | galaxy | grid.
// spikes: small horns along the tentacle. special: shown on the two pedestals by the lane.
export const TENTACLES = [
  { id: 'reef', name: 'Reef', xp: 1, price: 0, pattern: 'plain', colors: { base: '#9b4dff', belly: '#f1d6ff', accent: '#7a2fe0' } },
  { id: 'coral', name: 'Coral', xp: 2, price: 1, pattern: 'plain', colors: { base: '#ff6a3d', belly: '#ffd9c4', accent: '#e0401a' } },
  { id: 'lagoon', name: 'Lagoon', xp: 3, price: 15, pattern: 'spots', colors: { base: '#16c9a6', belly: '#d2fff3', accent: '#0a8a72' } },
  { id: 'sunken', name: 'Sunken Gold', xp: 5, price: 25, pattern: 'bands', metal: 0.55, colors: { base: '#ffbf1a', belly: '#fff3c0', accent: '#d68a00' } },
  { id: 'abyss', name: 'Abyss', xp: 9, price: 50, pattern: 'spots', colors: { base: '#2152ff', belly: '#c3d0ff', accent: '#0b1b78' } },
  { id: 'kelp', name: 'Kelp', xp: 16, price: 100, pattern: 'stripes', colors: { base: '#36c43f', belly: '#dcffd0', accent: '#0f5a16' } },
  { id: 'candy', name: 'Candy Reef', xp: 29, price: 200, pattern: 'bands', colors: { base: '#ff3355', belly: '#ffffff', accent: '#ffffff' } },
  { id: 'toxic', name: 'Toxic', xp: 50, price: 380, pattern: 'glowspots', colors: { base: '#1a221a', belly: '#3d4d3d', accent: '#7dff3a', glow: '#7dff3a' } },
  { id: 'frost', name: 'Frost', xp: 88, price: 750, pattern: 'crystal', spikes: true, colors: { base: '#8fe3ff', belly: '#ffffff', accent: '#e8fbff', glow: '#bff4ff' } },
  { id: 'magma', name: 'Magma', xp: 154, price: 1400, pattern: 'lava', spikes: true, colors: { base: '#2b1510', belly: '#5c2a12', accent: '#ff6a00', glow: '#ff5a00' } },
  { id: 'galaxy', name: 'Galaxy', xp: 320, price: 3500, special: true, pattern: 'galaxy', colors: { base: '#2a0f5e', belly: '#6a3fd0', accent: '#ff4fd8', glow: '#9a7bff' } },
  { id: 'glitch', name: 'Glitch', xp: 900, price: 12000, special: true, pattern: 'grid', spikes: true, colors: { base: '#06180b', belly: '#0b2a14', accent: '#38ff6a', glow: '#38ff6a' } },
]

// Training zones along the hub's east side (south to north order is index order: the
// first zone is nearest spawn). mult = XP multiplier; rebirths = rebirths needed to
// enter; price = Wins to unlock instead (the premium zones). dummy = the target's look.
export const ZONES = [
  { id: 'farm', name: 'Farm', mult: 3, rebirths: 0, dummy: 'scarecrow', floor: '#f2d36b', theme: '#c98b3a' },
  { id: 'jungle', name: 'Jungle', mult: 6, rebirths: 0, dummy: 'tiki', floor: '#e9c98a', theme: '#3f9d2f' },
  { id: 'dojo', name: 'Dojo', mult: 9, rebirths: 1, dummy: 'dojo', floor: '#e8dca4', theme: '#e0262b' },
  { id: 'castle', name: 'Castle', mult: 12, rebirths: 2, dummy: 'knight', floor: '#9aa3b2', theme: '#3a6fe0' },
  { id: 'pirate', name: 'Pirate', mult: 15, rebirths: 4, dummy: 'sailor', floor: '#a8784a', theme: '#ffffff' },
  { id: 'volcano', name: 'Volcano', mult: 18, rebirths: 6, dummy: 'golem', floor: '#3a2a26', theme: '#ff5a00' },
  { id: 'space', name: 'Space', mult: 30, price: 2500, dummy: 'astronaut', floor: '#241a4a', theme: '#b06cff' },
  { id: 'rainbow', name: 'Rainbow', mult: 50, price: 9000, dummy: 'cloud', floor: '#ffffff', theme: '#ff7ad9' },
  { id: 'cyber', name: 'Cyber', mult: 80, price: 30000, dummy: 'robot', floor: '#0b120e', theme: '#38ff6a' },
]
// Zone i: a 12 m (x) by 7.6 m (z) floor centred on (ZONE_LAYOUT.x, zStart - i * pitch).
// The dummy stands dummyDx east of the centre; the player trains from the west half.
export const ZONE_LAYOUT = { x: 48, zStart: 34, pitch: 8.5, width: 12, depth: 7.6, dummyDx: 3.2 }

// Tentacle shop on the hub's west side: two rows of five pedestals (front row low,
// back row on a raised terrace), regular TENTACLES in order; the two specials stand on
// pedestals either side of the lane entrance.
export const SHOP_LAYOUT = { frontX: -33, backX: -45, backY: 2.4, zStart: -18, pitch: 9, pad: 3.6, specialX: 15, specialZ: -42 }

// --- Stages ---------------------------------------------------------------------------
export const STAGES = {
  count: 15,
  rec: [1, 4, 8, 13, 21, 27, 35, 44, 54, 66, 78, 92, 107, 123, 140], // recommended level per stage
  bossEvery: 5, // stages 5, 10, 15 bring a boss
  bosses: ['Bandit Boss', 'Bandit Warlord', 'Bandit King'],
  winsBase: 3,
  winsGrowth: 1.6,
  bossWinsMult: 1.5,
  xpPadLevels: 2, // the XP pad pays this many levels' worth of XP at the stage's recommended level
  count0: 4, // bandits in stage 1; +1 every countEvery stages, capped
  countEvery: 1.6,
  countMax: 10,
  hitsToKill: [2.6, 0.22], // bandit HP = damage(rec) * (a + b * s)
  enemyHit: [0.045, 0.004], // bandit hit = maxHp(rec) * (a + b * s)
  bossHp: 14, // x a bandit's HP
  bossHit: 2.6, // x a bandit's hit
}

// --- Combat -------------------------------------------------------------------------------
export const COMBAT = {
  slapEvery: 0.72, // s between automatic tentacle slaps on the nearest bandit
  reach: 4.6, // m tentacle reach at octopus scale 1
  throwCooldown: 5, // s
  throwMult: 3.2, // grab-and-slam damage per bandit, x a slap
  throwRadius: 1.35, // x reach: grab range
  throwMaxPerArm: 0.5, // bandits grabbed = ceil(arms * this)
  regenOutOfCombat: 0.12, // share of max HP per second while no bandit is near
  enemy: {
    speed: 4.6, // m/s chasing
    bossSpeed: 3.6,
    attackRange: 2.6, // melee reach
    gunRange: 13,
    windup: 0.75, // s telegraph before a hit lands
    bossWindup: 1.1,
    cooldown: [1.4, 2.4], // s between attacks
    separation: 1.6, // m bandits keep from each other
  },
  reviveSeconds: 6,
}

// --- Hub boss event -------------------------------------------------------------------------
// A countdown on the HUD; at zero a giant bandit drops into the hub centre. Its HP and hit
// are tuned to the player's level so it is always a fight; reward scales with best stage.
export const HUB_BOSS = { every: 12 * 60, hpSlaps: 45, hitShare: 0.05, name: 'Giant Bandit', winsMult: 4, minWins: 10 }

// --- Training -----------------------------------------------------------------------------
export const TRAINING = { autoEvery: 0.5, clickMin: 0.14 }

// --- Shop: boosts and level packs (all paid in Wins) -------------------------------------
export const BOOSTS = {
  train2x: { minutes: 15, price: 25 }, // potion: x2 training XP for 15 min (stacks time)
  wins2x: { price: 750 }, // permanent x2 Wins
  starter: { price: 180, tentacle: 'sunken', trainMinutes: 20, levels: 5 }, // one time
  levels: [
    { n: 3, discount: 1 },
    { n: 10, discount: 0.92 },
    { n: 40, discount: 0.82 },
  ],
  levelPriceBase: 4, // Wins per level at level 1 ...
  levelPriceGrowth: 1.07, // ... growing per current level
  revive: 0.6, // revive price = this * the stage's wins (min 3)
  revenge: 2.2, // revenge price = this * the stage's wins (min 10)
  skipBoss: 0.8, // skip price = this * the hub boss reward (min 8)
}

// --- Player modes (modes.js) -------------------------------------------------
// 'character' = third-person chase cam with the avatar on screen.
// 'player' = first-person, the camera is the player's eyes and the avatar is hidden.
export const MODES = ['character', 'player']
export const START_MODE = 'character'

// --- Physics (physics.js, player.js) ------------------------------------------
export const PHYSICS = {
  gravity: -22, // m/s^2 for dynamic bodies and the player
  fixedStep: 1 / 60, // s per physics tick; rendering interpolates between ticks
  maxSubSteps: 5, // a long frame never runs more ticks than this
  walkSpeed: 8, // m/s
  sprintSpeed: 14, // m/s with Shift held
  accel: 70, // m/s^2 toward the target velocity on the ground
  airAccel: 22, // m/s^2 steering while airborne
  decel: 60, // m/s^2 when no key is held
  turnSpeed: 12, // rad/s the body turns toward its heading
  jumpSpeed: 8.5, // m/s
  coyoteTime: 0.1, // s after leaving a ledge a jump still counts
  jumpBuffer: 0.12, // s a jump pressed before landing is remembered
  stepHeight: 0.45, // m autostep
  maxSlope: 50, // degrees the player can walk up
  snapToGround: 0.4, // m the controller stays glued to downward steps and slopes
  pushMass: 80, // kg the character weighs when shoving crates
  killY: -6, // sank this far: respawn
}
export const PLAYER_DIMS = { radius: 0.9, height: 1.8 } // capsule the character controller moves (the octopus rides on it)

// --- Look ------------------------------------------------------------------
export const RENDER = { exposure: 1.0 }
export const FOG = { near: 140, far: 520 }
// The two lighting moods lighting.js blends between (key N toggles).
export const TIME_OF_DAY = {
  transition: 2.5, // s to blend day <-> night
  day: {
    zenith: '#1f7bff',
    horizon: '#bfe9ff',
    sunColor: '#fff6e2',
    // Sun + hemi + env together keep the saturated toy colours (grass, checker walls)
    // vivid; much more and ACES washes them out to pastel.
    sunIntensity: 2.6,
    sunElevation: 58, // degrees above the horizon
    sunAzimuth: 35, // degrees, 0 = from +Z
    hemiSky: '#e8f4ff',
    hemiGround: '#8fd16a',
    hemiIntensity: 0.85,
    envIntensity: 0.5,
    lampIntensity: 0,
    stars: 0,
    exposure: 1.0,
  },
  night: {
    zenith: '#050b22',
    horizon: '#24345e',
    sunColor: '#9fb4ff', // the moon
    sunIntensity: 0.55,
    sunElevation: 38,
    sunAzimuth: -60,
    hemiSky: '#3a4c80',
    hemiGround: '#1a1a22',
    hemiIntensity: 0.35,
    envIntensity: 0.25,
    lampIntensity: 30,
    stars: 1,
    exposure: 1.15,
  },
}
export const LIGHT = {
  shadowRange: 46, // half-width of the sun's shadow box around the player
  lampColor: '#ffb35c',
  lampDistance: 22,
}

// Default (fallback) character look, used only when player.glb cannot load.
export const CHARACTER_COLORS = { skin: '#f2c79a', suit: '#2f6fd0', hair: '#4a2f1c' }

export const MATERIAL_PBR = {
  PLAYER: { roughness: 0.7, metalness: 0 },
  GROUND: { roughness: 0.95, metalness: 0 },
}

// --- Graphics presets, picked by the Bloxity graphics_quality setting ----------
export const GRAPHICS_PRESETS = {
  Low: { shadows: false, shadowMap: 512, antialias: false, dpr: 1, bloom: false, particles: 0.35 },
  Medium: { shadows: true, shadowMap: 1024, antialias: false, dpr: 1.25, bloom: false, particles: 0.6 },
  High: { shadows: true, shadowMap: 2048, antialias: true, dpr: 2, bloom: true, particles: 1 },
  Ultra: { shadows: true, shadowMap: 4096, antialias: true, dpr: 2, bloom: true, particles: 1 },
}

// Bloom (postfx.js): only HDR-bright pixels (above threshold, linear, before
// tone mapping) glow: neon rails, waterfall, VIP gate, particles. Sunlit sand
// stays under the threshold.
export const BLOOM = { strength: 0.6, radius: 0.35, threshold: 2.0 }
// Neon materials (propkit.js): k = HDR colour multiplier with bloom on; with
// bloom off they are capped at plainMax so they stay coloured, not white.
export const NEON = { k: 3.5, plainMax: 1.2 }

// Phones and tablets default to a lighter preset when the portal sends no value,
// and any preset is capped there (a phone at DPR 3 renders 9x the pixels; bloom
// is a full-screen multi-pass blur, so it stays off on phones).
export const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const DEFAULT_GRAPHICS = COARSE_POINTER ? 'Medium' : 'High'
export const MOBILE_GRAPHICS_CAP = { dpr: 1.5, shadowMap: 1024, particles: 0.6 }

// The preset to render with on this device.
export function graphicsPreset(name) {
  const p = GRAPHICS_PRESETS[name] ?? GRAPHICS_PRESETS[DEFAULT_GRAPHICS]
  if (!COARSE_POINTER) return p
  const cap = MOBILE_GRAPHICS_CAP
  return { ...p, dpr: Math.min(p.dpr, cap.dpr), shadowMap: Math.min(p.shadowMap, cap.shadowMap), bloom: false, particles: Math.min(p.particles, cap.particles) }
}

// --- Touch controls (touch.js) --------------------------------------------------
export const TOUCH = {
  deadZone: 0.12, // fraction of the joystick radius that does nothing
  lookScale: 1.5, // touch drag pixels -> look, relative to a mouse pixel
  pinchPixelsPerNotch: 30, // finger spread change that equals one wheel notch
}

// --- Camera (camera.js) -------------------------------------------------------
export const CAMERA = {
  fov: 70,
  near: 0.1,
  far: 1200,
  startPitch: 0.32, // radians above the horizon (raised chase cam: the octopus spreads wide)
  minPitch: -0.35,
  maxPitch: 1.25,
  firstPersonPitch: 1.45, // |pitch| limit looking up/down in player mode
  eyeHeight: 0.92, // eye height as a fraction of player height (player mode)
  distance: 15, // resting boom length, m (x the octopus scale, see camera.setScale)
  minDistance: 2.5, // wheel in past this enters player mode
  maxDistance: 34,
  followLerp: 14, // 1/s: the one smoothing stage, on the point the camera follows
  targetHeight: 1.2, // look-at point as a fraction of player height
  lookSensitivity: 0.0026, // rad per pixel of mouse movement
  zoomStep: 0.9, // m per wheel notch
  zoomEase: 12, // 1/s the zoom glides to its target
  speedFov: 6, // degrees the FOV widens at sprint speed
  speedEase: 3, // 1/s the speed framing eases in and out
  clearEase: 6, // 1/s the boom eases back out once a wall stops blocking it
}

// --- Bloxity (bloxity.js, avatar/) -------------------------------------------------
// SDK setting keys this game listens for; registering a listener makes the control
// appear in the portal's settings menu.
export const SETTINGS = {
  graphics_quality: { def: DEFAULT_GRAPHICS, type: 'enum', values: ['Low', 'Medium', 'High', 'Ultra'] },
  camera_sensitivity: { def: '1', type: 'number', min: 0.1, max: 5 },
  show_fps: { def: 'false', type: 'bool' },
  fullscreen: { def: 'false', type: 'bool' },
}

// The base rig, measured from player.glb: origin at the feet, 6.4 units tall at bind pose.
export const RIG_HEIGHT = 6.4
// Bind-pose values of the rig nodes the SDK proportions drive.
export const RIG = { armOffsetX: 2, legOffsetX: 0.6, neckOffsetY: 0.6 }
// getProportions() ranges, straight from the SDK spec; clamped before they reach the scene graph.
export const PROPORTIONS = {
  height: { def: 1, min: 0.5, max: 1.6 },
  shoulderWidth: { def: 1, min: 0.5, max: 1.5 },
  armLength: { def: 1, min: 0.05, max: 3 },
  legOffsetX: { def: 1, min: -0.7, max: 5 },
  torsoScaleX: { def: 1, min: 0.3, max: 2 },
  neckHeight: { def: 1, min: 0.94, max: 1.2 },
  headScale: { def: 1, min: 0.3, max: 2.6 },
}

// Procedural animation (avatar/animator.js), ported from Clean Leaves for Loot.
// Rotations are radians in CHARACTER space: +X swings a limb backward, +Y yaws, +Z rolls.
const deg = (d) => (d * Math.PI) / 180
export const ANIM = {
  airborneDelay: 0.07, // s off the ground before the air pose (ignores a step down a ledge)
  // Walk -> run is one cycle at two depths; phase advances with distance travelled.
  locomotion: {
    minFrequency: 0.7,
    maxFrequency: 3.6,
    strideDistance: 3.8, // m per cycle
    idleSpeed: 0.6,
    walkSpeed: 2.5,
    runSpeed: 8,
    sprintSpeed: 13,
    hipSwing: { walk: deg(22), run: deg(42), sprint: deg(56) },
    kneeBend: { walk: deg(30), run: deg(58), sprint: deg(72) },
    armSwing: { walk: deg(18), run: deg(36), sprint: deg(52) },
    elbowBend: { walk: deg(14), run: deg(44), sprint: deg(70) },
    torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
    torsoLean: { walk: deg(3), run: deg(10), sprint: deg(18) },
    headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
    torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
    bob: { walk: 0.03, run: 0.07, sprint: 0.09 }, // m, on the avatar root
    bankAngle: deg(9),
    bankRate: 8,
  },
  idle: {
    breathFrequency: 0.35,
    breathAmount: deg(1.8),
    breathBob: 0.007,
    basePose: {
      ArmL1: { x: deg(-4), z: deg(8) },
      ArmL2: { x: deg(12) },
      ArmR1: { x: deg(-4), z: deg(-8) },
      ArmR2: { x: deg(12) },
      LegL1: { x: deg(-4) },
      LegR1: { x: deg(4) },
    },
  },
  airborne: {
    rise: {
      LegL1: { x: deg(-38) }, LegR1: { x: deg(8) }, LegL2: { x: deg(62) }, LegR2: { x: deg(40) },
      ArmL1: { x: deg(-40), z: deg(34) }, ArmR1: { x: deg(-30), z: deg(-34) },
      ArmL2: { x: deg(30) }, ArmR2: { x: deg(30) }, Spine1: { x: deg(6) },
    },
    fall: {
      LegL1: { x: deg(-14) }, LegR1: { x: deg(10) }, LegL2: { x: deg(22) }, LegR2: { x: deg(18) },
      ArmL1: { x: deg(-70), z: deg(40) }, ArmR1: { x: deg(-60), z: deg(-40) },
      ArmL2: { x: deg(20) }, ArmR2: { x: deg(20) }, Spine1: { x: deg(-4) },
    },
    velocityReference: 8, // m/s vertical speed that reads as fully rising / falling
  },
  landing: {
    duration: 0.16,
    pose: {
      LegL1: { x: deg(-34) }, LegR1: { x: deg(-34) }, LegL2: { x: deg(58) }, LegR2: { x: deg(58) },
      ArmL1: { x: deg(-18), z: deg(20) }, ArmR1: { x: deg(-18), z: deg(-20) }, Spine1: { x: deg(14) },
    },
    bobY: -0.2,
  },
  transitions: { toLocomotion: 0.14, toAirborne: 0.12, toLanding: 0.06 }, // s to blend a pose change
}

// --- Audio (audio/) ---------------------------------------------------------------------
export const AUDIO = {
  volume: 0.8,
  storageKey: 'octopus-evolution.sound',
  buses: { ui: 0.8, sfx: 0.9, amb: 0.5, engine: 0.5 }, // per-bus levels before the master
  duck: 0.45, // world (ambience) level while a menu window is open
  maxVoices: 48,
  maxVoicesTouch: 24,
  latency: 0.04,
  latencyTouch: 0.07,
  lead: 0.02,
  reverb: { seconds: 1.8, preDelay: 0.012, early: [[19, 0.5], [31, 0.35], [47, 0.28], [73, 0.2], [97, 0.12]], decay: 1.3, tail: 0.18, darken: 1.6, send: 0.9 },
}

// --- UI juice (fx.js) ------------------------------------------------------------------------
export const JUICE = { touchScale: 0.55, maxNumbers: 40, shake: 1 }

export const FONT_FAMILY = 'Fredoka'

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

// Coerce one raw SDK string against its SETTINGS entry.
export function coerceSetting(key, raw) {
  const spec = SETTINGS[key]
  if (!spec) return raw
  const value = raw === '' || raw == null ? spec.def : raw
  if (spec.type === 'bool') return value === 'true' || value === true
  if (spec.type === 'enum') return spec.values.includes(value) ? value : spec.def
  const n = Number(value)
  return clamp(Number.isFinite(n) ? n : Number(spec.def), spec.min, spec.max)
}
