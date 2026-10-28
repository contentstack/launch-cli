import { criterionOf } from '../../../cache/cache.inputs';
import { purgeInitiatedLines } from '../../../cache/cache.presenter';
import { flagsFor, inputs } from '../../../core/inputs';
import { UsageError } from '../../../core/errors';
import { LaunchCommand } from '../../../core/launch-command';
import { exactlyOneOf } from '../../../core/rules';
import { LaunchApiError } from '../../../transport/errors';

const purgeInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  path: {},
  tags: {},
  hosts: {},
});

export default class CachePurge extends LaunchCommand<typeof purgeInputs> {
  static description = "Purge an environment's CDN cache by path, cache tags or hostnames";

  static examples = [
    '$ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --path /blog',
    '$ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --path "/blog/*"',
    '$ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --tags header,footer',
    '$ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --hosts www.example.com',
  ];

  static inputs = purgeInputs;

  static flags = flagsFor(purgeInputs);

  static rules = [exactlyOneOf('path', 'tags', 'hosts')];

  async run(): Promise<void> {
    const { org, project, env, path, tags, hosts } = this.resolved;
    const scope = { org, project, environment: env };
    const target = { path, tags, hosts };

    await this.services.api.environments.get(scope).catch((error: unknown) => {
      if (error instanceof LaunchApiError && error.status === 404) {
        throw new UsageError(`No environment with UID "${env}" found in this project.`);
      }

      throw error;
    });

    await this.services.api.cache.purge({ ...scope, criterion: criterionOf(target) });

    for (const line of purgeInitiatedLines(target, this.services.outputIsTTY === true)) {
      this.ux.print(line);
    }
  }
}
