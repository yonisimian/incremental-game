import type { UpgradeId } from '@game/shared';
import type { ConnectionState } from './network.js';
import type { GameState, Screen } from './game.js';
import { doClick, doBuy, resetForMatch, selectMode, quitMatch, getState } from './game.js';

// ─── Constants ───────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>('#app')!;

// ─── Public API ──────────────────────────────────────────────────────

let currentScreen: Screen | 'waking' | null = null;
let connectionState: ConnectionState = 'disconnected';

/** Called whenever the game state changes. */
export function render(state: Readonly<GameState>): void {
  // The connection overlay takes priority during waking/connecting
  if (connectionState === 'waking' || connectionState === 'connecting') {
    if (currentScreen !== 'waking') {
      currentScreen = 'waking';
      renderWakingScreen();
    }
    return;
  }

  if (state.screen !== currentScreen) {
    currentScreen = state.screen;
    switch (state.screen) {
      case 'lobby':
        renderLobbyScreen();
        break;
      case 'waiting':
        renderWaitingScreen();
        break;
      case 'countdown':
        renderCountdownScreen(state);
        break;
      case 'playing':
        renderPlayingScreen(state);
        break;
      case 'ended':
        renderEndScreen(state);
        break;
    }
  } else {
    // Update existing screen in-place
    switch (state.screen) {
      case 'countdown':
        updateCountdown(state);
        break;
      case 'playing':
        updatePlaying(state);
        break;
    }
  }
}

/** Called when the connection state changes. */
export function handleConnectionChange(state: ConnectionState): void {
  connectionState = state;

  if (state === 'waking' || state === 'connecting') {
    if (currentScreen !== 'waking') {
      currentScreen = 'waking';
      renderWakingScreen();
    }
  } else if (state === 'connected') {
    // Re-render current game state
    currentScreen = null; // force re-render
    render(getState());
  } else if (state === 'disconnected') {
    // Show disconnected overlay when in an active session
    const gs = getState();
    if (gs.screen === 'playing' || gs.screen === 'countdown' || gs.screen === 'waiting') {
      app.innerHTML = `
        <div class="screen disconnected-screen">
          <h1>Disconnected</h1>
          <p>Reconnecting…</p>
        </div>
      `;
      currentScreen = null;
    }
  }
}

// ─── Screens ─────────────────────────────────────────────────────────

function renderWakingScreen(): void {
  app.innerHTML = `
    <div class="screen waking-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Waking up server…</p>
      <div class="spinner"></div>
    </div>
  `;
}

function renderLobbyScreen(): void {
  app.innerHTML = `
    <div class="screen lobby-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Choose a game mode</p>
      <div class="mode-buttons">
        <button class="mode-btn" data-mode="clicker">
          <span class="mode-name">Clicker</span>
          <span class="mode-desc">Click fast, buy upgrades, outscore your opponent</span>
        </button>
        <button class="mode-btn" data-mode="idler">
          <span class="mode-name">Idler</span>
          <span class="mode-desc">Passive income only — pure upgrade strategy</span>
        </button>
        <button class="mode-btn tbd" disabled>
          <span class="mode-name">TBD</span>
          <span class="mode-desc">Coming soon…</span>
        </button>
      </div>
    </div>
  `;

  document.querySelectorAll<HTMLButtonElement>('.mode-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'clicker' || mode === 'idler') selectMode(mode);
    });
  });
}

function renderWaitingScreen(): void {
  app.innerHTML = `
    <div class="screen waiting-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Looking for opponent…</p>
      <div class="spinner"></div>
    </div>
  `;
}

function renderCountdownScreen(state: Readonly<GameState>): void {
  app.innerHTML = `
    <div class="screen countdown-screen">
      <button class="quit-btn" id="quit-btn">← Quit</button>
      <div class="countdown-number" id="countdown">${state.countdown}</div>
    </div>
  `;

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch);
}

