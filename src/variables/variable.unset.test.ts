import { UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { Environment, EnvironmentUpdate } from '../environments/types';
import { VariableRemover } from './variable.unset';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };

function fakes(held: Environment, answer = true) {
  const printed: string[] = [];
  const order: string[] = [];
  const questions: string[] = [];
  const updates: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async () => undefined as never,
  };
  const services = {
    ux,
    isTTY: true,
    outputIsTTY: false,
    api: {
      environments: {
        get: async () => {
          order.push('get');
          return held;
        },
        update: async (params: { update: EnvironmentUpdate }) => {
          order.push('update');
          updates.push(params);
          return held;
        },
      },
    },
  } as unknown as ServiceContext;
  const confirm = async (question: string) => {
    order.push('confirm');
    questions.push(question);
    return answer;
  };

  return { printed, order, questions, updates, services, remover: new VariableRemover(services, confirm) };
}

const HELD: Environment = {
  name: 'staging',
  environmentVariables: [{ key: 'API_KEY', value: 'never-printed-value' }, { key: 'DEBUG', value: 'true' }],
};

describe('variable remover', () => {
  it('reads, confirms, then reads again and writes the rest, naming the key and the environment', async () => {
    const { remover, order, printed, updates, questions } = fakes(HELD);

    const removed = await remover.remove({ ...SCOPE, keys: ['API_KEY'] });

    expect(removed).toBe(true);
    expect(order).toEqual(['get', 'confirm', 'get', 'update']);
    expect(questions).toEqual(['Are you sure you want to remove API_KEY from "staging"?']);
    expect(updates).toEqual([{ ...SCOPE, update: { environmentVariables: [{ key: 'DEBUG', value: 'true' }] } }]);
    expect(printed).toEqual(['✔ API_KEY removed from staging.']);
  });

  it('names several keys together', async () => {
    const { remover, printed, questions } = fakes(HELD);

    await remover.remove({ ...SCOPE, keys: ['API_KEY', 'DEBUG'] });

    expect(questions).toEqual(['Are you sure you want to remove API_KEY, DEBUG from "staging"?']);
    expect(printed).toEqual(['✔ API_KEY, DEBUG removed from staging.']);
  });

  it('falls back to the environment reference when the environment carries no name', async () => {
    const { remover, printed, questions } = fakes({ environmentVariables: [{ key: 'A', value: '1' }] });

    await remover.remove({ ...SCOPE, keys: ['A'] });

    expect(questions).toEqual(['Are you sure you want to remove A from "env1"?']);
    expect(printed).toEqual(['✔ A removed from env1.']);
  });

  it('returns false and changes nothing when the user declines', async () => {
    const { remover, order, printed, updates } = fakes(HELD, false);

    const removed = await remover.remove({ ...SCOPE, keys: ['API_KEY'] });

    expect(removed).toBe(false);
    expect(order).toEqual(['get', 'confirm']);
    expect(updates).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('refuses a key that is not set before it asks anything and writes nothing', async () => {
    const { remover, order, updates } = fakes(HELD);

    await expect(remover.remove({ ...SCOPE, keys: ['API_KEY', 'MISSING'] })).rejects.toThrow(UsageError);
    await expect(remover.remove({ ...SCOPE, keys: ['MISSING'] })).rejects.toThrow('MISSING is not set in this environment.');
    expect(order).not.toContain('confirm');
    expect(updates).toEqual([]);
  });

  it('never puts a value in the question, the summary or an error', async () => {
    const { remover, printed, questions } = fakes(HELD);

    await remover.remove({ ...SCOPE, keys: ['API_KEY'] });

    expect(`${printed.join('\n')}${questions.join('\n')}`).not.toContain('never-printed-value');
  });

  it('propagates a failed read, a failed confirm and a failed write', async () => {
    const reading = new VariableRemover(
      { api: { environments: { get: async () => Promise.reject(new Error('get failed')) } } } as unknown as ServiceContext,
      async () => true,
    );

    await expect(reading.remove({ ...SCOPE, keys: ['A'] })).rejects.toThrow('get failed');

    const broken = new VariableRemover(fakes(HELD).services, async () => Promise.reject(new Error('prompt failed')));

    await expect(broken.remove({ ...SCOPE, keys: ['API_KEY'] })).rejects.toThrow('prompt failed');

    const writing = new VariableRemover(
      {
        ux: { print: () => undefined },
        outputIsTTY: false,
        api: { environments: { get: async () => HELD, update: async () => Promise.reject(new Error('update failed')) } },
      } as unknown as ServiceContext,
      async () => true,
    );

    await expect(writing.remove({ ...SCOPE, keys: ['API_KEY'] })).rejects.toThrow('update failed');
  });

  it('refuses before asking when the environment holds a variable it could not send back', async () => {
    const { remover, order, updates } = fakes({ name: 'staging', environmentVariables: [{ key: 'A', value: '1' }, { key: 'HIDDEN' }] });

    await expect(remover.remove({ ...SCOPE, keys: ['A'] })).rejects.toThrow(
      'This environment holds variables the API returned without a value (HIDDEN).',
    );
    expect(order).toEqual(['get']);
    expect(updates).toEqual([]);
  });
});
