import { randomUUID } from 'node:crypto';

import { UsageError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import type { EnvironmentUpdateRequest } from './environment.update';
import { EnvironmentUpdater } from './environment.update';
import { SETTINGS_QUESTION } from './environment.update.prompt';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const FAILURE = new Error('request failed');
const TYPED_PASSWORD = randomUUID();
const NEW_PASSWORD = randomUUID();
const PIPED_PASSWORD = randomUUID();

interface Harness {
  isTTY?: boolean;
  projectType?: string;
  frameworkPreset?: string;
  answers?: Record<string, unknown>;
  confirmations?: boolean[];
  fails?: 'project' | 'environment' | 'update';
  passwordProtected?: boolean;
  piped?: string;
}

function updaterUnderTest(harness: Harness = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const asked: string[] = [];
  const questions: string[] = [];
  const sent: unknown[] = [];
  let confirmIndex = 0;

  const services = {
    isTTY: harness.isTTY ?? true,
    outputIsTTY: false,
    ux: {
      print: (message: string) => {
        lines.push(message);
      },
      inquire: async (payload: { message: string }) => {
        asked.push(payload.message);
        return harness.answers?.[payload.message];
      },
    },
    api: {
      projects: {
        get: async (params: unknown) => {
          calls.push(`project ${JSON.stringify(params)}`);
          if (harness.fails === 'project') {
            throw FAILURE;
          }
          return { uid: 'proj1', projectType: harness.projectType ?? 'GITPROVIDER' };
        },
      },
      environments: {
        get: async (params: unknown) => {
          calls.push(`environment ${JSON.stringify(params)}`);
          if (harness.fails === 'environment') {
            throw FAILURE;
          }
          return {
            uid: 'env1',
            frameworkPreset: 'frameworkPreset' in harness ? harness.frameworkPreset : 'NEXTJS',
            passwordProtection: { isEnabled: harness.passwordProtected ?? false },
          };
        },
        update: async (params: unknown) => {
          calls.push('update');
          sent.push(params);
          if (harness.fails === 'update') {
            throw FAILURE;
          }
          return { uid: 'env1' };
        },
      },
    },
  } as unknown as ServiceContext;

  const confirm = async (question: string): Promise<boolean> => {
    questions.push(question);
    const answer = harness.confirmations?.[confirmIndex] ?? true;
    confirmIndex += 1;
    return answer;
  };

  const readSecret = async (): Promise<string> => {
    calls.push('stdin');
    return harness.piped ?? '';
  };
  const updater = new EnvironmentUpdater(services, confirm, readSecret);

  return { updater, calls, lines, asked, questions, sent };
}

function request(fields: Partial<EnvironmentUpdateRequest>): EnvironmentUpdateRequest {
  return { ...SCOPE, password: false, ...fields };
}

describe('EnvironmentUpdater', () => {
  it('maps every supplied flag onto its body field and sends one PUT', async () => {
    const { updater, sent, lines } = updaterUnderTest();

    await expect(
      updater.update(
        request({
          name: 'renamed',
          description: 'the live site',
          branch: 'release',
          framework: 'NEXTJS',
          buildCmd: 'npm run build',
          serverCmd: 'npm start',
          outputDir: './.next',
          resMode: 'streaming',
          autoDeploy: 'disable',
          csAuth: 'enable',
          cachePriming: 'enable',
        }),
      ),
    ).resolves.toBe('updated');

    expect(sent).toEqual([
      {
        ...SCOPE,
        update: {
          name: 'renamed',
          description: 'the live site',
          gitBranch: 'release',
          frameworkPreset: 'NEXTJS',
          buildCommand: 'npm run build',
          serverCommand: 'npm start',
          outputDirectory: './.next',
          isStreamingEnabled: true,
          autoDeployOnPush: false,
          isContentstackAuthenticationEnabled: true,
          isCachePrimingEnabled: true,
        },
      },
    ]);
    expect(lines).toEqual(['✔ Environment updated successfully.']);
  });

  it.each([[{}]])(
    'refuses %p off a terminal with a usage error naming every updatable flag, before reading or sending anything',
    async (fields) => {
      const { updater, calls } = updaterUnderTest({ isTTY: false });

      const failure = await updater.update(request(fields)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(UsageError);
      expect((failure as Error).message).toBe(
        'Pass at least one of --name, --description, --branch, --framework, --build-cmd, --server-cmd, ' +
          '--output-dir, --res-mode, --auto-deploy, --cs-auth, --cache-priming, --password-protection; ' +
          'none was supplied.',
      );
      expect(calls).toEqual([]);
    },
  );

  it.each([
    [{ branch: 'release' }, '--branch'],
    [{ autoDeploy: 'enable' as const }, '--auto-deploy'],
  ])('warns that %p does not apply to a FileUpload project and, with nothing else to change, sends nothing', async (fields, flag) => {
    const { updater, calls, lines } = updaterUnderTest({ projectType: 'FILEUPLOAD' });

    await expect(updater.update(request(fields))).resolves.toBe('unchanged');

    expect(lines).toEqual([
      `warn: ${flag} is not supported for FileUpload projects.`,
      'Environment not updated. No changes were entered.',
    ]);
    expect(calls).not.toContain('update');
  });

  it('drops the repository-only flags of a FileUpload project and sends the rest', async () => {
    const { updater, sent, lines } = updaterUnderTest({ projectType: 'FILEUPLOAD' });

    await updater.update(request({ name: 'renamed', branch: 'release', autoDeploy: 'enable' }));

    expect(lines).toEqual([
      'warn: --branch is not supported for FileUpload projects.',
      'warn: --auto-deploy is not supported for FileUpload projects.',
      '\u2714 Environment updated successfully.',
    ]);
    expect(sent).toEqual([{ ...SCOPE, update: { name: 'renamed' } }]);
  });

  it('reads the project and the environment before sending the update', async () => {
    const { updater, calls } = updaterUnderTest({ projectType: 'FILEUPLOAD' });

    await updater.update(request({ name: 'renamed' }));

    expect(calls).toEqual([
      'project {"org":"org1","project":"proj1"}',
      'environment {"org":"org1","project":"proj1","environment":"env1"}',
      'update',
    ]);
  });

  it('refuses --server-cmd without --framework when the current framework takes no server command', async () => {
    const { updater, calls } = updaterUnderTest({ frameworkPreset: 'GATSBY' });

    const failure = await updater.update(request({ serverCmd: 'npm start' })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is GATSBY.',
    );
    expect(calls).not.toContain('update');
  });

  it('refuses --server-cmd without --framework when the environment reports no framework at all', async () => {
    const { updater, calls } = updaterUnderTest({ frameworkPreset: undefined });

    await expect(updater.update(request({ serverCmd: 'npm start' }))).rejects.toThrow(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is not set.',
    );
    expect(calls).not.toContain('update');
  });

  it.each([
    [{ serverCmd: 'npm start' }, 'NUXT'],
    [{ serverCmd: 'npm start', framework: 'NUXT' as const }, 'GATSBY'],
  ])('sends %p when the framework it will run under is %s-compatible', async (fields, current) => {
    const { updater, calls } = updaterUnderTest({ frameworkPreset: current });

    await updater.update(request(fields));

    expect(calls).toContain('update');
  });

  it.each([
    [{ name: 'renamed', username: 'admin' }, '--username'],
    [{ name: 'renamed', password: true }, '--password'],
    [{ passwordProtection: 'disable' as const, username: 'admin' }, '--username'],
    [{ passwordProtection: 'disable' as const, password: true }, '--password'],
  ])('refuses %p, because credentials only apply when enabling password protection', async (fields, flag) => {
    const { updater, calls, questions } = updaterUnderTest();

    const failure = await updater.update(request(fields)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(`${flag} is only supported with --password-protection enable.`);
    expect(questions).toEqual([]);
    expect(calls).not.toContain('update');
  });

  it('asks before disabling cache priming and sends the toggle once confirmed', async () => {
    const { updater, questions, sent } = updaterUnderTest();

    await expect(updater.update(request({ cachePriming: 'disable' }))).resolves.toBe('updated');

    expect(questions).toEqual(['Are you sure you want to disable cache priming for this environment?']);
    expect(sent).toEqual([{ ...SCOPE, update: { isCachePrimingEnabled: false } }]);
  });

  it('asks before disabling password protection and sends only isEnabled false once confirmed', async () => {
    const { updater, questions, sent } = updaterUnderTest();

    await updater.update(request({ passwordProtection: 'disable' }));

    expect(questions).toEqual(['Are you sure you want to disable password protection for this environment?']);
    expect(sent).toEqual([{ ...SCOPE, update: { passwordProtection: { isEnabled: false } } }]);
  });

  it('asks both questions, cache priming first, when both are being disabled', async () => {
    const { updater, questions } = updaterUnderTest();

    await updater.update(request({ cachePriming: 'disable', passwordProtection: 'disable' }));

    expect(questions).toEqual([
      'Are you sure you want to disable cache priming for this environment?',
      'Are you sure you want to disable password protection for this environment?',
    ]);
  });

  it.each([[[false]], [[true, false]]])(
    'says the environment was not updated and sends nothing when an answer is no (%p)',
    async (confirmations) => {
      const { updater, calls, lines } = updaterUnderTest({ confirmations });

      await expect(
        updater.update(request({ cachePriming: 'disable', passwordProtection: 'disable' })),
      ).resolves.toBe('cancelled');

      expect(calls).not.toContain('update');
      expect(lines).toEqual(['Environment not updated.']);
    },
  );

  it('asks nothing when enabling cache priming', async () => {
    const { updater, questions } = updaterUnderTest();

    await updater.update(request({ cachePriming: 'enable' }));

    expect(questions).toEqual([]);
  });

  it('enables password protection with the --username given and a password from the hidden prompt', async () => {
    const { updater, asked, sent, lines } = updaterUnderTest({ answers: { Password: TYPED_PASSWORD } });

    await updater.update(request({ passwordProtection: 'enable', username: 'admin', password: true }));

    expect(asked).toEqual(['Password']);
    expect(sent).toEqual([
      { ...SCOPE, update: { passwordProtection: { isEnabled: true, username: 'admin', password: TYPED_PASSWORD } } },
    ]);
    expect(lines.join('\n')).not.toContain(TYPED_PASSWORD);
  });

  it('asks for the username, then the password, when --username was not given', async () => {
    const { updater, asked, sent } = updaterUnderTest({ answers: { Username: '  admin ', Password: TYPED_PASSWORD } });

    await updater.update(request({ passwordProtection: 'enable' }));

    expect(asked).toEqual(['Username', 'Password']);
    expect(sent).toEqual([
      { ...SCOPE, update: { passwordProtection: { isEnabled: true, username: 'admin', password: TYPED_PASSWORD } } },
    ]);
  });

  it('refuses a prompted username containing a colon, sending nothing', async () => {
    const { updater, calls } = updaterUnderTest({ answers: { Username: 'ad:min', Password: TYPED_PASSWORD } });

    await expect(updater.update(request({ passwordProtection: 'enable' }))).rejects.toThrow(
      new UsageError('--username must not contain ":".'),
    );
    expect(calls).not.toContain('update');
  });

  it('enables password protection without a terminal from -u and a password piped to -p, asking nothing', async () => {
    const { updater, asked, sent, calls } = updaterUnderTest({ isTTY: false, piped: `${PIPED_PASSWORD}\n` });

    await updater.update(request({ passwordProtection: 'enable', username: 'admin', password: true }));

    expect(asked).toEqual([]);
    expect(calls).toContain('stdin');
    expect(sent).toEqual([
      { ...SCOPE, update: { passwordProtection: { isEnabled: true, username: 'admin', password: PIPED_PASSWORD } } },
    ]);
  });

  it.each([
    [
      { username: 'admin' },
      'Without a terminal, --password-protection enable reads the password from standard input: pass -p and pipe it in, ' +
        'e.g. printf \'%s\' "$PASSWORD" | csdx launch:env:update ... -u <username> -p',
    ],
    [{ password: true }, 'Without a terminal, --password-protection enable needs --username (-u).'],
  ])('refuses %p off a terminal before reading or sending anything', async (fields, message) => {
    const { updater, calls } = updaterUnderTest({ isTTY: false, piped: PIPED_PASSWORD });

    const failure = await updater
      .update(request({ passwordProtection: 'enable', ...fields }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(message);
    expect(calls).toEqual([]);
  });

  it.each([[''], ['\n'], ['   \r\n']])('refuses an empty password piped to -p (%p), sending nothing', async (piped) => {
    const { updater, calls } = updaterUnderTest({ isTTY: false, piped });

    await expect(
      updater.update(request({ passwordProtection: 'enable', username: 'admin', password: true })),
    ).rejects.toThrow(new UsageError('No password was read from standard input; pipe a non-empty password into -p.'));
    expect(calls).not.toContain('update');
  });

  it('asks the hidden prompt on a terminal and never reads stdin, -p or not', async () => {
    const { updater, calls, asked } = updaterUnderTest({ answers: { Password: TYPED_PASSWORD } });

    await updater.update(request({ passwordProtection: 'enable', username: 'admin', password: true }));

    expect(asked).toEqual(['Password']);
    expect(calls).not.toContain('stdin');
  });

  it('asks for credentials only after the disable question has been answered yes', async () => {
    const { updater, asked, questions } = updaterUnderTest({
      confirmations: [false],
      answers: { Username: 'admin', Password: TYPED_PASSWORD },
    });

    await updater.update(request({ cachePriming: 'disable', passwordProtection: 'enable' }));

    expect(questions).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  it.each([['project' as const], ['environment' as const], ['update' as const]])(
    'propagates a failed %s request without reporting a success',
    async (fails) => {
      const { updater, lines } = updaterUnderTest({ fails });

      await expect(updater.update(request({ name: 'renamed' }))).rejects.toBe(FAILURE);
      expect(lines).toEqual([]);
    },
  );

  it('asks which settings to change on a terminal when no update flag was given, then sends what was picked', async () => {
    const { updater, calls, asked, questions, sent, lines } = updaterUnderTest({
      answers: { [SETTINGS_QUESTION]: ['buildCmd', 'cachePriming'], 'Build command': 'npm run build:prod', 'Cache priming': 'disable' },
    });

    await expect(updater.update(request({}))).resolves.toBe('updated');

    expect(calls.slice(0, 2)).toEqual([
      'project {"org":"org1","project":"proj1"}',
      'environment {"org":"org1","project":"proj1","environment":"env1"}',
    ]);
    expect(asked).toEqual([SETTINGS_QUESTION, 'Build command', 'Cache priming']);
    expect(questions).toEqual(['Are you sure you want to disable cache priming for this environment?']);
    expect(sent).toEqual([{ ...SCOPE, update: { buildCommand: 'npm run build:prod', isCachePrimingEnabled: false } }]);
    expect(lines).toEqual(['\u2714 Environment updated successfully.']);
  });

  it.each([[[]], [['serverCmd']]])(
    'says nothing changed and sends nothing when the checklist answer %p changes no setting',
    async (picked) => {
      const { updater, calls, lines } = updaterUnderTest({ answers: { [SETTINGS_QUESTION]: picked } });

      await expect(updater.update(request({}))).resolves.toBe('unchanged');

      expect(calls).not.toContain('update');
      expect(lines[lines.length - 1]).toBe('Environment not updated. No changes were entered.');
    },
  );

  it('enables password protection picked from the checklist, asking the credentials after it', async () => {
    const { updater, asked, sent } = updaterUnderTest({
      answers: {
        [SETTINGS_QUESTION]: ['passwordProtection'],
        'Password protection': 'enable',
        Username: 'admin',
        Password: TYPED_PASSWORD,
      },
    });

    await updater.update(request({}));

    expect(asked).toEqual([SETTINGS_QUESTION, 'Password protection', 'Username', 'Password']);
    expect(sent).toEqual([
      { ...SCOPE, update: { passwordProtection: { isEnabled: true, username: 'admin', password: TYPED_PASSWORD } } },
    ]);
  });

  it('asks no checklist when any update flag was given', async () => {
    const { updater, asked } = updaterUnderTest();

    await updater.update(request({ name: 'renamed' }));

    expect(asked).toEqual([]);
  });

  it('asks new credentials when password protection is picked and enabled again, so they can be rotated', async () => {
    const { updater, asked, sent } = updaterUnderTest({
      answers: {
        [SETTINGS_QUESTION]: ['passwordProtection'],
        'Password protection': 'enable',
        Username: 'admin2',
        Password: NEW_PASSWORD,
      },
      passwordProtected: true,
    });

    await expect(updater.update(request({}))).resolves.toBe('updated');

    expect(asked).toEqual([SETTINGS_QUESTION, 'Password protection', 'Username', 'Password']);
    expect(sent).toEqual([
      { ...SCOPE, update: { passwordProtection: { isEnabled: true, username: 'admin2', password: NEW_PASSWORD } } },
    ]);
  });

  it.each([[{ username: 'bob' }], [{ password: true }], [{ name: 'renamed', username: 'bob' }]])(
    'refuses %p on a terminal before reading anything or showing the checklist',
    async (fields) => {
      const { updater, calls, asked } = updaterUnderTest();

      const failure = await updater.update(request(fields)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(UsageError);
      expect((failure as Error).message).toMatch(/^--(username|password) is only supported with --password-protection enable\.$/);
      expect(calls).toEqual([]);
      expect(asked).toEqual([]);
    },
  );

  it('reads the project and the environment at the same time rather than one after the other', async () => {
    let environmentStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      environmentStarted = resolve;
    });
    const { updater, sent } = updaterUnderTest();
    const services = (updater as unknown as { services: { api: Record<string, Record<string, unknown>> } }).services;
    const getProject = services.api.projects.get as (params: unknown) => Promise<unknown>;
    const getEnvironment = services.api.environments.get as (params: unknown) => Promise<unknown>;
    services.api.projects.get = async (params: unknown) => {
      await started;
      return getProject(params);
    };
    services.api.environments.get = async (params: unknown) => {
      environmentStarted();
      return getEnvironment(params);
    };

    await updater.update(request({ name: 'renamed' }));

    expect(sent).toHaveLength(1);
  }, 1000);
});
