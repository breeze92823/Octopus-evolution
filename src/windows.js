// Menu windows: the Shop (tentacles). The inventory (My Skins / Items / Titles / Trails) lives in
// collection.js and Rebirth / Ascend in popups.js; they share this module's one-window-at-a-time
// slot (claimWindow). Esc / the X / a tap on the backdrop closes it. Every price is in Wins.
import './windows.css'
import { TENTACLES } from './config.js'
import { buyTentacle, equipTentacle, fmt, onChange, owns, state } from './state.js'
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
// Other panels (panels.js: rewards, collection, rebirth, ascend) share the one-open-at-a-time slot:
// claimWindow closes whatever is open and takes the slot; releaseWindow gives it back.
export function claimWindow(w) {
  if (current && current !== w) current.close()
  current = w
}
export function releaseWindow(w) {
  if (current === w) current = null
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

// hooks: { onBuyTentacle(def) }
export function createWindows(hooks) {
  // --- Shop -------------------------------------------------------------------------------------------
  const shop = createWindow({ title: 'Shop', icon: ICONS.shop })
  shop.setRender((body) => {
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
  })

  onChange((kind) => {
    if (kind === 'wins' || kind === 'tentacle') shop.refresh()
  })
  return { shop }
}
