// A full-screen panel overlay (Daily / Playtime rewards, My Skins-Items-Titles-Trails, Rebirth,
// Ascend). Shares the windows.js "one window at a time" slot, so Esc, the HUD's windowed state and
// the audio ducking treat it like any window. The X, Esc or a tap on the backdrop closes it.
import './panels.css'
import { claimWindow, releaseWindow } from './windows.js'
import { sfx } from './audio/index.js'

export function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}
export function button(cls, html, fn) {
  const b = el('button', cls, html)
  b.type = 'button'
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    fn?.(b, e)
  })
  return b
}
export function shakeNode(node) {
  node.classList.remove('pn-shake')
  void node.offsetWidth
  node.classList.add('pn-shake')
  sfx.deny()
}

// render(root): fills the overlay (called on open and on refresh()).
export function createPanel({ cls = '', render, onOpen, onClose }) {
  const overlay = el('div', `pn-overlay ${cls}`)
  document.body.append(overlay)
  for (const type of ['pointerdown', 'wheel', 'keydown']) overlay.addEventListener(type, (e) => e.stopPropagation())
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) p.close()
  })
  const p = {
    root: overlay,
    isOpen: () => overlay.classList.contains('on'),
    open() {
      claimWindow(p)
      const was = p.isOpen()
      overlay.classList.add('on')
      p.refresh(true)
      if (!was) {
        sfx.windowOpen()
        document.exitPointerLock?.()
      }
      onOpen?.()
    },
    close() {
      if (!p.isOpen()) return
      overlay.classList.remove('on')
      releaseWindow(p)
      sfx.windowClose()
      onClose?.()
    },
    toggle() {
      if (p.isOpen()) p.close()
      else p.open()
    },
    // Rebuilds the content, keeping the scroll position of every .pn-scroll inside.
    refresh(force = false) {
      if (!force && !p.isOpen()) return
      const scrolls = [...overlay.querySelectorAll('.pn-scroll')].map((n) => n.scrollTop)
      overlay.innerHTML = ''
      render(overlay)
      overlay.querySelectorAll('.pn-scroll').forEach((n, i) => (n.scrollTop = scrolls[i] ?? 0))
    },
  }
  return p
}

// The framed style (Daily / Playtime / Rebirth / Ascend): a coloured studded header with an icon,
// the title and a red X, over a dark body. Returns { frame, body }.
export function framedPanel(root, { color, icon, title, onClose }) {
  const frame = el('div', `pn-frame pn-${color}`)
  const head = el('div', 'pn-head', `<span class="pn-icon">${icon}</span><span class="pn-title ol">${title}</span>`)
  head.append(button('pn-x', '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" stroke="#fff" stroke-width="4.4" stroke-linecap="round"/></svg>', onClose))
  const body = el('div', 'pn-body')
  frame.append(head, body)
  root.append(frame)
  return { frame, body }
}
