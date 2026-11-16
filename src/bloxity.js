// The Bloxity (Legion) SDK facade. Every SDK call goes through here. Nothing
// here may throw when the SDK is missing: a blocked sdk.bloxity.io leaves the
// game fully playable on the default avatar and keyboard controls.
// Docs: https://docs.bloxity.io/#html5
import { ADS, BLOXITY_BOARDS, GAME_SLUG, GAME_TITLE, SETTINGS, DEV_MODE, coerceSetting } from './config.js'

export function sdk() {
  if (DEV_MODE) return null
  return (typeof window !== 'undefined' && window.Legion && window.Legion.SDK) || null
}

// --- State --------------------------------------------------------------
export const settings = {}
for (const key of Object.keys(SETTINGS)) settings[key] = coerceSetting(key, SETTINGS[key].def)

// `user` is only written from onUserChanged (re-reading getUser()). `ready`
// flips once auth has settled so the signed-in avatar load isn't pre-empted.
export const authState = { ready: false, user: null, guest: null }

let latestEquipped = null
let latestProportions = null
const avatarListeners = new Set()
const proportionListeners = new Set()
const authListeners = new Set()
const settingListeners = new Set()
const respawnListeners = new Set()
const unsubscribers = []

function emit(listeners, ...args) {
  for (const fn of listeners) {
    try {
      fn(...args)
    } catch (err) {
      console.warn('[bloxity] listener threw', err)
    }
  }
}

// Fires on any customizer change (may fire twice: optimistic, then confirmed;
// keep handlers idempotent). Each returns an unsubscribe.
export function onAvatarChanged(fn) {
  avatarListeners.add(fn)
  return () => avatarListeners.delete(fn)
}
export function onProportionsChanged(fn) {
  proportionListeners.add(fn)
  return () => proportionListeners.delete(fn)
}
export function subscribeAuth(fn) {
  authListeners.add(fn)
  fn(authState)
  return () => authListeners.delete(fn)
}
// fn(key, value) on every change of a SETTINGS key (already coerced).
export function onSetting(fn) {
  settingListeners.add(fn)
  return () => settingListeners.delete(fn)
}
// The portal's own pause-menu "Respawn" button.
export function onRespawnRequest(fn) {
  respawnListeners.add(fn)
  return () => respawnListeners.delete(fn)
}

// --- Auth ---------------------------------------------------------------
// The SDK fires onUserChanged immediately with a null user, then again once the
// portal handshake answers; a null user only settles auth after a grace period.
const GUEST_SETTLE_MS = 2500
let settleTimer = null

function settleAuth() {
  settleTimer = null
  if (authState.ready) return
  authState.ready = true
  emit(authListeners, authState)
}

function onUser() {
  const SDK = sdk()
  const user = SDK ? SDK.auth.getUser() : null
  latestEquipped = null // a different account's equip event must not linger
  latestProportions = null

  if (user || authState.ready) {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = null
    authState.ready = true
  } else if (!settleTimer) {
    settleTimer = setTimeout(settleAuth, GUEST_SETTLE_MS)
  }
  authState.user = user
  try {
    authState.guest = user || typeof SDK.auth.getGuest !== 'function' ? null : SDK.auth.getGuest()
  } catch {
    authState.guest = null
  }
  emit(authListeners, authState)
}

// Name for the HUD badge.
export function displayName() {
  const u = authState.user
  if (u) return u.displayName || u.username || u.name || 'Player'
  const g = authState.guest
  if (g) return g.displayName || g.username || g.name || 'Guest'
  return sdk() ? 'Guest' : 'Offline'
}

