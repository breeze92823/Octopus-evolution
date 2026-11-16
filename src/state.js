// The player's progress and every derived number (XP curve, level cap, arms,
// damage, HP, prices, stage rewards and bandit stats). One mutable `state`
// object; anything that changes it calls emit(kind) so the HUD and the world
// can react. Saved to localStorage (debounced) until the server save is wired
// back in (see the backend's saveProgress contract).
import { BOOSTS, COMBAT, HUB_BOSS, PROGRESSION as P, SAVE_KEY, STAGES, TENTACLES, ZONES } from './config.js'

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
})

function load() {
  const base = fresh()
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw)
    for (const k of Object.keys(base)) if (saved[k] !== undefined && typeof saved[k] === typeof base[k]) base[k] = saved[k]
    base.owned = base.owned.filter((id) => TENTACLES.some((t) => t.id === id))
    if (!base.owned.includes('reef')) base.owned.unshift('reef')
    if (!base.owned.includes(base.equipped)) base.equipped = 'reef'
    base.level = Math.max(1, Math.min(base.level, levelCap(base.rebirths)))
  } catch {
    // Storage blocked or corrupt: a fresh start.
  }
  return base
}

export const state = load()

// --- Change events ------------------------------------------------------------------
// kinds: 'wins' | 'xp' | 'level' | 'rebirth' | 'tentacle' | 'boost' | 'stage' | 'zone'
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
export const octoScale = (L) => 1 + P.sizeK * Math.log2(1 + L / 10)
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
  const train = state.train2x > 0 ? 2 : 1
  return Math.max(1, Math.round(equippedTentacle().xp * zone.mult * rebirthBoost() * train))
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
  const amount = Math.round(n * (boosted && state.wins2x ? 2 : 1))
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
export const skipBossPrice = () => Math.max(8, Math.ceil(hubBossReward() * BOOSTS.skipBoss))

// Dev: wipe the save (console: __game.reset()).
export function resetProgress() {
  Object.assign(state, fresh())
  emit('rebirth')
  emit('tentacle', equippedTentacle())
  emit('wins', 0)
  emit('xp')
  emit('level', 0)
  emit('stage', 0)
}
