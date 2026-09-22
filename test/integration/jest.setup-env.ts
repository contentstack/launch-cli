import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const STORE_PREFIX = 'launch-cli-itest-store-';

process.env.CS_CLI_CONFIG_PATH = mkdtempSync(join(process.env.LAUNCH_CLI_ITEST_RUN_DIR ?? tmpdir(), STORE_PREFIX));
process.env.CONFIG_NAME = 'launch_cli_integration_test';
process.env.ENC_CONFIG_NAME = 'launch_cli_integration_test_obfuscate';
process.env.ENCRYPT_CONF = 'false';
