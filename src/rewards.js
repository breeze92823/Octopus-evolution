// Daily Rewards (7-day streak calendar) and Playtime Rewards (10 gifts by minutes played).
//
// Signed-in players: the SERVER owns both (backend src/daily.ts + src/gifts.ts, on its own clock):
// it sends `daily` / `gifts` views after the load, a claim goes out as `claimDaily` { day } /
// `claimGift` { gift } and the reward is granted only once `dailyResult` / `giftResult` says ok.
// Guests and offline play run the same rules here, on this device's clock, saved in localStorage
// (DAILY.storageKey). Rewards: Wins (never boosted), levels, items (My Items boosts).
import { DAILY, PLAYTIME } from './config.js'
import { addItem, addLevels, addWins, atCap, bumpStat, fmt, itemDef } from './state.js'
import { onRoom, saveNow, sendNet } from './net.js'
import { ICONS } from './hud.js'
import { calendar, check, chest, fire, gift, itemIcon, plusLvl } from './icons.js'
import { button, createPanel, el, framedPanel, shakeNode } from './panels.js'
import { sfx } from './audio/index.js'

const DAYS = DAILY.days.length
const DAY_MS = 86_400_000
const utcDay = (ms) => Math.floor(ms / DAY_MS)

// --- Local (guest / offline) state ------------------------------------------------------------------
function loadLocal() {
  const base = { daily: { day: 0, last: -1, claimed: [], streak: 0 }, gifts: { time: 0, claimed: [] } }
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY.storageKey) || 'null')
    if (raw?.daily && Number.isInteger(raw.daily.day)) Object.assign(base.daily, raw.daily)
    if (raw?.gifts && Number.isFinite(raw.gifts.time)) Object.assign(base.gifts, raw.gifts)
  } catch {
    // Blocked or corrupt: start fresh.
  }
  return base
}
const local = loadLocal()
let saveTimer = 0
function saveLocal() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DAILY.storageKey, JSON.stringify(local))
    } catch {
      // Storage blocked: this session only.
    }
  }, 300)
}

// The streak rules (mirror of backend src/daily.ts rollDaily): one more day unlocks on each new UTC
// day if the player came back the very next day; a missed day starts the streak and calendar over.
function rollDaily(s, today) {
  if (s.last >= today) return false
  const next = s.last === today - 1 && s.day > 0
  if (!next) {
    s.day = 1
    s.claimed = []
    s.streak = 1
  } else {
    if (s.claimed.length >= DAYS) {
      s.day = 1
      s.claimed = []
    } else s.day = Math.min(DAYS, s.day + 1)
    s.streak++
  }
  s.last = today
  return true
}

// --- The views both modes feed -----------------------------------------------------------------------
// daily: { unlocked, claimed[], streak, nextAt (ms, this device's clock) }
// gifts: { time (s played at `at`), claimed[], at (performance.now() of that reading) }
const view = {
  dailyServer: false, // the server owns the daily state this session (signed in)
  giftsServer: false,
  daily: null,
  gifts: null,
}
const pending = { daily: new Set(), gifts: new Set() }

function localDailyView() {
  rollDaily(local.daily, utcDay(Date.now()))
  return { unlocked: local.daily.day, claimed: [...local.daily.claimed], streak: local.daily.streak, nextAt: (utcDay(Date.now()) + 1) * DAY_MS }
}
function useServerDaily(msg) {
  const offset = Date.now() - (msg.serverTime ?? Date.now()) // device clock - server clock
  view.daily = {
    unlocked: msg.unlocked | 0,
    claimed: Array.isArray(msg.claimed) ? msg.claimed : [],
    streak: msg.streak | 0,
    nextAt: (msg.nextAt ?? Date.now()) + offset,
  }
}
function useServerGifts(msg) {
  view.gifts = { time: Number(msg.time) || 0, claimed: Array.isArray(msg.claimed) ? msg.claimed : [], at: performance.now() }
}
const giftTime = () => (view.gifts ? view.gifts.time + (view.giftsServer ? (performance.now() - view.gifts.at) / 1000 : 0) : 0)

