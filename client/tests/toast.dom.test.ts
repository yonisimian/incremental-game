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

  it('sets the icon in its own column before the text', () => {
    const layer = mountToastLayer()

    spawnToast('hi', 'success', { icon: '🏗️' })

    const banner = layer.querySelector('.toast')
    expect(banner?.classList.contains('toast--success')).toBe(true)
    expect(banner?.querySelector('.toast-icon')?.textContent).toBe('🏗️')
    expect(banner?.querySelector('.toast-text')?.textContent).toBe('hi')
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

  it('keeps a sticky toast until it is dismissed, and rewrites its text in place', () => {
    const layer = mountToastLayer()

    const toast = spawnToast('in 4.0s', 'warning', { sticky: true, icon: '⚠️' })
    vi.advanceTimersByTime(60_000)
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(1)

    toast.update('in 1.0s')
    expect(layer.querySelector('.toast-text')?.textContent).toBe('in 1.0s')
    expect(layer.querySelector('.toast-icon')?.textContent).toBe('⚠️')

    toast.dismiss()
    vi.advanceTimersByTime(300)
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    // Idempotent, like the eviction/auto-dismiss race.
    expect(() => {
      toast.dismiss()
    }).not.toThrow()
  })

  it('never evicts a sticky toast to make room — the stack grows past the cap instead', () => {
    const layer = mountToastLayer()

    spawnToast('alert', 'warning', { sticky: true })
    for (const label of ['1', '2', '3', '4', '5']) spawnToast(label, 'info')
    vi.advanceTimersByTime(300)

    const texts = [...layer.querySelectorAll('.toast')].map((t) => t.textContent)
    expect(texts[0]).toBe('alert')
    // The cap still holds for ordinary toasts: the oldest of those went instead.
    expect(texts).toEqual(['alert', '3', '4', '5'])

    // With every visible slot sticky, a new spawn exceeds the cap rather than
    // evicting one of them.
    const stickies = ['s1', 's2', 's3', 's4'].map((t) => spawnToast(t, 'warning', { sticky: true }))
    vi.advanceTimersByTime(3_000)
    const left = [...layer.querySelectorAll('.toast-slot:not([data-removing])')].map(
      (s) => s.textContent,
    )
    expect(left).toEqual(['alert', 's1', 's2', 's3', 's4'])
    for (const s of stickies) s.dismiss()
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

  it('keeps bad news up longer than neutral news', () => {
    const layer = mountToastLayer()

    spawnToast('lost', 'danger')
    spawnToast('fyi', 'info')
    vi.advanceTimersByTime(2_900)
    expect(liveTexts(layer)).toEqual(['lost', 'fyi'])

    vi.advanceTimersByTime(100)
    expect(liveTexts(layer)).toEqual(['lost'])
    vi.advanceTimersByTime(1_900)
    expect(liveTexts(layer)).toEqual(['lost'])
    vi.advanceTimersByTime(100 + EXIT_MS)
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
  })

  it('pins sticky toasts at the head of the stack, in arrival order', () => {
    const layer = mountToastLayer()

    spawnToast('t1', 'info')
    spawnToast('s1', 'warning', { sticky: true })
    spawnToast('t2', 'info')
    spawnToast('s2', 'warning', { sticky: true })

    expect(liveTexts(layer)).toEqual(['s1', 's2', 't1', 't2'])
  })

  describe('hover and click', () => {
    it('pauses every timer while hovered and resumes with at least a second left', () => {
      const layer = mountToastLayer()
      spawnToast('read me', 'info')

      vi.advanceTimersByTime(2_900)
      hover(layer)
      vi.advanceTimersByTime(60_000)
      expect(liveTexts(layer)).toEqual(['read me'])

      unhover(layer)
      // 100 ms were left; the resume floor grants a full second instead.
      vi.advanceTimersByTime(900)
      expect(liveTexts(layer)).toEqual(['read me'])
      vi.advanceTimersByTime(100 + EXIT_MS)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })

    it('holds a toast spawned during a hover until the pointer leaves', () => {
      const layer = mountToastLayer()
      spawnToast('first', 'info')
      hover(layer)

      spawnToast('late', 'info')
      vi.advanceTimersByTime(60_000)
      expect(liveTexts(layer)).toEqual(['first', 'late'])

      unhover(layer)
      vi.advanceTimersByTime(3_000 + EXIT_MS)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })

    it('dismisses a clicked toast, sticky or not', () => {
      const layer = mountToastLayer()
      spawnToast('transient', 'info')
      const sticky = spawnToast('in 4.0s', 'warning', { sticky: true, icon: '⚠️' })

      for (const text of layer.querySelectorAll<HTMLElement>('.toast-text')) text.click()
      vi.advanceTimersByTime(EXIT_MS)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)

      // The caller keeps using its handle; neither call resurrects the toast.
      expect(() => {
        sticky.update('in 3.0s')
        sticky.dismiss()
      }).not.toThrow()
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })

    it('un-pauses once the stack empties, even without a pointerleave', () => {
      const layer = mountToastLayer()
      spawnToast('only', 'info')
      hover(layer)
      layer.querySelector<HTMLElement>('.toast')?.click()
      vi.advanceTimersByTime(EXIT_MS)

      spawnToast('next', 'info')
      vi.advanceTimersByTime(3_000 + EXIT_MS)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })

    it('starts a new layer unpaused when the old one was torn down mid-hover', () => {
      hover(mountToastLayer())
      resetDom()

      const layer = mountToastLayer()
      spawnToast('new match', 'info')
      vi.advanceTimersByTime(3_000 + EXIT_MS)
      expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
    })
  })

  describe('screen-reader announcer', () => {
    it('announces a toast once on arrival, ignores updates, and drops it on exit', () => {
      mountToastLayer()
      const announcer = document.createElement('div')
      announcer.id = 'toast-announcer'
      document.body.appendChild(announcer)

      const toast = spawnToast('Raid lands in 4.0s', 'warning', { sticky: true, icon: '🗡️' })
      expect([...announcer.children].map((n) => n.textContent)).toEqual(['🗡️ Raid lands in 4.0s'])

      toast.update('Raid lands in 3.0s')
      expect([...announcer.children].map((n) => n.textContent)).toEqual(['🗡️ Raid lands in 4.0s'])

      toast.dismiss()
      expect(announcer.children).toHaveLength(0)
    })
  })

  it('under reduced motion, still removes the toast after its fade', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const layer = mountToastLayer()

    spawnToast('calm', 'info')
    vi.advanceTimersByTime(3_000 + EXIT_MS)

    vi.unstubAllGlobals()
    expect(layer.querySelectorAll('.toast-slot')).toHaveLength(0)
  })
})

/** Exit animation length in `toast.ts` — the collapse that follows a dismissal. */
const EXIT_MS = 260

/** Text of each toast still on screen (not already leaving), top to bottom. */
function liveTexts(layer: HTMLElement): (string | null)[] {
  return [...layer.querySelectorAll('.toast-slot:not([data-removing]) .toast-text')].map(
    (t) => t.textContent,
  )
}

function hover(layer: HTMLElement): void {
  layer.dispatchEvent(new Event('pointerenter'))
}

function unhover(layer: HTMLElement): void {
  layer.dispatchEvent(new Event('pointerleave'))
}
