// Menu windows: Shop (tentacles, boosts, training zones), Inventory (equip owned
// tentacles) and Rebirth. One window open at a time; Esc / the X / a tap on the
// backdrop closes it. Every price is in Wins.
import './windows.css'
import { BOOSTS, PROGRESSION, TENTACLES, ZONES } from './config.js'
import {
  atCap,
  buyLevels,
  buyStarter,
  buyTentacle,
  buyTrain2x,
  buyWins2x,
  buyZone,
  canRebirth,
  doRebirth,
  equipTentacle,
  fmt,
  levelCap,
  levelPackPrice,
  onChange,
  owns,
  rebirthBoost,
  state,
  zoneUnlocked,
} from './state.js'
import { ICONS } from './hud.js'
import { sfx } from './audio/index.js'

// A curled tentacle thumbnail in the skin's colours.
export function tentacleThumb(def) {
  const c = def.colors
  const glow = c.glow ? `<path d="M30 92c-10-22 2-42 22-50 16-6 20-20 10-27" fill="none" stroke="${c.glow}" stroke-width="22" stroke-linecap="round" opacity=".35"/>` : ''
  let pattern = ''
  if (def.pattern === 'spots' || def.pattern === 'glowspots') pattern = `<circle cx="38" cy="62" r="4" fill="${c.accent}"/><circle cx="55" cy="44" r="3.5" fill="${c.accent}"/><circle cx="64" cy="28" r="3" fill="${c.accent}"/><circle cx="33" cy="80" r="3.5" fill="${c.accent}"/>`
  else if (def.pattern === 'stripes') pattern = `<path d="M30 92c-10-22 2-42 22-50 16-6 20-20 10-27" fill="none" stroke="${c.accent}" stroke-width="3" stroke-linecap="round"/>`
  else if (def.pattern === 'bands' || def.pattern === 'crystal') pattern = `<path d="M24 74l14 3M30 56l13 8M46 44l6 12M60 34l8 7" stroke="${c.accent}" stroke-width="5" stroke-linecap="round"/>`
  else if (def.pattern === 'lava') pattern = `<path d="M30 80l6-8 3 6 5-9M48 48l7-4 1 6 6-6" stroke="${c.accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  else if (def.pattern === 'galaxy') pattern = `<circle cx="36" cy="66" r="1.8" fill="#fff"/><circle cx="52" cy="48" r="1.4" fill="#fff"/><circle cx="62" cy="30" r="1.6" fill="#fff"/><circle cx="44" cy="58" r="5" fill="${c.accent}" opacity=".6"/>`
  else if (def.pattern === 'grid') pattern = `<path d="M28 80h12v-10M44 56h10v-8M58 38h8" stroke="${c.accent}" stroke-width="2.4" fill="none"/>`
  const spikes = def.spikes ? `<path d="M22 70l-8-3 7-4M38 44l-6-8 8 1M58 24l-2-9 6 5" fill="${c.accent}" stroke="#13163a" stroke-width="1.5"/>` : ''
  return `<svg class="thumb" viewBox="0 0 100 100">${glow}
    <path d="M30 92c-10-22 2-42 22-50 16-6 20-20 10-27-6-4-13 0-11 6" fill="none" stroke="#13163a" stroke-width="19" stroke-linecap="round"/>
    <path d="M30 92c-10-22 2-42 22-50 16-6 20-20 10-27-6-4-13 0-11 6" fill="none" stroke="${c.base}" stroke-width="14" stroke-linecap="round"/>
    <path d="M36 92c-8-19 3-36 20-43 13-5 17-15 10-21" fill="none" stroke="${c.belly}" stroke-width="5" stroke-linecap="round" opacity=".9"/>
    ${pattern}${spikes}
    <circle cx="38" cy="78" r="2.6" fill="${c.belly}" stroke="#13163a" stroke-width="1"/><circle cx="44" cy="62" r="2.4" fill="${c.belly}" stroke="#13163a" stroke-width="1"/><circle cx="56" cy="51" r="2.2" fill="${c.belly}" stroke="#13163a" stroke-width="1"/>
  </svg>`
}

const ZONE_ICON = `<svg class="ic" viewBox="0 0 64 64"><rect x="26" y="34" width="12" height="24" rx="3" fill="#a8784a" stroke="#13163a" stroke-width="3"/><circle cx="32" cy="22" r="14" fill="#fff" stroke="#13163a" stroke-width="3"/><circle cx="32" cy="22" r="9" fill="#ff3b4a"/><circle cx="32" cy="22" r="4" fill="#fff"/></svg>`

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.innerHTML = html
  return e
}

let current = null
export const anyWindowOpen = () => !!current
export function closeTopWindow() {
  if (!current) return false
  current.close()
  return true
}
let reservedTop = 0
export function setWindowReserved(px) {
  reservedTop = px
  document.documentElement.style.setProperty('--win-top', `${reservedTop}px`)
}

function createWindow({ title, icon, color = '', tabs = null, onClose }) {
  const overlay = el('div', 'win-overlay')
  const win = el('div', `win ${color} ${tabs ? '' : 'no-tabs'}`)
  const head = el('div', 'win-title ol', `${icon}<span>${title}</span>`)
  const close = el('button', 'win-close ol', '✕')
  close.type = 'button'
  const tabBar = tabs ? el('div', 'win-tabs') : null
  const body = el('div', 'win-body')
  win.append(head, close)
  if (tabBar) win.append(tabBar)
  win.append(body)
  overlay.append(win)
  document.body.append(overlay)
  for (const type of ['pointerdown', 'wheel', 'keydown']) overlay.addEventListener(type, (e) => e.stopPropagation())

  let tab = tabs ? tabs[0].id : null
  let render = () => {}
  const w = {
    body,
    win,
    get tab() {
      return tab
    },
    setRender(fn) {
      render = fn
    },
    refresh() {
      if (!overlay.classList.contains('on')) return
      const scroll = body.scrollTop
      body.innerHTML = ''
      render(body, tab)
      body.scrollTop = scroll
    },
    open(t) {
      if (current && current !== w) current.close()
      if (t) tab = t
      current = w
      overlay.classList.add('on')
      if (tabBar) {
        tabBar.innerHTML = ''
        for (const tb of tabs) {
          const b = el('button', tb.id === tab ? 'on' : '', tb.label)
          b.type = 'button'
          b.addEventListener('click', () => {
            tab = tb.id
            for (const x of tabBar.children) x.classList.toggle('on', x === b)
            body.innerHTML = ''
            body.scrollTop = 0
            render(body, tab)
          })
          tabBar.append(b)
        }
      }
      body.innerHTML = ''
      render(body, tab)
      sfx.windowOpen()
      document.exitPointerLock?.()
    },
    close() {
      if (!overlay.classList.contains('on')) return
      overlay.classList.remove('on')
      if (current === w) current = null
      sfx.windowClose()
      onClose?.()
    },
    isOpen: () => overlay.classList.contains('on'),
    toggle(t) {
      if (w.isOpen()) w.close()
      else w.open(t)
    },
  }
  close.addEventListener('click', w.close)
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) w.close()
  })
  return w
}

const shake = (node) => {
  node.classList.remove('shake')
  void node.offsetWidth
  node.classList.add('shake')
  sfx.deny()
}
const T = () => ICONS.trophy

// hooks: { onBuyTentacle(def), onRebirth(), toast(text) }
export function createWindows(hooks) {
  // --- Shop -------------------------------------------------------------------------------------------
  const shop = createWindow({
    title: 'Shop',
    icon: ICONS.shop,
    tabs: [
      { id: 'tentacles', label: 'Tentacles' },
      { id: 'boosts', label: 'Boosts' },
      { id: 'zones', label: 'Training' },
    ],
  })
  shop.setRender((body, tab) => {
    if (tab === 'tentacles') {
      const grid = el('div', 'win-grid')
      TENTACLES.forEach((def, i) => {
        const owned = owns(def.id)
        const eq = state.equipped === def.id
        const card = el('button', `card ${eq ? 'equipped' : ''} ${def.special ? 'special' : ''}`)
        card.type = 'button'
        card.style.animationDelay = `${i * 0.025}s`
        card.innerHTML = `${def.special ? '<span class="badge ol">SPECIAL</span>' : ''}${tentacleThumb(def)}<span class="name">${def.name}</span><span class="xp">+${fmt(def.xp)} XP / hit</span>
          <span class="tag ol ${eq ? 'eq' : owned ? 'own' : ''}">${eq ? 'EQUIPPED' : owned ? 'EQUIP' : def.price === 0 ? 'FREE' : `${T()}${fmt(def.price)}`}</span>`
        card.addEventListener('click', () => {
          if (eq) return
          if (owned) {
            equipTentacle(def.id)
            sfx.equip()
          } else if (buyTentacle(def.id)) {
            sfx.purchase()
            hooks.onBuyTentacle?.(def)
          } else return shake(card)
          shop.refresh()
        })
        grid.append(card)
      })
      body.append(grid)
    } else if (tab === 'boosts') {
      const row = (icon, title, sub, label, disabled, fn) => {
        const c = el('div', 'wide-card')
        c.innerHTML = `${icon.replace('<svg', '<svg class="ic"')}<div class="txt"><b>${title}</b><span>${sub}</span></div>`
        const b = el('button', 'buy-btn ol', label)
        b.type = 'button'
        b.disabled = disabled
        b.addEventListener('click', () => {
          if (fn()) {
            sfx.purchase()
            shop.refresh()
          } else shake(c)
        })
        c.append(b)
        body.append(c)
      }
      const train = state.train2x > 0 ? ` (active: ${Math.ceil(state.train2x / 60)} min left)` : ''
      row(ICONS.bolt, 'x2 Train', `Double training XP for ${BOOSTS.train2x.minutes} minutes. Stacks.${train}`, `${T()}${fmt(BOOSTS.train2x.price)}`, false, buyTrain2x)
      row(ICONS.trophy, 'x2 Wins', 'Permanently doubles every Wins reward.', state.wins2x ? 'OWNED' : `${T()}${fmt(BOOSTS.wins2x.price)}`, state.wins2x, buyWins2x)
      row(ICONS.gift, 'Starter Pack', `Sunken Gold tentacles + ${BOOSTS.starter.trainMinutes} min x2 Train + ${BOOSTS.starter.levels} levels. One time only.`, state.starter ? 'OWNED' : `${T()}${fmt(BOOSTS.starter.price)}`, state.starter, buyStarter)
      for (const pack of BOOSTS.levels) {
        row(ICONS.bolt, `+${pack.n} Levels`, atCap() ? 'You are at the level cap. Rebirth to go higher!' : `Instantly gain ${pack.n} levels (up to your cap of ${levelCap()}).`, `${T()}${fmt(levelPackPrice(pack))}`, atCap(), () => buyLevels(pack))
      }
    } else {
      ZONES.forEach((z) => {
        const c = el('div', 'wide-card')
        const open = zoneUnlocked(z)
        const req = z.price ? `Unlock for ${fmt(z.price)} Wins` : z.rebirths ? `Needs ${z.rebirths} Rebirth${z.rebirths > 1 ? 's' : ''}` : 'Open to everyone'
        c.innerHTML = `${ZONE_ICON}<div class="txt"><b>${z.name} — x${z.mult} XP</b><span>${open ? 'Unlocked! Walk onto its floor in the hub to train.' : req}</span></div>`
        if (z.price && !open) {
          const b = el('button', 'buy-btn ol', `${T()}${fmt(z.price)}`)
          b.type = 'button'
          b.addEventListener('click', () => {
            if (buyZone(z)) {
              sfx.unlock()
              shop.refresh()
            } else shake(c)
          })
          c.append(b)
        } else {
          const tag = el('span', `buy-btn ol ${open ? 'blue' : ''}`, open ? 'OPEN' : `${z.rebirths} ${ICONS.rebirth.replace('<svg', '<svg style="width:1.1em;height:1.1em"')}`)
          tag.style.cursor = 'default'
          c.append(tag)
        }
        body.append(c)
      })
    }
  })

  // --- Inventory ----------------------------------------------------------------------------------------
  const inventory = createWindow({ title: 'Inventory', icon: ICONS.backpack, color: 'orange' })
  inventory.setRender((body) => {
    const grid = el('div', 'win-grid')
    const list = TENTACLES.filter((d) => owns(d.id))
    list.forEach((def, i) => {
      const eq = state.equipped === def.id
      const card = el('button', `card ${eq ? 'equipped' : ''} ${def.special ? 'special' : ''}`)
      card.type = 'button'
      card.style.animationDelay = `${i * 0.03}s`
      card.innerHTML = `${tentacleThumb(def)}<span class="name">${def.name}</span><span class="xp">+${fmt(def.xp)} XP / hit</span><span class="tag ol ${eq ? 'eq' : 'own'}">${eq ? 'EQUIPPED' : 'EQUIP'}</span>`
      card.addEventListener('click', () => {
        if (eq) return
        equipTentacle(def.id)
        sfx.equip()
        inventory.refresh()
      })
      grid.append(card)
    })
    body.append(grid)
    const more = TENTACLES.length - list.length
    if (more > 0) {
      const hint = el('div', 'wide-card', `<div class="txt"><b>${more} more tentacle${more > 1 ? 's' : ''} to collect</b><span>Buy them from the pedestals in the hub or from the Shop.</span></div>`)
      const b = el('button', 'buy-btn ol', 'SHOP')
      b.type = 'button'
      b.addEventListener('click', () => shop.open('tentacles'))
      hint.append(b)
      body.append(hint)
    }
  })

  // --- Rebirth -----------------------------------------------------------------------------------------------
  const rebirth = createWindow({ title: 'Rebirth', icon: ICONS.rebirth, color: 'pink' })
  rebirth.setRender((body) => {
    const r = state.rebirths
    const wrap = el('div', 'rb-wrap')
    const boostNow = Math.round((rebirthBoost(r) - 1) * 100)
    const boostNext = Math.round((rebirthBoost(r + 1) - 1) * 100)
    wrap.innerHTML = `
      <div class="rb-row">
        <div class="rb-box"><small>Rebirths</small><b>${r}</b></div><span class="rb-arrow ol">➜</span><div class="rb-box next"><small>Rebirths</small><b>${r + 1}</b></div>
      </div>
      <div class="rb-row">
        <div class="rb-box"><small>XP Boost</small><b>+${boostNow}%</b></div><span class="rb-arrow ol">➜</span><div class="rb-box next"><small>XP Boost</small><b>+${boostNext}%</b></div>
      </div>
      <div class="rb-row">
        <div class="rb-box"><small>Level Cap</small><b>${levelCap(r)}</b></div><span class="rb-arrow ol">➜</span><div class="rb-box next"><small>Level Cap</small><b>${levelCap(r + 1)}</b></div>
      </div>
      <div class="rb-note">${canRebirth() ? 'You are at max level! Rebirth resets you to Level 1 (you keep your Wins and tentacles) and makes every future level come faster.' : `Reach Level ${levelCap(r)} to rebirth (you are Level ${state.level}). Rebirths also unlock new training zones.`}</div>`
    const go = el('button', 'buy-btn ol rb-go', 'REBIRTH')
    go.type = 'button'
    go.disabled = !canRebirth()
    go.addEventListener('click', () => {
      if (doRebirth()) {
        rebirth.close()
        hooks.onRebirth?.()
      } else shake(wrap)
    })
    wrap.append(go)
    body.append(wrap)
  })

  onChange((kind) => {
    if (kind === 'wins' || kind === 'tentacle' || kind === 'boost' || kind === 'level' || kind === 'rebirth' || kind === 'zone') {
      shop.refresh()
      inventory.refresh()
      rebirth.refresh()
    }
  })
  void PROGRESSION
  return { shop, inventory, rebirth }
}
