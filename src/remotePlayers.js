// The other players in the room: each one is a half-octopus like the local player, drawn from the
// roster the server relays (backend WorldState.PlayerState): position / heading / speed, the octopus
// level and tentacle skin, and the player's Bloxity look (ids only; every client rebuilds the skin,
// parts and accessories itself, see avatar/look.js). Also their emotes, chat bubbles and a name tag.
// Only the nearest `NET.maxRemote` players inside `NET.remoteRadius` are built (an octopus is a CPU-animated
// mesh), the rest cost nothing. Never throws into the frame loop.
import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial } from 'three'
import { NET, PLAYER_DIMS } from './config.js'
import { createOctopus } from './octopus.js'
import { disposeAnimator, makeAnimator } from './avatar/animator.js'
import { buildDefaultCharacter } from './avatar/character.js'
import { EmotePlayer } from './avatar/emote.js'
import { buildLookCharacter, disposeLook, lookKey, parseLook } from './avatar/look.js'
import { armsFor, octoScale, tentacleById } from './state.js'
import { bubbleSeconds, loadEmotes, playerInRoom, playerJoined } from './bloxity.js'

const TAU = Math.PI * 2
const angleLerp = (a, b, t) => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return a + d * t
}

// --- Text sprites (name tag, chat bubble) ---------------------------------------------------------
export function textSprite(text, { bubble = false } = {}) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `600 ${bubble ? 34 : 38}px Fredoka, system-ui, sans-serif`
  ctx.font = font
  const lines = bubble ? wrap(ctx, text, 440).slice(0, 2) : [text]
  const w = Math.min(520, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 44)
  const lh = bubble ? 44 : 50
  const h = lines.length * lh + 26
  canvas.width = w
  canvas.height = h
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (bubble) {
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.beginPath()
    ctx.roundRect(2, 2, w - 4, h - 4, 22)
    ctx.fill()
    ctx.fillStyle = '#1b2440'
  } else {
    ctx.lineWidth = 8
    ctx.strokeStyle = 'rgba(10,20,50,0.85)'
    ctx.fillStyle = '#ffffff'
  }
  lines.forEach((l, i) => {
    const y = 13 + lh * (i + 0.5)
    if (!bubble) ctx.strokeText(l, w / 2, y)
    ctx.fillText(l, w / 2, y)
  })
  const tex = new CanvasTexture(canvas)
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  const unit = bubble ? 0.0085 : 0.0072 // world units per canvas px
  sprite.scale.set(w * unit, h * unit, 1)
  sprite.renderOrder = 10
  sprite.userData.height = h * unit
  return sprite
}
function wrap(ctx, text, max) {
  const out = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > max) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}
export function disposeSprite(sprite) {
  if (!sprite) return
  sprite.removeFromParent()
  sprite.material.map?.dispose()
  sprite.material.dispose()
}

// --- One remote player ------------------------------------------------------------------------------
class Remote {
  constructor(scene, id) {
    this.id = id
    this.octo = createOctopus({ lod: true })
    scene.add(this.octo.group)
    this.avatar = null
    this.animator = null
    this.emote = null
    this.generation = 0
    this.lookKey = null
    this.arms = 0
    this.tentacle = ''
    this.level = 0
    this.scale = 1
    this.emoteSeq = 0
    this.pos = null
    this.yaw = 0
    this.tag = null
    this.tagName = ''
    this.bubble = null
    this.bubbleAt = 0
    this.setAvatar(buildDefaultCharacter())
  }

  setAvatar(next) {
    if (this.avatar) {
      this.avatar.removeFromParent()
      disposeLook(this.avatar)
    }
    disposeAnimator(this.animator)
    this.avatar = next
    this.octo.seat.add(next)
    this.emote = new EmotePlayer(next) // before the animator touches a bone: the bind pose is read here
    this.animator = makeAnimator(next)
  }

  async setLook(look) {
    const mine = ++this.generation
    try {
      const next = await buildLookCharacter(look, { local: false })
      if (mine !== this.generation || !this.octo.group.parent) return disposeLook(next)
      this.setAvatar(next)
    } catch (err) {
      console.warn('[remote] look failed', err?.message ?? err)
    }
  }

  // The tag floats above the rider's head: seat height + rider height, in unscaled group space.
  placeSprites() {
    const top = this.octo.seat.position.y + PLAYER_DIMS.height * (this.avatar?.scale?.y / (this.avatar?.scale?.x || 1) || 1) + 0.7
    if (this.tag) this.tag.position.set(0, top, 0)
    if (this.bubble) this.bubble.position.set(0, top + (this.tag?.userData.height ?? 0.6) * 0.5 + this.bubble.userData.height * 0.5 + 0.15, 0)
  }

  setName(name) {
    if (name === this.tagName && this.tag) return
    this.tagName = name
    disposeSprite(this.tag)
    this.tag = textSprite(name || 'Player')
    this.octo.group.add(this.tag)
  }

  say(text) {
    disposeSprite(this.bubble)
    this.bubble = textSprite(text, { bubble: true })
    this.bubbleAt = performance.now()
    this.octo.group.add(this.bubble)
  }

