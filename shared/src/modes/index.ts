import type { Modifier, ModifierStage } from '../modifiers/types.js'
import { computePassiveRates } from '../modifiers/pipeline.js'
import {
  ALL_GENERATORS_FIELD,
  ALL_RESOURCES_FIELD,
  INCOMING_CLICK_INCOME_FIELD,
} from '../modifiers/types.js'
import type {
  AttackDefinition,
  AttackKind,
  EffectRef,
  EnemyCostFactor,
  GameMode,
  GeneratorDefinition,
  Goal,
  PlayerState,
  UpgradeDefinition,
} from '../types.js'
import type { ModeDefinition, ModeFlavor } from './types.js'
import { readHighlight } from '../highlight.js'
import { batteryFactor } from '../highlight-battery.js'
// `attacks.ts` imports `isAttackUnlocked` from here in turn; the cycle is safe
// because neither module reads the other at load time, only inside functions.
import { ATTACK_STATS, attackStatsFor, collectAttackParams } from '../attacks.js'
import { scaleCostFactor, scaleDebuffValue } from '../modifiers/value-guard.js'
import { recordPurchaseTime } from '../game-clock.js'
import { isTimeEffectType, timedUpgradeIds } from '../time-bonus.js'
import { validateUpgradePrerequisites } from '../prerequisites.js'
import { validateUpgradeChoiceGroups } from '../upgrade-groups.js'
import { getUpgradeNextCost, upgradeCostFactors } from '../upgrade-costs.js'
import {
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_ROUND_DURATION_SEC,
  MAX_ROUND_DURATION_SEC,
} from '../game-config.js'
// Importing from the effects barrel ensures seed effects are registered
// whenever `collectModifiers` is reachable (incl. tests that import this module).
import {
  applyEffect,
  effectHosts,
  isDynamicEffect,
  isEffectAllowedOn,
  normalizeEffectOutputs,
  prepareEffect,
} from '../effects/index.js'
import {
  addressableSources,
  addressableTargets,
  enemyCostTargets,
  enemyDebuffTargets,
  HIGHLIGHT_FACTOR_TARGET,
  NON_RESOURCE_INTEL_KEYS,
  RESERVED_TARGET_KEYS,
  enemyDataResourceKey,
} from '../effects/index.js'
import type { BaseModifierOutput, EffectHost, EffectOutput } from '../effects/index.js'
import {
  allAttackIds,
  allPactIds,
  attackGate,
  enemyDataGate,
  isGranted,
  isHighlightActive,
  pactGate,
  panelGate,
} from '../unlock-gates.js'

// ─── Validation ──────────────────────────────────────────────────────

/** How each effect host reads in an authoring error message. */
const HOST_LABELS: Record<EffectHost, string> = {
  mode: 'the mode',
  upgrade: 'an upgrade',
  passiveAttack: 'a passive attack',
  activeAttack: 'an active attack',
}

/**
 * The effect types whose outputs the enemy-debuff collectors gather — and so
 * the ones that, on an active attack, consume its `durationSec` window. The
 * authoring-side twin of `isDebuffOutput` (which judges the *output*): the
 * validator sees refs, not outputs, and must not run effects to judge them.
 */
const DEBUFF_EFFECT_TYPES: ReadonlySet<string> = new Set([
  'enemyProductionModifier',
  'enemyCostModifier',
])

/**
 * Validate that a single flavor's display data covers exactly the mode's
 * mechanics (same resource keys, an entry per upgrade/generator, no orphans).
 * Every flavor must satisfy this independently, so players on different flavors
 * see consistent UI for the same shared simulation.
 */
function validateFlavor(id: string, def: ModeDefinition, f: ModeFlavor): void {
  const where = `flavor '${f.id}'`

  // Resource keys must match exactly (same set, same count)
  const mechKeys = new Set(def.resources)
  const flavorKeys = new Set(f.resources.map((r) => r.key))
  if (mechKeys.size !== flavorKeys.size || ![...mechKeys].every((k) => flavorKeys.has(k)))
    throw new Error(`[${id}] ${where}: resources keys don't match mode.resources`)

  // Every mechanical upgrade must have a flavor entry
  for (const u of def.upgrades) {
    if (!f.upgrades.some((fu) => fu.id === u.id))
      throw new Error(`[${id}] ${where}: missing flavor for upgrade '${u.id}'`)
  }

  // Every mechanical generator must have a flavor entry
  for (const g of def.generators) {
    if (!f.generators.some((fg) => fg.id === g.id))
      throw new Error(`[${id}] ${where}: missing flavor for generator '${g.id}'`)
  }

  // Every mechanical attack must have a flavor entry
  for (const a of def.attacks) {
    if (!f.attacks.some((fa) => fa.id === a.id))
      throw new Error(`[${id}] ${where}: missing flavor for attack '${a.id}'`)
  }

  // Every mechanical pact must have a flavor entry
  for (const p of def.pacts) {
    if (!f.pacts.some((fp) => fp.id === p.id))
      throw new Error(`[${id}] ${where}: missing flavor for pact '${p.id}'`)
  }

  // No orphan flavor entries (flavor references nonexistent mechanic)
  for (const fu of f.upgrades) {
    if (!def.upgrades.some((u) => u.id === fu.id))
      throw new Error(`[${id}] ${where}: references unknown upgrade '${fu.id}'`)
  }
  for (const fg of f.generators) {
    if (!def.generators.some((g) => g.id === fg.id))
      throw new Error(`[${id}] ${where}: references unknown generator '${fg.id}'`)
  }
  for (const fa of f.attacks) {
    if (!def.attacks.some((a) => a.id === fa.id))
      throw new Error(`[${id}] ${where}: references unknown attack '${fa.id}'`)
  }
  for (const fp of f.pacts) {
    if (!def.pacts.some((p) => p.id === fp.id))
      throw new Error(`[${id}] ${where}: references unknown pact '${fp.id}'`)
  }
}