function refreshLocal() {
  if (!view.dailyServer) view.daily = localDailyView()
  if (!view.giftsServer) view.gifts = { time: local.gifts.time, claimed: [...local.gifts.claimed], at: performance.now() }
}
refreshLocal()

// Claimable counts (the HUD dots).
export function dailyReady() {
  const d = view.daily
  if (!d) return 0
  let n = 0
  for (let i = 0; i < d.unlocked; i++) if (!d.claimed.includes(i)) n++
  return n
}
export function giftsReady() {
  const t = giftTime()
  return PLAYTIME.gifts.filter((g, i) => !view.gifts?.claimed.includes(i) && t >= g.min * 60).length
}

// --- Granting ------------------------------------------------------------------------------------------
function grant(rewards) {
  const lines = []
  for (const r of rewards) {
    if (r.wins) {
      addWins(r.wins, { boosted: false })
      lines.push(`+${fmt(r.wins)} Wins`)
    } else if (r.levels) {
      const capped = atCap()
      addLevels(r.levels)
      lines.push(capped ? 'Max level!' : `+${r.levels} Lvl`)
    } else if (r.item) {
      addItem(r.item, r.n ?? 1)
      lines.push(`+${r.n ?? 1} ${itemDef(r.item).name}`)
    }
  }
  saveNow() // the server already recorded the claim: get the reward into the save right away
  return lines.join(' · ')
}

// --- Reward strip (icons + labels) ----------------------------------------------------------------------
function rewardChip(r) {
  if (r.wins) return `<div class="rw"><span class="ri">${ICONS.trophy}</span><b class="ol">+${fmt(r.wins)}</b></div>`
  if (r.levels) return `<div class="rw"><span class="ri">${plusLvl()}</span><b class="ol">+${r.levels} Lvl</b></div>`
  const def = itemDef(r.item)
  return `<div class="rw"><span class="ri">${itemIcon(def)}</span><b class="ol">+${r.n ?? 1}<br>${def.short ? `${def.short} ` : ''}${def.minutes}m</b></div>`
}
const strip = (rewards) => `<div class="pn-rewards n${rewards.length}">${rewards.map(rewardChip).join('')}</div>`
const art = (def) => (def.chest ? chest() : gift(def.gift, { gem: def.gem }))

