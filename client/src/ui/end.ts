import type { GameState } from '../game.js'
import { rematch, resetForMatch } from '../game.js'
import { getModeDefinition, getModeFlavor, liveActionsToStrategy } from '@game/shared'
import { app, formatUpgradesPurchased, playerDisplayName, opponentDisplayName } from './helpers.js'
import { formatNumber } from './format-number.js'
import { getRecordedRound } from '../dev-recorder.js'
import { saveStrategyToFile } from '../strategy-file.js'

export function renderEndScreen(state: Readonly<GameState>): void {
  const end = state.endData!
  const modeDef = getModeDefinition(state.mode!)
  const flavor = getModeFlavor(modeDef)

  let winnerText: string
  if (end.reason === 'quit') {
    winnerText = 'Opponent Quit'
  } else if (end.reason === 'forfeit') {
    winnerText = 'Opponent Disconnected — Victory!'
  } else if (end.reason === 'safety-cap') {
    winnerText =
      end.winner === 'player'
        ? 'Time Limit — Victory!'
        : end.winner === 'opponent'
          ? 'Time Limit — Defeat'
          : 'Time Limit — Draw'
  } else {
    winnerText =
      end.winner === 'player' ? '🎉 Victory!' : end.winner === 'opponent' ? 'Defeat' : 'Draw'
  }

  const resultClass = end.reason === 'quit' || end.reason === 'forfeit' ? 'player' : end.winner

  const scoreLabel = flavor.scoreLabel
  const pName = playerDisplayName(state)
  const oName = opponentDisplayName(state)

  // Race-to-buy is won by buying the goal upgrade, not by score — and the
  // opponent's score is never revealed — so the score block is hidden entirely.
  const scoresBlock =
    state.goal?.type === 'buy-upgrade'
      ? ''
      : `
      <div class="final-scores">
        <div>${pName}'s ${scoreLabel}: <strong>${formatNumber(Math.floor(end.finalScores.player))}</strong></div>
        <div>${oName}'s ${scoreLabel}: <strong>${formatNumber(Math.floor(end.finalScores.opponent ?? 0))}</strong></div>
      </div>`

  app.innerHTML = `
    <div class="screen end-screen">
      <h1 class="result ${resultClass}">${winnerText}</h1>
      ${scoresBlock}
      <div class="stats">
        ${flavor.showClickStats ? `<div>Clicks: ${formatNumber(end.stats.totalClicks)}</div>` : ''}
        ${flavor.showClickStats ? `<div>Peak CPS: ${formatNumber(end.stats.peakCps)}</div>` : ''}
        <div>Upgrades: ${formatUpgradesPurchased(end.stats.upgradesPurchased, flavor)}</div>
      </div>
      <div class="end-actions">
        <button id="rematch-btn">Rematch</button>
        <button id="lobby-btn">Back to Lobby</button>
      </div>
      <div class="end-export">
        <button id="export-recording-btn">⤓ Export recording</button>
        <span id="export-recording-status" class="end-export-status"></span>
      </div>
    </div>
  `

  document.getElementById('rematch-btn')!.addEventListener('click', () => {
    rematch()
  })
  document.getElementById('lobby-btn')!.addEventListener('click', () => {
    resetForMatch()
  })

  const exportBtn = document.getElementById('export-recording-btn') as HTMLButtonElement
  const exportStatus = document.getElementById('export-recording-status')!
  const recorded = getRecordedRound()
  if (!recorded) {
    exportBtn.disabled = true
    exportBtn.title = 'Nothing was recorded this round.'
  }
  exportBtn.addEventListener('click', () => {
    const round = getRecordedRound()
    if (!round) {
      exportStatus.textContent = 'Nothing recorded.'
      return
    }
    const name = `${round.mode} ${new Date().toLocaleString()}`
    const strategy = liveActionsToStrategy(round.actions, round.mode, name)
    exportStatus.textContent = ''
    saveStrategyToFile(strategy).then(
      () => {
        exportStatus.textContent = `Exported "${name}" (${strategy.actions.length} actions).`
      },
      (err: unknown) => {
        exportStatus.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`
      },
    )
  })
}
