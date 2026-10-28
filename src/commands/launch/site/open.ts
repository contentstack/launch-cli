import { EXIT_USAGE } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import { writeToStderr } from '../../../core/failure';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import type { GetDeploymentParams } from '../../../deployments/deployments.api';
import { siteOpeningLine, siteUrlNotFoundLine } from '../../../site/site.presenter';
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
  static description = "Open an environment's live site in your browser, or print its URL when there is no terminal";

  static examples = [
    '$ csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ url=$(csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>)',
  ];

  static inputs = openInputs;

  static flags = flagsFor(openInputs);

  async run(): Promise<void> {
    const { org, project, env, deployment: deploymentUid } = this.resolved;
    const scope = { org, project, environment: env };
    const outputIsTTY = this.services.outputIsTTY === true;

    const environment = await this.services.api.environments.get(scope).catch(notFoundAsUsage);
    const url =
      deploymentUid === undefined
        ? siteUrlOf(await this.services.api.deployments.latest(scope), environment.domains)
        : await this.previewUrlOfDeployment({ ...scope, deployment: deploymentUid });

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
