/**
 * Tiny DOM builders shared by the editor's form-based sections (resources,
 * generators). Mirrors the private helpers in `inspector.ts`; building nodes
 * programmatically (rather than `innerHTML` with interpolated values) keeps
 * user-entered names/icons from being interpreted as markup.
 */

/** Create an element with an optional class and text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A labelled `<input>` of the given type, pre-filled with `value`. */
export function labeledInput(
  type: string,
  value: string,
  className = 'ed-input',
): HTMLInputElement {
  const input = el('input', className)
  input.type = type
  input.value = value
  return input
}
