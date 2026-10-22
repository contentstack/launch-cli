import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { aliasRequiresFromStack } from '../../../variables/variable.rules';
import { VariableSetter } from '../../../variables/variable.set';

const setInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  var: {},
  dotenv: {},
  'from-stack': {},
  alias: {},
});

export default class VariablesSet extends LaunchCommand<typeof setInputs> {
  static description =
    'Add or change environment variables from --var, --dotenv or a detected .env file; later sources win';

  static examples = [
    '$ csdx launch:variables:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--var API_URL=https://example.test DEBUG=true',
    '$ csdx launch:variables:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--dotenv .env.staging',
    '$ printf \'%s\' "$TOKEN" | csdx launch:variables:set --org <org-uid> --project <name-or-uid> ' +
      '--env <name-or-uid> --var API_TOKEN',
  ];

  static inputs = setInputs;

  static flags = flagsFor(setInputs);

  static rules = [aliasRequiresFromStack];

  async run(): Promise<void> {
    await new VariableSetter(this.services).set({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
      vars: this.resolved.var,
      envFiles: this.resolved['dotenv'],
      fromStack: this.resolved['from-stack'],
      alias: this.resolved.alias,
      dataDir: this.dataDir,
    });
  }
}
