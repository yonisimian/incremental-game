import type { GameState } from '../game.js'
import { rematch, resetForMatch } from '../game.js'
import { getModeDefinition, getModeFlavor } from '@game/shared'
import { app, formatUpgradesPurchased, playerDisplayName, opponentDisplayName } from './helpers.js'
import { formatNumber } from './format-number.js'

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
    </div>
  `

  document.getElementById('rematch-btn')!.addEventListener('click', () => {
    rematch()
  })
  document.getElementById('lobby-btn')!.addEventListener('click', () => {
    resetForMatch()
  })
}