/** Validate that flavor ↔ mechanics agree. Called once per mode at startup. */
export function validateModeDefinition(id: string, def: ModeDefinition): void {
  // At least one flavor (also enforced by the schema), with unique ids so a
  // selector can address them and `getModeFlavor` resolves deterministically.
  if (def.flavors.length === 0) throw new Error(`[${id}] mode has no flavors`)
  const seen = new Set<string>()
  for (const f of def.flavors) {
    if (seen.has(f.id)) throw new Error(`[${id}] duplicate flavor id '${f.id}'`)
    seen.add(f.id)
    validateFlavor(id, def, f)
  }

  // Prerequisite expression validation
  validateUpgradePrerequisites(def.upgrades)
  validateUpgradeChoiceGroups(def.upgrades)

  // highlightEnabled ↔ initialMeta consistency. The *key* must be present, but
  // `null` is a valid value — it means the round opens with nothing highlighted
  // (see `readHighlight`). Requiring the key keeps that an authored choice rather
  // than an omission.
  if (def.highlightEnabled && !('highlight' in def.initialMeta))
    throw new Error(`[${id}] highlightEnabled is true but initialMeta has no 'highlight' key`)

  // Referential integrity for generator-targeting effects: `generatorCost` and
  // `generatorUnlock` both name a generator by id (the generic effect schema
  // only checks it's a string), so a typo would otherwise be silently ignored
  // at runtime. These are the effects that point at another mechanic, so the
  // check is targeted by type.
  const generatorIds = new Set(def.generators.map((g) => g.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'generatorCost' && ref.type !== 'generatorUnlock') continue
      const target = ref.generator
      if (typeof target === 'string' && !generatorIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' ${ref.type} effect references unknown generator '${target}'`,
        )
    }
  }

  // Generators are single-currency: their cost map must have exactly one entry.
  // (Upgrades may be multi-currency; generators are not, since their purchase,
  // affordability, and UI all assume one paying resource.)
  for (const g of def.generators) {
    // A generator id shaped like a base-producer field (`bK`) would collide in
    // the addressable-target catalog and be shadowed by the base-layer route in
    // the pipeline (`resolveField`). Reject it so a modifier can never ambiguously
    // target "generator b0" vs "base producer of resource 0".
    if (/^b\d+$/u.test(g.id))
      throw new Error(
        `[${id}] generator id '${g.id}' collides with the base-producer field namespace (bK); rename it`,
      )
    const currencies = Object.keys(g.cost)
    if (currencies.length !== 1)
      throw new Error(
        `[${id}] generator '${g.id}' must cost exactly one currency (has ${currencies.length})`,
      )
  }

  // A resource or generator id equal to an aggregate sentinel would be shadowed
  // by the fan-out branch in `collectRawModifiers`, making a modifier ambiguous
  // between "this one target" and "all of them". Reject it like the `bK`
  // collision above.
  for (const key of [...def.resources, ...def.generators.map((g) => g.id)]) {
    if (key === ALL_RESOURCES_FIELD || key === ALL_GENERATORS_FIELD)
      throw new Error(
        `[${id}] id '${key}' collides with an aggregate-target sentinel (allResources/allGenerators); rename it`,
      )
  }

  // `unlockAttack` effects name an attack by id; validate against the mode's
  // attacks so an authored typo fails loudly instead of unlocking nothing.
  const attackIds = new Set(def.attacks.map((a) => a.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'unlockAttack') continue
      const target = ref.attack
      if (typeof target === 'string' && !attackIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' unlockAttack effect references unknown attack '${target}'`,
        )
    }
  }

  // `attackStat` effects scale an attack's numbers, naming the attack by id (or
  // omitting it for every attack). Validate the id the same way — a typo would
  // silently buff nothing — and reject a stat aimed at an attack that has no such
  // field: `prepareCost`/`prepareTime` are forbidden on a passive attack (see
  // below), so a stat pointed at one is authored dead weight. A ref naming *no*
  // attack stays legal whatever its stat: it applies to those attacks that can
  // use it.
  //
  // The schema (`guardScaledStatValue`) has already judged each value on its
  // own; what it cannot see is the *context* — how many copies the owning
  // upgrade sells, and what the named attack actually authors. Every check here
  // asks one question in that context: does this ref still do something at every
  // level a player can buy?
  const attacksById = new Map(def.attacks.map((a) => [a.id, a]))
  const checkAttackStat = (where: string, ref: EffectRef, purchaseLimit: number): void => {
    if (ref.type !== 'attackStat') return
    // A negative `add` resolves as `1 + value × owned`, so it reaches `0` at
    // `1/|value|` copies and is floored (useless) from there on. Rejecting it
    // when the owning upgrade can be bought that many times is what stops a
    // track whose last levels are bought and do nothing — `mult`, which decays
    // asymptotically, is the op for a reduction meant to keep stacking. No
    // attack is named in this check: it is arithmetic on the ref alone.
    const value = ref.value
    if (
      ref.op === 'add' &&
      typeof value === 'number' &&
      value < 0 &&
      1 + value * purchaseLimit <= 0
    )
      throw new Error(
        `[${id}] ${where} attackStat 'add' of ${value} reaches a zero multiplier at ${Math.ceil(-1 / value)} copies, within the upgrade's purchase limit of ${purchaseLimit} — use 'mult' for a reduction that keeps stacking`,
      )

    const target = ref.attack
    if (typeof target !== 'string') return
    const attack = attacksById.get(target)
    if (!attack)
      throw new Error(`[${id}] ${where} attackStat effect references unknown attack '${target}'`)
    if (typeof ref.stat !== 'string') return
    // An unknown stat string is the schema's to reject (`prepareEffect`, below),
    // not this check's — otherwise a typo reads as a kind mismatch.
    const known: readonly string[] = ATTACK_STATS
    const legal: readonly string[] = attackStatsFor(attack.kind)
    if (!known.includes(ref.stat)) return
    if (!legal.includes(ref.stat))
      throw new Error(
        `[${id}] ${where} attackStat effect moves '${ref.stat}' on passive attack '${target}', which is never activated (only an active attack has a prepare cost and delay)`,
      )

    // A stat must have something to move. Both fields are optional on an active
    // attack (a free attack, an attack that strikes on the next tick), and
    // scaling a zero cost or a zero delay is arithmetic on nothing — the same
    // dead weight the kind check above rejects, one level finer. Only checkable
    // for a ref that names its attack; the all-attacks form is judged against no
    // single definition.
    const delaySec = attack.prepareTimeSec ?? 0
    if (ref.stat === 'prepareTime' && delaySec <= 0)
      throw new Error(
        `[${id}] ${where} attackStat moves 'prepareTime' on attack '${target}', which has no prepare delay to move`,
      )
    if (ref.stat === 'prepareCost' && Object.keys(attack.prepareCost ?? {}).length === 0)
      throw new Error(
        `[${id}] ${where} attackStat moves 'prepareCost' on attack '${target}', which is free to activate`,
      )
    const windowSec = attack.durationSec ?? 0
    if (ref.stat === 'duration' && windowSec <= 0)
      throw new Error(
        `[${id}] ${where} attackStat moves 'duration' on attack '${target}', which opens no debuff window`,
      )
    // An offset at least as deep as the authored delay floors it to zero at a
    // single copy, so every later copy is bought and does nothing — the absolute
    // twin of the `add` check above, and the reason that one needs no attack.
    const offsetsDelay = ref.stat === 'prepareTime' && ref.op === 'offset'
    if (offsetsDelay && typeof value === 'number' && value <= -delaySec)
      throw new Error(
        `[${id}] ${where} attackStat 'offset' of ${value}s already floors attack '${target}'s ${delaySec}s delay to 0 at one copy, leaving every later copy inert`,
      )
    // (`duration` is improved by *increasing* it, so its offset is positive by
    // schema and can never floor the window — no twin check is needed.)
  }
  for (const ref of def.effects ?? []) checkAttackStat('mode-level', ref, 1)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkAttackStat(`upgrade '${u.id}'`, ref, u.purchaseLimit)
  }

  // `attackSlots` (plan 38): a kind is capped once any grant names it, and the
  // base budget is whatever the mode's own starting effects grant. Starting
  // effects can also *unlock* attacks, each of which fills a slot — so a mode
  // whose starting unlocks of a kind outnumber its base cap would open the round
  // already over budget, in a state the purchase gate can never repair. Judged
  // by ref fields, as every check here is: the validator sees refs, not outputs.
  // A kind no grant names is uncapped and needs no check; capping one kind but
  // not the other is legal.
  const startingUnlocks = new Map<AttackKind, Set<string>>()
  for (const ref of def.effects ?? []) {
    if (ref.type !== 'unlockAttack' || typeof ref.attack !== 'string') continue
    const attack = attacksById.get(ref.attack)
    if (!attack) continue // an unknown attack fills no slot
    let ids = startingUnlocks.get(attack.kind)
    if (!ids) {
      ids = new Set()
      startingUnlocks.set(attack.kind, ids)
    }
    ids.add(ref.attack)
  }
  const cappedKinds = new Set<AttackKind>()
  const baseSlots = new Map<AttackKind, number>()
  const noteSlotGrant = (ref: EffectRef, fromMode: boolean): void => {
    if (ref.type !== 'attackSlots') return
    const kind = ref.attackKind
    if (kind !== 'active' && kind !== 'passive') return // the schema's to reject
    cappedKinds.add(kind)
    if (fromMode && typeof ref.value === 'number')
      baseSlots.set(kind, (baseSlots.get(kind) ?? 0) + ref.value)
  }
  for (const ref of def.effects ?? []) noteSlotGrant(ref, true)
  for (const u of def.upgrades) for (const ref of u.effects ?? []) noteSlotGrant(ref, false)
  for (const kind of cappedKinds) {
    const held = startingUnlocks.get(kind)?.size ?? 0
    const base = baseSlots.get(kind) ?? 0
    if (held > base)
      throw new Error(
        `[${id}] the mode's starting effects unlock ${held} ${kind} attack(s) but grant only ${base} ${kind} attack slot(s) — the round would open over budget, which no purchase can repair`,
      )
  }

  // `unlockPact` effects name a pact by id; validate against the mode's pacts
  // so an authored typo fails loudly instead of unlocking nothing.
  const pactIds = new Set(def.pacts.map((p) => p.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'unlockPact') continue
      const target = ref.pact
      if (typeof target === 'string' && !pactIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' unlockPact effect references unknown pact '${target}'`,
        )
    }
  }

  // `accessEnemyData` effects name a resource (optionally `:rate`-suffixed) by
  // key; validate it the same way so an authored typo fails loudly instead of
  // silently revealing nothing at runtime.
  const resourceKeys = new Set(def.resources)
  // Reserved non-resource intel keys (e.g. peak CPS) must not collide with a
  // real resource, or their whitelist below would mask a genuine typo.
  for (const intelKey of NON_RESOURCE_INTEL_KEYS) {
    if (resourceKeys.has(intelKey))
      throw new Error(
        `[${id}] resource key '${intelKey}' collides with a reserved non-resource intel key`,
      )
  }
  const nonResourceIntel = new Set(NON_RESOURCE_INTEL_KEYS)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'accessEnemyData') continue
      const target = ref.data
      if (typeof target === 'string' && nonResourceIntel.has(target)) continue // non-resource intel
      if (typeof target === 'string' && !resourceKeys.has(enemyDataResourceKey(target)))
        throw new Error(
          `[${id}] upgrade '${u.id}' accessEnemyData effect references unknown resource '${target}'`,
        )
    }
  }

  // `relativeModifier` effects name a `source` (a state field to read) and a
  // `field` (the modifier target). Both are mode-specific, so the generic schema
  // only checks they're strings; validate them against the addressable-field
  // catalog so an authored typo refuses to boot instead of silently reading or
  // writing nothing at runtime. Covers mode-level and upgrade-level refs.
  const sourceKeys = new Set(addressableSources(def).map((f) => f.key))
  const targetKeys = new Set(addressableTargets(def).map((f) => f.key))
  const checkRelativeModifier = (where: string, ref: EffectRef): void => {
    if (ref.type !== 'relativeModifier') return
    if (typeof ref.source === 'string' && !sourceKeys.has(ref.source))
      throw new Error(
        `[${id}] ${where} relativeModifier effect references unknown source '${ref.source}'`,
      )
    if (typeof ref.field === 'string' && !targetKeys.has(ref.field))
      throw new Error(
        `[${id}] ${where} relativeModifier effect references unknown field '${ref.field}'`,
      )
  }
  for (const ref of def.effects ?? []) checkRelativeModifier('mode-level', ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkRelativeModifier(`upgrade '${u.id}'`, ref)
  }

  // `baseModifier` effects name a production `field` the generic schema only
  // checks is a string. Validate it against the same target catalog as
  // `relativeModifier` (which now includes each resource's base producer `bK`
  // alongside its global `rK`, generator ids, and the two specials) so an
  // authored typo — or a base/global mix-up like `b9` — refuses to boot instead
  // of landing on a dead field the pipeline silently ignores.
  const checkProductionField = (where: string, field: unknown): void => {
    if (typeof field === 'string' && !targetKeys.has(field))
      throw new Error(
        `[${id}] ${where} targets unknown production field '${field}' (expected a resource rate 'rK', base producer 'bK', generator id, 'allResources'/'allGenerators', or 'clickIncome')`,
      )
  }
  const checkBaseModifier = (where: string, ref: EffectRef): void => {
    if (ref.type === 'baseModifier') checkProductionField(`${where} baseModifier`, ref.field)
  }
  for (const ref of def.effects ?? []) checkBaseModifier('mode-level', ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkBaseModifier(`upgrade '${u.id}'`, ref)
  }
  for (const a of def.attacks) {
    for (const ref of a.effects ?? []) checkBaseModifier(`attack '${a.id}'`, ref)
  }

  // Time-clock effects (`timeScaledModifier` / `timeFactorBoost` /
  // `timeRetroactive`) all name a `clock` — the upgrade whose purchase starts the
  // timer. It's an upgrade id the generic schema only checks is a string, and a
  // typo would leave the clock permanently unstarted (a payout that never
  // activates, a boost nobody reads), so validate it against the tree. The
  // payout's `field` goes through the same production catalog as `baseModifier`.
  const upgradeIds = new Set(def.upgrades.map((u) => u.id))
  const checkTimeEffect = (where: string, ref: EffectRef): void => {
    if (!isTimeEffectType(ref.type)) return
    if (typeof ref.clock === 'string' && !upgradeIds.has(ref.clock))
      throw new Error(
        `[${id}] ${where} ${ref.type} effect references unknown clock upgrade '${ref.clock}'`,
      )
    if (ref.type === 'timeScaledModifier')
      checkProductionField(`${where} timeScaledModifier`, ref.field)
  }
  for (const ref of def.effects ?? []) checkTimeEffect('mode-level', ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkTimeEffect(`upgrade '${u.id}'`, ref)
  }

  // Effect placement. Each host is read by different code and keeps different
  // output kinds, so a ref on the wrong one doesn't misbehave — it silently does
  // nothing. Every effect declares where it may live (defaulting to the
  // production-pipeline hosts), so this is one generic check rather than a
  // special case per offensive effect.
  const checkHost = (where: string, host: EffectHost, refs: readonly EffectRef[]): void => {
    for (const ref of refs) {
      if (isEffectAllowedOn(ref.type, host)) continue
      throw new Error(
        `[${id}] ${where} carries a '${ref.type}' effect, which only applies on ${effectHosts(
          ref.type,
        )
          .map((h) => HOST_LABELS[h])
          .join(' / ')} — here it would silently do nothing`,
      )
    }
  }
  checkHost('the mode', 'mode', def.effects ?? [])
  for (const u of def.upgrades) checkHost(`upgrade '${u.id}'`, 'upgrade', u.effects ?? [])
  for (const attack of def.attacks) {
    checkHost(
      `${attack.kind} attack '${attack.id}'`,
      attack.kind === 'passive' ? 'passiveAttack' : 'activeAttack',
      attack.effects ?? [],
    )
  }

  // A reserved target names something that isn't a resource, so a mode declaring
  // a resource by that name would make an authored target ambiguous — the same
  // reasoning as the intel-key collision above.
  for (const reserved of RESERVED_TARGET_KEYS) {
    if (resourceKeys.has(reserved))
      throw new Error(`[${id}] resource key '${reserved}' collides with a reserved modifier target`)
  }

  // `enemyProductionModifier` effects (carried by passive attacks) name a
  // `field` — the opponent-pipeline target. It's a mode-specific string the
  // generic schema only checks is present, so validate it against the
  // *enemy-debuff* target catalog (resource rates, `clickIncome`, and the virtual
  // highlight-factor target). Generator-id targets are rejected here because the
  // debuff merges into the opponent's pipeline after generator output is folded,
  // so they'd silently do nothing (see `enemyDebuffTargetsFor`). Both stages are
  // legal on `highlightFactor`: a multiplicative debuff scales the highlight
  // bonus, an additive one subtracts from the factor (clamped at neutral by
  // `resolveEnemyDebuffs`, which reads the composite either way).
  const debuffTargetKeys = new Set(enemyDebuffTargets(def).map((f) => f.key))
  for (const attack of def.attacks) {
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'enemyProductionModifier') continue
      if (typeof ref.field === 'string' && !debuffTargetKeys.has(ref.field))
        throw new Error(
          `[${id}] attack '${attack.id}' enemyProductionModifier effect references unknown or unsupported field '${ref.field}' (only resource rates, 'clickIncome' and '${HIGHLIGHT_FACTOR_TARGET}' can be debuffed)`,
        )
    }
  }

  // `enemyCostModifier` effects name a `target` — a whole scope (`upgrades` /
  // `generators`) or one entity (`upgrade:<id>` / `generator:<id>`). Like the
  // debuff `field` above it's a mode-specific string the generic schema only
  // checks is present, so validate it against the enemy-cost catalog: a typo (or
  // an id that no longer exists) would otherwise author an attack that silently
  // does nothing.
  const costTargetKeys = new Set(enemyCostTargets(def).map((f) => f.key))
  for (const attack of def.attacks) {
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'enemyCostModifier') continue
      if (typeof ref.target === 'string' && !costTargetKeys.has(ref.target))
        throw new Error(
          `[${id}] attack '${attack.id}' enemyCostModifier effect references unknown cost target '${ref.target}' (expected 'upgrades', 'generators', 'upgrade:<id>' or 'generator:<id>')`,
        )
    }
  }

  // Active-attack cost/timing + `stealResource` integrity. An active attack that
  // carries effects is *activated* (pay `prepareCost`, wait `prepareTimeSec`,
  // strike), so both fields must be present and well-formed; a passive attack is
  // always-on and never activated, so declaring either is an authoring mistake.
  // Effect-less active attacks stay legal — they're placeholders.
  for (const attack of def.attacks) {
    const hasEffects = (attack.effects?.length ?? 0) > 0
    const hasCost = attack.prepareCost !== undefined && Object.keys(attack.prepareCost).length > 0
    // The effects that consume a debuff window (`durationSec`) on an active
    // attack. Judged by ref type rather than by running the effect, as the steal
    // checks below do — the type is what the author wrote.
    const hasDebuff = (attack.effects ?? []).some((ref) => DEBUFF_EFFECT_TYPES.has(ref.type))

    if (attack.kind === 'passive') {
      if (attack.prepareCost !== undefined || attack.prepareTimeSec !== undefined)
        throw new Error(
          `[${id}] passive attack '${attack.id}' declares prepareCost/prepareTimeSec, but passive attacks are always-on and never activated`,
        )
      if (attack.durationSec !== undefined)
        throw new Error(
          `[${id}] passive attack '${attack.id}' declares durationSec, but a passive attack is always-on — a window is meaningless`,
        )
    } else {
      // active
      if (hasEffects) {
        if (!hasCost)
          throw new Error(
            `[${id}] active attack '${attack.id}' carries effects but has no prepareCost`,
          )
        if (attack.prepareTimeSec === undefined)
          throw new Error(
            `[${id}] active attack '${attack.id}' carries effects but has no prepareTimeSec`,
          )
      }
      if (attack.prepareTimeSec !== undefined && attack.prepareTimeSec < 0)
        throw new Error(`[${id}] active attack '${attack.id}' has a negative prepareTimeSec`)
      // A debuff window is consumed only by the debuff effects, and only they
      // consume it: a debuff effect with no window would be gathered never (the
      // attack would silently do nothing — the failure mode the host check
      // exists to prevent), and a window on an all-steal attack is authored
      // dead weight the countdown UI would show with nothing in it. The
      // schema's `.positive()` covers the file path; this covers a
      // programmatically built mode, as the `prepareTimeSec < 0` check does.
      if (hasDebuff && attack.durationSec === undefined)
        throw new Error(
          `[${id}] active attack '${attack.id}' carries a debuff effect (enemyProductionModifier / enemyCostModifier) but has no durationSec — on an active attack a debuff applies for a window, and without one it would never apply`,
        )
      if (!hasDebuff && attack.durationSec !== undefined)
        throw new Error(
          `[${id}] active attack '${attack.id}' declares durationSec but carries no debuff effect — only enemyProductionModifier / enemyCostModifier consume a window`,
        )
      if (attack.durationSec !== undefined && attack.durationSec <= 0)
        throw new Error(
          `[${id}] active attack '${attack.id}' has a non-positive durationSec (a window no tick could gather)`,
        )
      for (const currency of Object.keys(attack.prepareCost ?? {})) {
        if (!resourceKeys.has(currency))
          throw new Error(
            `[${id}] active attack '${attack.id}' prepareCost references unknown resource '${currency}'`,
          )
      }
    }

    // `stealResource` may only ride an active attack, and must name a real
    // resource. Checked for every attack so a misplaced steal on a passive attack
    // fails loudly rather than silently never resolving.
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'stealResource') continue
      if (attack.kind !== 'active')
        throw new Error(
          `[${id}] attack '${attack.id}' carries a stealResource effect but is not active (steals resolve on a strike, which only active attacks have)`,
        )
      if (typeof ref.resource === 'string' && !resourceKeys.has(ref.resource))
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect references unknown resource '${ref.resource}'`,
        )
      // The take is authored as *either* a share (`fraction`) or a flat quantity
      // (`amount`). The effect's schema already rejects both-or-neither, but as a
      // union it can only report "Invalid input" — so name the mistake here,
      // ahead of the `prepareEffect` pass below that raises the zod error.
      const hasFraction = ref.fraction !== undefined
      const hasAmount = ref.amount !== undefined
      if (hasFraction && hasAmount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect sets both 'fraction' and 'amount' — use exactly one (a share of the victim's stockpile, or a flat quantity)`,
        )
      if (!hasFraction && !hasAmount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect sets neither 'fraction' nor 'amount' — use exactly one (a share of the victim's stockpile, or a flat quantity)`,
        )
    }

    // `stealGenerator` — the generator-side twin, checked the same way: active
    // attacks only, a real generator id, and exactly one of `fraction`/`count`.
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'stealGenerator') continue
      if (attack.kind !== 'active')
        throw new Error(
          `[${id}] attack '${attack.id}' carries a stealGenerator effect but is not active (steals resolve on a strike, which only active attacks have)`,
        )
      if (typeof ref.generator === 'string' && !generatorIds.has(ref.generator))
        throw new Error(
          `[${id}] attack '${attack.id}' stealGenerator effect references unknown generator '${ref.generator}'`,
        )
      const hasFraction = ref.fraction !== undefined
      const hasCount = ref.count !== undefined
      if (hasFraction && hasCount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealGenerator effect sets both 'fraction' and 'count' — use exactly one (a share of the victim's copies, or a flat number of copies)`,
        )
      if (!hasFraction && !hasCount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealGenerator effect sets neither 'fraction' nor 'count' — use exactly one (a share of the victim's copies, or a flat number of copies)`,
        )
    }
  }

  // Effect refs: resolve + parse once up front, so unknown types or malformed
  // params fail at startup rather than mid-tick. Also warms the per-ref cache.
  for (const ref of def.effects ?? []) prepareEffect(ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) prepareEffect(ref)
  }
  for (const attack of def.attacks) {
    for (const ref of attack.effects ?? []) prepareEffect(ref)
  }
}

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Loaded mode definitions, keyed by mode id. Empty at import: modes are loaded
 * at runtime from their (server-served) tree files via `loadTree` (see
 * `shared/src/tree/codec.ts`), not baked into the bundle. Call `loadTree` once
 * at startup before any `getModeDefinition` call (server reads the file from
 * disk; the client fetches it from the server — D17/D18).
 */
