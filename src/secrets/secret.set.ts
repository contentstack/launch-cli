import { UsageError } from '../core/errors';
import { styled } from '../core/style';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { assertSecretKey, clientExposedWarning, emptyValueError } from './secret.rules';
import type { SecretValueIo } from './secret.value';
import { DEFAULT_SECRET_IO, readSecretValue } from './secret.value';

export interface SetSecretRequest extends EnvironmentParams {
  key: string;
  yes: boolean;
}

export type Confirm = (question: string) => Promise<boolean>;

export class SecretSetter {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
    private readonly io: SecretValueIo = DEFAULT_SECRET_IO,
  ) {}

  async set({ org, project, environment, key, yes }: SetSecretRequest): Promise<boolean> {
    const scope = { org, project, environment };
    const colour = this.services.outputIsTTY === true;

    assertSecretKey(key);

    if (!this.services.isTTY && !yes) {
      throw new UsageError(
        'Pass --yes when piping the value: standard input carries the value, ' +
          'so there is no way to ask for confirmation.',
      );
    }

    const value = await readSecretValue(key, this.services, this.io);

    if (value.trim() === '') {
      throw emptyValueError(key);
    }

    const held = await this.services.api.secrets.list(scope);
    const exists = held.some((secret) => secret.key === key);
    const warning = clientExposedWarning(key);

    if (warning !== undefined) {
      this.services.ux.print(styled(warning, 'yellow', colour));
    }

    const question = `Are you sure you want to ${exists ? 'replace the value of' : 'add'} the secret ${key}?`;

    if (!(await this.confirm(question))) {
      return false;
    }

    const write = { ...scope, key, value };

    if (exists) {
      await this.services.api.secrets.refresh(write);
    } else {
      await this.services.api.secrets.add(write);
    }

    this.services.ux.print(styled(`✔ Secret ${key} ${exists ? 'updated' : 'added'}.`, 'green', colour));

    return true;
  }
}
