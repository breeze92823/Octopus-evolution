// The player's progress and every derived number (XP curve, level cap, arms,
// damage, HP, prices, stage rewards and bandit stats). One mutable `state`
// object; anything that changes it calls emit(kind) so the HUD and the world
// can react. The server (net.js -> backend saveProgress) holds the real save; localStorage
// (debounced) is the offline / guest fallback and the first paint before the server answers.
import { ASCEND, BOOSTS, COMBAT, HUB_BOSS, ITEMS, PROGRESSION as P, REBIRTH, SAVE_KEY, STAGES, TENTACLES, TITLES, TRAILS, ZONES } from './config.js'

const fresh = () => ({
  wins: 0,
  level: 1,
  xp: 0,
  rebirths: 0,
  owned: ['reef'],
  equipped: 'reef',
  zonesBought: [], // ids of the premium (Wins-priced) zones bought
  bestStage: 0, // highest stage cleared
  totalWins: 0,
  playtime: 0, // s
  train2x: 0, // s left on the x2 Train potion
  wins2x: false,
  starter: false,
  bossTimer: HUB_BOSS.every, // s until the hub boss drops
  items: Object.fromEntries(ITEMS.map((d) => [d.id, 0])), // boosts held (My Items), by ITEMS id
  wins2xT: 0, // s left on the x2 Wins boost (item)
  dmg2xT: 0, // s left on the x2 Damage boost (item)
  speedT: 0, // s left on the Speed boost (item)
  titles: [], // earned TITLES ids
  title: '', // the equipped title ('' = none)
  titlesSeen: [], // earned titles already looked at (the rest light the "!" badge)
  trails: [], // owned TRAILS ids
  trail: '', // the equipped trail ('' = none)
  ascend: 0, // Ascend tier
  stats: {}, // title counters: kills, bosses, giants, throws, hits, boosts, dailies, gifts, z_<zone>
})

// Merges a saved object (localStorage or the server's doc) into `base`: only known keys of the
// right type, then repairs anything the catalogs no longer allow.
function merge(base, saved) {
  for (const k of Object.keys(base)) {
    const v = saved[k]
    if (v !== undefined && typeof v === typeof base[k] && Array.isArray(v) === Array.isArray(base[k])) base[k] = v
  }
  base.owned = base.owned.filter((id) => TENTACLES.some((t) => t.id === id))
  if (!base.owned.includes('reef')) base.owned.unshift('reef')
  if (!base.owned.includes(base.equipped)) base.equipped = 'reef'
  base.zonesBought = base.zonesBought.filter((id) => ZONES.some((z) => z.id === id && z.price))
  // (levelCap() is defined below and this runs while the module loads, so the cap is spelled out.)
  base.level = Math.max(1, Math.min(base.level, P.capBase + P.capPerRebirth * base.rebirths))
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  base.items = Object.fromEntries(ITEMS.map((d) => [d.id, Math.floor(num(base.items?.[d.id]))]))
  base.stats = Object.fromEntries(Object.entries(base.stats ?? {}).filter(([, v]) => num(v) > 0))
  base.titles = base.titles.filter((id) => TITLES.some((t) => t.id === id))
  base.titlesSeen = base.titlesSeen.filter((id) => base.titles.includes(id))
  if (!base.titles.includes(base.title)) base.title = ''
  base.trails = base.trails.filter((id) => TRAILS.some((t) => t.id === id))
  if (!base.trails.includes(base.trail)) base.trail = ''
  base.ascend = Math.max(0, Math.min(ASCEND.maxTier, Math.floor(num(base.ascend))))
  return base
}

function load() {
  const base = fresh()
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) merge(base, JSON.parse(raw))
  } catch {
    // Storage blocked or corrupt: a fresh start.
  }
  return base
}

export const state = load()

// The keys the server persists (backend src/sanitize.ts): the whole progress object, as is.
export const SAVED_KEYS = Object.keys(fresh())
export const snapshot = () => Object.fromEntries(SAVED_KEYS.map((k) => [k, state[k]]))

