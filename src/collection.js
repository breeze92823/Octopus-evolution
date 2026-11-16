// "My ..." collection window: a side bar of tabs (Skins, Items, Titles, Trails) next to one panel.
// - Skins: tentacle skins, owned first (tap to equip), the rest buyable here too (Wins).
// - Items: held boosts; tap one to use it (adds its minutes to that boost's timer).
// - Titles: earned automatically (state.checkTitles); tap an owned one to equip it (its bonus
//   applies and it floats over the octopus), tap a locked one to see its goal.
// - Trails: bought with Wins (never premium currency), tap an owned one to equip / unequip.
import { ITEMS, TENTACLES, TITLES, TRAILS } from './config.js'
import {
  buyTentacle,
  buyTrail,
  equipTentacle,
  equippedTitle,
  equippedTrail,
  fmt,
  itemCount,
  markTitlesSeen,
  onChange,
  owns,
  ownsTitle,
  ownsTrail,
  state,
  tentacleById,
  titleProgress,
  toggleTitle,
  toggleTrail,
  unseenTitles,
  useItem,
} from './state.js'
import { ICONS } from './hud.js'
import { tentacleThumb } from './windows.js'
import { bigStar, bonusIcon, itemIcon, lock, octoFace, trailWisps } from './icons.js'
import { button, createPanel, el, shakeNode } from './panels.js'
import { sfx } from './audio/index.js'

const TABS = [
  { id: 'skins', label: 'Skins', icon: () => octoFace() },
  { id: 'items', label: 'Items', icon: () => itemIcon(ITEMS[0]) },
  { id: 'titles', label: 'Titles', icon: () => bigStar() },
  { id: 'trails', label: 'Trails', icon: () => trailWisps({ colors: ['#ff8a9a', '#ff2d4a', '#a0122a'] }) },
]
const TIER = ['grey', 'blue', 'purple', 'gold']
const BONUS = { train: 'Train', damage: 'Damage', wins: 'Wins' }