const MODE_REGISTRY = new Map<GameMode, ModeDefinition>()

/**
 * Register a validated mode definition under its id. Idempotent: re-registering
 * the same id overwrites it. Called by `loadTree` after parsing + validating a
 * tree file; not meant to be called with hand-built definitions.
 */
export function registerMode(id: GameMode, def: ModeDefinition): void {
  MODE_REGISTRY.set(id, def)
}

/**
 * Look up the mode definition for a GameMode. Throws if the mode has not been
 * loaded yet — a missing load is a boot-order bug that should surface loudly.
 */
export function getModeDefinition(mode: GameMode): ModeDefinition {
  const def = MODE_REGISTRY.get(mode)
  if (!def) {
    throw new Error(`Mode '${mode}' is not loaded — call loadTree() at startup before use`)
  }
  return def
}

/**
 * Look up a mode definition, or `undefined` if it has not been loaded. Unlike
 * {@link getModeDefinition} this never throws — for callers that must degrade
 * gracefully when a mode's tree isn't loaded (e.g. the balance registry).
 */
export function getModeDefinitionOrUndefined(mode: GameMode): ModeDefinition | undefined {
  return MODE_REGISTRY.get(mode)
}

/** All currently-loaded mode definitions (registration order). */
export function getLoadedModeDefinitions(): ModeDefinition[] {
  return [...MODE_REGISTRY.values()]
}

