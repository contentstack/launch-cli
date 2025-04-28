import Launch from './index';
import { BaseCommand } from '../../base-command';
import { FileUpload, GitHub, PreCheck } from '../../adapters';
import { cliux } from '@contentstack/cli-utilities';

jest.mock('@contentstack/cli-utilities');

jest.mock('../../base-command');

describe('Run', () => {
  let launchCommandInstance: Launch;
  let prepareApiClientsMock: jest.SpyInstance;
  let preCheckRunMock: jest.SpyInstance;

  beforeEach(() => {
    prepareApiClientsMock = jest.spyOn(BaseCommand.prototype, 'prepareApiClients').mockResolvedValueOnce(undefined);
    // @ts-expect-error - Override readonly property context on BaseCommand for testing
    BaseCommand.prototype['context'] = { analyticsInfo: {} } as any;
    BaseCommand.prototype['$event'] = { on: jest.fn() } as any;
    preCheckRunMock = jest.spyOn(PreCheck.prototype, 'run').mockResolvedValueOnce(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully run launch command for provider GitHub', async () => {
    const githubRunMock = jest.spyOn(GitHub.prototype, 'run').mockResolvedValueOnce(undefined);
    BaseCommand.prototype['sharedConfig'] = { provider: 'GitHub', isExistingProject: true } as any;
    BaseCommand.prototype['flags'] = { init: false };
    launchCommandInstance = new Launch([], {} as any);

    await launchCommandInstance.run();

    expect(prepareApiClientsMock).toHaveBeenCalled();
    expect(preCheckRunMock).toHaveBeenCalled();
    expect(githubRunMock).toHaveBeenCalled();
  });

  it('should successfully run launch command for provider FileUpload', async () => {
    const fileUploadRunMock = jest.spyOn(FileUpload.prototype, 'run').mockResolvedValueOnce(undefined);
    BaseCommand.prototype['sharedConfig'] = { provider: 'FileUpload', isExistingProject: true } as any;
    BaseCommand.prototype['flags'] = { init: false };
    launchCommandInstance = new Launch([], {} as any);

    await launchCommandInstance.run();

    expect(prepareApiClientsMock).toHaveBeenCalled();
    expect(preCheckRunMock).toHaveBeenCalled();
    expect(fileUploadRunMock).toHaveBeenCalled();
  });

  it('should successfully run launch command for other providers', async () => {
    const connectToAdapterOnUiMock = jest
      .spyOn(PreCheck.prototype, 'connectToAdapterOnUi')
      .mockResolvedValueOnce(undefined);
    BaseCommand.prototype['sharedConfig'] = { provider: 'OtherProvider', isExistingProject: true } as any;
    BaseCommand.prototype['flags'] = { init: false };
    launchCommandInstance = new Launch([], {} as any);

    await launchCommandInstance.run();

    expect(prepareApiClientsMock).toHaveBeenCalled();
    expect(preCheckRunMock).toHaveBeenCalled();
    expect(connectToAdapterOnUiMock).toHaveBeenCalled();
  });

  it(`should successfully run launch command when its a new project,
     and prompt to select the project type`, 
  async () => {
    const githubRunMock = jest.spyOn(GitHub.prototype, 'run').mockResolvedValueOnce(undefined);
    BaseCommand.prototype['sharedConfig'] = { provider: 'GitHub', isExistingProject: false } as any;
    BaseCommand.prototype['flags'] = { init: false };
    (cliux.inquire as jest.Mock).mockResolvedValueOnce('GitHub');
    launchCommandInstance = new Launch([], {} as any);

    await launchCommandInstance.run();

    expect(prepareApiClientsMock).toHaveBeenCalled();
    expect(preCheckRunMock).toHaveBeenCalled();
    expect(githubRunMock).toHaveBeenCalled();
    expect(cliux.inquire).toHaveBeenCalledWith({
      choices: [
        { name: 'Continue with GitHub', value: 'GitHub' },
        { name: 'Continue with FileUpload', value: 'FileUpload' },
      ],
      type: 'search-list',
      name: 'projectType',
      message: 'Choose a project type to proceed',
    });
  });
});
