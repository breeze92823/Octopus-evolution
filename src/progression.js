// Glue for the meta-progression features, so main.js only creates this and calls update(dt):
// Daily / Playtime rewards (rewards.js), the My Skins-Items-Titles-Trails window (collection.js),
// the Rebirth / Ascend popups (popups.js), the trail + title in the world (flair.js), the HUD menu
// buttons (Ascend, Daily, Gifts + "!" dots), the boost timers on the HUD, title unlocks and the
// boosts' effect on walking speed.
import { Vector3 } from 'three'
import { ITEMS } from './config.js'
import {
  ascendDamage,
  boostLeft,
  canAscend,
  checkTitles,
  equippedTitle,
  equippedTrail,
  fmtTime,
  onChange,
  speedMult,
  state,
  tickBoosts,
} from './state.js'
import { ICONS } from './hud.js'
import { itemIcon } from './icons.js'
import { createRewards } from './rewards.js'
import { createCollection } from './collection.js'
import { createPopups } from './popups.js'
import { createFlair } from './flair.js'
import { anyWindowOpen } from './windows.js'
import { sfx } from './audio/index.js'

// ctx: { scene, camera, hud, octo, fx, player, onTentacle(def), onRebirth(skipped) }
export function createProgression(ctx) {
  const { scene, camera, hud, octo, fx, player } = ctx
  const tmp = new Vector3()
  const at = () => tmp.set(player.renderPosition.x, 0.5, player.renderPosition.z)
  const toast = (t) => hud.toast(t)
  const announce = (a, b, s) => hud.announce(a, b, s)

  function sparkle(colors = ['#ffe066', '#ffffff', '#7dff6a', '#ff6ad8']) {
    octo.pulse()
    fx.motes(at(), { count: 36, colors, radius: 2.4, height: 2.2 })
    fx.ring(tmp.set(player.renderPosition.x, 0, player.renderPosition.z), { radius: 8, color: '#ffe9a0', life: 0.6 })
  }

  const rewards = createRewards({ toast, announce, celebrate: () => sparkle() })
  const flair = createFlair(scene)
  const collection = createCollection({
    toast,
    announce,
    onBuyTentacle: (def) => ctx.onTentacle?.(def),
    onTrail: (def, bought) => {
      if (bought) {
        announce(def.name.toUpperCase(), 'Trail unlocked!', 'win')
        sparkle(def.colors)
      }
    },
    onTitle: (def) => toast(`Title equipped: ${def.name}`),
  })
  const popups = createPopups({
    toast,
    onRebirth: (skipped) => ctx.onRebirth?.(skipped),
    onAscend: () => {
      sfx.rebirth()
      announce(`ASCEND ${state.ascend}!`, `x${Number(ascendDamage().toFixed(2))} Damage · Bigger + Faster!`, 'lvl')
      sparkle(['#7dff3a', '#ffffff', '#6ae6ff', '#ffe066'])
      fx.ring(tmp.set(player.renderPosition.x, 0, player.renderPosition.z), { radius: 16, color: '#9dff6a', life: 0.9 })
      fx.shake(0.45)
    },
  })

  // --- HUD menu: Ascend, Daily, Gifts (after Rebirth / Shop / Inventory) ------------------------------
  const menu = hud.root.querySelector('.hud-menu')
  let ascendDot = null
  if (menu) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'pressable'
    b.innerHTML = `${ICONS.tentacle}<span class="ol">Ascend</span><i class="dot"></i>`
    b.addEventListener('pointerdown', (e) => e.stopPropagation())
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      popups.ascend.toggle()
    })
    menu.append(b)
    ascendDot = b.querySelector('.dot')
    rewards.addMenuButtons(menu)
    const inv = [...menu.querySelectorAll('button')].find((x) => /inventory/i.test(x.textContent))
    collection.attachInventoryDot(inv)
  }

  // --- Boost timers (bottom right) ---------------------------------------------------------------------
  const list = document.createElement('div')
  list.className = 'bt-list'
  hud.root.append(list)
  const rows = ITEMS.map((def) => {
    const row = document.createElement('div')
    row.className = 'bt'
    row.innerHTML = `${itemIcon(def)}<span class="ol"></span>`
    row.style.display = 'none'
    list.append(row)
    return { def, row, span: row.querySelector('span'), shown: '' }
  })
  function renderTimers() {
    for (const r of rows) {
      const left = boostLeft(r.def.id)
      const txt = left > 0 ? `${r.def.name} ${fmtTime(left)}` : ''
      if (txt === r.shown) continue
      r.shown = txt
      r.row.style.display = txt ? '' : 'none'
      r.span.textContent = txt
    }
  }

  // --- Flair + titles ---------------------------------------------------------------------------------------
  flair.setTrail(equippedTrail())
  flair.setTitle(equippedTitle())
  let titleDirty = true
  onChange((kind, detail) => {
    if (kind === 'trail') flair.setTrail(equippedTrail())
    if (kind === 'title') {
      flair.setTitle(equippedTitle())
      if (Array.isArray(detail)) {
        // Newly earned titles (state.checkTitles).
        const def = detail[detail.length - 1]
        sfx.unlock()
        announce('NEW TITLE!', detail.length > 1 ? `${def.name} +${detail.length - 1} more` : `${def.name} · +${def.pct}% ${def.bonus === 'train' ? 'Train' : def.bonus === 'damage' ? 'Damage' : 'Wins'}`, 'win')
      }
    }
    if (kind !== 'tick') titleDirty = true
    if (kind === 'wins' || kind === 'ascend') ascendDot?.classList.toggle('on', canAscend())
  })
  ascendDot?.classList.toggle('on', canAscend())

  let slow = 0
  let clock = 0
  let autoOpenTried = false
  return {
    rewards,
    collection,
    popups,
    flair,
    update(dt) {
      clock += dt
      tickBoosts(dt)
      player.speedMult = speedMult()
      rewards.update(dt)
      flair.update(dt, { at: player.renderPosition, scale: octo.scale ?? 1, camera, seat: octo.seat })
      slow += dt
      if (slow >= 0.5) {
        slow = 0
        renderTimers()
        if (titleDirty) {
          titleDirty = false
          checkTitles()
        }
      }
      // A daily reward waiting: open the calendar once, a moment after the game (and the server) is up.
      if (!autoOpenTried && clock > 4 && !anyWindowOpen()) {
        autoOpenTried = true
        rewards.maybeAutoOpen()
      }
    },
  }
}