/**
 * All game mode keys the app knows about. Static (the `GameMode` union), so it is
 * available before any tree is loaded — distinct from whether a mode's data has
 * been loaded into the registry. Used for input validation and the lobby picker.
 */
export const AVAILABLE_MODES: readonly GameMode[] = ['idler']

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return getModeDefinition(mode).goals[0]
}

/**
 * Apply a creator's custom value (target score / duration) onto a predefined
 * goal, clamping it to safe bounds. Non-customizable fields (label, safety cap)
 * always come from `base`, so the result is authoritative regardless of what
 * the client sent. Returns `base` unchanged for goal types without a tunable.
 */
export function customizeGoal(base: Goal, requested: Goal): Goal {
  if (base.type === 'target-score' && requested.type === 'target-score') {
    return { ...base, target: clampInt(requested.target, MIN_TARGET_SCORE, MAX_TARGET_SCORE) }
  }
  if (base.type === 'timed' && requested.type === 'timed') {
    return {
      ...base,
      durationSec: clampInt(requested.durationSec, MIN_ROUND_DURATION_SEC, MAX_ROUND_DURATION_SEC),
    }
  }
  return base
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Upgrades visible/valid under the given goal — filters out goal-tagged upgrades whose tag doesn't match. */
export function getAvailableUpgrades(
  mode: ModeDefinition,
  goal: Goal | null,
): readonly UpgradeDefinition[] {
  return mode.upgrades.filter((u) => !u.goalType || u.goalType === goal?.type)
}

// ─── Initial State ───────────────────────────────────────────────────

/** Create a fresh player state for a given mode. */
export function createInitialState(mode: ModeDefinition): PlayerState {
  return {
    score: 0,
    resources: { ...mode.initialResources },
    upgrades: Object.fromEntries(mode.upgrades.map((u) => [u.id, 0])),
    generators: Object.fromEntries(mode.generators.map((g) => [g.id, 0])),
    pendingAttacks: [],
    meta: structuredClone(mode.initialMeta),
  }
}

// ─── Purchase Helpers ─────────────────────────────────────────────────

/** Whether an upgrade can be purchased infinitely. */
export function isUnlimited(upgrade: UpgradeDefinition): boolean {
  return upgrade.purchaseLimit === Infinity
}

/** Whether an upgrade has reached its purchase limit. */
export function isMaxed(upgrade: UpgradeDefinition, ownedCount: number): boolean {
  return ownedCount >= upgrade.purchaseLimit
}

// ─── Highlight ────────────────────────────────────────────────────────
//
// The `is*Unlocked` / `is*Active` system predicates live in `unlock-gates`.

/**
 * Apply a highlight selection to `state`, returning whether it was accepted.
 *
 * The one validator for the mechanic: the highlight must be unlocked, and the
 * selection must be either a resource this mode declares or `null` (release).
 * Every writer goes through here — the server's player and bot paths, the
 * client's prediction and its reconciliation replay, and the simulator — so a
 * selection can't be legal on one and silently dropped on another.
 */
export function applyHighlightSelection(
  state: PlayerState,
  mode: ModeDefinition,
  highlight: string | null,
): boolean {
  if (!isHighlightActive(state, mode)) return false
  if (highlight !== null && !mode.resources.includes(highlight)) return false
  state.meta.highlight = highlight
  return true
}

/**
 * The multiplicative bonus currently applied to the highlighted resource:
 * `highlightMultiplier` effects — mode-level (always on) and owned upgrades
 * (compounding `multiplier ^ owned`, matching `collectModifiers`) — times the
 * highlight battery's current factor.
 *
 * Returns `1` when nothing boosts the highlight, and also while nothing is
 * highlighted, since the effects go inactive with no resource to land on.
 * Otherwise independent of *which* resource is highlighted (the factor only
 * moves between resources).
 */
export function getHighlightMultiplier(state: Readonly<PlayerState>, mode: ModeDefinition): number {
  // Released → no bonus lands anywhere, so report neutral rather than the
  // battery factor alone (which has no resource to multiply).
  if (readHighlight(state) === null) return 1
  let mult = batteryFactor(state, mode)

  const accumulate = (refs: readonly EffectRef[] | undefined, owned: number): void => {
    for (const ref of refs ?? []) {
      if (ref.type !== 'highlightMultiplier') continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if ('kind' in out && out.kind === 'baseModifier' && out.stage === 'multiplicative') {
          mult *= out.value ** owned
        }
      }
    }
  }

  accumulate(mode.effects, 1)
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) accumulate(upgrade.effects, owned)
  }
  return mult
}

