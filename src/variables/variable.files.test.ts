import { UsageError } from '../core/errors';
import { detectEnvFile, readEnvFiles } from './variable.files';

function deps(files: Record<string, string>, stdin = '') {
  const read: string[] = [];
  const stdinReads: number[] = [];

  return {
    read,
    stdinReads,
    reader: {
      readFile: async (path: string) => {
        read.push(path);

        if (!(path in files)) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        }

        return files[path];
      },
      readStdin: async () => {
        stdinReads.push(1);
        return stdin;
      },
    },
  };
}

describe('variable files', () => {
  it('reads each named file as one source labelled with the path it was given', async () => {
    const { reader, read } = deps({ '.env': 'A=1', 'prod.env': 'B=2\nEMPTY=' });

    const sources = await readEnvFiles(['.env', 'prod.env'], reader);

    expect(read).toEqual(['.env', 'prod.env']);
    expect(sources).toEqual([
      { label: '.env', variables: [{ key: 'A', value: '1' }], skipped: [] },
      { label: 'prod.env', variables: [{ key: 'B', value: '2' }], skipped: ['EMPTY'] },
    ]);
  });

  it('reads dotenv content from stdin for a dash, labelled standard input, without touching the file system', async () => {
    const { reader, read, stdinReads } = deps({}, 'A=1\nB=2');

    const sources = await readEnvFiles(['-'], reader);

    expect(read).toEqual([]);
    expect(stdinReads).toHaveLength(1);
    expect(sources).toEqual([
      { label: 'standard input', variables: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }], skipped: [] },
    ]);
  });

  it('refuses a dash given twice, since stdin can only be read once', async () => {
    const { reader, stdinReads } = deps({}, 'A=1');

    await expect(readEnvFiles(['-', '-'], reader)).rejects.toThrow(UsageError);
    await expect(readEnvFiles(['-', '-'], reader)).rejects.toThrow('--dotenv - can be given only once.');
    expect(stdinReads).toEqual([]);
  });

  it('names the path of a file that does not exist as a usage error', async () => {
    const { reader } = deps({});

    await expect(readEnvFiles(['missing.env'], reader)).rejects.toThrow(UsageError);
    await expect(readEnvFiles(['missing.env'], reader)).rejects.toThrow('--dotenv missing.env was not found.');
  });

  it('lets any other read failure propagate unchanged', async () => {
    const failure = Object.assign(new Error('EACCES'), { code: 'EACCES' });

    await expect(
      readEnvFiles(['.env'], { readFile: async () => Promise.reject(failure), readStdin: async () => '' }),
    ).rejects.toBe(failure);
  });

  it('propagates a stdin failure', async () => {
    const failure = new Error('stdin closed');

    await expect(
      readEnvFiles(['-'], { readFile: async () => '', readStdin: async () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
  });

  it('returns no sources for no paths', async () => {
    expect(await readEnvFiles([], deps({}).reader)).toEqual([]);
  });

  it('detects .env.local before .env under the data directory', () => {
    const asked: string[] = [];
    const exists = (path: string) => {
      asked.push(path);
      return true;
    };

    expect(detectEnvFile('/work', exists)).toBe('/work/.env.local');
    expect(asked).toEqual(['/work/.env.local']);
  });

  it('falls back to .env when there is no .env.local', () => {
    expect(detectEnvFile('/work', (path) => path === '/work/.env')).toBe('/work/.env');
  });

  it('finds nothing when neither file is there', () => {
    expect(detectEnvFile('/work', () => false)).toBeUndefined();
  });
});
