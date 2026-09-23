import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  oclif: {
    topics?: Record<string, { description?: string }>;
    commands: string;
    topicSeparator: string;
  };
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
});