/**
 * Whether a UI panel is currently accessible for this player. A panel is gated by
 * any `panelUnlock` effect naming it: locked until that grant is in force (an
 * owned upgrade, or the mode's starting effects, which grant for the whole round).
 * Panels nothing unlocks are always available. (See `unlock-gates` for the reverse
 * index this and the other unlock gates share — `isPanelUnlocked` runs every frame
 * via the tab-lock refresh, so the check is an O(grants-for-this-panel) lookup,
 * not a full tree scan.)
 */
export function isPanelUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  panelId: string,
): boolean {
  const gate = panelGate(mode, panelId)
  if (!gate) return true // nothing gates this panel → always available
  return isGranted(state, gate)
}

/**
 * Whether an attack is available to this player. Granted by an `unlockAttack`
 * effect naming it — an owned upgrade's, or one of the mode's starting effects.
 * Unlike `isPanelUnlocked`, an attack nothing unlocks is *hidden* by default
 * (attacks only appear once unlocked). The attack itself has no behavior yet —
 * this gates its appearance in the attack panel.
 */
export function isAttackUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  attackId: string,
): boolean {
  return isGranted(state, attackGate(mode, attackId))
}

/** The attack ids this player has unlocked, in mode declaration order. */
export function unlockedAttacks(state: Readonly<PlayerState>, mode: ModeDefinition): string[] {
  return allAttackIds(mode).filter((id) => isAttackUnlocked(state, mode, id))
}

/**
 * Whether a pact is available to this player. Granted by an `unlockPact` effect
 * naming it — an owned upgrade's, or one of the mode's starting effects. Unlike
 * `isPanelUnlocked`, a pact nothing unlocks is *hidden* by default (pacts only
 * appear once unlocked). The pact itself has no behavior yet — this gates its
 * appearance in the international relationship panel.
 */
export function isPactUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  pactId: string,
): boolean {
  return isGranted(state, pactGate(mode, pactId))
}

/** The pact ids this player has unlocked, in mode declaration order. */
export function unlockedPacts(state: Readonly<PlayerState>, mode: ModeDefinition): string[] {
  return allPactIds(mode).filter((id) => isPactUnlocked(state, mode, id))
}

/**
 * Whether the viewing player may see a slice of opponent intel (e.g.
 * `'resources'`) in the espionage panel. Granted by an `accessEnemyData` effect
 * naming that key — an owned upgrade's, or one of the mode's starting effects.
 * Unlike `isPanelUnlocked`, an ungranted key is *hidden* by default (a key nothing
 * grants is never visible). `state` is the *viewer's* own state — the spy unlocks
 * visibility into the opponent.
 */
export function hasEnemyDataAccess(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  dataKey: string,
): boolean {
  return isGranted(state, enemyDataGate(mode, dataKey))
}

// ─── Modifier Collection ─────────────────────────────────────────────

/** Generator-targeted bonuses accumulated for one generator, before its owned count. */
interface GeneratorAccumulator {
  additive: number
  multiplicative: number
}

/** The modifier pass's raw result, before generator output is folded into resources. */
interface CollectedModifiers {
  /** Everything the pipeline consumes directly (resource + click tracks). */
  readonly modifiers: Modifier[]
  /** Per-generator bonuses, keyed by generator id (an entry per declared generator). */
  readonly generatorModifiers: Map<string, GeneratorAccumulator>
}

/**
 * Expand an aggregate sentinel `field` into the concrete targets it stands for
 * ({@link ALL_RESOURCES_FIELD} → every resource, {@link ALL_GENERATORS_FIELD} →
 * every generator id), or `null` if `field` isn't a sentinel. The single source
 * of truth for what "all resources"/"all generators" means, shared by the
 * pipeline routing (which *applies* each target) and the dynamic-bonus report
 * (which *lists* them), so the two can never disagree.
 */
function expandAggregateField(field: string, mode: ModeDefinition): readonly string[] | null {
  if (field === ALL_RESOURCES_FIELD) return mode.resources
  if (field === ALL_GENERATORS_FIELD) return mode.generators.map((g) => g.id)
  return null
}

/**
 * Run the modifier pass: mode-level effects + owned upgrades, with
 * generator-targeted modifiers held back in their own accumulators rather than
 * folded into resource rates. Shared by {@link collectModifiers} (which folds
 * them) and {@link collectGeneratorOutputs} (which reports them).
 */