function renderPlayingScreen(state: Readonly<GameState>): void {
  const isClicker = state.mode === 'clicker';

  app.innerHTML = `
    <div class="screen playing-screen">
      <header class="game-header">
        <div class="mode-label">${isClicker ? 'Clicker' : 'Idler'}</div>
        <div class="timer" id="timer">${formatTime(state.timeLeft)}</div>
        <button class="quit-btn" id="quit-btn">← Quit</button>
      </header>

      <div class="scoreboard">
        <div class="player-col you">
          <span class="label">You</span>
          <span class="score" id="player-score">${Math.floor(state.player.score)}</span>
        </div>
        <div class="vs">vs</div>
        <div class="player-col opponent">
          <span class="label">Opponent</span>
          <span class="score" id="opponent-score">${Math.floor(state.opponent.score)}</span>
        </div>
      </div>

      <div class="currency-bar">
        <span>Currency: </span>
        <span id="currency">${Math.floor(state.player.currency)}</span>
      </div>

      ${isClicker ? '<button class="click-button" id="click-btn">CLICK</button>' : ''}

      <div class="upgrades" id="upgrades">
        ${renderUpgrades(state)}
      </div>
    </div>
  `;

  bindPlayingEvents(isClicker);
}

function renderEndScreen(state: Readonly<GameState>): void {
  const end = state.endData!;

  let winnerText: string;
  if (end.reason === 'quit') {
    winnerText = 'Opponent Quit';
  } else if (end.reason === 'forfeit') {
    winnerText = 'Opponent Disconnected — You Win!';
  } else {
    winnerText = end.winner === 'player'
      ? '🎉 You Win!'
      : end.winner === 'opponent'
        ? 'You Lose'
        : "It's a Draw";
  }

  const resultClass = end.reason === 'quit' || end.reason === 'forfeit'
    ? 'player'
    : end.winner;

  app.innerHTML = `
    <div class="screen end-screen">
      <h1 class="result ${resultClass}">${winnerText}</h1>
      <div class="final-scores">
        <div>Your Score: <strong>${Math.floor(end.finalScores.player)}</strong></div>
        <div>Opponent: <strong>${Math.floor(end.finalScores.opponent)}</strong></div>
      </div>
      <div class="stats">
        <div>Clicks: ${end.stats.totalClicks}</div>
        <div>Peak CPS: ${end.stats.peakCps}</div>
        <div>Upgrades: ${end.stats.upgradesPurchased.length > 0 ? end.stats.upgradesPurchased.join(', ') : 'none'}</div>
      </div>
      <button class="rematch-button" id="rematch-btn">Back to Lobby</button>
    </div>
  `;

  document.getElementById('rematch-btn')!.addEventListener('click', () => {
    resetForMatch();
  });
}

// ─── In-place Updates ────────────────────────────────────────────────

function updateCountdown(state: Readonly<GameState>): void {
  const el = document.getElementById('countdown');
  if (el) {
    el.textContent = state.countdown <= 0 ? 'GO!' : String(state.countdown);
  }
}

function updatePlaying(state: Readonly<GameState>): void {
  setText('timer', formatTime(state.timeLeft));
  setText('player-score', String(Math.floor(state.player.score)));
  setText('opponent-score', String(Math.floor(state.opponent.score)));
  setText('currency', String(Math.floor(state.player.currency)));

  // Update upgrade buttons (affordability / owned state)
  const container = document.getElementById('upgrades');
  if (container) container.innerHTML = renderUpgrades(state);
  bindUpgradeEvents();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function renderUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u) => {
      const owned = state.player.upgrades[u.id];
      const canAfford = state.player.currency >= u.cost;
      const disabled = owned || !canAfford;
      return `
        <button
          class="upgrade-btn ${owned ? 'owned' : ''} ${!canAfford && !owned ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${owned ? '✓' : `$${u.cost}`}</span>
          <span class="upgrade-desc">${u.description}</span>
        </button>
      `;
    })
    .join('');
}

function bindPlayingEvents(clickEnabled: boolean): void {
  if (clickEnabled) {
    document.getElementById('click-btn')!.addEventListener('click', doClick);
  }
  document.getElementById('quit-btn')!.addEventListener('click', quitMatch);
  bindUpgradeEvents();
}

function bindUpgradeEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('.upgrade-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.upgrade;
      if (uid) doBuy(uid as UpgradeId);
    });
  });
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
