// @vitest-environment happy-dom

/**
 * Phase-3 (docs/plans/32) — unit coverage for the rest of the VFX module
 * ([../src/ui/vfx/index.ts](../src/ui/vfx/index.ts)): click popup/ripple, button
 * pulse, purchase flash, the combo counter, score bump, and screen shake.
 *
 * Two assertion shapes, both structural and deterministic under happy-dom + the
 * harness animate shim:
 *   - effects that CREATE a node (popup, ripple, combo) assert the node appears
 *     with the right class/text and is gone after the clock advances;
 *   - effects that only ANIMATE an existing element (pulse, flash, bump, shake)
 *     assert they invoke `animate` on the correct target and no-op when it's
 *     absent.
 * Pixel geometry and real motion stay in Playwright e2e; happy-dom's zeroed
 * layout is fine here because nothing asserts a coordinate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bumpScore,
  flashPurchase,
  pulseClickButton,
  resetCombo,
  shakeScreen,
  spawnClickPopup,
  spawnClickRipple,
  trackCombo,
} from '../src/ui/vfx/index.js'
import { getLayer } from '../src/ui/vfx/shared.js'
import { installAnimateShim, resetDom } from './dom-harness.js'

/** Attach a `.click-card` (the popup/ripple/combo anchor) to the body. */
function mountClickCard(): HTMLElement {
  const card = document.createElement('div')
  card.className = 'click-card'
  document.body.appendChild(card)
  return card
}

describe('vfx (DOM)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installAnimateShim()
    // The overlay is a module singleton; clear stale nodes and re-attach it so
    // each test starts with an empty, document-connected layer.
    const layer = getLayer()
    layer.replaceChildren()
    document.body.appendChild(layer)
  })

  afterEach(() => {
    resetCombo() // combo count is module state — reset before the next test
    resetDom()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('click popup', () => {
    it('floats a "+N" popup and removes it once the animation finishes', () => {
      mountClickCard()

      spawnClickPopup(5)
      expect(getLayer().querySelector('.vfx-popup')?.textContent).toBe('+5')

      vi.advanceTimersByTime(1000)
      expect(getLayer().querySelector('.vfx-popup')).toBeNull()
    })

    it('no-ops when there is no click button to anchor to', () => {
      spawnClickPopup(5)
      expect(getLayer().querySelector('.vfx-popup')).toBeNull()
    })
  })

  describe('click ripple', () => {
    it('adds a ripple and removes it once the animation finishes', () => {
      mountClickCard()

      spawnClickRipple()
      expect(getLayer().querySelector('.vfx-ripple')).not.toBeNull()

      vi.advanceTimersByTime(600)
      expect(getLayer().querySelector('.vfx-ripple')).toBeNull()
    })
  })

  describe('button pulse', () => {
    it('animates the click button', () => {
      const card = mountClickCard()
      const spy = vi.spyOn(card, 'animate')

      pulseClickButton()

      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('no-ops when no button is present', () => {
      expect(() => {
        pulseClickButton()
      }).not.toThrow()
    })
  })

  describe('purchase flash', () => {
    it('flashes the purchased upgrade button and the resource bar', () => {
      const btn = document.createElement('button')
      btn.className = 'upgrade-btn'
      btn.dataset.upgrade = 'u1'
      document.body.appendChild(btn)
      const bar = document.createElement('div')
      bar.id = 'resource-bar'
      document.body.appendChild(bar)
      const btnSpy = vi.spyOn(btn, 'animate')
      const barSpy = vi.spyOn(bar, 'animate')

      flashPurchase('u1')

      expect(btnSpy).toHaveBeenCalledTimes(1)
      expect(barSpy).toHaveBeenCalledTimes(1)
    })

    it('no-ops when the upgrade button is absent', () => {
      expect(() => {
        flashPurchase('missing')
      }).not.toThrow()
    })
  })

  describe('combo counter', () => {
    it('returns the running count and shows the indicator from the third click', () => {
      mountClickCard()

      expect(trackCombo()).toBe(1)
      expect(trackCombo()).toBe(2)
      // Below three the indicator stays absent.
      expect(document.getElementById('vfx-combo')).toBeNull()

      expect(trackCombo()).toBe(3)
      const combo = document.getElementById('vfx-combo')
      expect(combo?.textContent).toBe('3× combo!')
      expect(combo?.style.display).toBe('block')
    })

    it('resets the count and hides the indicator after the combo window lapses', () => {
      mountClickCard()
      trackCombo()
      trackCombo()
      trackCombo()
      expect(document.getElementById('vfx-combo')?.style.display).toBe('block')

      // Past the 500ms window: hideCombo runs, then its 200ms fade finishes.
      vi.advanceTimersByTime(800)
      expect(document.getElementById('vfx-combo')?.style.display).toBe('none')
      expect(trackCombo()).toBe(1) // the count was reset
    })

    it('resetCombo clears the count and hides the indicator immediately', () => {
      mountClickCard()
      trackCombo()
      trackCombo()
      trackCombo()

      resetCombo()
      vi.advanceTimersByTime(300) // let the fade finish
      expect(document.getElementById('vfx-combo')?.style.display).toBe('none')
      expect(trackCombo()).toBe(1)
    })
  })

  describe('score bump', () => {
    it('animates the target element', () => {
      const el = document.createElement('div')
      el.id = 'score'
      document.body.appendChild(el)
      const spy = vi.spyOn(el, 'animate')

      bumpScore('score')

      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('no-ops when the element is missing', () => {
      expect(() => {
        bumpScore('missing')
      }).not.toThrow()
    })
  })

  describe('screen shake', () => {
    it('animates the playing screen', () => {
      const screen = document.createElement('div')
      screen.className = 'playing-screen'
      document.body.appendChild(screen)
      const spy = vi.spyOn(screen, 'animate')

      shakeScreen('heavy')

      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('no-ops without a playing screen', () => {
      expect(() => {
        shakeScreen()
      }).not.toThrow()
    })
  })
})
