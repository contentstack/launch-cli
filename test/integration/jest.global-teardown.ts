import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, resolve } from 'path';

const RUN_DIR_PREFIX = 'launch-cli-itest-run-';

export default async function globalTeardown(): Promise<void> {
  const runDir = process.env.LAUNCH_CLI_ITEST_RUN_DIR;
  if (!runDir) return;

  const target = resolve(runDir);
  const isDirectChildOfTmp = dirname(target) === resolve(tmpdir());
  const hasExpectedName = basename(target).startsWith(RUN_DIR_PREFIX);

  if (isDirectChildOfTmp && hasExpectedName) {
    rmSync(target, { recursive: true, force: true });
  }
}
