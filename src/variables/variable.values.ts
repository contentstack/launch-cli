import { UsageError } from '../core/errors';
import { askSecret } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentVariableInput } from '../environments/types';
import type { Assignment } from './variable.parse';

export interface ValueDeps {
  services: ServiceContext;
  readStdin(): Promise<string>;
}

function promptMessage(key: string, position: number, total: number): string {
  return total > 1 ? `Value for ${key} (${position}/${total})` : `Value for ${key}`;
}

async function valueFromStdin(key: string, readStdin: () => Promise<string>): Promise<string> {
  const value = (await readStdin()).replace(/\r?\n$/, '');

  if (value.trim() === '') {
    throw new UsageError(`No value for ${key} was piped in.`);
  }

  return value;
}

export async function completeValues(
  assignments: Assignment[],
  deps: ValueDeps,
): Promise<EnvironmentVariableInput[]> {
  const bare = assignments.filter((assignment) => assignment.value === undefined);

  if (bare.length > 1 && !deps.services.isTTY) {
    throw new UsageError(
      `${bare.length} variables have no value and there is no terminal to ask on. ` +
        'Pass --dotenv - and pipe KEY=VALUE lines instead.',
    );
  }

  const completed: EnvironmentVariableInput[] = [];
  let asked = 0;

  for (const { key, value } of assignments) {
    if (value !== undefined) {
      completed.push({ key, value });
      continue;
    }

    asked += 1;
    const answer = deps.services.isTTY
      ? await askSecret(deps.services.ux, promptMessage(key, asked, bare.length))
      : await valueFromStdin(key, deps.readStdin);

    completed.push({ key, value: answer });
  }

  return completed;
}
