import { parse as parseCookieHeader } from 'cookie';
import dotenv from 'dotenv';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';
import express from 'express';
import type { Express } from 'express-serve-static-core';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import type { Server } from 'http';
import { isBuiltin } from 'module';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import type { Plugin, RollupLog } from 'rollup';
import { fileURLToPath, pathToFileURL } from 'url';

import { styled } from '../core/style';
import { isRecord } from '../core/values';
import { CloudFunctionsValidator } from './cloud-functions-validator';
import {
  CLOUD_FUNCTIONS_DIRECTORY,
  CLOUD_FUNCTIONS_SUPPORTED_EXTENSION,
  DYNAMIC_ROUTE_SEGMENT,
  ENV_FILE_NAME,
} from './constants';
import {
  FunctionLoadError,
  FunctionsDirectoryNotFoundError,
  MissingPackageError,
  PortInUseError,
} from './function.errors';
import { walkFileSystem, checkIfDirectoryExists } from './os-helper';
import type { CloudFunctionResource } from './types';

type CloudFunctionHandler = CloudFunctionResource['handler'];

const DEPLOYED_PAYLOAD_LIMIT = '6mb';
const DEPLOYED_REDIRECT_STATUS = 307;
const INVALID_REDIRECT_MESSAGE =
  "Invalid redirect arguments. Please use a single argument URL, e.g. res.redirect('/destination') " +
  "or use a status code and URL, e.g. res.redirect(307, '/destination').";

function isHandler(value: unknown): value is CloudFunctionHandler {
  return typeof value === 'function';
}

interface SourceLocation {
  file: string;
  absoluteFile: string;
  line: number;
  column: number;
}

const STACK_FRAME = /\(?((?:file:\/\/)?(?:\/|[A-Za-z]:\\)[^\s():]+):(\d+):(\d+)\)?/g;

export type ImportersById = Map<string, readonly string[]>;

function recordImporters(importersById: ImportersById, staticImportersById: ImportersById): Plugin {
  return {
    name: 'launch-record-importers',
    buildEnd() {
      for (const moduleId of this.getModuleIds()) {
        const moduleInfo = this.getModuleInfo(moduleId);
        if (moduleInfo) {
          importersById.set(moduleId, [...moduleInfo.importers, ...moduleInfo.dynamicImporters]);
          staticImportersById.set(moduleId, moduleInfo.importers);
        }
      }
    },
  };
}

function importersMatching(
  moduleId: string,
  importersById: ImportersById,
  accepts: (importer: string) => boolean,
  visited = new Set<string>(),
): string[] {
  return (importersById.get(moduleId) ?? []).flatMap((importer) => {
    if (accepts(importer)) {
      return [importer];
    }

    if (visited.has(importer)) {
      return [];
    }

    visited.add(importer);
    return importersMatching(importer, importersById, accepts, visited);
  });
}

function realFilesImporting(moduleId: string, importersById: ImportersById): string[] {
  return importersMatching(moduleId, importersById, (importer) => path.isAbsolute(importer));
}

export function functionFilesImporting(
  moduleId: string,
  importersById: ImportersById,
  functionsDirectory: string,
): string[] {
  return importersMatching(
    moduleId,
    importersById,
    (importer) => path.isAbsolute(importer) && !isOutsideDirectory(functionsDirectory, importer),
  );
}

class OutsideImportReporter {
  private readonly reported = new Set<string>();

  constructor(
    private readonly projectDirectory: string,
    private readonly functionsDirectory: string,
  ) {}

  report(importersById: ImportersById): void {
    [...importersById.keys()]
      .filter((moduleId) => path.isAbsolute(moduleId))
      .filter((moduleId) => isOutsideDirectory(this.functionsDirectory, moduleId))
      .filter((moduleId) => !moduleId.split(path.sep).includes('node_modules'))
      .forEach((outsideFile) => {
        functionFilesImporting(outsideFile, importersById, this.functionsDirectory).forEach((importer) => {
          this.warnOnce(importer, outsideFile);
        });
      });
  }

  private warnOnce(importer: string, outsideFile: string): void {
    const pair = `${importer}\0${outsideFile}`;
    if (this.reported.has(pair)) {
      return;
    }

    this.reported.add(pair);
    const importerPath = path.relative(this.projectDirectory, importer);
    const outsidePath = path.relative(this.projectDirectory, outsideFile);
    const warning =
      `warn: ${importerPath} imports ${outsidePath}, ` +
      `which is outside ${CLOUD_FUNCTIONS_DIRECTORY}/ and will not be available when deployed.`;
    console.log(styled(warning, 'yellow', process.stdout.isTTY === true));
  }
}