function collectRawModifiers(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): CollectedModifiers {
  const modifiers: Modifier[] = []

  const generatorIds = new Set(mode.generators.map((g) => g.id))
  const generatorModifiers = new Map<string, { additive: number; multiplicative: number }>()
  for (const gen of mode.generators) {
    generatorModifiers.set(gen.id, { additive: 0, multiplicative: 1 })
  }

  // Route a single state-derived modifier: an aggregate sentinel fans out into
  // one call per concrete target; generator-targeted ones accumulate into the
  // per-generator totals; everything else is pushed directly. Sentinels are
  // expanded here, so the pure pipeline never sees one.
  const applyToGenerator = (
    acc: GeneratorAccumulator,
    stage: ModifierStage,
    value: number,
  ): void => {
    if (stage === 'additive') acc.additive += value
    else acc.multiplicative *= value
  }
  const routeModifier = (mod: Modifier): void => {
    const expanded = expandAggregateField(mod.field, mode)
    if (expanded) {
      for (const field of expanded) routeModifier({ ...mod, field })
      return
    }
    if (generatorIds.has(mod.field)) {
      applyToGenerator(generatorModifiers.get(mod.field)!, mod.stage, mod.value)
    } else {
      modifiers.push(mod)
    }
  }

  // Route a `baseModifier` output with the owning upgrade's owned-count
  // compounding: additive scales linearly (× owned), multiplicative compounds
  // (^ owned). An aggregate sentinel fans out after compounding; generator-
  // targeted bonuses feed the per-generator accumulator (additive per-unit ×
  // owned, applied again per generator below); everything else is pushed to the
  // pipeline. Reproduces the legacy per-upgrade `modifiers` array exactly.
  const routeBaseModifier = (o: BaseModifierOutput, owned: number): void => {
    const expanded = expandAggregateField(o.field, mode)
    if (expanded) {
      for (const field of expanded) routeBaseModifier({ ...o, field }, owned)
      return
    }
    const value = o.stage === 'additive' ? o.value * owned : o.value ** owned
    if (generatorIds.has(o.field)) {
      applyToGenerator(generatorModifiers.get(o.field)!, o.stage, value)
    } else {
      modifiers.push({ stage: o.stage, field: o.field, value })
    }
  }

  // Route an effect's outputs. Production `Modifier`s feed the pipeline verbatim;
  // `baseModifier`s feed it with owned-count compounding — per-upgrade effects
  // pass the owning upgrade's owned count, while mode-level effects (no count)
  // apply once (`owned ?? 1`). Cost-track outputs (`GeneratorCostOutput`) and
  // the unlock outputs belong to other subsystems and are ignored here.
  const routeEffect = (
    out: EffectOutput | readonly EffectOutput[] | null,
    owned?: number,
  ): void => {
    for (const o of normalizeEffectOutputs(out)) {
      if ('kind' in o && o.kind === 'baseModifier') {
        routeBaseModifier(o, owned ?? 1)
      } else if ('stage' in o) {
        routeModifier(o)
      }
    }
  }

  // Mode-level effects — state-derived modifiers applied to every player.
  for (const ref of mode.effects ?? []) {
    routeEffect(applyEffect(ref, state, mode))
  }

  // Upgrade-level effects — per-upgrade bonuses (owned upgrades only). `owned`
  // drives `baseModifier` compounding; state-derived effects ignore it.
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue
    for (const ref of upgrade.effects ?? []) {
      routeEffect(applyEffect(ref, state, mode), owned)
    }
  }

  // The highlight battery multiplies the highlighted resource on top of whatever
  // `highlightMultiplier` effects already gave it. Applied here rather than as a
  // registered effect for two reasons: its parameters are *already* folded across
  // every owning upgrade by `collectBatteryParams`, so routing it through
  // `routeBaseModifier` would compound the owned count a second time; and an
  // effect that reads the battery would close an import cycle
  // (`effects/index` → seed → `highlight-battery` → `effects/index`).
  const highlight = readHighlight(state)
  if (highlight !== null) {
    const factor = batteryFactor(state, mode)
    if (factor !== 1) routeModifier({ stage: 'multiplicative', field: highlight, value: factor })
  }

  return { modifiers, generatorModifiers }
}

/**
 * How much one generator produces, broken into the parts that compose it:
 * `effective = (ratePerUnit + additivePerUnit) × owned × multiplier`.
 *
 * These are the generator's *own* numbers — resource-wide stages (highlight,
 * global multipliers, enemy debuffs) apply afterwards to the resource as a
 * whole, so a generator's delivered share of a rate can exceed `effective`.
 */
export interface GeneratorOutput {
  /** How many of this generator the player owns (0 for unowned). */
  readonly owned: number
  /** The generator's authored rate, per unit. */
  readonly ratePerUnit: number
  /** Additive bonuses granted to this generator, per unit. */
  readonly additivePerUnit: number
  /** Multiplicative bonuses on this generator's total output (1 = none). */
  readonly multiplier: number
  /** What this generator feeds the pipeline, before resource-wide stages. */
  readonly effective: number
}

/** Compose one generator's output from its authored rate + accumulated bonuses. */
function generatorOutput(
  gen: GeneratorDefinition,
  owned: number,
  acc: GeneratorAccumulator,
): GeneratorOutput {
  const ratePerUnit = gen.production.rate
  return {
    owned,
    ratePerUnit,
    additivePerUnit: acc.additive,
    multiplier: acc.multiplicative,
    effective: (ratePerUnit + acc.additive) * owned * acc.multiplicative,
  }
}

/**
 * Collect all active modifiers for a player: mode-level effects + owned upgrades.
 * This is the bridge between game domain types and the pure pipeline.
 *
 * Generator-targeted bonuses are folded here: each owned generator contributes
 * its {@link GeneratorOutput.effective} rate as one additive modifier on the
 * resource it produces (see {@link collectGeneratorOutputs} for the parts).
 */
export function collectModifiers(state: Readonly<PlayerState>, mode: ModeDefinition): Modifier[] {
  const { modifiers, generatorModifiers } = collectRawModifiers(state, mode)

  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (owned <= 0) continue
    const { effective } = generatorOutput(gen, owned, generatorModifiers.get(gen.id)!)
    modifiers.push({ stage: 'additive', field: gen.production.resource, value: effective })
  }

  return modifiers
}

/**
 * Decompose every generator's output into its authored rate, the additive
 * bonuses it has been granted, and its multiplier — the parts `collectModifiers`
 * collapses into a single number. For display (the data panel's per-generator
 * rows); the pipeline itself only needs the composed rate.
 *
 * Every declared generator gets an entry, including unowned ones (`owned: 0`,
 * `effective: 0`) — their bonus accumulators are still reported, so a caller can
 * show what a generator *would* produce.
 */
export function collectGeneratorOutputs(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Record<string, GeneratorOutput> {
  const { generatorModifiers } = collectRawModifiers(state, mode)
  const outputs: Record<string, GeneratorOutput> = {}
  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    outputs[gen.id] = generatorOutput(gen, owned, generatorModifiers.get(gen.id)!)
  }
  return outputs
}

/**
 * Attribution of one resource's passive rate to the systems that produce it.
 * `base + generators` always equals `total` (the same number the header shows),
 * and `byGenerator` sums to `generators`. See {@link computeRateBreakdown}.
 */
export interface ResourceRateBreakdown {
  /** Authoritative per-second rate (matches `computePassiveRates`). */
  total: number
  /**
   * The base producer: the mode's starting effects, *including* every
   * upgrade boost applied to them. Upgrades are not a bucket of their own — a
   * base-boosting upgrade shows up here, a generator-boosting one in
   * `generators`.
   */
  base: number
  /** Contribution of all generators producing this resource. */
  generators: number
  /** Per-generator contribution (owned generators producing this resource). */
  byGenerator: Record<string, number>
}

/** Shallow player-state clone with every generator un-owned. */
function playerWithoutGenerators(state: Readonly<PlayerState>): PlayerState {
  return {
    score: state.score,
    resources: { ...state.resources },
    upgrades: { ...state.upgrades },
    generators: {},
    pendingAttacks: [...state.pendingAttacks],
    meta: structuredClone(state.meta),
  }
}

