# 52 — About panel

## Status: Implemented

---

## Problem

The main menu doesn't say what the game is.

## Goal

A small "i" button in the lobby's top-left corner, opposite the settings gear,
that opens an About dialog with one sentence about the game.

The button is "i" rather than "!" because the end screen already uses "!" for
Report a bug.

## Implementation

- [about-modal.ts](../../client/src/ui/about-modal.ts) opens the dialog
  through the shared `openModal` shell, the same way the settings and
  report-a-bug dialogs do. Closing (✕, backdrop, Esc) and the
  no-double-open guard come from the shell.
- [lobby.ts](../../client/src/ui/lobby.ts) renders the button and binds it.
- `.about-btn` matches the gear's size, background and hover, without the
  rotation. `.about-body` shares the report dialog's text styles.

## Tests

- `client/tests/about-modal.dom.test.ts`: the lobby button opens the dialog,
  and a repeat click doesn't stack a second one.
- `PREF-05` in `e2e/tests/settings-and-browser-apis.spec.ts`: open and close
  in a real browser. `A11Y-01` already runs axe on the lobby, so it checks the
  new button.

## Next

Let the player view the upgrade tree from the About dialog. That's a separate
PR, so `about-modal.ts` is its own module with a body that's easy to add to.
