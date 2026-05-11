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

  btn.addEventListener('click', () => {
    // If ANY series is visible → hide all; if all hidden → show all
    const anyVisible = chart.series.slice(1).some((s) => s.show)
    for (let i = 1; i <= seriesCount; i++) {
      chart.setSeries(i, { show: !anyVisible })
    }
    btn.textContent = anyVisible ? 'Show All' : 'Hide All'
  })

  // Place the button inside the legend table's container
  const legend = wrapper.querySelector('.u-legend')
  if (legend) {
    legend.appendChild(btn)
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
    { label: 'Time (s)' },
    ...series.map((s, i) => ({
      label: s.label,
      stroke: PALETTE[i % PALETTE.length],
      width: 2,
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
          // Keep y-axis visible even when all series are hidden
          if (min === Infinity) return [0, 1]
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
      draw: [
        (u: uPlot) => {
          if (allMarkers.length === 0) return
          const ctx = u.ctx
          ctx.save()
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.font = '10px sans-serif'
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
          ctx.textAlign = 'center'

          // Deduplicate markers at same x position (multiple strategies may buy at same time)
          const seen = new Set<string>()
          for (const m of allMarkers) {
            const px = u.valToPos(m.x, 'x', true)
            const key = `${m.x}:${m.label}`
            if (seen.has(key)) continue
            seen.add(key)

            // Only draw if within the visible plot area
            if (px >= u.bbox.left && px <= u.bbox.left + u.bbox.width) {
              ctx.beginPath()
              ctx.moveTo(px, u.bbox.top)
              ctx.lineTo(px, u.bbox.top + u.bbox.height)
              ctx.stroke()
              ctx.fillText(m.label, px, u.bbox.top - 4)
            }
          }

          ctx.restore()
        },
      ],
    },
    cursor: { drag: { x: true, y: true } },
    legend: { show: true },
  }

  const chart = new uPlot(opts, uData, container)
  instances.set(container, chart)

  if (series.length > 1) {
    attachToggleAllButton(container, chart, series.length)
  }
}
