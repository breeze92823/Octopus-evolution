// The HUD: left menu (Rebirth / Shop / Inventory) + Wins and Rebirths counters,
// top boss timer (or the boss's HP bar), right boost offers, bottom arms info,
// level bar and level packs, the E prompt, combat buttons (LEAVE / THROW), big
// announcements, toasts, the hurt vignette and the revive dialog.
// Everything priced is paid in Wins.
import './hud.css'
import { BOOSTS } from './config.js'
import {
  atCap,
  armsFor,
  canRebirth,
  fmt,
  fmtTime,
  levelCap,
  levelPackPrice,
  nextArmLevel,
  onChange,
  rebirthBoost,
  state,
  xpNeed,
} from './state.js'

// --- Icons (original inline SVG) ------------------------------------------------------------
export const ICONS = {
  trophy: `<svg viewBox="0 0 64 64"><path d="M18 8h28v14c0 9-6 16-14 16s-14-7-14-16z" fill="#ffc21a" stroke="#5a3200" stroke-width="3"/><path d="M18 13H8c0 9 5 14 12 14M46 13h10c0 9-5 14-12 14" fill="none" stroke="#5a3200" stroke-width="5"/><path d="M18 13H8c0 9 5 14 12 14M46 13h10c0 9-5 14-12 14" fill="none" stroke="#ffc21a" stroke-width="2.5"/><path d="M27 38h10v8H27z" fill="#e89a00" stroke="#5a3200" stroke-width="3"/><path d="M19 46h26l3 10H16z" fill="#ffc21a" stroke="#5a3200" stroke-width="3"/><path d="M24 12h5v16c-3-2-5-8-5-16z" fill="#fff6c4" opacity=".8"/></svg>`,
  rebirth: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="#fff" stroke="#13163a" stroke-width="3"/><path d="M32 7a25 25 0 0 1 25 25H32z" fill="#ff3b5c"/><path d="M7 32a25 25 0 0 1 25-25v25z" fill="#ff7a8f"/><path d="M20 30a12 12 0 0 1 21-7l3-3v11H33l4-4a7 7 0 0 0-11 3z M44 34a12 12 0 0 1-21 7l-3 3V33h11l-4 4a7 7 0 0 0 11-3z" fill="#13163a"/><circle cx="32" cy="32" r="27" fill="none" stroke="#13163a" stroke-width="3"/></svg>`,
  shop: `<svg viewBox="0 0 64 64"><path d="M22 22c0-8 4-13 10-13s10 5 10 13" fill="none" stroke="#13163a" stroke-width="7" stroke-linecap="round"/><path d="M22 22c0-8 4-13 10-13s10 5 10 13" fill="none" stroke="#6a6f86" stroke-width="3" stroke-linecap="round"/><path d="M8 24h48l-5 30a4 4 0 0 1-4 3H17a4 4 0 0 1-4-3z" fill="#ff3b4a" stroke="#13163a" stroke-width="3"/><path d="M8 24h48v6H8z" fill="#ff7a84" stroke="#13163a" stroke-width="3"/><path d="M20 36v14M32 36v14M44 36v14" stroke="#a8121f" stroke-width="4" stroke-linecap="round"/></svg>`,
  backpack: `<svg viewBox="0 0 64 64"><path d="M22 16c0-6 4-9 10-9s10 3 10 9" fill="none" stroke="#13163a" stroke-width="6"/><rect x="11" y="15" width="42" height="43" rx="12" fill="#c9783a" stroke="#13163a" stroke-width="3"/><rect x="18" y="34" width="28" height="18" rx="5" fill="#a85e26" stroke="#13163a" stroke-width="3"/><path d="M18 40h28" stroke="#13163a" stroke-width="3"/><rect x="29" y="37" width="6" height="7" rx="2" fill="#ffc21a" stroke="#13163a" stroke-width="2"/><path d="M16 22c4-3 9-4 16-4" stroke="#e8a46a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  bolt: `<svg viewBox="0 0 64 64"><path d="M38 3 12 36h16l-6 25 30-36H35z" fill="#ffd21a" stroke="#5a3200" stroke-width="3.5" stroke-linejoin="round"/><path d="M36 8 18 32h8" fill="none" stroke="#fff6b0" stroke-width="3" stroke-linecap="round"/></svg>`,
  gift: `<svg viewBox="0 0 64 64"><path d="M32 18c-4-9-15-12-15-4 0 5 9 6 15 4zm0 0c4-9 15-12 15-4 0 5-9 6-15 4z" fill="#ff4fd8" stroke="#13163a" stroke-width="3"/><rect x="8" y="20" width="48" height="12" rx="3" fill="#ff3b4a" stroke="#13163a" stroke-width="3"/><rect x="12" y="32" width="40" height="25" rx="3" fill="#e0262b" stroke="#13163a" stroke-width="3"/><path d="M28 20h8v37h-8z" fill="#ffd21a" stroke="#13163a" stroke-width="3"/><circle cx="48" cy="12" r="3" fill="#7dff6a"/><circle cx="14" cy="10" r="2.5" fill="#3ad6ff"/><path d="M52 40l4-3M10 44l-4 2" stroke="#ffd21a" stroke-width="3" stroke-linecap="round"/></svg>`,
  potion: `<svg viewBox="0 0 64 64"><path d="M25 6h14v14l12 18a14 14 0 0 1-12 21H25a14 14 0 0 1-12-21l12-18z" fill="#bfefff" stroke="#13163a" stroke-width="3"/><path d="M15 40h34a12 12 0 0 1-10 17H25a12 12 0 0 1-10-17z" fill="#3a8aff"/><path d="M35 34 26 47h7l-3 9 10-13h-7z" fill="#ffd21a" stroke="#5a3200" stroke-width="2"/><rect x="22" y="3" width="20" height="6" rx="2" fill="#c9783a" stroke="#13163a" stroke-width="3"/></svg>`,
  soundOn: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  soundOff: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/><path d="M16 9l5 6M21 9l-5 6"/></svg>`,
  tentacle: `<svg viewBox="0 0 64 64"><path d="M20 58c-6-14 2-26 14-30 10-3 12-12 6-16-5-3-11 1-9 6" fill="none" stroke="#13163a" stroke-width="14" stroke-linecap="round"/><path d="M20 58c-6-14 2-26 14-30 10-3 12-12 6-16-5-3-11 1-9 6" fill="none" stroke="#ff6a8a" stroke-width="9" stroke-linecap="round"/><circle cx="24" cy="45" r="2.6" fill="#ffd0dc"/><circle cx="30" cy="35" r="2.4" fill="#ffd0dc"/><circle cx="40" cy="27" r="2.2" fill="#ffd0dc"/></svg>`,
}
const trophy = (cls = '') => `<span class="${cls}">${ICONS.trophy}</span>`

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.innerHTML = html
  return e
}
function btn(cls, html, fn) {
  const b = el('button', `${cls} pressable`, html)
  b.type = 'button'
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    fn(b)
  })
  // Keep the world (pointer lock / camera drag) from also taking the press.
  b.addEventListener('pointerdown', (e) => e.stopPropagation())
  return b
}

// actions: { rebirth, shop, inventory, buyLevels(pack), train2x, wins2x, starter, leave, throw, prompt, hit, mute }
export function createHud(actions) {
  const root = el('div', 'hud')
  document.body.appendChild(root)

  // Left.
  const left = el('div', 'hud-left')
  const menu = el('div', 'hud-menu')
  const rbBtn = btn('', `${ICONS.rebirth}<span class="ol">Rebirth</span><i class="dot"></i>`, actions.rebirth)
  const shopBtn = btn('', `${ICONS.shop}<span class="ol">Shop</span>`, actions.shop)
  const invBtn = btn('', `${ICONS.backpack}<span class="ol">Inventory</span>`, actions.inventory)
  menu.append(rbBtn, shopBtn, invBtn)
  const winsStat = el('div', 'hud-stat wins', `${ICONS.trophy}<span class="ol">0</span>`)
  const rbStat = el('div', 'hud-stat rebirths', `${ICONS.rebirth}<span class="ol">0</span>`)
  left.append(menu, winsStat, rbStat)

  // Top.
  const top = el('div', 'hud-top')
  const timer = el('div', 'ol', '')
  top.append(timer)
  const bossBar = el('div', 'hud-bossbar', '<div class="name ol"></div><div class="track"><div class="ghost"></div><div class="fill"></div><div class="txt ol"></div></div>')

  // Right.
  const right = el('div', 'hud-right')
  const trainBtn = btn('boost train', `<div class="banner"><span class="icon">${ICONS.bolt}</span><span class="ol">x2 Train</span></div><div class="price ol"></div>`, actions.train2x)
  const winsBtn = btn('boost wins2', `<div class="banner"><span class="icon">${ICONS.trophy}</span><span class="ol">x2 Wins</span></div><div class="price ol"></div>`, actions.wins2x)
  const starterBtn = btn('starter', `${ICONS.gift}<span class="ol">STARTER PACK!</span><span class="price ol"></span>`, actions.starter)
  right.append(trainBtn, winsBtn, starterBtn)

  // Bottom.
  const bottom = el('div', 'hud-bottom')
  const info = el('div', 'hud-info', '<span class="arms ol"></span><span class="rb ol"></span>')
  const level = el('div', 'hud-level', '<div class="fill"></div><span class="lv ol"></span><span class="xp ol"></span>')
  const buy = el('div', 'hud-buy')
  const packBtns = BOOSTS.levels.map((pack) => {
    const b = btn('', `<span class="bolt">${ICONS.bolt}</span><span class="lbl ol">+${pack.n} Levels</span><span class="price ol"></span>`, () => actions.buyLevels(pack))
    b.pack = pack
    buy.append(b)
    return b
  })
  bottom.append(info, level, buy)

  // Prompt + combat.
  const prompt = el('div', 'hud-prompt', '<span class="key">E</span><span class="t"><span class="ol title"></span><small class="ol sub"></small></span>')
  prompt.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    actions.prompt()
  })
  const combat = el('div', 'hud-combat')
  const leaveBtn = btn('leave ol', 'LEAVE', actions.leave)
  const throwBtn = btn('throw ol', '<span class="key">E</span><span class="lab">THROW</span>', actions.throw)
  combat.append(leaveBtn, throwBtn)
  const hitBtn = el('button', 'hud-hit ol', 'HIT!')
  hitBtn.type = 'button'
  hitBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    actions.hit()
  })

  const potion = el('div', 'hud-potion', `${ICONS.potion}<span class="ol"></span>`)
  const mute = btn('hud-mute', ICONS.soundOn, (b) => {
    const muted = actions.mute()
    b.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn
  })
  const announce = el('div', 'hud-announce', '<div class="a1 ol"></div><div class="a2 ol"></div>')
  const toasts = el('div', 'hud-toasts')
  const hurt = el('div', 'hud-hurt')
  const revive = el('div', 'hud-revive')

  root.append(hurt, left, top, bossBar, right, bottom, prompt, combat, hitBtn, potion, mute, announce, toasts, revive)

  // --- Rendering from state -------------------------------------------------------------------
  let shownWins = state.wins
  function bump(stat) {
    stat.classList.remove('bump')
    void stat.offsetWidth
    stat.classList.add('bump')
  }
  function renderStats() {
    winsStat.querySelector('span').textContent = fmt(state.wins)
    rbStat.querySelector('span').textContent = fmt(state.rebirths)
    rbBtn.querySelector('.dot').classList.toggle('on', canRebirth())
  }
  function renderLevel() {
    const max = atCap()
    level.classList.toggle('max', max)
    level.querySelector('.lv').textContent = `Level ${state.level}`
    level.querySelector('.xp').textContent = max ? 'MAX! Rebirth' : `${fmt(state.xp)}/${fmt(xpNeed(state.level))}`
    level.querySelector('.fill').style.width = max ? '100%' : `${Math.min(100, (state.xp / xpNeed(state.level)) * 100).toFixed(2)}%`
    const arms = armsFor(state.level)
    const next = nextArmLevel(state.level)
    info.querySelector('.arms').innerHTML = `${arms} ARMS ${next ? `<small>+1 AT LV ${next}</small>` : ''}`
    const boost = Math.round((rebirthBoost() - 1) * 100)
    info.querySelector('.rb').textContent = boost > 0 ? `+${boost}% REBIRTH BOOST` : `LEVEL CAP ${levelCap()}`
  }
  function renderPrices() {
    for (const b of packBtns) {
      b.querySelector('.price').innerHTML = `${ICONS.trophy}${fmt(levelPackPrice(b.pack))}`
      b.disabled = atCap()
    }
    trainBtn.querySelector('.price').innerHTML = `ONLY ${ICONS.trophy} ${fmt(BOOSTS.train2x.price)}`
    winsBtn.classList.toggle('owned', state.wins2x)
    winsBtn.querySelector('.price').innerHTML = state.wins2x ? 'OWNED' : `ONLY ${ICONS.trophy} ${fmt(BOOSTS.wins2x.price)}`
    starterBtn.classList.toggle('done', state.starter)
    starterBtn.querySelector('.price').innerHTML = `ONLY ${ICONS.trophy} ${fmt(BOOSTS.starter.price)}`
  }
  onChange((kind) => {
    if (kind === 'wins') {
      if (state.wins > shownWins) bump(winsStat)
      shownWins = state.wins
      renderStats()
    }
    if (kind === 'xp' || kind === 'level' || kind === 'rebirth') {
      renderLevel()
      renderPrices()
      renderStats()
    }
    if (kind === 'level') {
      level.classList.remove('pulse')
      void level.offsetWidth
      level.classList.add('pulse')
    }
    if (kind === 'rebirth') bump(rbStat)
    if (kind === 'boost' || kind === 'tentacle') renderPrices()
  })
  renderStats()
  renderLevel()
  renderPrices()

  // --- Announcements and toasts ----------------------------------------------------------------
  let announceTimer = 0
  function doAnnounce(title, sub = '', style = '') {
    announce.className = `hud-announce ${style ? `an-${style}` : ''}`
    announce.querySelector('.a1').textContent = title
    announce.querySelector('.a2').textContent = sub
    void announce.offsetWidth
    announce.classList.add('on')
    clearTimeout(announceTimer)
    announceTimer = setTimeout(() => announce.classList.remove('on'), 2150)
  }
  const toastSeen = new Map()
  function doToast(text) {
    const now = performance.now()
    if (now - (toastSeen.get(text) ?? -1e9) < 1200) return // no spam of the same line
    toastSeen.set(text, now)
    const t = el('div', 'hud-toast ol', '')
    t.textContent = text
    toasts.append(t)
    while (toasts.children.length > 3) toasts.firstChild.remove()
    setTimeout(() => t.remove(), 2300)
  }

  // --- Revive dialog -----------------------------------------------------------------------------------
  let reviveTimer = null
  // `gate` (bloxity.js showDeathScreen) is Boxity's death screen: its banners and a countdown (4 s or more)
  // run while the player is dead, and the game respawns ONLY when gate.respawn() returns true, never on a
  // timer of its own. Without it (outside Boxity) the dialog keeps its own countdown that ends in "No".
  // `onAd` (async, true when the whole rewarded ad was watched) + `onAdRevive` add a free revive.
  function doRevive({ seconds, revivePrice, revengePrice, onRevive, onRevenge, onNo, onAd, onAdRevive, gate }) {
    revive.innerHTML = ''
    const h = el('h2', 'ol', 'REVIVE?')
    const count = el('div', 'count ol', gate ? '' : seconds.toFixed(2))
    const row = el('div', 'row')
    const buttons = []
    const opt = (cls, label, price, sub, fn) => {
      const o = el('div', 'opt')
      const b = btn(cls, `<span class="ol">${label}</span>${price != null ? `<span class="price ol">${ICONS.trophy}${fmt(price)}</span>` : ''}`, fn)
      o.append(b)
      if (sub) o.append(el('small', 'ol', sub))
      row.append(o)
      buttons.push(b)
      return b
    }
    let left = seconds
    let lastTick = Math.ceil(left)
    let ready = !gate
    const close = () => {
      clearInterval(reviveTimer)
      reviveTimer = null
      revive.classList.remove('on')
    }
    // Every way out goes through here: wait for the countdown, check the price, then respawn.
    const go = (price, fn) => () => {
      if (!ready) return doToast('Wait for the countdown')
      if (price != null && state.wins < Math.ceil(price)) return doToast('Not enough Wins!')
      if (gate && !gate.respawn()) return doToast('Wait for the countdown')
      if (fn() !== false) close()
      else doToast('Not enough Wins!')
    }
    opt('g', 'Revive!', revivePrice, '+ FULL HP', go(revivePrice, onRevive))
    opt('y', 'Revenge!', revengePrice, '+ KILL ENEMIES', go(revengePrice, onRevenge))
    if (onAd) {
      let adBusy = false
      opt('g', 'Watch Ad', null, '+ FREE REVIVE', async () => {
        if (adBusy) return
        if (!ready) return doToast('Wait for the countdown')
        adBusy = true
        const ok = await onAd()
        adBusy = false
        if (!ok) return doToast('No ad right now, try again later')
        if (gate && !gate.respawn()) return doToast('Wait for the countdown')
        close()
        onAdRevive()
      })
    }
    opt('r', 'No', null, '', go(null, () => (onNo(), true)))
    revive.append(h, count, row)
    revive.classList.add('on')
    document.exitPointerLock?.()
    clearInterval(reviveTimer)
    reviveTimer = null
    if (gate) {
      gate.onCountdown((n) => {
        ready = n <= 0
        count.textContent = ready ? 'GO' : String(n)
        for (const b of buttons) b.style.opacity = ready ? '' : '0.55'
        if (!ready && n !== lastTick) {
          lastTick = n
          actions.tick?.()
        }
      })
    } else {
      reviveTimer = setInterval(() => {
        left = Math.max(0, left - 0.05)
        count.textContent = left.toFixed(2)
        const c = Math.ceil(left)
        if (c !== lastTick) {
          lastTick = c
          actions.tick?.()
        }
        if (left <= 0) {
          close()
          onNo()
        }
      }, 50)
    }
    return close
  }

  // --- Public API ---------------------------------------------------------------------------------------
  let hurtTimer = 0
  let combatOn = false
  return {
    root,
    announce: doAnnounce,
    toast: doToast,
    revive: doRevive,
    hurtFlash() {
      hurt.classList.add('on')
      clearTimeout(hurtTimer)
      hurtTimer = setTimeout(() => hurt.classList.remove('on'), 90)
    },
    setCombat({ on, leave = false }) {
      combatOn = on
      combat.classList.toggle('on', on)
      combat.classList.toggle('leave-on', on && leave)
    },
    setLane(on) {
      root.classList.toggle('lane', on)
    },
    setWindowed(on) {
      root.classList.toggle('windowed', on)
    },
    setThrowCooldown(left) {
      if (!combatOn) return
      const cd = left > 0
      const txt = cd ? String(Math.ceil(left)) : 'THROW'
      if (throwBtn.dataset.t !== txt) {
        throwBtn.dataset.t = txt
        throwBtn.classList.toggle('cd', cd)
        throwBtn.querySelector('.lab').textContent = txt
      }
    },
    bossBar(name, hp, max) {
      if (name == null) {
        bossBar.classList.remove('on')
        top.style.visibility = ''
        return
      }
      if (!bossBar.classList.contains('on')) bossBar.classList.add('on')
      top.style.visibility = 'hidden'
      bossBar.querySelector('.name').textContent = name
      const pct = `${Math.max(0, Math.min(100, (hp / max) * 100)).toFixed(1)}%`
      bossBar.querySelector('.fill').style.width = pct
      bossBar.querySelector('.ghost').style.width = pct
      bossBar.querySelector('.txt').textContent = `${fmt(Math.max(0, hp))} / ${fmt(max)}`
    },
    // p: { title, sub, tone: 'buy' | 'ok' | 'locked' | '' } or null
    prompt(p) {
      if (!p) {
        if (prompt.classList.contains('on')) prompt.classList.remove('on')
        prompt.dataset.k = ''
        return
      }
      const k = `${p.title}|${p.sub}|${p.tone}`
      if (prompt.dataset.k === k) return
      prompt.dataset.k = k
      prompt.className = `hud-prompt on ${p.tone ?? ''}`
      prompt.querySelector('.title').textContent = p.title
      prompt.querySelector('.sub').innerHTML = p.sub ?? ''
      prompt.querySelector('.key').style.display = p.noKey ? 'none' : ''
    },
    setTraining(on) {
      hitBtn.classList.toggle('on', on)
    },
    trophyIcon: () => ICONS.trophy,
    // Per frame (cheap: only touches the DOM when text changes).
    update() {
      const tt = state.bossTimer > 0 ? `NEXT <span class="boss-word">BOSS</span> FIGHT IN: ${fmtTime(state.bossTimer)}` : bossBar.classList.contains('on') ? `<span class="boss-word">BOSS</span> FIGHT!` : `<span class="boss-word">BOSS</span> WAITS IN THE LANE!`
      if (timer.dataset.t !== tt) {
        timer.dataset.t = tt
        timer.innerHTML = tt
      }
      const on = state.train2x > 0
      potion.classList.toggle('on', on)
      if (on) {
        const s = Math.ceil(state.train2x)
        const txt = `2x Train (${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s)`
        const span = potion.querySelector('span')
        if (span.textContent !== txt) span.textContent = txt
      }
    },
    trophy,
  }
}
