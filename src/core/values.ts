import { stripVTControlCharacters } from 'node:util';

import { UsageError } from './errors';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LAST_C0_CONTROL = 0x1f;
const FIRST_DELETE_OR_C1_CONTROL = 0x7f;
const LAST_C1_CONTROL = 0x9f;

function isControl(unit: string): boolean {
  const code = unit.charCodeAt(0);

  return code <= LAST_C0_CONTROL || (code >= FIRST_DELETE_OR_C1_CONTROL && code <= LAST_C1_CONTROL);
}

export function withoutControlCharacters(value: string): string {
  let text = '';
  let inRun = false;

  for (const unit of stripVTControlCharacters(value)) {
    if (isControl(unit)) {
      text += inRun ? '' : ' ';
      inRun = true;
    } else {
      text += unit;
      inRun = false;
    }
  }

  return text;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function asSentence(text: string): string {
  const trimmed = text.trim();

  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

export function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === 'string' && value.trim() === '';
}

export async function withinLength(flag: string, value: string, max: number): Promise<string> {
  const trimmed = value.trim();

  if (trimmed.length > max) {
    throw new UsageError(`--${flag} must be ${max} characters or fewer; that value is ${trimmed.length} characters.`);
  }

  return trimmed;
}

export function oneOf<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
  const wanted = value.trim().toLowerCase();
  const match = allowed.find((option) => option.toLowerCase() === wanted);

  if (match === undefined) {
    throw new UsageError(`--${flag} must be one of ${allowed.join(', ')}; "${value}" is not.`);
  }

  return match;
}
