// @vitest-environment happy-dom

/**
 * Phase-1 spike (docs/plans/32) — pins down what the happy-dom environment gives
 * us for the toast/VFX code, so later phases build on solid ground.
 *
 * Finding: happy-dom does **not** implement `Element.animate`. The toast code
 * both calls it and wires slot removal to its `onfinish`, so the environment
 * alone can't run it. The harness installs a minimal `animate` shim that fires
 * `onfinish` via `setTimeout(duration)`; combined with Vitest fake timers, a
 * single clock advance completes both the dismiss timer and the exit animation,
 * making removal deterministic with no bespoke flush. These tests are that
 * proof; Phase 2 relies on the mechanism.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnToast } from '../src/ui/vfx/toast.js'
import { installAnimateShim, mountToastLayer, resetDom } from './dom-harness.js'

describe('happy-dom capability spike', () => {
  it('confirms happy-dom ships no native Element.animate', () => {
    // Documents *why* the shim exists — if a future happy-dom adds animate, this
    // flips and we can reconsider the shim.
    expect(typeof document.createElement('div').animate).toBe('undefined')
  })

  describe('with the harness animate shim', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      installAnimateShim()
    })

    afterEach(() => {
      resetDom()
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('drives a toast from spawn to removal by advancing fake timers', () => {
      const layer = mountToastLayer()

      spawnToast('hello', 'info')
      // Entrance is synchronous: the slot and tinted banner are present at once.
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(1)
      expect(layer.querySelector('.toast')?.classList.contains('toast--info')).toBe(true)

      // One clock advance fires the dismiss setTimeout and the exit animation's
      // shimmed onfinish, which removes the slot. Assert the observable end
      // state — the contract Phase 2 depends on.
      vi.advanceTimersByTime(10_000)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })
  })
})