export function isOutsideDirectory(directory: string, file: string, pathApi: path.PlatformPath = path): boolean {
  const relativePath = pathApi.relative(directory, file);
  return relativePath === '..' || relativePath.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relativePath);
}

function attachCookies(request: Request, _response: Response, next: NextFunction): void {
  request.cookies = request.headers.cookie ? parseCookieHeader(request.headers.cookie) : {};
  next();
}

function defaultToNoStore(_request: Request, response: Response, next: NextFunction): void {
  if (!response.getHeader('cache-control')) {
    response.setHeader('cache-control', 'no-store');
  }
  next();
}

function redirectLikeDeployedFunctions(_request: Request, response: Response, next: NextFunction): void {
  response.redirect = ((statusOrUrl: unknown, url?: unknown): void => {
    const [status, location] =
      typeof statusOrUrl === 'string' ? [DEPLOYED_REDIRECT_STATUS, statusOrUrl] : [statusOrUrl, url];
    if (typeof status !== 'number' || typeof location !== 'string') {
      throw new Error(INVALID_REDIRECT_MESSAGE);
    }
    response.writeHead(status, { Location: location }).end();
  }) as Response['redirect'];
  next();
}

function sendLikeDeployedFunctions(_request: Request, response: Response, next: NextFunction): void {
  const send = response.send.bind(response);
  const json = response.json.bind(response);
  response.json = ((body?: unknown): Response => json(body)) as Response['json'];
  response.send = ((body?: unknown): Response =>
    typeof body === 'number' ? response.json(body) : send(body)) as Response['send'];
  next();
}

export function answerRequestError(
  error: Error & { status?: number; type?: string },
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  const status = error.status ?? 500;
  console.error(`Request rejected before the function ran: ${status} ${error.type ?? error.name}`);
  response.status(status).end();
}

function applyRequestMiddleware(app: Express): void {
  app.use(defaultToNoStore);
  app.use(attachCookies);
  app.use(redirectLikeDeployedFunctions);
  app.use(sendLikeDeployedFunctions);
  app.use(express.json({ limit: DEPLOYED_PAYLOAD_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: DEPLOYED_PAYLOAD_LIMIT }));
  app.use(express.text({ limit: DEPLOYED_PAYLOAD_LIMIT }));
  app.use(express.raw({ limit: DEPLOYED_PAYLOAD_LIMIT }));
}

import { loadDataURL } from './load-data-url';

export function listenFailure(error: NodeJS.ErrnoException, servingPort: number): Error {
  return error.code === 'EADDRINUSE' ? new PortInUseError(servingPort) : error;
}

export class CloudFunctions {
  private cloudFunctionsDirectoryPath: string;
  private pathToSourceCode: string;
  private bundleDirectoryPath?: string;
  private bundleCount = 0;

  constructor(pathToSourceCode: string) {
    this.cloudFunctionsDirectoryPath = path.join(
      pathToSourceCode.replace(/^(\.\.(\/|\\|$))+/, ''),
      CLOUD_FUNCTIONS_DIRECTORY
    );
    this.pathToSourceCode = pathToSourceCode;
  }

  async serve(servingPort: number): Promise<Server | undefined> {
    const directoryExists = checkIfDirectoryExists(
      this.cloudFunctionsDirectoryPath
    );
    if (!directoryExists) {
      throw new FunctionsDirectoryNotFoundError(this.pathToSourceCode);
    }
    dotenv.config({ path: path.join(this.pathToSourceCode, ENV_FILE_NAME) });
    process.setSourceMapsEnabled(true);

    const cloudFunctionResources = await this.parseCloudFunctionResources();

    const hasCloudFunctionResources = cloudFunctionResources.length;
    if (!hasCloudFunctionResources) {
      console.log('No Serverless functions detected.');
      return;
    }

    const cloudFunctionsValidator = new CloudFunctionsValidator(
      cloudFunctionResources
    );
    const error = cloudFunctionsValidator.validate();
    if (error) {
      throw error;
    }
    const { exactRouteResources, dynamicRouteResources } =
      this.transformAndSegregateResourcesByRoutes(cloudFunctionResources);

    const app = express();
    app.disable('x-powered-by');
    applyRequestMiddleware(app);
    this.applyAppRouter(exactRouteResources, app);
    this.applyAppRouter(dynamicRouteResources, app);
    app.use(answerRequestError);

    return this.startServer(app, servingPort, [
      ...exactRouteResources,
      ...dynamicRouteResources,
    ]);
  }