// Replaces the progress with the server's saved doc (net.js, once the load answers) and tells the
// HUD, the world and the windows. The level event is left out on purpose: it plays the level-up
// fanfare, and 'rebirth' already refreshes arms, zones and the level UI.
export function hydrate(doc) {
  Object.assign(state, merge(fresh(), doc))
  emit('rebirth')
  emit('tentacle', equippedTentacle())
  emit('zone')
  emit('boost')
  emit('wins', 0)
  emit('xp')
  emit('stage', state.bestStage)
  emit('items')
  emit('title')
  emit('trail')
  emit('ascend')
}

// --- Change events ------------------------------------------------------------------
// kinds: 'wins' | 'xp' | 'level' | 'rebirth' | 'tentacle' | 'boost' | 'stage' | 'zone' | 'items' |
// 'title' | 'trail' | 'ascend' | 'stats' | 'tick'
const listeners = new Set()
export function onChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let saveTimer = 0
export function emit(kind, detail) {
  for (const fn of listeners) fn(kind, detail)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 600)
}
export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  } catch {
    // Storage blocked: this session only.
  }
}
window.addEventListener('pagehide', save)

// --- Formatting ------------------------------------------------------------------------
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
export function fmt(n) {
  n = Math.floor(n)
  if (Math.abs(n) < 10000) return n.toLocaleString('en-US')
  let i = 0
  let v = n
  while (Math.abs(v) >= 1000 && i < SUFFIX.length - 1) {
    v /= 1000
    i++
  }
  return `${v < 100 ? v.toFixed(1).replace(/\.0$/, '') : Math.floor(v)}${SUFFIX[i]}`
}
export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

// --- Level curve --------------------------------------------------------------------------
export const xpNeed = (L) => Math.floor(P.xpBase * Math.pow(P.xpGrowth, L - 1) + P.xpLinear * L)
export const levelCap = (r = state.rebirths) => P.capBase + P.capPerRebirth * r
export const atCap = () => state.level >= levelCap()
export const rebirthBoost = (r = state.rebirths) => 1 + P.rebirthBoost * r

export function armsFor(L) {
  let arms = P.arms[0][1]
  for (const [lv, n] of P.arms) if (L >= lv) arms = n
  return arms
}
// The level that grants the next arm, or null at the last one.
export function nextArmLevel(L) {
  for (const [lv] of P.arms) if (lv > L) return lv
  return null
}
export const damageFor = (L) => P.dmgBase * Math.pow(P.dmgGrowth, L - 1)
export const maxHpFor = (L) => P.hpBase * Math.pow(P.hpGrowth, L - 1)
export const octoScale = (L) => (1 + P.sizeK * Math.log2(1 + L / 10)) * (1 + ASCEND.sizePerTier * state.ascend)
export const reachFor = (L) => COMBAT.reach * octoScale(L)

// --- Tentacles ---------------------------------------------------------------------------------
export const tentacleById = (id) => TENTACLES.find((t) => t.id === id) ?? TENTACLES[0]
export const equippedTentacle = () => tentacleById(state.equipped)
export const owns = (id) => state.owned.includes(id)

export function buyTentacle(id) {
  const def = tentacleById(id)
  if (owns(id)) return equipTentacle(id)
  if (!spendWins(def.price)) return false
  state.owned.push(id)
  state.equipped = id
  emit('tentacle', def)
  return true
}
export function equipTentacle(id) {
  if (!owns(id) || state.equipped === id) return false
  state.equipped = id
  emit('tentacle', tentacleById(id))
  return true
}

// --- Training -------------------------------------------------------------------------------------
export const zoneById = (id) => ZONES.find((z) => z.id === id)
export function zoneUnlocked(zone) {
  if (zone.price) return state.zonesBought.includes(zone.id)
  return state.rebirths >= (zone.rebirths ?? 0)
}
export function buyZone(zone) {
  if (!zone.price || zoneUnlocked(zone)) return false
  if (!spendWins(zone.price)) return false
  state.zonesBought.push(zone.id)
  emit('zone', zone)
  return true
}
export function xpPerHit(zone) {
  return Math.max(1, Math.round(equippedTentacle().xp * zone.mult * rebirthBoost() * trainMult()))
}

