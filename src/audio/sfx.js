// Every one-shot sound in the game, synthesised from physical recipes (synth.js).
// Nothing here throws or plays before the first gesture (or while muted): each
// export returns quietly when audio isn't running or the voice budget is spent.
//
// Most hits are three layers: a transient (filtered noise click), a body (a pitched
// thump with a fast pitch drop) and a tail (filtered noise, bubbles, reverb send).
// Materials are mode tables [ratio, amplitude, decay s]. Every call varies pitch,
// level and timing a little so repeats never machine-gun.
import { COARSE_POINTER } from '../config.js'
import { A, isMuted, now, ready, voice } from './core.js'
import { brass, bubble, bubbles, burst, crinkle, grunt, modal, pick, rnd, tone, vary } from './synth.js'

const COIN = [[1, 1, 0.5], [1.504, 0.6, 0.36], [2.24, 0.45, 0.26], [2.71, 0.3, 0.18], [3.47, 0.22, 0.12], [4.03, 0.12, 0.08]]
const TROPHY = [[1, 1, 0.7], [2.05, 0.5, 0.5], [3.1, 0.34, 0.32], [4.33, 0.2, 0.2], [5.6, 0.1, 0.12]]
const GLOCK = [[1, 1, 1.4], [2.756, 0.32, 0.45], [5.404, 0.1, 0.18], [8.933, 0.04, 0.08]]
const BELL = [[0.5, 0.3, 1.5], [1, 1, 1.3], [1.19, 0.45, 1], [1.5, 0.3, 0.85], [2, 0.42, 0.75], [2.5, 0.18, 0.5], [2.66, 0.22, 0.45], [3.01, 0.1, 0.35], [4.1, 0.06, 0.25]]
const WOOD = [[1, 1, 0.07], [2.57, 0.45, 0.035], [4.2, 0.22, 0.016], [6.1, 0.08, 0.01]]
const HOLLOW = [[1, 1, 0.16], [1.58, 0.55, 0.1], [2.41, 0.3, 0.06], [3.62, 0.14, 0.035]]
const PLASTIC = [[1, 1, 0.026], [2.31, 0.5, 0.016], [3.93, 0.28, 0.01]]
const GLASS = [[1, 1, 0.45], [2.32, 0.5, 0.28], [4.25, 0.28, 0.16], [6.63, 0.14, 0.1]]
const METAL = [[1, 1, 0.55], [1.47, 0.45, 0.42], [2.76, 0.6, 0.34], [4.07, 0.32, 0.22], [5.4, 0.2, 0.15], [8.9, 0.08, 0.08]]
const STONE = [[1, 1, 0.05], [2.3, 0.6, 0.03], [3.9, 0.35, 0.02], [5.7, 0.15, 0.012]]

const semi = (n) => Math.pow(2, n / 12)
const C6 = 1046.5
const C4 = 261.63
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const K = COARSE_POINTER ? 0.6 : 1 // grain / particle counts on phones

// --- Bookkeeping -----------------------------------------------------------------------------
const lastAt = new Map()
// false if `name` played less than `ms` ago (keeps rapid repeats from stacking).
function limit(name, ms) {
  const t = performance.now()
  if (t - (lastAt.get(name) ?? -1e9) < ms) return false
  lastAt.set(name, t)
  return true
}
// A specific sound claims the moment, so generic feedback sounds fired in the same
// handler (index.feedback) stay quiet.
let claimed = -1e9
const claim = () => (claimed = performance.now())
export const claimedRecently = (ms = 80) => performance.now() - claimed < ms

// Every export is wrapped: a sound must never take a game handler down with it.
function safe(fn) {
  return (...args) => {
    try {
      if (!ready() || isMuted()) return
      fn(...args)
    } catch (e) {
      if (import.meta.env?.DEV) console.warn('[sfx]', e)
    }
  }
}

// Phone haptics for the big moments (Android; iOS ignores it).
function buzz(pattern) {
  if (!COARSE_POINTER || isMuted()) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not allowed in this frame.
  }
}

// --- Shared layers -------------------------------------------------------------------------------
// Wet flesh: a short suction "shlk" (narrow band sweeping up), low bubbles, a soggy lowpass smack.
function squelch(t, k = 1, pan = 0, bus = A.sfx, verb = 0) {
  burst({ t, noise: 'pink', f: vary(520, 0.15), f2: vary(1700, 0.15), q: 3.2, a: 0.004, d: 0.07 * (0.8 + k * 0.3), gain: 0.11 * k, pan, bus, verb })
  bubbles({ t: t + 0.004, n: Math.round((4 + 4 * k) * K), dur: 0.09 + 0.05 * k, f0: 170, f1: 900, gain: 0.09 * k, d: [0.02, 0.06], rise: 0.5, width: 0.25, bus, verb })
  burst({ t, noise: 'pink', type: 'lowpass', f: vary(1100, 0.1), f2: 260, q: 0.9, a: 0.002, d: 0.08, gain: 0.22 * k, pan, bus })
}

// A thump: pitched body with a fast drop, plus a lowpassed noise puff.
function thump(t, f, k = 1, pan = 0, d = 0.12, bus = A.sfx, verb = 0) {
  tone({ t, f: vary(f, 0.06), f2: f * 0.42, glide: d * 0.8, d, gain: 0.5 * k, pan, bus, verb })
  burst({ t, noise: 'brown', type: 'lowpass', f: f * 6, f2: f * 2, q: 0.6, a: 0.002, d: d * 0.9, gain: 0.35 * k, pan, bus })
}

// Glockenspiel notes (semitones above C6), `gap` s apart.
function glock(t, notes, gap, gain = 0.14, verb = 0.25, bus = A.sfx) {
  notes.forEach((n, i) => modal({ t: t + i * gap, f: C6 * semi(n), modes: GLOCK, gain: gain * rnd(0.85, 1), strike: 0.12, pan: (i / Math.max(1, notes.length - 1) - 0.5) * 0.5, verb, bus }))
}

