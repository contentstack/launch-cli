import { MissingInputError } from '../core/errors';
import { askOption, askOptionalText, askText } from '../core/prompt';
import { requireValueOf } from '../core/rules';
import type { ServiceContext } from '../core/service-context';
import type { ResponseMode, ToggleValue } from './environment.inputs';
import { CREATE_PROMPT_REMEDIES, RESPONSE_MODES, TOGGLE_VALUES, frameworkPresetOf } from './environment.inputs';
import type { FrameworkPreset } from './frameworks';
import {
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESET_BY_LABEL,
  OUTPUT_DIRECTORY_BY_FRAMEWORK,
  SERVER_COMMAND_FRAMEWORKS,
} from './frameworks';
import type { CreateEnvironmentInput, DetectedFramework, EnvironmentRequest, EnvironmentSource } from './types';

function emptyEnvironmentVariables(): [] {
  return [];
}

function frameworkLabelOf(detected: unknown): string | undefined {
  if (typeof detected !== 'string') {
    return undefined;
  }

  const wanted = detected.trim().toLowerCase();

  return FRAMEWORK_CHOICES.find((label) => label.toLowerCase() === wanted);
}

export class EnvironmentBuilder {
  constructor(private readonly services: ServiceContext) {}

  async build(
    request: EnvironmentRequest,
    envName: string,
    source: EnvironmentSource,
    autoDeploy: ToggleValue | undefined,
  ): Promise<CreateEnvironmentInput> {
    const framework = await this.selectFramework(request, source.detected);

    const environment: CreateEnvironmentInput = {
      name: envName,
      gitBranch: source.branch,
      uploadUid: source.uploadUid,
      buildCommand: await this.buildCommand(request, source.detected),
      outputDirectory: await this.outputDirectory(request, framework, source.detected),
      serverCommand: await this.serverCommand(request, framework, source.detected),
      frameworkPreset: framework,
      environmentVariables: emptyEnvironmentVariables(),
      isStreamingEnabled: await this.streaming(request),
    };

    if (autoDeploy !== undefined) {
      environment.autoDeployOnPush = autoDeploy === 'enable';
    }

    const csAuth = await this.contentstackAuthentication(request);

    if (csAuth !== undefined) {
      environment.isContentstackAuthenticationEnabled = csAuth === 'enable';
    }

    return environment;
  }

  private async selectFramework(request: EnvironmentRequest, detected: DetectedFramework): Promise<FrameworkPreset> {
    if (request.framework !== undefined) {
      return request.framework;
    }

    if (this.services.isTTY) {
      return frameworkPresetOf(
        await askOption(
          this.services.ux,
          'Framework preset',
          FRAMEWORK_CHOICES.map((label) => ({ name: label, value: label })),
          frameworkLabelOf(detected.framework),
        ),
      );
    }

    const label = frameworkLabelOf(detected.framework);

    if (label === undefined) {
      throw new MissingInputError('framework', CREATE_PROMPT_REMEDIES);
    }

    const preset = FRAMEWORK_PRESET_BY_LABEL[label.toLowerCase()];
    this.services.ux.print(`Using the detected framework ${preset}. Pass --framework to choose another.`);

    return preset;
  }

  private async serverCommand(
    request: EnvironmentRequest,
    framework: FrameworkPreset,
    detected: DetectedFramework,
  ): Promise<string | undefined> {
    if (request.serverCmd !== undefined) {
      requireValueOf('server-cmd', 'framework', SERVER_COMMAND_FRAMEWORKS, framework);

      return request.serverCmd;
    }

    if (!SERVER_COMMAND_FRAMEWORKS.includes(framework)) {
      return undefined;
    }

    if (this.services.isTTY) {
      return askOptionalText(this.services.ux, 'Server command', detected.serverCommand);
    }

    return this.detectedValue(detected.serverCommand, 'server command', '--server-cmd');
  }

  private async buildCommand(request: EnvironmentRequest, detected: DetectedFramework): Promise<string | undefined> {
    if (request.buildCmd !== undefined) {
      return request.buildCmd;
    }

    if (this.services.isTTY) {
      return askOptionalText(this.services.ux, 'Build command', detected.buildCommand);
    }

    return this.detectedValue(detected.buildCommand, 'build command', '--build-cmd');
  }

  private async outputDirectory(
    request: EnvironmentRequest,
    framework: FrameworkPreset,
    detected: DetectedFramework,
  ): Promise<string> {
    if (request.outputDir !== undefined) {
      return request.outputDir;
    }

    const fallback = OUTPUT_DIRECTORY_BY_FRAMEWORK[framework];

    if (this.services.isTTY) {
      return askText(this.services.ux, 'Output directory', detected.outputDirectory ?? fallback);
    }

    const found = this.detectedValue(detected.outputDirectory, 'output directory', '--output-dir');

    if (found !== undefined) {
      return found;
    }

    this.services.ux.print(
      `Using the default output directory "${fallback}" for ${framework}. Pass --output-dir to change it.`,
    );

    return fallback;
  }

  private detectedValue(value: string | undefined, noun: string, flag: string): string | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    this.services.ux.print(`Using the detected ${noun} "${value}". Pass ${flag} to change it.`);

    return value;
  }

  private async streaming(request: EnvironmentRequest): Promise<boolean> {
    if (request.resMode !== undefined) {
      return request.resMode === ('streaming' satisfies ResponseMode);
    }

    if (this.services.isTTY) {
      const mode = await askOption(
        this.services.ux,
        'Response mode',
        RESPONSE_MODES.map((value) => ({ name: value, value })),
        RESPONSE_MODES[0],
      );

      return mode === ('streaming' satisfies ResponseMode);
    }

    this.services.ux.print('Using the buffered response mode. Pass --res-mode streaming to stream responses.');

    return false;
  }

  private async contentstackAuthentication(request: EnvironmentRequest): Promise<string | undefined> {
    if (request.csAuth !== undefined) {
      return request.csAuth;
    }

    if (this.services.isTTY) {
      return askOption(
        this.services.ux,
        'Contentstack Authentication',
        TOGGLE_VALUES.map((value) => ({ name: value, value })),
        'enable' satisfies ToggleValue,
      );
    }

    return undefined;
  }
}
