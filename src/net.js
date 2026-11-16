// Colyseus link to Octopus-evolution-backend (room "world"): loads and saves the player's progress,
// tells the server the equipped skin / level / Bloxity look, and receives the leaderboards. Never
// throws and never blocks play: with no server (or an unreachable one) the game runs offline on
// its localStorage save (state.js).
//
// Contract (backend CLAUDE.md): client -> server `saveProgress` (the whole `snapshot()`), `identify`,
// `loadout`, `setAvatar`, `pose`, `emote`; server -> client `progress` / `noProgress` / `serverError` /
// `leaderboard`. Who the player is comes only from the Bloxity token the server verifies.
import { Client } from '@colyseus/sdk'
import { BOARD_LINKS, NET, SERVER_URL } from './config.js'
import {
  authState,
  canResolveServer,
  getPfp,
  getToken,
  launchRoomId,
  locateRoom,
  onAvatarChanged,
  onProportionsChanged,
  resolveServerEndpoint,
  subscribeAuth,
  submitScore,
  topRows,
  updateRoom,
} from './bloxity.js'
import { lookJson } from './avatar/look.js'
import { hydrate, onChange, snapshot, state } from './state.js'

export const net = {
  room: null,
  connected: false,
  hydrated: false, // a progress / noProgress answer arrived: saving is allowed
  // Top lists keyed by the backend's LEADERBOARD_STATS (= state keys), rows { name, value }.
  leaderboard: { totalWins: [], rebirths: [], playtime: [], bestStage: [] },
}

// Other modules' room messages (rewards.js: daily / gifts): fn(room) runs on every (re)join,
// before the server's first answer can arrive.
const roomListeners = new Set()
export function onRoom(fn) {
  roomListeners.add(fn)
  if (net.room) fn(net.room)
}
export function sendNet(type, payload) {
  if (!net.connected) return false
  send(type, payload)
  return true
}

const boardListeners = new Set()
export function onLeaderboard(fn) {
  boardListeners.add(fn)
  fn(net.leaderboard)
  return () => boardListeners.delete(fn)
}

// --- Identity ---------------------------------------------------------------------
// The server never takes an account id from the client: it verifies the Bloxity token (backend auth.ts)
// and uses only the id Boxity returns. No token = a guest, who is never saved. Local dev (the vite dev
// server, no Bloxity sign-in) joins with a per-browser `dev-` id instead, which the server honours
// outside production only.
function devId() {
  const make = () => `dev-${Math.random().toString(36).slice(2, 12)}`
  try {
    let id = localStorage.getItem(NET.guestKey)
    if (!id) localStorage.setItem(NET.guestKey, (id = make()))
    return id
  } catch {
    return make()
  }
}
const DEV_ID = import.meta.env.DEV ? devId() : ''

function identity() {
  const u = authState.user
  const token = u ? getToken() : null
  const username = u
    ? String(u.displayName || u.username || u.name || 'Player')
    : authState.guest?.displayName || authState.guest?.username || 'Guest'
  const who = token ? { token } : DEV_ID && !u ? { devId: DEV_ID } : {}
  return { ...who, username, pfp: getPfp() }
}
// Which account saves are attributed to: '' = a guest (never saved).
const idKey = (id) => (id.token ? `u:${authState.user?._id ?? ''}` : id.devId || '')

// The Bloxity look as the server relays it: JSON { equipped, proportions, outfitKey }, ids only.
const avatarJson = () => lookJson()

// --- Saving -----------------------------------------------------------------------
let lastSaved = ''
let saveTimer = 0
let firstDirty = 0
let sentId = '' // identity the server currently attributes saves to

const isGuest = () => !sentId

export function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = 0
  firstDirty = 0
  if (!net.connected || !net.hydrated || isGuest()) return
  const snap = snapshot()
  const json = JSON.stringify(snap)
  if (json === lastSaved) return
  lastSaved = json
  send('saveProgress', snap)
}

function scheduleSave() {
  if (!net.connected || !net.hydrated || isGuest()) return
  const now = performance.now()
  if (!firstDirty) firstDirty = now
  clearTimeout(saveTimer)
  const wait = Math.min(NET.saveDebounce * 1000, Math.max(0, firstDirty + NET.saveMaxWait * 1000 - now))
  saveTimer = setTimeout(saveNow, wait)
}

