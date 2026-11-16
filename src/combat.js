// Fighting: the lane's stage waves, the hub boss event, bandit AI and the
// octopus's two attacks.
//
// The lane is a run: walking into stage s (once stage s-1 is cleared this run)
// drops its wave of bandits; clearing it opens the gate and lights the stage's
// two pads (Wins / XP). Stepping on a lit pad cashes it in and sends you home;
// walking on starts the next, harder stage. Leaving the lane (or dying without
// a revive) ends the run and closes every gate again.
//
// Bandits chase, wind up an attack with a ground telegraph (rect swing, line
// shot, circle smash) and hit whatever is inside it when it fills, so a player
// who moves can dodge. The octopus slaps the nearest bandit in reach
// automatically; E (THROW) grabs the bandits around it, lifts them and slams
// them into the ground for big damage on a cooldown.
import { Vector3 } from 'three'
import { COMBAT, HUB_BOSS, LANE, STAGES, gateZ, padZ, stageStartZ } from './config.js'
import {
  addWins,
  bumpStat,
  addXp,
  armsFor,
  banditStats,
  bossName,
  clearStage,
  damageFor,
  playerDamage,
  winsMult,
  fmt,
  hubBossReward,
  isBossStage,
  maxHpFor,
  revengePrice,
  revivePrice,
  spendWins,
  stageBanditCount,
  stageRec,
  stageWins,
  stageXp,
  state,
  onChange,
} from './state.js'
import { buildBandit, buildTelegraphPool } from './enemies.js'
import { sfx } from './audio/index.js'
import * as bloxity from './bloxity.js'

const rnd = (a, b) => a + Math.random() * (b - a)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const E = COMBAT.enemy

