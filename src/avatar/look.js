// Builds a rider character for a Bloxity look: the local player's own (from the SDK) or another
// player's (the look the server relays: ids only, never URLs). A look is
//   { equipped: { hatId, skinId, ... }, proportions: { height, ... }, outfitKey }
// Preferred path: Boxity's platform character kit dresses the whole look (skin with pants / shirt /
// face, body parts, every accessory slot incl. hands and shoes, custom characters' fallbacks) from the
// outfit key. When the kit is off, older, or declines the look, the manual path (avatar/loader.js)
// loads the skin texture, body parts and bone-attached accessories itself.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { dressRig, getEquippedAvatar, getOutfitKey, getProportions, getSkinTextureUrl, getSkinTextureUrlFor } from '../bloxity.js'
import { composedSkinUrl, isEquipped } from './cdn.js'
import { loadBaseCharacter } from './character.js'
import { applyProportions, attachEquippedAccessories } from './loader.js'

// The local player's current look, or null for the default character (no SDK, or nothing equipped).
export function localLook() {
  const equipped = getEquippedAvatar()
  if (!equipped || typeof equipped !== 'object') return null
  return { equipped, proportions: getProportions(), outfitKey: getOutfitKey() }
}

// The look the server relays (backend presence.ts sanitizeLook), or null.
export function parseLook(json) {
  if (!json || typeof json !== 'string') return null
  try {
    const look = JSON.parse(json)
    if (!look || typeof look !== 'object' || !look.equipped || typeof look.equipped !== 'object') return null
    return { equipped: look.equipped, proportions: look.proportions ?? null, outfitKey: typeof look.outfitKey === 'string' ? look.outfitKey : '' }
  } catch {
    return null
  }
}

// What is sent to the server: ids and proportions only (the skin URL is rebuilt by each viewer).
export function lookJson(look = localLook()) {
  if (!look) return ''
  try {
    const json = JSON.stringify({ equipped: look.equipped, proportions: look.proportions, outfitKey: look.outfitKey || undefined })
    return json.length <= 3000 ? json : '' // backend AVATAR_MAX_LEN
  } catch {
    return ''
  }
}

// A stable key for "is this the same look" (rebuild only when it changes).
export function lookKey(look) {
  if (!look) return ''
  return JSON.stringify([look.equipped, look.proportions, look.outfitKey])
}

export const hasItems = (look) => !!look && Object.values(look.equipped ?? {}).some((id) => isEquipped(id))

// Resolves a character (avatar/character.js shape) wearing the look. Never rejects: a failure leaves
// the default character. `local` picks the SDK's own skin texture URL instead of building one for a
// remote player from their ids.
export async function buildLookCharacter(look, { local = false, signal } = {}) {
  const root = await loadBaseCharacter()
  if (!look || signal?.aborted) return root
  applyProportions(root, look.proportions)
  const kit = await dressRig({ THREE, GLTFLoader, root, outfitKey: look.outfitKey })
  if (signal?.aborted) {
    kit?.dispose?.()
    return root
  }
  if (kit) {
    root.userData.kit = kit
    return root
  }
  const skinTextureUrl = local ? getSkinTextureUrl() : getSkinTextureUrlFor(look.equipped) || composedSkinUrl(look.equipped)
  await attachEquippedAccessories(root, look.equipped, { signal, skinTextureUrl })
  return root
}

// Takes a character's platform outfit off before it is thrown away.
export function disposeLook(root) {
  try {
    root?.userData?.kit?.dispose?.()
  } catch {
    // Already gone.
  }
}
