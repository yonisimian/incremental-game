/**
 * Envelopes section — the mode's balance-pacing envelopes, one card per goal
 * type. An envelope declares the score-over-time (or time-to-milestone) corridor
 * the balance checker holds strategies to, so authoring it here (rather than in
 * hardcoded TypeScript) lets a mode ship its own targets.
 *
 * Envelopes live in the balance sidecar (`shared/balance/<mode>.json`), a
 * separate document from the tree — they are dev/CI metadata, not gameplay data.
 * So this section reads/writes the shell's `balance` working copy (not `tree`)
 * and carries its own export/copy toolbar; the file-level toolbar handles the
 * tree.
 *
 * The two kinds carry different checkpoints: the score-paced `timed` kind bands
 * a **score** at each `timeSec`; the time-paced `target-score` / `buy-upgrade`
 * kinds band a **time** at each milestone (`atScore` for target-score, the single
 * final buy for buy-upgrade). Add is gated to goal types the mode presents and
 * lacks an envelope for — the same constraints the runtime validates on load.
 */

import {
  addCheckpoint,
  addEnvelope,
  addableEnvelopeGoalTypes,
  listEnvelopes,
  removeCheckpoint,
  removeEnvelope,
  setCheckpointField,
  setEnvelopeMinViable,
  setEnvelopeSpread,
  type EnvelopeGoalType,
} from '../model.js'
import { balanceToJson, exportBalance } from '../io.js'
import { addButton, numberInput } from './controls.js'
import { el } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

/** Human labels for each goal type (matches the in-game goal wording). */
const GOAL_LABELS: Record<EnvelopeGoalType, string> = {
  timed: '⏱ Timed (score over time)',
  'target-score': '🎯 Target score (time to milestones)',
  'buy-upgrade': '🏁 Buy upgrade (time to purchase)',
}

/** The balance-sidecar export/copy toolbar (mirrors the shell's tree toolbar). */
function buildFileToolbar(ctx: EditorContext): HTMLElement {
  const bar = el('div', 'ed-form-toolbar')

  const exportBtn = el('button', 'ed-btn', '💾 Export balance')
  exportBtn.addEventListener('click', () => {
    try {
      exportBalance(ctx.balance)
    } catch (err) {
      ctx.setStatus(err instanceof Error ? err.message : 'Export failed', true)
      return
    }
    ctx.setStatus(`Exported ${ctx.balance.mode}.json`)
  })

  const copyBtn = el('button', 'ed-btn', '📋 Copy balance JSON')
  copyBtn.addEventListener('click', () => {
    let json: string
    try {
      json = balanceToJson(ctx.balance)
    } catch (err) {
      ctx.setStatus(err instanceof Error ? err.message : 'Copy failed', true)
      return
    }
    void navigator.clipboard
      .writeText(json)
      .then(() => {
        ctx.setStatus(`Copied ${ctx.balance.mode}.json to clipboard`)
      })
      .catch(() => {
        ctx.setStatus('Copy to clipboard failed', true)
      })
  })

  bar.append(exportBtn, copyBtn)
  return bar
}

export function createEnvelopesView(): EditorView {
  let host: HTMLElement | null = null
  let ctx: EditorContext | null = null

  const render = (): void => {
    if (!host || !ctx) return
    const c = ctx
    host.innerHTML = ''

    const root = el('div', 'ed-form-root')

    root.append(buildFileToolbar(c))

    const toolbar = el('div', 'ed-form-toolbar')
    for (const goalType of addableEnvelopeGoalTypes(c.balance, c.tree)) {
      toolbar.append(
        addButton(
          c,
          `➕ ${GOAL_LABELS[goalType]}`,
          () => addEnvelope(c.balance, goalType),
          (id) => `Added ${id} envelope`,
          render,
        ),
      )
    }
    if (toolbar.childElementCount === 0) {
      toolbar.append(el('span', 'ed-env-empty', 'Every goal type already has an envelope.'))
    }
    root.append(toolbar)

    const envelopes = listEnvelopes(c.balance)
    if (envelopes.length === 0) {
      root.append(el('div', 'ed-env-empty', 'No envelopes yet.'))
    }
    for (const env of envelopes) root.append(buildCard(c, env, render))

    host.append(root)
  }

  return {
    mount(h, c): void {
      host = h
      ctx = c
      render()
    },
    refresh: render,
    unmount(): void {
      if (host) host.innerHTML = ''
      host = null
      ctx = null
    },
  }
}