/**
 * Decompose each resource's passive rate into base / generator contributions,
 * for display (e.g. the data panel).
 *
 * The generator bucket is measured by *differencing* the full pipeline against
 * the pipeline with no generators owned, so shared multiplicative stages
 * (highlight, global multipliers, debuffs) cancel and the two buckets telescope
 * back to the authoritative total — regardless of how the modifiers compose.
 * Optional `debuffs` (from `collectEnemyDebuffs`) are merged in so the total
 * matches the income the server actually applies.
 *
 * `byGenerator` splits the generator bucket across owned generators in
 * proportion to their *effective* output (`collectGeneratorOutputs`, i.e. after
 * their own additive/multiplicative bonuses); generators are mutually additive,
 * so this preserves the exact bucket sum. Weighting by the authored rate instead
 * would misattribute the bucket whenever a bonus targets one generator — a
 * ×3-boosted tier would report the same share as an unboosted one.
 *
 * Upgrades are deliberately *not* a bucket: they have no standalone output, they
 * scale whichever producer they target. An upgrade boosting generator output is
 * folded into `generators`, one boosting the base producer into `base`.
 */
export function computeRateBreakdown(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  debuffs: readonly Modifier[] = [],
): Record<string, ResourceRateBreakdown> {
  const { resources } = mode
  const rateFor = (player: Readonly<PlayerState>): Record<string, number> =>
    computePassiveRates([...collectModifiers(player, mode), ...debuffs], resources)

  const total = rateFor(state)
  const noGen = rateFor(playerWithoutGenerators(state))

  // Effective generator output per resource, for proportionally splitting the
  // generator bucket across the individual generators that feed it.
  const outputs = collectGeneratorOutputs(state, mode)
  const genOutByResource = new Map<string, { total: number; byId: Record<string, number> }>()
  for (const gen of mode.generators) {
    const { effective } = outputs[gen.id]
    if (effective <= 0) continue
    const entry = genOutByResource.get(gen.production.resource) ?? { total: 0, byId: {} }
    entry.total += effective
    entry.byId[gen.id] = (entry.byId[gen.id] ?? 0) + effective
    genOutByResource.set(gen.production.resource, entry)
  }

  const result: Record<string, ResourceRateBreakdown> = {}
  for (const r of resources) {
    const t = total[r] ?? 0
    const base = noGen[r] ?? 0
    const generators = t - base

    const byGenerator: Record<string, number> = {}
    const out = genOutByResource.get(r)
    if (out && out.total > 0) {
      for (const [id, effective] of Object.entries(out.byId)) {
        byGenerator[id] = generators * (effective / out.total)
      }
    }

    result[r] = { total: t, base, generators, byGenerator }
  }
  return result
}

/**
 * One owned upgrade's *live* contribution: the modifiers its state-dependent
 * effects emit for the state it was collected against. See
 * {@link collectDynamicBonuses}.
 */
export interface DynamicBonus {
  /** The owned upgrade these modifiers come from. */
  readonly upgradeId: string
  /** What it is contributing right now (never empty). */
  readonly modifiers: readonly Modifier[]
}

/**
 * Snapshot what every owned *dynamic* upgrade is worth at this instant, for
 * display (e.g. the data panel's live-bonuses section).
 *
 * Only effects flagged `dynamic` (see `EffectDef.dynamic`) are read — a bank
 * that scales with the stockpile, a synergy that tracks generator ownership.
 * Flat bonuses are excluded on purpose: their value is already printed on the
 * upgrade card, so re-listing them would bury the numbers that actually move.
 * An upgrade whose dynamic effects are all currently inactive (no generators
 * owned, empty stockpile) is omitted entirely.
 *
 * Dynamic effects emit raw {@link Modifier}s, which are applied verbatim — no
 * owned-count compounding — so what's reported here is exactly what the
 * pipeline receives. Mode-level effects are out of scope: they're always-on and
 * have no upgrade to name in the UI.
 */
export function collectDynamicBonuses(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): DynamicBonus[] {
  const bonuses: DynamicBonus[] = []
  for (const upgrade of mode.upgrades) {
    if ((state.upgrades[upgrade.id] ?? 0) <= 0) continue
    const modifiers: Modifier[] = []
    for (const ref of upgrade.effects ?? []) {
      if (!isDynamicEffect(ref.type)) continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        // Only raw pipeline modifiers are reportable here. A dynamic effect that
        // returns a *kinded* output (e.g. a `baseModifier`) is skipped — the UI
        // has no owned-count-compounded value to show for it. Keep dynamic
        // effects emitting raw `Modifier`s if their live worth should surface.
        if ('kind' in out || !('stage' in out)) continue
        // Fan out an aggregate sentinel to its concrete targets so the report
        // matches the pipeline (and the panel can collapse "all resources").
        const expanded = expandAggregateField(out.field, mode)
        if (expanded) for (const field of expanded) modifiers.push({ ...out, field })
        else modifiers.push(out)
      }
    }
    if (modifiers.length > 0) bonuses.push({ upgradeId: upgrade.id, modifiers })
  }
  return bonuses
}

/**
 * Collect the *offensive* modifiers a player's attacks currently inflict on the
 * **opponent**. These are gathered from `attacker` but applied to the other
 * player's pipeline (merge them with the defender's own `collectModifiers`
 * output before running `computePassiveRates` / `applyPassiveTick`).
 *
 * Two sources, walked by {@link attacksInForce}: every unlocked `passive`
 * attack (always-on), and every `active` attack whose debuff window is open
 * (see `resolveAttackStrike`). Each attack's `enemyModifier`-emitting effects
 * (e.g. `enemyProductionModifier`) become raw {@link Modifier}s (no owned-count
 * compounding — an attack is unlocked or it isn't). The attacker's state is
 * passed to `applyEffect` so state-relative debuffs can read it; today's effects
 * are state-independent.
 *
 * The authored value is scaled by the attacker's `power`
 * ({@link collectAttackParams}) via {@link scaleDebuffValue} — which moves the
 * *distance from neutral*, so a stronger debuff means `0.9 → 0.8`, never
 * `0.9 → 1.8`.
 *
 * Debuffs come out **as authored**, which can include the virtual
 * {@link HIGHLIGHT_FACTOR_TARGET} field. Run them through
 * {@link resolveEnemyDebuffs} before handing them to the pipeline.
 */
export function collectEnemyDebuffs(
  attacker: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] {
  const debuffs: Modifier[] = []
  for (const attack of attacksInForce(attacker, mode)) {
    const { power } = collectAttackParams(attacker, mode, attack.id)
    for (const ref of attack.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, attacker, mode))) {
        if (!('kind' in out) || out.kind !== 'enemyModifier') continue
        const { stage, field, value } = out.modifier
        debuffs.push({ stage, field, value: scaleDebuffValue(stage, value, power) })
      }
    }
  }
  return debuffs
}

/**
 * The floor a highlight debuff can drag the effective factor down to. Held at
 * neutral (×1) on purpose: an incoming debuff can cancel the highlight bonus but
 * never invert it into a penalty, so a debuffed highlight is never *worse* than
 * releasing.
 */
export const HIGHLIGHT_DEBUFF_FLOOR = 1

/**
 * The victim's effective highlight factor once incoming highlight debuffs scale
 * its **bonus**, not the whole factor.
 *
 * `factor` is the composite F (`getHighlightMultiplier`: battery × every
 * `highlightMultiplier`). The highlight-factor debuffs fold as
 *
 *   F' = max(1, 1 + (F − 1)·∏vₘ + Σvₐ)
 *
 * over their multiplicative values (vₘ ∈ (0,1)) and additive ones (vₐ < 0).
 * Scaling the bonus above neutral — rather than the whole factor — makes one
 * authored value mean "your highlight investment is worth N% less" at every
 * point on the curve, instead of erasing a small factor while barely denting a
 * large one. A multiplicative debuff shrinks the bonus (F' stays > 1); an
 * additive one subtracts from the factor and can cancel the bonus entirely, but
 * the {@link HIGHLIGHT_DEBUFF_FLOOR} clamps it at neutral — never a penalty.
 *
 * Returns `factor` unchanged when there is no bonus to cut (F ≤ 1) — an
 * uninvested highlight takes no debuff, and it keeps the F' / F ratio safe.
 */
export function debuffedHighlightFactor(factor: number, debuffs: readonly Modifier[]): number {
  if (factor <= 1) return factor
  let mult = 1
  let add = 0
  for (const debuff of debuffs) {
    if (debuff.field !== HIGHLIGHT_FACTOR_TARGET) continue
    if (debuff.stage === 'additive') add += debuff.value
    else mult *= debuff.value
  }
  return Math.max(HIGHLIGHT_DEBUFF_FLOOR, 1 + (factor - 1) * mult + add)
}