  private printServing(
    servingPort: number,
    cloudFunctionResources: CloudFunctionResource[]
  ): void {
    console.log('Detected Serverless Functions:');
    cloudFunctionResources.forEach(({ apiResourceURI }) => {
      console.log(`  λ ${apiResourceURI}`);
    });
    console.log('');
    const url = styled(`http://localhost:${servingPort}`, 'cyan', process.stdout.isTTY === true);
    console.log(`Serving Cloud Functions at ${url}`);
  }

  private startServer(
    app: Express,
    servingPort: number,
    cloudFunctionResources: CloudFunctionResource[]
  ): Promise<Server> {
    return new Promise<Server>((resolve, reject) => {
      const refuse = (error: NodeJS.ErrnoException): void => {
        reject(listenFailure(error, servingPort));
      };

      const server = app.listen(servingPort, () => {
        server.off('error', refuse);
        this.printServing((server.address() as AddressInfo).port, cloudFunctionResources);
        resolve(server);
      });

      server.once('error', refuse);
    });
  }

  private applyAppRouter(cloudFunctionResources: CloudFunctionResource[], app: Express): void {
    cloudFunctionResources.forEach((cloudFunctionResource) => {
      app.all(cloudFunctionResource.apiResourceURI, async (request: Request, response: Response) => {
        try {
          await cloudFunctionResource.handler(request, response);
        } catch (error) {
          console.error(error);
          response.status(500).send();
        }
      });
    });
  }

  private isProxyEdgeFile(filename: string): boolean {
    const PROXY_EDGE_FILENAME = '[proxy].edge.js';
    return filename === PROXY_EDGE_FILENAME;
  }

  private async parseCloudFunctionResources(): Promise<CloudFunctionResource[]> {
    try {
      return await this.loadCloudFunctionResources();
    } finally {
      this.removeBundleDirectory();
    }
  }

  private async loadCloudFunctionResources(): Promise<CloudFunctionResource[]> {
    const filePaths = await walkFileSystem(this.cloudFunctionsDirectoryPath);
    const outsideImports = new OutsideImportReporter(
      realpathSync(this.pathToSourceCode),
      realpathSync(this.cloudFunctionsDirectoryPath),
    );

    const cloudFunctionResources: CloudFunctionResource[] = [];
    for await (const filePath of filePaths) {
      const parsedPath = path.parse(filePath);

      if (this.isProxyEdgeFile(parsedPath.base)
        || parsedPath.ext !== CLOUD_FUNCTIONS_SUPPORTED_EXTENSION
      ) {
        continue;
      }

      const handler = await this.buildHandlerForFilepath(filePath, outsideImports).catch((cause: unknown) => {
        const relativeFile = path.relative(this.cloudFunctionsDirectoryPath, filePath);
        const functionFile = path.join(CLOUD_FUNCTIONS_DIRECTORY, relativeFile);
        if (cause instanceof MissingPackageError && cause.importer === functionFile) {
          throw cause;
        }

        throw new FunctionLoadError(functionFile, cause, this.sourceLocation(cause));
      });
      if (!handler) {
        continue;
      }

      const relativeParsedPath = path.parse(
        path.relative(this.cloudFunctionsDirectoryPath, filePath)
      );

      const apiResourceURI = `/${path.join(
        relativeParsedPath.dir,
        relativeParsedPath.name
      )}`;

      cloudFunctionResources.push({
        cloudFunctionFilePath: filePath,
        apiResourceURI,
        handler
      });
    }

    return cloudFunctionResources;
  }

  private transformAndSegregateResourcesByRoutes(
    cloudFunctionResources: CloudFunctionResource[]
  ): {
    exactRouteResources: CloudFunctionResource[];
    dynamicRouteResources: CloudFunctionResource[];
  } {
    const exactRouteResources: CloudFunctionResource[] = [];
    const dynamicRouteResources: CloudFunctionResource[] = [];

    cloudFunctionResources.forEach(
      (cloudFunctionResource: CloudFunctionResource) => {
        if (
          cloudFunctionResource.apiResourceURI.match(DYNAMIC_ROUTE_SEGMENT) !==
          null
        ) {
          const apiResourceURI = cloudFunctionResource.apiResourceURI.replace(
            DYNAMIC_ROUTE_SEGMENT,
            ':$1'
          );

          dynamicRouteResources.push({
            ...cloudFunctionResource,
            apiResourceURI,
          });
        } else {
          exactRouteResources.push(cloudFunctionResource);
        }
      }
    );

    return { exactRouteResources, dynamicRouteResources };
  }

