import { dirname, join } from 'path';

import { CloudFunctions } from './cloud-functions';
import { Contentfly } from './contentfly';

jest.mock('./cloud-functions', () => ({ CloudFunctions: jest.fn() }));

const constructedWith: string[] = [];
const servedPorts: number[] = [];
let serveResult: () => Promise<void>;

beforeEach(() => {
  constructedWith.length = 0;
  servedPorts.length = 0;
  serveResult = async () => undefined;
  (CloudFunctions as unknown as jest.Mock).mockImplementation((pathToSourceCode: string) => {
    constructedWith.push(pathToSourceCode);
    return {
      serve: async (port: number) => {
        servedPorts.push(port);
        return serveResult();
      },
    };
  });
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('Contentfly', () => {
  it('passes an absolute directory through untouched', () => {
    new Contentfly('/project/root');

    expect(constructedWith).toEqual(['/project/root']);
  });

  it('resolves a relative directory against the current working directory', () => {
    new Contentfly('nested/dir');

    expect(constructedWith).toEqual([join(process.cwd(), 'nested', 'dir')]);
  });

  it('resolves an empty directory to the current working directory', () => {
    new Contentfly('');

    expect(constructedWith).toEqual([process.cwd()]);
  });

  it('resolves a dot directory to the current working directory', () => {
    new Contentfly('.');

    expect(constructedWith).toEqual([process.cwd()]);
  });

  it('resolves leading parent segments against the current working directory rather than stripping them', () => {
    new Contentfly('../../escape');

    expect(constructedWith).toEqual([join(dirname(dirname(process.cwd())), 'escape')]);
  });

  it('forwards the serving port to the cloud functions server', async () => {
    await new Contentfly('/project/root').serveCloudFunctions(4000);

    expect(servedPorts).toEqual([4000]);
  });

  it('forwards port zero rather than treating it as absent', async () => {
    await new Contentfly('/project/root').serveCloudFunctions(0);

    expect(servedPorts).toEqual([0]);
  });

  it('propagates a rejection raised while serving', async () => {
    serveResult = async () => {
      throw new Error('listen failed');
    };

    await expect(new Contentfly('/project/root').serveCloudFunctions(4000)).rejects.toThrow('listen failed');
    expect(servedPorts).toEqual([4000]);
  });
});
