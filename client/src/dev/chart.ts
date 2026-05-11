/**
 * uPlot chart wrapper for the dev panel.
 *
 * Renders a time-series chart with optional vertical purchase markers.
 */

import uPlot from 'uplot'

// ─── Color palette for series ────────────────────────────────────────

const PALETTE = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
]

// ─── Types ───────────────────────────────────────────────────────────

export interface ChartMarker {
  /** x value (timeSec) where the marker should be drawn */
  x: number
  /** Short label drawn above the marker line */
  label: string
}

/** @public */
export interface ChartSeries {
  label: string
  data: number[]
  /** Optional markers for this series (purchase events) */
  markers?: ChartMarker[]
}

// ─── Render ──────────────────────────────────────────────────────────

/** Active uPlot instances — tracked for cleanup on re-render. */
const instances = new WeakMap<HTMLElement, uPlot>()

/**
 * Attach a "Hide all / Show all" button inside the chart's legend area.
 * Clicking it toggles every series off (so you can isolate one via the legend)
 * or back on if all are already hidden.
 */
function attachToggleAllButton(wrapper: HTMLElement, chart: uPlot, seriesCount: number): void {
  const btn = document.createElement('button')
  btn.className = 'chart-toggle-all'
  btn.textContent = 'Hide All'

  const syncLabel = () => {
    const anyVisible = chart.series.slice(1).some((s) => s.show)
    btn.textContent = anyVisible ? 'Hide All' : 'Show All'
  }

  btn.addEventListener('click', () => {
    const anyVisible = chart.series.slice(1).some((s) => s.show)
    for (let i = 1; i <= seriesCount; i++) {
      chart.setSeries(i, { show: !anyVisible })
    }
    syncLabel()
  })

  // Keep label in sync when individual series are toggled via legend
  chart.hooks.setSeries!.push(syncLabel)

  // Place the button after the legend table
  const legend = wrapper.querySelector('.u-legend')
  if (legend) {
    legend.insertAdjacentElement('afterend', btn)
  } else {
    wrapper.appendChild(btn)
  }
}

/**
 * Render a uPlot chart into `container`.
 * Destroys any previous chart in the same container.
 */
