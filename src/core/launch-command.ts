import { resolve as resolvePath } from 'node:path';

import { Command } from '@contentstack/cli-command';
import { cliux, configHandler, isAuthenticated } from '@contentstack/cli-utilities';

import { EXIT_RUNTIME, PROJECT_CONFIG_FILE, STDIN_MAX_LISTENERS } from './constants';
import { ProjectConfig, ProjectConfigStore, configSourceNotice } from './project-config';
import { RegionLike, resolveLaunchHubUrl } from './region';
import { LaunchError, UsageError } from './errors';
import { catalog, FlagKey, resolutionTable } from '../resources';
import { AnyInputs, Resolved } from './inputs';
import { resolveInputsTraced } from './resolve';
import { Rule } from './rules';
import { cancelOnInterrupt } from './interruptible-ux';
import { UxLike } from './render';
import { registerSearchList } from './search-list';
import { ServiceContext, buildServiceContext } from './service-context';

export interface ResolveLaunchContextArgs<S extends AnyInputs> {
  flags: Partial<Record<FlagKey, unknown>>;
  inputs: S;
  rules?: Rule[];
  launchHubUrl: string;
  cma?: string;
  uiHost?: string;
  analyticsInfo: string;
  ux: UxLike;
  isTTY: boolean;
  outputIsTTY?: boolean;
}

export interface ResolveLaunchContextResult<S extends AnyInputs> {
  services: ServiceContext;
  resolved: Resolved<S>;
  dataDir: string;
  configPath: string;
  configNotice?: string;
}

export async function resolveLaunchContext<S extends AnyInputs>(
  args: ResolveLaunchContextArgs<S>,
): Promise<ResolveLaunchContextResult<S>> {
  const dataDir = stringFlag(args.flags['data-dir']) || process.cwd();
  const namedConfig = stringFlag(args.flags.config);
  const configPath = namedConfig || resolvePath(dataDir, PROJECT_CONFIG_FILE);

  const services = buildServiceContext({
    launchHubUrl: args.launchHubUrl,
    cma: args.cma,
    uiHost: args.uiHost,
    analyticsInfo: args.analyticsInfo,
    ux: args.ux,
    isTTY: args.isTTY,
    outputIsTTY: args.outputIsTTY,
  });

  const { resolved, sources } = await resolveInputsTraced(args.inputs, {
    parsed: args.flags,
    projectConfig: projectConfigLoader(new ProjectConfigStore(configPath, Boolean(namedConfig)), Boolean(namedConfig)),
    services,
    rules: args.rules,
  });

  const configLabels = Object.entries(sources)
    .filter(([, source]) => source === 'config')
    .map(([key]) => resolutionTable[key as FlagKey].configLabel)
    .filter((label): label is string => label !== undefined);
  const configNotice = configSourceNotice(configLabels, resolvePath(configPath), args.outputIsTTY === true);

  return { services, resolved, dataDir, configPath, configNotice };
}

export function projectConfigLoader(store: ProjectConfigStore, named: boolean): ProjectConfig | (() => ProjectConfig) {
  if (named) {
    return store.load();
  }

  let loaded: ProjectConfig | undefined;

  return () => {
    loaded = loaded ?? store.load();

    return loaded;
  };
}

function stringFlag(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export abstract class LaunchCommand<S extends AnyInputs = AnyInputs> extends Command {
  static baseFlags = {
    config: catalog.config,
    'data-dir': catalog['data-dir'],
  };

  static inputs: AnyInputs = {};

  static rules: Rule[] | undefined = undefined;

  protected services!: ServiceContext;
  protected resolved!: Resolved<S>;
  protected dataDir!: string;
  protected configPath!: string;
  protected ux: UxLike = cancelOnInterrupt(cliux);

  protected get launchRegion(): RegionLike | undefined {
    return configHandler.get('region') as RegionLike | undefined;
  }

  async init(): Promise<void> {
    await super.init();
    registerSearchList();
    process.stdin.setMaxListeners(STDIN_MAX_LISTENERS);

    const { flags } = await this.parse({
      flags: this.contract.flags,
      baseFlags: LaunchCommand.baseFlags,
      strict: true,
    });

    this.requireAuth();

    const region = this.launchRegion ?? {};

    const { services, resolved, dataDir, configPath, configNotice } = await resolveLaunchContext<S>({
      flags,
      inputs: this.contract.inputs as S,
      rules: this.contract.rules,
      launchHubUrl: resolveLaunchHubUrl(region),
      cma: region.cma,
      uiHost: region.uiHost,
      analyticsInfo: this.config.userAgent,
      ux: this.ux,
      isTTY: Boolean(process.stdin.isTTY),
      outputIsTTY: Boolean(process.stdout.isTTY),
    });

    this.services = services;
    this.resolved = resolved;
    this.dataDir = dataDir;
    this.configPath = configPath;

    if (configNotice !== undefined) {
      this.ux.print(configNotice);
    }
  }

  protected async confirm(message: string): Promise<boolean> {
    const inputs = this.contract.inputs;

    if (!('yes' in inputs)) {
      throw new Error(`${this.constructor.name} calls confirm() but does not declare yes: {} in its static inputs.`);
    }

    if (this.resolvedValues.yes === true) {
      return true;
    }

    if (!this.services.isTTY) {
      throw new UsageError(`${message} Pass --yes to confirm without an interactive terminal.`);
    }

    const confirmed = await this.ux.inquire<boolean>({
      type: 'confirm',
      name: 'confirm',
      message,
      default: false,
    });

    return confirmed === true;
  }

  protected get contract(): typeof LaunchCommand {
    return this.constructor as typeof LaunchCommand;
  }

  protected get resolvedValues(): Partial<Record<FlagKey, unknown>> {
    return this.resolved;
  }

  protected requireAuth(): void {
    if (!isAuthenticated()) {
      this.error('You are not logged in. Run csdx auth:login to continue.', { exit: EXIT_RUNTIME });
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    if (err instanceof LaunchError) {
      return err.reported ? this.exit(err.exitCode) : this.error(err.message, { exit: err.exitCode });
    }

    return super.catch(err);
  }
}