// Glassy sparkles scattered over `dur` s between f0..f1 Hz.
function sparkle(t, n, dur, gain = 0.025, f0 = 2800, f1 = 6200, verb = 0.3, bus = A.sfx) {
  for (let i = 0; i < Math.round(n * K); i++) {
    modal({ t: t + Math.random() * dur, f: rnd(f0, f1), modes: GLASS, gain: gain * rnd(0.5, 1), decay: rnd(0.3, 0.7), pan: rnd(-0.7, 0.7), verb, bus })
  }
}

// Coins tumbling onto a counter: n clinks of random small coins, fading out.
function coins(t, n, spread, gain, pan = 0) {
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(i / n, 1.3) * spread + rnd(0, 0.02)
    modal({ t: at, f: rnd(2500, 4400), modes: COIN, gain: gain * (1 - (i / n) * 0.7), beat: 7, strike: 0.25, decay: rnd(0.5, 1), pan: pan + rnd(-0.3, 0.3), bus: A.sfx, verb: 0.08 })
  }
  crinkle({ t: t + spread * 0.4, n: Math.round(12 * K), dur: spread, gain: 0.025, f0: 4000, f1: 9000 })
}

// --- UI ------------------------------------------------------------------------------------------
// HUD button: a short plastic press with a felt-y body thump.
export const click = safe((pan = 0) => {
  if (!limit('click', 30) || !voice(0.1, 2)) return
  const t = now()
  const bus = A.ui
  burst({ t, f: vary(4200, 0.1), q: 1.2, d: 0.006, gain: 0.18, bus, pan })
  modal({ t, f: vary(1250, 0.06), modes: PLASTIC, gain: 0.15, bus, pan })
  tone({ t, f: vary(170, 0.05), f2: 85, d: 0.04, gain: 0.2, bus, pan })
})

// Big chunky menu button: deeper, a rubbery squish under the click.
export const press = safe((pan = 0) => {
  if (!limit('click', 30) || !voice(0.12, 2)) return
  const t = now()
  const bus = A.ui
  burst({ t, f: vary(3000, 0.1), q: 1, d: 0.008, gain: 0.2, bus, pan })
  modal({ t, f: vary(820, 0.05), modes: PLASTIC, gain: 0.18, bus, pan })
  tone({ t, f: vary(140, 0.05), f2: 68, d: 0.06, gain: 0.3, bus, pan })
  burst({ t, type: 'lowpass', f: 900, q: 0.6, a: 0.004, d: 0.045, gain: 0.08, bus, pan })
})

// Picking a card in a grid: a light tap on a plastic tile.
export const tick = safe((pan = 0) => {
  if (!limit('click', 30) || !voice(0.06, 2)) return
  const t = now()
  burst({ t, f: vary(6000, 0.1), q: 1.4, d: 0.004, gain: 0.12, bus: A.ui, pan })
  modal({ t, f: vary(2300, 0.06), modes: PLASTIC, gain: 0.1, bus: A.ui, pan })
})

// Toggle switch: two clicks a few ms apart and a tiny spring ring.
export const toggle = safe((on = true) => {
  if (!voice(0.2, 2)) return
  const t = now()
  const bus = A.ui
  modal({ t, f: on ? 1500 : 1700, modes: PLASTIC, gain: 0.14, bus, strike: 0.12 })
  modal({ t: t + 0.016, f: on ? 2100 : 1250, modes: PLASTIC, gain: 0.16, bus, strike: 0.1 })
  modal({ t: t + 0.016, f: on ? 3400 : 2900, modes: COIN, gain: 0.025, decay: 0.3, bus })
  tone({ t, f: 180, f2: 90, d: 0.04, gain: 0.15, bus })
})

// Window opens: air pushed aside, then the card lands on felt.
export const windowOpen = safe(() => {
  if (!limit('win', 90) || !voice(0.35, 2)) return
  const t = now()
  const bus = A.ui
  burst({ t, noise: 'pink', f: 320, f2: 2400, q: 0.9, a: 0.09, d: 0.17, gain: 0.3, bus })
  tone({ t: t + 0.11, f: 125, f2: 70, d: 0.09, gain: 0.22, bus })
  burst({ t: t + 0.11, type: 'lowpass', f: 1500, q: 0.5, d: 0.05, gain: 0.1, bus })
})

export const windowClose = safe(() => {
  if (!limit('win', 90) || !voice(0.2, 2)) return
  burst({ t: now(), noise: 'pink', f: 2100, f2: 300, q: 0.9, a: 0.02, d: 0.14, gain: 0.34, bus: A.ui })
})

// No: two dull knocks on wood. Firm but never a harsh buzzer.
export const deny = safe(() => {
  if (!limit('deny', 140) || !voice(0.2, 2)) return
  claim()
  const t = now()
  const bus = A.ui
  modal({ t, f: vary(215, 0.03), modes: WOOD, gain: 0.42, strike: 0.15, bus })
  modal({ t: t + 0.09, f: vary(168, 0.03), modes: WOOD, gain: 0.36, strike: 0.12, bus })
  buzz(30)
})

// Spending Wins: the till drawer clunks, the bell rings, coins pour out.
export const purchase = safe(() => {
  if (!limit('buy', 200) || !voice(1.4, 3)) return
  claim()
  const t = now()
  burst({ t, type: 'lowpass', f: 700, q: 0.7, d: 0.1, gain: 0.3 })
  tone({ t, f: 95, f2: 52, d: 0.1, gain: 0.3 })
  modal({ t: t + 0.04, f: 1046, modes: BELL, gain: 0.18, beat: 4, strike: 0.2, verb: 0.15 })
  coins(t + 0.06, Math.round(10 * K), 0.45, 0.085)
  buzz([20, 40, 30])
})

