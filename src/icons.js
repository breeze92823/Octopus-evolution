// Inline SVG art for the reward / collection / rebirth / ascend panels (all original, procedural).
// Every function returns an <svg> string; colours come from config (DAILY / PLAYTIME / ITEMS /
// TRAILS / TENTACLES) so the art follows the catalogs.
import { ICONS } from './hud.js'

const INK = '#13163a'

// Lightens (k > 0) or darkens (k < 0) a #rrggbb colour.
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

let uid = 0
const id = (p) => `${p}${++uid}`

// A wrapped present: [box, ribbon] colours, optional gem on the lid.
export function gift([box, rib], { gem = false } = {}) {
  const dark = shade(box, -0.3)
  const lite = shade(box, 0.35)
  const rl = shade(rib, 0.45)
  return `<svg class="ic-gift" viewBox="0 0 64 64">
    <path d="M32 18c-4-10-17-14-18-6-1 7 11 8 18 6z" fill="${rib}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M32 18c4-10 17-14 18-6 1 7-11 8-18 6z" fill="${rib}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M19 12c2-2 6 0 9 4" stroke="${rl}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <rect x="11" y="31" width="42" height="28" rx="3.5" fill="${box}" stroke="${INK}" stroke-width="2.6"/>
    <path d="M13 33h38v6H13z" fill="${dark}" opacity=".55"/>
    <path d="M44 33h7v24h-7z" fill="${dark}" opacity=".35"/>
    <rect x="8" y="19" width="48" height="14" rx="3.5" fill="${box}" stroke="${INK}" stroke-width="2.6"/>
    <path d="M12 23h14" stroke="${lite}" stroke-width="3" stroke-linecap="round"/>
    <path d="M27.5 19h9v40h-9z" fill="${rib}" stroke="${INK}" stroke-width="2.6"/>
    <path d="M30 21.5v35" stroke="${rl}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M27 18h10v3H27z" fill="${shade(rib, -0.25)}"/>
    <circle cx="32" cy="18" r="4.4" fill="${rib}" stroke="${INK}" stroke-width="2.6"/>
    ${gem ? `<path d="M32 21l5.5 5.5L32 32l-5.5-5.5z" fill="#ff4fd8" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="M30 25l2-2" stroke="#ffd0f4" stroke-width="1.6" stroke-linecap="round"/>` : ''}
  </svg>`
}

// The jackpot treasure chest: gold coins, a purple gem and an octopus crest.
export function chest() {
  return `<svg class="ic-gift" viewBox="0 0 64 64">
    <path d="M9 27 13 6h38l4 21z" fill="#2a3a9a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M15 10h34l3 14H12z" fill="#1f2c7a"/>
    <path d="M13 6h38M9 27h46" stroke="#ffc21a" stroke-width="3"/>
    <circle cx="16" cy="28" r="5.2" fill="#ffd23a" stroke="#8a5a00" stroke-width="2"/>
    <circle cx="48" cy="28" r="5.2" fill="#ffd23a" stroke="#8a5a00" stroke-width="2"/>
    <circle cx="24" cy="24" r="5.2" fill="#ffe066" stroke="#8a5a00" stroke-width="2"/>
    <circle cx="40" cy="24" r="5.2" fill="#ffe066" stroke="#8a5a00" stroke-width="2"/>
    <circle cx="32" cy="27" r="5.2" fill="#ffd23a" stroke="#8a5a00" stroke-width="2"/>
    <path d="M32 9l7 7.5-7 8.5-7-8.5z" fill="#a23aff" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M29 15l3-3" stroke="#e6c4ff" stroke-width="2" stroke-linecap="round"/>
    <rect x="8" y="29" width="48" height="28" rx="4" fill="#2f45b8" stroke="${INK}" stroke-width="2.6"/>
    <path d="M8 35h48" stroke="${INK}" stroke-width="2.4"/>
    <path d="M10 31h44v3H10z" fill="#ffc21a"/>
    <path d="M14 29v28M50 29v28" stroke="#ffc21a" stroke-width="4"/>
    <circle cx="32" cy="45" r="8.5" fill="#ffc21a" stroke="${INK}" stroke-width="2.4"/>
    <path d="M27 45c0-3 2-5 5-5s5 2 5 5M27 45c-2 2-1 5-3 5M30 46c-1 2 0 5-2 6M34 46c1 2 0 5 2 6M37 45c2 2 1 5 3 5" fill="none" stroke="#8a5a00" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="30" cy="44" r="0.9" fill="#8a5a00"/><circle cx="34" cy="44" r="0.9" fill="#8a5a00"/>
  </svg>`
}

