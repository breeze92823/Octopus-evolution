// Health bars that float over characters: pooled DOM elements projected from a
// world point every frame (crisp text at any size, cheap to update).
// A bar: dark pill, coloured fill with a lagging "damage" ghost, name above,
// "hp / max" inside. kind: 'enemy' (green) | 'boss' (red) | 'player' (green, wider).
import { Vector3 } from 'three'
import { fmt } from './state.js'

const CSS = `
.hpb { position: fixed; left: 0; top: 0; z-index: 5; pointer-events: none; transform-origin: 50% 100%; font-family: 'Fredoka', sans-serif; font-weight: 700; color: #fff; text-align: center; will-change: transform; }
.hpb-name { font-size: 11px; line-height: 1.1; -webkit-text-stroke: 3px #10203a; paint-order: stroke fill; margin-bottom: 2px; white-space: nowrap; }
.hpb-bar { position: relative; width: 92px; height: 15px; border-radius: 8px; background: #1b2130; border: 2px solid #0b1020; overflow: hidden; box-shadow: 0 2px 0 rgba(0,0,0,.25); }
.hpb-ghost, .hpb-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; }
.hpb-ghost { background: #ffe9a8; transition: width .45s ease .12s; }
.hpb-fill { background: linear-gradient(#7dff6a, #2fd14a 60%, #1ea83a); transition: width .08s linear; }
.hpb.boss .hpb-fill { background: linear-gradient(#ff7a6a, #ff3a3a 60%, #c41a1a); }
.hpb.player .hpb-bar { width: 128px; }
.hpb.player .hpb-name { font-size: 12px; }
.hpb-text { position: absolute; inset: 0; font-size: 10px; line-height: 15px; -webkit-text-stroke: 2.5px #10203a; paint-order: stroke fill; white-space: nowrap; }
.hpb.low .hpb-fill { background: linear-gradient(#ffd36a, #ff9a2a 60%, #e0700f); }
`

export function createBars(camera) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  const pool = []
  const live = new Set()
  const v = new Vector3()

  function make() {
    const el = document.createElement('div')
    el.className = 'hpb'
    el.innerHTML = '<div class="hpb-name"></div><div class="hpb-bar"><div class="hpb-ghost"></div><div class="hpb-fill"></div><div class="hpb-text"></div></div>'
    document.body.appendChild(el)
    return {
      el,
      name: el.querySelector('.hpb-name'),
      ghost: el.querySelector('.hpb-ghost'),
      fill: el.querySelector('.hpb-fill'),
      text: el.querySelector('.hpb-text'),
      pos: new Vector3(),
      lastPct: -1,
      lastText: '',
    }
  }

  return {
    // Returns a handle: { set(hp, max), at(x, y, z), remove() }.
    add(name, kind = 'enemy') {
      const b = pool.pop() ?? make()
      b.el.className = `hpb ${kind}`
      b.el.style.display = ''
      b.name.textContent = name
      b.lastPct = -1
      b.lastText = ''
      live.add(b)
      return {
        set(hp, max) {
          const pct = Math.max(0, Math.min(1, hp / max))
          const p = Math.round(pct * 1000) / 10
          if (p !== b.lastPct) {
            b.fill.style.width = `${p}%`
            b.ghost.style.width = `${p}%`
            b.el.classList.toggle('low', pct < 0.3 && kind !== 'boss')
            b.lastPct = p
          }
          const text = `${fmt(Math.max(0, hp))} / ${fmt(max)}`
          if (text !== b.lastText) {
            b.text.textContent = text
            b.lastText = text
          }
        },
        at(x, y, z) {
          b.pos.set(x, y, z)
        },
        show(on) {
          b.el.style.visibility = on ? '' : 'hidden'
        },
        remove() {
          if (!live.has(b)) return
          live.delete(b)
          b.el.style.display = 'none'
          b.el.style.visibility = ''
          pool.push(b)
        },
      }
    },
    update() {
      const w = window.innerWidth
      const h = window.innerHeight
      const s = Math.max(0.8, Math.min(1.25, Math.min(w, h) / 700))
      for (const b of live) {
        v.copy(b.pos).project(camera)
        if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
          b.el.style.opacity = '0'
          continue
        }
        b.el.style.opacity = '1'
        const x = (v.x * 0.5 + 0.5) * w
        const y = (-v.y * 0.5 + 0.5) * h
        b.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`
      }
    },
  }
}
