import { resolve as resolvePath } from 'node:path';

import { Command } from '@contentstack/cli-command';
import { FlagInput, cliux, configHandler, isAuthenticated } from '@contentstack/cli-utilities';

import { EXIT_CANCELLED, EXIT_RUNTIME, EXIT_USAGE, PROJECT_CONFIG_FILE } from './constants';
import { readProjectConfig } from './project-config';
import { RegionLike, resolveLaunchHubUrl } from './region';
import { CancelledError, UsageError } from './errors';
import { catalog, FlagKey } from '../resources';
import { AnyInputs, Resolved } from './inputs';
import { resolveInputs } from './resolve';
import { Rule } from './rules';
import { LaunchApiError } from '../transport/errors';
import { UxLike } from './render';
import { ServiceContext, buildServiceContext } from './service-context';

export interface ResolveLaunchContextArgs<S extends AnyInputs> {
  flags: Partial<Record<FlagKey, unknown>>;
  inputs: S;
  rules?: Rule[];
  launchHubUrl: string;
  analyticsInfo: string;
  ux: UxLike;
  isTTY: boolean;
}

export interface ResolveLaunchContextResult<S extends AnyInputs> {
  services: ServiceContext;
  resolved: Resolved<S>;
}

export async function resolveLaunchContext<S extends AnyInputs>(
  args: ResolveLaunchContextArgs<S>,
): Promise<ResolveLaunchContextResult<S>> {
  const dataDir = stringFlag(args.flags['data-dir']) || process.cwd();
  const configPath = stringFlag(args.flags.config) || resolvePath(dataDir, PROJECT_CONFIG_FILE);

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
  protected ux: UxLike = cliux as unknown as UxLike;

  protected get launchRegion(): RegionLike | undefined {
    return configHandler.get('region') as RegionLike | undefined;
  }

  async init(): Promise<void> {
    await super.init();
    this.requireAuth();

    const { flags } = await this.parse({
      flags: this.contract.flags as FlagInput,
      baseFlags: LaunchCommand.baseFlags as FlagInput,
      strict: true,
    });

    const { services, resolved } = await resolveLaunchContext<S>({
      flags: flags as Partial<Record<FlagKey, unknown>>,
      inputs: this.contract.inputs as S,
      rules: this.contract.rules,
      launchHubUrl: resolveLaunchHubUrl(this.launchRegion),
      analyticsInfo: this.config.userAgent,
      ux: this.ux,
      isTTY: Boolean(process.stdin.isTTY),
    });

    this.services = services;
    this.resolved = resolved;
  }

  protected async confirm(message: string): Promise<void> {
    const inputs = this.contract.inputs;

    if (!inputs || !('yes' in inputs)) {
      throw new Error(`${this.constructor.name} calls confirm() but does not declare yes: {} in its static inputs.`);
    }

    if (this.resolvedValues.yes === true) {
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
