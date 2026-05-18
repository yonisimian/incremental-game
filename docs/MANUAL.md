# Player Manual

> Auto-generated from the feature registry.
> **Do not edit manually** — run `pnpm generate:manual` to regenerate.

## Core Concepts

### Objective

Two players compete in real-time. Each round has a **goal** that determines how the winner is decided. Earn resources, spend them on upgrades and generators, and outscore your opponent.

### Resources & Score

**Resources** are currencies you spend on upgrades and generators. **Score** is the total amount of the primary resource ("score resource") you've ever earned — it never decreases, even when you spend.

### Generators

Generators produce passive income every second. Each copy you buy adds to your income rate. Their cost increases exponentially with each purchase (cost × scaling^owned).

### Upgrades

Upgrades provide permanent bonuses — flat income boosts, multipliers, or special effects. Some are one-time purchases; others can be bought multiple times. Tree upgrades may require prerequisites.

### Goals

- **Timed**: Highest score when the timer runs out wins.
- **Target Score**: First player to reach a target score wins (with a safety time cap).
- **Buy Upgrade**: First player to buy a specific trophy upgrade wins (with a safety time cap).

### Highlighting (Idler)

In Idler mode, you can highlight a resource to double (or quadruple, with an upgrade) its production rate. Press **Tab** to cycle which resource is highlighted.

### Clicking (Clicker)

In Clicker mode, each click earns income. Press **Space** or click the big button. Upgrades can increase click power.

## Screens

| Screen    | Description                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Lobby     | Choose a game mode, set your name, and start matchmaking or create/join a room.                                                        |
| Waiting   | In the quick-match queue — waiting for an opponent.                                                                                    |
| Room      | A private room where you can invite a friend, adjust settings (mode, goal), and start when ready.                                      |
| Countdown | Matched! A 3-2-1 countdown before the round begins.                                                                                    |
| Playing   | The active game — earn resources, buy upgrades and generators, and outscore your opponent before time runs out or the goal is reached. |
| End       | Round over — see scores, winner, and return to the lobby.                                                                              |

## Game Modes

### Clicker Mode

**Resources:** 💰 **Gold**

#### Generators

| Generator  | Base Cost | Scaling | Production (per copy) |
| ---------- | --------- | ------- | --------------------- |
| 🖱️ Cursor  | 15        | ×1.15   | +0.5 Gold/s           |
| 👨‍💼 Intern  | 100       | ×1.15   | +3 Gold/s             |
| 🏭 Factory | 500       | ×1.15   | +15 Gold/s            |

#### Goals

| Goal             | Description                                 |
| ---------------- | ------------------------------------------- |
| ⏱ Timed          | Highest score in 30s                        |
| 🎯 Race to Score | First to 666 score (cap: 300s)              |
| 🏆 Race to Buy   | First to buy the trophy upgrade (cap: 600s) |

### Idler Mode

**Resources:** 🪵 **Wood**, 🍺 **Ale**

#### Generators

| Generator     | Base Cost | Scaling | Production (per copy) |
| ------------- | --------- | ------- | --------------------- |
| 🪓 Woodcutter | 10        | ×1.15   | +1 Wood/s             |
| 🍺 Brewer     | 10        | ×1.15   | +0.2 Ale/s            |
| 🏗️ Sawmill    | 50        | ×1.15   | +1 Wood/s             |
| 🍻 Tavern     | 50        | ×1.15   | +1 Ale/s              |

#### Goals

| Goal             | Description                                 |
| ---------------- | ------------------------------------------- |
| ⏱ Timed          | Highest score in 35s                        |
| 🎯 Race to Score | First to 364 score (cap: 300s)              |
| 🏆 Race to Buy   | First to buy the trophy upgrade (cap: 600s) |

## Keyboard Shortcuts

| Key                       | Context             | Action                                                                                              |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `Escape`                  | Playing / Countdown | Quit the current match and return to the lobby.                                                     |
| `Escape`                  | Waiting / Room      | Cancel matchmaking or leave the room.                                                               |
| `Ctrl+1 … Ctrl+9, Ctrl+0` | Playing             | Jump to panel 1–10 directly. Ctrl+1 = first panel, Ctrl+0 = tenth panel. Locked panels are skipped. |
| `Ctrl+←`                  | Playing             | Switch to the previous panel.                                                                       |
| `Ctrl+→`                  | Playing             | Switch to the next panel.                                                                           |
| `Space`                   | Playing (Clicker)   | Click for income.                                                                                   |
| `Tab`                     | Playing (Idler)     | Cycle the highlighted resource.                                                                     |
| `C`                       | Playing             | Buy all affordable upgrades (cheapest first).                                                       |
| `1–9`                     | Playing             | Buy the Nth upgrade in the play panel.                                                              |
| `← → ↑ ↓`                 | Tab grid focused    | Navigate between tabs in the 5×2 grid.                                                              |
| `Home / End`              | Tab grid focused    | Jump to first / last panel.                                                                         |
