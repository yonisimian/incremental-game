import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildIdlerTreeFile, parseTree, serializeTree } from '@game/shared'

// The server serves the committed `trees/*.json` files verbatim and clients
// fetch them, so the on-disk bytes must stay in sync with the authoring source.
// Regenerate with `pnpm emit:trees` if this test fails after an intentional
// tree change.
describe('committed tree files', () => {
  it('idler.json is byte-identical to the emitted output', () => {
    const onDisk = readFileSync(new URL('../trees/idler.json', import.meta.url), 'utf8')
    expect(onDisk).toBe(`${serializeTree(buildIdlerTreeFile())}\n`)
  })

  it('idler.json parses into a valid runtime tree', () => {
    const onDisk = readFileSync(new URL('../trees/idler.json', import.meta.url), 'utf8')
    expect(() => parseTree(JSON.parse(onDisk) as unknown)).not.toThrow()
  })
})
