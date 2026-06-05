/**
 * CSS class lint script.
 *
 * Detects:
 * - Unused classes: defined in style.css but never referenced in source code.
 * - Phantom classes: referenced in source code but never defined in style.css.
 *
 * Usage: npx tsx scripts/lint-css.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const STYLE_PATH = join(ROOT, '..', 'client', 'src', 'style.css')
const SOURCE_DIRS = [join(ROOT, '..', 'client', 'src')]
const DEV_DIR = join(ROOT, '..', 'client', 'src', 'dev')

// Classes that are expected to exist only in CSS (e.g. dynamic from shared data)
// or only in source code (dev UI styled inline).
const IGNORED_UNUSED = new Set([
  // CSS timing-related selectors (not valid JS identifiers)
  '2s',
  '15s',
  // Theme classes injected dynamically from shared mode flavor data
  'theme-clicker',
  'theme-medieval',
  // Classes injected from dynamic server/shared state values
  'draw', // end.winner value
  'gold', // resource className from shared data
])

const IGNORED_PHANTOM = new Set([
  // Dev-only classes used via classList/className (not caught by isDev skip on Pattern 1)
  'hidden',
  // State/reason values caught by heuristic extraction (not CSS classes)
  'waiting',
  'forfeit',
  'quit',
  'standard', // notation mode value used in conditional logic, not a CSS class
  // Known unstyled classes (structural wrappers or state handled by :disabled)
  // TODO: add CSS definitions or remove from source
  'progress-row',
  'too-expensive',
  'upgrade-level',
])

// ─── Extract defined classes from style.css ──────────────────────────────────

function getDefinedClasses(css: string): Set<string> {
  const classes = new Set<string>()
  // Strip comments to avoid matching class-like patterns inside /* ... */
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Match .class-name in selectors
  // Handles: .foo, .foo.bar, .foo:hover, .foo::after, .foo > .bar, etc.
  const selectorRegex = /\.([a-zA-Z][\w-]*)/g
  let match: RegExpExecArray | null
  while ((match = selectorRegex.exec(stripped)) !== null) {
    classes.add(match[1])
  }
  return classes
}

// ─── Extract referenced classes from TypeScript source files ─────────────────

function collectFiles(dir: string, ext: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...collectFiles(full, ext))
    } else if (full.endsWith(ext)) {
      files.push(full)
    }
  }
  return files
}

