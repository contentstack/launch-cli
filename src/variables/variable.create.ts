import type { ServiceContext } from '../core/service-context';
import type { EnvironmentVariableInput } from '../environments/types';
import { chooseSources } from './variable.chooser';
import { collectVariables } from './variable.sources';
import { DEFAULT_VARIABLE_IO, given } from './variable.io';
import type { VariableIo } from './variable.io';
import { importFromStack, readSavedToken } from './variable.stack';
import type { SavedToken, StackImporter } from './variable.stack';
import { variablesSetLine } from './variable.summary';

export interface CreateVariablesRequest {
  vars: string[] | undefined;
  envFiles: string[] | undefined;
  dataDir: string;
  org: string;
  fromStack?: boolean;
  alias?: string;
  noVars?: boolean;
}

const CHOOSE_MESSAGE = 'Add environment variables';

async function askForVariables(
  request: CreateVariablesRequest,
  services: ServiceContext,
  io: VariableIo,
  stack: StackImporter,
): Promise<EnvironmentVariableInput[]> {
  const merged = await chooseSources(request.dataDir, services, io, stack, {
    message: CHOOSE_MESSAGE,
    skippable: true,
  });

  if (merged === undefined) {
    return [];
  }

  services.ux.print(variablesSetLine(merged, services.outputIsTTY === true, 'ready to set'));

  return merged.variables;
}

export async function variablesForCreate(
  request: CreateVariablesRequest,
  services: ServiceContext,
  io: VariableIo = DEFAULT_VARIABLE_IO,
  savedToken: (alias: string) => SavedToken | undefined = readSavedToken,
): Promise<EnvironmentVariableInput[]> {
  if (request.noVars === true) {
    return [];
  }

  const stack: StackImporter = (alias) => importFromStack({ org: request.org, alias }, { services, savedToken });

  if (given(request.vars) || given(request.envFiles) || request.fromStack === true) {
    const merged = await collectVariables(
      { vars: request.vars, envFiles: request.envFiles, fromStack: request.fromStack, alias: request.alias },
      { ...io, services, dataDir: request.dataDir, stack },
    );

    services.ux.print(variablesSetLine(merged, services.outputIsTTY === true, 'ready to set'));

    return merged.variables;
  }

  return services.isTTY ? askForVariables(request, services, io, stack) : [];
}
