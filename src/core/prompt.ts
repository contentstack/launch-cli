import type { ApiSurface } from '../resources';
import { CancelledError } from './errors';

export interface UxLike {
  print(message: string): void;
  inquire<T>(payload: unknown): Promise<T>;
}

export interface PromptDeps {
  api: ApiSurface;
  ux: UxLike;
}

export interface Choice {
  name: string;
  value: string;
}

export function answered(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    throw new CancelledError();
  }

  return String(value);
}

export function checkLength(label: string, value: string, max: number): true | string {
  const length = value.trim().length;

  return length > max ? `${label} must be ${max} characters or fewer; that value is ${length} characters.` : true;
}

/**
 * A `max` is checked inside the prompt, the way projects:update checks its fields, so a value that is
 * too long is answered again on the spot rather than failing the command after the upload.
 */
export async function askText(ux: UxLike, message: string, initial?: string, max?: number): Promise<string> {
  const validate = (value: string): true | string => {
    if (value.trim() === '') {
      return `${message} can't be empty.`;
    }

    return max === undefined ? true : checkLength(message, value, max);
  };

  return answered(
    await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial, validate }),
  ).trim();
}

export async function askOptionalText(ux: UxLike, message: string, initial?: string): Promise<string | undefined> {
  const answer = await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, default: initial });
  const text = typeof answer === 'string' ? answer.trim() : '';

  return text === '' ? undefined : text;
}

export async function askOption(ux: UxLike, message: string, choices: Choice[], initial?: string): Promise<string> {
  return answered(
    await ux.inquire<string | undefined>({ type: 'list', name: 'value', message, choices, default: initial }),
  );
}

export function noteTruncation(ux: UxLike, count: number | undefined, shown: number, noun: string, flag: string): void {
  if (typeof count === 'number' && count > shown) {
    ux.print(`Showing the first ${shown} of ${count} ${noun}. Use ${flag} to reach any of them.`);
  }
}
