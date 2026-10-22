import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { styled } from '../core/style';
import { notSetError } from './variable.errors';
import { missingKeys, unsetVariables } from './variable.writer';

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
    const held = await this.services.api.environments.get(scope);
    const missing = missingKeys(held, request.keys);

    if (missing.length > 0) {
      throw notSetError(missing);
    }

    const name = held.name ?? environment;
    const listed = [...new Set(request.keys)].join(', ');

    if (!(await this.confirm(`Are you sure you want to remove ${listed} from "${name}"?`))) {
      return false;
    }

    await unsetVariables(this.services.api.variables, scope, request.keys);

    this.services.ux.print(
      styled(`✔ ${listed} removed from ${name}.`, 'green', this.services.outputIsTTY === true),
    );

    return true;
  }
}
