import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  oclif: {
    topics?: Record<string, { description?: string }>;
    plugins?: string[];
    commands: string;
    topicSeparator: string;
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  csdxConfig: { shortCommandName: Record<string, string> };
}

function commandIdsUnder(directory: string, prefix: string[]): string[] {
  return readdirSync(join(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return commandIdsUnder(join(directory, entry.name), [...prefix, entry.name]);
    }

    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }

    const base = entry.name.replace(/\.ts$/, '');
    return [(base === 'index' ? prefix : [...prefix, base]).join(':')];
  });
}

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as Manifest;

describe('integration: the oclif manifest in package.json', () => {
  it('describes the launch topic itself rather than letting a leaf command describe it', () => {
    expect(manifest.oclif.topics?.launch?.description).toBe('Manage Contentstack Launch projects and cloud functions');
  });

  it('describes the launch:projects and launch:functions subtopics', () => {
    expect(manifest.oclif.topics?.['launch:projects']?.description).toBe('Manage Launch projects');
    expect(manifest.oclif.topics?.['launch:functions']?.description).toBe('Run Launch cloud functions locally');
  });

  it('declares a description for every topic it declares', () => {
    const topics = manifest.oclif.topics ?? {};

    expect(Object.keys(topics).length).toBeGreaterThan(0);
    for (const [name, topic] of Object.entries(topics)) {
      expect(typeof topic.description).toBe('string');
      expect(topic.description).not.toBe('');
      expect(name).toMatch(/^launch(:[a-z-]+)*$/);
    }
  });

  it('names every declared oclif plugin in a dependency list, so a clean install can load it', () => {
    const declared = manifest.oclif.plugins ?? [];
    const installable = { ...manifest.dependencies, ...manifest.devDependencies };

    expect(declared.length).toBeGreaterThan(0);
    for (const plugin of declared) {
      expect(Object.keys(installable)).toContain(plugin);
    }
  });

  it('gives every command the CLI registers a short analytics name and invents none', () => {
    const commands = commandIdsUnder(join('src', 'commands'), []).sort();

    expect(commands).toContain('launch:projects:list');
    expect(commands).toContain('launch:functions:serve');
    expect(Object.keys(manifest.csdxConfig.shortCommandName).sort()).toEqual(commands);
  });
});
