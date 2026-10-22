import { randomUUID } from 'node:crypto';
import { configHandler } from '@contentstack/cli-utilities';

import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { DeliveryToken, Stack } from '../stacks/stacks.api';
import { StackLookupError } from '../stacks/stack.errors';
import type { StackTemplateEntry } from './variables.api';
import { importFromStack, readSavedToken } from './variable.stack';
import type { SavedToken } from './variable.stack';

const PROD_TOKEN = `cs-${randomUUID()}`;
const DEV_TOKEN = `cs-${randomUUID()}`;
const SAVED_TOKEN = `cs-${randomUUID()}`;
const LOOSE_TOKEN = `cs-${randomUUID()}`;
const OTHER_TOKEN = `cs-${randomUUID()}`;

const TEMPLATE: StackTemplateEntry[] = [
  { key: 'CONTENTSTACK_API_HOST', value: 'https://api.example.test' },
  { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
  { key: 'CONTENTSTACK_API_KEY', value: undefined },
  { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: undefined },
  { key: 'CONTENTSTACK_ENVIRONMENT', value: undefined },
];

const STACKS: Stack[] = [
  { name: 'Shop', apiKey: 'blt1' },
  { name: 'Blog', apiKey: 'blt2' },
];

const TOKENS: DeliveryToken[] = [
  { name: 'prod-token', token: PROD_TOKEN, environment: 'production' },
  { name: 'dev-token', token: DEV_TOKEN, environment: 'development' },
];

interface Scenario {
  isTTY?: boolean;
  answers?: Record<string, unknown>;
  stacks?: Stack[] | Error;
  tokens?: DeliveryToken[] | Error;
  template?: StackTemplateEntry[] | Error;
}

function fakes(scenario: Scenario = {}) {
  const calls: string[] = [];
  const printed: string[] = [];
  const prompts: { message: string; payload: Record<string, unknown> }[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: (async (payload: Record<string, unknown>) => {
      const message = String(payload.message);
      calls.push(`ask:${message}`);
      prompts.push({ message, payload });

      if (!(message in (scenario.answers ?? {}))) {
        throw new Error(`Unexpected prompt: ${message}`);
      }

      return (scenario.answers ?? {})[message];
    }) as UxLike['inquire'],
  };
  const answer = <T>(value: T | Error | undefined, fallback: T): T => {
    if (value instanceof Error) {
      throw value;
    }

    return value ?? fallback;
  };
  const services = {
    ux,
    isTTY: scenario.isTTY ?? true,
    api: {
      stacks: {
        list: async (org: string) => {
          calls.push(`stacks:${org}`);
          return answer(scenario.stacks, STACKS);
        },
        deliveryTokens: async (apiKey: string) => {
          calls.push(`tokens:${apiKey}`);
          return answer(scenario.tokens, TOKENS);
        },
      },
      variables: {
        stackTemplate: async (org: string) => {
          calls.push(`template:${org}`);
          return answer(scenario.template, TEMPLATE);
        },
      },
    },
  } as unknown as ServiceContext;

  return { services, calls, printed, prompts };
}

const SAVED: SavedToken = { token: SAVED_TOKEN, apiKey: 'blt9', environment: 'staging' };

function saved(entries: Record<string, SavedToken | undefined>) {
  const asked: string[] = [];

  return {
    asked,
    savedToken: (alias: string) => {
      asked.push(alias);
      return entries[alias];
    },
  };
}

const NOTHING_SAVED = () => undefined;

describe('variable stack import with --alias', () => {
  it('builds the five variables from the saved token and the CMS template without asking anything', async () => {
    const { services, calls, printed } = fakes();
    const { savedToken, asked } = saved({ 'my-prod': SAVED });

    const variables = await importFromStack({ org: 'org1', alias: 'my-prod' }, { services, savedToken });

    expect(variables).toEqual([
      { key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
      { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
      { key: 'CONTENTSTACK_API_KEY', value: 'blt9' },
      { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: SAVED_TOKEN },
      { key: 'CONTENTSTACK_ENVIRONMENT', value: 'staging' },
    ]);
    expect(asked).toEqual(['my-prod']);
    expect(calls).toEqual(['template:org1']);
    expect(printed).toEqual(['Using the saved delivery token "my-prod" (environment staging).']);
    expect(printed.join('\n')).not.toContain(SAVED_TOKEN);
  });

  it('omits the host and CDN when the template carries no value for them', async () => {
    const { services } = fakes({ template: [{ key: 'CONTENTSTACK_API_HOST', value: undefined }] });
    const { savedToken } = saved({ a: SAVED });

    const variables = await importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken });

    expect(variables.map((variable) => variable.key)).toEqual([
      'CONTENTSTACK_API_KEY',
      'CONTENTSTACK_DELIVERY_TOKEN',
      'CONTENTSTACK_ENVIRONMENT',
    ]);
  });

  it('says which host variables it could not import, never a value', async () => {
    const { services, printed } = fakes({ template: [{ key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' }] });
    const { savedToken } = saved({ a: SAVED });

    await importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken });

    expect(printed).toContain('No value was available for CONTENTSTACK_CDN, so it was not imported.');
    expect(printed.join('\n')).not.toContain(SAVED_TOKEN);
  });

  it('keeps a host that is not a url as it is and reduces a url to its host and port', async () => {
    const { services } = fakes({
      template: [
        { key: 'CONTENTSTACK_API_HOST', value: 'http://localhost:8080/v3' },
        { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
      ],
    });
    const { savedToken } = saved({ a: SAVED });

    const variables = await importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken });

    expect(variables.slice(0, 2)).toEqual([
      { key: 'CONTENTSTACK_API_HOST', value: 'localhost:8080' },
      { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
    ]);
  });

  it('keeps a host that only looks like a url but does not parse', async () => {
    const { services } = fakes({ template: [{ key: 'CONTENTSTACK_API_HOST', value: 'http://' }] });
    const { savedToken } = saved({ a: SAVED });

    const variables = await importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken });

    expect(variables[0]).toEqual({ key: 'CONTENTSTACK_API_HOST', value: 'http://' });
  });

  it('refuses an alias nothing is saved under, naming how to save one, before any request', async () => {
    const { services, calls } = fakes();
    const { savedToken } = saved({});

    const error = await importFromStack({ org: 'org1', alias: 'gone' }, { services, savedToken }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toBe(
      'No delivery token is saved as "gone". Save one with csdx auth:tokens:add --alias gone --delivery.',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a saved token with no environment and says how to save it again', async () => {
    const { services, calls } = fakes();
    const { savedToken } = saved({ a: { token: 't', apiKey: 'blt9' } });

    await expect(importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken })).rejects.toThrow(
      'The saved delivery token "a" has no environment. Save it again with csdx auth:tokens:add --alias a --delivery --environment <name>.',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a saved management token', async () => {
    const { services } = fakes();
    const { savedToken } = saved({ a: { ...SAVED, type: 'management' } });

    await expect(importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken })).rejects.toThrow(
      '"a" is a management token. --from-stack needs a delivery token.',
    );
  });

  it('accepts a saved token explicitly typed as delivery', async () => {
    const { services } = fakes();
    const { savedToken } = saved({ a: { ...SAVED, type: 'delivery' } });

    await expect(importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken })).resolves.toHaveLength(5);
  });

  it('propagates a failed template request without having printed a success line', async () => {
    const failure = new Error('cms failed');
    const { services, printed } = fakes({ template: failure });
    const { savedToken } = saved({ a: SAVED });

    await expect(importFromStack({ org: 'org1', alias: 'a' }, { services, savedToken })).rejects.toBe(failure);
    expect(printed).toEqual([]);
  });
});

