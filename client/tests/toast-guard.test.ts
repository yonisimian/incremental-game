/**
 * Phase-2 (docs/plans/32) — the guard case that must run in the DOM-free node
 * environment (no `// @vitest-environment` docblock). Every DOM VFX opens with
 * `if (!hasDom()) return`; here `document` is undefined, so `spawnToast` must be
 * a silent no-op and never touch a missing DOM. This locks that guarantee.
 */

import { describe, expect, it } from 'vitest'
import { spawnToast } from '../src/ui/vfx/toast.js'

describe('spawnToast without a DOM', () => {
  it('no-ops instead of throwing when document is undefined', () => {
    expect(typeof document).toBe('undefined')
    expect(() => {
      spawnToast('x', 'info')
    }).not.toThrow()
  })
})
