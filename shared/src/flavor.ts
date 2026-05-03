import type { ModeFlavor } from './modes/types.js'

// ─── Cached lookup maps ──────────────────────────────────────────────
// Flavor arrays are tiny (2–6 entries) but looked up on every render tick.
// WeakMap keyed by flavor identity avoids rebuilding on each call.

const resourceIconCache = new WeakMap<ModeFlavor, Map<string, string>>()
const resourceNameCache = new WeakMap<ModeFlavor, Map<string, string>>()
const upgradeNameCache = new WeakMap<ModeFlavor, Map<string, string>>()
const upgradeDescCache = new WeakMap<ModeFlavor, Map<string, string>>()
const generatorNameCache = new WeakMap<ModeFlavor, Map<string, string>>()
const generatorIconCache = new WeakMap<ModeFlavor, Map<string, string>>()

function getOrBuild<K extends object>(
  wm: WeakMap<K, Map<string, string>>,
  key: K,
  build: () => Map<string, string>,
): Map<string, string> {
  let m = wm.get(key)
  if (!m) {
    m = build()
    wm.set(key, m)
  }
  return m
}

function warnMissing(kind: string, id: string): void {
  console.warn(`[flavor] missing ${kind} for '${id}'`)
}

// ─── Public helpers ──────────────────────────────────────────────────

/** Return the display icon for a resource key within the given flavor. */
export function getResourceIcon(flavor: ModeFlavor, key: string): string {
  const m = getOrBuild(
    resourceIconCache,
    flavor,
    () => new Map(flavor.resources.map((r) => [r.key, r.icon])),
  )
  const v = m.get(key)
  if (v === undefined) warnMissing('resource icon', key)
  return v ?? key
}

/** Return the display name for a resource key within the given flavor. */
export function getResourceName(flavor: ModeFlavor, key: string): string {
  const m = getOrBuild(
    resourceNameCache,
    flavor,
    () => new Map(flavor.resources.map((r) => [r.key, r.displayName])),
  )
  const v = m.get(key)
  if (v === undefined) warnMissing('resource name', key)
  return v ?? key
}

/** Return the display name for an upgrade id within the given flavor. */
export function getUpgradeName(flavor: ModeFlavor, id: string): string {
  const m = getOrBuild(
    upgradeNameCache,
    flavor,
    () => new Map(flavor.upgrades.map((u) => [u.id, u.name])),
  )
  const v = m.get(id)
  if (v === undefined) warnMissing('upgrade name', id)
  return v ?? id
}

/** Return the display description for an upgrade id within the given flavor. */
export function getUpgradeDescription(flavor: ModeFlavor, id: string): string {
  const m = getOrBuild(
    upgradeDescCache,
    flavor,
    () => new Map(flavor.upgrades.map((u) => [u.id, u.description])),
  )
  const v = m.get(id)
  if (v === undefined) warnMissing('upgrade description', id)
  return v ?? ''
}

/** Return the display name for a generator id within the given flavor. */
export function getGeneratorName(flavor: ModeFlavor, id: string): string {
  const m = getOrBuild(
    generatorNameCache,
    flavor,
    () => new Map(flavor.generators.map((g) => [g.id, g.name])),
  )
  const v = m.get(id)
  if (v === undefined) warnMissing('generator name', id)
  return v ?? id
}

/** Return the display icon for a generator id within the given flavor. */
export function getGeneratorIcon(flavor: ModeFlavor, id: string): string {
  const m = getOrBuild(
    generatorIconCache,
    flavor,
    () => new Map(flavor.generators.map((g) => [g.id, g.icon])),
  )
  const v = m.get(id)
  if (v === undefined) warnMissing('generator icon', id)
  return v ?? id
}
