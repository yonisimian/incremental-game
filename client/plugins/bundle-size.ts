/**
 * Vite plugin — Bundle size reporter & budget guard.
 *
 * After every build:
 *  1. Prints a size table (raw + gzip) for each entry's JS + CSS.
 *  2. Writes `dist/bundle-badge.json` (shields.io endpoint format) for the
 *     game bundle so a README badge can display it.
 *  3. Warns if the game bundle exceeds a soft limit.
 *  4. Fails the build if it exceeds a hard limit.
 *
 * Usage in vite.config.ts:
 *   import { bundleSize } from './plugins/bundle-size.js'
 *   plugins: [bundleSize({ warnBytes: 60_000, failBytes: 80_000 })]
 */

/* eslint-disable no-console -- this plugin's whole purpose is to print a report */

import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/** @public */
export interface BundleSizeOptions {
  /** Warn (yellow) if the game JS bundle exceeds this many bytes (raw). */
  warnBytes: number
  /** Fail the build if the game JS bundle exceeds this many bytes (raw). */
  failBytes: number
  /** Path to write the shields.io badge JSON. Relative to outDir. Default: 'bundle-badge.json'. */
  badgePath?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`
}

function gzipSize(buf: Buffer): number {
  return gzipSync(buf, { level: 9 }).length
}

function badgeColor(raw: number, warn: number, fail: number): string {
  if (raw >= fail) return 'red'
  if (raw >= warn) return 'orange'
  return 'brightgreen'
}

// ─── Plugin ──────────────────────────────────────────────────────────

export function bundleSize(opts: BundleSizeOptions): Plugin {
  const { warnBytes, failBytes, badgePath = 'bundle-badge.json' } = opts
  let resolvedOutDir = 'dist'

  return {
    name: 'bundle-size',
    apply: 'build',

    configResolved(config: ResolvedConfig) {
      resolvedOutDir = config.build.outDir
    },

    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const assetsDir = join(resolvedOutDir, 'assets')

        // Group files by entry name (main-*, dev-*, dev-recorder-*)
        const entries = new Map<string, { js: string[]; css: string[] }>()
        let files: string[]
        try {
          files = readdirSync(assetsDir)
        } catch {
          return // no assets dir yet (e.g. during dev)
        }

        // Vite emits `<entry>-<hash>.<ext>`. The hash is base64url, so it can
        // contain `-`/`_` (and may even end with one, e.g. `main-DvhSvxG-.js`).
        // Match a greedy entry name + a trailing fixed-length hash so multi-word
        // entries (`pan-zoom`, `dev-recorder`) and hyphen-ending hashes both work.
        const entryPattern = /^(.+)-[A-Za-z0-9_-]{8,}\.(js|css)$/
        for (const file of files) {
          const match = entryPattern.exec(file)
          if (!match) continue
          const [, entry, ext] = match
          if (!entries.has(entry)) entries.set(entry, { js: [], css: [] })
          entries.get(entry)![ext as 'js' | 'css'].push(join(assetsDir, file))
        }

        // ── Print table ──
        console.log('\n📦 Bundle sizes:')
        console.log('─'.repeat(62))
        console.log(`  ${'Entry'.padEnd(20)} ${'Raw'.padStart(10)} ${'Gzip'.padStart(10)}  Type`)
        console.log('─'.repeat(62))

        let mainJsRaw = 0
        let mainJsGz = 0

        for (const [entry, group] of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
          for (const file of [...group.js, ...group.css]) {
            const buf = readFileSync(file)
            const raw = buf.length
            const gz = gzipSize(buf)
            const ext = file.endsWith('.css') ? 'CSS' : 'JS'
            // Display the entry name without the build hash (which can contain
            // `-`/`_`); we already parsed it out into `entry`.
            const shortName = `${entry}.${ext.toLowerCase()}`

            if (entry === 'main' && ext === 'JS') {
              mainJsRaw = raw
              mainJsGz = gz
            }

            console.log(
              `  ${shortName.padEnd(20)} ${formatKB(raw).padStart(10)} ${formatKB(gz).padStart(10)}  ${ext}`,
            )
          }
        }

        console.log('─'.repeat(62))

        // ── Budget check (game bundle = "main" JS) ──
        if (mainJsRaw > 0) {
          console.log(`  Game bundle: ${formatKB(mainJsRaw)} raw, ${formatKB(mainJsGz)} gzip`)

          if (mainJsRaw >= failBytes) {
            // Write badge before failing so CI can still upload it
            writeBadge(resolvedOutDir, badgePath, mainJsRaw, mainJsGz, warnBytes, failBytes)
            throw new Error(
              `Bundle budget exceeded: game bundle (${formatKB(mainJsRaw)}) exceeds hard limit (${formatKB(failBytes)})`,
            )
          } else if (mainJsRaw >= warnBytes) {
            console.warn(
              `\n⚠️  BUDGET WARNING: game bundle (${formatKB(mainJsRaw)}) exceeds soft limit (${formatKB(warnBytes)})`,
            )
          } else {
            console.log(
              `  ✅ Within budget (limit: ${formatKB(warnBytes)} warn / ${formatKB(failBytes)} fail)`,
            )
          }

          writeBadge(resolvedOutDir, badgePath, mainJsRaw, mainJsGz, warnBytes, failBytes)
        }

        console.log()
      },
    },
  }
}

function writeBadge(
  outDir: string,
  badgePath: string,
  raw: number,
  gz: number,
  warn: number,
  fail: number,
): void {
  const badge = {
    schemaVersion: 1,
    label: 'bundle size',
    message: `${formatKB(gz)} gzip`,
    color: badgeColor(raw, warn, fail),
  }

  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, badgePath), `${JSON.stringify(badge, null, 2)}\n`)
    console.log(`  📛 Badge JSON written to ${badgePath}`)
  } catch {
    console.warn('  ⚠️  Could not write badge JSON')
  }
}
