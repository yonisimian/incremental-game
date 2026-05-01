import type { GameState } from '../game.js'
import { resetForMatch } from '../game.js'
import { app, formatUpgradesPurchased, playerDisplayName, opponentDisplayName } from './helpers.js'

export function renderEndScreen(state: Readonly<GameState>): void {
  const end = state.endData!
  const isIdler = state.mode === 'idler'

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

  const scoreLabel = isIdler ? '🪵 Total' : 'Score'
  const pName = playerDisplayName(state)
  const oName = opponentDisplayName(state)

  app.innerHTML = `
    <div class="screen end-screen">
      <h1 class="result ${resultClass}">${winnerText}</h1>
      <div class="final-scores">
        <div>${pName}'s ${scoreLabel}: <strong>${Math.floor(end.finalScores.player)}</strong></div>
        <div>${oName}'s ${scoreLabel}: <strong>${Math.floor(end.finalScores.opponent)}</strong></div>
      </div>
      <div class="stats">
        ${isIdler ? '' : `<div>Clicks: ${end.stats.totalClicks}</div>`}
        ${isIdler ? '' : `<div>Peak CPS: ${end.stats.peakCps}</div>`}
        <div>Upgrades: ${formatUpgradesPurchased(end.stats.upgradesPurchased, state.upgrades)}</div>
      </div>
      <button class="rematch-button" id="rematch-btn">Back to Lobby</button>
    </div>
  `

  document.getElementById('rematch-btn')!.addEventListener('click', () => {
    resetForMatch()
  })
}