function getReferencedClasses(sourceFiles: string[]): Set<string> {
  const classes = new Set<string>()
  const CLASS_NAME_RE = /^[a-zA-Z][\w-]*$/

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf-8')
    const isDev = file.startsWith(DEV_DIR)
    let match: RegExpExecArray | null

    // Pattern 1: class="..." in template literals — parse the FULL value
    // including content inside ${...} expressions
    const classAttrRegex = /class="([^"]+)"/g
    while ((match = classAttrRegex.exec(content)) !== null) {
      if (!isDev) extractClassNamesFromTemplateValue(match[1], classes)
    }

    // Pattern 2: classList.add/remove/toggle('...')
    const classListRegex = /classList\.(add|remove|toggle)\(\s*['"]([a-zA-Z][\w-]*)['"]/g
    while ((match = classListRegex.exec(content)) !== null) {
      if (!isDev) classes.add(match[2])
    }

    // Pattern 3: el.className = '...' or `...`
    const classNameAssignRegex = /\.className\s*=\s*['"`]([^'"`]+)['"`]/g
    while ((match = classNameAssignRegex.exec(content)) !== null) {
      for (const cls of match[1].split(/\s+/)) {
        if (cls && CLASS_NAME_RE.test(cls)) {
          if (!isDev) classes.add(cls)
        }
      }
    }

    // Pattern 4: querySelector/querySelectorAll selectors
    const querySelectorRegex = /querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    while ((match = querySelectorRegex.exec(content)) !== null) {
      extractClassesFromSelector(match[1], classes, isDev)
    }

    // Pattern 5: .closest('selector')
    const closestRegex = /\.closest\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    while ((match = closestRegex.exec(content)) !== null) {
      extractClassesFromSelector(match[1], classes, isDev)
    }

    // Pattern 6: Variables that build class strings
    // e.g. const cls = `resource-item${...}`, const classes = `tab-btn${...}`
    // Handle nested backtick templates by just grabbing the first word
    const classVarTemplateRegex =
      /(?:const|let)\s+(?:cls|classes|className)\s*=\s*`([a-zA-Z][\w-]*)/g
    while ((match = classVarTemplateRegex.exec(content)) !== null) {
      classes.add(match[1])
    }

    // Pattern 7: Ternary/conditional assignments to class-like variables
    // e.g. const cls = isSafetyCap ? 'timer safety-timer' : 'timer'
    //      const stateClass = affordable ? '' : 'too-expensive'
    const classVarNames =
      /(?:const|let)\s+(?:cls|classes|className|stateClass|resultClass|selected)\s*=\s*[^;\n]+/g
    while ((match = classVarNames.exec(content)) !== null) {
      const line = match[0]
      const stringLits = /['"]([^'"]*)['"]/g
      let sMatch: RegExpExecArray | null
      while ((sMatch = stringLits.exec(line)) !== null) {
        for (const cls of sMatch[1].split(/\s+/)) {
          const trimmed = cls.trim()
          if (trimmed && /^[a-zA-Z][\w-]*$/.test(trimmed)) {
            classes.add(trimmed)
          }
        }
      }
    }
  }

  return classes
}

/** Extract class names from a template string value, including inside ${} */
function extractClassNamesFromTemplateValue(value: string, classes: Set<string>): void {
  const CLASS_NAME_RE = /^[a-zA-Z][\w-]*$/

  // First, get static parts (outside ${})
  const staticParts = value.replace(/\$\{[^}]*\}/g, ' ')
  for (const cls of staticParts.split(/\s+/)) {
    if (cls && CLASS_NAME_RE.test(cls)) {
      classes.add(cls)
    }
  }

  // Then parse inside ${} for string literals that look like class names
  const exprRegex = /\$\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = exprRegex.exec(value)) !== null) {
    const expr = match[1]
    // Extract all string literals from the expression
    const stringLitRegex = /['"]([^'"]*)['"]/g
    let sMatch: RegExpExecArray | null
    while ((sMatch = stringLitRegex.exec(expr)) !== null) {
      // The string might have a leading space (e.g. ' locked') — trim it
      for (const cls of sMatch[1].split(/\s+/)) {
        const trimmed = cls.trim()
        if (trimmed && CLASS_NAME_RE.test(trimmed)) {
          classes.add(trimmed)
        }
      }
    }
  }
}

/** Extract class names from a CSS selector string */
function extractClassesFromSelector(selector: string, classes: Set<string>, isDev: boolean): void {
  const re = /\.([a-zA-Z][\w-]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(selector)) !== null) {
    if (!isDev) classes.add(match[1])
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const css = readFileSync(STYLE_PATH, 'utf-8')
const defined = getDefinedClasses(css)

const sourceFiles: string[] = []
for (const dir of SOURCE_DIRS) {
  sourceFiles.push(...collectFiles(dir, '.ts'))
}
// Also scan HTML files
sourceFiles.push(join(ROOT, '..', 'client', 'index.html'))
sourceFiles.push(join(ROOT, '..', 'client', 'dev.html'))

const referenced = getReferencedClasses(sourceFiles)

// Compute differences
const unused = [...defined].filter((c) => !referenced.has(c) && !IGNORED_UNUSED.has(c)).sort()
const phantom = [...referenced].filter((c) => !defined.has(c) && !IGNORED_PHANTOM.has(c)).sort()

// Report
let exitCode = 0

if (unused.length > 0) {
  console.error(`\n❌ Unused CSS classes (defined but never referenced):`)
  for (const c of unused) {
    console.error(`   .${c}`)
  }
  exitCode = 1
}

if (phantom.length > 0) {
  console.error(`\n❌ Phantom CSS classes (referenced but never defined):`)
  for (const c of phantom) {
    console.error(`   .${c}`)
  }
  exitCode = 1
}

if (exitCode === 0) {
  console.log('✅ CSS classes are consistent.')
}

process.exit(exitCode)
