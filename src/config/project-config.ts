import { existsSync, readFileSync } from 'node:fs';

export function readProjectConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    const blocks = Object.values(parsed as Record<string, unknown>);
    return blocks.length === 1 ? (blocks[0] as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    return current === undefined || current === null ? undefined : (current as Record<string, unknown>)[segment];
  }, source);
}