// Adds XP, levelling up as far as the cap allows. Returns levels gained.
export function addXp(n) {
  if (atCap()) {
    state.xp = Math.min(state.xp, xpNeed(state.level))
    return 0
  }
  state.xp += n
  let gained = 0
  const cap = levelCap()
  while (state.level < cap && state.xp >= xpNeed(state.level)) {
    state.xp -= xpNeed(state.level)
    state.level++
    gained++
  }
  if (state.level >= cap) state.xp = Math.min(state.xp, xpNeed(state.level))
  emit('xp')
  if (gained) emit('level', gained)
  return gained
}

export function addLevels(n) {
  const before = state.level
  state.level = Math.min(levelCap(), state.level + n)
  if (state.level >= levelCap()) state.xp = 0
  const gained = state.level - before
  emit('xp')
  if (gained) emit('level', gained)
  return gained
}

// --- Wins -------------------------------------------------------------------------------------------
export function addWins(n, { boosted = true } = {}) {
  const amount = Math.round(n * (boosted ? winsMult() : 1))
  state.wins += amount
  state.totalWins += amount
  emit('wins', amount)
  return amount
}
export function spendWins(n) {
  n = Math.ceil(n)
  if (state.wins < n) return false
  state.wins -= n
  emit('wins', -n)
  return true
}

// --- Rebirth ------------------------------------------------------------------------------------------
export const canRebirth = () => atCap()
export function doRebirth() {
  if (!canRebirth()) return false
  state.rebirths++
  state.level = 1
  state.xp = 0
  emit('rebirth')
  emit('xp')
  emit('level', 0)
  return true
}

// --- Shop prices (Wins) ---------------------------------------------------------------------------------
export function levelPackPrice(pack) {
  return Math.ceil(pack.n * BOOSTS.levelPriceBase * Math.pow(BOOSTS.levelPriceGrowth, state.level - 1) * pack.discount)
}
export function buyLevels(pack) {
  if (atCap()) return false
  if (!spendWins(levelPackPrice(pack))) return false
  addLevels(pack.n)
  return true
}
export function buyTrain2x() {
  if (!spendWins(BOOSTS.train2x.price)) return false
  state.train2x += BOOSTS.train2x.minutes * 60
  emit('boost', 'train2x')
  return true
}
export function buyWins2x() {
  if (state.wins2x || !spendWins(BOOSTS.wins2x.price)) return false
  state.wins2x = true
  emit('boost', 'wins2x')
  return true
}
export function buyStarter() {
  const S = BOOSTS.starter
  if (state.starter || !spendWins(S.price)) return false
  state.starter = true
  if (!owns(S.tentacle)) state.owned.push(S.tentacle)
  state.equipped = S.tentacle
  state.train2x += S.trainMinutes * 60
  emit('tentacle', tentacleById(S.tentacle))
  emit('boost', 'starter')
  addLevels(S.levels)
  return true
}

// --- Stages -------------------------------------------------------------------------------------------------
export const isBossStage = (s) => s % STAGES.bossEvery === 0
export const stageRec = (s) => STAGES.rec[Math.min(s, STAGES.count) - 1]
export function stageWins(s) {
  const base = STAGES.winsBase * Math.pow(STAGES.winsGrowth, s - 1)
  return Math.round(base * (isBossStage(s) ? STAGES.bossWinsMult : 1))
}
export const stageXp = (s) => Math.round(xpNeed(stageRec(s)) * STAGES.xpPadLevels * rebirthBoost())
export function stageBanditCount(s) {
  return Math.min(STAGES.countMax, STAGES.count0 + Math.floor((s - 1) / STAGES.countEvery))
}
// Bandit stats for stage s: { hp, hit } (+ boss stats on boss stages).
export function banditStats(s) {
  const rec = stageRec(s)
  const hp = damageFor(rec) * (STAGES.hitsToKill[0] + STAGES.hitsToKill[1] * s)
  const hit = maxHpFor(rec) * (STAGES.enemyHit[0] + STAGES.enemyHit[1] * s)
  return { hp, hit, bossHp: hp * STAGES.bossHp, bossHit: hit * STAGES.bossHit }
}
export const bossName = (s) => STAGES.bosses[Math.min(STAGES.bosses.length, Math.floor(s / STAGES.bossEvery)) - 1] ?? STAGES.bosses[0]
export const revivePrice = (s) => Math.max(3, Math.ceil(stageWins(s) * BOOSTS.revive))
export const revengePrice = (s) => Math.max(10, Math.ceil(stageWins(s) * BOOSTS.revenge))

