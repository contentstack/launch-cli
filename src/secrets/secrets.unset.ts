import type { ServiceContext } from '../core/service-context';
import { styled } from '../core/style';
import type { SecretsParams } from './types';

export interface RemoveSecretsRequest extends SecretsParams {
  keys: string[];
}

export type Confirm = (question: string) => Promise<boolean>;

export class SecretRemover {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
  ) {}

  async remove({ keys: requested, ...scope }: RemoveSecretsRequest): Promise<boolean> {
    const keys = [...new Set(requested)];
    const colour = this.services.outputIsTTY === true;
    const subject = keys.length === 1 ? 'secret' : 'secrets';

    if (
      !(await this.confirm(`Remove the ${subject} ${keys.join(', ')} from this environment? This cannot be undone.`))
    ) {
      return false;
    }

    for (const key of keys) {
      await this.services.api.secrets.delete(scope, key);
      this.services.ux.print(styled(`✔ Secret ${key} removed.`, 'green', colour));
    }

    return true;
  }
}