// Equip: a wet latch: the suckers grip, a small clack, a lift of air.
export const equip = safe(() => {
  if (!limit('equip', 120) || !voice(0.4, 2)) return
  claim()
  const t = now()
  modal({ t, f: vary(1800, 0.04), modes: PLASTIC, gain: 0.15, strike: 0.15, bus: A.ui })
  bubble({ t: t + 0.02, f: vary(520, 0.06), d: 0.06, gain: 0.18, rise: 0.9, bus: A.ui })
  modal({ t: t + 0.045, f: vary(2400, 0.04), modes: COIN, gain: 0.06, decay: 0.45, strike: 0.3, bus: A.ui })
  tone({ t: t + 0.045, f: 210, f2: 120, d: 0.035, gain: 0.2, bus: A.ui })
  burst({ t, noise: 'pink', f: 600, f2: 1900, q: 0.8, a: 0.03, d: 0.1, gain: 0.08, bus: A.ui })
})

// Soft toast blip.
export const notify = safe(() => {
  if (!limit('notify', 120) || !voice(0.6, 2)) return
  const t = now()
  modal({ t, f: C6 * semi(12), modes: GLOCK, gain: 0.06, strike: 0.08, verb: 0.2, bus: A.ui })
  modal({ t: t + 0.07, f: C6 * semi(19), modes: GLOCK, gain: 0.05, strike: 0.08, verb: 0.2, bus: A.ui })
})

// --- Tentacles ---------------------------------------------------------------------------------------
// A tentacle swinging through the air: a band of air rushing past, brightening.
export const whoosh = safe((intensity = 1, pan = 0) => {
  if (!limit('whoosh', 40) || !voice(0.3, 1)) return
  const t = now()
  const k = clamp(intensity, 0.3, 2)
  burst({ t, noise: 'pink', f: vary(320, 0.15), f2: vary(1500 + 500 * k, 0.15), q: 1.3, a: 0.05 + 0.03 * k, d: 0.1 + 0.05 * k, gain: 0.14 * k, pan, sweep: 0.12 })
  burst({ t: t + 0.03, type: 'highpass', f: 2600, q: 0.5, a: 0.04, d: 0.08, gain: 0.03 * k, pan })
})

// The money sound: a wet, meaty tentacle smack. A sharp skin crack on top, a deep
// body thump, the soggy splat, then the suckers letting go.
export const slap = safe((intensity = 1, pan = 0) => {
  if (!limit('slap', 25) || !voice(0.4, 1)) return
  const t = now()
  const k = clamp(intensity, 0.3, 2)
  burst({ t, f: vary(2600, 0.15), q: 0.8, a: 0.0006, d: 0.012, gain: 0.5 * k, pan })
  burst({ t, type: 'highpass', f: vary(1800, 0.1), q: 0.6, a: 0.0008, d: 0.035, gain: 0.2 * k, pan })
  tone({ t, f: vary(150, 0.1), f2: 52, glide: 0.09, d: 0.13, gain: 0.55 * k, pan, verb: 0.08 })
  burst({ t, noise: 'pink', type: 'lowpass', f: vary(950, 0.1), f2: 240, q: 0.8, a: 0.002, d: 0.1, gain: 0.45 * k, pan })
  squelch(t + rnd(0.01, 0.025), 0.9 * k, pan)
  // Suckers releasing: a few small pops trailing off.
  for (let i = 0; i < Math.round(3 * K); i++) bubble({ t: t + 0.06 + i * rnd(0.025, 0.045), f: rnd(600, 1300), d: 0.025, gain: 0.05 * k, rise: 0.8, pan: pan + rnd(-0.2, 0.2) })
  if (k > 1.3) buzz(18)
})

// Wrapping round a bandit: suction cups gripping, a rubbery stretch, a grip squeeze.
export const grab = safe(() => {
  if (!limit('grab', 80) || !voice(0.5, 2)) return
  const t = now()
  burst({ t, noise: 'pink', f: vary(1700, 0.1), f2: 450, q: 3, a: 0.01, d: 0.16, gain: 0.16 })
  burst({ t: t + 0.06, noise: 'pink', f: 380, f2: 1400, q: 5, a: 0.03, d: 0.16, gain: 0.08 }) // stretch
  tone({ t, f: vary(230, 0.08), f2: 130, d: 0.14, gain: 0.25 })
  bubbles({ t: t + 0.02, n: Math.round(10 * K), dur: 0.2, f0: 200, f1: 1100, gain: 0.08, d: [0.02, 0.05], rise: 0.6, width: 0.4 })
  squelch(t + 0.1, 0.8)
})

// A new arm sprouts: gooey stretch rising, then a pop.
export const armGrow = safe(() => {
  if (!voice(0.9, 3)) return
  claim()
  const t = now()
  tone({ t, f: 170, f2: 430, glide: 0.32, a: 0.03, d: 0.32, gain: 0.12, lp: 1200 })
  burst({ t, noise: 'pink', f: 380, f2: 1700, q: 4.5, a: 0.06, d: 0.28, gain: 0.12, sweep: 0.32 })
  bubbles({ t, n: Math.round(12 * K), dur: 0.32, f0: 220, f1: 1000, gain: 0.06, rise: 0.5 })
  bubble({ t: t + 0.34, f: 480, d: 0.07, gain: 0.32, rise: 1.3 })
  burst({ t: t + 0.34, f: 2600, q: 1, d: 0.01, gain: 0.14 })
  glock(t + 0.38, [12, 19], 0.06, 0.07, 0.3)
  buzz([20, 30, 40])
})

