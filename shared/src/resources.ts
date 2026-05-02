/**
 * Single source of truth for resource key → display icon.
 * Import {@link getResourceIcon} rather than hard-coding emoji literals.
 */
export const RESOURCE_ICONS: Readonly<Record<string, string>> = {
  currency: '💰',
  wood: '🪵',
  ale: '🍺',
}

/** Return the display icon for a resource key, falling back to the key itself. */
export function getResourceIcon(key: string): string {
  return RESOURCE_ICONS[key] ?? key
}
