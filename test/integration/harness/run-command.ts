import { format } from 'util';

import { Config } from '@oclif/core';
import { Command } from '@contentstack/cli-command';

const ANSI_PATTERN = new RegExp(
  ['[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:\\w+;)*\\w*)?\\u0007', '[0-?]*[ -/]*[@-~])'].join('|'),
  'g',
);

export type CommandResult = {
  output: string;
  exitCode: number;
  error?: Error;
};

class ProcessExit extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

let cachedConfig: Config | undefined;
let inFlight = false;

const loadConfig = async (): Promise<Config> => {
  if (!cachedConfig) {
    cachedConfig = await Config.load(process.cwd());
  }
  return cachedConfig;
};

export async function runCommand(
  CommandClass: typeof Command & { run: (argv: string[], config?: Config) => Promise<any> },
  argv: string[],
): Promise<CommandResult> {
  if (inFlight) {
    throw new Error(
      'runCommand() is not re-entrant: it patches console, process.stdout/stderr and process.exit ' +
        'globally, so two concurrent calls would corrupt each other. Await each call before the next.',
    );
  }
  inFlight = true;

  const chunks: string[] = [];
  const capture = (chunk: any, encoding?: any, callback?: any): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };

  const consoleLevels = ['log', 'info', 'warn', 'error', 'debug'] as const;

  const consoleSinks = console as unknown as { _stdout?: unknown; _stderr?: unknown };

  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalExit = process.exit;
  const originalConsoleMethods = new Map(consoleLevels.map((level) => [level, console[level]]));
  const originalConsoleSinks = { stdout: consoleSinks._stdout, stderr: consoleSinks._stderr };

  const originalColumns = process.stdout.columns;
  process.stdout.columns = 200;

  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  process.exit = ((code?: number) => {
    throw new ProcessExit(code ?? 0);
  }) as typeof process.exit;
  for (const level of consoleLevels) {
    console[level] = (...args: any[]) => capture(`${format(...args)}\n`);
  }
  consoleSinks._stdout = { write: capture };
  consoleSinks._stderr = { write: capture };

  let exitCode = 0;
  let error: Error | undefined;

  try {
    await CommandClass.run(argv, await loadConfig());
  } catch (thrown: any) {
    if (thrown instanceof ProcessExit) {
      exitCode = thrown.code;
    } else if (thrown?.code === 'EEXIT') {
      exitCode = thrown.oclif?.exit ?? 0;
    } else {
      exitCode = thrown?.oclif?.exit ?? 1;
      error = thrown;
      capture(`${thrown?.message ?? String(thrown)}\n`);
    }
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exit = originalExit;
    for (const [level, method] of originalConsoleMethods) {
      console[level] = method;
    }
    consoleSinks._stdout = originalConsoleSinks.stdout;
    consoleSinks._stderr = originalConsoleSinks.stderr;
    process.stdout.columns = originalColumns;
    inFlight = false;
  }

  return { output: chunks.join('').replace(ANSI_PATTERN, ''), exitCode, error };
}
