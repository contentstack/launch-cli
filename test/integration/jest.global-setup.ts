import { mkdtempSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEMP_PREFIXES = [
  'launch-cli-itest-run-',
  'launch-cli-itest-store-',
  'launch-cli-itest-project-',
  'launch-cli-itest-remote-',
];
const STALE_AFTER_MS = 60 * 60 * 1000;

const sweepStaleTempDirs = (): void => {
  const now = Date.now();
  for (const entry of readdirSync(tmpdir())) {
    if (!TEMP_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
    const path = join(tmpdir(), entry);
    try {
      if (now - statSync(path).mtimeMs > STALE_AFTER_MS) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      continue;
    }
  }
};

export default async function globalSetup(): Promise<void> {
  sweepStaleTempDirs();
  process.env.LAUNCH_CLI_ITEST_RUN_DIR = mkdtempSync(join(tmpdir(), 'launch-cli-itest-run-'));
}
