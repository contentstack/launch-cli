import { styled } from '../core/style';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentParams } from '../environments/environments.api';
import { chooseSources } from './variable.chooser';
import { DEFAULT_VARIABLE_IO, given } from './variable.io';
import type { VariableIo } from './variable.io';
import type { MergedVariables } from './variable.merge';
import { collectVariables } from './variable.sources';
import { importFromStack, readSavedToken } from './variable.stack';
import type { SavedToken } from './variable.stack';
import { variablesSetLine } from './variable.summary';
import { setVariables } from './variable.writer';

export interface SetVariablesRequest extends EnvironmentParams {
  vars: string[] | undefined;
  envFiles: string[] | undefined;
  dataDir: string;
  fromStack?: boolean;
  alias?: string;
}

export const NO_CHANGES_LINE = 'No changes made.';
export const SKIPPED_LINE = 'Skipped adding variables.';
export const CHOOSE_SOURCES_MESSAGE = 'Add variables from';

export class VariableSetter {
  constructor(
    private readonly services: ServiceContext,
    private readonly io: VariableIo = DEFAULT_VARIABLE_IO,
    private readonly savedToken: (alias: string) => SavedToken | undefined = readSavedToken,
  ) {}

  async set(request: SetVariablesRequest): Promise<void> {
    const { ux } = this.services;
    const stack = (alias?: string) =>
      importFromStack({ org: request.org, alias }, { services: this.services, savedToken: this.savedToken });
    const prompt = { message: CHOOSE_SOURCES_MESSAGE, skippable: false };
    const asked = !given(request.vars) && !given(request.envFiles) && request.fromStack !== true && this.services.isTTY;
    const merged: MergedVariables | undefined = asked
      ? await chooseSources(request.dataDir, this.services, this.io, stack, prompt)
      : await collectVariables(
        {
          vars: request.vars,
          envFiles: request.envFiles,
          autoDetect: true,
          fromStack: request.fromStack,
          alias: request.alias,
        },
        { ...this.io, services: this.services, dataDir: request.dataDir, stack },
      );

    if (merged === undefined) {
      ux.print(styled(SKIPPED_LINE, 'yellow', this.services.outputIsTTY === true));
      return;
    }

    if (merged.variables.length === 0) {
      ux.print(styled(NO_CHANGES_LINE, 'yellow', this.services.outputIsTTY === true));
      return;
    }

    await setVariables(
      this.services.api.variables,
      { org: request.org, project: request.project, environment: request.environment },
      merged.variables,
    );

    ux.print(variablesSetLine(merged, this.services.outputIsTTY === true));
  }
}