export function clearStage(s) {
  if (s > state.bestStage) {
    state.bestStage = s
    emit('stage', s)
  }
}

// --- Hub boss -----------------------------------------------------------------------------------------------------
export const hubBossReward = () => Math.max(HUB_BOSS.minWins, Math.round(stageWins(Math.max(1, state.bestStage)) * HUB_BOSS.winsMult))

// Dev: wipe the save (console: __game.reset()).
export function resetProgress() {
  Object.assign(state, fresh())
  emit('rebirth')
  emit('tentacle', equippedTentacle())
  emit('wins', 0)
  emit('xp')
  emit('level', 0)
  emit('stage', 0)
  emit('items')
  emit('title')
  emit('trail')
  emit('ascend')
}

// --- Boosts: items, timers and the multipliers they (and the equipped title) give --------------------
export const itemDef = (id) => ITEMS.find((d) => d.id === id)
export const itemCount = () => ITEMS.reduce((n, d) => n + (state.items[d.id] ?? 0), 0)
export function addItem(id, n = 1) {
  if (!itemDef(id) || n <= 0) return false
  state.items[id] = (state.items[id] ?? 0) + n
  emit('items', id)
  return true
}
// Uses one held boost: its timer gains the item's minutes (they stack).
export function useItem(id) {
  const def = itemDef(id)
  if (!def || !(state.items[id] > 0)) return false
  state.items[id]--
  state[def.timer] = (state[def.timer] ?? 0) + def.minutes * 60
  bumpStat('boosts')
  emit('items', id)
  emit('boost', id)
  return true
}
// s left on an item's boost.
export const boostLeft = (id) => state[itemDef(id)?.timer] ?? 0
// Counts the item timers down (main loop). train2x is counted by main.js (it has its own toast).
export function tickBoosts(dt) {
  for (const def of ITEMS) {
    if (def.timer === 'train2x' || !(state[def.timer] > 0)) continue
    state[def.timer] = Math.max(0, state[def.timer] - dt)
    if (state[def.timer] === 0) emit('boost', def.id)
  }
}

export const titleDef = (id) => TITLES.find((t) => t.id === id)
export const equippedTitle = () => titleDef(state.title) ?? null
// The equipped title's bonus for 'train' | 'damage' | 'wins', as a fraction.
export function titleBonus(kind) {
  const t = equippedTitle()
  return t && t.bonus === kind ? t.pct / 100 : 0
}
export const trainMult = () => (state.train2x > 0 ? 2 : 1) * (1 + titleBonus('train'))
export const winsMult = () => (state.wins2x ? 2 : 1) * (state.wins2xT > 0 ? 2 : 1) * (1 + titleBonus('wins'))
export const ascendDamage = (t = state.ascend) => 1 + ASCEND.dmgPerTier * t
export const damageMult = () => (state.dmg2xT > 0 ? 2 : 1) * ascendDamage() * (1 + titleBonus('damage'))
export const speedMult = () => (state.speedT > 0 ? itemDef('speed').mult : 1) * (1 + ASCEND.speedPerTier * state.ascend)
// What the player's tentacles hit for (slaps; throws multiply it).
export const playerDamage = (L = state.level) => damageFor(L) * damageMult()

