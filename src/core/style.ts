const CODES = {
  bold: [1, 22],
  cyan: [36, 39],
  green: [32, 39],
} as const;

export type Style = keyof typeof CODES;

export function styled(text: string, style: Style, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  const [open, close] = CODES[style];

  return `\u001b[${open}m${text}\u001b[${close}m`;
}
