// Plays Boxity emotes on a rider rig. Boxity owns the emote wheel, ownership and prices; the game
// receives an emote id (bloxity.js onEmote), looks the clip up in the catalogue (bloxity.js loadEmotes)
// and plays it on the standard 22-bone rig. Clip format (docs.bloxity.io, Emotes):
//   { len, loop, tracks: { bone: [[timeSec, xDeg, yDeg, zDeg], ...] } }
// Values are DEGREE DELTAS over the bind pose, euler order XYZ right-multiplied onto the bone's bind
// quaternion, smoothstep between keys, clamped outside the key range, looping on time % len. Unknown
// bones are ignored and an unknown emote never throws: an emote is cosmetic and must not break a frame.
import { Euler, Quaternion } from 'three'
import { EMOTES } from '../config.js'

const DEG = Math.PI / 180
const smooth = (s) => s * s * (3 - 2 * s)

// [x, y, z] degrees of one track at time t, or null for an empty track.
export function sampleTrack(keys, t, out = [0, 0, 0]) {
  if (!Array.isArray(keys) || !keys.length) return null
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (t <= first[0]) {
    out[0] = first[1]
    out[1] = first[2]
    out[2] = first[3]
    return out
  }
  if (t >= last[0]) {
    out[0] = last[1]
    out[1] = last[2]
    out[2] = last[3]
    return out
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a[0] && t <= b[0]) {
      const s = smooth((t - a[0]) / (b[0] - a[0] || 1))
      out[0] = a[1] + (b[1] - a[1]) * s
      out[1] = a[2] + (b[2] - a[2]) * s
      out[2] = a[3] + (b[3] - a[3]) * s
      return out
    }
  }
  return null
}

export class EmotePlayer {
  // `root` is a character from avatar/character.js (`nodes`: name -> node). Build it right after the
  // character loads, before an animator has moved any bone: the bind pose is captured here.
  constructor(root) {
    this.nodes = root?.nodes ?? {}
    this.bind = new Map()
    for (const [name, node] of Object.entries(this.nodes)) if (node?.quaternion) this.bind.set(name, node.quaternion.clone())
    this.clip = null
    this.id = ''
    this.t = 0
    this.weight = 0
    this.q = new Quaternion()
    this.qd = new Quaternion()
    this.e = new Euler(0, 0, 0, 'XYZ')
    this.v = [0, 0, 0]
  }

  get active() {
    return !!this.clip || this.weight > 0
  }

  // `emote` is a catalogue entry { id, clip }. Anything malformed is ignored.
  play(emote) {
    const clip = emote?.clip
    if (!clip || !clip.tracks || !(clip.len > 0)) return false
    this.clip = clip
    this.id = String(emote.id ?? '')
    this.t = 0
    return true
  }

  stop() {
    this.clip = null
    this.id = ''
  }

  // Call every frame AFTER the animator has written the bones.
  update(dt) {
    if (!(dt > 0)) dt = 0
    const rate = dt / Math.max(0.02, EMOTES.blend)
    this.weight = this.clip ? Math.min(1, this.weight + rate) : Math.max(0, this.weight - rate)
    if (!this.weight && !this.clip) return
    const clip = this.clip
    if (clip) {
      this.t += dt
      if (this.t >= clip.len && !clip.loop) {
        // A one-shot holds its last key while it blends out.
        this.t = clip.len
        this.clip = null
        this.id = ''
      }
    }
    const c = clip ?? this.last
    this.last = c
    if (!c) return
    const time = c.loop && c.len > 0 ? this.t % c.len : Math.min(this.t, c.len)
    for (const [name, keys] of Object.entries(c.tracks)) {
      const node = this.nodes[name]
      const bind = this.bind.get(name)
      if (!node || !bind) continue
      const v = sampleTrack(keys, time, this.v)
      if (!v) continue
      this.e.set(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'XYZ')
      this.q.copy(bind).multiply(this.qd.setFromEuler(this.e))
      node.quaternion.slerp(this.q, this.weight)
    }
  }
}