// --- Stats (title counters) ------------------------------------------------------------------------
export function bumpStat(key, n = 1) {
  state.stats[key] = (state.stats[key] ?? 0) + n
  emit('stats', key)
}

// --- Titles --------------------------------------------------------------------------------------------
// The current value of a title goal's stat.
export function statValue(key) {
  if (key === 'arms') return armsFor(state.level)
  if (key === 'skins') return state.owned.length
  if (key === 'trails') return state.trails.length
  if (key in state && typeof state[key] === 'number') return state[key]
  return state.stats[key] ?? 0
}
// [value, goal] for a title's progress bar.
export function titleProgress(def) {
  return [Math.min(statValue(def.goal[0]), def.goal[1]), def.goal[1]]
}
export const ownsTitle = (id) => state.titles.includes(id)
// Grants every title whose goal is met. Returns the newly earned defs.
export function checkTitles() {
  const earned = []
  for (const def of TITLES) {
    if (ownsTitle(def.id)) continue
    if (statValue(def.goal[0]) >= def.goal[1]) {
      state.titles.push(def.id)
      earned.push(def)
    }
  }
  if (earned.length) emit('title', earned)
  return earned
}
export const unseenTitles = () => state.titles.filter((id) => !state.titlesSeen.includes(id))
export function markTitlesSeen() {
  if (!unseenTitles().length) return
  state.titlesSeen = [...state.titles]
  emit('title')
}
// Equips an earned title, or takes it off when it is already on.
export function toggleTitle(id) {
  if (!ownsTitle(id)) return false
  state.title = state.title === id ? '' : id
  emit('title')
  return true
}

// --- Trails --------------------------------------------------------------------------------------------
export const trailDef = (id) => TRAILS.find((t) => t.id === id)
export const equippedTrail = () => trailDef(state.trail) ?? null
export const ownsTrail = (id) => state.trails.includes(id)
export function buyTrail(id) {
  const def = trailDef(id)
  if (!def || ownsTrail(id)) return false
  if (!spendWins(def.price)) return false
  state.trails.push(id)
  state.trail = id
  emit('trail', def)
  return true
}
// Equips an owned trail, or takes it off when it is already on.
export function toggleTrail(id) {
  if (!ownsTrail(id)) return false
  state.trail = state.trail === id ? '' : id
  emit('trail')
  return true
}

// --- Skip Rebirth: rebirth at max level and KEEP the levels (paid in Wins) ------------------------------
// What the levels you keep would cost as level packs right now, x REBIRTH.skipMult (min skipMin).
export function skipRebirthPrice() {
  let sum = 0
  for (let L = 1; L < state.level; L++) sum += REBIRTH.levelBase * Math.pow(BOOSTS.levelPriceGrowth, L - 1)
  return Math.max(REBIRTH.skipMin, Math.ceil(sum * REBIRTH.skipMult))
}
export function doSkipRebirth() {
  if (!canRebirth()) return false
  if (!spendWins(skipRebirthPrice())) return false
  state.rebirths++
  state.xp = 0
  emit('rebirth')
  emit('xp')
  return true
}

// --- Ascend --------------------------------------------------------------------------------------------
export const ascendCost = (t = state.ascend) => Math.round(ASCEND.baseCost * Math.pow(ASCEND.costGrowth, t))
export const ascendSkipPrice = (t = state.ascend) => Math.ceil(ascendCost(t) * ASCEND.skipMult)
export const maxAscend = () => state.ascend >= ASCEND.maxTier
export const canAscend = () => !maxAscend() && state.wins >= ascendCost()
// Ascend: needs ascendCost() Wins and resets the Wins to 0. skip: pay ascendSkipPrice() instead and keep
// the rest. Either way the tier goes up by one.
export function doAscend(skip = false) {
  if (maxAscend()) return false
  if (skip) {
    if (!spendWins(ascendSkipPrice())) return false
  } else {
    if (state.wins < ascendCost()) return false
    const lost = state.wins
    state.wins = 0
    emit('wins', -lost)
  }
  state.ascend++
  emit('ascend', state.ascend)
  return true
}
