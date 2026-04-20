import type { GameState } from '../game.js'
import { cancelQueue, quitMatch } from '../game.js'
import { app } from './helpers.js'

export function renderWakingScreen(): void {
  app.innerHTML = `
    <div class="screen waking-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Waking up server…</p>
      <div class="spinner"></div>
    </div>
  `
}

export function renderWaitingScreen(): void {
  app.innerHTML = `
    <div class="screen waiting-screen">
      <button class="quit-btn" id="cancel-queue-btn">← Cancel</button>
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Looking for opponent…</p>
      <div class="spinner"></div>
    </div>
  `

  document.getElementById('cancel-queue-btn')!.addEventListener('click', cancelQueue)
}

export function renderCountdownScreen(state: Readonly<GameState>): void {
  app.innerHTML = `
    <div class="screen countdown-screen">
      <button class="quit-btn" id="quit-btn">← Quit</button>
      <div class="countdown-number" id="countdown">${state.countdown}</div>
    </div>
  `

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
}

export function updateCountdown(state: Readonly<GameState>): void {
  const el = document.getElementById('countdown')
  if (el) {
    el.textContent = state.countdown <= 0 ? 'GO!' : String(state.countdown)
  }
}
