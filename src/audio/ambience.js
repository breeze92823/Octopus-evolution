// The world around the player, all synthesised:
//  - wind: stereo pink noise through a slowly wandering band, gusting every few
//    seconds; in the lane (a canyon) it is drier and a thin whistle rides on top
//  - birds in the hub: sparse chirps, trills and two-note whistles, panned around
//  - the canyon: fewer birds, now and then a distant hawk call far off in the reverb
//  - combat: a low tension layer (a slow heartbeat thump and a filtered rumble)
//    that fades in while a fight is on and out again afterwards (on the engine bus)
// One scheduler plans events a little ahead of the audio clock; update() moves the
// continuous levels every frame.
import { COARSE_POINTER } from '../config.js'
import { A, onStart, ready, voice } from './core.js'
import { burst, chirp, rnd, tone } from './synth.js'

const s = {
  ok: false,
  wind: null, // gain of the wind bed
  windFilter: null,
  whistle: null, // canyon whistle gain
  whistleFilter: null,
  rumble: null, // combat rumble gain
  area: 'hub',
  combat: 0, // eased 0..1
  combatOn: false,
  nextGust: 0,
  nextBird: 0,
  nextHawk: 0,
  nextBeat: 0,
}

const filt = (type, f, q = 0.7) => {
  const b = A.ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = f
  b.Q.value = q
  return b
}
const gain = (v) => {
  const g = A.ctx.createGain()
  g.gain.value = v
  return g
}
function loop(buf) {
  const src = A.ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.start(0, Math.random() * (buf.duration - 0.1))
  return src
}

onStart((ctx) => {
  // Wind: stereo pink -> wandering bandpass -> gust envelope -> amb bus.
  s.windFilter = filt('bandpass', 480, 0.55)
  s.wind = gain(0.0)
  loop(A.noise.pinkStereo).connect(s.windFilter).connect(s.wind).connect(gain(0.55)).connect(A.amb)
  // Low body of the wind (always a little there).
  loop(A.noise.brownStereo).connect(filt('lowpass', 180, 0.5)).connect(gain(0.18)).connect(A.amb)
  // Canyon whistle: a narrow resonant band, only in the lane.
  s.whistleFilter = filt('bandpass', 920, 9)
  s.whistle = gain(0)
  loop(A.noise.pinkStereo).connect(s.whistleFilter).connect(s.whistle).connect(gain(1.6)).connect(A.amb)
  // Combat rumble on the engine bus (ducks with the world while a menu is open).
  s.rumble = gain(0)
  loop(A.noise.brownStereo).connect(filt('lowpass', 110, 0.8)).connect(s.rumble).connect(gain(1.4)).connect(A.engine)
  const t = ctx.currentTime
  s.nextGust = t + 0.5
  s.nextBird = t + rnd(1.5, 4)
  s.nextHawk = t + rnd(20, 40)
  s.nextBeat = t + 0.5
  s.wind.gain.setTargetAtTime(0.5, t, 1.5) // fade in
  s.ok = true
})

// --- Events -------------------------------------------------------------------------------------
function gust(t) {
  const lane = s.area === 'lane'
  const peak = lane ? rnd(0.55, 1) : rnd(0.35, 0.85)
  const len = rnd(2, 5)
  s.wind.gain.setTargetAtTime(peak, t, len * 0.3)
  s.wind.gain.setTargetAtTime(lane ? 0.45 : 0.3, t + len * 0.6, len * 0.4)
  s.windFilter.frequency.setTargetAtTime(lane ? rnd(520, 900) : rnd(320, 700), t, len * 0.35)
  if (lane) {
    s.whistleFilter.frequency.setTargetAtTime(rnd(760, 1250), t, len * 0.5)
    s.whistle.gain.setTargetAtTime(rnd(0.012, 0.03), t, len * 0.3)
    s.whistle.gain.setTargetAtTime(0.004, t + len * 0.6, len * 0.4)
  } else {
    s.whistle.gain.setTargetAtTime(0, t, 0.8)
  }
  // A rustle of leaves riding the gust in the hub.
  if (!lane && Math.random() < 0.6 && voice(len, 0.5)) {
    burst({ t: t + len * 0.2, noise: 'pink', type: 'highpass', f: 3200, q: 0.5, a: len * 0.3, d: len * 0.5, gain: 0.018 * peak, pan: rnd(-0.6, 0.6), bus: A.amb })
  }
  return t + len * rnd(0.7, 1.2)
}