  private sourceLocation(cause: unknown): SourceLocation | undefined {
    try {
      return this.bundlerLocation(cause) ?? this.stackLocation(cause);
    } catch {
      return undefined;
    }
  }

  private bundlerLocation(cause: unknown): SourceLocation | undefined {
    const loc = isRecord(cause) && isRecord(cause.loc) ? cause.loc : undefined;
    if (!loc || typeof loc.file !== 'string' || typeof loc.line !== 'number' || typeof loc.column !== 'number') {
      return undefined;
    }

    const file = path.relative(realpathSync(this.pathToSourceCode), realpathSync(loc.file));
    return { file, absoluteFile: loc.file, line: loc.line, column: loc.column };
  }

  private stackLocation(cause: unknown): SourceLocation | undefined {
    if (!(cause instanceof Error) || !cause.stack) {
      return undefined;
    }

    const projectDirectory = realpathSync(this.pathToSourceCode);
    for (const [, frameFile, line, column] of cause.stack.matchAll(STACK_FRAME)) {
      const absoluteFile = frameFile.startsWith('file:') ? fileURLToPath(frameFile) : frameFile;
      if (!existsSync(absoluteFile)) {
        continue;
      }

      const realFile = realpathSync(absoluteFile);
      if (!isOutsideDirectory(projectDirectory, realFile) && !realFile.split(path.sep).includes('node_modules')) {
        const file = path.relative(projectDirectory, realFile);
        return { file, absoluteFile, line: Number(line), column: Number(column) };
      }
    }

    return undefined;
  }

  private refuseMissingPackages(unresolvedImports: RollupLog[], staticImportersById: ImportersById): void {
    unresolvedImports.forEach((warning) => {
      const packageName = String(warning.exporter);
      if (isBuiltin(packageName)) {
        return;
      }

      const [importer] = realFilesImporting(packageName, staticImportersById);
      if (importer) {
        throw new MissingPackageError(
          path.relative(realpathSync(this.pathToSourceCode), realpathSync(importer)),
          packageName,
        );
      }

      console.warn(warning.message);
    });
  }

  private removeBundleDirectory(): void {
    if (this.bundleDirectoryPath) {
      rmSync(this.bundleDirectoryPath, { recursive: true, force: true });
      this.bundleDirectoryPath = undefined;
    }
  }

  private bundleDirectory(): string {
    this.bundleDirectoryPath ??= realpathSync(mkdtempSync(path.join(tmpdir(), 'launch-functions-')));
    return this.bundleDirectoryPath;
  }

  private async buildHandlerForFilepath(
    cloudFunctionFilePath: string,
    outsideImports: OutsideImportReporter,
  ): Promise<CloudFunctionHandler | null> {
    const [{ rollup }, { nodeResolve }, { default: commonjs }, { default: json }] = await Promise.all([
      import('rollup'),
      import('@rollup/plugin-node-resolve'),
      import('@rollup/plugin-commonjs'),
      import('@rollup/plugin-json'),
    ]);
    const importersById: ImportersById = new Map();
    const staticImportersById: ImportersById = new Map();
    const unresolvedImports: RollupLog[] = [];
    const bundle = await rollup({
      input: cloudFunctionFilePath,
      plugins: [
        nodeResolve({ preferBuiltins: true }),
        commonjs(),
        json(),
        recordImporters(importersById, staticImportersById),
      ],
      onwarn: (warning, defaultHandler) => {
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.exporter) {
          unresolvedImports.push(warning);
          return;
        }

        defaultHandler(warning);
      },
    });
    this.refuseMissingPackages(unresolvedImports, staticImportersById);
    outsideImports.report(importersById);

    const bundleFile = path.join(
      this.bundleDirectory(),
      `${this.bundleCount++}-${path.basename(cloudFunctionFilePath, CLOUD_FUNCTIONS_SUPPORTED_EXTENSION)}.mjs`,
    );
    const { output } = await bundle.generate({
      format: 'esm',
      inlineDynamicImports: true,
      sourcemap: true,
      sourcemapExcludeSources: true,
      file: bundleFile,
    });
    writeFileSync(bundleFile, `${output[0].code}\n//# sourceMappingURL=${output[0].map?.toUrl()}\n`);
    const module = await loadDataURL(pathToFileURL(bundleFile).href);

    const exported = module.default;

    if (isHandler(exported)) {
      return exported;
    }

    if (isRecord(exported) && isHandler(exported.default)) {
      return exported.default;
    }

    return null;
  }
}
