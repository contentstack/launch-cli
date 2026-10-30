import { askSecret } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { styled } from '../core/style';
import { clientExposedWarning, isClientExposedKey } from './secrets.exposure';
import type { SecretsParams } from './types';

export interface SetSecretRequest extends SecretsParams {
  key: string;
}

export type SetSecretOutcome = 'added' | 'refreshed' | 'declined';

export type Confirm = (question: string) => Promise<boolean>;

export class SecretSetter {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
    private readonly readStdin: () => Promise<string>,
  ) {}

  async set({ key, ...scope }: SetSecretRequest): Promise<SetSecretOutcome> {
    const colour = this.services.outputIsTTY === true;

    if (isClientExposedKey(key)) {
      this.services.ux.print(styled(clientExposedWarning(key), 'yellow', colour));
    }

    const listed = await this.services.api.secrets.list(scope);
    const exists = listed.some((secret) => secret.key === key);
    const value = this.services.isTTY ? await askSecret(this.services.ux, `Value for ${key}`) : await this.readStdin();

    const question = exists
      ? `Refresh the secret ${key} in this environment? Its current value will be replaced.`
      : `Add the secret ${key} to this environment?`;

    if (!(await this.confirm(question))) {
      return 'declined';
    }

    if (exists) {
      await this.services.api.secrets.refresh(scope, key, value);
    } else {
      await this.services.api.secrets.add(scope, key, value);
    }

    const outcome = exists ? 'refreshed' : 'added';

    this.services.ux.print(styled(`✔ Secret ${key} ${outcome}.`, 'green', colour));

    return outcome;
  }
}
