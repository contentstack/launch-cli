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

// Git exports these to hooks, and the pre-push hook runs this suite. Left set, every git call the harness
// and the CLI make in the temp projects would act on this repository instead (from `git rev-parse
// --local-env-vars`). Cleared here, in the parent process, so child processes inherit the clean env.
const GIT_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

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
  for (const name of GIT_LOCAL_ENV_VARS) delete process.env[name];
  sweepStaleTempDirs();
  process.env.LAUNCH_CLI_ITEST_RUN_DIR = mkdtempSync(join(tmpdir(), 'launch-cli-itest-run-'));
}
