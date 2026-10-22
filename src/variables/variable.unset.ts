import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { styled } from '../core/style';
import { assertPreservable, missingKeys, notSetError, unsetVariables } from './variable.writer';

export interface RemoveVariablesRequest extends EnvironmentParams {
  keys: string[];
}

export type Confirm = (question: string) => Promise<boolean>;

export class VariableRemover {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
  ) {}

  async remove(request: RemoveVariablesRequest): Promise<boolean> {
    const { org, project, environment } = request;
    const scope = { org, project, environment };
    const store = this.services.api.environments;
    const held = await store.get(scope);
    const missing = missingKeys(held, request.keys);

    if (missing.length > 0) {
      throw notSetError(missing);
    }

    assertPreservable(held);

    const name = held.name ?? environment;
    const listed = [...new Set(request.keys)].join(', ');

    if (!(await this.confirm(`Are you sure you want to remove ${listed} from "${name}"?`))) {
      return false;
    }

    await unsetVariables(store, scope, request.keys);

    this.services.ux.print(
      styled(`✔ ${listed} removed from ${name}.`, 'green', this.services.outputIsTTY === true),
    );

    return true;
  }
}
