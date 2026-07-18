/**
 * Editor section contract. The editor shell ([../index.ts](../index.ts)) owns a
 * single `TreeFile` working copy and the file-level toolbar; each section
 * (resources / generators / upgrade tree) is an {@link EditorView} the shell
 * mounts lazily and tears down on switch. Mirrors the game's `Panel` contract.
 */

import type { BalanceFile, TreeFile } from '@game/shared'

/** What a mounted section can see and do, handed to it by the shell. */
export interface EditorContext {
  /**
   * The shared mutable working copy. Stable for the lifetime of a single
   * `mount` — the shell re-mounts the active view when it replaces the tree
   * (import/reset), so a view never observes its `tree` reference swapped out.
   */
  readonly tree: TreeFile
  /**
   * The mutable balance-sidecar working copy (envelopes). Separate from `tree`
   * because envelopes are dev/CI metadata that ship in `shared/balance/*.json`,
   * not in the tree. Only the Envelopes section reads/writes it. Stable for the
   * lifetime of a `mount` (the shell re-mounts on reset).
   */
  readonly balance: BalanceFile
  /** Flag the tree document as having unsaved changes. */
  markDirty(): void
  /** Flag the balance-sidecar document as having unsaved changes. */
  markBalanceDirty(): void
  /** Set the shell's status line (errors render distinctly). */
  setStatus(text: string, isError?: boolean): void
  /** Re-render the active view in place (after a self-mutation it displays). */
  requestRefresh(): void
}

/** One editor section. Mounted into a host element, torn down on switch. */
export interface EditorView {
  /** Build the section's DOM into `host` and wire its listeners. */
  mount(host: HTMLElement, ctx: EditorContext): void
  /** Re-render in place; called via `ctx.requestRefresh()`. Optional. */
  refresh?(): void
  /** Remove listeners + transient state (the shell empties the host after). */
  unmount(): void
}