/**
 * The attacks whose offensive effects `attacker` is inflicting right now, in a
 * stable order: every unlocked **passive** attack (always-on), then every
 * **active** attack with an open debuff window, in the order the windows were
 * opened. The single walk both enemy-debuff collectors share, so "what is in
 * force" can't be answered differently for production than for prices.
 *
 * The window pass deliberately skips the unlock re-check the passive pass makes:
 * the strike already landed and was paid for, so whether the gating upgrade is
 * still held is not a question the engine should be able to answer differently
 * (unlocks are monotonic today, so this is future-proofing, not a behavior
 * change). Expiry is judged here, at read time, against the attacker's own
 * `meta.gameSec` — an expired window the server has not swept yet contributes
 * nothing, which is what makes the sweep hygiene rather than correctness. A
 * window naming an unknown attack is skipped.
 */
function attacksInForce(attacker: Readonly<PlayerState>, mode: ModeDefinition): AttackDefinition[] {
  const attackById = new Map(mode.attacks.map((a) => [a.id, a]))
  const inForce: AttackDefinition[] = []
  for (const attackId of unlockedAttacks(attacker, mode)) {
    const attack = attackById.get(attackId)
    if (attack?.kind === 'passive') inForce.push(attack)
  }
  const gameSec = (attacker.meta.gameSec as number | undefined) ?? 0
  for (const window of attacker.activeDebuffs ?? []) {
    if (window.expiresAtSec <= gameSec) continue
    const attack = attackById.get(window.attack)
    if (attack?.kind === 'active') inForce.push(attack)
  }
  return inForce
}

/**
 * Collect the *offensive cost inflation* a player's attacks currently inflict
 * on the **opponent** — the cost-path twin of {@link collectEnemyDebuffs},
 * gathered from `attacker` and applied to the other player's prices.
 *
 * The same two sources ({@link attacksInForce}: unlocked passive attacks and
 * open active-attack windows), and each `enemyCost`-emitting effect
 * contributes once (no owned-count compounding — an attack is unlocked or it
 * isn't), with both factors scaled by the attacker's `power` through
 * {@link scaleCostFactor}: `1 + (f - 1) × power`, the growth portion again
 * rather than the whole factor. The result is stamped onto the victim's
 * {@link PlayerState.incomingCostFactors} by the server, which is where every
 * price path reads it from; unlike a production debuff there is nothing to
 * resolve against the victim afterwards, so no `resolve*` step is needed.
 */
export function collectEnemyCostFactors(
  attacker: Readonly<PlayerState>,
  mode: ModeDefinition,
): EnemyCostFactor[] {
  const factors: EnemyCostFactor[] = []
  for (const attack of attacksInForce(attacker, mode)) {
    const { power } = collectAttackParams(attacker, mode, attack.id)
    for (const ref of attack.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, attacker, mode))) {
        if (!('kind' in out) || out.kind !== 'enemyCost') continue
        factors.push({
          scope: out.scope,
          ...(out.id !== undefined ? { id: out.id } : {}),
          ...(out.costFactor !== undefined
            ? { costFactor: scaleCostFactor(out.costFactor, power) }
            : {}),
          ...(out.scalingFactor !== undefined
            ? { scalingFactor: scaleCostFactor(out.scalingFactor, power) }
            : {}),
        })
      }
    }
  }
  return factors
}

/**
 * Resolve authored enemy debuffs against the player they land on, turning them
 * into modifiers the production pipeline can consume.
 *
 * Real pipeline targets pass through untouched, except `clickIncome`, which is
 * rewritten to {@link INCOMING_CLICK_INCOME_FIELD} so the click track can tell
 * the victim's own click power from the enemy's drain (see `ClickLayers`). Every
 * {@link
 * HIGHLIGHT_FACTOR_TARGET} entry names no field — it scales the victim's
 * *highlight bonus* (see {@link debuffedHighlightFactor}), which the pipeline
 * can't express directly — so they are folded into a single multiplicative
 * modifier on whichever resource `victim` is holding: the ratio F' / F between
 * the debuffed and live composite factor. One modifier, not one per entry, so
 * the bonus is scaled once rather than re-dividing the ratio against F.
 *
 * Unlike a plain rate debuff this reads the victim's live composite F, so it
 * must run against the state each side actually holds — which is why the wire
 * carries debuffs *unresolved* and every call site passes `mode`.
 *
 * A released highlight (or an uninvested one, F ≤ 1) drops the entry — there is
 * no bonus for the factor to scale. The debuff is clamped at neutral, so a held
 * highlight is never worse than a released one.
 */
export function resolveEnemyDebuffs(
  debuffs: readonly Modifier[],
  victim: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] {
  const highlight = readHighlight(victim)
  const resolved: Modifier[] = []
  let hasHighlightDebuff = false
  for (const debuff of debuffs) {
    if (debuff.field === HIGHLIGHT_FACTOR_TARGET) hasHighlightDebuff = true
    else if (debuff.field === 'clickIncome')
      resolved.push({ ...debuff, field: INCOMING_CLICK_INCOME_FIELD })
    else resolved.push(debuff)
  }
  if (hasHighlightDebuff && highlight !== null) {
    const factor = getHighlightMultiplier(victim, mode)
    const debuffed = debuffedHighlightFactor(factor, debuffs)
    if (debuffed !== factor)
      resolved.push({ stage: 'multiplicative', field: highlight, value: debuffed / factor })
  }
  return resolved
}

/**
 * The multiplicative bonus-scale incoming highlight debuffs apply to this
 * player's highlight — ∏ of the *multiplicative* {@link HIGHLIGHT_FACTOR_TARGET}
 * values, or `1` when none.
 *
 * For the espionage panel's release-independent warning ("your highlight bonus
 * is cut by N%", N = (1 − this)·100): the multiplicative scale means the same
 * thing whether or not a resource is held, so it can warn a released player that
 * holding is worth less than the tree claims. Additive highlight debuffs are
 * excluded — their bite depends on the live factor, so they have no
 * release-independent percentage and surface in the data panel's held factor
 * instead. Not for income; {@link resolveEnemyDebuffs} owns the pipeline path.
 */
export function highlightDebuffFactor(debuffs: readonly Modifier[]): number {
  let factor = 1
  for (const debuff of debuffs) {
    if (debuff.field === HIGHLIGHT_FACTOR_TARGET && debuff.stage === 'multiplicative')
      factor *= debuff.value
  }
  return factor
}

// ─── Purchase ────────────────────────────────────────────────────────

/**
 * Apply an upgrade purchase to the player state.
 * Deducts the cost from the correct resource and grants the upgrade.
 * Mutates `state` in place.
 *
 * Callers are responsible for validating that the purchase is legal.
 */
export function applyPurchase(state: PlayerState, upgradeId: string, mode: ModeDefinition): void {
  const def = mode.upgrades.find((u) => u.id === upgradeId)
  if (!def) return

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return

  // Deduct each currency in the cost map, at the price the player is actually
  // quoted (enemy cost inflation included — the same factors `purchaseBlockReason`
  // checked affordability against).
  const cost = getUpgradeNextCost(def, owned, upgradeCostFactors(state, upgradeId))
  for (const [currency, amount] of Object.entries(cost)) {
    state.resources[currency] = (state.resources[currency] ?? 0) - amount
  }

  // Grant upgrade
  state.upgrades[upgradeId] = owned + 1

  // Date the purchase. Every level is kept for the upgrades a time clock reads
  // (`timedUpgradeIds`), whose levels are priced individually; everything else
  // keeps just its first buy, so a cheap unlimited upgrade can't grow the
  // broadcast state one entry per click.
  recordPurchaseTime(state, upgradeId, timedUpgradeIds(mode).has(upgradeId))
}

/**
 * Normalize upgrade counts in a loaded `PlayerState` to respect `purchaseLimit`.
 * Useful for migration when loading older save files.
 */
export function normalizeUpgrades(state: PlayerState, mode: ModeDefinition): void {
  for (const u of mode.upgrades) {
    if (isUnlimited(u)) continue
    const cur = state.upgrades[u.id] ?? 0
    if (cur > u.purchaseLimit) state.upgrades[u.id] = u.purchaseLimit
  }
}
