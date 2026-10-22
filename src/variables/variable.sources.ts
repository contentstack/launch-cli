import { UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentVariableInput } from '../environments/types';
import { detectEnvFile, readEnvFiles, STDIN_PATH } from './variable.files';
import type { EnvFileSource } from './variable.files';
import { mergeSources } from './variable.merge';
import type { MergedVariables, VariableSource } from './variable.merge';
import { parseAssignment } from './variable.parse';
import { completeValues } from './variable.values';

export interface VariableRequest {
  vars: string[] | undefined;
  envFiles: string[] | undefined;
  autoDetect?: boolean;
  fromStack?: boolean;
  alias?: string;
}

export interface VariableContext {
  services: ServiceContext;
  dataDir: string;
  stack: (alias?: string) => Promise<EnvironmentVariableInput[]>;
  readFile(path: string): Promise<string>;
  exists(path: string): boolean;
  readStdin(): Promise<string>;
}

const VAR_LABEL = '--var';
const STACK_LABEL = 'stack';

function plural(count: number): string {
  return count === 1 ? 'variable' : 'variables';
}

export function noteSkipped(source: EnvFileSource, ux: UxLike): void {
  if (source.skipped.length > 0) {
    const { label, skipped } = source;

    const noun = plural(skipped.length);

    ux.print(`Skipped ${skipped.length} ${noun} with an empty value in ${label}: ${skipped.join(', ')}.`);
  }
}

async function fileSources(
  request: VariableRequest,
  context: VariableContext,
  noneGiven: boolean,
): Promise<EnvFileSource[]> {
  const reader = { readFile: context.readFile, readStdin: context.readStdin };
  const named = request.envFiles ?? [];

  if (named.length > 0 || !noneGiven || request.autoDetect !== true) {
    return readEnvFiles(named, reader);
  }

  const detected = detectEnvFile(context.dataDir, context.exists);

  if (detected === undefined) {
    throw new UsageError(
      `No variables were given and no .env.local or .env was found in ${context.dataDir}. ` +
        'Pass --var, --dotenv, or --data-dir to point at the project folder.',
    );
  }

  context.services.ux.print(`Using variables from ${detected}.`);

  return readEnvFiles([detected], reader);
}

export async function collectVariables(request: VariableRequest, context: VariableContext): Promise<MergedVariables> {
  const assignments = (request.vars ?? []).map(parseAssignment);
  const hasBare = assignments.some((assignment) => assignment.value === undefined);

  if (hasBare && (request.envFiles ?? []).includes(STDIN_PATH)) {
    throw new UsageError(
      'A --var with no value and --dotenv - both need standard input, ' +
        'and only one of them can read standard input.',
    );
  }

  const noneGiven = assignments.length === 0 && request.fromStack !== true;
  const files = await fileSources(request, context, noneGiven);
  const stackVariables = request.fromStack === true ? await context.stack(request.alias) : [];
  const typed = await completeValues(assignments, context);

  files.forEach((source) => noteSkipped(source, context.services.ux));

  const sources: VariableSource[] = [
    { label: STACK_LABEL, variables: stackVariables },
    ...files.map(({ label, variables }) => ({ label, variables })),
    { label: VAR_LABEL, variables: typed },
  ];

  return mergeSources(sources);
}
