// @vitest-environment happy-dom

/**
 * Phase-2 (docs/plans/32) — unit coverage for the toast primitive
 * ([../src/ui/vfx/toast.ts](../src/ui/vfx/toast.ts)), the DOM feature we shipped
 * with zero automated tests. All assertions are structural (nodes, classes,
 * text, eviction/idempotency) so they run truthfully under happy-dom + the
 * harness animate shim; visual timing/layout stays in Playwright e2e.
 *
 * The shim fires each animation's `onfinish` via `setTimeout(duration)`, so a
 * single `vi.advanceTimersByTime` completes both the dismiss timer and the exit
 * collapse — every removal is deterministic without a bespoke flush.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnToast } from '../src/ui/vfx/toast.js'
import { getLayer } from '../src/ui/vfx/shared.js'
import { installAnimateShim, mountToastLayer, resetDom } from './dom-harness.js'

describe('spawnToast (DOM)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installAnimateShim()
  })

  afterEach(() => {
    resetDom()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('appends one tinted slot with the given text', () => {
    const layer = mountToastLayer()

    spawnToast('hi', 'info')

    const slots = layer.querySelectorAll('.toast-slot')
    expect(slots).toHaveLength(1)
    const banner = layer.querySelector('.toast')
    expect(banner?.classList.contains('toast--info')).toBe(true)
    expect(banner?.textContent).toBe('hi')
  })

  it('prefixes the icon when one is supplied', () => {
    const layer = mountToastLayer()

    spawnToast('hi', 'success', { icon: '🏗️' })

    const banner = layer.querySelector('.toast')
    expect(banner?.classList.contains('toast--success')).toBe(true)
    expect(banner?.textContent).toBe('🏗️ hi')
  })

  it('caps the visible stack: a spawn past the cap terminates and evicts the oldest', () => {
    const layer = mountToastLayer()

    // Five spawns against a cap of four. Before the da97644 fix the eviction
    // loop re-selected the already-removing slot forever, so this call would
    // hang the test — reaching the assertions at all is the regression guard.
    for (const label of ['1', '2', '3', '4', '5']) spawnToast(label, 'info')

    // The oldest is collapsing (data-removing) but still in the DOM; the four
    // live banners are the newest four.
    expect(layer.querySelectorAll('.toast-slot:not([data-removing])')).toHaveLength(4)

    // Once the evicted slot's collapse finishes it leaves the DOM entirely.
    vi.advanceTimersByTime(300)
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(4)
    const texts = [...layer.querySelectorAll('.toast')].map((t) => t.textContent)
    expect(texts).toEqual(['2', '3', '4', '5'])
  })

  it('removes a slot exactly once when eviction and the auto-dismiss both target it', () => {
    const layer = mountToastLayer()

    spawnToast('first', 'info')
    const oldest = layer.querySelector<HTMLElement>('.toast-slot')
    expect(oldest).not.toBeNull()
    const removeSpy = vi.spyOn(oldest!, 'remove')

    // Fill to the cap and force one more spawn → evicts the oldest (first
    // removeToast). Its collapse then finishes and detaches it.
    for (const label of ['b', 'c', 'd', 'e']) spawnToast(label, 'info')
    vi.advanceTimersByTime(300)
    expect(removeSpy).toHaveBeenCalledTimes(1)

    // The oldest's own auto-dismiss timer fires later and re-enters removeToast,
    // but the data-removing guard makes it a no-op — no second detach.
    vi.advanceTimersByTime(5_000)
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses: the slot is gone after the dismiss timer and exit collapse', () => {
    const layer = mountToastLayer()

    spawnToast('bye', 'warning')
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(1)

    vi.advanceTimersByTime(10_000)
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
  })

  it('falls back to the global vfx layer when no #toast-layer exists', () => {
    // Deliberately do not mountToastLayer(): the play screen is absent, so the
    // toast targets getLayer() — the test/non-play-screen path.
    spawnToast('orphan', 'info')

    const fallback = getLayer()
    expect(fallback.classList.contains('vfx-layer')).toBe(true)
    expect(fallback.querySelectorAll('.toast-slot')).toHaveLength(1)
    expect(fallback.querySelector('.toast')?.textContent).toBe('orphan')
  })
})
