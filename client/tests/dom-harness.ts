/**
 * Shared helpers for the client's happy-dom test tier — the unit-level suite for
 * DOM code that no-ops in the plain node environment (VFX, toasts). Opt a file
 * into the DOM environment with `// @vitest-environment happy-dom` at its top.
 *
 * happy-dom does not implement `Element.animate` (proven by the Phase-1 spike),
 * and the toast/VFX code both calls it and wires cleanup to its `onfinish`. So
 * the harness installs a minimal fake: it schedules `onfinish` on a real-shaped
 * `setTimeout(duration)`, which means Vitest fake timers drive the animation to
 * completion in lockstep with the code's own dismiss timer — one
 * `advanceTimersByTime` finishes both, no separate flush needed.
 */

interface FakeAnimation {
  onfinish: (() => void) | null
  oncancel: (() => void) | null
  cancel(): void
  finish(): void
}

/**
 * Install a stand-in for `Element.prototype.animate`. The returned handle fires
 * `onfinish` after `duration` ms via `setTimeout`, so a test using fake timers
 * deterministically completes every animation by advancing the clock.
 * `finish()` / `cancel()` run the respective callback synchronously for tests
 * that prefer to drive an animation directly.
 */
export function installAnimateShim(): void {
  Element.prototype.animate = function animate(
    _keyframes: unknown,
    options?: number | { duration?: number },
  ): Animation {
    const duration = typeof options === 'number' ? options : (options?.duration ?? 0)
    const anim: FakeAnimation = {
      onfinish: null,
      oncancel: null,
      cancel() {
        this.oncancel?.()
      },
      finish() {
        this.onfinish?.()
      },
    }
    setTimeout(() => anim.onfinish?.(), duration)
    return anim as unknown as Animation
  }
}

/**
 * Attach a fresh `#toast-layer` to `document.body` — the overlay `spawnToast`
 * targets. Returns it so a test can assert against its children. Paired with
 * {@link resetDom} in `afterEach`.
 */
export function mountToastLayer(): HTMLElement {
  const layer = document.createElement('div')
  layer.id = 'toast-layer'
  document.body.appendChild(layer)
  return layer
}

/** Clear everything mounted to `document.body` between tests. */
export function resetDom(): void {
  document.body.replaceChildren()
}
