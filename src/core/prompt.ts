import type { ApiSurface } from '../resources';
import { CancelledError, MissingInputError } from './errors';
import type { ServiceContext } from './service-context';

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

export async function askSecret(ux: UxLike, message: string): Promise<string> {
  const validate = (value: string): true | string => (value.trim() === '' ? `${message} can't be empty.` : true);

  return answered(
    await ux.inquire<string | undefined>({ type: 'password', name: 'value', message, mask: '*', validate }),
  );
}

export async function askOptionalText(
  ux: UxLike,
  message: string,
  initial?: string,
  max?: number,
): Promise<string | undefined> {
  const limit = max === undefined ? {} : { validate: (value: string) => checkLength(message, value, max) };
  const answer = await ux.inquire<string | undefined>({
    type: 'input',
    name: 'value',
    message,
    default: initial,
    ...limit,
  });
  const text = typeof answer === 'string' ? answer.trim() : '';

  return text === '' ? undefined : text;
}

export const PROMPT_PAGE_SIZE = 15;

function scrolling(choices: Choice[]): { loop: false; pageSize: number } {
  return { loop: false, pageSize: Math.min(choices.length, PROMPT_PAGE_SIZE) };
}

export async function askOption(ux: UxLike, message: string, choices: Choice[], initial?: string): Promise<string> {
  return answered(
    await ux.inquire<string | undefined>({
      type: 'list',
      name: 'value',
      message,
      choices,
      default: initial,
      ...scrolling(choices),
    }),
  );
}

export async function askChoices(
  ux: UxLike,
  message: string,
  choices: Choice[],
  options: { requireOne?: boolean } = {},
): Promise<string[]> {
  const validate = (picked: unknown): true | string =>
    options.requireOne === false || (Array.isArray(picked) && picked.length > 0)
      ? true
      : 'Select at least one with <space>, then press <enter>.';
  const answer = await ux.inquire<unknown>({
    type: 'checkbox',
    name: 'value',
    message,
    choices,
    ...scrolling(choices),
    validate,
  });

  return Array.isArray(answer) ? answer.map(String) : [];
}

export function noteTruncation(ux: UxLike, count: number | undefined, shown: number, noun: string, flag: string): void {
  if (typeof count === 'number' && count > shown) {
    ux.print(`Showing the first ${shown} of ${count} ${noun}. Use ${flag} to reach any of them.`);
  }
}

export const CREATE_PROMPT_REMEDIES = { config: false, prompt: true };

export async function needInput<T extends string | undefined>(
  services: ServiceContext,
  flag: string,
  supplied: string | undefined,
  ask: () => Promise<T>,
): Promise<string | T> {
  if (supplied !== undefined) {
    return supplied;
  }

  if (!services.isTTY) {
    throw new MissingInputError(flag, CREATE_PROMPT_REMEDIES);
  }

  return ask();
}