// HUGE ground slam: a sub drop, the crack of the ground, a shock of dirt and the debris
// raining back down, with the canyon answering.
export const slam = safe((intensity = 1) => {
  if (!limit('slam', 60) || !voice(1.4, 4)) return
  const t = now()
  const k = clamp(intensity, 0.5, 2)
  tone({ t, f: vary(105, 0.05), f2: 27, glide: 0.5, d: 0.9 + 0.2 * k, gain: 0.75 * Math.min(1.3, k) })
  tone({ t, type: 'triangle', f: vary(72, 0.05), f2: 38, glide: 0.25, d: 0.35, gain: 0.4 * k })
  burst({ t, f: vary(2200, 0.1), q: 0.6, a: 0.0006, d: 0.02, gain: 0.5 * Math.min(1.4, k) })
  burst({ t, type: 'highpass', f: 1200, q: 0.6, a: 0.001, d: 0.06, gain: 0.32 * k })
  burst({ t, noise: 'brown', type: 'lowpass', f: 950, f2: 140, q: 0.7, a: 0.003, d: 0.55 + 0.15 * k, gain: 0.7 * k, verb: 0.35 })
  burst({ t: t + 0.01, noise: 'pink', type: 'lowpass', f: 2600, f2: 400, q: 0.5, a: 0.01, d: 0.4, gain: 0.18 * k, verb: 0.3 })
  squelch(t, 1.1 * Math.min(1.4, k))
  crinkle({ t: t + 0.03, n: Math.round(26 * K * k), dur: 0.5, gain: 0.07 * k, f0: 1200, f1: 6000, width: 0.8 })
  for (let i = 0; i < Math.round(6 * K * k); i++) {
    modal({ t: t + rnd(0.12, 0.7), f: rnd(320, 950), modes: STONE, gain: rnd(0.04, 0.09), strike: 0.3, pan: rnd(-0.7, 0.7), verb: 0.15 })
  }
  buzz(k > 1 ? [50, 30, 70] : [40])
})

// --- Training dummies ------------------------------------------------------------------------------------
// The tentacle lands on something: a light wet smack under the material.
function wetTouch(t, k, pan) {
  burst({ t, f: vary(2300, 0.12), q: 0.9, a: 0.0006, d: 0.01, gain: 0.26 * k, pan })
  burst({ t, noise: 'pink', type: 'lowpass', f: 900, f2: 300, q: 0.7, a: 0.002, d: 0.06, gain: 0.16 * k, pan })
  bubbles({ t: t + 0.01, n: Math.round(3 * K) + 1, dur: 0.06, f0: 250, f1: 900, gain: 0.05 * k, width: 0.2 })
}

const DUMMY = {
  scarecrow(t, k, pan) {
    thump(t, 110, 0.9 * k, pan, 0.13)
    crinkle({ t, n: Math.round(16 * K), dur: 0.2, gain: 0.07 * k, f0: 1800, f1: 7000, width: 0.4 })
    burst({ t: t + 0.02, noise: 'pink', f: 3200, f2: 1800, q: 0.7, a: 0.005, d: 0.15, gain: 0.05 * k, pan })
  },
  tiki(t, k, pan) {
    modal({ t, f: vary(310, 0.05), modes: HOLLOW, gain: 0.42 * k, strike: 0.3, pan, verb: 0.12 })
    tone({ t, f: vary(160, 0.05), f2: 90, d: 0.09, gain: 0.3 * k, pan })
  },
  dojo(t, k, pan) {
    modal({ t, f: vary(520, 0.05), modes: WOOD, gain: 0.3 * k, strike: 0.2, pan })
    tone({ t, f: vary(96, 0.04), f2: 68, glide: 0.2, d: 0.38, gain: 0.5 * k, pan, verb: 0.2 }) // taiko skin
    burst({ t, noise: 'brown', type: 'lowpass', f: 380, q: 0.7, a: 0.002, d: 0.25, gain: 0.35 * k, pan })
  },
  knight(t, k, pan) {
    modal({ t, f: vary(640, 0.06), modes: METAL, gain: 0.2 * k, beat: 6, strike: 0.35, pan, verb: 0.22 })
    modal({ t: t + 0.004, f: vary(1720, 0.06), modes: METAL, gain: 0.06 * k, beat: 9, decay: 0.6, pan })
    thump(t, 120, 0.6 * k, pan, 0.1)
  },
  sailor(t, k, pan) {
    thump(t, 118, 0.85 * k, pan, 0.12)
    burst({ t, noise: 'pink', type: 'lowpass', f: 600, q: 0.6, a: 0.003, d: 0.1, gain: 0.25 * k, pan })
    // The post creaks as it rocks back.
    tone({ t: t + 0.06, type: 'sawtooth', f: vary(95, 0.1), f2: 125, glide: 0.18, a: 0.03, d: 0.16, gain: 0.025 * k, lp: 900, lpq: 4, pan })
    modal({ t: t + 0.05, f: vary(780, 0.05), modes: WOOD, gain: 0.1 * k, pan })
  },
  golem(t, k, pan) {
    burst({ t, type: 'highpass', f: 1500, q: 0.6, a: 0.0006, d: 0.025, gain: 0.4 * k, pan })
    modal({ t, f: vary(380, 0.06), modes: STONE, gain: 0.45 * k, strike: 0.4, pan })
    tone({ t, f: vary(70, 0.05), f2: 38, d: 0.18, gain: 0.45 * k, pan, verb: 0.15 })
    crinkle({ t: t + 0.02, n: Math.round(10 * K), dur: 0.25, gain: 0.06 * k, f0: 1500, f1: 5000, width: 0.5 })
  },
  astronaut(t, k, pan) {
    thump(t, 130, 0.75 * k, pan, 0.1)
    burst({ t, noise: 'pink', type: 'lowpass', f: 700, q: 0.6, a: 0.002, d: 0.08, gain: 0.25 * k, pan })
    if (Math.random() < 0.55) {
      tone({ t: t + 0.08, f: vary(1700, 0.05), d: 0.04, gain: 0.03 * k, pan, bus: A.sfx })
      tone({ t: t + 0.13, f: vary(2300, 0.05), d: 0.05, gain: 0.025 * k, pan })
      burst({ t: t + 0.08, f: 2400, q: 2, a: 0.002, d: 0.09, gain: 0.015 * k, pan }) // radio hiss
    }
  },
  cloud(t, k, pan) {
    burst({ t, noise: 'pink', type: 'lowpass', f: 1300, f2: 380, q: 0.5, a: 0.012, d: 0.26, gain: 0.32 * k, pan, verb: 0.2 })
    tone({ t, f: 90, f2: 60, d: 0.12, gain: 0.18 * k, pan })
    sparkle(t + 0.03, 4, 0.2, 0.025 * k, 3000, 6000)
  },
  robot(t, k, pan) {
    modal({ t, f: vary(880, 0.06), modes: METAL, gain: 0.16 * k, beat: 11, strike: 0.4, decay: 0.55, pan, verb: 0.15 })
    thump(t, 105, 0.6 * k, pan, 0.1)
    tone({ t: t + 0.05, type: 'triangle', f: vary(1300, 0.08), f2: 1950, d: 0.06, gain: 0.04 * k, lp: 3200, pan })
    tone({ t: t + 0.11, type: 'triangle', f: vary(980, 0.08), d: 0.04, gain: 0.03 * k, lp: 3200, pan })
  },
}

