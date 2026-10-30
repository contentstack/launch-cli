import { styled } from '../core/style';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { LaunchApiError } from '../transport/errors';
import { SecretsNotRemovedError } from './secrets.errors';

export interface RemoveSecretsRequest extends EnvironmentParams {
  keys: string[];
}

export type Confirm = (question: string) => Promise<boolean>;

export class SecretRemover {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
  ) {}

  async remove({ org, project, environment, keys: requested }: RemoveSecretsRequest): Promise<boolean> {
    const keys = [...new Set(requested)];
    const colour = this.services.outputIsTTY === true;
    const subject = keys.length === 1 ? 'secret' : 'secrets';

    const question = `Are you sure you want to remove the ${subject} ${keys.join(', ')} from this environment?`;

    if (!(await this.confirm(question))) {
      return false;
    }

    const stayed: string[] = [];

    for (const key of keys) {
      try {
        await this.services.api.secrets.remove({ org, project, environment, key });
        this.services.ux.print(styled(`✔ Secret ${key} removed.`, 'green', colour));
      } catch (error) {
        if (!(error instanceof LaunchApiError)) {
          throw error;
        }

        stayed.push(key);
        this.services.ux.print(styled(`Secret ${key} was not removed: ${error.message}`, 'red', colour));
      }
    }

    if (stayed.length > 0) {
      throw new SecretsNotRemovedError(stayed, keys.length);
    }

    return true;
  }
}
