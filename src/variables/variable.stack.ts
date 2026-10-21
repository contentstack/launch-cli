import { configHandler } from '@contentstack/cli-utilities';

import { UsageError } from '../core/errors';
import { askOption } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { isRecord } from '../core/values';
import type { EnvironmentVariableInput } from '../environments/types';

export interface SavedToken {
  token: string;
  apiKey: string;
  environment?: string;
  type?: string;
}

export interface StackImportRequest {
  org: string;
  alias?: string;
}

export interface StackImportDeps {
  services: ServiceContext;
  savedToken: (alias: string) => SavedToken | undefined;
}

export type StackImporter = (alias?: string) => Promise<EnvironmentVariableInput[]>;

interface Credentials {
  apiKey: string;
  token: string;
  environment: string;
  notice: string;
}

const TEMPLATE_HOST_KEYS = ['CONTENTSTACK_API_HOST', 'CONTENTSTACK_CDN'];

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function readSavedToken(alias: string): SavedToken | undefined {
  const saved: unknown = configHandler.get('tokens');
  const held = isRecord(saved) && Object.prototype.hasOwnProperty.call(saved, alias);
  const entry: unknown = held ? saved[alias] : undefined;

  if (!isRecord(entry)) {
    return undefined;
  }

  const token = textOf(entry.token);
  const apiKey = textOf(entry.apiKey);

  if (token === undefined || apiKey === undefined) {
    return undefined;
  }

  return { token, apiKey, environment: textOf(entry.environment), type: textOf(entry.type) };
}

function hostOf(value: string): string {
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function fromSavedToken(alias: string, deps: StackImportDeps): Credentials {
  const saved = deps.savedToken(alias);

  if (saved === undefined) {
    throw new UsageError(
      `No delivery token is saved as "${alias}". Save one with csdx auth:tokens:add --alias ${alias} --delivery.`,
    );
  }

  if (saved.type === 'management') {
    throw new UsageError(`"${alias}" is a management token. --from-stack needs a delivery token.`);
  }

  if (saved.environment === undefined) {
    throw new UsageError(
      `The saved delivery token "${alias}" has no environment. ` +
        `Save it again with csdx auth:tokens:add --alias ${alias} --delivery --environment <name>.`,
    );
  }

  return {
    apiKey: saved.apiKey,
    token: saved.token,
    environment: saved.environment,
    notice: `Using the saved delivery token "${alias}" (environment ${saved.environment}).`,
  };
}

function chosenAt<T>(entries: T[], answer: string, what: string): T {
  const entry = entries[Number(answer)];

  if (entry === undefined) {
    throw new UsageError(`That ${what} is not one of the choices.`);
  }

  return entry;
}

async function fromPickers(org: string, deps: StackImportDeps): Promise<Credentials> {
  const { ux, api } = deps.services;
  const stacks = await api.stacks.list(org);

  if (stacks.length === 0) {
    throw new UsageError('No stacks were found in this organization, or you have no access to any.');
  }

  const stack = chosenAt(
    stacks,
    await askOption(
      ux,
      'Stack',
      stacks.map((entry, index) => ({ name: entry.name, value: String(index) })),
    ),
    'stack',
  );
  const tokens = await api.stacks.deliveryTokens(stack.apiKey);

  if (tokens.length === 0) {
    throw new UsageError(`Stack "${stack.name}" has no delivery tokens. Create one in the stack, or pass --alias.`);
  }

  const chosen = chosenAt(
    tokens,
    await askOption(
      ux,
      'Delivery token',
      tokens.map((entry, index) => ({
        name: entry.environment === undefined ? entry.name : `${entry.name} (${entry.environment})`,
        value: String(index),
      })),
    ),
    'delivery token',
  );

  if (chosen.environment === undefined) {
    throw new UsageError(
      `The delivery token "${chosen.name}" is not scoped to an environment. ` +
        'Scope it in the stack, or save one with an environment using csdx auth:tokens:add.',
    );
  }

  return {
    apiKey: stack.apiKey,
    token: chosen.token,
    environment: chosen.environment,
    notice: `Using delivery token "${chosen.name}" of stack "${stack.name}" (environment ${chosen.environment}).`,
  };
}

async function credentialsOf(request: StackImportRequest, deps: StackImportDeps): Promise<Credentials> {
  if (request.alias !== undefined) {
    return fromSavedToken(request.alias, deps);
  }

  if (!deps.services.isTTY) {
    throw new UsageError("--from-stack requires --alias when there's no TTY.");
  }

  return fromPickers(request.org, deps);
}

export async function importFromStack(
  request: StackImportRequest,
  deps: StackImportDeps,
): Promise<EnvironmentVariableInput[]> {
  const credentials = await credentialsOf(request, deps);
  const template = await deps.services.api.variables.stackTemplate(request.org);
  const shared = TEMPLATE_HOST_KEYS.flatMap((key) => {
    const value = template.find((entry) => entry.key === key)?.value;

    return value === undefined ? [] : [{ key, value: hostOf(value) }];
  });

  deps.services.ux.print(credentials.notice);

  const missingHosts = TEMPLATE_HOST_KEYS.filter((key) => !shared.some((entry) => entry.key === key));

  if (missingHosts.length > 0) {
    deps.services.ux.print(`No value was available for ${missingHosts.join(', ')}, so it was not imported.`);
  }

  return [
    ...shared,
    { key: 'CONTENTSTACK_API_KEY', value: credentials.apiKey },
    { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: credentials.token },
    { key: 'CONTENTSTACK_ENVIRONMENT', value: credentials.environment },
  ];
}
