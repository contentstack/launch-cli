import { existsSync, readFileSync } from 'node:fs';

import { UsageError } from '../errors';

function identityOf(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) {
    return undefined;
  }

  const record = block as Record<string, unknown>;

  return `${String(record.organizationUid)}/${String(record.uid)}`;
}

function sharedBlock(entries: [string, unknown][]): Record<string, unknown> {
  const identities = new Set(entries.map(([, block]) => identityOf(block)));

  if (identities.size === 1 && !identities.has(undefined)) {
    return entries[0][1] as Record<string, unknown>;
  }

  throw new UsageError(
    `The project config holds branch blocks that do not agree on one project: ${entries
      .map(([branch]) => branch)
      .join(', ')}. Pass --org and --project explicitly.`,
  );
}

export function readProjectConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }

  const entries = Object.entries(parsed as Record<string, unknown>);

  if (entries.length > 1) {
    return sharedBlock(entries);
  }

  return entries.length === 1 ? (entries[0][1] as Record<string, unknown>) : {};
}

export function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    return current === undefined || current === null ? undefined : (current as Record<string, unknown>)[segment];
  }, source);
}
