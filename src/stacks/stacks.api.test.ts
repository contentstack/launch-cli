import { randomUUID } from 'node:crypto';
import { EXIT_RUNTIME } from '../core/constants';
import type { CmaCollection, CmaSession } from '../transport/cma-client';
import { StackLookupError } from './stack.errors';
import { StacksApi } from './stacks.api';

const TOKEN_A = `cs-${randomUUID()}`;
const TOKEN_B = `cs-${randomUUID()}`;
const TOKEN_C = `cs-${randomUUID()}`;

function session(stacks: CmaCollection | Error, tokens: CmaCollection | Error) {
  const asked: { stacks: string[]; tokens: string[] } = { stacks: [], tokens: [] };
  const cma = {
    fetchStacks: async (organizationUid: string) => {
      asked.stacks.push(organizationUid);

      if (stacks instanceof Error) {
        throw stacks;
      }

      return stacks;
    },
    fetchDeliveryTokens: async (apiKey: string) => {
      asked.tokens.push(apiKey);

      if (tokens instanceof Error) {
        throw tokens;
      }

      return tokens;
    },
  } as unknown as CmaSession;

  return { api: new StacksApi(cma), asked };
}

describe('stacks api', () => {
  it('lists the stacks of an organization by name and api key', async () => {
    const { api, asked } = session({ items: [{ name: 'Shop', api_key: 'blt1' }, { name: 'Blog', api_key: 'blt2' }] }, {});

    await expect(api.list('org7')).resolves.toEqual([
      { name: 'Shop', apiKey: 'blt1' },
      { name: 'Blog', apiKey: 'blt2' },
    ]);
    expect(asked.stacks).toEqual(['org7']);
  });

  it('leaves out a stack the Management API says belongs to another organization', async () => {
    const { api } = session(
      {
        items: [
          { name: 'Shop', api_key: 'blt1', org_uid: 'org7' },
          { name: 'Elsewhere', api_key: 'blt2', org_uid: 'org9' },
          { name: 'Unmarked', api_key: 'blt3' },
        ],
      },
      {},
    );

    await expect(api.list('org7')).resolves.toEqual([
      { name: 'Shop', apiKey: 'blt1' },
      { name: 'Unmarked', apiKey: 'blt3' },
    ]);
  });

  it('names a stack by its api key when it has no name and skips an entry with no api key', async () => {
    const { api } = session(
      { items: [{ api_key: 'blt1' }, { name: 'Nameless key' }, { name: 'Empty', api_key: '  ' }, null, 'text', { name: '  ', api_key: 'blt3' }] },
      {},
    );

    await expect(api.list('org7')).resolves.toEqual([
      { name: 'blt1', apiKey: 'blt1' },
      { name: 'blt3', apiKey: 'blt3' },
    ]);
  });

  it.each([[{}], [{ items: [] }]])('lists nothing when the organization holds no stacks (%p)', async (reply) => {
    const { api } = session(reply, {});

    await expect(api.list('org7')).resolves.toEqual([]);
  });

  it('lists the delivery tokens of a stack with the environment each is scoped to', async () => {
    const { api, asked } = session(
      {},
      {
        items: [
          { name: 'prod-token', token: TOKEN_A, scope: [{ module: 'environment', environments: [{ name: 'production' }, { name: 'staging' }] }] },
          { name: 'dev-token', token: TOKEN_B, scope: [{ module: 'environment', environments: [{ name: 'development' }] }] },
        ],
      },
    );

    await expect(api.deliveryTokens('blt1')).resolves.toEqual([
      { name: 'prod-token', token: TOKEN_A, environment: 'production' },
      { name: 'dev-token', token: TOKEN_B, environment: 'development' },
    ]);
    expect(asked.tokens).toEqual(['blt1']);
  });

  it.each([
    [undefined],
    [[]],
    [[{ module: 'environment' }]],
    [[{ module: 'environment', environments: [] }]],
    [[{ module: 'environment', environments: [{ name: '  ' }] }]],
    [[{ module: 'environment', environments: [{}] }]],
    [[null, 'text']],
  ])('leaves the environment unset when the token scope names none (%p)', async (scope) => {
    const { api } = session({}, { items: [{ name: 'prod-token', token: TOKEN_A, scope }] });

    await expect(api.deliveryTokens('blt1')).resolves.toEqual([{ name: 'prod-token', token: TOKEN_A, environment: undefined }]);
  });

  it('skips a token with no value and names one by its position when it has no name', async () => {
    const { api } = session(
      {},
      { items: [{ name: 'no-value' }, { token: TOKEN_B }, { name: 'blank', token: ' ' }, null, { name: 'ok', token: TOKEN_C }] },
    );

    await expect(api.deliveryTokens('blt1')).resolves.toEqual([
      { name: 'Delivery token 2', token: TOKEN_B, environment: undefined },
      { name: 'ok', token: TOKEN_C, environment: undefined },
    ]);
  });

  it.each([[{}], [{ items: [] }]])('lists nothing when the stack holds no delivery tokens (%p)', async (reply) => {
    const { api } = session({}, reply);

    await expect(api.deliveryTokens('blt1')).resolves.toEqual([]);
  });

  it('words a failed stack lookup as a runtime failure naming the reason', async () => {
    const { api } = session(Object.assign(new Error('x'), { errorMessage: 'You do not have access.' }), {});

    const error = await api.list('org7').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StackLookupError);
    expect((error as StackLookupError).exitCode).toBe(EXIT_RUNTIME);
    expect((error as StackLookupError).message).toBe('Could not list the stacks of this organization: You do not have access.');
  });

  it('words a failed delivery token lookup as a runtime failure naming the stack and the reason', async () => {
    const { api } = session({}, new Error('socket hang up'));

    const error = await api.deliveryTokens('blt1').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StackLookupError);
    expect((error as StackLookupError).message).toBe('Could not list the delivery tokens of stack blt1: socket hang up.');
  });

  it('uses a plain text rejection as the reason', async () => {
    const failing = new StacksApi({
      fetchStacks: async () => Promise.reject('rate limited'),
      fetchDeliveryTokens: async () => ({}),
    } as unknown as CmaSession);

    await expect(failing.list('org7')).rejects.toThrow('Could not list the stacks of this organization: rate limited.');
  });

  it('says so when the Management API gave no reason', async () => {
    const failing = new StacksApi({
      fetchStacks: async () => Promise.reject(undefined),
      fetchDeliveryTokens: async () => ({}),
    } as unknown as CmaSession);

    await expect(failing.list('org7')).rejects.toThrow(
      'Could not list the stacks of this organization: the Contentstack Management API gave no reason.',
    );
  });
});