export const dummyHit = safe((kind = 'scarecrow', intensity = 1) => {
  if (!limit('dummy', 40) || !voice(0.5, 1)) return
  const t = now()
  const k = clamp(intensity, 0.3, 2)
  const pan = rnd(-0.15, 0.15)
  wetTouch(t, k, pan)
  ;(DUMMY[kind] ?? DUMMY.scarecrow)(t + 0.002, k, pan)
})

// --- Progress --------------------------------------------------------------------------------------------
// XP gained: a tiny glassy sparkle. Plays constantly while training, so it stays soft.
let xpStep = 0
export const xp = safe(() => {
  if (!limit('xp', 125) || !voice(0.4, 1)) return
  const t = now()
  xpStep = (xpStep + 1 + Math.floor(Math.random() * 2)) % 5
  const scale = [0, 2, 4, 7, 9]
  modal({ t, f: C6 * 2 * semi(scale[xpStep]) * rnd(0.995, 1.005), modes: GLASS, gain: 0.022, decay: 0.45, pan: rnd(-0.3, 0.3), verb: 0.2 })
  burst({ t, type: 'highpass', f: 6000, q: 0.5, a: 0.001, d: 0.02, gain: 0.012 })
})

// Level up: air rushing up, a bright run up the glockenspiel over a warm chord, shimmer.
export const levelUp = safe(() => {
  if (!limit('lvl', 250) || !voice(1.5, 4)) return
  claim()
  const t = now()
  burst({ t, noise: 'pink', f: 300, f2: 3200, q: 0.9, a: 0.22, d: 0.12, gain: 0.18 })
  glock(t + 0.05, [0, 4, 7, 12, 16, 19, 24], 0.055, 0.13, 0.35)
  ;[0, 4, 7].forEach((n) => tone({ t: t + 0.05, type: 'triangle', f: C4 * 2 * semi(n), a: 0.05, hold: 0.25, d: 0.7, gain: 0.035, lp: 2200 }))
  modal({ t: t + 0.45, f: C6 * 2, modes: BELL, gain: 0.09, beat: 3, strike: 0.15, verb: 0.35 })
  sparkle(t + 0.3, 10, 0.6, 0.02)
  buzz([20, 30, 20])
})

// At the level cap: a gentle "can't go higher" two notes down.
export const maxLevel = safe(() => {
  if (!limit('max', 900) || !voice(0.8, 2)) return
  const t = now()
  modal({ t, f: C6 * semi(7), modes: GLOCK, gain: 0.11, strike: 0.1, verb: 0.25 })
  modal({ t: t + 0.13, f: C6 * semi(0), modes: GLOCK, gain: 0.1, strike: 0.1, verb: 0.25 })
  modal({ t, f: 260, modes: WOOD, gain: 0.12 })
})

// Rebirth: a swell rushing in, a deep boom, a soft choir pad and a bright chord ringing out.
export const rebirth = safe(() => {
  if (!voice(3.5, 5)) return
  claim()
  const t = now()
  burst({ t, noise: 'pink', f: 200, f2: 3800, q: 0.8, a: 0.7, d: 0.06, gain: 0.3 })
  burst({ t, type: 'highpass', f: 5000, q: 0.5, a: 0.7, d: 0.05, gain: 0.07 })
  sparkle(t + 0.1, 12, 0.6, 0.015, 3000, 7000)
  const hit = t + 0.74
  tone({ t: hit, f: 72, f2: 30, glide: 1.2, d: 1.6, gain: 0.55 })
  burst({ t: hit, noise: 'brown', type: 'lowpass', f: 420, q: 0.6, a: 0.005, d: 1.3, gain: 0.45, verb: 0.3 })
  burst({ t: hit, type: 'highpass', f: 4000, q: 0.5, a: 0.003, d: 0.7, gain: 0.1, verb: 0.3 })
  // Choir-ish pad: an "ah" chord held, swelling in.
  ;[[C4 * semi(-12), 0], [C4 * semi(-5), -0.4], [C4, 0.4], [C4 * semi(4), -0.2], [C4 * semi(7), 0.2]].forEach(([f, pan]) =>
    grunt({ t: hit, f, a: 0.35, hold: 0.6, d: 0.9, gain: 0.09, vowel: 'ah', shift: 1.15, breath: 0.15, vibrato: [5.2, 9], pan, verb: 0.5 }),
  )
  ;[0, 4, 7, 12, 16].forEach((n) => modal({ t: hit + 0.03, f: C6 * semi(n), modes: GLOCK, gain: 0.1, decay: 1.6, strike: 0.1, pan: rnd(-0.5, 0.5), verb: 0.4 }))
  glock(hit + 0.5, [12, 16, 19, 24, 28], 0.07, 0.08, 0.45)
  sparkle(hit + 0.2, 16, 1.2, 0.018)
  buzz([0, 740, 120, 60, 80])
})

// Something unlocked (a zone, a tentacle): a latch, a sparkly pop and a little run.
export const unlock = safe(() => {
  if (!limit('unlock', 200) || !voice(1.2, 3)) return
  claim()
  const t = now()
  modal({ t, f: vary(1900, 0.03), modes: COIN, gain: 0.1, decay: 0.35, strike: 0.4, beat: 9, bus: A.ui })
  modal({ t: t + 0.03, f: 1100, modes: PLASTIC, gain: 0.12, bus: A.ui })
  bubble({ t: t + 0.05, f: 450, d: 0.07, gain: 0.26, rise: 1.2 })
  burst({ t, noise: 'pink', f: 400, f2: 2600, q: 0.9, a: 0.12, d: 0.2, gain: 0.13 })
  glock(t + 0.12, [0, 7, 12, 16, 19], 0.065, 0.12)
  sparkle(t + 0.15, 6, 0.4, 0.018)
})