// The player's Bloxity profile picture (user, else the guest's derived one) as an absolute
// http(s) URL, '' when there is none. Relative paths resolve against the CDN (staticUrl).
export function getPfp() {
  const raw = authState.user?.pfp || authState.guest?.pfp
  if (typeof raw !== 'string' || !raw) return ''
  try {
    let base = 'https://static.bloxity.io'
    try {
      base = sdk()?.environment?.()?.staticUrl || base
    } catch {
      // Older SDK builds have no environment().
    }
    const url = new URL(raw, base)
    return /^https?:$/.test(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

// --- Init ---------------------------------------------------------------
let initialised = false

export function init() {
  if (initialised) return
  initialised = true

  const SDK = sdk()
  if (!SDK) {
    if (DEV_MODE) console.info('[bloxity] VITE_DEV_MODE=true: skipping SDK/CDN, running on the default avatar')
    else console.info('[bloxity] SDK not loaded: running offline on the default avatar')
    authState.ready = true
    emit(authListeners, authState)
    return
  }

  try {
    const onLocalhost = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    SDK.init(onLocalhost ? { gameSlug: GAME_SLUG, portalUrl: 'https://bloxity.io' } : { gameSlug: GAME_SLUG })
    SDK.game.loadingStep(`Loading ${GAME_TITLE}`)

    for (const key of Object.keys(SETTINGS)) {
      const off = SDK.settings.listen(key, (raw) => {
        const next = coerceSetting(key, raw)
        if (settings[key] === next) return
        settings[key] = next
        emit(settingListeners, key, next)
      })
      if (typeof off === 'function') unsubscribers.push(off)
    }
    SDK.settings.triggerAll?.()

    unsubscribers.push(SDK.auth.onUserChanged(onUser))

    if (typeof SDK.avatar?.onAvatarChanged === 'function') {
      unsubscribers.push(
        SDK.avatar.onAvatarChanged((equipped) => {
          // The event payload wins over getEquipped(), which can lag the event.
          if (equipped && typeof equipped === 'object') latestEquipped = equipped
          emit(avatarListeners)
        }),
      )
    }
    if (typeof SDK.avatar?.onProportionsChanged === 'function') {
      unsubscribers.push(
        SDK.avatar.onProportionsChanged((proportions) => {
          if (proportions && typeof proportions === 'object') latestProportions = proportions
          emit(proportionListeners)
        }),
      )
    }

    unsubscribers.push(
      SDK.player.onEvent((event, data) => {
        if (event === 'respawn_request') emit(respawnListeners)
        else if (event === 'play_emote') emit(emoteListeners, String(data ?? ''))
        else if (event === 'stop_emote') emit(emoteListeners, '')
      }),
    )

    // Boards and ad screens are declared once, right after init; the rest are push events.
    try {
      SDK.leaderboard?.define?.(BLOXITY_BOARDS)
      SDK.ads?.declareScreens?.(ADS.screens)
    } catch (err) {
      console.warn('[bloxity] declaring boards / ad screens failed', err)
    }
    wireFeatures(SDK)

    SDK.game.loadingStep('Building the island')
  } catch (err) {
    console.warn('[bloxity] init failed; running without the SDK', err)
    authState.ready = true
    emit(authListeners, authState)
  }
}

export function loadingStep(text) {
  try {
    sdk()?.game.loadingStep(text)
  } catch {
    // Non-fatal.
  }
}

let announcedFirstFrame = false

// Call once the scene has rendered: tells the portal loading is done.
export function notifyFirstFrame() {
  if (announcedFirstFrame) return
  announcedFirstFrame = true
  const SDK = sdk()
  if (!SDK) return
  try {
    SDK.game.loadingEnd()
    SDK.game.gameplayStart()
  } catch {
    // Non-fatal.
  }
}

export function teardown() {
  for (const off of unsubscribers.splice(0)) {
    try {
      off()
    } catch {
      // Tearing down anyway.
    }
  }
  try {
    sdk()?.game.gameplayEnd()
  } catch {
    // Non-fatal.
  }
}

// --- Avatar accessors (null when the SDK is unavailable or the call throws) ---
export function getEquippedAvatar() {
  if (latestEquipped) return latestEquipped
  try {
    return sdk()?.avatar.getEquipped() ?? null
  } catch {
    return null
  }
}

// { height, shoulderWidth, armLength, legOffsetX, torsoScaleX, neckHeight,
// headScale }, normalised around 1.0; loader.js applyProportions() consumes it.
export function getProportions() {
  try {
    const current = sdk()?.avatar.getProportions()
    return latestProportions ? { ...current, ...latestProportions } : current ?? null
  } catch {
    return latestProportions
  }
}

// Skin texture URL with the worn face, shirt and pants already drawn on.
export function getSkinTextureUrl() {
  try {
    const url = sdk()?.avatar?.getSkinTextureUrl?.()
    return typeof url === 'string' && url ? url : null
  } catch {
    return null
  }
}

export const canCustomize = () => typeof sdk()?.avatar?.toggleCustomizer === 'function'

// Opens / closes the portal's avatar editor; edits come back through onAvatarChanged.
export function toggleCustomizer() {
  try {
    sdk()?.avatar.toggleCustomizer()
  } catch {
    // Ignore.
  }
}

// --- Game server ------------------------------------------------------
// Bloxity hosting has no fixed socket URL: the matchmaker picks a pod with room (or wakes one) and
// the SDK returns its endpoint (the dev channel reaches the dev backend, prod the prod one). Each
// endpoint is pinned to one pod, so net.js builds a new Client per resolve.
export function canResolveServer() {
  try {
    return typeof sdk()?.net?.resolveEndpoint === 'function'
  } catch {
    return false
  }
}
// { endpoint, relayRoomId }: relayRoomId is the matchmaker relay pinning the pod (the endpoint is
// {playUrl}/v1/ws/<relayRoomId>). Rejects (net.js retries with backoff) when the matchmaker can't answer.
export async function resolveServerEndpoint(userId) {
  const { endpoint, roomId, cold } = await sdk().net.resolveEndpoint(GAME_SLUG, userId ? { userId } : undefined)
  if (cold) console.info('[net] waking up a server...')
  return { endpoint, relayRoomId: roomId }
}

// The ?roomId= the page was opened with: the game page's Open Rooms Join button (a bare Colyseus
// room id) or a friend invite (what updateRoom() reported: "<relayRoomId>~<colyseusRoomId>").
export function launchRoomId() {
  try {
    return new URLSearchParams(location.search).get('roomId') || ''
  } catch {
    return ''
  }
}

// Where a launch room lives: { endpoint, roomId, relayRoomId }, or null when it is gone, full or
// can't be found. A bare id needs the matchmaker's cross-pod directory (a plain joinById through
// any relay would usually land on another pod); a relay~room id is joined through its relay.
export async function locateRoom(id) {
  const playUrl = (() => {
    try {
      return sdk()?.environment?.()?.playUrl
    } catch {
      return '' // Older SDK builds have no environment().
    }
  })()
  if (!playUrl || !id) return null
  const base = playUrl.replace(/\/$/, '')
  const [relay, roomId] = id.includes('~') ? id.split('~', 2) : ['', id]
  if (relay) return { endpoint: `${base.replace(/^http/i, 'ws')}/v1/ws/${encodeURIComponent(relay)}`, roomId, relayRoomId: relay }
  const res = await fetch(`${base}/v1/dir/${encodeURIComponent(GAME_SLUG)}/list`)
  const rooms = res.ok ? (await res.json())?.rooms ?? [] : []
  const r = rooms.find((r) => r.colyseusRoomId === roomId && !r.locked && r.players < r.maxPlayers)
  return r ? { endpoint: r.joinUrl, roomId: r.colyseusRoomId, relayRoomId: r.relayRoomId } : null
}

// Reports the room this player is in ('' = not in a joinable room), so the portal's friend invites
// land in it.
export function updateRoom(roomId) {
  try {
    sdk()?.game?.updateRoom?.(roomId)
  } catch {
    // Ignore.
  }
}

// --- Portal -----------------------------------------------------------
export function showMenu() {
  try {
    sdk()?.portal.showMenu(true)
  } catch {
    // Ignore.
  }
}

// Where Boxity draws its own controls over the game: the toolbar in the top-left corner and
// the chat feed under it, as [{ id, left, top, width, height }] in CSS px. fn runs now and on
// every change (resize, toolbar change). Without the SDK (dev mode, blocked CDN) it gets the
// default footprint the SDK itself assumes until the portal reports, so the HUD is laid out
// the same everywhere. Returns an unsubscribe.
export function onReservedAreas(fn) {
  try {
    const off = sdk()?.ui?.onReservedAreasChange?.((areas) => fn(Array.isArray(areas) ? areas : []))
    if (typeof off === 'function') return off
  } catch {
    // Fall back to the estimate below.
  }
  const update = () => fn(estimatedReservedAreas(window.innerWidth, window.innerHeight))
  window.addEventListener('resize', update)
  update()
  return () => window.removeEventListener('resize', update)
}

// The SDK's estimate (legion-sdk ui.estimatedAreas): an 8 px margin round one row of buttons,
// the whole width on narrow phones, and the chat feed under it.
function estimatedReservedAreas(w, h) {
  const compact = w < 640 || h <= 500
  const toolbarHeight = 16 + (w < 640 ? 32 : w < 768 ? 40 : 44)
  const chatWidth = compact ? Math.min(w * 0.7, 260) : Math.min(w * 0.8, 360)
  return [
    { id: 'toolbar', left: 0, top: 0, width: Math.min(w, w < 480 ? w : 330), height: toolbarHeight },
    { id: 'chat', left: 0, top: toolbarHeight, width: Math.round(chatWidth + 8), height: compact ? 140 : 180 },
  ]
}

export function requestFullscreen(on) {
  try {
    const SDK = sdk()
    if (!SDK) return
    if (on) SDK.portal.requestFullscreen()
    else SDK.portal.exitFullscreen()
  } catch {
    // Ignore.
  }
}

// --- Environment ----------------------------------------------------------
// Boxity tells the game which environment it runs in (prod / stage / local); never work it out from
// the hostname. Older SDK builds have no environment(): the prod defaults apply.
export function environment() {
  try {
    return sdk()?.environment?.() ?? null
  } catch {
    return null
  }
}
export const apiUrl = () => (environment()?.apiUrl || 'https://api.bloxity.io').replace(/\/$/, '')
export const staticUrl = () => (environment()?.staticUrl || 'https://static.bloxity.io').replace(/\/$/, '')

// --- Identity for the game server ------------------------------------------------
// The server verifies this JWT with Boxity (backend auth.ts) and uses only the verified user id.
export function getToken() {
  try {
    return sdk()?.auth?.getToken?.() || null
  } catch {
    return null
  }
}

// --- Look ---------------------------------------------------------------------------
// The outfit key names the whole look (every slot, a custom character, the proportions) in one string.
export function getOutfitKey() {
  try {
    const key = sdk()?.avatar?.getOutfitKey?.()
    return typeof key === 'string' ? key : ''
  } catch {
    return ''
  }
}

// The same skin texture (worn pants, shirt and face drawn on) for ANOTHER player from their replicated ids.
export function getSkinTextureUrlFor(equipped) {
  try {
    const url = sdk()?.avatar?.getSkinTextureUrlFor?.(equipped)
    return typeof url === 'string' && url ? url : null
  } catch {
    return null
  }
}

// The platform character kit (Boxity dresses the player.glb rig in a whole look). Resolves null when the kit
// is off for this game, the SDK is older, or a custom character is worn: the manual path (avatar/loader.js)
// then runs. `THREE` and `GLTFLoader` are the game's own; `root` holds the rig's SkinnedMesh and bones.
export async function dressRig({ THREE, GLTFLoader, root, outfitKey }) {
  try {
    const kit = sdk()?.character
    if (!kit || !outfitKey || !kit.canDress?.(outfitKey)) return null
    // proportions: 'game' = avatar/loader.js applyProportions already shapes the bones every look change.
    return (await kit.dress({ THREE, GLTFLoader, root, outfitKey, proportions: 'game' })) ?? null
  } catch (err) {
    console.warn('[bloxity] character kit failed; using the manual avatar', err)
    return null
  }
}

// --- Leaderboards (Boxity draws the trophy button and the panel; the game never draws its own button) ---
// Declares the boards once, right after init. The first declaration creates a board; after that the
// Boxity dashboard owns its settings. The server reports the scores (backend boxity.ts); the browser
// only submits when there is no game server connection.
export function defineBoards(boards) {
  try {
    sdk()?.leaderboard?.define?.(boards)
  } catch (err) {
    console.warn('[bloxity] leaderboard.define failed', err)
  }
}
export async function submitScore(board, score) {
  try {
    return (await sdk()?.leaderboard?.submit?.(board, Math.floor(score))) ?? null
  } catch {
    return null
  }
}
// The top rows of a board as [{ rank, name, value }] ('all' = all time), or null without the SDK / on failure.
export async function topRows(board, limit = 10) {
  try {
    const lb = sdk()?.leaderboard
    if (!lb?.getTop) return null
    const standing = await lb.getTop(board, { period: 'all', limit })
    if (!standing || !Array.isArray(standing.rows)) return null
    return standing.rows.map((r) => ({ rank: r.rank, name: r.displayName || r.username || 'Player', value: Number(r.score) || 0 }))
  } catch {
    return null
  }
}
export function openLeaderboard(board) {
  try {
    return !!sdk()?.leaderboard?.open?.(board)
  } catch {
    return false
  }
}

// --- Ads (Boxity runs every ad; the game pauses and mutes in between) ---------------
const adBreakListeners = new Set()
// fn(true) when an ad starts over the game, fn(false) when it is over. Midrolls can start at any time.
export function onAdBreak(fn) {
  adBreakListeners.add(fn)
  return () => adBreakListeners.delete(fn)
}
export const adsAvailable = () => {
  try {
    return !!sdk()?.ads?.isAvailable?.()
  } catch {
    return false
  }
}
// Lists the game's screens once (menu, lobby, results, panel, gameplay), so Boxity can manage their banners.
export function declareAdScreens(screens) {
  try {
    sdk()?.ads?.declareScreens?.(screens)
  } catch {
    // Non-fatal.
  }
}
// Reports which screen is showing; Boxity draws its banners around it. Never throws.
export function adScreen(type, opts) {
  try {
    return sdk()?.ads?.screen?.(type, opts) ?? null
  } catch {
    return null
  }
}
// A rewarded video from a button. Resolves { status, rewardToken? }: grant only on 'completed'.
export async function showRewardedAd(placement) {
  try {
    if (!adsAvailable()) return { status: 'disabled' }
    return (await sdk().ads.showRewarded(placement)) ?? { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

// --- Death screen ---------------------------------------------------------------
// Boxity shows banners and runs a countdown (at least 4 s) while the player is dead. The game keeps its
// own death UI; its respawn control only works once respawn() returns true. null without the SDK (the
// game then respawns as it always did).
export function showDeathScreen() {
  try {
    const ds = sdk()?.deathScreen
    const death = ds?.show?.()
    if (!death) return null
    return {
      // fn(secondsLeft): 4, 3, 2, 1, then 0 = the player may respawn.
      onCountdown: (fn) => death.onCountdown(fn),
      // True (and the screen closes) when the player may respawn now; false while the countdown runs.
      respawn: () => !!death.respawn(),
      hide: () => {
        try {
          ds.hide()
        } catch {
          // Already closed.
        }
      },
    }
  } catch {
    return null
  }
}

// --- Emotes ---------------------------------------------------------------------------
// Boxity draws the emote button and wheel once the game has registered; the game plays the clip.
const emoteListeners = new Set()
// fn(id) when the player picks an emote, fn('') when they take it off.
export function onEmote(fn) {
  emoteListeners.add(fn)
  return () => emoteListeners.delete(fn)
}
let emoteCatalogue = null
// The catalogue { id -> { id, name, clip: { len, loop, tracks } } }, fetched once. Never hardcode ids: it grows.
export function loadEmotes() {
  emoteCatalogue ||= fetch(`${apiUrl()}/v1/avatar/emotes`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body) => new Map((body?.emotes ?? []).filter((e) => e?.id && e?.clip?.tracks).map((e) => [String(e.id), e])))
    .catch((err) => {
      console.warn('[bloxity] emote catalogue failed', err?.message ?? err)
      emoteCatalogue = null
      return new Map()
    })
  return emoteCatalogue
}

// --- Chat bubbles -------------------------------------------------------------------------
// Boxity owns chat; every message in the room reaches every player (the sender's own too). The game
// only draws the bubble over the sender's head. fn({ userId, username, text, isLocalPlayer, bubble }).
const chatListeners = new Set()
export function onChatMessage(fn) {
  chatListeners.add(fn)
  return () => chatListeners.delete(fn)
}
export const bubbleSeconds = () => {
  try {
    const s = sdk()?.chat?.bubbleSeconds
    return typeof s === 'number' && s > 0 ? s : 4
  } catch {
    return 4
  }
}

// --- Rooms and friends -----------------------------------------------------------------------
// Friend-join toasts: playerInRoom for the players already there, playerJoined for each newcomer.
export function playerInRoom(username) {
  try {
    if (username) sdk()?.game?.playerInRoom?.(username)
  } catch {
    // Ignore.
  }
}
export function playerJoined(username) {
  try {
    if (username) sdk()?.game?.playerJoined?.(username)
  } catch {
    // Ignore.
  }
}

// Wires the SDK's push events to the listener sets above. Called from init() once the SDK exists.
function wireFeatures(SDK) {
  // Boxity draws the emote button only over games that register, and only if registered right after init.
  try {
    SDK.game.registerFeature?.('emotes')
  } catch {
    // Non-fatal.
  }
  const sub = (off) => typeof off === 'function' && unsubscribers.push(off)
  try {
    sub(SDK.ads?.onBreakStart?.(() => emit(adBreakListeners, true)))
    sub(SDK.ads?.onBreakEnd?.(() => emit(adBreakListeners, false)))
  } catch {
    // Non-fatal.
  }
  try {
    sub(
      SDK.chat?.onMessage?.((m) => {
        if (!m || typeof m.text !== 'string') return
        let bubble = ''
        try {
          bubble = SDK.chat.bubbleText?.(m) ?? ''
        } catch {
          // Fall through to the plain text.
        }
        emit(chatListeners, { ...m, bubble: bubble || m.text.slice(0, 60) })
      }),
    )
  } catch {
    // Non-fatal.
  }
}
