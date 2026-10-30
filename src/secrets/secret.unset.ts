import { styled } from '../core/style';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { LaunchApiError } from '../transport/errors';
import { assertSecretKey } from './secret.rules';
import { SecretsNotRemovedError, SecretsRemovalStoppedError } from './secrets.errors';

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

    keys.forEach(assertSecretKey);

    const colour = this.services.outputIsTTY === true;
    const subject = keys.length === 1 ? 'secret' : 'secrets';

    const question = `Are you sure you want to remove the ${subject} ${keys.join(', ')} from this environment?`;

    if (!(await this.confirm(question))) {
      return false;
    }

    const stayed: string[] = [];
    const removed: string[] = [];

    for (const [index, key] of keys.entries()) {
      try {
        await this.services.api.secrets.remove({ org, project, environment, key });
      } catch (error) {
        stayed.push(key);

        if (!(error instanceof LaunchApiError)) {
          throw new SecretsRemovalStoppedError({
            removed,
            failed: stayed,
            notAttempted: keys.slice(index + 1),
            cause: error,
          });
        }

        this.services.ux.print(styled(`Secret ${key} was not removed: ${error.message}`, 'red', colour));
        continue;
      }

      removed.push(key);
      this.services.ux.print(styled(`✔ Secret ${key} removed.`, 'green', colour));
    }

    if (stayed.length > 0) {
      throw new SecretsNotRemovedError(stayed, keys.length);
    }

    return true;
  }
}