// Wins collected: trophy ding and a shower of coins, more for bigger amounts.
export const wins = safe((amount = 1) => {
  if (!limit('wins', 120) || !voice(1.6, 3)) return
  claim()
  const t = now()
  const big = clamp(Math.log10(Math.max(1, amount) + 1), 0.3, 4)
  modal({ t, f: 1320, modes: TROPHY, gain: 0.15, beat: 7, strike: 0.3, verb: 0.15 })
  coins(t + 0.04, Math.round(clamp(3 + big * 4, 3, 18) * K), 0.3 + big * 0.12, 0.085)
  if (big > 1.5) glock(t + 0.1, [7, 12, 16, 19], 0.06, 0.09, 0.3)
  buzz([20, 40, 20])
})

// --- Bandits and bosses ------------------------------------------------------------------------------------
// A bandit takes a hit: a short grunt (formants, no words), varied per call.
export const enemyHurt = safe((pan = 0) => {
  if (!limit('ehurt', 45) || !voice(0.3, 1)) return
  const t = now() + rnd(0, 0.02)
  const f = rnd(115, 175)
  grunt({ t, f, f2: f * rnd(0.72, 0.85), a: 0.008, d: rnd(0.11, 0.17), gain: 0.2, vowel: pick(['uh', 'oh', 'eh', 'ah']), shift: rnd(0.92, 1.08), breath: 0.3, pan, verb: 0.08 })
})

// Knocked out and flung: a longer cry rising then falling, a cartoon whoosh, a poof.
export const enemyDie = safe((pan = 0) => {
  if (!limit('edie', 50) || !voice(0.9, 2)) return
  const t = now()
  const f = rnd(140, 190)
  grunt({ t, f, f2: f * 0.55, glide: 0.35, a: 0.02, hold: 0.06, d: 0.3, gain: 0.2, vowel: pick(['oh', 'ah', 'oo']), shift: rnd(0.95, 1.1), breath: 0.25, pan, verb: 0.15 })
  burst({ t: t + 0.05, noise: 'pink', f: 500, f2: 2600, q: 1.4, a: 0.12, d: 0.18, gain: 0.12, pan: pan * 0.6, sweep: 0.3 })
  burst({ t: t + 0.32, noise: 'pink', type: 'lowpass', f: 1500, f2: 300, q: 0.5, a: 0.01, d: 0.22, gain: 0.2, pan, verb: 0.15 })
  sparkle(t + 0.34, 4, 0.2, 0.02, 3000, 5500)
})

// Boss roar: two detuned saws in a big throat (low formants), a rasp of noise, a growl LFO.
export const bossRoar = safe(() => {
  if (!limit('roar', 600) || !voice(1.6, 4)) return
  const t = now()
  for (const [f, pan] of [[62, -0.25], [64.5, 0.25]]) {
    grunt({ t, f, f2: f * 0.8, glide: 1.2, a: 0.15, hold: 0.55, d: 0.55, gain: 0.32, vowel: 'ah', shift: 0.72, breath: 0.9, vibrato: [8.5, 35], pan, verb: 0.4 })
  }
  grunt({ t: t + 0.05, f: 124, f2: 96, a: 0.12, hold: 0.45, d: 0.5, gain: 0.12, vowel: 'oh', shift: 0.8, breath: 0.6, vibrato: [11, 25], verb: 0.4 })
  burst({ t, noise: 'brown', type: 'lowpass', f: 320, q: 0.8, a: 0.15, hold: 0.5, d: 0.6, gain: 0.35 })
  tone({ t, f: 48, f2: 38, a: 0.1, hold: 0.5, d: 0.6, gain: 0.3 })
  buzz([60, 40, 120])
})

// Boss defeated: the roar falling away, a great boom, sparkles.
export const bossDie = safe(() => {
  if (!voice(3, 5)) return
  claim()
  const t = now()
  grunt({ t, f: 92, f2: 34, glide: 1.4, a: 0.05, hold: 0.25, d: 1.2, gain: 0.32, vowel: 'oh', shift: 0.72, breath: 0.8, vibrato: [7, 40], verb: 0.45 })
  grunt({ t, f: 95, f2: 36, glide: 1.4, a: 0.05, hold: 0.25, d: 1.2, gain: 0.2, vowel: 'ah', shift: 0.75, breath: 0.6, vibrato: [6, 30], pan: 0.3, verb: 0.45 })
  const hit = t + 0.6
  tone({ t: hit, f: 95, f2: 26, glide: 0.6, d: 1.3, gain: 0.7 })
  burst({ t: hit, f: 2000, q: 0.6, a: 0.0006, d: 0.025, gain: 0.45 })
  burst({ t: hit, noise: 'brown', type: 'lowpass', f: 900, f2: 120, q: 0.7, a: 0.003, d: 0.9, gain: 0.7, verb: 0.4 })
  crinkle({ t: hit + 0.02, n: Math.round(30 * K), dur: 0.6, gain: 0.07, f0: 1200, f1: 6000, width: 0.8 })
  glock(hit + 0.35, [0, 4, 7, 12, 16, 19, 24], 0.06, 0.1, 0.4)
  sparkle(hit + 0.4, 16, 1, 0.02)
  buzz([80, 40, 120])
})

// An enemy winds up: a quiet tick and a short rising whine (a warning, not an alarm).
export const telegraph = safe(() => {
  if (!limit('tele', 90) || !voice(0.35, 1)) return
  const t = now()
  modal({ t, f: vary(2400, 0.04), modes: PLASTIC, gain: 0.045 })
  tone({ t, type: 'triangle', f: vary(820, 0.05), f2: 1350, glide: 0.28, a: 0.03, d: 0.26, gain: 0.03, lp: 2400 })
})

