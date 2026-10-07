// @vitest-environment happy-dom

/**
 * Pins down what the happy-dom environment gives us for the toast/VFX code.
 *
 * The toast code wires slot removal to `animate`'s `onfinish`. The harness
 * replaces `Element.animate` with a minimal shim that fires `onfinish` via
 * `setTimeout(duration)`; combined with Vitest fake timers, a
 * single clock advance completes both the dismiss timer and the exit animation,
 * making removal deterministic with no bespoke flush. These tests are that
 * proof; the other DOM tests rely on the mechanism.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnToast } from '../src/ui/vfx/toast.js'
import { installAnimateShim, mountToastLayer, resetDom } from './dom-harness.js'

describe('happy-dom capability spike', () => {
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
      // state — the contract the toast tests depend on.
      vi.advanceTimersByTime(10_000)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })
  })
})
