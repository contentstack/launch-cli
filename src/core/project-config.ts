import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { UsageError } from './errors';

export interface ProjectEnvironment {
  uid?: string;
  name?: string;
}

export interface ProjectConfig {
  uid?: string | null;
  organizationUid?: string | null;
  name?: string | null;
  environments?: ProjectEnvironment[] | null;
}

export type ProjectConfigKey = keyof ProjectConfig;

export const DEFAULT_BLOCK_KEY = 'project';

type Blocks = Record<string, unknown>;

function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identityOf(block: unknown): string | undefined {
  if (!isBlock(block)) {
    return undefined;
  }

  return `${String(block.organizationUid)}/${String(block.uid)}`;
}

function disagreement(entries: [string, unknown][]): UsageError {
  return new UsageError(
    `The project config holds branch blocks that do not agree on one project: ${entries
      .map(([branch]) => branch)
      .join(', ')}. Pass --org and --project explicitly.`,
  );
}

function agreedBlock(entries: [string, unknown][]): Record<string, unknown> {
  const identities = new Set(entries.map(([, block]) => identityOf(block)));

  if (identities.size === 1 && !identities.has(undefined)) {
    return entries[0][1] as Record<string, unknown>;
  }

  throw disagreement(entries);
}

export class ProjectConfigStore {
  constructor(
    readonly path: string,
    private readonly required = false,
  ) {}

  load(): ProjectConfig {
    const entries = Object.entries(this.blocks());

    if (entries.length > 1) {
      return agreedBlock(entries) as ProjectConfig;
    }

    if (entries.length === 1 && isBlock(entries[0][1])) {
      return entries[0][1] as ProjectConfig;
    }

    return {};
  }

  save(config: ProjectConfig): void {
    const blocks = this.blocks();
    const entries = Object.entries(blocks);

    if (entries.length > 1) {
      agreedBlock(entries);
    }

    this.refuseOtherProject(entries, config);

    const next: Blocks = {};

    if (entries.length === 0) {
      next[DEFAULT_BLOCK_KEY] = config;
    } else {
      for (const [branch, block] of entries) {
        next[branch] = { ...(isBlock(block) ? block : {}), ...config };
      }
    }

    writeFileSync(this.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  private refuseOtherProject(entries: [string, unknown][], config: ProjectConfig): void {
    if (typeof config.uid !== 'string') {
      return;
    }

    for (const [, block] of entries) {
      const existing = isBlock(block) ? block.uid : undefined;

      if (typeof existing === 'string' && existing !== config.uid) {
        throw new UsageError(
          `The config file at '${this.path}' already names project ${existing}. ` +
            'Delete it or pass --config with another path.',
        );
      }
    }
  }

  private unusable(reason: string): Blocks {
    if (this.required) {
      throw new UsageError(reason);
    }

    return {};
  }

  private blocks(): Blocks {
    if (!existsSync(this.path)) {
      return this.unusable(`No config file found at '${this.path}'. Pass --config with a path that exists.`);
    }

    let contents: string;

    try {
      contents = readFileSync(this.path, 'utf8');
    } catch {
      return this.unusable(`Could not read the config file at '${this.path}'.`);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(contents);
    } catch {
      return this.unusable(`The config file at '${this.path}' is not valid JSON.`);
    }

    return isBlock(parsed)
      ? parsed
      : this.unusable(`The config file at '${this.path}' does not hold a project config.`);
  }
}