// A bandit's fist lands on the octopus.
export const punch = safe((pan = 0) => {
  if (!limit('punch', 40) || !voice(0.3, 1)) return
  const t = now()
  burst({ t, f: vary(3000, 0.12), q: 0.8, a: 0.0006, d: 0.009, gain: 0.28, pan })
  tone({ t, f: vary(125, 0.08), f2: 55, d: 0.1, gain: 0.45, pan })
  burst({ t, noise: 'pink', type: 'lowpass', f: 1200, f2: 350, q: 0.7, a: 0.002, d: 0.07, gain: 0.35, pan })
  bubbles({ t: t + 0.01, n: 3, dur: 0.05, f0: 250, f1: 700, gain: 0.04, width: 0.2 })
})

// A blade swishing through the air with a faint metallic ring.
export const knife = safe((pan = 0) => {
  if (!limit('knife', 40) || !voice(0.4, 1)) return
  const t = now()
  burst({ t, f: vary(3200, 0.1), f2: 6000, q: 2.2, a: 0.03, d: 0.11, gain: 0.13, pan, sweep: 0.1 })
  burst({ t, noise: 'pink', f: 900, f2: 2200, q: 1, a: 0.03, d: 0.09, gain: 0.07, pan })
  modal({ t: t + 0.02, f: vary(3300, 0.05), modes: METAL, gain: 0.018, decay: 0.5, beat: 8, pan })
})

// Cartoony pistol: a rounded crack, a short body, the canyon slapping it back.
export const gunshot = safe((pan = 0) => {
  if (!limit('gun', 50) || !voice(0.7, 2)) return
  const t = now()
  burst({ t, f: vary(1900, 0.1), q: 0.55, a: 0.0005, d: 0.03, gain: 0.42, pan })
  burst({ t, type: 'lowpass', f: 5200, q: 0.5, a: 0.0005, d: 0.012, gain: 0.18, pan })
  tone({ t, f: vary(170, 0.06), f2: 60, d: 0.08, gain: 0.32, pan })
  burst({ t, noise: 'pink', type: 'lowpass', f: 900, f2: 250, q: 0.6, a: 0.001, d: 0.16, gain: 0.26, pan })
  // Echo off the cliffs.
  burst({ t: t + rnd(0.085, 0.11), noise: 'pink', type: 'bandpass', f: 1100, q: 0.6, a: 0.004, d: 0.22, gain: 0.06, pan: -pan, verb: 0.6 })
})

// --- The player --------------------------------------------------------------------------------------------
// Hurt: a squishy "oof" thump.
export const playerHurt = safe(() => {
  if (!limit('phurt', 110) || !voice(0.4, 2)) return
  const t = now()
  tone({ t, f: vary(165, 0.08), f2: 70, d: 0.15, gain: 0.42 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 750, f2: 260, q: 0.7, a: 0.002, d: 0.12, gain: 0.28 })
  squelch(t + 0.01, 0.6)
})

// Knocked out: a sad descending wobble, a squelchy collapse.
export const playerDie = safe(() => {
  if (!voice(1.8, 4)) return
  const t = now()
  const ctx = A.ctx
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(520, t)
  osc.frequency.exponentialRampToValueAtTime(120, t + 1.0)
  const lfo = ctx.createOscillator()
  lfo.frequency.setValueAtTime(7, t)
  lfo.frequency.linearRampToValueAtTime(4, t + 1)
  const depth = ctx.createGain()
  depth.gain.value = 45
  lfo.connect(depth).connect(osc.detune)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1800
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.12, t + 0.04)
  g.gain.setValueAtTime(0.12, t + 0.6)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
  osc.connect(lp).connect(g).connect(A.sfx)
  osc.start(t)
  lfo.start(t)
  osc.stop(t + 1.15)
  lfo.stop(t + 1.15)
  squelch(t + 0.9, 1)
  thump(t + 0.95, 90, 0.8)
  buzz([80, 60, 160])
})

// Revived: a heal whoosh rising into a chime.
export const revive = safe(() => {
  if (!voice(1.5, 4)) return
  claim()
  const t = now()
  burst({ t, noise: 'pink', f: 300, f2: 3500, q: 0.9, a: 0.35, d: 0.1, gain: 0.22 })
  tone({ t, f: 300, f2: 900, glide: 0.4, a: 0.05, d: 0.4, gain: 0.05 })
  glock(t + 0.36, [0, 7, 12, 19], 0.06, 0.12, 0.35)
  modal({ t: t + 0.55, f: C6 * 2, modes: BELL, gain: 0.08, beat: 3, verb: 0.35 })
  sparkle(t + 0.4, 10, 0.5, 0.018)
})

// Revive countdown tick.
export const countdown = safe(() => {
  if (!limit('count', 300) || !voice(0.2, 2)) return
  const t = now()
  modal({ t, f: vary(1100, 0.01), modes: WOOD, gain: 0.18, strike: 0.2, bus: A.ui })
  tone({ t, f: 880, d: 0.06, gain: 0.035, bus: A.ui })
})

// Movement: a wet hop off the ground, and the splat of landing.
export const jump = safe(() => {
  if (!limit('jump', 150) || !voice(0.25, 1)) return
  const t = now()
  burst({ t, noise: 'pink', f: 450, f2: 1400, q: 0.9, a: 0.03, d: 0.12, gain: 0.1 })
  bubbles({ t, n: 4, dur: 0.07, f0: 400, f1: 1300, gain: 0.05, rise: 0.9 }) // suckers letting go
})
export const land = safe((k = 0.5) => {
  if (!limit('land', 120) || !voice(0.4, 1)) return
  const t = now()
  k = clamp(k, 0.25, 1)
  tone({ t, f: vary(85, 0.06), f2: 46, d: 0.12, gain: 0.4 * k })
  burst({ t, noise: 'brown', type: 'lowpass', f: 520, q: 0.6, a: 0.003, d: 0.13, gain: 0.35 * k })
  squelch(t + 0.005, 0.7 * k)
})
// One soft pat of the tentacles walking (index.js keeps the cadence).
export const step = safe((k = 0.5, pan = 0) => {
  if (!voice(0.15, 1)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'lowpass', f: vary(520, 0.15), f2: 220, q: 0.7, a: 0.003, d: 0.05, gain: 0.07 * k, pan })
  tone({ t, f: vary(92, 0.1), f2: 60, d: 0.045, gain: 0.07 * k, pan })
  if (Math.random() < 0.6) bubble({ t: t + 0.01, f: rnd(250, 600), d: 0.03, gain: 0.03 * k, rise: 0.6, pan })
})
// Teleported (a pad, a respawn): a whoosh in with a sparkle.
export const respawnFx = safe(() => {
  if (!limit('respawn', 400) || !voice(0.9, 2)) return
  const t = now()
  burst({ t, noise: 'pink', f: 3000, f2: 400, q: 1, a: 0.05, d: 0.3, gain: 0.22 })
  modal({ t: t + 0.05, f: C6 * semi(12), modes: GLOCK, gain: 0.06, verb: 0.4 })
})

