# 56 — Tutorial lessons

## Status: Proposed

Builds on [55 — Contextual hints](55-contextual-hints.md): a lesson's
callouts are hint steps scoped to that lesson.

---

## Problem

Contextual hints explain a system when it first shows up, but in a real match
it shows up mid-race, next to everything else, against an opponent who is
already using it. A player who wants to learn before competing has no place to
practise one thing at a time.

## Goal

A series of short matches against a bot. Each one teaches one system and ends
when the player completes that lesson's task. Each lesson adds to the last,
in the order the idler tree itself unlocks things, so the final lesson is a
real match.

---

## Lessons

| #   | Lesson             | New in this lesson                                                 | Task (ends the lesson)                  | Bot                        |
| --- | ------------------ | ------------------------------------------------------------------ | --------------------------------------- | -------------------------- |
| 1   | Score and upgrades | the two resources, passive base income, score vs resources, buying | buy N upgrades                          | idle                       |
| 2   | Clicking           | `sc-unlock`: click cards, Z to switch resource                     | reach a score of X                      | idle                       |
| 3   | Highlight          | highlight unlock and `sh-unlock`: focus a resource, the battery    | reach X with the battery used once      | idle                       |
| 4   | Generators         | `g1-g2`: the generators tab, buying copies                         | own N generators                        | slow economy, to race      |
| 5   | Attacks            | `a-unlock`: preparing, landing and recovering from an attack       | land an attack                          | attacks the player once    |
| 6   | Espionage          | `e-se-mr`: reading the opponent's state                            | buy an espionage upgrade, then outscore | normal economy, no attacks |
| 7   | Pacts              | `ir-unlock`: passive and active pacts                              | activate a pact                         | normal economy             |
| 8   | Final match        | nothing new: the full tree                                         | win a short timed match                 | the normal bot             |

Lessons 1 to 7 should each take one to two minutes. Lesson N starts with the
unlock upgrades of lessons 1 to N-1 already owned, so a returning player can
start at any lesson.

Clicking coming after upgrades matches the real game: in idler, clicking is
bought (`sc-unlock`), not given.

## Design

### A lesson is an overlay on the idler tree

```ts
// shared/src/tutorial/lessons.ts
interface Lesson {
  id: string
  mode: GameMode // 'idler'
  allowedUpgrades: readonly string[] // everything else hidden and unbuyable
  ownedUpgrades: readonly string[] // pre-bought unlocks of earlier lessons
  initialResources?: Record<string, number>
  task: LessonTask // win condition
  bot: LessonBotScript
  steps: readonly HintStep[] // callouts, from plan 55's engine
}
```

The player learns on the real tree, with real costs and the real map, so what
they learn is what they play. A test checks that every id a lesson names
exists in `idler.json`, so a tree edit that breaks a lesson fails CI instead
of failing a player.

The alternative is one cut-down tree file per lesson in
`shared/trees/tutorial/`. `loadTreeFiles` doesn't read subfolders, so these
wouldn't appear in the lobby's mode picker. They'd need no allow-list, but
they copy upgrades out of idler and drift from it with every balance change.

### A `lesson` goal

A new `Goal` variant, `{ type: 'lesson', lessonId, safetyCapSec }`. The
server checks the lesson's `LessonTask` each tick and ends the match when it
is met. Task kinds: `upgradesBought`, `score`, `generatorsOwned`,
`attackLanded`, `pactActivated`, `batteryUsed`.

A lesson can't be lost. The bot never completes the task, and hitting the
safety cap ends with "Try again", not a loss. Lesson 8 is a normal timed goal,
so it can be lost.

### The bot follows a script

A `LessonBot` implementing `BotStrategy` in
[bot.ts](../../server/src/bot.ts), driven by the lesson's `LessonBotScript`:
`idle`, `slowEconomy`, timed actions such as "attack at 20 s", or the normal
`IdlerBot`.

### Server

- A `LESSON_START { lessonId }` message starts a bot match from the lesson,
  the same way `startBotMatch` does in
  [main.ts](../../server/src/main.ts).
- Purchase validation rejects upgrades outside `allowedUpgrades`.
- Bot matches can already pause (`PAUSE` / `UNPAUSE` in
  [match.ts](../../server/src/match.ts)). A lesson pauses while a step that
  needs reading is open, and resumes when it is dismissed.

### Client

- **Lobby:** a "Tutorial" button opens a lesson list with completed lessons
  ticked. Any lesson can be started, so a player can skip ahead.
- **Tree panel:** upgrades outside the lesson are hidden or shown locked.
- **End screen:** "Lesson complete" with "Next lesson" and "Back to lobby" in
  place of win/lose and rematch.
- **Progress** goes in `localStorage` behind try/catch, beside the seen hints.

---

## Open decisions

| Question                                    | Options                                         | Leaning                      |
| ------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| How is a lesson's tree defined?             | Overlay on idler / one tree file per lesson     | Overlay                      |
| Upgrades outside the lesson in the tree map | Hidden / shown locked                           | Shown locked, as a preview   |
| Should 2 and 3 be one lesson?               | Separate / merged into "Clicking and highlight" | Separate; merge if too short |
| Should 5 and 6 be one lesson?               | Separate / merged into "The opponent"           | Separate                     |
| Should the tutorial be offered unprompted?  | On first launch / only from the lobby button    | On first launch, skippable   |

## Tests

- **Unit:** every lesson's ids exist in `idler.json`; each `LessonTask` kind
  against built states; the scripted bot's actions per tick.
- **Server:** a lesson match ends on its task; a purchase outside the lesson
  is rejected; the safety cap ends without a loss.
- **DOM:** the lesson list ticks completed lessons; the end screen offers
  "Next lesson".
- **e2e:** play lesson 1 to completion and reach lesson 2, on desktop and
  mobile.

## Steps

1. The `Lesson` type, the `lesson` goal and task checks, `LESSON_START`, the
   allow-list in purchase validation. Lesson 1 only, with an idle bot.
2. Lobby lesson list, end screen, saved progress.
3. Lessons 2 to 4.
4. `LessonBot` scripts, and lessons 5 to 7.
5. Lesson 8 and the first-launch offer.