// --- Messages out ---------------------------------------------------------------------
function send(type, payload) {
  try {
    net.room?.send(type, payload)
  } catch (err) {
    console.warn('[net] send failed', type, err)
  }
}

// What the others need to draw this player (backend presence.ts `loadout`).
const loadoutNow = () => ({ tentacle: state.equipped, level: state.level, title: state.title, trail: state.trail, ascend: state.ascend })
let sentLoadout = ''
function syncLoadout() {
  if (!net.connected) return
  const loadout = loadoutNow()
  const key = JSON.stringify(loadout)
  if (key === sentLoadout) return
  sentLoadout = key
  send('loadout', loadout)
}

let sentAvatar = null
export function syncAvatar() {
  if (!net.connected) return
  const avatar = avatarJson()
  if (avatar === sentAvatar) return
  sentAvatar = avatar
  send('setAvatar', { avatar })
}

// --- Connection -----------------------------------------------------------------------
function attach(room) {
  net.room = room
  net.connected = true
  for (const fn of roomListeners) fn(room)
  room.onMessage('progress', (doc) => {
    // The server's save wins over whatever the first paint showed (localStorage).
    hydrate(doc ?? {})
    lastSaved = JSON.stringify(snapshot()) // what the server holds: don't echo it straight back
    net.hydrated = true
    syncLoadout()
  })
  room.onMessage('noProgress', () => {
    // New account, guest or no database: keep what we have and push it as the first save.
    net.hydrated = true
    lastSaved = ''
    saveNow()
  })
  room.onMessage('serverError', () => {
    // The save exists but could not be read: never overwrite it.
    net.hydrated = false
    console.warn('[net] server could not read the saved progress; saving is off for this session')
  })
  room.onMessage('leaderboard', (msg) => {
    const boards = msg?.boards ?? {}
    boardsFromServer = true
    for (const key of Object.keys(net.leaderboard)) net.leaderboard[key] = Array.isArray(boards[key]) ? boards[key] : []
    for (const fn of boardListeners) fn(net.leaderboard)
  })
  room.onLeave(() => {
    if (net.room !== room) return
    net.room = null
    net.connected = false
    net.hydrated = false
    boardsFromServer = false
    updateRoom('') // not in a joinable room until the rejoin
    setTimeout(connect, NET.retry * 1000) // keep trying; local play is unaffected meanwhile
  })
  sentLoadout = ''
  sentAvatar = null
  syncLoadout()
  syncAvatar()
}

// Bloxity hosting has no fixed socket URL: the matchmaker picks a pod with room (or wakes one) and the
// SDK returns its endpoint (the dev channel reaches the dev backend, prod the prod one). Each endpoint is
// pinned to one pod, so every connect builds a NEW Client. A configured SERVER_URL (config.js) wins.
const hasServer = () => !!(SERVER_URL || canResolveServer())

// The page may be opened on a room: the game page's Open Rooms Join button or a friend invite (?roomId=).
// Only the first connection joins it; a reconnect matchmakes. A room that is gone or full falls through.
let launchRoom = launchRoomId()
async function joinLaunchRoom(options) {
  const id = launchRoom
  launchRoom = ''
  if (!id) return null
  try {
    if (SERVER_URL) return { room: await new Client(SERVER_URL).joinById(id.split('~').pop(), options), relay: '' }
    const at = await locateRoom(id)
    if (at) return { room: await new Client(at.endpoint).joinById(at.roomId, options), relay: at.relayRoomId }
  } catch (err) {
    console.info('[net] the invited room is gone or full; matchmaking instead', err?.message ?? err)
  }
  return null
}

async function joinAnyRoom(options) {
  if (SERVER_URL) return { room: await new Client(SERVER_URL).joinOrCreate('world', options), relay: '' }
  const { endpoint, relayRoomId } = await resolveServerEndpoint(authState.user?._id)
  return { room: await new Client(endpoint).joinOrCreate('world', options), relay: relayRoomId }
}