function hms(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

// hooks: { toast(text), announce(title, sub, style), celebrate() }
export function createRewards(hooks) {
  // --- Claims ------------------------------------------------------------------------------------------
  function claimDaily(i, card) {
    const d = view.daily
    if (!d || i >= d.unlocked || d.claimed.includes(i) || pending.daily.has(i)) return shakeNode(card)
    if (view.dailyServer) {
      if (!sendNet('claimDaily', { day: i })) return hooks.toast('Reconnecting... try again in a moment')
      pending.daily.add(i)
      return daily.refresh()
    }
    local.daily.claimed.push(i)
    saveLocal()
    refreshLocal()
    onDailyClaimed(i)
  }
  function onDailyClaimed(i) {
    const def = DAILY.days[i]
    const txt = grant(def.rewards)
    bumpStat('dailies')
    sfx.purchase()
    hooks.celebrate?.()
    hooks.announce(`DAY ${i + 1} CLAIMED!`, txt, 'win')
    daily.refresh()
    updateDots()
  }
  function claimGift(i, card) {
    const g = PLAYTIME.gifts[i]
    if (view.gifts.claimed.includes(i) || pending.gifts.has(i) || giftTime() < g.min * 60) return shakeNode(card)
    if (view.giftsServer) {
      if (!sendNet('claimGift', { gift: i })) return hooks.toast('Reconnecting... try again in a moment')
      pending.gifts.add(i)
      return gifts.refresh()
    }
    local.gifts.claimed.push(i)
    if (local.gifts.claimed.length >= PLAYTIME.gifts.length) {
      // All ten claimed: the clock starts over (backend gifts.ts does the same).
      local.gifts.claimed = []
      local.gifts.time = 0
    }
    saveLocal()
    refreshLocal()
    onGiftClaimed(i)
  }
  function onGiftClaimed(i) {
    const g = PLAYTIME.gifts[i]
    const txt = grant(g.rewards)
    bumpStat('gifts')
    sfx.purchase()
    hooks.celebrate?.()
    hooks.announce(`${g.min} MIN GIFT!`, txt, 'win')
    gifts.refresh()
    updateDots()
  }

  // --- Server link -----------------------------------------------------------------------------------
  onRoom((room) => {
    room.onMessage('daily', (msg) => {
      view.dailyServer = !!msg?.persisted
      if (view.dailyServer) useServerDaily(msg)
      else refreshLocal()
      pending.daily.clear()
      daily.refresh()
      updateDots()
    })
    room.onMessage('dailyResult', (msg) => {
      const i = msg?.day
      pending.daily.delete(i)
      if (msg?.persisted) useServerDaily(msg)
      if (msg?.ok && Number.isInteger(i) && DAILY.days[i]) onDailyClaimed(i)
      else {
        if (msg?.reason === 'save') hooks.toast('Could not save the claim, try again')
        daily.refresh()
      }
    })
    room.onMessage('gifts', (msg) => {
      view.giftsServer = !!msg?.persisted
      if (view.giftsServer) useServerGifts(msg)
      else refreshLocal()
      pending.gifts.clear()
      gifts.refresh()
      updateDots()
    })
    room.onMessage('giftResult', (msg) => {
      const i = msg?.gift
      pending.gifts.delete(i)
      if (msg?.persisted) useServerGifts(msg)
      if (msg?.ok && Number.isInteger(i) && PLAYTIME.gifts[i]) onGiftClaimed(i)
      else {
        if (msg?.reason === 'early') hooks.toast('Not yet!')
        if (msg?.reason === 'save') hooks.toast('Could not save the claim, try again')
        gifts.refresh()
      }
    })
  })

  // --- Daily panel -------------------------------------------------------------------------------------
  const daily = createPanel({
    cls: 'pn-daily',
    render(root) {
      const { body } = framedPanel(root, { color: 'orange', icon: calendar(new Date().getDate()), title: 'Daily Rewards', onClose: () => daily.close() })
      const d = view.daily
      const streak = d?.streak ?? 0
      const allDone = d && d.claimed.length >= DAYS
      body.append(
        el('div', 'pn-streak', `<span class="fire">${fire()}</span><b class="ol">STREAK: ${streak} DAY${streak === 1 ? '' : 'S'}</b><small class="ol">${allDone ? 'Week complete! A new one starts tomorrow' : 'Miss a day and it starts over!'}</small>`),
      )
      const grid = el('div', 'pn-scroll pn-grid days')
      DAILY.days.forEach((def, i) => {
        const claimed = d?.claimed.includes(i)
        const open = d && i < d.unlocked && !claimed
        const next = d && i === d.unlocked && !allDone
        const card = el('div', `pn-card c-${def.color} ${def.chest ? 'wide' : ''} ${claimed ? 'claimed' : ''} ${open ? 'ready' : ''}`)
        card.style.animationDelay = `${i * 0.03}s`
        card.innerHTML = `<div class="studs"></div><div class="ghost">${art(def)}</div>
          <div class="pn-label ol">Day ${i + 1}</div>${def.tag ? `<div class="pn-tag ol">${def.tag}</div>` : ''}
          <div class="pn-art">${art(def)}${claimed ? `<span class="pn-check">${check()}</span>` : ''}</div>${strip(def.rewards)}`
        let label = 'LOCKED'
        let cls = 'locked'
        if (claimed) [label, cls] = ['CLAIMED', 'done']
        else if (pending.daily.has(i)) [label, cls] = ['...', 'wait']
        else if (open) [label, cls] = ['CLAIM!', 'go']
        else if (next) [label, cls] = [hms(d.nextAt - Date.now()), 'timer']
        const b = button(`pn-btn ol ${cls}`, label, () => (open ? claimDaily(i, card) : shakeNode(card)))
        if (cls === 'timer') b.dataset.timer = 'daily'
        card.append(b)
        grid.append(card)
      })
      body.append(grid)
    },
  })

  // --- Playtime panel ----------------------------------------------------------------------------------
  const gifts = createPanel({
    cls: 'pn-gifts',
    render(root) {
      const { body } = framedPanel(root, { color: 'orange', icon: gift(['#ff3b4a', '#ffc21a']), title: 'Playtime Rewards', onClose: () => gifts.close() })
      const grid = el('div', 'pn-scroll pn-grid gifts')
      const t = giftTime()
      PLAYTIME.gifts.forEach((def, i) => {
        const claimed = view.gifts?.claimed.includes(i)
        const ready = !claimed && t >= def.min * 60
        const card = el('div', `pn-card c-${def.color} ${claimed ? 'claimed' : ''} ${ready ? 'ready' : ''}`)
        card.style.animationDelay = `${i * 0.025}s`
        card.innerHTML = `<div class="studs"></div><div class="ghost">${art(def)}</div><div class="pn-label ol">${def.min} Min</div>
          <div class="pn-art">${art(def)}${claimed ? `<span class="pn-check">${check()}</span>` : ''}</div>${strip(def.rewards)}`
        let label
        let cls
        if (claimed) [label, cls] = ['CLAIMED', 'done']
        else if (pending.gifts.has(i)) [label, cls] = ['...', 'wait']
        else if (ready) [label, cls] = ['CLAIM!', 'go']
        else [label, cls] = [hms((def.min * 60 - t) * 1000), 'timer']
        const b = button(`pn-btn ol ${cls}`, label, () => (ready ? claimGift(i, card) : shakeNode(card)))
        if (cls === 'timer') {
          b.dataset.timer = 'gift'
          b.dataset.min = def.min
        }
        card.append(b)
        grid.append(card)
      })
      body.append(grid)
    },
  })

  // --- HUD buttons (in the left menu) + their "!" dots ---------------------------------------------------
  const dots = []
  function addMenuButtons(menu) {
    const make = (label, icon, open) => {
      const b = el('button', 'pressable', `${icon}<span class="ol">${label}</span><i class="dot"></i>`)
      b.type = 'button'
      b.addEventListener('pointerdown', (e) => e.stopPropagation())
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        open()
      })
      menu.append(b)
      return b.querySelector('.dot')
    }
    dots.push(['daily', make('Daily', calendar(new Date().getDate()), () => daily.toggle())])
    dots.push(['gifts', make('Gifts', gift(['#ff3b4a', '#ffc21a']), () => gifts.toggle())])
    updateDots()
  }
  function updateDots() {
    for (const [k, d] of dots) d.classList.toggle('on', (k === 'daily' ? dailyReady() : giftsReady()) > 0)
  }

  // --- Per frame -------------------------------------------------------------------------------------------
  let tick = 0
  let lastGiftsReady = 0
  function update(dt) {
    if (!view.giftsServer) {
      local.gifts.time += dt
      if (view.gifts) view.gifts.time = local.gifts.time
      tick += dt
      if (tick > 5) {
        tick = 0
        saveLocal()
      }
    }
    // Once a second: live countdowns, day rollover, dots.
    update.acc = (update.acc ?? 0) + dt
    if (update.acc < 1) return
    update.acc = 0
    const d = view.daily
    if (d && Date.now() >= d.nextAt) {
      if (view.dailyServer) {
        sendNet('dailyRefresh', {})
        d.nextAt = Date.now() + 30_000 // asked; don't ask again every second
      } else refreshLocal()
      daily.refresh()
    }
    for (const b of document.querySelectorAll('.pn-btn[data-timer="daily"]')) b.textContent = hms(view.daily.nextAt - Date.now())
    let flip = false
    const t = giftTime()
    for (const b of document.querySelectorAll('.pn-btn[data-timer="gift"]')) {
      const left = Number(b.dataset.min) * 60 - t
      if (left <= 0) flip = true
      else b.textContent = hms(left * 1000)
    }
    if (flip) gifts.refresh()
    const gr = giftsReady()
    if (gr > lastGiftsReady) {
      hooks.toast('A playtime gift is ready!')
      sfx.notify()
    }
    lastGiftsReady = gr
    updateDots()
  }

  // A daily reward waiting at load: open the calendar once (after the server answers, if any).
  let autoOpened = false
  function maybeAutoOpen() {
    if (autoOpened || !dailyReady()) return
    autoOpened = true
    daily.open()
  }

  return { daily, gifts, addMenuButtons, update, updateDots, maybeAutoOpen, dailyReady, giftsReady }
}
