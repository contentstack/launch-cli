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

const ERROR_CODES = {
  keyConflict: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.CONFLICT',
  notFound: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.KEY.NOT_FOUND',
  multiline: 'launch.ENVIRONMENT.ENVIRONMENT_SECRETS.VALUE.MULTILINE',
  concurrentUpdate: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.CONCURRENT_UPDATE',
  keyEmpty: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY',
  keyTooLong: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.TOO_LONG',
  valueEmpty: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY',
  valueTooLong: 'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.TOO_LONG',
};

type SecretsErrorContext = { key?: string; value?: string; operation?: 'read' | 'write' };

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

export const formatSecretsError = (
  error: any,
  { key, value, operation = 'write' }: SecretsErrorContext = {},
): string => {
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
    [hasCode(ERROR_CODES.keyConflict), `The key ${keyName} is already used by a variable or secret.`],
    [hasCode(ERROR_CODES.concurrentUpdate), 'The environment was changed by a concurrent update. Please retry.'],
    [hasCode(ERROR_CODES.multiline), 'Invalid value: multi-line values are not supported.'],
    [hasCode(ERROR_CODES.notFound), `The secret ${keyName} was not found.`],
    [hasCode(ERROR_CODES.keyEmpty), 'Invalid key: the key cannot be empty.'],
    [hasCode(ERROR_CODES.keyTooLong), 'Invalid key: the key is too long (maximum 10000 characters).'],
    [hasCode(ERROR_CODES.valueEmpty), 'Invalid value: the value cannot be empty.'],
    [hasCode(ERROR_CODES.valueTooLong), 'Invalid value: the value is too long (maximum 10000 characters).'],
    [status === 403, 'You do not have permission to manage the secrets of this environment.'],
    [operation === 'read' && status === 404, 'The project or environment was not found.'],
    [operation === 'read' && status === 400, 'The API rejected the request.'],
    [status === 400, 'The API rejected the request: invalid key or value.'],
  ];

  const match = find(known, ([matches]) => matches);
  const message = match ? match[1] : (graphQLError?.message ?? error?.message ?? 'Unable to manage the secret.');

  return redactValue(message, value);
};

export const redactFlagValues = (text: string): string => text.replace(/(?<![\w-])(-{1,2}[\w-]+)=.*/g, '$1');