// A tear-off calendar showing `day`.
export function calendar(day) {
  return `<svg viewBox="0 0 64 64">
    <rect x="6" y="11" width="52" height="47" rx="7" fill="#fff" stroke="${INK}" stroke-width="3"/>
    <path d="M6 18a7 7 0 0 1 7-7h38a7 7 0 0 1 7 7v7H6z" fill="#ff3b4a" stroke="${INK}" stroke-width="3"/>
    <rect x="16" y="5" width="6" height="13" rx="3" fill="#c9cfe0" stroke="${INK}" stroke-width="2.4"/>
    <rect x="42" y="5" width="6" height="13" rx="3" fill="#c9cfe0" stroke="${INK}" stroke-width="2.4"/>
    <text x="32" y="50" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="22" fill="${INK}">${day}</text>
  </svg>`
}

// --- Items -------------------------------------------------------------------------------------------------
const STAR = 'M32 14 38.5 29.1 54.8 30.6 42.5 41.4 46.1 57.4 32 49 17.9 57.4 21.5 41.4 9.2 30.6 25.5 29.1Z'
const STAR_COLORS = { red: ['#ff2d4a', '#ff8a9a'], indigo: ['#2a6cff', '#9ad0ff'], green: ['#2ec44a', '#a6ff8a'] }
function starPotion(color) {
  const [c, l] = STAR_COLORS[color]
  const g = id('sp')
  return `<svg viewBox="0 0 64 64"><defs><radialGradient id="${g}" cx="42%" cy="38%" r="68%"><stop offset="0" stop-color="${shade(l, 0.55)}"/><stop offset=".35" stop-color="${l}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.5)}"/></radialGradient></defs>
    <rect x="27" y="5" width="10" height="9" rx="2" fill="#c9783a" stroke="${INK}" stroke-width="2.4"/>
    <rect x="25" y="3" width="14" height="4" rx="2" fill="#ffc21a" stroke="${INK}" stroke-width="2"/>
    <path d="${STAR}" fill="url(#${g})" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="${STAR}" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" opacity=".45" transform="translate(32 38) scale(.8) translate(-32 -38)"/>
    <path d="M22 34l4-3M27 30.5l2-1" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
    <circle cx="38" cy="44" r="1.6" fill="#fff" opacity=".7"/><circle cx="30" cy="40" r="1.1" fill="#fff" opacity=".6"/>
  </svg>`
}
function boltPotion() {
  const g = id('bp')
  return `<svg viewBox="0 0 64 64"><defs><radialGradient id="${g}" cx="40%" cy="40%" r="70%"><stop offset="0" stop-color="#b8f0ff"/><stop offset=".55" stop-color="#3aa8ff"/><stop offset="1" stop-color="#1a5ad0"/></radialGradient></defs>
    <rect x="25" y="4" width="14" height="5" rx="2" fill="#ffc21a" stroke="${INK}" stroke-width="2"/>
    <path d="M26 8h12v9c9 3 15 10 15 19a21 21 0 0 1-42 0c0-9 6-16 15-19z" fill="url(#${g})" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M35 24 24 39h8l-3 12 12-16h-8z" fill="#ffd21a" stroke="#5a3200" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M18 32c1-4 4-7 7-8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".8"/>
    <circle cx="44" cy="44" r="2" fill="#fff" opacity=".6"/><circle cx="20" cy="44" r="1.3" fill="#fff" opacity=".6"/>
  </svg>`
}
export function itemIcon(def) {
  if (def.id === 'train') return boltPotion()
  return starPotion(def.color)
}

