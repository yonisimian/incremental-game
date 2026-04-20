import type { UpgradeDefinition, UpgradeId } from '@game/shared';
import type { ConnectionState } from './network.js';
import type { GameState, Screen } from './game.js';
import {
  doClick,
  doBuy,
  resetForMatch,
  selectMode,
  cancelQueue,
  quitMatch,
  setHighlight,
  getState,
} from './game.js';

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
      <button class="quit-btn" id="cancel-queue-btn">← Cancel</button>
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Looking for opponent…</p>
      <div class="spinner"></div>
    </div>
  `;

  document.getElementById('cancel-queue-btn')!.addEventListener('click', cancelQueue);
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

  if (!isClicker) {
    renderIdlerPlayingScreen(state);
    return;
  }

  app.innerHTML = `
    <div class="screen playing-screen">
      <header class="game-header">
        <div class="mode-label">Clicker</div>
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

      <button class="click-button" id="click-btn">CLICK<span class="btn-hotkey">Space</span></button>

      <div class="upgrades-wrapper">
        <span class="upgrades-hotkey"><span class="btn-hotkey">C</span> buy cheapest</span>
        <div class="upgrades" id="upgrades">
          ${renderClickerUpgrades(state)}
        </div>
      </div>
    </div>
  `;

  bindPlayingEvents(true);
}

function renderIdlerPlayingScreen(state: Readonly<GameState>): void {
  const highlight = state.player.highlight ?? 'wood';
  const wood = Math.floor(state.player.wood ?? 0);
  const ale = Math.floor(state.player.ale ?? 0);

  app.innerHTML = `
    <div class="screen playing-screen idler-playing">
      <header class="game-header">
        <div class="mode-label">Idler</div>
        <div class="timer" id="timer">${formatTime(state.timeLeft)}</div>
        <button class="quit-btn" id="quit-btn">← Quit</button>
      </header>

      <div class="scoreboard">
        <div class="player-col you">
          <span class="label">You</span>
          <span class="score" id="player-score">${Math.floor(state.player.score)} 🪵</span>
        </div>
        <div class="vs">vs</div>
        <div class="player-col opponent">
          <span class="label">Opponent</span>
          <span class="score" id="opponent-score">${Math.floor(state.opponent.score)} 🪵</span>
        </div>
      </div>

      <div class="currency-cards">
        <span class="cards-hotkey">Tab</span>
        <button class="currency-card ${highlight === 'wood' ? 'highlighted' : ''}" id="card-wood">
          <span class="card-emoji">🪵</span>
          <span class="card-name">Wood</span>
          <span class="card-balance" id="wood-balance">${wood}</span>
        </button>
        <button class="currency-card ${highlight === 'ale' ? 'highlighted' : ''}" id="card-ale">
          <span class="card-emoji">🍺</span>
          <span class="card-name">Ale</span>
          <span class="card-balance" id="ale-balance">${ale}</span>
        </button>
      </div>

      <div class="upgrades-wrapper">
        <span class="upgrades-hotkey"><span class="btn-hotkey">C</span> buy cheapest</span>
        <div class="upgrades" id="upgrades">
          ${renderIdlerUpgrades(state)}
        </div>
      </div>
    </div>
  `;

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch);
  bindIdlerEvents();
}

function renderEndScreen(state: Readonly<GameState>): void {
  const end = state.endData!;
  const isIdler = state.mode === 'idler';

  let winnerText: string;
  if (end.reason === 'quit') {
    winnerText = 'Opponent Quit';
  } else if (end.reason === 'forfeit') {
    winnerText = 'Opponent Disconnected — You Win!';
  } else {
    winnerText =
      end.winner === 'player'
        ? '🎉 You Win!'
        : end.winner === 'opponent'
          ? 'You Lose'
          : "It's a Draw";
  }

  const resultClass = end.reason === 'quit' || end.reason === 'forfeit' ? 'player' : end.winner;

  const scoreLabel = isIdler ? '🪵 Total' : 'Score';

  app.innerHTML = `
    <div class="screen end-screen">
      <h1 class="result ${resultClass}">${winnerText}</h1>
      <div class="final-scores">
        <div>Your ${scoreLabel}: <strong>${Math.floor(end.finalScores.player)}</strong></div>
        <div>Opponent: <strong>${Math.floor(end.finalScores.opponent)}</strong></div>
      </div>
      <div class="stats">
        ${isIdler ? '' : `<div>Clicks: ${end.stats.totalClicks}</div>`}
        ${isIdler ? '' : `<div>Peak CPS: ${end.stats.peakCps}</div>`}
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
  setText(
    'player-score',
    String(Math.floor(state.player.score)) + (state.mode === 'idler' ? ' 🪵' : ''),
  );
  setText(
    'opponent-score',
    String(Math.floor(state.opponent.score)) + (state.mode === 'idler' ? ' 🪵' : ''),
  );

  if (state.mode === 'idler') {
    setText('wood-balance', String(Math.floor(state.player.wood ?? 0)));
    setText('ale-balance', String(Math.floor(state.player.ale ?? 0)));

    // Update highlight state on currency cards
    const highlight = state.player.highlight ?? 'wood';
    const woodCard = document.getElementById('card-wood');
    const aleCard = document.getElementById('card-ale');
    if (woodCard) woodCard.classList.toggle('highlighted', highlight === 'wood');
    if (aleCard) aleCard.classList.toggle('highlighted', highlight === 'ale');

    const container = document.getElementById('upgrades');
    if (container) container.innerHTML = renderIdlerUpgrades(state);
    bindUpgradeEvents();
  } else {
    setText('currency', String(Math.floor(state.player.currency)));
    const container = document.getElementById('upgrades');
    if (container) container.innerHTML = renderClickerUpgrades(state);
    bindUpgradeEvents();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Can the player afford this upgrade (and is it still purchasable)? */
function canAfford(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  const owned = state.player.upgrades[u.id];
  if (!u.repeatable && owned) return false;
  if (u.costCurrency) {
    const balance = u.costCurrency === 'wood' ? (state.player.wood ?? 0) : (state.player.ale ?? 0);
    return balance >= u.cost;
  }
  return state.player.currency >= u.cost;
}

function renderClickerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u, i) => {
      const owned = state.player.upgrades[u.id];
      const affordable = canAfford(state, u);
      const disabled = owned || !affordable;
      const hotkey = i + 1;
      return `
        <button
          class="upgrade-btn ${owned ? 'owned' : ''} ${!affordable && !owned ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${owned ? '✓' : `$${u.cost}`}</span>
          <span class="upgrade-desc">${u.description}</span>
          <span class="upgrade-hotkey">${hotkey}</span>
        </button>
      `;
    })
    .join('');
}

function renderIdlerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u, i) => {
      const owned = state.player.upgrades[u.id];
      const affordable = canAfford(state, u);
      const disabled = (!u.repeatable && owned) || !affordable;
      const emoji = u.costCurrency === 'wood' ? '🪵' : '🍺';
      const count = u.repeatable ? Number(owned) || 0 : 0;
      const costLabel =
        !u.repeatable && owned ? '✓' : `${u.cost} ${emoji}${count > 0 ? ` (×${count})` : ''}`;
      const hotkey = i + 1;
      return `
        <button
          class="upgrade-btn ${!u.repeatable && owned ? 'owned' : ''} ${!affordable && !(owned && !u.repeatable) ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${costLabel}</span>
          <span class="upgrade-desc">${u.description}</span>
          <span class="upgrade-hotkey">${hotkey}</span>
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

function bindIdlerEvents(): void {
  document.getElementById('card-wood')!.addEventListener('click', () => setHighlight('wood'));
  document.getElementById('card-ale')!.addEventListener('click', () => setHighlight('ale'));
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

// ─── Hotkeys ─────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const state = getState();
  if (state.screen !== 'playing') return;

  // Space — click (clicker mode)
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault(); // prevent page scroll
    doClick();
    return;
  }

  // Tab — toggle highlight (idler mode)
  if (e.key === 'Tab') {
    e.preventDefault(); // prevent focus shift
    const current = state.player.highlight ?? 'wood';
    setHighlight(current === 'wood' ? 'ale' : 'wood');
    return;
  }

  // C — buy cheapest affordable upgrade
  if (e.key === 'c' || e.key === 'C') {
    const cheapest = state.upgrades
      .filter((u) => canAfford(state, u))
      .sort((a, b) => a.cost - b.cost)[0];
    if (cheapest) doBuy(cheapest.id);
    return;
  }

  // 1/2/3 — buy upgrade by index
  const index = Number(e.key) - 1;
  if (index >= 0 && index < state.upgrades.length) {
    doBuy(state.upgrades[index].id);
  }
});

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