// hooks: { toast(text), announce(title, sub, style), onBuyTentacle(def), onTrail(def), onTitle(def) }
export function createCollection(hooks) {
  let tab = 'items'

  const section = (title) => el('div', 'cl-section ol', title)

  function renderSkins(inner) {
    const owned = TENTACLES.filter((d) => owns(d.id))
    const unowned = TENTACLES.filter((d) => !owns(d.id))
    const card = (def, i) => {
      const eq = state.equipped === def.id
      const has = owns(def.id)
      const c = el('button', `cl-card skin ${eq ? 'eq' : ''} ${has ? '' : 'locked'}`)
      c.type = 'button'
      c.style.animationDelay = `${i * 0.02}s`
      c.innerHTML = `${tentacleThumb(def)}<span class="nm ol">${def.name}</span><span class="pr ol">${has ? `+${fmt(def.xp)} XP / hit` : `${ICONS.trophy}${def.price ? fmt(def.price) : 'FREE'}`}</span>`
      c.addEventListener('click', () => {
        if (eq) return
        if (has) {
          equipTentacle(def.id)
          sfx.equip()
        } else if (buyTentacle(def.id)) {
          sfx.purchase()
          hooks.onBuyTentacle?.(def)
        } else {
          shakeNode(c)
          return hooks.toast('Not enough Wins!')
        }
        panel.refresh()
      })
      return c
    }
    inner.append(section('Owned'))
    const g1 = el('div', 'cl-grid four')
    owned.forEach((d, i) => g1.append(card(d, i)))
    inner.append(g1)
    if (unowned.length) {
      inner.append(section('Unowned'))
      const g2 = el('div', 'cl-grid four')
      unowned.forEach((d, i) => g2.append(card(d, i + owned.length)))
      inner.append(g2)
    }
  }

  function renderItems(inner) {
    const list = ITEMS.filter((d) => (state.items[d.id] ?? 0) > 0)
    if (!list.length) {
      inner.append(el('div', 'cl-empty ol', 'No boosts yet!<small>Claim Daily and Playtime rewards to get some.</small>'))
      return
    }
    const g = el('div', 'cl-grid items')
    list.forEach((def, i) => {
      const c = el('button', `cl-card item i-${def.color}`)
      c.type = 'button'
      c.style.animationDelay = `${i * 0.03}s`
      c.innerHTML = `<span class="ic">${itemIcon(def)}</span><span class="cnt ol">x${fmt(state.items[def.id])}</span><span class="nm ol">${def.name}</span>`
      c.addEventListener('click', () => {
        if (!useItem(def.id)) return shakeNode(c)
        sfx.equip()
        hooks.toast(`${def.name} active! +${def.minutes} min`)
        panel.refresh()
      })
      g.append(c)
    })
    inner.append(g)
  }

  function titleCard(def, i) {
    const has = ownsTitle(def.id)
    const eq = state.title === def.id
    const c = el('button', `cl-card title t-${TIER[def.tier]} ${has ? 'own' : 'locked'} ${eq ? 'eq' : ''}`)
    c.type = 'button'
    c.title = def.desc
    c.style.animationDelay = `${Math.min(i, 20) * 0.015}s`
    const [v, goal] = titleProgress(def)
    c.innerHTML = `<span class="nm ol">${def.name}</span><span class="bn ol"><i>${bonusIcon(def.bonus)}</i>+${def.pct}% ${BONUS[def.bonus]}</span>${
      has ? (eq ? '<span class="eqtag ol">EQUIPPED</span>' : '') : `<span class="lk">${lock()}</span><span class="bar"><i style="width:${((v / goal) * 100).toFixed(1)}%"></i></span>`
    }`
    c.addEventListener('click', () => {
      if (!has) {
        sfx.click()
        return hooks.toast(`${def.desc} (${fmt(v)} / ${fmt(goal)})`)
      }
      toggleTitle(def.id)
      sfx.equip()
      if (state.title) hooks.onTitle?.(def)
      panel.refresh()
    })
    return c
  }
  function renderTitles(inner) {
    const owned = TITLES.filter((d) => ownsTitle(d.id))
    const unowned = TITLES.filter((d) => !ownsTitle(d.id))
    if (owned.length) {
      inner.append(section('Owned'))
      const g = el('div', 'cl-grid three')
      owned.forEach((d, i) => g.append(titleCard(d, i)))
      inner.append(g)
    }
    if (unowned.length) {
      inner.append(section('Unowned'))
      const g = el('div', 'cl-grid three')
      unowned.forEach((d, i) => g.append(titleCard(d, i)))
      inner.append(g)
    }
  }

  function trailCard(def, i) {
    const has = ownsTrail(def.id)
    const eq = state.trail === def.id
    const c = el('button', `cl-card trail ${has ? 'own' : ''} ${eq ? 'eq' : ''}`)
    c.type = 'button'
    c.style.setProperty('--bg', def.bg)
    c.style.animationDelay = `${i * 0.03}s`
    c.innerHTML = `${trailWisps(def)}<span class="nm ol">${def.name}</span><span class="pr ol">${has ? (eq ? 'EQUIPPED' : 'OWNED') : `${ICONS.trophy}${fmt(def.price)}`}</span>`
    c.addEventListener('click', () => {
      if (has) {
        toggleTrail(def.id)
        sfx.equip()
        if (state.trail) hooks.onTrail?.(def)
      } else if (buyTrail(def.id)) {
        sfx.purchase()
        hooks.onTrail?.(def, true)
      } else {
        shakeNode(c)
        return hooks.toast(`Need ${fmt(def.price)} Wins!`)
      }
      panel.refresh()
    })
    return c
  }
  function renderTrails(inner) {
    const owned = TRAILS.filter((d) => ownsTrail(d.id))
    const unowned = TRAILS.filter((d) => !ownsTrail(d.id))
    if (owned.length) {
      inner.append(section('Owned'))
      const g = el('div', 'cl-grid four')
      owned.forEach((d, i) => g.append(trailCard(d, i)))
      inner.append(g)
    }
    if (unowned.length) {
      inner.append(section('Unowned'))
      const g = el('div', 'cl-grid four')
      unowned.forEach((d, i) => g.append(trailCard(d, i)))
      inner.append(g)
    }
  }

  function header() {
    if (tab === 'skins') return [`${state.owned.length} / ${TENTACLES.length} Skins`, `Equipped: ${tentacleById(state.equipped).name}`]
    if (tab === 'items') {
      const n = itemCount()
      return [`${n} Boost${n === 1 ? '' : 's'} <i class="sep"></i> Click a boost to use`, '']
    }
    if (tab === 'titles') return [`${state.titles.length} / ${TITLES.length} Titles`, `Equipped: ${equippedTitle()?.name ?? 'none'}`]
    return [`${state.trails.length} / ${TRAILS.length} Trails`, `Equipped: ${equippedTrail()?.name ?? 'none'}`]
  }

  const panel = createPanel({
    cls: 'pn-coll',
    render(root) {
      // (After this render: marking emits 'title', which refreshes the panel without the badge.)
      if (tab === 'titles' && unseenTitles().length) queueMicrotask(markTitlesSeen)
      const wrap = el('div', 'cl-wrap')
      const side = el('div', 'cl-side')
      for (const t of TABS) {
        const b = button(`cl-tab ${t.id === tab ? 'on' : ''}`, `<span class="ti">${t.icon()}</span><span class="ol">${t.label}</span>${t.id === 'titles' && unseenTitles().length ? '<i class="bang ol">!</i>' : ''}`, () => {
          if (tab === t.id) return
          tab = t.id
          sfx.click()
          panel.refresh()
          const sc = panel.root.querySelector('.pn-scroll')
          if (sc) sc.scrollTop = 0
        })
        side.append(b)
      }
      const cur = TABS.find((t) => t.id === tab)
      const box = el('div', 'cl-panel')
      const [l, r] = header()
      box.innerHTML = `<span class="cl-icon">${cur.icon()}</span><div class="cl-title ol">My ${cur.label}</div><div class="cl-head"><span class="ol">${l}</span><span class="ol">${r}</span></div>`
      box.append(button('cl-x', '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>', () => panel.close()))
      const inner = el('div', 'cl-inner pn-scroll')
      if (tab === 'skins') renderSkins(inner)
      else if (tab === 'items') renderItems(inner)
      else if (tab === 'titles') renderTitles(inner)
      else renderTrails(inner)
      box.append(inner)
      wrap.append(side, box)
      root.append(wrap)
    },
  })

  // The HUD's Inventory button gets a "!" while there are titles you haven't looked at.
  let invDot = null
  function attachInventoryDot(button) {
    if (!button) return
    invDot = button.querySelector('.dot') ?? button.appendChild(el('i', 'dot'))
    updateDot()
  }
  function updateDot() {
    invDot?.classList.toggle('on', unseenTitles().length > 0)
  }

  onChange((kind) => {
    if (kind === 'title' || kind === 'items' || kind === 'trail' || kind === 'tentacle' || kind === 'wins' || kind === 'rebirth' || kind === 'ascend') {
      panel.refresh()
      updateDot()
    }
  })

  return {
    panel,
    open(t) {
      if (t) tab = t
      panel.open()
    },
    toggle(t) {
      if (panel.isOpen() && (!t || t === tab)) return panel.close()
      if (t) tab = t
      panel.open()
    },
    attachInventoryDot,
    updateDot,
  }
}