export function plusLvl() {
  return `<svg viewBox="0 0 64 64"><path d="M24 6h16v18h18v16H40v18H24V40H6V24h18z" fill="#2a8aff" stroke="${INK}" stroke-width="3" stroke-linejoin="round" transform="rotate(-8 32 32)"/>
    <path d="M27 10v16H11" stroke="#9ad6ff" stroke-width="3.4" fill="none" stroke-linecap="round" transform="rotate(-8 32 32)"/></svg>`
}
export function check() {
  return `<svg viewBox="0 0 64 64"><path d="M6 34l10-10 11 11L50 10l10 10-33 34z" fill="#3ad64a" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/><path d="M10 34l6-6 11 11" stroke="#b6ff9a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`
}
export function lock() {
  return `<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="#ffc21a" stroke-width="2.6"/><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="#ffc21a" stroke="#5a3200" stroke-width="1.6"/><circle cx="12" cy="15.5" r="1.8" fill="#5a3200"/></svg>`
}
export function fire() {
  return `<svg viewBox="0 0 64 64"><path d="M32 4c4 12 18 18 18 34a18 18 0 0 1-36 0c0-8 4-13 8-16 0 6 3 9 6 9-2-10 2-20 4-27z" fill="#ff5a1a" stroke="#7a1a00" stroke-width="2.6" stroke-linejoin="round"/><path d="M32 30c3 6 10 9 10 17a10 10 0 0 1-20 0c0-5 3-7 5-9 1 3 2 4 4 4-1-5 0-9 1-12z" fill="#ffd21a"/></svg>`
}
export function bigStar() {
  const g = id('st')
  return `<svg viewBox="0 0 64 64"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a0"/><stop offset=".5" stop-color="#ffcf1a"/><stop offset="1" stop-color="#e89a00"/></linearGradient></defs><path d="${STAR}" transform="translate(0 -6) scale(1 1.04)" fill="url(#${g})" stroke="#8a5a00" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 30l5-3" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>`
}
export function burst() {
  return `<svg viewBox="0 0 64 64"><path d="M32 4l6 14 14-8-4 15 14 5-13 7 9 13-15-2-1 14-10-11-10 11-1-14-15 2 9-13L2 30l14-5-4-15 14 8z" fill="#ff7a1a" stroke="#7a1a00" stroke-width="2.4" stroke-linejoin="round"/><path d="M32 18l4 8 8-2-4 8 7 5-9 1 1 9-7-6-7 6 1-9-9-1 7-5-4-8 8 2z" fill="#ffd21a"/></svg>`
}
export function ffArrows() {
  return `<svg viewBox="0 0 64 40"><path d="M4 4l26 16L4 36z" fill="#fff" stroke="#2a6cff" stroke-width="3" stroke-linejoin="round"/><path d="M30 4l28 16-28 16z" fill="#fff" stroke="#2a6cff" stroke-width="3" stroke-linejoin="round"/><path d="M8 10v20" stroke="#9ad6ff" stroke-width="3" stroke-linecap="round"/></svg>`
}
// The bonus-kind icon of a title: train = bolt, damage = burst, wins = trophy.
export const bonusIcon = (kind) => (kind === 'train' ? ICONS.bolt : kind === 'damage' ? burst() : ICONS.trophy)

// A cute purple octopus head (the Skins tab).
export function octoFace(base = '#a259ff', dark = '#6a2fd0') {
  return `<svg viewBox="0 0 64 64">
    <path d="M12 40c-6 4-8 10-3 12M20 44c-3 6-2 12 3 12M44 44c3 6 2 12-3 12M52 40c6 4 8 10 3 12M28 46c-1 6 0 10 4 11M36 46c1 6 0 10-4 11" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M12 40c-6 4-8 10-3 12M20 44c-3 6-2 12 3 12M44 44c3 6 2 12-3 12M52 40c6 4 8 10 3 12M28 46c-1 6 0 10 4 11M36 46c1 6 0 10-4 11" fill="none" stroke="${base}" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="32" cy="30" rx="21" ry="19" fill="${base}" stroke="${INK}" stroke-width="2.8"/>
    <ellipse cx="25" cy="31" rx="5" ry="6" fill="#fff" stroke="${INK}" stroke-width="2"/><ellipse cx="39" cy="31" rx="5" ry="6" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <circle cx="26" cy="32" r="2.6" fill="${INK}"/><circle cx="40" cy="32" r="2.6" fill="${INK}"/>
    <path d="M28 41c2 2 6 2 8 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M18 22c3-6 9-8 14-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".55"/>
  </svg>`
}

