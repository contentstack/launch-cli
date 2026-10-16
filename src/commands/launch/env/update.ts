import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { EXIT_CANCELLED } from '../../../core/constants';
import { serverCommandFrameworkGate, withEnvironmentWording } from '../../../environments/environment.inputs';
import { EnvironmentUpdater } from '../../../environments/environment.update';

const updateInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  name: {},
  description: {},
  branch: {},
  framework: {},
  'build-cmd': {},
  'server-cmd': {},
  'output-dir': {},
  'res-mode': {},
  'auto-deploy': {},
  'cs-auth': {},
  'cache-priming': {},
  'password-protection': {},
  username: {},
  password: {},
  yes: {},
});

export default class EnvironmentsUpdate extends LaunchCommand<typeof updateInputs> {
  static description = 'Update an environment of a Launch project';

  static examples = [
    '$ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> --build-cmd "npm run build"',
    '$ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--cache-priming disable --yes',
    '$ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--password-protection enable -u <username> -p',
    '$ printf \'%s\' "$PASSWORD" | csdx launch:env:update --org <org-uid> --project <name-or-uid> ' +
      '--env <name-or-uid> --password-protection enable -u <username> -p',
  ];

  static inputs = updateInputs;

  static flags = withEnvironmentWording(flagsFor(updateInputs));

  static rules = [serverCommandFrameworkGate];

  async run(): Promise<void> {
    const resolved = this.resolved;
    const updater = new EnvironmentUpdater(this.services, (question) => this.confirm(question));

    const outcome = await updater.update({
      org: resolved.org,
      project: resolved.project,
      environment: resolved.env,
      name: resolved.name,
      description: resolved.description,
      branch: resolved.branch,
      framework: resolved.framework,
      buildCmd: resolved['build-cmd'],
      serverCmd: resolved['server-cmd'],
      outputDir: resolved['output-dir'],
      resMode: resolved['res-mode'],
      autoDeploy: resolved['auto-deploy'],
      csAuth: resolved['cs-auth'],
      cachePriming: resolved['cache-priming'],
      passwordProtection: resolved['password-protection'],
      username: resolved.username,
      password: resolved.password,
    });

    if (outcome === 'cancelled') {
      this.exit(EXIT_CANCELLED);
    }
  }
}
