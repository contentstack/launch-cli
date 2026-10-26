import { basename } from 'node:path';

import { UsageError } from '../core/errors';
import { askChoices, askText } from '../core/prompt';
import { renderTable } from '../core/render';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentVariableInput } from '../environments/types';
import { detectEnvFile, readEnvFiles } from './variable.files';
import { mergeSources } from './variable.merge';
import type { MergedVariables, VariableSource } from './variable.merge';
import { parseAssignment, splitLine } from './variable.parse';
import { pairColumns } from './variable.presenter';
import { noteSkipped } from './variable.sources';
import type { VariableIo } from './variable.io';
import type { StackImporter } from './variable.stack';
import { completeValues } from './variable.values';

export interface ChooserPrompt {
  message: string;
  skippable: boolean;
}

export const STACK_CHOICE = 'Import variables from a stack';
export const FILE_CHOICE = 'Import variables from a dotenv file';
export const TYPED_CHOICE = 'Manually add custom variables';
export const SKIP_CHOICE = 'Skip adding environment variables';
const FILE_QUESTION = 'Path to the dotenv file';
export const TYPED_QUESTION =
  'Enter variables separated by spaces (Ex: KEY1=value1 KEY2:value2 KEY3="value with spaces")';
const TYPED_LABEL = 'manual entry';

async function askForFile(
  detected: string | undefined,
  services: ServiceContext,
  io: VariableIo,
): Promise<VariableSource[]> {
  const path = await askText(services.ux, FILE_QUESTION, detected);
  const sources = await readEnvFiles([path], io);

  sources.forEach((source) => noteSkipped(source, services.ux));

  return sources;
}

async function askForTyped(services: ServiceContext, io: VariableIo): Promise<EnvironmentVariableInput[]> {
  const line = await askText(services.ux, TYPED_QUESTION);
  const typed = await completeValues(splitLine(line).map(parseAssignment), { services, readStdin: io.readStdin });

  renderTable(services.ux, pairColumns(), typed, process.stdout.columns, undefined, services.outputIsTTY === true);

  return typed;
}

export async function chooseSources(
  dataDir: string,
  services: ServiceContext,
  io: VariableIo,
  stack: StackImporter,
  prompt: ChooserPrompt,
): Promise<MergedVariables | undefined> {
  const detected = detectEnvFile(dataDir, io.exists);
  const fileName = detected === undefined ? FILE_CHOICE : `${FILE_CHOICE} (${basename(detected)} found)`;
  const choices = [
    { name: STACK_CHOICE, value: STACK_CHOICE },
    { name: fileName, value: FILE_CHOICE },
    { name: TYPED_CHOICE, value: TYPED_CHOICE },
    ...(prompt.skippable ? [{ name: SKIP_CHOICE, value: SKIP_CHOICE }] : []),
  ];
  const picked = await askChoices(services.ux, prompt.message, choices, { requireOne: prompt.skippable });

  if (picked.includes(SKIP_CHOICE)) {
    if (picked.length > 1) {
      throw new UsageError(`'${SKIP_CHOICE}' cannot be combined with the other options.`);
    }

    services.ux.print('Skipped adding environment variables.');

    return undefined;
  }

  if (picked.length === 0) {
    return undefined;
  }

  const sources: VariableSource[] = [];

  if (picked.includes(STACK_CHOICE)) {
    sources.push({ label: 'stack', variables: await stack() });
  }

  if (picked.includes(FILE_CHOICE)) {
    sources.push(...(await askForFile(detected, services, io)));
  }

  if (picked.includes(TYPED_CHOICE)) {
    sources.push({ label: TYPED_LABEL, variables: await askForTyped(services, io) });
  }

  return mergeSources(sources);
}