  dispose() {
    this.generation++
    disposeSprite(this.tag)
    disposeSprite(this.bubble)
    disposeAnimator(this.animator)
    disposeLook(this.avatar)
    this.octo.dispose()
  }
}

// --- The roster -----------------------------------------------------------------------------------------
// `getRoom()` returns the live Colyseus room or null; `localPos()` the local player's { x, z }.
export function createRemotePlayers({ scene, getRoom, localPos }) {
  const remotes = new Map() // session id -> Remote
  const seen = new Set() // session ids already reported to Boxity's friend-join toasts
  let joinedAt = 0
  let lastRoom = null
  let elapsed = 0
  let emotes = null // the catalogue, loaded once on first use
  const catalogue = () => (emotes ||= loadEmotes())

  function destroy(id) {
    remotes.get(id)?.dispose()
    remotes.delete(id)
  }

  function sync(r, p, dt) {
    // Placement (smoothed: the server relays ~10 poses a second).
    const k = 1 - Math.exp(-12 * dt)
    if (!r.pos) {
      r.pos = { x: p.x, y: p.y, z: p.z }
      r.yaw = p.yaw
    } else {
      r.pos.x += (p.x - r.pos.x) * k
      r.pos.y += (p.y - r.pos.y) * k
      r.pos.z += (p.z - r.pos.z) * k
      r.yaw = angleLerp(r.yaw, p.yaw, k)
    }
    r.octo.group.position.set(r.pos.x, r.pos.y, r.pos.z)
    r.octo.group.rotation.y = r.yaw

    // Octopus: tentacle skin, level -> size and arm count.
    const skin = p.tentacle || 'reef'
    if (skin !== r.tentacle) {
      r.tentacle = skin
      r.octo.setSkin(tentacleById(skin))
    }
    const level = Math.max(1, p.level | 0)
    if (level !== r.level) {
      r.level = level
      const arms = armsFor(level)
      if (arms !== r.arms) {
        r.arms = arms
        r.octo.setArms(arms)
      }
    }
    const target = octoScale(level)
    r.scale += (target - r.scale) * Math.min(1, dt * 4)
    r.octo.setScale(r.scale)

    // Bloxity look.
    const look = parseLook(p.avatar)
    const key = lookKey(look)
    if (key !== r.lookKey) {
      r.lookKey = key
      if (look) r.setLook(look)
      else r.setAvatar(buildDefaultCharacter())
    }

    // Name tag and emote.
    r.setName(p.username)
    if (p.emoteSeq !== r.emoteSeq) {
      r.emoteSeq = p.emoteSeq
      if (p.emote) catalogue().then((map) => r.emote?.play(map.get(p.emote)))
    }
    if (!p.emote) r.emote?.stop()
    else if (p.speed > 1.2) r.emote?.stop() // walking away ends it for everyone, like on the sender's screen

    r.octo.update(dt, { speed: p.speed, grounded: true, time: elapsed })
    r.animator?.update(dt, { grounded: true, speed: 0, verticalVelocity: 0, turn: 0 })
    r.emote?.update(dt)
    if (r.bubble && performance.now() - r.bubbleAt > bubbleSeconds() * 1000) {
      disposeSprite(r.bubble)
      r.bubble = null
    }
    r.placeSprites()
  }

  return {
    update(dt, time) {
      elapsed = time ?? elapsed + dt
      const room = getRoom()
      if (room !== lastRoom) {
        for (const id of [...remotes.keys()]) destroy(id)
        seen.clear()
        lastRoom = room
        joinedAt = performance.now()
      }
      const players = room?.state?.players
      if (!room || !players) return

      // Everyone but me, nearest first.
      const me = localPos()
      const list = []
      players.forEach((p, id) => {
        if (id === room.sessionId) return
        if (!seen.has(id)) {
          seen.add(id)
          // Boxity toasts "X joined you" for friends: already there at join = playerInRoom, later = playerJoined.
          if (performance.now() - joinedAt < 2500) playerInRoom(p.username)
          else playerJoined(p.username)
        }
        const dx = p.x - me.x
        const dz = p.z - me.z
        list.push({ id, p, d2: dx * dx + dz * dz })
      })
      for (const id of [...seen]) if (!players.has(id)) seen.delete(id)
      list.sort((a, b) => a.d2 - b.d2)
      const keep = new Set()
      for (const e of list) {
        if (keep.size >= NET.maxRemote || e.d2 > NET.remoteRadius * NET.remoteRadius) break
        keep.add(e.id)
      }
      for (const id of [...remotes.keys()]) if (!keep.has(id)) destroy(id)
      for (const e of list) {
        if (!keep.has(e.id)) continue
        let r = remotes.get(e.id)
        if (!r) remotes.set(e.id, (r = new Remote(scene, e.id)))
        try {
          sync(r, e.p, dt)
        } catch (err) {
          console.warn('[remote] update failed', err?.message ?? err)
        }
      }
    },
    // A Boxity chat message over its sender (matched by the verified account id the roster carries).
    say(userId, text) {
      const room = getRoom()
      room?.state?.players?.forEach((p, id) => {
        if (p.uid && p.uid === userId) remotes.get(id)?.say(text)
      })
    },
    count: () => remotes.size,
    dispose() {
      for (const id of [...remotes.keys()]) destroy(id)
    },
  }
}
