// Rebirth and Ascend popups (Before -> After), every price in Wins.
// - Rebirth N: at max level, reset to Level 1 for more training XP and a higher level cap. Skip
//   Rebirth (KEEP LEVELS!) does the same but keeps your level, for skipRebirthPrice() Wins.
// - Ascend N: needs ascendCost() Wins and spends ALL of them for a damage multiplier and a bigger,
//   faster octopus. Skip Ascend (KEEP WINS!) pays ascendSkipPrice() instead and keeps the rest.
import {
  ascendCost,
  ascendDamage,
  ascendSkipPrice,
  atCap,
  canAscend,
  canRebirth,
  doAscend,
  doRebirth,
  doSkipRebirth,
  equippedTentacle,
  fmt,
  levelCap,
  maxAscend,
  onChange,
  rebirthBoost,
  skipRebirthPrice,
  state,
} from './state.js'
import { ICONS } from './hud.js'
import { bigStar, ffArrows, octoPreview } from './icons.js'
import { button, createPanel, el, framedPanel, shakeNode } from './panels.js'

const x = (n) => `x${Number(n.toFixed(2))}`

// hooks: { toast(text), onRebirth(), onAscend() }
export function createPopups(hooks) {
  // --- Rebirth -------------------------------------------------------------------------------------------
  const rebirth = createPanel({
    cls: 'pn-rebirth',
    render(root) {
      const r = state.rebirths
      const { body } = framedPanel(root, { color: 'pink', icon: ICONS.rebirth, title: `Rebirth ${r + 1}`, onClose: () => rebirth.close() })
      const cap = levelCap(r)
      body.innerHTML = `<div class="pp-warn ol">[WARNING]: Rebirth resets your level!</div>
        <div class="pp-cols"><b class="ol">Before</b><span></span><b class="ol">After</b></div>
        <div class="pp-row"><div class="pp-box orange"><i>${ICONS.bolt}</i><b class="ol">${x(rebirthBoost(r))} Training</b></div><span class="ff">${ffArrows()}</span><div class="pp-box orange"><i>${ICONS.bolt}</i><b class="ol">${x(rebirthBoost(r + 1))} Training</b></div></div>
        <div class="pp-row"><div class="pp-box blue"><i>${bigStar()}</i><b class="ol">${cap} Max Lvl</b></div><span class="ff">${ffArrows()}</span><div class="pp-box blue"><i>${bigStar()}</i><b class="ol">${levelCap(r + 1)} Max Lvl</b></div></div>
        <div class="pp-level"><i style="width:${Math.min(100, (state.level / cap) * 100).toFixed(1)}%"></i><b class="ol">Level ${state.level} / ${cap}</b></div>`
      const row = el('div', 'pp-btns')
      const go = button(`pp-btn green ${canRebirth() ? '' : 'off'}`, `<i class="bgi">${ICONS.rebirth}</i><b class="ol">Rebirth</b>`, () => {
        if (!canRebirth()) {
          shakeNode(go)
          return hooks.toast(`Reach Level ${cap} to rebirth!`)
        }
        if (doRebirth()) {
          rebirth.close()
          hooks.onRebirth?.()
        }
      })
      const price = skipRebirthPrice()
      const skip = button(`pp-btn rainbow ${atCap() ? '' : 'off'}`, `<i class="bgi">${ICONS.rebirth}</i><b class="ol">Skip Rebirth</b><small class="ol">KEEP LEVELS!</small><span class="pp-price ol">${ICONS.trophy}${fmt(price)}</span>`, () => {
        if (!canRebirth()) {
          shakeNode(skip)
          return hooks.toast(`Reach Level ${cap} first!`)
        }
        if (!doSkipRebirth()) {
          shakeNode(skip)
          return hooks.toast(`Need ${fmt(price)} Wins!`)
        }
        rebirth.close()
        hooks.onRebirth?.(true)
      })
      row.append(go, skip)
      body.append(row)
    },
  })

  // --- Ascend -------------------------------------------------------------------------------------------------
  const ascend = createPanel({
    cls: 'pn-ascend',
    render(root) {
      const t = state.ascend
      const { body } = framedPanel(root, { color: 'green', icon: ICONS.tentacle, title: maxAscend() ? `Ascend ${t}` : `Ascend ${t + 1}`, onClose: () => ascend.close() })
      const skin = equippedTentacle()
      const tierBox = (tier, after) => `<div class="pp-tier ${after ? 'after' : ''}" style="--grow:${1 + Math.min(tier, 12) * 0.035}">${octoPreview(skin)}<b class="ol">Tier ${tier}</b></div>`
      if (maxAscend()) {
        body.innerHTML = `<div class="pp-cols one"><b class="ol">Max Tier!</b></div><div class="pp-tiers">${tierBox(t, true)}</div><div class="pp-mult ol">${x(ascendDamage(t))} Damage</div>`
        return
      }
      body.innerHTML = `<div class="pp-cols"><b class="ol">Before</b><span></span><b class="ol">After</b></div>
        <div class="pp-tiers">${tierBox(t)}<span class="ff">${ffArrows()}</span>${tierBox(t + 1, true)}</div>
        <div class="pp-cols mults"><div><span class="pp-mult ol">${x(ascendDamage(t))} Damage</span></div><span></span><div><span class="pp-mult ol">${x(ascendDamage(t + 1))} Damage</span><small class="pp-sub ol">Bigger + Faster!</small></div></div>`
      const row = el('div', 'pp-btns')
      const cost = ascendCost()
      const go = button(`pp-btn yellow ${canAscend() ? '' : 'off'}`, `<i class="bgi">${ICONS.trophy}</i><b class="ol">${fmt(cost)} Wins</b>`, () => {
        if (!doAscend(false)) {
          shakeNode(go)
          return hooks.toast(`Need ${fmt(cost)} Wins to ascend (you have ${fmt(state.wins)})`)
        }
        ascend.close()
        hooks.onAscend?.()
      })
      const price = ascendSkipPrice()
      const skip = button(`pp-btn rainbow ${state.wins >= price ? '' : 'off'}`, `<i class="bgi">${ICONS.tentacle}</i><b class="ol">Skip Ascend</b><small class="ol">KEEP WINS!</small><span class="pp-price ol">${ICONS.trophy}${fmt(price)}</span>`, () => {
        if (!doAscend(true)) {
          shakeNode(skip)
          return hooks.toast(`Need ${fmt(price)} Wins!`)
        }
        ascend.close()
        hooks.onAscend?.(true)
      })
      row.append(go, skip)
      body.append(row, el('div', 'pp-note ol', 'Ascending spends ALL your Wins. Skip keeps the rest!'))
    },
  })

  onChange((kind) => {
    if (kind === 'wins' || kind === 'xp' || kind === 'level' || kind === 'rebirth' || kind === 'ascend' || kind === 'tentacle') {
      rebirth.refresh()
      ascend.refresh()
    }
  })
  return { rebirth, ascend }
}
