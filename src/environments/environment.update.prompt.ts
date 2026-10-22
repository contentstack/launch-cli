import { askChoices, askOption, askOptionalText, askText } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { askBranch } from '../git/git.prompt';
import { frameworkLabelOf } from './environment.builder';
import type { ToggleValue } from './environment.inputs';
import {
  ENVIRONMENT_DESCRIPTION_MAX_LENGTH,
  ENVIRONMENT_NAME_MAX_LENGTH,
  RESPONSE_MODES,
  TOGGLE_VALUES,
  frameworkPresetOf,
} from './environment.inputs';
import type { ProjectRepository } from './environment.rules';
import { gitScopeOf } from './environment.rules';
import type { EnvironmentUpdateRequest } from './environment.update';
import { FRAMEWORK_CHOICES, SERVER_COMMAND_FRAMEWORKS } from './frameworks';
import type { Environment } from './types';

export const SETTINGS_QUESTION = 'Select the fields to update:';

export type EnvironmentChanges = Partial<
  Pick<
    EnvironmentUpdateRequest,
    | 'name'
    | 'description'
    | 'branch'
    | 'framework'
    | 'buildCmd'
    | 'serverCmd'
    | 'outputDir'
    | 'resMode'
    | 'autoDeploy'
    | 'csAuth'
    | 'cachePriming'
    | 'passwordProtection'
  >
>;

type Setting = keyof EnvironmentChanges;

export interface UpdatePromptContext {
  org: string;
  projectType?: string;
  repository?: ProjectRepository;
  current: Environment;
}

const SETTINGS: { setting: Setting; label: string; repositoryOnly?: boolean }[] = [
  { setting: 'name', label: 'Name' },
  { setting: 'description', label: 'Description' },
  { setting: 'branch', label: 'Branch', repositoryOnly: true },
  { setting: 'framework', label: 'Framework preset' },
  { setting: 'buildCmd', label: 'Build command' },
  { setting: 'serverCmd', label: 'Server command' },
  { setting: 'outputDir', label: 'Output directory' },
  { setting: 'resMode', label: 'Response mode' },
  { setting: 'autoDeploy', label: 'Auto deploy', repositoryOnly: true },
  { setting: 'csAuth', label: 'Contentstack Authentication' },
  { setting: 'cachePriming', label: 'Cache priming' },
  { setting: 'passwordProtection', label: 'Password protection' },
];

function toggleOf(value: boolean | undefined): ToggleValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value ? 'enable' : 'disable';
}

function changed<T>(answer: T | undefined, current: T | undefined): T | undefined {
  return answer === current ? undefined : answer;
}

export async function promptForEnvironmentUpdate(
  services: ServiceContext,
  context: UpdatePromptContext,
): Promise<EnvironmentChanges> {
  const offered = SETTINGS.filter((entry) => !(entry.repositoryOnly && context.projectType === 'FILEUPLOAD'));
  const picked = await askChoices(
    services.ux,
    SETTINGS_QUESTION,
    offered.map((entry) => ({ name: entry.label, value: entry.setting })),
  );
  const asker = new SettingAsker(services, context);
  const changes: EnvironmentChanges = {};

  for (const { setting } of offered.filter((entry) => picked.includes(entry.setting))) {
    const value = await asker.ask(setting, changes);

    if (value !== undefined) {
      Object.assign(changes, { [setting]: value });
    }
  }

  return changes;
}

class SettingAsker {
  constructor(
    private readonly services: ServiceContext,
    private readonly context: UpdatePromptContext,
  ) {}

  ask(setting: Setting, changes: EnvironmentChanges): Promise<string | undefined> {
    const current = this.context.current;
    const ux = this.services.ux;

    switch (setting) {
    case 'name':
      return this.text(askText(ux, 'Name', current.name, ENVIRONMENT_NAME_MAX_LENGTH), current.name);
    case 'description':
      return this.text(
        askOptionalText(ux, 'Description', current.description, ENVIRONMENT_DESCRIPTION_MAX_LENGTH),
        current.description,
      );
    case 'branch':
      return this.text(
        askBranch(this.services, gitScopeOf(this.context.org, this.context.repository), current.gitBranch),
        current.gitBranch,
      );
    case 'framework':
      return this.framework();
    case 'buildCmd':
      return this.text(askOptionalText(ux, 'Build command', current.buildCommand), current.buildCommand);
    case 'serverCmd':
      return this.serverCommand(changes);
    case 'outputDir':
      return this.text(askText(ux, 'Output directory', current.outputDirectory), current.outputDirectory);
    case 'resMode':
      return askOption(ux, 'Response mode', RESPONSE_MODES.map((value) => ({ name: value, value })), 'buffered');
    case 'autoDeploy':
      return this.toggle('Auto deploy', current.autoDeployOnPush);
    case 'csAuth':
      return this.toggle('Contentstack Authentication', current.isContentstackAuthenticationEnabled);
    case 'cachePriming':
      return this.toggle('Cache priming', current.isCachePrimingEnabled);
    default:
      return this.passwordProtection(current.passwordProtection?.isEnabled);
    }
  }

  private async text(answer: Promise<string | undefined>, current: string | undefined): Promise<string | undefined> {
    return changed(await answer, current);
  }

  private async framework(): Promise<string | undefined> {
    const current = this.context.current.frameworkPreset;
    const label = await askOption(
      this.services.ux,
      'Framework preset',
      FRAMEWORK_CHOICES.map((choice) => ({ name: choice, value: choice })),
      frameworkLabelOf(current),
    );

    return changed<string>(frameworkPresetOf(label), current);
  }

  private async serverCommand(changes: EnvironmentChanges): Promise<string | undefined> {
    const current = this.context.current;
    const framework = changes.framework ?? current.frameworkPreset;

    if (!SERVER_COMMAND_FRAMEWORKS.some((preset) => preset === framework)) {
      this.services.ux.print(
        framework === undefined
          ? 'Server command skipped: this environment has no framework that runs a server command.'
          : `Server command skipped: the ${framework} framework runs no server command.`,
      );
      return undefined;
    }

    return this.text(askOptionalText(this.services.ux, 'Server command', current.serverCommand), current.serverCommand);
  }

  private async passwordProtection(current: boolean | undefined): Promise<string | undefined> {
    const answer = await this.toggle('Password protection', current);

    return answer ?? (current === true ? 'enable' : undefined);
  }

  private async toggle(message: string, current: boolean | undefined): Promise<string | undefined> {
    const state = toggleOf(current);
    const answer = await askOption(
      this.services.ux,
      message,
      TOGGLE_VALUES.map((value) => ({ name: value, value })),
      state,
    );

    return changed(answer, state);
  }
}