// A trail: three swooshing tentacle wisps in the trail's gradient, with sparkles.
export function trailWisps(def) {
  const g = id('tr')
  const stops = def.colors.map((c, i) => `<stop offset="${(i / Math.max(1, def.colors.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')
  const wisp = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 3}" stroke-linecap="round" opacity=".35"/><path d="${d}" fill="none" stroke="url(#${g})" stroke-width="${w}" stroke-linecap="round"/>`
  return `<svg class="thumb" viewBox="0 0 120 80"><defs><linearGradient id="${g}" x1="1" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
    ${wisp('M10 62c18-4 30-14 46-26 14-10 30-14 44-8 10 4 6 16-3 14-6-1-6-8-1-9', 9)}
    ${wisp('M18 72c22-2 40-12 58-22 12-6 24-6 30 0', 6)}
    ${wisp('M6 50c16-6 26-18 40-26 12-6 24-6 30 2 5 7-3 12-8 8', 5)}
    <circle cx="92" cy="30" r="2.6" fill="#fff"/><circle cx="64" cy="46" r="1.8" fill="#fff"/><circle cx="40" cy="38" r="1.5" fill="#fff" opacity=".8"/>
    <path d="M100 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff"/><path d="M28 56l1.4 3.4 3.4 1.4-3.4 1.4L28 66l-1.4-3.8-3.4-1.4 3.4-1.4z" fill="#fff" opacity=".9"/>
  </svg>`
}

// The octopus seen from the front in a tentacle skin's colours (Ascend tiers).
export function octoPreview(skin) {
  const c = skin.colors
  // Eight arms fanned around the body (seen from the front, slightly above), each curling up at the tip.
  const arms = []
  for (let i = 0; i < 8; i++) {
    const ang = Math.PI * (1.16 - (i / 7) * 1.32) // left to right, the outer pairs reaching up
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const side = cos < 0 ? -1 : 1
    const len = i % 2 ? 0.82 : 1
    const ex = 60 + cos * 50 * len
    const ey = 52 + sin * 24 * len
    const mx = 60 + cos * 26 * len
    const my = 56 + sin * 18 * len
    const f = (n) => n.toFixed(1)
    arms.push(`M${f(60 + cos * 6)} ${f(50 + sin * 3)}Q${f(mx)} ${f(my + 6)} ${f(ex)} ${f(ey)}q${f(side * 5)} -1 ${f(side * 3)} -7q${f(-side * 2)} -3 ${f(-side * 4)} 0`)
  }
  const d = arms.join('')
  return `<svg class="octo" viewBox="0 0 120 80">
    <path d="${d}" fill="none" stroke="${shade(c.base, -0.45)}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${c.base}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${c.belly}" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>
    <ellipse cx="60" cy="44" rx="15" ry="14" fill="${c.base}" stroke="${shade(c.base, -0.45)}" stroke-width="2"/>
    <ellipse cx="55" cy="38" rx="5" ry="4" fill="${shade(c.base, 0.45)}" opacity=".7"/>
    <ellipse cx="55" cy="47" rx="2.4" ry="3" fill="#fff"/><ellipse cx="65" cy="47" rx="2.4" ry="3" fill="#fff"/>
    <circle cx="55.4" cy="47.6" r="1.4" fill="${INK}"/><circle cx="65.4" cy="47.6" r="1.4" fill="${INK}"/>
  </svg>`
}

// A tentacle curl (the Ascend header).
export const ascendIcon = () => ICONS.tentacle
