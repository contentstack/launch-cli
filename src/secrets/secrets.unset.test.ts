import type { ServiceContext } from '../core/service-context';
import { LaunchApiError } from '../transport/errors';
import { SecretRemover } from './secrets.unset';

const REQUEST = { org: 'org1', project: 'proj1', environment: 'env1', keys: ['API_TOKEN'] };
const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

interface Harness {
  confirmed?: boolean;
  failOn?: string;
  failure?: Error;
}

function removerUnderTest(harness: Harness = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const questions: string[] = [];
  const deleted: unknown[][] = [];
  const services = {
    outputIsTTY: false,
    ux: {
      print: (line: string) => {
        calls.push('print');
        lines.push(line);
      },
    },
    api: {
      secrets: {
        delete: async (...args: unknown[]) => {
          calls.push(`delete ${String(args[1])}`);
          deleted.push(args);

          if (args[1] === harness.failOn) {
            throw harness.failure;
          }
        },
      },
    },
  } as unknown as ServiceContext;
  const confirm = async (question: string) => {
    calls.push('confirm');
    questions.push(question);
    return harness.confirmed ?? true;
  };

  return { remover: new SecretRemover(services, confirm), calls, lines, questions, deleted };
}

describe('SecretRemover', () => {
  it('confirms once before the first delete, deletes each key in order and prints one line per key', async () => {
    const { remover, calls, lines, questions, deleted } = removerUnderTest();

    const removed = await remover.remove({ ...REQUEST, keys: ['API_TOKEN', 'DB_URL'] });

    expect(removed).toBe(true);
    expect(questions).toEqual(['Remove the secrets API_TOKEN, DB_URL from this environment? This cannot be undone.']);
    expect(deleted).toEqual([
      [SCOPE, 'API_TOKEN'],
      [SCOPE, 'DB_URL'],
    ]);
    expect(calls).toEqual(['confirm', 'delete API_TOKEN', 'print', 'delete DB_URL', 'print']);
    expect(lines).toEqual(['✔ Secret API_TOKEN removed.', '✔ Secret DB_URL removed.']);
  });

  it('sends nothing and prints nothing when the confirmation is declined', async () => {
    const { remover, calls, lines, deleted } = removerUnderTest({ confirmed: false });

    const removed = await remover.remove(REQUEST);

    expect(removed).toBe(false);
    expect(calls).toEqual(['confirm']);
    expect(deleted).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('words the question for a single key in the singular', async () => {
    const { remover, questions } = removerUnderTest();

    await remover.remove(REQUEST);

    expect(questions).toEqual(['Remove the secret API_TOKEN from this environment? This cannot be undone.']);
  });

  it('deletes a key given twice once', async () => {
    const { remover, deleted, questions } = removerUnderTest();

    await remover.remove({ ...REQUEST, keys: ['API_TOKEN', 'DB_URL', 'API_TOKEN'] });

    expect(deleted).toEqual([
      [SCOPE, 'API_TOKEN'],
      [SCOPE, 'DB_URL'],
    ]);
    expect(questions).toEqual(['Remove the secrets API_TOKEN, DB_URL from this environment? This cannot be undone.']);
  });

  it('stops at the first failure, keeps the lines for the keys already removed and attempts no later key', async () => {
    const failure = new LaunchApiError(404, [{ code: 'x' }]);
    const { remover, calls, lines } = removerUnderTest({ failOn: 'B', failure });

    const thrown = await remover.remove({ ...REQUEST, keys: ['A', 'B', 'C'] }).catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(calls).toEqual(['confirm', 'delete A', 'print', 'delete B']);
    expect(lines).toEqual(['✔ Secret A removed.']);
  });
});
