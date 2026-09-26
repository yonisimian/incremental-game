/**
 * Tiny DOM builders shared by the editor's form-based sections. Building nodes
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

/** A label + control row (`.ed-field`). */
export function field(label: string, control: HTMLElement): HTMLDivElement {
  const row = el('div', 'ed-field')
  row.append(el('label', 'ed-field-label', label), control)
  return row
}

/** A label + control pair, stacked vertically (`.ed-gen-field`). */
export function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'ed-gen-field')
  wrap.append(el('span', 'ed-gen-field-label', label), control)
  return wrap
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