// --- Stages -------------------------------------------------------------------------------------------------------
// A stage begins: a drum and a short horn call (boss: heavier, minor and ominous).
export const stageStart = safe((boss = false) => {
  if (!limit('stage', 400) || !voice(1.6, 4)) return
  const t = now()
  if (boss) {
    for (const [dt, k] of [[0, 1], [0.28, 0.8], [0.5, 1.1]]) {
      tone({ t: t + dt, f: 70, f2: 36, glide: 0.25, d: 0.45, gain: 0.6 * k })
      burst({ t: t + dt, noise: 'brown', type: 'lowpass', f: 420, q: 0.7, a: 0.002, d: 0.35, gain: 0.45 * k, verb: 0.3 })
    }
    brass({ t: t + 0.5, f: 110, a: 0.05, hold: 0.45, d: 0.5, gain: 0.12, bright: 1100, verb: 0.35 })
    brass({ t: t + 0.5, f: 130.8, a: 0.05, hold: 0.45, d: 0.5, gain: 0.09, bright: 1100, verb: 0.35 }) // minor third
    brass({ t: t + 0.5, f: 55, a: 0.08, hold: 0.45, d: 0.6, gain: 0.1, bright: 600, verb: 0.3 })
  } else {
    tone({ t, f: 92, f2: 48, glide: 0.2, d: 0.35, gain: 0.55 })
    burst({ t, noise: 'brown', type: 'lowpass', f: 500, q: 0.7, a: 0.002, d: 0.28, gain: 0.4, verb: 0.25 })
    burst({ t, type: 'highpass', f: 3000, q: 0.5, a: 0.001, d: 0.12, gain: 0.08 })
    brass({ t: t + 0.08, f: 196, d: 0.18, hold: 0.06, gain: 0.1, verb: 0.3 })
    brass({ t: t + 0.24, f: 261.6, d: 0.45, hold: 0.18, gain: 0.11, verb: 0.3 })
    brass({ t: t + 0.24, f: 329.6, d: 0.45, hold: 0.18, gain: 0.07, verb: 0.3 })
  }
})

// Wave cleared: a short triumphant fanfare with a timpani and sparkles.
export const waveCleared = safe(() => {
  if (!limit('cleared', 600) || !voice(2, 4)) return
  claim()
  const t = now()
  tone({ t, f: 98, f2: 60, glide: 0.2, d: 0.5, gain: 0.5 })
  burst({ t, noise: 'brown', type: 'lowpass', f: 450, q: 0.7, a: 0.002, d: 0.35, gain: 0.35, verb: 0.3 })
  const notes = [[0, 0.1, 261.6], [0.13, 0.1, 329.6], [0.26, 0.1, 392], [0.42, 0.55, 523.3]]
  for (const [dt, hold, f] of notes) {
    brass({ t: t + dt, f, hold, d: dt > 0.4 ? 0.6 : 0.12, gain: 0.1, bright: 2600, verb: 0.3 })
    if (dt > 0.4) {
      brass({ t: t + dt, f: f * 0.75, hold, d: 0.6, gain: 0.07, bright: 2000, verb: 0.3 })
      brass({ t: t + dt, f: f * 0.5, hold, d: 0.6, gain: 0.06, bright: 1500, verb: 0.3 })
    }
  }
  tone({ t: t + 0.42, f: 98, f2: 55, glide: 0.25, d: 0.6, gain: 0.45 })
  glock(t + 0.45, [12, 16, 19, 24], 0.05, 0.09, 0.35)
  sparkle(t + 0.5, 12, 0.7, 0.018)
  buzz([30, 40, 30, 40, 60])
})

// The pink barrier dissolving: a descending shimmer and a whoosh of air.
export const gateOpen = safe(() => {
  if (!limit('gate', 500) || !voice(1.6, 3)) return
  const t = now()
  const steps = [24, 21, 19, 16, 14, 12, 9, 7, 4, 2, 0]
  steps.forEach((n, i) => modal({ t: t + i * 0.045 + rnd(0, 0.01), f: C6 * semi(n), modes: GLASS, gain: 0.045 * (1 - i / 16), decay: 0.6, pan: Math.sin(i * 1.3) * 0.6, verb: 0.4 }))
  burst({ t, noise: 'pink', f: 2600, f2: 300, q: 0.8, a: 0.1, d: 0.55, gain: 0.25, verb: 0.2 })
  tone({ t, f: 60, f2: 45, a: 0.12, d: 0.6, gain: 0.25 })
  sparkle(t + 0.1, 10, 0.6, 0.016, 3500, 7500)
})

// Stepping into / denied at the portal: a deep hum swelling with a swirl of air.
export const portal = safe(() => {
  if (!limit('portal', 700) || !voice(1, 2)) return
  const t = now()
  tone({ t, f: 68, a: 0.2, d: 0.6, gain: 0.14 })
  tone({ t, f: 136, f2: 150, a: 0.2, d: 0.5, gain: 0.05 })
  burst({ t, noise: 'pink', f: 380, f2: 1300, q: 2.2, a: 0.25, d: 0.5, gain: 0.12, verb: 0.3 })
  sparkle(t + 0.1, 5, 0.5, 0.015, 2400, 5200)
})