/** One envelope card: header + remove, checkpoint table, then the two scalars. */
function buildCard(
  ctx: EditorContext,
  env: ReturnType<typeof listEnvelopes>[number],
  render: () => void,
): HTMLElement {
  const balance = ctx.balance
  const goalType = env.goalType
  const isTimed = env.goalType === 'timed'

  const card = el('div', 'ed-env-card')

  const head = el('div', 'ed-env-head')
  head.append(el('span', 'ed-env-title', GOAL_LABELS[goalType]))
  const remove = el('button', 'ed-btn ed-btn-danger', '🗑 Remove envelope')
  remove.addEventListener('click', () => {
    removeEnvelope(balance, goalType)
    ctx.markBalanceDirty()
    ctx.setStatus(`Removed ${goalType} envelope`)
    render()
  })
  head.append(remove)
  card.append(head)

  // Checkpoints.
  const cpHead = el('div', 'ed-env-cp-head')
  const columns = isTimed
    ? ['Time (s)', 'Min score', 'Max score', 'Phase', '']
    : [
        goalType === 'target-score' ? 'At score' : 'Final buy',
        'Min time (s)',
        'Max time (s)',
        'Phase',
        '',
      ]
  for (const label of columns) cpHead.append(el('span', 'ed-env-cp-label', label))
  card.append(cpHead)

  env.checkpoints.forEach((cp, index) => {
    const row = el('div', 'ed-env-cp-row')

    if ('timeSec' in cp) {
      row.append(
        cell(
          numberInput(ctx, cp.timeSec, (n) => {
            setCheckpointField(balance, goalType, index, { timeSec: n })
          }),
        ),
        cell(
          numberInput(ctx, cp.minScore, (n) => {
            setCheckpointField(balance, goalType, index, { minScore: n })
          }),
        ),
        cell(
          numberInput(ctx, cp.maxScore, (n) => {
            setCheckpointField(balance, goalType, index, { maxScore: n })
          }),
        ),
      )
    } else {
      const atScore = el('div', 'ed-form-cell')
      if (goalType === 'target-score') {
        atScore.append(
          numberInput(ctx, cp.atScore ?? 0, (n) => {
            setCheckpointField(balance, goalType, index, { atScore: n })
          }),
        )
      } else {
        atScore.append(el('span', 'ed-env-na', '—'))
      }
      row.append(
        atScore,
        cell(
          numberInput(ctx, cp.minTimeSec, (n) => {
            setCheckpointField(balance, goalType, index, { minTimeSec: n })
          }),
        ),
        cell(
          numberInput(ctx, cp.maxTimeSec, (n) => {
            setCheckpointField(balance, goalType, index, { maxTimeSec: n })
          }),
        ),
      )
    }

    const phase = el('input', 'ed-input')
    phase.type = 'text'
    phase.value = cp.phase
    phase.addEventListener('change', () => {
      setCheckpointField(balance, goalType, index, { phase: phase.value })
      ctx.markBalanceDirty()
    })
    row.append(cell(phase))

    const del = el('button', 'ed-btn ed-btn-danger', '🗑')
    del.disabled = env.checkpoints.length <= 1
    del.addEventListener('click', () => {
      removeCheckpoint(balance, goalType, index)
      ctx.markBalanceDirty()
      render()
    })
    row.append(cell(del))

    card.append(row)
  })

  const cpToolbar = el('div', 'ed-form-toolbar')
  cpToolbar.append(
    addButton(
      ctx,
      '➕ Add checkpoint',
      () => {
        addCheckpoint(balance, goalType)
        return goalType
      },
      () => 'Added checkpoint',
      render,
    ),
  )
  card.append(cpToolbar)

  // Scalars.
  const scalars = el('div', 'ed-env-scalars')
  scalars.append(
    field(
      'Min viable strategies',
      numberInput(ctx, env.minViableStrategies, (n) => {
        setEnvelopeMinViable(balance, goalType, n)
      }),
    ),
    field(
      isTimed ? 'Max strategy spread (%)' : 'Max time spread (s)',
      numberInput(ctx, isTimed ? env.maxStrategySpread : env.maxTimeSpread, (n) => {
        setEnvelopeSpread(balance, goalType, n)
      }),
    ),
  )
  card.append(scalars)

  return card
}

/** Wrap a control in a form cell. */
function cell(control: HTMLElement): HTMLElement {
  const c = el('div', 'ed-form-cell')
  c.append(control)
  return c
}

/** A labelled scalar field (vertical). */
function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'ed-env-field')
  wrap.append(el('span', 'ed-env-field-label', label), control)
  return wrap
}
