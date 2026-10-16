import { UsageError } from '../core/errors';
import { askSecret, askText } from '../core/prompt';
import { readPipedInput } from '../core/piped-input';
import { requireValueOf } from '../core/rules';
import type { ServiceContext } from '../core/service-context';
import type { ResponseMode, ToggleValue } from './environment.inputs';
import { usernameOf } from './environment.inputs';
import { withoutRepositoryFlags } from './environment.rules';
import {
  disableQuestion,
  environmentNoChangesLine,
  environmentNotUpdatedLine,
  environmentUpdatedLine,
} from './environment.presenter';
import { promptForEnvironmentUpdate } from './environment.update.prompt';
import type { FrameworkPreset } from './frameworks';
import { SERVER_COMMAND_FRAMEWORKS } from './frameworks';
import type { EnvironmentUpdate, PasswordProtectionUpdate } from './types';

export interface EnvironmentUpdateRequest {
  org: string;
  project: string;
  environment: string;
  name?: string;
  description?: string;
  branch?: string;
  framework?: FrameworkPreset;
  buildCmd?: string;
  serverCmd?: string;
  outputDir?: string;
  resMode?: ResponseMode;
  autoDeploy?: ToggleValue;
  csAuth?: ToggleValue;
  cachePriming?: ToggleValue;
  passwordProtection?: ToggleValue;
  username?: string;
  password: boolean;
}

export type Confirm = (question: string) => Promise<boolean>;

const PIPE_THE_PASSWORD =
  'Without a terminal, --password-protection enable reads the password from standard input: pass -p and pipe it in, ' +
  'e.g. printf \'%s\' "$PASSWORD" | csdx launch:env:update ... -u <username> -p';

const USERNAME_WITHOUT_A_TERMINAL = 'Without a terminal, --password-protection enable needs --username (-u).';

const EMPTY_PIPED_PASSWORD = 'No password was read from standard input; pipe a non-empty password into -p.';

export type ReadSecret = () => Promise<string>;

function pipedPassword(text: string): string {
  const password = text.replace(/\r?\n$/, '');

  if (password.trim() === '') {
    throw new UsageError(EMPTY_PIPED_PASSWORD);
  }

  return password;
}

const UPDATABLE_FLAGS: [keyof EnvironmentUpdateRequest, string][] = [
  ['name', 'name'],
  ['description', 'description'],
  ['branch', 'branch'],
  ['framework', 'framework'],
  ['buildCmd', 'build-cmd'],
  ['serverCmd', 'server-cmd'],
  ['outputDir', 'output-dir'],
  ['resMode', 'res-mode'],
  ['autoDeploy', 'auto-deploy'],
  ['csAuth', 'cs-auth'],
  ['cachePriming', 'cache-priming'],
  ['passwordProtection', 'password-protection'],
];

export type UpdateOutcome = 'updated' | 'cancelled' | 'unchanged';

function hasChanges(request: EnvironmentUpdateRequest): boolean {
  return UPDATABLE_FLAGS.some(([field]) => request[field] !== undefined);
}

function emptyUpdateMessage(): string {
  const flags = UPDATABLE_FLAGS.map(([, flag]) => `--${flag}`).join(', ');

  return `Pass at least one of ${flags}; none was supplied.`;
}

function enabled(toggle: ToggleValue | undefined): boolean | undefined {
  return toggle === undefined ? undefined : toggle === 'enable';
}

function bodyOf(
  request: EnvironmentUpdateRequest,
  passwordProtection: PasswordProtectionUpdate | undefined,
): EnvironmentUpdate {
  const fields: EnvironmentUpdate = {
    name: request.name,
    description: request.description,
    gitBranch: request.branch,
    frameworkPreset: request.framework,
    buildCommand: request.buildCmd,
    serverCommand: request.serverCmd,
    outputDirectory: request.outputDir,
    isStreamingEnabled: request.resMode === undefined ? undefined : request.resMode === 'streaming',
    autoDeployOnPush: enabled(request.autoDeploy),
    isContentstackAuthenticationEnabled: enabled(request.csAuth),
    isCachePrimingEnabled: enabled(request.cachePriming),
    passwordProtection,
  };

  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as EnvironmentUpdate;
}

