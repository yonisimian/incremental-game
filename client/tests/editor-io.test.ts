import { describe, expect, it } from 'vitest'
import { parseTreeFile, serializeTree } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { importTreeFromFile } from '../src/dev/editor/io.js'

function fileOf(contents: string, name = 'tree.json'): File {
  return new File([contents], name, { type: 'application/json' })
}

describe('importTreeFromFile', () => {
  it('round-trips a serialized idler tree back to an equal TreeFile', async () => {
    const original = parseTreeFile(idlerTreeFile)
    const imported = await importTreeFromFile(fileOf(serializeTree(original)))
    expect(imported).toEqual(original)
  })

  it('rejects non-JSON content with a friendly message', async () => {
    await expect(importTreeFromFile(fileOf('not json'))).rejects.toThrow(/not valid JSON/)
  })

  it('rejects JSON that violates the tree schema', async () => {
    await expect(importTreeFromFile(fileOf('{"version":1}'))).rejects.toThrow()
  })
})
