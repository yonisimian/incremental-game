import { beforeAll, describe, expect, it } from 'vitest'

// This suite runs in the node environment (no DOM). The panel reads its
// persisted collapsed-section set from `localStorage` at module load, so the
// stub must be installed *before* the dynamic import below.
const stored = JSON.stringify(['inventory'])
let renderSection: typeof import('../src/ui/panels/data-panel.js').renderSection

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => stored, setItem: () => {} },
  })
  ;({ renderSection } = await import('../src/ui/panels/data-panel.js'))
})

describe('data panel — collapsible sections', () => {
  it('renders an expanded section with a toggle header keyed for persistence', () => {
    const html = renderSection('clicking', '🖱️ Clicking', '<p>body</p>')
    expect(html).toContain('data-collapse="clicking"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain('data-section collapsed')
    expect(html).toContain('<p>body</p>')
  })

  it('renders a persisted-collapsed section folded', () => {
    const html = renderSection('inventory', '📦 Inventory', '<p>body</p>')
    expect(html).toContain('data-section collapsed')
    expect(html).toContain('aria-expanded="false"')
    // The body stays in the DOM (hidden via CSS) so live updates keep landing.
    expect(html).toContain('<p>body</p>')
  })

  it('keeps the summary in the header, outside the collapsible body', () => {
    const html = renderSection('prod:r0', '🪵 Wood production', '<p>body</p>', '<b>+12/s</b>')
    expect(html.indexOf('<b>+12/s</b>')).toBeLessThan(html.indexOf('data-section-body'))
  })
})
