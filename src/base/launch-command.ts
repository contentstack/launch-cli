import { resolve as resolvePath } from 'node:path';

import { Command } from '@contentstack/cli-command';
import { FlagInput, cliux, configHandler, isAuthenticated } from '@contentstack/cli-utilities';

import { EXIT_CANCELLED, EXIT_RUNTIME, EXIT_USAGE, PROJECT_CONFIG_FILE } from '../config/constants';
import { readProjectConfig } from '../config/project-config';
import { RegionLike, resolveLaunchHubUrl } from '../config/region';
import { CancelledError, UsageError } from '../errors';
import { catalog, FlagKey } from '../flags/catalog';
import { InputsSpec } from '../flags/inputs';
import { resolveInputs } from '../flags/resolve';
import { Rule } from '../flags/rules';
import { LaunchApiError } from '../http/errors';
import { UxLike } from '../output/render';
import { ServiceContext, buildServiceContext } from './service-context';

export interface ResolveLaunchContextArgs<K extends FlagKey> {
  flags: Partial<Record<FlagKey, unknown>>;
  inputs: InputsSpec<K>;
  rules?: Rule[];
  launchHubUrl: string;
  analyticsInfo: string;
  ux: UxLike;
  isTTY: boolean;
}

export interface ResolveLaunchContextResult<K extends FlagKey> {
  services: ServiceContext;
  resolved: Record<K, unknown>;
}

export async function resolveLaunchContext<K extends FlagKey>(
  args: ResolveLaunchContextArgs<K>,
): Promise<ResolveLaunchContextResult<K>> {
  const dataDir = (args.flags['data-dir'] as string) || process.cwd();
  const configPath = (args.flags.config as string) || resolvePath(dataDir, PROJECT_CONFIG_FILE);

  const services = buildServiceContext({
    launchHubUrl: args.launchHubUrl,
    analyticsInfo: args.analyticsInfo,
    ux: args.ux,
    isTTY: args.isTTY,
  });

  const resolved = await resolveInputs(args.inputs, {
    parsed: args.flags,
    projectConfig: readProjectConfig(configPath),
    services,
    rules: args.rules,
  });

  return { services, resolved };
}

export abstract class LaunchCommand<K extends FlagKey = FlagKey> extends Command {
  static baseFlags = {
    config: catalog.config,
    'data-dir': catalog['data-dir'],
  };

  protected services!: ServiceContext;
  protected resolved!: Record<K, unknown>;
  protected ux: UxLike = cliux as unknown as UxLike;

  protected get launchRegion(): RegionLike | undefined {
    return configHandler.get('region') as RegionLike | undefined;
  }

  async init(): Promise<void> {
    await super.init();
    this.requireAuth();

    const { flags } = await this.parse({
      flags: (this.ctor as unknown as { flags: FlagInput }).flags,
      baseFlags: LaunchCommand.baseFlags as FlagInput,
      strict: true,
    });

    const { services, resolved } = await resolveLaunchContext({
      flags: flags as Partial<Record<FlagKey, unknown>>,
      inputs: (this.ctor as unknown as { inputs?: InputsSpec<K> }).inputs ?? ({} as InputsSpec<K>),
      rules: (this.ctor as unknown as { rules?: Rule[] }).rules,
      launchHubUrl: resolveLaunchHubUrl(this.launchRegion),
      analyticsInfo: this.config.userAgent,
      ux: this.ux,
      isTTY: Boolean(process.stdin.isTTY),
    });

    this.services = services;
    this.resolved = resolved;
  }

  protected async confirm(message: string): Promise<void> {
    const inputs = (this.ctor as unknown as { inputs?: InputsSpec<K> }).inputs;

    if (!inputs || !('yes' in inputs)) {
      throw new Error(`${this.constructor.name} calls confirm() but does not declare yes: {} in its static inputs.`);
    }

    if ((this.resolved as Record<string, unknown>).yes === true) {
      return;
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

    if (!confirmed) {
      throw new CancelledError();
    }
  }

  protected requireAuth(): void {
    if (!isAuthenticated()) {
      this.error('You are not logged in. Run csdx auth:login to continue.', { exit: EXIT_RUNTIME });
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    if (err instanceof UsageError) {
      return this.error(err.message, { exit: EXIT_USAGE });
    }

    if (err instanceof CancelledError) {
      return this.error(err.message, { exit: EXIT_CANCELLED });
    }

    if (err instanceof LaunchApiError) {
      return this.error(err.message, { exit: EXIT_RUNTIME });
    }

    return super.catch(err);
  }
}