export function createCombat({ scene, octo, fx, bars, lane, hud, player, teleportHome }) {
  const enemies = []
  const telegraphs = buildTelegraphPool(scene, 18)
  const events = [] // { at, fn }
  let time = 0
  const run = { cleared: 0, wave: 0, inLane: false }
  const hub = { boss: null, pending: false }
  let playerMax = maxHpFor(state.level)
  let playerHp = playerMax
  let dead = false
  let slapTimer = 0.4
  let throwCd = 0
  let playerBar = null
  let reviveClose = null
  const tv = new Vector3()
  const tv2 = new Vector3()

  const later = (delay, fn) => events.push({ at: time + delay, fn })

  onChange((kind) => {
    if (kind === 'level' || kind === 'rebirth') {
      const ratio = playerHp / playerMax
      playerMax = maxHpFor(state.level)
      playerHp = Math.max(1, ratio * playerMax)
    }
  })

  // --- Helpers ------------------------------------------------------------------------
  const px = () => player.renderPosition.x
  const pz = () => player.renderPosition.z
  const alive = (e) => e.state !== 'dead' && e.state !== 'gone'
  const bodyR = () => 1.0 + 0.35 * (octo.reach / COMBAT.reach - 1) // the octopus gets easier to hit as it grows
  const panOf = (x, z) => {
    // Rough stereo position relative to the camera-free player frame: left/right of travel.
    const dx = x - px()
    return clamp(dx / 12, -0.7, 0.7)
  }
  const chest = (e, out) => out.set(e.x, e.y + e.model.height * 0.55, e.z)
  const aliveInWave = () => enemies.filter((e) => alive(e) && e.wave === run.wave && !e.hubBoss).length

  function bounds(e) {
    const s = e.stage // the hub boss carries the stage it landed in, so it stays inside the lane
    return [-LANE.halfWidth + 0.8, LANE.halfWidth - 0.8, gateZ(s) + 1.5, stageStartZ(s) + 18]
  }

  // --- Spawning -------------------------------------------------------------------------
  function spawnEnemy(kind, x, z, hp, hit, opts = {}) {
    const model = buildBandit(kind, Math.random())
    scene.add(model.group)
    const e = {
      model,
      kind,
      boss: model.boss,
      hubBoss: !!opts.hubBoss,
      stage: opts.stage ?? 0,
      wave: opts.wave ?? 0,
      ranged: kind === 'gunner',
      x,
      z,
      y: opts.dropFrom ?? 7,
      vy: 0,
      yaw: Math.PI, // face south (toward the player coming up the lane)
      hp,
      max: hp,
      hit,
      state: 'spawn',
      t: -(opts.delay ?? 0),
      cooldown: rnd(0.6, 1.6),
      tele: null,
      teleShape: null,
      teleA: 0,
      teleB: 0,
      teleX: 0,
      teleZ: 0,
      teleYaw: 0,
      grabIndex: -1,
      fling: { x: 0, y: 0, z: 0, spin: 0 },
      bar: bars.add(opts.name ?? model.name, model.boss ? 'boss' : 'enemy'),
      speed: 0,
    }
    e.bar.set(hp, hp)
    e.bar.show(false)
    model.group.position.set(x, e.y, z)
    enemies.push(e)
    return e
  }

  function waveKinds(s, n) {
    const kinds = []
    for (let i = 0; i < n; i++) {
      const r = Math.random()
      if (s === 1) kinds.push(i === n - 1 ? 'masked' : 'thug')
      else if (s === 2) kinds.push(r < 0.5 ? 'thug' : 'masked')
      else kinds.push(r < 0.38 ? 'thug' : r < 0.72 ? 'masked' : 'gunner')
    }
    return kinds
  }

  function startWave(s) {
    run.wave++
    const n = stageBanditCount(s)
    const stats = banditStats(s)
    const kinds = waveKinds(s, n)
    const zNear = stageStartZ(s) - 22
    const zFar = padZ(s) + 6
    kinds.forEach((kind, i) => {
      const z = rnd(zFar, zNear)
      const x = rnd(-LANE.halfWidth + 1.5, LANE.halfWidth - 1.5)
      const hpVar = rnd(0.92, 1.08)
      spawnEnemy(kind, x, z, stats.hp * hpVar * (kind === 'gunner' ? 0.8 : 1), stats.hit * (kind === 'gunner' ? 0.8 : 1), { stage: s, wave: run.wave, delay: i * 0.12 })
    })
    let bossE = null
    if (isBossStage(s)) {
      const tier = Math.min(3, Math.floor(s / STAGES.bossEvery))
      bossE = spawnEnemy(`boss${tier}`, 0, padZ(s) + 9, stats.bossHp, stats.bossHit, { stage: s, wave: run.wave, delay: 0.9, name: bossName(s), dropFrom: 14 })
      later(1.1, () => sfx.bossRoar())
      hud.bossBar(bossName(s), bossE.hp, bossE.max)
    }
    const total = n + (bossE ? 1 : 0)
    lane.stages[s - 1].setGate({ open: false, left: total })
    hud.announce(`STAGE ${s}`, `Recommended Level ${stageRec(s)}`, bossE ? 'boss' : 'stage')
    sfx.stageStart(!!bossE)
    hud.setCombat({ on: true, leave: true })
    run.active = s
  }

  function spawnHubBoss() {
    hub.pending = false
    const L = state.level
    const hp = damageFor(L) * HUB_BOSS.hpSlaps
    const hit = maxHpFor(L) * HUB_BOSS.hitShare
    // It lands in the lane, ahead of the player (never in the hub).
    const s = Math.min(STAGES.count, run.cleared + 1)
    const z = Math.max(gateZ(s) + 4, pz() - HUB_BOSS.spawnAhead)
    const b = spawnEnemy('giant', 0, z, hp, hit, { hubBoss: true, stage: s, name: HUB_BOSS.name, dropFrom: 26 })
    hub.boss = b
    hud.announce('BOSS FIGHT!', `${HUB_BOSS.name} has landed!`, 'boss')
    hud.setCombat({ on: true, leave: true })
    later(0.9, () => sfx.bossRoar())
    hud.bossBar(HUB_BOSS.name, hp, hp)
  }

  // --- Damage -----------------------------------------------------------------------------
  function hurtEnemy(e, dmg, kind = 'dmg', knock = 0.35) {
    if (!alive(e)) return
    e.hp -= dmg
    e.model.flash()
    e.bar.set(e.hp, e.max)
    chest(e, tv)
    fx.number(tv.set(e.x, e.y + e.model.height + 0.3, e.z), fmt(dmg), kind, kind === 'big' ? 1.15 : 1)
    if (e.boss) hud.bossBar(e.model.name === undefined ? '' : e.hubBoss ? HUB_BOSS.name : bossName(e.stage), Math.max(0, e.hp), e.max)
    // Knockback away from the player (bosses barely move).
    const dx = e.x - px()
    const dz = e.z - pz()
    const d = Math.hypot(dx, dz) || 1
    const k = e.boss ? knock * 0.15 : knock
    e.x += (dx / d) * k
    e.z += (dz / d) * k
    if (e.state === 'chase' || e.state === 'idle') {
      e.hurtT = 0.16
    }
    sfx.enemyHurt(panOf(e.x, e.z))
    if (e.hp <= 0) kill(e)
  }

  function kill(e) {
    if (!alive(e)) return
    if (e.tele) {
      telegraphs.hide(e.tele)
      e.tele = null
    }
    e.state = 'dead'
    e.t = 0
    e.bar.remove()
    const dx = e.x - px()
    const dz = e.z - pz()
    const d = Math.hypot(dx, dz) || 1
    const sp = e.boss ? 3 : rnd(7, 11)
    e.fling.x = (dx / d) * sp
    e.fling.z = (dz / d) * sp
    e.fling.y = e.boss ? 4 : rnd(7, 10)
    e.fling.spin = rnd(-1, 1) * (e.boss ? 2 : 9)
    // Title counters (state.stats): bandits, stage bosses, giant bandits.
    bumpStat(e.hubBoss ? 'giants' : e.boss ? 'bosses' : 'kills')
    if (e.boss) {
      sfx.bossDie()
      hud.bossBar(null)
      chest(e, tv)
      fx.slam(tv.set(e.x, 0, e.z), 1.6)
      fx.sparks(tv.set(e.x, e.model.height * 0.6, e.z), { count: 50, colors: ['#ffffff', '#ffe066', '#ff9a3d', '#ff4fd8'], speed: 14, size: 0.7, up: 6 })
    } else sfx.enemyDie(panOf(e.x, e.z))

    if (e.hubBoss) {
      hub.boss = null
      const reward = addWins(hubBossReward())
      state.bossTimer = HUB_BOSS.every
      later(0.6, () => {
        hud.announce('BOSS DEFEATED!', `+${fmt(reward)} Wins`, 'win')
        sfx.wins(reward)
        fx.motes(tv.set(px(), 1, pz()), { count: 40, colors: ['#ffe066', '#ffffff', '#ffb52e'], radius: 2.5, height: 2 })
      })
      if (!run.inLane) hud.setCombat({ on: false })
      return
    }
    if (e.wave === run.wave && run.active) {
      const left = aliveInWave()
      lane.stages[run.active - 1].setGate({ open: false, left })
      const s = run.active
      if (left === 0) later(0.5, () => waveCleared(s))
    }
  }

  function waveCleared(s) {
    if (!s || run.active !== s) return // the run ended (or moved on) before the delay ran out
    run.active = 0
    run.cleared = s
    clearStage(s)
    telegraphs.hideAll()
    const st = lane.stages[s - 1]
    st.setGate({ open: true, left: 0 })
    st.pads[0].setText(`+${fmt(Math.round(stageWins(s) * winsMult()))} Wins`)
    st.pads[1].setText(`+${fmt(stageXp(s))} XP`)
    st.pads[0].setActive(true)
    st.pads[1].setActive(true)
    hud.bossBar(null)
    const last = s >= STAGES.count
    hud.announce(last ? 'LANE CONQUERED!' : 'WAVE CLEARED!', last ? 'Grab your win, champion!' : 'Grab your win, or run on!', 'win')
    sfx.waveCleared()
    later(0.35, () => sfx.gateOpen())
    fx.motes(tv.set(px(), 1, pz()), { count: 26, colors: ['#ffe066', '#9dff6a', '#ffffff'], radius: 2.5 })
  }

  function hurtPlayer(amount, from) {
    if (dead) return
    playerHp -= amount
    octo.hurt()
    hud.hurtFlash()
    fx.shake(0.28)
    fx.number(tv.set(px(), 2.4 + octo.reach * 0.2, pz()), `-${fmt(amount)}`, 'hurt', 0.9)
    sfx.playerHurt()
    if (from) fx.sparks(tv.set(px(), 1.2, pz()), { count: 8, colors: ['#ff4a4a', '#ffffff'], speed: 5, size: 0.35 })
    if (playerHp <= 0) die()
  }

  // --- Death and revive -----------------------------------------------------------------------
  function die() {
    dead = true
    playerHp = 0
    sfx.playerDie()
    telegraphs.hideAll()
    for (const e of enemies) {
      e.tele = null
      if (alive(e) && e.state !== 'spawn') {
        e.state = 'idle'
        e.t = 0
      }
    }
    const s = run.active || run.cleared || 1
    const rp = revivePrice(s)
    const vp = revengePrice(s)
    const gate = bloxity.showDeathScreen() // Boxity's banners + countdown; null outside Boxity
    const closeHud = hud.revive({
      gate,
      seconds: COMBAT.reviveSeconds,
      revivePrice: rp,
      revengePrice: vp,
      onRevive: () => {
        if (!spendWins(rp)) return false
        reviveClose = null
        revive(false)
        return true
      },
      onRevenge: () => {
        if (!spendWins(vp)) return false
        reviveClose = null
        revive(true)
        return true
      },
      onNo: () => {
        reviveClose = null
        endRun()
        teleportHome()
        playerHp = playerMax
        dead = false
      },
      // A rewarded ad (Boxity plays it) buys a free revive; granted only when the whole ad was watched.
      onAd: bloxity.adsAvailable() ? async () => (await bloxity.showRewardedAd('revive')).status === 'completed' : null,
      onAdRevive: () => {
        reviveClose = null
        revive(false)
      },
    })
    reviveClose = () => {
      closeHud()
      gate?.hide()
    }
  }

  function revive(revenge) {
    dead = false
    playerHp = playerMax
    sfx.revive()
    fx.motes(tv.set(px(), 0.5, pz()), { count: 36, colors: ['#6affb0', '#ffffff', '#aaffea'], radius: 2.2, height: 2.2 })
    fx.ring(tv.set(px(), 0, pz()), { radius: 9, color: '#9dffcf', life: 0.6 })
    for (const e of enemies) {
      if (!alive(e) || e.hubBoss) continue
      if (revenge) {
        later(rnd(0.05, 0.45), () => {
          chest(e, tv2)
          fx.slapHit(tv2, 1.2, '#ffd04a')
          kill(e)
        })
      } else {
        // Shove everyone back.
        const dx = e.x - px()
        const dz = e.z - pz()
        const d = Math.hypot(dx, dz) || 1
        e.x += (dx / d) * 5
        e.z += (dz / d) * 5
        e.state = 'stunned'
        e.t = 0
      }
    }
    if (revenge) later(0.6, () => sfx.slam(1.4))
  }

  function endRun() {
    for (const e of enemies) {
      // Leaving the lane (or ending the run) also takes the hub boss away: it only exists in the
      // lane, and drops again (full HP) on the next visit while the timer is at zero.
      if (e === hub.boss) hub.boss = null
      if (e.tele) telegraphs.hide(e.tele)
      e.bar.remove()
      e.model.dispose()
      e.state = 'gone'
    }
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].state === 'gone') enemies.splice(i, 1)
    for (const st of lane.stages) {
      st.setGate({ open: false, left: null })
      st.pads[0].setActive(false)
      st.pads[1].setActive(false)
    }
    run.cleared = 0
    run.active = 0
    hud.bossBar(null)
    hud.setCombat({ on: false })
    if (reviveClose) {
      reviveClose()
      reviveClose = null
    }
  }

  function collectPad(s, kind) {
    if (kind === 'wins') {
      const amount = addWins(stageWins(s))
      sfx.wins(amount)
      hud.announce(`+${fmt(amount)} Wins`, `Stage ${s} cashed in!`, 'win')
    } else {
      const amount = stageXp(s)
      const lv = addXp(amount)
      sfx.levelUp()
      hud.announce(`+${fmt(amount)} XP`, lv > 0 ? `+${lv} Level${lv > 1 ? 's' : ''}!` : `Stage ${s} cashed in!`, 'win')
    }
    endRun()
    // Home at once: standing in the lane with the run reset would restart stage 1.
    teleportHome()
    run.inLane = false
    fx.motes(tv.set(px(), 0.5, pz()), { count: 40, colors: kind === 'wins' ? ['#ffe066', '#ffffff', '#ffb52e'] : ['#9dff6a', '#ffffff', '#6affd0'], radius: 2, height: 2.5 })
  }

  // --- Player attacks -----------------------------------------------------------------------------
  function nearestInReach(range) {
    let best = null
    let bestD = range
    for (const e of enemies) {
      if (!alive(e) || e.state === 'spawn' || e.state === 'grabbed') continue
      const d = Math.hypot(e.x - px(), e.z - pz()) - e.model.radius
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  function autoSlap() {
    const target = nearestInReach(octo.reach)
    if (!target) return false
    chest(target, tv)
    const delay = octo.slap(tv)
    sfx.whoosh(0.7, panOf(target.x, target.z))
    later(delay, () => {
      if (!alive(target) || dead) return
      const crit = Math.random() < 0.12
      const dmg = playerDamage() * rnd(0.9, 1.1) * (crit ? 2 : 1)
      chest(target, tv2)
      fx.slapHit(tv2, crit ? 1.35 : 1, crit ? '#ff8a3d' : '#ffe28a')
      sfx.slap(crit ? 1.3 : 1, panOf(target.x, target.z))
      hurtEnemy(target, dmg, crit ? 'crit' : 'dmg')
    })
    return true
  }

  function throwAction() {
    if (dead) return true
    if (throwCd > 0) return true
    const range = octo.reach * COMBAT.throwRadius
    const cands = enemies
      .filter((e) => alive(e) && e.state !== 'spawn' && e.state !== 'grabbed' && Math.hypot(e.x - px(), e.z - pz()) - e.model.radius < range)
      .sort((a, b) => Math.hypot(a.x - px(), a.z - pz()) - Math.hypot(b.x - px(), b.z - pz()))
    const max = Math.max(1, Math.ceil(armsFor(state.level) * COMBAT.throwMaxPerArm))
    const targets = cands.slice(0, max)
    if (!targets.length) {
      hud.toast('Get closer to grab bandits!')
      sfx.deny()
      return true
    }
    throwCd = COMBAT.throwCooldown
    bumpStat('throws')
    const positions = targets.map((e) => new Vector3(e.x, e.y + e.model.height * 0.5, e.z))
    const res = octo.grabSlam(positions)
    later(Math.max(0, res.liftAt * 0.6), () => sfx.grab())
    targets.forEach((e, i) => {
      if (e.tele) {
        telegraphs.hide(e.tele)
        e.tele = null
      }
      e.grabIndex = i
      e.state = 'grabbed'
      e.t = 0
      e.grabLift = res.liftAt
      e.grabSlam = res.slamAt
    })
    later(res.slamAt, () => {
      let landed = 0
      for (const e of targets) {
        if (!alive(e)) continue
        if (!e.boss) {
          octo.getGrabPoint(e.grabIndex, tv)
          e.x = tv.x
          e.z = tv.z
        }
        e.y = 0
        e.grabIndex = -1
        e.state = 'stunned'
        e.t = 0
        fx.slam(tv.set(e.x, 0, e.z), e.boss ? 1.3 : 0.9)
        const dmg = playerDamage() * COMBAT.throwMult * rnd(0.95, 1.12)
        hurtEnemy(e, dmg, 'big', 0)
        landed++
      }
      if (landed) sfx.slam(Math.min(2, 0.9 + landed * 0.15))
    })
    return true
  }

  // --- Enemy AI -------------------------------------------------------------------------------------
  function beginWindup(e) {
    e.state = 'windup'
    e.t = 0
    const dx = px() - e.x
    const dz = pz() - e.z
    const dist = Math.hypot(dx, dz)
    e.teleYaw = Math.atan2(dx, dz)
    e.yaw = e.teleYaw
    if (e.boss) {
      const ahead = Math.min(dist, 3 * e.model.scale * 0.6)
      e.teleShape = 'circle'
      e.teleX = e.x + Math.sin(e.teleYaw) * ahead
      e.teleZ = e.z + Math.cos(e.teleYaw) * ahead
      e.teleA = 2.6 * e.model.scale
      e.tele = telegraphs.show('circle', e.teleX, e.teleZ, 0, e.teleA)
    } else if (e.ranged) {
      e.teleShape = 'rect'
      e.teleX = e.x
      e.teleZ = e.z
      e.teleA = Math.min(E.gunRange + 3, dist + 3)
      e.teleB = 1.1
      e.tele = telegraphs.show('rect', e.x, e.z, e.teleYaw, e.teleA, e.teleB)
    } else {
      e.teleShape = 'rect'
      e.teleX = e.x
      e.teleZ = e.z
      e.teleA = E.attackRange + 1.6
      e.teleB = e.kind === 'masked' ? 1.5 : 2.1
      e.tele = telegraphs.show('rect', e.x, e.z, e.teleYaw, e.teleA, e.teleB)
    }
    if (Math.random() < 0.6) sfx.telegraph()
  }

  function resolveStrike(e) {
    const r = bodyR()
    let hit = false
    if (e.teleShape === 'circle') {
      hit = Math.hypot(px() - e.teleX, pz() - e.teleZ) <= e.teleA + r * 0.8
      fx.slam(tv.set(e.teleX, 0, e.teleZ), e.hubBoss ? 1.4 : 1)
      sfx.slam(e.hubBoss ? 1.3 : 0.9)
    } else {
      const s = Math.sin(e.teleYaw)
      const c = Math.cos(e.teleYaw)
      const dx = px() - e.teleX
      const dz = pz() - e.teleZ
      const lz = dx * s + dz * c
      const lx = dx * c - dz * s
      hit = lz >= -r && lz <= e.teleA + r * 0.6 && Math.abs(lx) <= e.teleB / 2 + r * 0.7
      if (e.ranged) {
        sfx.gunshot(panOf(e.x, e.z))
        fx.flash(tv.set(e.x + s * 0.9, e.y + 1.4 * e.model.scale, e.z + c * 0.9), '#ffd27a', 1.2, 0.08)
      } else if (e.kind === 'masked') sfx.knife(panOf(e.x, e.z))
      else sfx.whoosh(0.5, panOf(e.x, e.z))
    }
    if (hit) {
      if (!e.ranged && !e.boss) sfx.punch(panOf(e.x, e.z))
      hurtPlayer(e.hit, e)
    }
  }

  function updateEnemy(e, dt) {
    const [minX, maxX, minZ, maxZ] = bounds(e)
    e.t += dt
    const dx = px() - e.x
    const dz = pz() - e.z
    const dist = Math.hypot(dx, dz)
    let animState = 'idle'
    let k = 0
    e.speed = 0

    switch (e.state) {
      case 'spawn': {
        if (e.t < 0) {
          e.model.group.visible = false
          break
        }
        e.model.group.visible = true
        e.vy -= 30 * dt
        e.y += e.vy * dt
        if (e.y <= 0) {
          e.y = 0
          e.state = 'chase'
          e.t = 0
          e.bar.show(true)
          fx.dust(tv.set(e.x, 0, e.z), { count: e.boss ? 16 : 7, speed: e.boss ? 7 : 3.5, size: e.boss ? 2.4 : 1.2 })
          if (e.boss) {
            fx.ring(tv, { radius: 8, color: '#ffd9a0', life: 0.5 })
            fx.shake(0.5)
            sfx.slam(1.2)
          }
        }
        animState = 'grabbed'
        break
      }
      case 'idle':
        if (!dead) {
          e.state = 'chase'
          e.t = 0
        }
        break
      case 'chase': {
        if (dead) break
        const want = e.ranged ? 9 : e.boss ? 2.2 * e.model.scale * 0.6 + bodyR() : E.attackRange + bodyR() * 0.6
        const speed = e.boss ? E.bossSpeed : E.speed * (e.ranged ? 0.9 : 1)
        let mx = 0
        let mz = 0
        if (dist > want) {
          mx = dx / dist
          mz = dz / dist
        } else if (e.ranged && dist < 6) {
          mx = -dx / dist
          mz = -dz / dist
        }
        // Separation.
        for (const o of enemies) {
          if (o === e || !alive(o) || o.state === 'grabbed') continue
          const ox = e.x - o.x
          const oz = e.z - o.z
          const od = Math.hypot(ox, oz)
          const min = E.separation * (e.boss || o.boss ? 2.2 : 1)
          if (od > 0.001 && od < min) {
            mx += (ox / od) * (min - od) * 1.2
            mz += (oz / od) * (min - od) * 1.2
          }
        }
        const ml = Math.hypot(mx, mz)
        if (ml > 0.05) {
          const sp = speed * Math.min(1, ml)
          e.x += (mx / ml) * sp * dt
          e.z += (mz / ml) * sp * dt
          e.speed = sp
          animState = 'run'
        }
        // Face the player.
        const yawT = Math.atan2(dx, dz)
        const dy = Math.atan2(Math.sin(yawT - e.yaw), Math.cos(yawT - e.yaw))
        e.yaw += dy * Math.min(1, dt * 10)
        e.cooldown -= dt
        const inRange = e.ranged ? dist < E.gunRange : dist < want + 0.8
        if (e.cooldown <= 0 && inRange) beginWindup(e)
        if (e.hurtT > 0) {
          e.hurtT -= dt
          animState = 'hurt'
        }
        break
      }
      case 'windup': {
        const wind = e.boss ? E.bossWindup : E.windup
        k = Math.min(1, e.t / wind)
        telegraphs.progress(e.tele, k)
        animState = 'windup'
        if (k >= 1) {
          telegraphs.hide(e.tele)
          e.tele = null
          if (!dead) resolveStrike(e)
          e.state = 'strike'
          e.t = 0
        }
        break
      }
      case 'strike': {
        k = Math.min(1, e.t / 0.28)
        animState = 'strike'
        if (k >= 1) {
          e.state = 'chase'
          e.t = 0
          e.cooldown = rnd(E.cooldown[0], E.cooldown[1]) * (e.boss ? 1.15 : 1)
        }
        break
      }
      case 'grabbed': {
        animState = 'grabbed'
        if (!e.boss && e.t >= e.grabLift * 0.7) {
          octo.getGrabPoint(e.grabIndex, tv)
          const lerp = Math.min(1, (e.t - e.grabLift * 0.7) / Math.max(0.05, e.grabLift * 0.4))
          e.x += (tv.x - e.x) * lerp
          e.z += (tv.z - e.z) * lerp
          e.y += (tv.y - e.model.height * 0.45 - e.y) * lerp
          e.yaw += dt * 9
        }
        break
      }
      case 'stunned': {
        animState = 'stunned'
        if (e.t > 0.8) {
          e.state = 'chase'
          e.t = 0
          e.cooldown = Math.max(e.cooldown, 0.4)
        }
        break
      }
      case 'dead': {
        animState = 'dead'
        e.fling.y -= 24 * dt
        e.x += e.fling.x * dt
        e.z += e.fling.z * dt
        e.y = Math.max(0, e.y + e.fling.y * dt)
        e.model.group.rotation.x += e.fling.spin * dt * 0.6
        e.model.group.rotation.z += e.fling.spin * dt
        const life = e.boss ? 1.8 : 1.05
        if (e.t > life) {
          chest(e, tv)
          fx.sparks(tv, { count: e.boss ? 40 : 14, colors: ['#ffffff', '#ffe066', '#ffd0f0'], speed: e.boss ? 9 : 5, size: 0.5 })
          fx.dust(tv.set(e.x, Math.max(0.2, e.y), e.z), { count: e.boss ? 14 : 6, color: '#ffffff', speed: 2.5, size: e.boss ? 2.6 : 1.3, life: 0.6 })
          e.model.dispose()
          e.state = 'gone'
        }
        break
      }
    }

    if (e.state !== 'dead' && e.state !== 'grabbed' && e.state !== 'gone') {
      e.x = clamp(e.x, minX, maxX)
      e.z = clamp(e.z, minZ, maxZ)
      // Never stand inside the octopus.
      const ddx = e.x - px()
      const ddz = e.z - pz()
      const dd = Math.hypot(ddx, ddz)
      const min = bodyR() + e.model.radius
      if (dd < min && dd > 0.001) {
        e.x = px() + (ddx / dd) * min
        e.z = pz() + (ddz / dd) * min
      }
    }
    if (e.state === 'gone') return
    const g = e.model.group
    g.position.set(e.x, e.y, e.z)
    if (e.state !== 'dead') {
      g.rotation.set(0, e.yaw, 0)
    }
    e.model.animate(dt, animState, e.speed, k)
    e.bar.at(e.x, e.y + e.model.height + 0.35, e.z)
  }

  // --- Frame -------------------------------------------------------------------------------------------
  return {
    get playerHp() {
      return playerHp
    },
    get playerMax() {
      return playerMax
    },
    isDead: () => dead,
    get enemies() {
      return enemies
    },
    debugHurt: (n) => hurtPlayer(n), // dev console only
    inLane: () => run.inLane,
    // True while there is something to fight (THROW owns the E key then).
    inCombat: () => !dead && enemies.some((e) => alive(e) && e.state !== 'spawn' && Math.hypot(e.x - px(), e.z - pz()) < 30),
    hubBossActive: () => !!hub.boss,
    throwAction,
    leave() {
      if (!run.inLane) return
      endRun()
      teleportHome()
    },
    reset() {
      endRun()
      hub.pending = false
      hud.bossBar(null)
      hud.setCombat({ on: false })
    },

    update(dt) {
      time += dt
      // Area (with a little hysteresis at the lane mouth).
      const z = pz()
      const wasLane = run.inLane
      if (!run.inLane && z < LANE.startZ - 1) run.inLane = true
      else if (run.inLane && z > LANE.startZ + 1) run.inLane = false
      if (wasLane && !run.inLane && !dead) endRun()

      // Stage triggers.
      if (run.inLane && !dead && !run.active) {
        const s = run.cleared + 1
        if (s <= STAGES.count && !hub.boss && z < stageStartZ(s) - LANE.triggerInset) startWave(s)
      }
      // Pads.
      if (run.inLane && !dead && run.cleared > 0) {
        for (let s = 1; s <= run.cleared; s++) {
          for (const pad of lane.stages[s - 1].pads) {
            if (Math.abs(px() - pad.x) < pad.half && Math.abs(z - pad.z) < pad.half) {
              collectPad(s, pad.kind)
              return
            }
          }
        }
      }

      // Hub boss timer.
      if (!hub.boss) {
        if (state.bossTimer > 0) state.bossTimer = Math.max(0, state.bossTimer - dt)
        if (state.bossTimer <= 0) {
          // Only in the lane, and only between waves (one boss bar at a time).
          if (run.inLane && !run.active && !dead) spawnHubBoss()
          else hub.pending = true
        }
      }

      // Scheduled hits.
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].at <= time) {
          const ev = events[i]
          events.splice(i, 1)
          ev.fn()
        }
      }

      // Octopus attacks.
      throwCd = Math.max(0, throwCd - dt)
      hud.setThrowCooldown(throwCd, COMBAT.throwCooldown)
      if (!dead) {
        slapTimer -= dt
        if (slapTimer <= 0) {
          const arms = armsFor(state.level)
          slapTimer = autoSlap() ? COMBAT.slapEvery * (1 - 0.035 * (arms - 4)) : 0.1
        }
      }

      for (const e of enemies) updateEnemy(e, dt)
      for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].state === 'gone') enemies.splice(i, 1)

      // Player HP: regen when nothing is close.
      let near = false
      for (const e of enemies) if (alive(e) && Math.hypot(e.x - px(), e.z - pz()) < 16) near = true
      if (!dead && !near && playerHp < playerMax) playerHp = Math.min(playerMax, playerHp + playerMax * COMBAT.regenOutOfCombat * dt)
      const showBar = (run.inLane || !!hub.boss) && !dead
      if (showBar && !playerBar) playerBar = bars.add('Octopus', 'player')
      if (!showBar && playerBar) {
        playerBar.remove()
        playerBar = null
      }
      if (playerBar) {
        playerBar.set(playerHp, playerMax)
        playerBar.at(px(), player.renderPosition.y + 2.5 + octo.reach * 0.1, pz())
      }
    },
  }
}