describe('variable stack import without --alias', () => {
  it('exits as a usage error naming --alias when there is no terminal, asking and requesting nothing', async () => {
    const { services, calls } = fakes({ isTTY: false });
    const { savedToken, asked } = saved({});

    const error = await importFromStack({ org: 'org1' }, { services, savedToken }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toBe("--from-stack requires --alias when there's no TTY.");
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('asks for the stack, then the delivery token, then reads the template, and builds the variables from the choices', async () => {
    const { services, calls, printed, prompts } = fakes({ answers: { Stack: '1', 'Delivery token': '0' } });

    const variables = await importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED });

    expect(calls).toEqual(['stacks:org1', 'ask:Stack', 'tokens:blt2', 'ask:Delivery token', 'template:org1']);
    expect(variables).toEqual([
      { key: 'CONTENTSTACK_API_HOST', value: 'api.example.test' },
      { key: 'CONTENTSTACK_CDN', value: 'cdn.example.test' },
      { key: 'CONTENTSTACK_API_KEY', value: 'blt2' },
      { key: 'CONTENTSTACK_DELIVERY_TOKEN', value: PROD_TOKEN },
      { key: 'CONTENTSTACK_ENVIRONMENT', value: 'production' },
    ]);
    expect(prompts[0].payload).toMatchObject({
      type: 'list',
      choices: [
        { name: 'Shop', value: '0' },
        { name: 'Blog', value: '1' },
      ],
    });
    expect(prompts[1].payload).toMatchObject({
      choices: [
        { name: 'prod-token (production)', value: '0' },
        { name: 'dev-token (development)', value: '1' },
      ],
    });
    expect(printed).toEqual(['Using delivery token "prod-token" of stack "Blog" (environment production).']);
    expect(JSON.stringify({ printed, prompts })).not.toContain(PROD_TOKEN);
  });

  it('offers a token with no environment without the parenthesis and then refuses it', async () => {
    const { services, prompts } = fakes({
      answers: { Stack: '0', 'Delivery token': '0' },
      tokens: [{ name: 'loose', token: LOOSE_TOKEN, environment: undefined }],
    });

    await expect(importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      'The delivery token "loose" is not scoped to an environment. Scope it in the stack, or save one with an environment using csdx auth:tokens:add.',
    );
    expect(prompts[1].payload).toMatchObject({ choices: [{ name: 'loose', value: '0' }] });
  });

  it('refuses an organization with no stacks', async () => {
    const { services, calls } = fakes({ stacks: [] });

    await expect(importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      'No stacks were found in this organization, or you have no access to any.',
    );
    expect(calls).toEqual(['stacks:org1']);
  });

  it.each([['9'], ['x']])('refuses a stack answer that is not one of the choices (%p)', async (answer) => {
    const { services } = fakes({ answers: { Stack: answer } });

    await expect(importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      'That stack is not one of the choices.',
    );
  });

  it('refuses a delivery token answer that is not one of the choices', async () => {
    const { services } = fakes({ answers: { Stack: '0', 'Delivery token': '7' } });

    await expect(importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      'That delivery token is not one of the choices.',
    );
  });

  it('refuses a stack with no delivery tokens and names the stack', async () => {
    const { services } = fakes({ answers: { Stack: '0' }, tokens: [] });

    await expect(importFromStack({ org: 'org1' }, { services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      'Stack "Shop" has no delivery tokens. Create one in the stack, or pass --alias.',
    );
  });

  it('propagates a cancelled prompt, a failed stack lookup and a failed token lookup', async () => {
    const cancelled = fakes({ answers: { Stack: undefined } });

    await expect(importFromStack({ org: 'org1' }, { services: cancelled.services, savedToken: NOTHING_SAVED })).rejects.toThrow(
      CancelledError,
    );

    const failing = new StackLookupError('the stacks of this organization', 'boom');
    const stacks = fakes({ stacks: failing });

    await expect(importFromStack({ org: 'org1' }, { services: stacks.services, savedToken: NOTHING_SAVED })).rejects.toBe(failing);

    const tokenFailure = new StackLookupError('the delivery tokens of stack blt1', 'boom');
    const tokens = fakes({ answers: { Stack: '0' }, tokens: tokenFailure });

    await expect(importFromStack({ org: 'org1' }, { services: tokens.services, savedToken: NOTHING_SAVED })).rejects.toBe(tokenFailure);
  });
});

describe('readSavedToken', () => {
  function configHolding(value: unknown) {
    const asked: string[] = [];
    jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      asked.push(key);
      return value;
    });

    return asked;
  }

  it('reads the token csdx auth:tokens:add saved under the alias', () => {
    const asked = configHolding({ 'my-prod': { token: OTHER_TOKEN, apiKey: 'blt1', environment: 'production', type: 'delivery' } });

    expect(readSavedToken('my-prod')).toEqual({ token: OTHER_TOKEN, apiKey: 'blt1', environment: 'production', type: 'delivery' });
    expect(asked).toEqual(['tokens']);
  });

  it('leaves the environment and type unset when the entry has none', () => {
    configHolding({ a: { token: OTHER_TOKEN, apiKey: 'blt1' } });

    expect(readSavedToken('a')).toEqual({ token: OTHER_TOKEN, apiKey: 'blt1', environment: undefined, type: undefined });
  });

  it.each([
    [undefined],
    [null],
    ['text'],
    [{}],
    [{ token: OTHER_TOKEN }],
    [{ apiKey: 'blt1' }],
    [{ token: '', apiKey: 'blt1' }],
    [{ token: OTHER_TOKEN, apiKey: '  ' }],
  ])('reports no saved token for an entry of %p', (entry) => {
    configHolding({ a: entry });

    expect(readSavedToken('a')).toBeUndefined();
  });

  it('finds an alias that contains a dot', () => {
    configHolding({ 'prod.eu': { token: OTHER_TOKEN, apiKey: 'blt1' } });

    expect(readSavedToken('prod.eu')).toEqual({ token: OTHER_TOKEN, apiKey: 'blt1', environment: undefined, type: undefined });
  });

  it.each([[undefined], [null], ['text'], [{}], [{ other: { token: OTHER_TOKEN, apiKey: 'blt1' } }]])(
    'reports no saved token when the tokens config holds %p',
    (tokens) => {
      configHolding(tokens);

      expect(readSavedToken('a')).toBeUndefined();
    },
  );

  it('does not read an alias from the prototype of the tokens object', () => {
    configHolding({});

    expect(readSavedToken('constructor')).toBeUndefined();
  });
});
