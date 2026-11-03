# 55 — Contextual hints

## Status: Proposed

---

## Problem

A new player lands in a timed race against another player with no explanation
of what to click, what upgrades do, or what the panels that unlock mid-round
are for. The About dialog ([52](52-about-panel.md)) says what the game is, not
how to play it.

## Goal

Teach each system at the moment it becomes usable, without slowing down a
player who already knows it, and without a server change.

The game already paces itself: the generators, attack, espionage and
international-relationship tabs are each gated by a `panelUnlock` upgrade in
[idler.json](../../shared/trees/idler.json). Those unlocks are when the hints
show. An up-front walkthrough would explain systems the player can't reach
yet.

---

## Hints

A small client-side engine shows a one-time callout the first time a trigger
fires, in any match.

```ts
// client/src/ui/hints/steps.ts
interface HintStep {
  id: string // persisted once seen
  when: (s: GameState) => boolean // trigger
  anchor: string // CSS selector / panel tab id
  text: (flavor: ModeFlavor) => string // flavor-aware copy
  doneWhen?: (s: GameState) => boolean // auto-dismiss on the taught action
}
```

### Candidate hints

| Hint         | Trigger                                            | Anchor           | Teaches                                          |
| ------------ | -------------------------------------------------- | ---------------- | ------------------------------------------------ |
| `click`      | round starts                                       | click cards      | clicking earns the score resource                |
| `upgrade`    | first upgrade becomes affordable                   | upgrade tree tab | upgrades raise income; buying never lowers score |
| `generators` | `isPanelUnlocked(…, 'generators')`                 | generators tab   | passive income                                   |
| `attack`     | `isPanelUnlocked(…, 'attack')`                     | attack tab       | attacks, prep, cooldown, slots                   |
| `attacked`   | first incoming attack event                        | attack alert     | what just happened and how to respond            |
| `espionage`  | `isPanelUnlocked(…, 'espionage')`                  | espionage tab    | reading the opponent                             |
| `pacts`      | `isPanelUnlocked(…, 'international-relationship')` | its tab          | pacts, activation, limits                        |

### Design

- **Triggers use abstract IDs and shared helpers** (`isPanelUnlocked`,
  `isCostAffordable`). Copy pulls names from the `ModeFlavor`. A new mode file
  gets working hints without edits.
- **Seen hints go in `localStorage`** behind try/catch, like `player-name` in
  [game.ts](../../client/src/game.ts). A "Reset hints" button in settings
  clears them.
- **Non-blocking, one at a time.** A dismissible bubble with an arrow, never a
  modal: in a timed race a pause is a penalty. Later triggers queue behind the
  one showing.
- **Evaluated in the existing per-tick `update`**, not a second loop. Triggers
  are cheap predicates. Once every hint is seen the engine does nothing.
- **Bundle budget** (warn 60 kB): keep the engine small; load it with a
  dynamic `import()` only while unseen hints remain.
- **Mobile:** anchors must land on the right tab in the 5×2 grid at phone
  width.
- **Accessibility:** bubbles use `role="status"` / `aria-live`.
- **Hotkeys:** an open bubble must not swallow keys from
  [hotkeys.ts](../../client/src/ui/hotkeys.ts). Esc dismisses it only when no
  modal is open.

---

## Open decisions

| Question                                 | Options                                                 | Leaning                |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------- |
| Are hints on by default?                 | On until seen / off until enabled in settings           | On until seen          |
| Do hints show in matches against humans? | Every match until seen / bot matches only               | Every match until seen |
| Can a player skip all hints at once?     | "Don't show hints" on the bubble / settings toggle only | Both                   |

## Tests

- **Unit:** each hint's `when` / `doneWhen` against built `GameState`s.
- **DOM** (`*.dom.test.ts`): a trigger shows its bubble; dismissing saves it;
  a seen hint doesn't show again; reset brings the hints back; one bubble at a
  time.
- **e2e:** first-match flow on desktop and mobile; `A11Y-01`'s axe check run
  with a bubble open.

## Steps

1. Hint engine, `localStorage` persistence, bubble component, `click` and
   `upgrade` hints.
2. Panel-unlock hints (`generators`, `attack`, `espionage`, `pacts`) and
   `attacked`.
3. "Reset hints" in settings.
