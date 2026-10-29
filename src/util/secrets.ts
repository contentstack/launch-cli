import map from 'lodash/map';
import some from 'lodash/some';
import find from 'lodash/find';
import split from 'lodash/split';
import filter from 'lodash/filter';
import isEmpty from 'lodash/isEmpty';
import includes from 'lodash/includes';
import startsWith from 'lodash/startsWith';

export const CLIENT_EXPOSED_PREFIXES = ['NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'VITE_', 'GATSBY_', 'PUBLIC_'];

export const isClientExposedKey = (key: string): boolean =>
  some(CLIENT_EXPOSED_PREFIXES, (prefix) => startsWith(key, prefix));

export const clientExposedWarning = (key: string): string =>
  `Warning: ${key} starts with a client-exposed prefix, so its value is inlined into client JavaScript ` +
  'at build time and is visible to anyone who loads your site.';

type SecretsErrorContext = { key?: string; value?: string };

const stringify = (item: unknown): string => {
  try {
    return JSON.stringify(item) ?? '';
  } catch {
    return '';
  }
};

const redactValue = (text: string, value?: string): string => {
  if (!value) return text;
  const fragments = filter(split(value, /\r?\n/), (fragment) => !isEmpty(fragment));
  return fragments.reduce((redacted, fragment) => split(redacted, fragment).join('[redacted]'), text);
};

export const formatSecretsError = (error: any, { key, value }: SecretsErrorContext = {}): string => {
  const graphQLError = error?.graphQLErrors?.[0];
  const exception = graphQLError?.extensions?.exception;
  const status = exception?.status ?? graphQLError?.extensions?.status ?? error?.networkError?.statusCode;
  const searchable = map(
    [exception?.messages, exception?.name, exception?.errorObject, graphQLError?.message, error?.message],
    stringify,
  ).join(' ');
  const hasCode = (code: string) => includes(searchable, code);
  const keyName = key ?? 'the secret';

  const known: [boolean, string][] = [
    [hasCode('ENVIRONMENT_SECRET_KEY_CONFLICT'), `The key ${keyName} is already used by a variable or secret.`],
    [
      hasCode('ENVIRONMENT_VARIABLES_CONCURRENT_UPDATE'),
      'The environment was changed by a concurrent update. Please retry.',
    ],
    [hasCode('ENVIRONMENT_SECRET_VALUE_MULTILINE'), 'Invalid value: multi-line values are not supported.'],
    [hasCode('ENVIRONMENT_SECRET_NOT_FOUND') || status === 404, `The secret ${keyName} was not found.`],
    [status === 403, 'You do not have permission to manage the secrets of this environment.'],
    [status === 400, 'The API rejected the request: invalid key or value.'],
  ];

  const match = find(known, ([matches]) => matches);
  const message = match ? match[1] : (graphQLError?.message ?? error?.message ?? 'Unable to manage the secret.');

  return redactValue(message, value);
};

export const redactFlagValues = (text: string): string => text.replace(/(?<![\w-])(-{1,2}[\w-]+)=.*/g, '$1');