export function renderChart(
  container: HTMLElement,
  title: string,
  xData: number[],
  series: ChartSeries[],
): void {
  // Cleanup previous chart
  const prev = instances.get(container)
  if (prev) {
    prev.destroy()
    instances.delete(container)
  }
  container.innerHTML = ''

  if (series.length === 0 || xData.length === 0) return

  // Collect all markers from all series for the draw hook
  const allMarkers: ChartMarker[] = series.flatMap((s) => s.markers ?? [])

  // Build uPlot series config: first entry is x-axis descriptor
  const uSeries: uPlot.Series[] = [
    {
      label: 'Time (s)',
      // eslint-disable-next-line eqeqeq, @typescript-eslint/no-unnecessary-condition -- uPlot passes null/undefined at runtime
      value: (_u, v) => (v == null ? '—' : `${v.toFixed(1)}s`),
    },
    ...series.map((s, i) => ({
      label: s.label,
      stroke: PALETTE[i % PALETTE.length],
      width: 2,
      // eslint-disable-next-line eqeqeq, @typescript-eslint/no-unnecessary-condition -- uPlot passes null/undefined at runtime
      value: (_u: uPlot, v: number) => (v == null ? '—' : v.toFixed(2)),
    })),
  ]

  // Build uPlot data: [xData, ...yDatas]
  const uData: uPlot.AlignedData = [xData, ...series.map((s) => s.data)]

  // Subtract padding so the canvas fits inside the padded container
  const style = getComputedStyle(container)
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  const chartWidth = container.clientWidth - padX || 900

  const opts: uPlot.Options = {
    title,
    width: chartWidth,
    height: 300,
    series: uSeries,
    scales: {
      x: { time: false },
      y: {
        range: (_u, min, max) => {
          // Degenerate range: all hidden → Infinity, or all values equal (e.g. all 0)
          if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            return [min === Infinity ? 0 : min - 1, max === -Infinity ? 1 : max + 1]
          }
          return [min, max]
        },
      },
    },
    axes: [
      {
        label: 'Time (s)',
        stroke: '#fff',
        grid: { stroke: 'rgba(255,255,255,0.08)' },
        ticks: { stroke: 'rgba(255,255,255,0.2)' },
      },
      {
        label: title,
        stroke: '#fff',
        grid: { stroke: 'rgba(255,255,255,0.08)' },
        ticks: { stroke: 'rgba(255,255,255,0.2)' },
      },
    ],
    hooks: {
      setSeries: [],
      draw: [
        (u: uPlot) => {
          if (allMarkers.length === 0) return
          const ctx = u.ctx
          ctx.save()
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])

          // Deduplicate markers at same x position (multiple strategies may buy at same time)
          const seen = new Set<number>()
          for (const m of allMarkers) {
            const px = u.valToPos(m.x, 'x', true)
            if (seen.has(m.x)) continue
            seen.add(m.x)

            // Only draw if within the visible plot area
            if (px >= u.bbox.left && px <= u.bbox.left + u.bbox.width) {
              ctx.beginPath()
              ctx.moveTo(px, u.bbox.top)
              ctx.lineTo(px, u.bbox.top + u.bbox.height)
              ctx.stroke()
            }
          }

          ctx.restore()
        },
      ],
      setCursor: [
        (u: uPlot) => {
          let tip = u.over.querySelector<HTMLDivElement>('.chart-tooltip')
          if (!tip) {
            tip = document.createElement('div')
            tip.className = 'chart-tooltip'
            u.over.appendChild(tip)
          }
          const idx = u.cursor.idx
          const left = u.cursor.left ?? -1
          const top = u.cursor.top ?? -1
          // eslint-disable-next-line eqeqeq -- cursor values can be null/undefined at runtime
          if (idx == null || left < 0 || top < 0) {
            tip.style.display = 'none'
            return
          }

          // Find the nearest visible series to the cursor y position
          let bestDist = Infinity
          let bestLabel = ''
          let bestVal = 0
          for (let i = 1; i < u.series.length; i++) {
            const s = u.series[i]
            if (!s.show) continue
            const val = u.data[i][idx]
            // eslint-disable-next-line eqeqeq -- data can be null/undefined
            if (val == null) continue
            const py = u.valToPos(val, 'y', true) - u.bbox.top
            const dist = Math.abs(py - top)
            if (dist < bestDist) {
              bestDist = dist
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- label can be undefined
              bestLabel = (s.label as string) ?? ''
              bestVal = val
            }
          }

          if (bestDist === Infinity) {
            tip.style.display = 'none'
            return
          }
          tip.textContent = `${bestLabel}: ${bestVal.toFixed(1)}`
          tip.style.display = 'block'
          tip.style.left = `${left + 4}px`
          tip.style.top = `${top - 24}px`
        },
      ],
    },
    cursor: {
      drag: { x: true, y: true },
      y: true,
      focus: { prox: 20 },
    },
    legend: { show: true },
  }

  const chart = new uPlot(opts, uData, container)
  instances.set(container, chart)

  // Click on plot area to toggle the nearest series
  let downX = 0
  let downY = 0
  chart.over.addEventListener('mousedown', (e) => {
    downX = e.clientX
    downY = e.clientY
  })
  chart.over.addEventListener('click', (e) => {
    // Ignore drag-to-zoom (mouse moved more than 4px)
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return

    const idx = chart.cursor.idx
    // eslint-disable-next-line eqeqeq -- cursor idx can be null/undefined at runtime
    if (idx == null) return
    const rect = chart.over.getBoundingClientRect()
    const cursorY = e.clientY - rect.top

    let bestDist = Infinity
    let bestIdx = -1
    for (let i = 1; i < chart.series.length; i++) {
      const s = chart.series[i]
      if (!s.show) continue
      const val = chart.data[i][idx]
      // eslint-disable-next-line eqeqeq -- data can be null/undefined
      if (val == null) continue
      const py = chart.valToPos(val, 'y', true) - chart.bbox.top
      const dist = Math.abs(py - cursorY)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    if (bestIdx > 0 && bestDist < 30) {
      chart.setSeries(bestIdx, { show: false })
    }
  })

  if (series.length > 1) {
    attachToggleAllButton(container, chart, series.length)
  }
}

/**
 * Update an existing chart's data in-place via `setData()`.
 * Falls back to a full `renderChart()` if the chart doesn't exist yet
 * or if the series count changed.
 */
export function updateChart(
  container: HTMLElement,
  title: string,
  xData: number[],
  series: ChartSeries[],
): void {
  const existing = instances.get(container)
  // series count + 1 for x-axis
  if (existing?.series.length === series.length + 1) {
    const uData: uPlot.AlignedData = [xData, ...series.map((s) => s.data)]
    existing.setData(uData)
    return
  }
  renderChart(container, title, xData, series)
}
