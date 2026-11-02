import { UsageError } from './errors';

const PASSWORD_SWITCHES = ['-p', '--password'];

export const PASSWORD_ON_ARGV =
  '--password takes no value. Enter the password at the hidden prompt, or pipe it on standard input.';

export function refusePasswordOnArgv(argv: readonly string[]): void {
  if (argv.some((arg, index) => carriesPassword(arg, argv[index + 1]))) {
    throw new UsageError(PASSWORD_ON_ARGV);
  }
}

function carriesPassword(arg: string, next: string | undefined): boolean {
  if (PASSWORD_SWITCHES.includes(arg)) {
    return next !== undefined && !next.startsWith('-');
  }

  return arg.startsWith('--password=') || arg.startsWith('-p');
}