// One bird: a run of syllables in one of a few song shapes.
function bird(t) {
  if (!voice(1.5, 0.6)) return
  const pan = rnd(-0.85, 0.85)
  const base = rnd(2600, 4400)
  const g = rnd(0.012, 0.026) * (s.area === 'lane' ? 0.6 : 1)
  const verb = 0.35
  const bus = A.amb
  const kind = Math.floor(Math.random() * 4)
  if (kind === 0) {
    // Quick chirps.
    const n = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) chirp({ t: t + i * rnd(0.09, 0.14), f: base * rnd(0.95, 1.1), f2: base * rnd(1.25, 1.5), d: rnd(0.04, 0.07), gain: g, pan, verb, bus })
  } else if (kind === 1) {
    // A trill.
    chirp({ t, f: base * 0.9, f2: base * 1.05, d: rnd(0.35, 0.6), gain: g * 0.8, trill: [rnd(28, 40), base * 0.08], pan, verb, bus })
  } else if (kind === 2) {
    // Two-note whistle, falling.
    const f = base * 0.65
    chirp({ t, f, f2: f * 1.02, d: 0.18, gain: g, pan, verb, bus })
    chirp({ t: t + 0.24, f: f * 0.84, f2: f * 0.8, d: 0.24, gain: g, pan, verb, bus })
  } else {
    // Down-swept calls.
    for (let i = 0; i < 3; i++) chirp({ t: t + i * 0.16, f: base * 1.3, f2: base * 0.75, d: 0.09, gain: g * 0.9, pan, verb, bus })
  }
}

// A distant hawk over the canyon: a long falling scream, far away in the reverb.
function hawk(t) {
  if (!voice(2, 0.6)) return
  const pan = rnd(-0.7, 0.7)
  const f = rnd(2100, 2500)
  chirp({ t, f, f2: f * 0.7, d: 0.9, gain: 0.01, trill: [rnd(45, 60), 40], pan, verb: 0.9, bus: A.amb })
  burst({ t, f: f * 0.9, f2: f * 0.65, q: 3, a: 0.1, d: 0.8, gain: 0.004, pan, verb: 0.9, bus: A.amb })
}

// The combat heartbeat: lub-dub, very low and soft.
function beat(t, k) {
  if (k < 0.05 || !voice(0.5, 0.8)) return
  tone({ t, f: 58, f2: 40, d: 0.14, gain: 0.16 * k, bus: A.engine })
  tone({ t: t + 0.2, f: 52, f2: 38, d: 0.12, gain: 0.1 * k, bus: A.engine })
  burst({ t, noise: 'brown', type: 'lowpass', f: 160, q: 0.7, a: 0.004, d: 0.12, gain: 0.08 * k, bus: A.engine })
}

export function setCombat(on) {
  s.combatOn = !!on
}

// st: { area: 'hub' | 'lane', combat }
export function update(dt, st) {
  if (!s.ok || !ready()) return
  if (st.area !== s.area) {
    s.area = st.area
    s.nextGust = 0 // re-shape the wind for the new place now
  }
  if (st.combat !== undefined) s.combatOn = !!st.combat
  const target = s.combatOn ? 1 : 0
  const rate = s.combatOn ? 0.7 : 0.35 // in fast, out slow
  s.combat += (target - s.combat) * (1 - Math.exp(-rate * dt * 2))
  const t = A.ctx.currentTime
  s.rumble.gain.setTargetAtTime(s.combat * 0.6, t, 0.1)

  const ahead = t + 0.25
  if (s.nextGust < ahead) s.nextGust = gust(Math.max(t, s.nextGust))
  if (s.nextBird < ahead) {
    const lane = s.area === 'lane'
    if (Math.random() < (lane ? 0.35 : 0.9) && s.combat < 0.5) bird(Math.max(t, s.nextBird) + 0.02)
    s.nextBird = Math.max(t, s.nextBird) + (lane ? rnd(6, 14) : rnd(2.2, 6.5)) * (COARSE_POINTER ? 1.4 : 1)
  }
  if (s.nextHawk < ahead) {
    if (s.area === 'lane' && s.combat < 0.5) hawk(Math.max(t, s.nextHawk) + 0.02)
    s.nextHawk = Math.max(t, s.nextHawk) + rnd(25, 50)
  }
  if (s.nextBeat < ahead) {
    const at = Math.max(t, s.nextBeat)
    beat(at + 0.02, s.combat)
    s.nextBeat = at + 0.92 - s.combat * 0.08
  }
}