let connecting = false
let retryIn = NET.retry
async function connect() {
  if (!hasServer() || connecting || net.connected) return
  connecting = true
  try {
    const id = identity()
    sentId = idKey(id)
    const options = { ...id, loadout: loadoutNow(), avatar: avatarJson() }
    const { room, relay } = (await joinLaunchRoom(options)) ?? (await joinAnyRoom(options))
    retryIn = NET.retry
    attach(room)
    // Friends' invites and Open Rooms' Join land in THIS room: "<relay>~<room>" when hosted, else the room id.
    updateRoom(relay ? `${relay}~${room.roomId}` : room.roomId)
  } catch (err) {
    console.warn(`[net] could not reach the server (retrying in ${retryIn}s); playing offline`, err?.message ?? err)
    setTimeout(connect, retryIn * 1000)
    retryIn = Math.min(retryIn * 2, NET.retryMax)
  } finally {
    connecting = false
  }
}

// --- Presence out ---------------------------------------------------------------------------
let lastPoseKey = ''
let lastPoseAt = 0
// The local octopus' feet position, heading and speed, ~NET.poseHz a second and only when it changed.
export function sendPose(x, y, z, yaw, speed) {
  if (!net.connected) return
  const now = performance.now()
  if (now - lastPoseAt < 1000 / NET.poseHz) return
  lastPoseAt = now
  const r = (n) => Math.round(n * 100) / 100
  const msg = { x: r(x), y: r(y), z: r(z), yaw: r(yaw), speed: r(speed) }
  const key = JSON.stringify(msg)
  if (key === lastPoseKey) return
  lastPoseKey = key
  send('pose', msg)
}
// The Boxity emote the player started (catalogue id), or '' when it stopped.
export function sendEmote(id) {
  if (net.connected) send('emote', { id })
}
export const localSessionId = () => net.room?.sessionId ?? ''

// --- Boards: Bloxity's own when the game server has none ----------------------------------------
// Offline, or before the server's first list, the hub boards show Bloxity's leaderboards (the server
// reports them: backend boxity.ts). With no server connection the browser submits the player's scores
// itself (docs: "Otherwise submit from the browser").
let boardsFromServer = false
const submitted = {}
async function refreshSdkBoards() {
  if (boardsFromServer) return
  let changed = false
  for (const l of BOARD_LINKS) {
    const rows = await topRows(l.bloxity, 10)
    if (!rows?.length || boardsFromServer) continue
    net.leaderboard[l.stat] = rows.map((r) => ({ name: r.name, value: r.value * (l.bloxityUnit || 1) }))
    changed = true
  }
  if (changed) for (const fn of boardListeners) fn(net.leaderboard)
}
function submitSdkScores() {
  if (net.connected || !authState.user) return
  for (const l of BOARD_LINKS) {
    const v = Math.floor(Number(state[l.stat]) / (l.bloxityUnit || 1))
    if (!(v > 0) || submitted[l.bloxity] === v) continue
    submitted[l.bloxity] = v
    submitScore(l.bloxity, v)
  }
}

export function initNet() {
  // The look changes in Bloxity's customizer or the portal: relay it right away.
  onAvatarChanged(() => syncAvatar())
  onProportionsChanged(() => syncAvatar())
  // Hub boards without the game server, and the browser's own score submits meanwhile.
  setInterval(() => {
    refreshSdkBoards()
    submitSdkScores()
  }, NET.boardsEvery * 1000)
  refreshSdkBoards()
  if (!hasServer()) return console.info('[net] no server configured; progress is saved in this browser only')
  onChange((kind) => {
    if (kind !== 'tick') scheduleSave() // 'tick' is the 5 s board refresh: the interval below covers it
    syncLoadout()
  })
  // Playtime and the timers change without an event: push them now and then.
  setInterval(() => scheduleSave(), NET.saveEvery * 1000)
  // The first ready call connects; later ones are sign-in / sign-out.
  subscribeAuth((s) => {
    if (!s.ready) return
    if (!net.connected) return void connect()
    const id = identity()
    if (idKey(id) === sentId) {
      send('identify', id) // the same account: the server re-verifies the token and refreshes name / picture
      return syncAvatar()
    }
    saveNow() // under the old id, before switching
    net.hydrated = false
    sentId = idKey(id)
    send('identify', id)
    syncAvatar()
  })
  window.addEventListener('beforeunload', saveNow)
  document.addEventListener('visibilitychange', () => document.hidden && saveNow())
}
