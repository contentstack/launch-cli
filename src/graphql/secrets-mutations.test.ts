import { print } from 'graphql';

import {
  addEnvironmentSecretMutation,
  refreshEnvironmentSecretMutation,
  deleteEnvironmentSecretMutation,
} from './mutation';

describe('environment secret mutations', () => {
  it.each([
    ['addEnvironmentSecret', addEnvironmentSecretMutation, '$secret: EnvironmentSecretInput!'],
    ['refreshEnvironmentSecret', refreshEnvironmentSecretMutation, '$secret: EnvironmentSecretInput!'],
    ['deleteEnvironmentSecret', deleteEnvironmentSecretMutation, '$secret: EnvironmentSecretKeyInput!'],
  ])('declares %s with the environment and secret input arguments of the schema', (name, document, secretVariable) => {
    const printed = print(document);

    expect(printed).toContain('$environment: EnvironmentInput!');
    expect(printed).toContain(secretVariable);
    expect(printed).toContain(`${name}(environment: $environment, secret: $secret)`);
    expect(printed).not.toContain('environmentUid');
  });
});
