/**
 * Agent-customization lint.
 *
 * Keeps the `.github` customization files honest so they can't silently rot:
 * - Relative Markdown links in the customization files resolve to real files.
 * - The "Customization map" table in copilot-instructions.md lists exactly the
 *   prompt/instruction files that exist on disk (no drift in either direction).
 * - Each instruction file's `applyTo` globs point at directories that exist.
 *
 * Usage: npx tsx scripts/lint-instructions.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix, relative, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GH = join(ROOT, '.github')
const MAP_FILE = join(GH, 'copilot-instructions.md')
const PROMPTS_DIR = join(GH, 'prompts')
const INSTRUCTIONS_DIR = join(GH, 'instructions')

const errors: string[] = []
const err = (msg: string): void => void errors.push(msg)
const toPosix = (p: string): string => p.split(/[\\/]/).join(posix.sep)

// ─── Collect the customization files to scan ─────────────────────────────────

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f))
}

const scanned = [MAP_FILE, ...mdFiles(PROMPTS_DIR), ...mdFiles(INSTRUCTIONS_DIR)]

// ─── 1. Relative Markdown links resolve to real files ────────────────────────

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g

for (const file of scanned) {
  const text = readFileSync(file, 'utf8')
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(text)) !== null) {
    const target = match[1].trim()
    if (/^(https?:|mailto:|#)/.test(target)) continue // external / anchor-only
    const pathPart = target.split('#')[0]
    if (pathPart === '') continue
    const resolved = resolve(dirname(file), pathPart)
    if (!existsSync(resolved)) {
      err(`Broken link in ${relative(ROOT, file)}: ${target}`)
    }
  }
}

// ─── 2. Customization map matches the files on disk ──────────────────────────

const mapText = readFileSync(MAP_FILE, 'utf8')
const REFERENCED_RE = /\.github\/(?:prompts|instructions)\/[\w.-]+\.md/g
const referenced = new Set(mapText.match(REFERENCED_RE) ?? [])

const onDisk = new Set(
  [...mdFiles(PROMPTS_DIR), ...mdFiles(INSTRUCTIONS_DIR)].map((f) => toPosix(relative(ROOT, f))),
)

for (const f of onDisk) {
  if (!referenced.has(f)) err(`Customization map is missing an entry for ${f}`)
}
for (const f of referenced) {
  if (!onDisk.has(f)) err(`Customization map references a missing file: ${f}`)
}

// ─── 3. applyTo globs point at directories that exist ────────────────────────

for (const file of mdFiles(INSTRUCTIONS_DIR)) {
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('applyTo:'))
  if (!line) continue
  const globs = line
    .slice('applyTo:'.length)
    .replace(/[[\]'"]/g, '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  for (const glob of globs) {
    const base = glob.split('*')[0].replace(/\/+$/, '')
    if (base && !existsSync(resolve(ROOT, base))) {
      err(`applyTo in ${relative(ROOT, file)} points at a missing path: ${glob}`)
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`✗ Customization lint found ${errors.length} issue(s):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exitCode = 1
} else {
  console.log('✓ Customization files are consistent.')
}
