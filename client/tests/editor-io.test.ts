import { describe, expect, it } from 'vitest'
import { parseTreeFile, serializeTree, type TreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { exportTree, importTreeFromFile, treeToJson } from '../src/dev/editor/io.js'
import { cloneTree, collectIds, findNode } from '../src/dev/editor/model.js'

function fileOf(contents: string, name = 'tree.json'): File {
  return new File([contents], name, { type: 'application/json' })
}

function idlerTree(): TreeFile {
  return cloneTree(parseTreeFile(idlerTreeFile))
}

/**
 * Clone the idler tree and plant a prerequisite whose `minLevel` exceeds the
 * referenced upgrade's `purchaseLimit` — a cross-node inconsistency the zod
 * schema can't catch, but `toModeDefinition` does.
 */
function treeWithOverLeveledPrereq(): TreeFile {
  const tree = idlerTree()
  const ids = collectIds(tree)
  const target = ids
    .map((id) => findNode(tree, id)!)
    .find((n) => typeof n.purchaseLimit === 'number')
  if (!target) throw new Error('fixture: idler has no finite-purchaseLimit node')
  const host = findNode(tree, ids.find((id) => id !== target.id)!)!
  host.prerequisites = {
    type: 'upgrade',
    id: target.id,
    minLevel: target.purchaseLimit! + 1,
  }
  return tree
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

  it('rejects a schema-valid tree that fails engine validation (minLevel over purchaseLimit)', async () => {
    const json = serializeTree(treeWithOverLeveledPrereq())
    await expect(importTreeFromFile(fileOf(json))).rejects.toThrow(/greater than max level/)
  })
})

describe('treeToJson / exportTree validation', () => {
  it('serializes a valid tree', () => {
    expect(treeToJson(idlerTree())).toBe(serializeTree(idlerTree()))
  })

  it('throws on a tree the engine would reject', () => {
    expect(() => treeToJson(treeWithOverLeveledPrereq())).toThrow(/greater than max level/)
  })

  it('exportTree also refuses an invalid tree before producing a download', () => {
    expect(() => {
      exportTree(treeWithOverLeveledPrereq())
    }).toThrow(/greater than max level/)
  })
})
