/**
 * Generate docs/MANUAL.md from the structured feature registry.
 *
 * Usage:  pnpm generate:manual
 * (or)    npx tsx scripts/generate-manual.ts
 *
 * The CI check verifies the committed MANUAL.md matches this output.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  HOTKEYS,
  SCREENS,
  CONCEPTS,
  PANELS,
  AVAILABLE_MODES,
  getModeDefinition,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`
}

function table(headers: string[], rows: string[][]): string {
  const header = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${header}\n${separator}\n${body}`
}

// ─── Sections ────────────────────────────────────────────────────────

function renderConcepts(): string {
  const lines: string[] = [heading(2, 'Core Concepts'), '']
  for (const concept of CONCEPTS) {
    lines.push(heading(3, concept.name), '', concept.body, '')
  }
  return lines.join('\n')
}

function renderScreens(): string {
  const lines: string[] = [heading(2, 'Screens'), '']
  const rows = SCREENS.map((s) => [s.name, s.description])
  lines.push(table(['Screen', 'Description'], rows), '')
  return lines.join('\n')
}

function renderPanels(): string {
  const lines: string[] = [heading(2, 'Panels'), '']
  const rows = PANELS.map((p) => [`${p.icon} ${p.name}`, p.description])
  lines.push(table(['Panel', 'Description'], rows), '')
  return lines.join('\n')
}

function renderHotkeys(): string {
  const lines: string[] = [heading(2, 'Keyboard Shortcuts'), '']
  const rows = HOTKEYS.map((h) => {
    const action = h.note ? `${h.action} ${h.note}` : h.action
    return [`\`${h.key}\``, h.context, action]
  })
  lines.push(table(['Key', 'Context', 'Action'], rows), '')
  return lines.join('\n')
}

function renderModes(): string {
  const lines: string[] = [heading(2, 'Game Modes'), '']

  for (const modeId of AVAILABLE_MODES) {
    const mode = getModeDefinition(modeId)
    const { flavor } = mode

    lines.push(heading(3, `${flavor.displayName} Mode`), '')

    // Resources
    const resList = flavor.resources.map((r) => `${r.icon} **${r.displayName}**`).join(', ')
    lines.push(`**Resources:** ${resList}`, '')

    // Generators
    if (mode.generators.length > 0) {
      lines.push(heading(4, 'Generators'), '')
      const genRows = mode.generators.map((gen) => {
        const gf = flavor.generators.find((g) => g.id === gen.id)
        const name = gf ? `${gf.icon} ${gf.name}` : gen.id
        const rf = flavor.resources.find((r) => r.key === gen.production.resource)
        const resource = rf ? rf.displayName : gen.production.resource
        return [
          name,
          `${gen.baseCost}`,
          `×${gen.costScaling}`,
          `+${gen.production.rate} ${resource}/s`,
        ]
      })
      lines.push(table(['Generator', 'Base Cost', 'Scaling', 'Production (per copy)'], genRows), '')
    }

    // Goals
    lines.push(heading(4, 'Goals'), '')
    const goalRows = mode.goals.map((goal) => {
      switch (goal.type) {
        case 'timed':
          return [goal.label, `Highest score in ${goal.durationSec}s`]
        case 'target-score':
          return [goal.label, `First to ${goal.target} score (cap: ${goal.safetyCapSec}s)`]
        case 'buy-upgrade':
          return [goal.label, `First to buy the trophy upgrade (cap: ${goal.safetyCapSec}s)`]
      }
    })
    lines.push(table(['Goal', 'Description'], goalRows), '')
  }

  return lines.join('\n')
}

// ─── Main ────────────────────────────────────────────────────────────

function generate(): string {
  const lines: string[] = [
    '# Player Manual',
    '',
    '> Auto-generated from the feature registry.',
    '> **Do not edit manually** — run `pnpm generate:manual` to regenerate.',
    '',
    renderConcepts(),
    renderScreens(),
    renderPanels(),
    renderModes(),
    renderHotkeys(),
  ]
  return lines.join('\n')
}

const output = generate()
const outPath = resolve(import.meta.dirname, '..', 'docs', 'MANUAL.md')
writeFileSync(outPath, output, 'utf-8')
console.log(`✓ Generated ${outPath}`)
