import { EXIT_USAGE } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import { writeToStderr } from '../../../core/failure';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import type { GetDeploymentParams } from '../../../deployments/deployments.api';
import { domainChoices, askForDomain } from '../../../site/site.prompt';
import { siteOpeningLine, siteUrlNotFoundLine } from '../../../site/site.presenter';
import type { SiteDomain } from '../../../site/site.url';
import { previewUrlOf, siteUrlOf } from '../../../site/site.url';
import { LaunchApiError } from '../../../transport/errors';

const openInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  deployment: {},
});

function notFoundAsUsage(error: unknown): never {
  if (error instanceof LaunchApiError && error.status === 404) {
    throw new UsageError(error.message);
  }

  throw error;
}

export default class SiteOpen extends LaunchCommand<typeof openInputs> {
  static description =
    "Open an environment's live site in your browser, or print its URL when there is no terminal. " +
    'On a terminal, when the environment has more than one domain, you choose which one to open; ' +
    "--deployment opens that deployment's preview URL without asking.";

  static examples = [
    '$ csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <uid>',
    '$ url=$(csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>)',
  ];

  static inputs = openInputs;

  static flags = flagsFor(openInputs);

  async run(): Promise<void> {
    const { org, project, env, deployment: deploymentUid } = this.resolved;
    const scope = { org, project, environment: env };
    const outputIsTTY = this.services.outputIsTTY === true;

    const environment = await this.services.api.environments.get(scope).catch(notFoundAsUsage);
    let url: string | undefined;

    if (deploymentUid === undefined) {
      url = siteUrlOf(await this.services.api.deployments.latest(scope), environment.domains);

      url = url === undefined ? url : await this.chosenUrl(url, environment.domains, outputIsTTY);
    } else {
      url = await this.previewUrlOfDeployment({ ...scope, deployment: deploymentUid });
    }

    if (url === undefined) {
      this.reportMissingUrl(outputIsTTY);
      this.exit(EXIT_USAGE);
    }

    if (!outputIsTTY) {
      this.ux.print(url);
      return;
    }

    this.ux.print(siteOpeningLine(url, outputIsTTY));
    this.services.openUrl?.(url);
  }

  private async chosenUrl(
    url: string,
    domains: readonly SiteDomain[] | undefined,
    outputIsTTY: boolean,
  ): Promise<string> {
    const choices = this.services.isTTY && outputIsTTY ? domainChoices(url, domains) : [];

    return choices.length > 1 ? askForDomain(this.ux, choices) : url;
  }

  private async previewUrlOfDeployment(params: GetDeploymentParams): Promise<string | undefined> {
    const deployment = await this.services.api.deployments.get(params).catch(notFoundAsUsage);

    return previewUrlOf(deployment);
  }

  private reportMissingUrl(outputIsTTY: boolean): void {
    const line = siteUrlNotFoundLine(outputIsTTY);

    if (outputIsTTY) {
      this.ux.print(line);
      return;
    }

    writeToStderr(line);
  }
}