function refuseCredentialsWithoutEnabling(request: EnvironmentUpdateRequest): void {
  if (request.passwordProtection === 'enable') {
    return;
  }

  if (request.username !== undefined) {
    throw new UsageError('--username is only supported with --password-protection enable.');
  }

  if (request.password) {
    throw new UsageError('--password is only supported with --password-protection enable.');
  }
}

export class EnvironmentUpdater {
  constructor(
    private readonly services: ServiceContext,
    private readonly confirm: Confirm,
    private readonly readSecret: ReadSecret = readPipedInput,
  ) {}

  async update(given: EnvironmentUpdateRequest): Promise<UpdateOutcome> {
    const { org, project, environment } = given;
    const asking = !hasChanges(given);

    refuseCredentialsWithoutEnabling(given);

    if (asking && !this.services.isTTY) {
      throw new UsageError(emptyUpdateMessage());
    }

    if (given.passwordProtection === 'enable' && !this.services.isTTY && !given.password) {
      throw new UsageError(PIPE_THE_PASSWORD);
    }

    if (given.passwordProtection === 'enable' && !this.services.isTTY && given.username === undefined) {
      throw new UsageError(USERNAME_WITHOUT_A_TERMINAL);
    }

    const [current, existing] = await Promise.all([
      this.services.api.projects.get({ org, project }),
      this.services.api.environments.get({ org, project, environment }),
    ]);
    const answered = asking
      ? {
        ...given,
        ...(await promptForEnvironmentUpdate(this.services, {
          org,
          projectType: current.projectType,
          repository: current.repository,
          current: existing,
        })),
      }
      : given;
    const request = withoutRepositoryFlags(
      answered,
      current.projectType,
      this.services.ux,
      this.services.outputIsTTY === true,
    );

    if (!hasChanges(request)) {
      this.services.ux.print(environmentNoChangesLine(this.services.outputIsTTY === true));
      return 'unchanged';
    }

    if (request.serverCmd !== undefined && request.framework === undefined) {
      requireValueOf('server-cmd', 'framework', SERVER_COMMAND_FRAMEWORKS, existing.frameworkPreset ?? 'not set');
    }

    if (!(await this.confirmDisabling(request))) {
      this.services.ux.print(environmentNotUpdatedLine(this.services.outputIsTTY === true));
      return 'cancelled';
    }

    const passwordProtection = await this.passwordProtectionOf(request);

    await this.services.api.environments.update({
      org,
      project,
      environment,
      update: bodyOf(request, passwordProtection),
    });

    this.services.ux.print(environmentUpdatedLine(this.services.outputIsTTY === true));

    return 'updated';
  }

  private async passwordProtectionOf(request: EnvironmentUpdateRequest): Promise<PasswordProtectionUpdate | undefined> {
    if (request.passwordProtection === 'disable') {
      return { isEnabled: false };
    }

    if (request.passwordProtection !== 'enable') {
      return undefined;
    }

    const username = request.username ?? (await usernameOf(await askText(this.services.ux, 'Username')));
    const password = this.services.isTTY
      ? await askSecret(this.services.ux, 'Password')
      : pipedPassword(await this.readSecret());

    return { isEnabled: true, username, password };
  }

  private async confirmDisabling(request: EnvironmentUpdateRequest): Promise<boolean> {
    const disabling = [
      request.cachePriming === 'disable' ? 'cache priming' : undefined,
      request.passwordProtection === 'disable' ? 'password protection' : undefined,
    ].filter((feature): feature is string => feature !== undefined);

    for (const feature of disabling) {
      if (!(await this.confirm(disableQuestion(feature)))) {
        return false;
      }
    }

    return true;
  }
}
