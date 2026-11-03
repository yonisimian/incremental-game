# 57 — How to play slides

## Status: Proposed

Sits beside [55 — Contextual hints](55-contextual-hints.md) and
[56 — Tutorial lessons](56-tutorial-lessons.md): slides are for reading, lessons
for practising, hints for reminding mid-match.

---

## Problem

The lobby's About dialog ([52](52-about-panel.md)) says what the game is in one
sentence and opens the upgrade tree. A player who wants the rules explained,
without playing a lesson, has nowhere to read them.

## Goal

A "How to play" slideshow opened from the lobby: one topic per slide, a short
text and a picture each, paged with buttons, arrow keys or a swipe. Not
interactive beyond paging. It covers the same topics as the lessons, in the
same order.

---

## Slides

| #   | Slide              | Says                                                              | Picture                         |
| --- | ------------------ | ----------------------------------------------------------------- | ------------------------------- |
| 1   | The race           | two players, one clock, highest score wins; the three goals       | the playing screen              |
| 2   | Score vs resources | resources are spent, score never goes down; buying is always safe | resource counters and the score |
| 3   | Upgrades           | the tree map, prerequisites, categories as islands                | a piece of the tree             |
| 4   | Clicking           | bought, not given; Z switches resource                            | the click cards                 |
| 5   | Highlight          | focus a resource; the battery drains and recharges                | highlight and battery bar       |
| 6   | Generators         | passive income, buying copies, rising cost                        | a generator row                 |
| 7   | Attacks            | prepare, land, cool down; slots; the alert when you're hit        | an attack card and the alert    |
| 8   | Espionage          | reading the opponent                                              | the espionage panel             |
| 9   | Pacts              | passive and active pacts, limits                                  | a pact card                     |
| 10  | Where next         | links to the lessons and the upgrade tree                         | none                            |

## Design

### Slides are data

```ts
// client/src/ui/how-to-play/slides.ts
interface Slide {
  id: string
  title: string
  text: (flavor: ModeFlavor) => string // resource and panel names from the flavor
  picture?: SlidePicture
  lesson?: string // "Try it" link to the matching lesson (plan 56)
}
```

Copy uses the default mode's flavor, so it says "Wood", not `r0`, and stays
right if the flavor is renamed.

### Pictures: real components first, screenshots second

The client ships no images today, and screenshots go stale with every UI
change. Two kinds of picture:

- **Rendered:** the real component (click cards, a generator row, a stretch
  of the tree map, an attack card) drawn from a fixed sample state. It always
  matches the current UI and theme. The upgrade tree reader in the About
  dialog already shows the real tree rather than a picture of it.
- **Screenshot:** for whole screens a component can't stand in for (slide 1).
  Saved as `.webp` in `client/public/how-to-play/`, so it isn't counted in the
  JS bundle budget. A Playwright script retakes them all
  (`pnpm slides:screenshots`), so refreshing them after a UI change is one
  command.

### Where it opens

A "How to play" button in the lobby, opening a wide modal through the shared
`openModal` shell, so close (✕, backdrop, Esc) and the no-double-open guard
come free. The About dialog gets a link to it too.

### Paging

- Previous / next buttons and a row of dots that jump to a slide.
- ← / → keys while open; swipe on touch screens.
- No slide animation under `prefers-reduced-motion`.
- Each slide is a `role="group"` with `aria-roledescription="slide"` and a
  label like "3 of 10". Pictures have alt text.

### Bundle

The slideshow and its sample states load with a dynamic `import()` when the
button is pressed, so the lobby doesn't pay for them.

---

## Open decisions

| Question                             | Options                                                    | Leaning                                |
| ------------------------------------ | ---------------------------------------------------------- | -------------------------------------- |
| Where is the button?                 | Lobby, beside the actions / inside the About dialog / both | Both                                   |
| Pictures                             | Rendered components / screenshots / emoji and CSS only     | Rendered, screenshots only for slide 1 |
| Share copy with the lessons?         | One topic list feeding slides and lesson intros / separate | Shared, once 56 is built               |
| Offer it unprompted on first launch? | Yes / no, and let 56 make that offer                       | No                                     |

## Tests

- **Unit:** slide ids are unique; every `lesson` link names a real lesson;
  copy has no raw `r0` / `g0` ids left in it.
- **DOM:** the button opens the slideshow; next, previous, dots and arrow keys
  move between slides; the ends don't wrap; a second click doesn't open a
  second one.
- **e2e:** page through every slide on desktop and mobile; axe with the
  slideshow open.

## Steps

1. Modal, paging, lobby button, text-only slides.
2. Rendered pictures from sample states.
3. Screenshot script and slide 1's picture.
4. "Try it" links, once lessons exist.
